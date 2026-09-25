import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNewsjackAdapter } from '../media-lens/worker/adapters/newsjack.js';
import {
  mapNewsjackEvidenceToStoryDiscovery,
  classifySourceUrl,
  CLUSTER_BASIS,
  INDEPENDENCE_BASIS,
  SAME_OUTLET_ADDITIONAL_URL_BASIS
} from '../media-lens/worker/discovery/newsjack-discovery.js';
import {
  createFixtureSearchProvider,
  createHostWebSearchProvider,
  createMedialystSearchProvider,
  createRssAtomSearchProvider,
  createSearchProvider,
  IMPLEMENTED_SEARCH_PROVIDER_MODES,
  MEDIALYST_NOT_IMPLEMENTED,
  PLANNED_SEARCH_PROVIDER_MODES,
  SEARCH_PROVIDER_MODE_STATUS,
  SEARCH_PROVIDER_NOT_IMPLEMENTED
} from '../media-lens/worker/discovery/search-provider.js';
import { validateStoryDiscovery } from '../media-lens/schema/story-discovery.js';

const RETRIEVED_AT = '2026-09-25T18:00:00.000Z';
const WINDOW = { start: '2026-09-24T18:00:00.000Z', end: RETRIEVED_AT, hours: 24 };

function mapHits(hits, extra = {}) {
  return mapNewsjackEvidenceToStoryDiscovery({
    retrievedAt: RETRIEVED_AT,
    window: WINDOW,
    providerId: 'fixture:newsjack_shaped',
    providerMode: 'fixture',
    freshnessGrade: 'fixture',
    query: 'transit fare',
    hits,
    dataOrigin: 'fixture',
    ...extra
  });
}

test('fixture search hits become a labeled story-discovery document', async () => {
  const provider = createFixtureSearchProvider({
    hits: [
      {
        title: 'Board sets a fare vote',
        url: 'https://fictional-daily.example/articles/fare-vote',
        outlet: 'Fictional Daily',
        author: 'Ada Example',
        published_at: '2026-09-25T12:00:00.000Z',
        relation: 'surfaced'
      }
    ]
  });
  const found = await provider.search({ text: 'transit fare', window: WINDOW });
  assert.equal(found.live, false);
  const document = mapHits(found.hits);
  assert.equal(validateStoryDiscovery(document).ok, true, validateStoryDiscovery(document).errors.join(','));
  assert.equal(document.fixture_labeled, true);
  assert.equal(document.data_origin, 'fixture');
  assert.equal(document.privacy.jev_used, false);
  assert.equal(document.privacy.full_text_persisted, false);
  const member = document.clusters[0].members[0];
  assert.equal(member.retrieved_at, RETRIEVED_AT);
  assert.equal(member.published_at, '2026-09-25T12:00:00.000Z');
  assert.equal(member.relation, 'same_story');
  assert.equal(member.labeling_basis, 'newsjack_relation_surfaced');
  assert.equal(member.independent_reporting, false);
  assert.equal(member.author, undefined);
  assert.equal(document.clusters[0].cluster_basis, CLUSTER_BASIS);
  assert.equal(document.clusters[0].coverage_gap, null);
  assert.deepEqual(document.clusters[0].frames, []);
  assert.equal(document.sources_checked[0].provider, 'fixture:newsjack_shaped');
  assert.equal(document.sources_checked[0].feed_url, null);
});

test('incomplete timestamps stay unknown', () => {
  const document = mapHits([
    {
      title: 'Undated fare note',
      url: 'https://fictional-daily.example/articles/undated',
      outlet: 'Fictional Daily',
      published_at: 'Tuesday',
      relation: 'surfaced'
    }
  ]);
  assert.equal(validateStoryDiscovery(document).ok, true);
  assert.equal(document.clusters[0].members[0].published_at, null);
  assert.equal(document.clusters[0].members[0].retrieved_at, RETRIEVED_AT);
  assert.equal(document.clusters[0].coverage_gap, null);
});

