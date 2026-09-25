import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from '../media-lens/worker/server.js';
import { loadConfig } from '../media-lens/worker/config.js';
import { SOURCE_REGISTRY, approvedSources } from '../media-lens/worker/discovery/source-registry.js';
import { discoverStories, NOT_LIVE_MESSAGE } from '../media-lens/worker/discovery/discover.js';
import { validateStoryDiscovery } from '../media-lens/schema/story-discovery.js';
import { OMISSION_NOTE } from '../media-lens/worker/discovery/cluster.js';
import { loadMediaLensPage } from './helpers/media-lens-dom.js';

const NOW = new Date('2026-09-25T18:00:00.000Z');

function requestJson(server, path) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({ host: '127.0.0.1', port: address.port, method: 'GET', path }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const FIXTURE_SOURCES = [
  {
    source_id: 'fixture-daily',
    outlet: 'Fixture Daily',
    feed_url: 'https://feeds.fixture.test/daily.xml',
    feed_host: 'feeds.fixture.test',
    approval_status: 'approved',
    permission_basis: 'in-repo fixture only'
  },
  {
    source_id: 'fixture-wire',
    outlet: 'Fixture Wire',
    feed_url: 'https://feeds.fixture.test/wire.xml',
    feed_host: 'feeds.fixture.test',
    approval_status: 'approved',
    permission_basis: 'in-repo fixture only'
  }
];

async function fixtureBodies() {
  const daily = await readFile('media-lens/fixtures/discovery/fixture-daily.xml', 'utf8');
  const wire = await readFile('media-lens/fixtures/discovery/fixture-wire.xml', 'utf8');
  return new Map([
    ['fixture-daily', daily],
    ['fixture-wire', wire]
  ]);
}

test('candidate registry is pending, https, and host-matched', () => {
  assert.equal(approvedSources().length, 0);
  assert.equal(SOURCE_REGISTRY.length, 4);
  for (const source of SOURCE_REGISTRY) {
    assert.equal(source.approval_status, 'candidate_pending_owner_approval');
    assert.equal(source.cost_usd, 0);
    assert.equal(source.credentials, 'none');
    assert.match(source.permission_basis, /does not treat that page as permission/);
    const url = new URL(source.feed_url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, source.feed_host);
    assert.equal(new URL(source.terms_url).protocol, 'https:');
  }
  const config = loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'TRUE' });
  assert.equal(config.storyDiscoveryEnabled, false);
  assert.equal(loadConfig({}).storyDiscoveryEnabled, false);
  assert.equal(loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }).storyDiscoveryEnabled, true);
});

test('discovery stays off and does not fetch when the flag is unset', async () => {
  let fetches = 0;
  const document = await discoverStories({
    config: loadConfig({}),
    now: NOW,
    fetchFeed: async () => {
      fetches += 1;
      return '<rss></rss>';
    }
  });
  assert.equal(fetches, 0);
  assert.equal(document.status, 'not_live');
  assert.equal(document.message, NOT_LIVE_MESSAGE);
  assert.deepEqual(document.sources_checked, []);
  assert.equal(document.privacy.jev_used, false);
  assert.equal(document.privacy.retention, 'none');
  assert.equal(validateStoryDiscovery(document).ok, true);
});

test('an enabled flag with no approved source abstains and does not fetch', async () => {
  let fetches = 0;
  const document = await discoverStories({
    config: loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }),
    now: NOW,
    fetchFeed: async () => {
      fetches += 1;
      return '<rss></rss>';
    }
  });
  assert.equal(fetches, 0);
  assert.equal(document.status, 'abstain');
  assert.equal(document.reason, 'no_approved_sources');
  assert.match(document.message, /No feeds were checked/);
  assert.equal(validateStoryDiscovery(document).ok, true);
});

test('mocked feeds discover, cluster, and compare without treating same-story or wire copy as independent', async () => {
  const document = await discoverStories({
    config: loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }),
    now: NOW,
    registry: FIXTURE_SOURCES,
    feedBodies: await fixtureBodies()
  });
  assert.equal(document.data_origin, 'fixture');
  assert.equal(document.fixture_labeled, true);
  assert.equal(document.status, 'ok');
  assert.equal(document.clusters.length, 1);
  const cluster = document.clusters[0];
  assert.equal(cluster.coverage_gap, null);
  assert.deepEqual(cluster.frames, []);
  assert.match(cluster.omission_note, /not proof an outlet omitted/);
  assert.match(document.message, new RegExp(OMISSION_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(
    document.sources_checked.map((source) => source.outcome),
    ['checked', 'checked']
  );
  assert.equal(document.sources_checked[0].stale_or_undated_excluded, 1);
  const original = cluster.members.find((member) => member.source_id === 'fixture-daily');
  assert.equal(original.independent_reporting, true);
  assert.equal(original.labeling_basis, 'recorded_origin_evidence_first_independent_report');
  const wire = cluster.members.find((member) => member.canonical_url.includes('prnewswire.com'));
  assert.equal(wire.relation, 'syndicated');
  assert.equal(wire.independent_reporting, false);
  assert.equal(cluster.members.filter((member) => member.labeling_basis === 'same_canonical_url').length, 1);
  assert.equal(cluster.independent_reporting.length, 1);
  const titleOnly = cluster.members.find((member) => member.canonical_url.includes('second-outlet.test'));
  assert.equal(titleOnly.relation, 'same_story');
  assert.equal(titleOnly.independent_reporting, false);
  assert.equal(validateStoryDiscovery(document).ok, true);

  const server = await listen(
    createServer(loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }), {
      discoveryNow: NOW,
      discoveryRegistry: FIXTURE_SOURCES,
      discoveryFeedBodies: await fixtureBodies()
    })
  );
  try {
    const list = await requestJson(server, '/stories');
    assert.equal(list.status, 200);
    assert.equal(list.body.fixture_labeled, true);
    const clusterId = list.body.clusters[0].cluster_id;
    const opened = await requestJson(server, `/stories/cluster/${clusterId}`);
    assert.equal(opened.body.comparison.article_pages_fetched, false);
    assert.equal(opened.body.comparison.syndicated.length, 2);
    assert.equal(opened.body.comparison.independent_reporting.length, 1);
    assert.match(opened.body.comparison.omission_note, /not proof an outlet omitted/);
    assert.match(opened.body.comparison.frame_note, /No coverage-frame comparison/);
    assert.equal(opened.body.privacy.jev_used, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('source failure, empty feeds, stale items, and unsafe URLs stay honest', async () => {
  let fetches = 0;
  const registry = [
    { ...FIXTURE_SOURCES[0], source_id: 'ok-source' },
    {
      source_id: 'down-source',
      outlet: 'Down Source',
      feed_url: 'https://feeds.fixture.test/down.xml',
      feed_host: 'feeds.fixture.test',
      approval_status: 'approved'
    }
  ];
  const failed = await discoverStories({
    config: loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }),
    now: NOW,
    registry,
    fetchFeed: async (_url, source) => {
      fetches += 1;
      if (source.source_id === 'down-source') throw Object.assign(new Error('down'), { code: 'fetch_failed' });
      return await readFile('media-lens/fixtures/discovery/fixture-daily.xml', 'utf8');
    }
  });
  assert.equal(fetches, 2);
  assert.equal(failed.sources_checked.find((source) => source.source_id === 'down-source').outcome, 'failed');
  assert.equal(failed.clusters.length, 1);
  assert.equal(failed.clusters[0].members.length, 1);

  const empty = await discoverStories({
    config: loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }),
    now: NOW,
    registry: [FIXTURE_SOURCES[0]],
    feedBodies: new Map([['fixture-daily', '<rss version="2.0"><channel></channel></rss>']])
  });
  assert.equal(empty.status, 'empty');
  assert.deepEqual(empty.clusters, []);
  assert.match(empty.message, /Sources checked: Fixture Daily/);
  assert.match(empty.message, /not proof an outlet omitted/);

  const stale = await discoverStories({
    config: loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }),
    now: NOW,
    registry: [FIXTURE_SOURCES[0]],
    feedBodies: new Map([
      [
        'fixture-daily',
        '<rss><channel><item><title>Old only</title><link>https://www.fixture-daily.test/old</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item></channel></rss>'
      ]
    ])
  });
  assert.equal(stale.status, 'empty');
  assert.equal(stale.sources_checked[0].stale_or_undated_excluded, 1);
  assert.equal(stale.sources_checked[0].item_count, 0);

  const unsafe = await discoverStories({
    config: loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }),
    now: NOW,
    registry: [FIXTURE_SOURCES[0]],
    feedBodies: new Map([
      [
        'fixture-daily',
        '<rss><channel><item><title>Secret</title><link>http://127.0.0.1/secret</link><pubDate>Thu, 25 Sep 2026 15:00:00 GMT</pubDate></item><item><title>User info</title><link>https://user:pass@www.fixture-daily.test/a</link><pubDate>Thu, 25 Sep 2026 15:00:00 GMT</pubDate></item></channel></rss>'
      ]
    ])
  });
  assert.equal(unsafe.clusters.length, 0);
  assert.equal(unsafe.sources_checked[0].rejected_unsafe_or_incomplete, 2);
});