test('duplicated URLs and wire copy are syndicated, not independent', () => {
  const document = mapHits([
    {
      title: 'Fare vote',
      url: 'https://fictional-daily.example/articles/fare-vote',
      outlet: 'Fictional Daily',
      published_at: '2026-09-25T12:00:00.000Z',
      relation: 'surfaced'
    },
    {
      title: 'Fare vote',
      url: 'https://fictional-daily.example/articles/fare-vote?utm_source=copy',
      outlet: 'Fictional Daily',
      published_at: '2026-09-25T12:00:00.000Z',
      relation: 'same_story'
    },
    {
      title: 'Fare vote',
      url: 'https://www.prnewswire.com/news-releases/fare-vote',
      outlet: 'PR Newswire',
      published_at: '2026-09-25T11:00:00.000Z',
      relation: 'syndicated'
    }
  ]);
  assert.equal(validateStoryDiscovery(document).ok, true);
  const members = document.clusters[0].members;
  assert.equal(members[1].relation, 'syndicated');
  assert.equal(members[1].labeling_basis, 'same_canonical_url');
  assert.equal(members[2].relation, 'syndicated');
  assert.equal(members[2].labeling_basis, 'wire_press_release_or_partner_url');
  assert.equal(document.clusters[0].independent_reporting.length, 0);
});

test('uncertain origin and a single corroborating URL do not become independent reporting', () => {
  const uncertain = mapHits(
    [
      {
        title: 'Fare vote',
        url: 'https://fictional-daily.example/articles/fare-vote',
        outlet: 'Fictional Daily',
        published_at: '2026-09-25T12:00:00.000Z',
        relation: 'surfaced'
      },
      {
        title: 'Fare vote',
        url: 'https://second-outlet.example/news/fare-vote',
        outlet: 'Second Outlet',
        published_at: '2026-09-25T12:30:00.000Z',
        relation: 'same_story'
      }
    ],
    {
      origin: {
        same_story_assessment: 'unclear',
        timestamp_evidence: [
          { url_key: 'https://fictional-daily.example/articles/fare-vote', published_at: '2026-09-25T12:00:00.000Z' },
          { url_key: 'https://second-outlet.example/news/fare-vote', published_at: '2026-09-25T12:30:00.000Z' }
        ]
      }
    }
  );
  assert.equal(validateStoryDiscovery(uncertain).ok, true);
  assert.equal(uncertain.clusters[0].independent_reporting.length, 0);
  assert.ok(uncertain.clusters[0].members.every((member) => member.labeling_basis === 'newsjack_origin_uncertain'));

  const thin = mapHits(
    [
      {
        title: 'Fare vote',
        url: 'https://fictional-daily.example/articles/fare-vote',
        outlet: 'Fictional Daily',
        published_at: '2026-09-25T12:00:00.000Z',
        relation: 'surfaced'
      }
    ],
    {
      origin: {
        same_story_assessment: 'same_story',
        timestamp_evidence: [
          { url_key: 'https://fictional-daily.example/articles/fare-vote', published_at: '2026-09-25T12:00:00.000Z' }
        ]
      }
    }
  );
  assert.equal(thin.clusters[0].members[0].relation, 'same_story');
  assert.equal(thin.clusters[0].members[0].independent_reporting, false);
  assert.equal(thin.clusters[0].coverage_gap, null);
});

test('two dated non-wire origin URLs can label those members independent', () => {
  const document = mapHits(
    [
      {
        title: 'Fare vote',
        url: 'https://fictional-daily.example/articles/fare-vote',
        outlet: 'Fictional Daily',
        published_at: '2026-09-25T12:00:00.000Z',
        relation: 'surfaced'
      },
      {
        title: 'Fare vote',
        url: 'https://second-outlet.example/news/fare-vote',
        outlet: 'Second Outlet',
        published_at: '2026-09-25T12:30:00.000Z',
        relation: 'same_story'
      },
      {
        title: 'Fare vote',
        url: 'https://wire.example/press-release/fare-vote',
        outlet: 'Wire Desk',
        relation: 'syndicated'
      }
    ],
    {
      origin: {
        same_story_assessment: 'same_story',
        first_public_at: null,
        timestamp_evidence: [
          { url_key: 'https://fictional-daily.example/articles/fare-vote', published_at: '2026-09-25T12:00:00.000Z' },
          { url_key: 'https://second-outlet.example/news/fare-vote', published_at: '2026-09-25T12:30:00.000Z' }
        ]
      }
    }
  );
  assert.equal(validateStoryDiscovery(document).ok, true);
  const independent = document.clusters[0].members.filter((member) => member.independent_reporting);
  assert.equal(independent.length, 2);
  assert.ok(independent.every((member) => member.labeling_basis === INDEPENDENCE_BASIS));
  const wire = document.clusters[0].members.find((member) => member.outlet === 'Wire Desk');
  assert.equal(wire.relation, 'syndicated');
  assert.equal(wire.published_at, null);
  assert.equal(document.clusters[0].coverage_gap, null);
  assert.equal(document.clusters[0].origin, undefined);
});

test('missing retrieval time abstains instead of copying published_at', () => {
  const document = mapNewsjackEvidenceToStoryDiscovery({
    window: WINDOW,
    hits: [
      {
        title: 'Fare vote',
        url: 'https://fictional-daily.example/articles/fare-vote',
        outlet: 'Fictional Daily',
        published_at: '2026-09-25T12:00:00.000Z'
      }
    ]
  });
  assert.equal(document.status, 'abstain');
  assert.equal(document.retrieved_at, null);
  assert.equal(document.clusters.length, 0);
  assert.equal(validateStoryDiscovery(document).ok, true);
});

test('Medialyst provider is deferred and does not accept credentials', async () => {
  const provider = createMedialystSearchProvider();
  await assert.rejects(provider.search({ text: 'transit' }), (err) => err.code === MEDIALYST_NOT_IMPLEMENTED);
  assert.throws(() => createMedialystSearchProvider({ apiKey: 'secret' }), (err) => err.code === MEDIALYST_NOT_IMPLEMENTED);
});

test('artifact directory and fixture adapter emit story-discovery.v1; cli stays unimplemented', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-'));
  await writeFile(join(dir, 'clustered_candidates.json'), JSON.stringify({
    clusters: [
      {
        cluster_id: 'artifact-cluster',
        members: [
          {
            title: 'Artifact fare vote',
            url: 'https://fictional-daily.example/articles/artifact',
            outlet: 'Fictional Daily',
            published_at: null,
            relation: 'surfaced'
          }
        ]
      }
    ]
  }));
  await writeFile(join(dir, 'origin_findings.json'), JSON.stringify({
    same_story_assessment: 'unclear',
    first_public_at: null,
    timestamp_evidence: []
  }));
  const fromArtifacts = await createNewsjackAdapter({ mode: 'artifacts', artifactsDir: dir }).discoverStoryDocument({
    retrievedAt: RETRIEVED_AT,
    window: WINDOW
  });
  assert.equal(validateStoryDiscovery(fromArtifacts).ok, true, validateStoryDiscovery(fromArtifacts).errors.join(','));
  assert.equal(fromArtifacts.data_origin, 'newsjack_artifacts');
  assert.equal(fromArtifacts.fixture_labeled, false);
  assert.equal(fromArtifacts.clusters[0].cluster_basis, CLUSTER_BASIS);
  assert.equal(fromArtifacts.clusters[0].members[0].published_at, null);
  assert.equal(fromArtifacts.clusters[0].members[0].labeling_basis, 'newsjack_origin_uncertain');
  assert.equal(fromArtifacts.clusters[0].coverage_gap, null);

  const fromFixture = await createNewsjackAdapter({
    mode: 'fixture',
    fixtureId: 'discovery-shaped',
    fixtureDir: 'media-lens/fixtures/newsjack'
  }).discoverStoryDocument({ retrievedAt: RETRIEVED_AT });
  assert.equal(validateStoryDiscovery(fromFixture).ok, true, validateStoryDiscovery(fromFixture).errors.join(','));
  assert.equal(fromFixture.fixture_labeled, true);
  assert.equal(fromFixture.clusters[0].independent_reporting.length, 2);

  const cli = createNewsjackAdapter({ mode: 'cli' });
  await assert.rejects(() => cli.getStoryContext({}), /not implemented/);
  await assert.rejects(() => cli.discoverStoryDocument({ retrievedAt: RETRIEVED_AT, window: WINDOW }), /not implemented/);
});

function artifactAdapter(artifactsDir) {
  return createNewsjackAdapter({ mode: 'artifacts', artifactsDir }).discoverStoryDocument({
    retrievedAt: RETRIEVED_AT,
    window: WINDOW
  });
}