test('unsafe feed URLs are not fetched', async () => {
  const cases = [
    ['https://127.0.0.1/feed.xml', '127.0.0.1'],
    ['http://feeds.fixture.test/feed.xml', 'feeds.fixture.test'],
    ['https://user:pass@feeds.fixture.test/feed.xml', 'feeds.fixture.test'],
    ['https://evil.example/feed.xml', 'feeds.fixture.test']
  ];
  for (const [feedUrl, feedHost] of cases) {
    let fetches = 0;
    const document = await discoverStories({
      config: loadConfig({ MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true' }),
      now: NOW,
      registry: [
        {
          source_id: 'bad-feed',
          outlet: 'Bad Feed',
          feed_url: feedUrl,
          feed_host: feedHost,
          approval_status: 'approved'
        }
      ],
      fetchFeed: async () => {
        fetches += 1;
        return '<rss></rss>';
      }
    });
    assert.equal(fetches, 0, feedUrl);
    assert.equal(document.sources_checked[0].outcome, 'failed');
    assert.equal(document.clusters.length, 0);
  }
});

test('live mode does not return fixture discovery', async () => {
  const live = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-not-a-real-key',
    MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true',
    MEDIA_LENS_STORY_DISCOVERY_FIXTURES: 'true'
  });
  assert.equal(live.storyDiscoveryFixtures, false);
  assert.equal(live.jevShadow.enabled, false);
  const document = await discoverStories({
    config: live,
    now: NOW,
    registry: FIXTURE_SOURCES,
    feedBodies: await fixtureBodies(),
    allowFixtures: true
  });
  assert.equal(document.status, 'not_live');
  assert.equal(document.fixture_labeled, false);
  assert.equal(JSON.stringify(document).includes('Harbor bridge'), false);

  const server = await listen(createServer(live, { discoveryFeedBodies: await fixtureBodies(), discoveryNow: NOW }));
  try {
    const response = await requestJson(server, '/stories');
    assert.equal(response.body.status, 'not_live');
    assert.equal(JSON.stringify(response.body).includes('Harbor bridge'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('story discovery rate limit does not check feeds', async () => {
  let fetches = 0;
  const server = await listen(
    createServer(
      loadConfig({
        MEDIA_LENS_ENABLE_STORY_DISCOVERY: 'true',
        MEDIA_LENS_MAX_STORY_DISCOVERY_PER_MINUTE: '1'
      }),
      {
        fetchFeed: async () => {
          fetches += 1;
          return '<rss></rss>';
        }
      }
    )
  );
  try {
    const first = await requestJson(server, '/stories');
    const second = await requestJson(server, '/stories');
    assert.equal(first.status, 200);
    assert.equal(first.body.reason, 'no_approved_sources');
    assert.equal(second.status, 429);
    assert.match(second.body.message, /No feeds were checked/);
    assert.equal(fetches, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('local preview labels fixture discovery and the live host does not request it', async () => {
  const clusterId = 'abc123abc123abcd';
  const list = {
    contract: 'story-discovery.v1',
    status: 'ok',
    message: 'Showing clusters from 1 source checked. A missing article is not proof an outlet omitted this story.',
    data_origin: 'fixture',
    fixture_labeled: true,
    clusters: [{ cluster_id: clusterId, title: 'Harbor bridge inspection closes one lane' }],
    sources_checked: [{ outlet: 'Fixture Daily', outcome: 'checked' }],
    window: { start: '2026-09-24T18:00:00.000Z', end: '2026-09-25T18:00:00.000Z' }
  };
  const opened = {
    ...list,
    comparison: {
      retrieved_reports: [
        {
          canonical_url: 'https://www.fixture-daily.test/2026/09/25/harbor-bridge',
          article_title: 'Harbor bridge inspection closes one lane',
          outlet: 'Fixture Daily',
          relation: 'independent_reporting',
          labeling_basis: 'recorded_origin_evidence'
        }
      ],
      omission_note: 'A missing article is not proof an outlet omitted this story.',
      frame_note: 'No coverage-frame comparison was available for this cluster.'
    }
  };
  const page = await loadMediaLensPage({
    href: 'http://127.0.0.1:8123/media-lens/',
    health: null,
    stories: (target) =>
      new Response(JSON.stringify(String(target).includes('/cluster/') ? opened : list), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
  });
  try {
    await page.waitFor(() => page.byId('story-discovery-list').querySelector('button'));
    assert.equal(page.byId('story-discovery-fixture-badge').hidden, false);
    assert.match(page.byId('story-discovery-status').textContent, /Fixture discovery\. Not live coverage/);
    page.byId('story-discovery-list').querySelector('button').click();
    await page.waitFor(() => page.byId('story-cluster-detail').hidden === false);
    const detailText = page.byId('story-cluster-detail').querySelectorAll('p').map((node) => node.textContent).join(' ');
    assert.match(detailText, /Fixture Daily/);
    assert.match(detailText, /not proof an outlet omitted/);
    assert.match(detailText, /Article pages were not fetched/);
  } finally {
    page.restore();
  }

  const live = await loadMediaLensPage({ href: 'https://ml-jev.manipulationscore.com/media-lens/' });
  try {
    assert.equal(
      live.fetchCalls.some((call) => call.url.includes('/stories')),
      false
    );
    assert.match(live.byId('story-discovery-status').textContent, /not live on this host/);
    assert.match(live.byId('story-discovery-status').textContent, /does not discover stories/);
  } finally {
    live.restore();
  }
});

test('labeled fixture files stay out of discovery until the fixture flag is set on a fixture worker', async () => {
  const off = await discoverStories({ config: loadConfig({}), now: NOW, allowFixtures: false });
  assert.equal(off.status, 'not_live');
  const on = await discoverStories({
    config: loadConfig({ MEDIA_LENS_STORY_DISCOVERY_FIXTURES: 'true' }),
    now: NOW,
    allowFixtures: true
  });
  assert.equal(on.fixture_labeled, true);
  assert.equal(on.data_origin, 'fixture');
  assert.match(on.message, /Fixture|not proof|Sources checked|Showing clusters/);
  assert.equal(validateStoryDiscovery(on).ok, true);
});