test('artifact reads fail closed when the directory is missing or unreadable', async () => {
  const missing = await artifactAdapter(join(tmpdir(), 'newsjack-discovery-missing-dir'));
  assert.equal(missing.status, 'abstain');
  assert.equal(missing.reason, 'artifacts_unavailable');
  assert.equal(missing.clusters.length, 0);
  assert.equal(missing.sources_checked[0].outcome, 'failed');
  assert.equal(missing.sources_checked[0].error, 'ENOENT');
  assert.equal(validateStoryDiscovery(missing).ok, true);

  const unset = await artifactAdapter(null);
  assert.equal(unset.status, 'abstain');
  assert.equal(unset.reason, 'artifacts_unavailable');
  assert.equal(unset.sources_checked[0].outcome, 'failed');
  assert.equal(unset.sources_checked[0].error, 'artifacts_dir_missing');

  const blocked = await mkdtemp(join(tmpdir(), 'newsjack-discovery-blocked-'));
  await chmod(blocked, 0);
  let unreadable;
  try {
    unreadable = await artifactAdapter(blocked);
  } finally {
    await chmod(blocked, 0o700);
  }
  if (unreadable.sources_checked[0].error === null) {
    const fileDir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-file-'));
    const filePath = join(fileDir, 'not-a-directory');
    await writeFile(filePath, '{}');
    unreadable = await artifactAdapter(filePath);
  }
  assert.equal(unreadable.status, 'abstain');
  assert.equal(unreadable.reason, 'artifacts_unavailable');
  assert.equal(unreadable.sources_checked[0].outcome, 'failed');
  assert.notEqual(unreadable.sources_checked[0].error, null);
  assert.notEqual(unreadable.sources_checked[0].outcome, 'artifacts_read');
});

test('a readable artifact directory with no matching files is an empty read', async () => {
  const emptyDir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-empty-'));
  const empty = await artifactAdapter(emptyDir);
  assert.equal(empty.status, 'empty');
  assert.equal(empty.reason, 'no_usable_members');
  assert.equal(empty.sources_checked[0].outcome, 'artifacts_read');
  assert.equal(empty.sources_checked[0].error, null);
  assert.equal(validateStoryDiscovery(empty).ok, true);

  const otherDir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-nomatch-'));
  await writeFile(join(otherDir, 'notes.txt'), 'not an artifact');
  const noMatch = await artifactAdapter(otherDir);
  assert.equal(noMatch.status, 'empty');
  assert.equal(noMatch.reason, 'no_usable_members');
  assert.equal(noMatch.sources_checked[0].outcome, 'artifacts_read');
  assert.equal(noMatch.sources_checked[0].error, null);
  assert.equal(noMatch.clusters.length, 0);
});

function datedHit(outlet, url, relation = 'surfaced') {
  return {
    title: 'Fare vote',
    url,
    outlet,
    published_at: '2026-09-25T12:00:00.000Z',
    relation
  };
}

test('independence requires distinct outlets and fails closed otherwise', () => {
  const originUrls = (urls) => ({
    same_story_assessment: 'same_story',
    timestamp_evidence: urls.map((url) => ({ url_key: url, published_at: '2026-09-25T12:00:00.000Z' }))
  });
  const sameOutlet = mapHits(
    [
      datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-a'),
      datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-b', 'same_story')
    ],
    { origin: originUrls([
      'https://fictional-daily.example/articles/fare-a',
      'https://fictional-daily.example/articles/fare-b'
    ]) }
  );
  assert.equal(sameOutlet.clusters[0].independent_reporting.length, 0);

  const differentStory = mapHits(
    [
      datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-a'),
      datedHit('Second Outlet', 'https://second-outlet.example/news/fare-b', 'same_story')
    ],
    {
      origin: {
        ...originUrls([
          'https://fictional-daily.example/articles/fare-a',
          'https://second-outlet.example/news/fare-b'
        ]),
        same_story_assessment: 'different_story'
      }
    }
  );
  assert.equal(differentStory.clusters[0].independent_reporting.length, 0);
  assert.ok(differentStory.clusters[0].members.every((member) => member.independent_reporting === false));
  assert.ok(differentStory.clusters[0].members.every((member) => member.labeling_basis === 'newsjack_origin_uncertain'));

  const wirePair = mapHits(
    [
      datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-a'),
      datedHit('PR Newswire', 'https://www.prnewswire.com/news-releases/fare-b', 'syndicated')
    ],
    { origin: originUrls([
      'https://fictional-daily.example/articles/fare-a',
      'https://www.prnewswire.com/news-releases/fare-b'
    ]) }
  );
  assert.equal(wirePair.clusters[0].independent_reporting.length, 0);
  assert.equal(wirePair.clusters[0].members.find((member) => member.outlet === 'PR Newswire').relation, 'syndicated');

  const unknownOutlet = mapHits(
    [
      datedHit('unknown', 'https://fictional-daily.example/articles/fare-a'),
      datedHit('Second Outlet', 'https://second-outlet.example/news/fare-b', 'same_story'),
      { title: 'Fare vote', url: 'https://third-outlet.example/news/fare-c', published_at: '2026-09-25T12:00:00.000Z', relation: 'surfaced' }
    ],
    { origin: originUrls([
      'https://fictional-daily.example/articles/fare-a',
      'https://second-outlet.example/news/fare-b',
      'https://third-outlet.example/news/fare-c'
    ]) }
  );
  assert.equal(unknownOutlet.clusters[0].members.find((member) => member.outlet === 'unknown').independent_reporting, false);
  assert.equal(unknownOutlet.clusters[0].members.some((member) => member.canonical_url.includes('third-outlet')), false);
  assert.equal(unknownOutlet.clusters[0].independent_reporting.length, 0);

  const corroborated = mapHits(
    [
      datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-a'),
      datedHit('Second Outlet', 'https://second-outlet.example/news/fare-b', 'same_story')
    ],
    { origin: originUrls([
      'https://fictional-daily.example/articles/fare-a',
      'https://second-outlet.example/news/fare-b'
    ]) }
  );
  assert.equal(validateStoryDiscovery(corroborated).ok, true);
  assert.equal(corroborated.clusters[0].independent_reporting.length, 2);
  assert.ok(corroborated.clusters[0].members.every((member) => member.labeling_basis === INDEPENDENCE_BASIS));
});

const ORIGIN_AT = '2026-09-25T12:00:00.000Z';
function sameStoryOrigin(urls) {
  return {
    same_story_assessment: 'same_story',
    timestamp_evidence: urls.map((url) => ({ url_key: url, published_at: ORIGIN_AT }))
  };
}

test('different_story members are counted and listed on the check row, not dropped silently', () => {
  const document = mapHits([
    datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-a'),
    datedHit('Unrelated Gazette', 'https://unrelated-gazette.example/news/other', 'different_story'),
    datedHit('Other Times', 'https://other-times.example/news/other-2', 'different_story'),
    { title: 'No outlet', url: 'https://third-outlet.example/news/x', relation: 'surfaced' }
  ]);
  const row = document.sources_checked[0];
  assert.equal(row.rejected_different_story, 2);
  assert.equal(row.rejected_incomplete, 1);
  assert.equal(row.rejected_total, 3);
  assert.deepEqual(
    row.rejected_members.filter((item) => item.reason === 'different_story').map((item) => item.outlet),
    ['Unrelated Gazette', 'Other Times']
  );
  assert.equal(document.clusters[0].members.length, 1);
  assert.ok(!JSON.stringify(row.rejected_members).includes('https://'), 'diagnostics list no URLs');
  assert.equal(validateStoryDiscovery(document).ok, true);
});

test('metadata-style and private or reserved addresses never become canonical source links', () => {
  const unsafe = [
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://instance-data.ec2.internal/latest/',
    'https://metadata/computeMetadata',
    'https://10.0.0.5/story',
    'https://192.168.1.10/story',
    'https://[fd00::1]/story',
    'https://[::ffff:127.0.0.1]/story',
    'https://0x7f.0.0.1/story',
    'https://localhost/story',
    'https://printer.home.arpa/story',
    'https://newsroom.corp/story',
    'https://staging.test/story',
    'javascript:alert(1)',
    'data:text/html,hi'
  ];
  for (const url of unsafe) {
    assert.equal(classifySourceUrl(url).url, null, url);
    assert.equal(classifySourceUrl(url).reason, 'non_public_url', url);
  }
  assert.equal(classifySourceUrl('http://fictional-daily.example/a').reason, 'non_https_url');
  assert.equal(classifySourceUrl('https://fictional-daily.example/a').url, 'https://fictional-daily.example/a');

  const hits = unsafe.map((url, index) => datedHit(`Outlet ${index}`, url));
  hits.push(datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-a'));
  hits.push(datedHit('Plain Http', 'http://plain-http.example/news/fare'));
  const document = mapHits(hits, { origin: sameStoryOrigin([...unsafe, 'https://fictional-daily.example/articles/fare-a']) });
  const serialized = JSON.stringify(document);
  for (const marker of ['169.254', 'metadata', '.internal', '10.0.0.5', '192.168', 'fd00', '::ffff', '0x7f', 'localhost', 'home.arpa', '.corp', '.test/', 'javascript:', 'data:text']) {
    assert.ok(!serialized.includes(marker), `document must not expose ${marker}`);
  }
  const row = document.sources_checked[0];
  assert.equal(row.rejected_non_public_url, unsafe.length);
  assert.equal(row.rejected_non_https_url, 1);
  assert.equal(document.clusters[0].members.length, 1);
  assert.equal(document.clusters[0].independent_reporting.length, 0);
  assert.equal(validateStoryDiscovery(document).ok, true);
});

test('only fixture search is implemented; host web search and RSS/Atom fail with NOT_IMPLEMENTED', async () => {
  assert.deepEqual([...IMPLEMENTED_SEARCH_PROVIDER_MODES], ['fixture']);
  assert.deepEqual([...PLANNED_SEARCH_PROVIDER_MODES].sort(), ['host_web_search', 'medialyst', 'rss_atom']);
  assert.equal(SEARCH_PROVIDER_MODE_STATUS.host_web_search, 'planned_not_implemented');
  assert.equal(SEARCH_PROVIDER_MODE_STATUS.rss_atom, 'planned_not_implemented');
  assert.equal(SEARCH_PROVIDER_NOT_IMPLEMENTED, 'NOT_IMPLEMENTED');
  assert.equal(MEDIALYST_NOT_IMPLEMENTED, 'NOT_IMPLEMENTED');

  const isNotImplemented = (mode) => (err) => err.code === 'NOT_IMPLEMENTED' && err.mode === mode;
  assert.throws(() => createHostWebSearchProvider(), isNotImplemented('host_web_search'));
  assert.throws(() => createRssAtomSearchProvider(), isNotImplemented('rss_atom'));
  assert.throws(() => createSearchProvider({ mode: 'host_web_search' }), isNotImplemented('host_web_search'));
  assert.throws(() => createSearchProvider({ mode: 'rss_atom' }), isNotImplemented('rss_atom'));
  assert.throws(() => createSearchProvider({ mode: 'bing' }), (err) => err.code === 'UNKNOWN_SEARCH_PROVIDER_MODE');
  const fixture = createSearchProvider({ mode: 'fixture', hits: [] });
  assert.equal(fixture.provider_mode, 'fixture');
  await assert.rejects(createSearchProvider({ mode: 'medialyst' }).search({}), isNotImplemented('medialyst'));

  for (const mode of ['host_web_search', 'rss_atom', 'medialyst']) {
    assert.throws(() => mapHits([], { providerMode: mode }), isNotImplemented(mode), mode);
  }
});

test('independent reporting counts distinct outlets; extra URLs from a counted outlet do not inflate it', () => {
  const urls = [
    'https://fictional-daily.example/articles/fare-a',
    'https://fictional-daily.example/articles/fare-a-update',
    'https://metro.fictional-daily.example/fare-a-metro',
    'https://second-outlet.example/news/fare-b'
  ];
  const document = mapHits(
    [
      datedHit('Fictional Daily', urls[0]),
      datedHit('Fictional Daily', urls[1], 'same_story'),
      datedHit('Fictional Daily Metro', urls[2], 'same_story'),
      datedHit('Second Outlet', urls[3], 'same_story')
    ],
    { origin: sameStoryOrigin(urls) }
  );
  const cluster = document.clusters[0];
  assert.equal(cluster.independent_reporting.length, 2);
  assert.equal(cluster.independent_outlet_count, 2);
  assert.deepEqual(cluster.independent_reporting.map((item) => item.outlet), ['Fictional Daily', 'Second Outlet']);
  for (const url of [urls[1], urls[2]]) {
    const member = cluster.members.find((item) => item.canonical_url === url);
    assert.equal(member.independent_reporting, false, url);
    assert.equal(member.relation, 'same_story', url);
    assert.equal(member.labeling_basis, SAME_OUTLET_ADDITIONAL_URL_BASIS, url);
  }
  assert.equal(validateStoryDiscovery(document).ok, true, validateStoryDiscovery(document).errors.join(','));

  const oneOutletTwoNames = mapHits(
    [datedHit('Fictional Daily', urls[0]), datedHit('Fictional Daily Metro', urls[2], 'same_story')],
    { origin: sameStoryOrigin([urls[0], urls[2]]) }
  );
  assert.equal(oneOutletTwoNames.clusters[0].independent_reporting.length, 0, 'one registrable domain is one outlet');

  const repeated = structuredClone(document);
  repeated.clusters[0].members[1].independent_reporting = true;
  repeated.clusters[0].members[1].relation = 'independent_reporting';
  repeated.clusters[0].independent_reporting.splice(1, 0, {
    outlet: 'Fictional Daily',
    canonical_url: urls[1],
    labeling_basis: INDEPENDENCE_BASIS
  });
  assert.ok(validateStoryDiscovery(repeated).errors.includes('independent_outlet_repeated'));
});

test('malformed or wrongly shaped artifact JSON fails closed with a clear error', async () => {
  const cases = [
    ['clustered_candidates.json', '{"clusters": [', 'artifact_json_invalid'],
    ['origin_findings.json', 'not json at all', 'artifact_json_invalid'],
    ['clustered_candidates.json', 'null', 'artifact_shape_invalid'],
    ['origin_findings.json', '[1, 2]', 'artifact_shape_invalid'],
    ['clustered_candidates.json', '{"clusters": [{"members": "not-an-array"}]}', 'artifact_shape_invalid'],
    ['clustered_candidates.json', '{"clusters": [42]}', 'artifact_shape_invalid']
  ];
  for (const [file, body, error] of cases) {
    const dir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-malformed-'));
    await writeFile(join(dir, file), body);
    const document = await artifactAdapter(dir);
    assert.equal(document.status, 'abstain', `${file}: ${body}`);
    assert.equal(document.reason, 'artifacts_invalid', `${file}: ${body}`);
    assert.equal(document.clusters.length, 0);
    assert.equal(document.sources_checked[0].outcome, 'failed');
    assert.equal(document.sources_checked[0].error, error, `${file}: ${body}`);
    assert.equal(document.sources_checked[0].error_file, file);
    assert.match(document.message, /could not be parsed/);
    assert.equal(validateStoryDiscovery(document).ok, true);
  }

  const junkMembersDir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-junk-members-'));
  await writeFile(join(junkMembersDir, 'clustered_candidates.json'), JSON.stringify({ clusters: [{ members: [null, 42, 'x', []] }] }));
  await writeFile(join(junkMembersDir, 'origin_findings.json'), JSON.stringify({ same_story_assessment: 'same_story', timestamp_evidence: 7 }));
  const junk = await artifactAdapter(junkMembersDir);
  assert.equal(junk.status, 'empty');
  assert.equal(junk.sources_checked[0].rejected_incomplete, 4);

  const fixtureDir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-bad-fixture-'));
  await writeFile(join(fixtureDir, 'broken.json'), '{"cluster": ');
  const fixture = await createNewsjackAdapter({ mode: 'fixture', fixtureId: 'broken', fixtureDir }).discoverStoryDocument({
    retrievedAt: RETRIEVED_AT,
    window: WINDOW
  });
  assert.equal(fixture.status, 'abstain');
  assert.equal(fixture.reason, 'artifacts_invalid');
  assert.equal(fixture.fixture_labeled, true);
  assert.equal(fixture.sources_checked[0].error, 'artifact_json_invalid');
});
