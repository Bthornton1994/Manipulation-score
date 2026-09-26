import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNewsjackAdapter } from '../media-lens/worker/adapters/newsjack.js';
import {
  mapNewsjackEvidenceToStoryDiscovery,
  classifySourceUrl,
  NON_PUBLIC_HOST_SUFFIXES,
  sanitizeWindow,
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

function independentOutlets(document) {
  return document.clusters[0].independent_reporting.map((item) => item.outlet);
}

test('the two-outlet rule counts only members that are shown and can be labeled independent', () => {
  const A = 'https://fictional-daily.example/articles/fare-a';
  const B = 'https://second-outlet.example/news/fare-b';
  const origin = sameStoryOrigin([A, B]);
  const variants = {
    'second outlet has no title': { url: B, outlet: 'Second Outlet', published_at: ORIGIN_AT, relation: 'surfaced' },
    'second outlet has an unknown relation': { ...datedHit('Second Outlet', B), relation: 'related' },
    'second outlet has an empty outlet and a source': { ...datedHit('', B), source: 'Second Outlet' }
  };
  for (const [label, second] of Object.entries(variants)) {
    const document = mapHits([datedHit('Fictional Daily', A), second], { origin });
    const cluster = document.clusters[0];
    assert.equal(cluster.independent_reporting.length, 0, label);
    assert.equal(cluster.independent_outlet_count, 0, label);
    assert.ok(cluster.members.every((member) => member.independent_reporting === false), label);
    assert.equal(validateStoryDiscovery(document).ok, true, label);
  }
});

test('outlet identity is transitive across names, name spellings, domains, and stated source ids', () => {
  const urls = {
    a: 'https://fictional-daily.example/articles/fare-a',
    b: 'https://fd-metro.example/fare-b',
    c: 'https://fd-metro.example/fare-c',
    d: 'https://second-outlet.example/news/fare-d',
    e: 'https://other-host.example/fare-e',
    f: 'https://third-host.example/fare-f'
  };
  const chain = mapHits(
    [
      datedHit('Fictional Daily', urls.a),
      datedHit('Fictional Daily', urls.b, 'same_story'),
      datedHit('Fictional Daily Metro Desk', urls.c, 'same_story')
    ],
    { origin: sameStoryOrigin([urls.a, urls.b, urls.c]) }
  );
  assert.equal(chain.clusters[0].independent_reporting.length, 0, 'one outlet on two domains is still one outlet');

  const withSecond = mapHits(
    [
      datedHit('Fictional Daily', urls.a),
      datedHit('Fictional Daily', urls.b, 'same_story'),
      datedHit('Fictional Daily Metro Desk', urls.c, 'same_story'),
      datedHit('Second Outlet', urls.d, 'same_story')
    ],
    { origin: sameStoryOrigin([urls.a, urls.b, urls.c, urls.d]) }
  );
  assert.deepEqual(independentOutlets(withSecond), ['Fictional Daily', 'Second Outlet']);
  assert.equal(withSecond.clusters[0].independent_outlet_count, 2);
  assert.equal(validateStoryDiscovery(withSecond).ok, true);

  const sameName = mapHits(
    [datedHit('Fictional Daily', urls.a), datedHit('Fictional  daily', urls.e, 'same_story')],
    { origin: sameStoryOrigin([urls.a, urls.e]) }
  );
  assert.equal(sameName.clusters[0].independent_reporting.length, 0, 'same normalized name on another domain');

  const spelling = mapHits(
    [datedHit('BBC News', urls.e), datedHit('BBC​News', urls.f, 'same_story')],
    { origin: sameStoryOrigin([urls.e, urls.f]) }
  );
  assert.equal(spelling.clusters[0].independent_reporting.length, 0, 'name spellings with the same slug');

  const statedId = mapHits(
    [
      { ...datedHit('Harbor Times', urls.e), source_id: 'approved:harbor-times' },
      { ...datedHit('The Harbor Times Online', urls.f, 'same_story'), source_id: 'approved:harbor-times' }
    ],
    { origin: sameStoryOrigin([urls.e, urls.f]) }
  );
  assert.equal(statedId.clusters[0].independent_reporting.length, 0, 'same stated source_id');
});

test('a different_story assessment wins over wire, partner, and repeated-URL rules', () => {
  const document = mapHits([
    datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-a'),
    datedHit('PR Newswire', 'https://www.prnewswire.com/news-releases/unrelated', 'different_story'),
    datedHit('Fictional Daily', 'https://fictional-daily.example/articles/fare-a', 'different_story')
  ]);
  const row = document.sources_checked[0];
  assert.equal(row.rejected_different_story, 2);
  assert.equal(document.clusters[0].members.length, 1);
  assert.ok(document.clusters[0].members.every((member) => member.relation !== 'syndicated'));
});

test('every listed non-public suffix is refused, with wildcard private DNS names', () => {
  for (const suffix of NON_PUBLIC_HOST_SUFFIXES) {
    const url = `https://host${suffix}/story`;
    assert.equal(classifySourceUrl(url).reason, 'non_public_url', url);
  }
  for (const url of ['https://169.254.169.254.nip.io/', 'https://127.0.0.1.sslip.io/', 'https://app.localtest.me/', 'https://kubernetes.default.svc/x', 'https://router.home/', 'https://foo.alt/']) {
    assert.equal(classifySourceUrl(url).reason, 'non_public_url', url);
  }
});

test('the validator rejects an independent count that disagrees with the rows', () => {
  const urls = ['https://fictional-daily.example/articles/fare-a', 'https://second-outlet.example/news/fare-b'];
  const document = mapHits(
    [datedHit('Fictional Daily', urls[0]), datedHit('Second Outlet', urls[1], 'same_story')],
    { origin: sameStoryOrigin(urls) }
  );
  const tampered = structuredClone(document);
  tampered.clusters[0].independent_outlet_count = 3;
  assert.ok(validateStoryDiscovery(tampered).errors.includes('independent_outlet_count'));
});

test('labels, windows, source ids, and outlet names cannot smuggle other sources or URLs', async () => {
  assert.throws(() => mapHits([], { dataOrigin: 'rss_atom' }), (err) => err.code === 'INVALID_DISCOVERY_LABEL' && err.field === 'data_origin');
  assert.throws(() => mapHits([], { providerId: 'rss_atom:bbc' }), (err) => err.code === 'INVALID_DISCOVERY_LABEL' && err.field === 'provider_id');
  assert.throws(() => mapHits([], { freshnessGrade: 'live' }), (err) => err.code === 'INVALID_DISCOVERY_LABEL' && err.field === 'freshness_grade');
  assert.throws(() => mapHits([], { providerMode: ['fixture'] }), (err) => err.code === 'UNKNOWN_SEARCH_PROVIDER_MODE');

  assert.equal(sanitizeWindow({ start: 'https://169.254.169.254/', end: RETRIEVED_AT, hours: 24 }), null);
  assert.equal(sanitizeWindow({ ...WINDOW, hours: 1e400 }), null);
  assert.deepEqual(sanitizeWindow({ ...WINDOW, url: 'https://metadata.google.internal/' }), WINDOW);
  const badWindow = mapHits([datedHit('Fictional Daily', 'https://fictional-daily.example/a')], { window: { start: 'x', end: 'y', hours: 24 } });
  assert.equal(badWindow.reason, 'window_missing');

  const document = mapHits([
    { ...datedHit('Fictional Daily', 'https://fictional-daily.example/a'), source_id: 'http://169.254.169.254/latest/meta-data' },
    datedHit('https://metadata.google.internal/', 'https://second-outlet.example/b')
  ]);
  assert.equal(document.clusters[0].members[0].source_id, 'newsjack:fictional-daily');
  assert.equal(document.clusters[0].members.length, 1);
  assert.equal(document.sources_checked[0].rejected_incomplete, 1);
  assert.ok(!JSON.stringify(document).includes('169.254') && !JSON.stringify(document).includes('metadata.google'));

  const dir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-window-'));
  await writeFile(join(dir, 'clustered_candidates.json'), JSON.stringify({
    window: { start: 'bogus', end: 'bogus', hours: 24, extra: 'https://10.0.0.1/' },
    clusters: [{ members: [datedHit('Fictional Daily', 'https://fictional-daily.example/a')] }]
  }));
  const fromArtifact = await artifactAdapter(dir);
  assert.equal(fromArtifact.status, 'ok', 'an invalid artifact window falls back to the caller window');
  assert.deepEqual(fromArtifact.window, WINDOW);
});

test('non-array clusters and non-object cluster fields are invalid artifacts, and unnamed-group rejections point at the built cluster', async () => {
  for (const body of ['{"clusters": {"a": 1}}', '{"clusters": "x"}', '{"cluster": "x"}', '{"clusters": null}']) {
    const dir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-clusters-shape-'));
    await writeFile(join(dir, 'clustered_candidates.json'), body);
    const document = await artifactAdapter(dir);
    assert.equal(document.reason, 'artifacts_invalid', body);
    assert.equal(document.sources_checked[0].error, 'artifact_shape_invalid', body);
  }
  const document = mapHits([
    datedHit('Fictional Daily', 'https://fictional-daily.example/a'),
    datedHit('Unrelated Gazette', 'https://unrelated-gazette.example/x', 'different_story')
  ]);
  const rejection = document.sources_checked[0].rejected_members[0];
  assert.equal(rejection.cluster_id, document.clusters[0].cluster_id);
  assert.equal(rejection.group_index, 0);
});

test('shared wire and aggregator hosts do not merge distinct outlets, and an outlet path marker does not unmerge one', () => {
  const A = 'https://alpha-post.example/fare-a';
  const B = 'https://beta-herald.example/fare-b';
  const origin = sameStoryOrigin([A, B]);
  const viaAggregator = mapHits(
    [
      datedHit('Alpha Post', A),
      datedHit('Beta Herald', B, 'same_story'),
      datedHit('Alpha Post', 'https://news.yahoo.com/alpha-fare', 'syndicated'),
      datedHit('Beta Herald', 'https://news.yahoo.com/beta-fare', 'syndicated'),
      datedHit('Alpha Post', 'https://www.prnewswire.com/news-releases/alpha', 'syndicated'),
      datedHit('Beta Herald', 'https://www.prnewswire.com/news-releases/beta', 'syndicated')
    ],
    { origin }
  );
  assert.deepEqual(independentOutlets(viaAggregator), ['Alpha Post', 'Beta Herald']);

  const ownSite = mapHits(
    [
      datedHit('Alpha Post', A),
      datedHit('Beta Herald', B, 'same_story'),
      datedHit('Alpha Post', 'https://beta-herald.example/statement/alpha-column', 'syndicated')
    ],
    { origin }
  );
  assert.equal(ownSite.clusters[0].independent_reporting.length, 0, 'an Alpha Post record on the Beta Herald site ties them together');
});

const A_URL = 'https://alpha-post.example/fare-a';
const B_URL = 'https://beta-herald.example/fare-b';

test('placeholder-shaped outlet names do not grant independence beside one real outlet', () => {
  const origin = sameStoryOrigin([A_URL, B_URL]);
  const shaped = ['ＵＮＫＮＯＷＮ', '<unknown>', 'N.A.', 'n.a', 'not-available', 'n / a'];
  const exact = ['(unknown)', 'unknown.', 'n/a', 'N/A', 'none', 'unknown', 'UNKNOWN'];
  for (const name of [...shaped, ...exact]) {
    const document = mapHits([datedHit('Alpha Post', A_URL), datedHit(name, B_URL, 'same_story')], { origin });
    assert.equal(document.clusters[0].independent_outlet_count, 0, name);
    assert.equal(document.clusters[0].members.some((member) => member.outlet === name && member.independent_reporting), false, name);
  }
  const real = mapHits([datedHit('Alpha Post', A_URL), datedHit('Beta Herald', B_URL, 'same_story')], { origin });
  assert.equal(real.clusters[0].independent_outlet_count, 2);
});

test('placeholder, invisible, and punctuation-only outlet names never supply an independent outlet', () => {
  const origin = sameStoryOrigin([A_URL, B_URL]);
  for (const name of ['n/a', 'N/A', 'Unknown.', '(unknown)', 'Unknown source', 'undefined', 'None']) {
    const document = mapHits([datedHit('Alpha Post', A_URL), datedHit(name, B_URL, 'same_story')], { origin });
    assert.equal(document.clusters[0].independent_outlet_count, 0, name);
    assert.equal(document.clusters[0].members.length, 2, `${name} is shown as given`);
  }
  for (const name of ['​', '​‍', '—', '?', ' - ']) {
    const document = mapHits([datedHit('Alpha Post', A_URL), datedHit(name, B_URL, 'same_story')], { origin });
    assert.equal(document.clusters[0].independent_outlet_count, 0, JSON.stringify(name));
    assert.equal(document.sources_checked[0].rejected_incomplete, 1, JSON.stringify(name));
  }
  const shown = mapHits([datedHit('\u200bAlpha\u200d Post\u2060', A_URL)]);
  assert.equal(shown.clusters[0].members[0].outlet, 'Alpha Post', 'invisible characters are removed from the shown name');
  // Two placeholder records on two outlets' sites do not merge those outlets.
  const separate = mapHits(
    [
      datedHit('Alpha Post', A_URL),
      datedHit('Beta Herald', B_URL, 'same_story'),
      datedHit('unknown', 'https://alpha-post.example/other', 'syndicated'),
      datedHit('Unknown', 'https://beta-herald.example/other', 'syndicated')
    ],
    { origin }
  );
  assert.deepEqual(independentOutlets(separate), ['Alpha Post', 'Beta Herald']);
});

test('independence needs a dated same-story origin URL for each outlet', () => {
  const hits = [datedHit('Alpha Post', A_URL), datedHit('Beta Herald', B_URL, 'same_story')];
  assert.deepEqual(independentOutlets(mapHits(hits, { origin: sameStoryOrigin([A_URL, B_URL]) })), ['Alpha Post', 'Beta Herald']);
  assert.equal(mapHits(hits).clusters[0].independent_outlet_count, 0, 'no origin');
  const undated = { same_story_assessment: 'same_story', timestamp_evidence: [A_URL, B_URL].map((url) => ({ url_key: url, published_at: null })) };
  assert.equal(mapHits(hits, { origin: undated }).clusters[0].independent_outlet_count, 0, 'undated evidence');
  assert.equal(mapHits(hits, { origin: sameStoryOrigin([A_URL]) }).clusters[0].independent_outlet_count, 0, 'one dated URL');
  const unclear = { ...sameStoryOrigin([A_URL, B_URL]), same_story_assessment: 'unclear' };
  assert.equal(mapHits(hits, { origin: unclear }).clusters[0].independent_outlet_count, 0, 'unclear assessment');
});

test('dropped records still link outlet identity, and conflicting duplicate URLs do not depend on order', () => {
  const urls = ['https://fictional-daily.example/a', 'https://fd-metro.example/b', 'https://fd-metro.example/c'];
  const linked = mapHits(
    [
      datedHit('Fictional Daily', urls[0]),
      datedHit('Fictional Daily', urls[1], 'different_story'),
      datedHit('FD Metro Desk', urls[2], 'same_story')
    ],
    { origin: sameStoryOrigin([urls[0], urls[2]]) }
  );
  assert.equal(linked.clusters[0].independent_outlet_count, 0, 'a dropped record ties the two names together');
  assert.equal(linked.sources_checked[0].rejected_different_story, 1);

  const origin = sameStoryOrigin([A_URL, B_URL]);
  const forward = [datedHit('Alpha Post', A_URL, 'syndicated'), datedHit('Alpha Post', A_URL), datedHit('Beta Herald', B_URL)];
  for (const hits of [forward, [...forward].reverse()]) {
    assert.equal(mapHits(hits, { origin }).clusters[0].independent_outlet_count, 0);
  }
  const withDifferent = [datedHit('Alpha Post', A_URL, 'different_story'), datedHit('Alpha Post', A_URL), datedHit('Beta Herald', B_URL)];
  for (const hits of [withDifferent, [...withDifferent].reverse()]) {
    assert.equal(mapHits(hits, { origin }).clusters[0].independent_outlet_count, 0);
  }
});

test('URL-like outlet, source_id, and cluster_id text is not kept', () => {
  for (const outlet of ['//169.254.169.254/latest/meta-data', 'http:169.254.169.254', 'https:metadata.google.internal', 'mailto:x@y.z', 'HTTPS://a.example']) {
    const document = mapHits([datedHit(outlet, A_URL)]);
    assert.equal(document.clusters.length, 0, outlet);
    assert.equal(document.sources_checked[0].rejected_incomplete, 1, outlet);
    assert.equal(document.sources_checked[0].rejected_members[0].outlet, null, outlet);
  }
  for (const sourceId of ['https:169.254.169.254', 'javascript:alert.call', 'data:x']) {
    const document = mapHits([{ ...datedHit('Alpha Post', A_URL), source_id: sourceId }]);
    assert.equal(document.clusters[0].members[0].source_id, 'newsjack:alpha-post', sourceId);
  }
  const document = mapHits(null, { clusters: [{ cluster_id: 'https://169.254.169.254/latest', members: [datedHit('Alpha Post', A_URL)] }] });
  assert.match(document.clusters[0].cluster_id, /^[0-9a-f]{16}$/);
  for (const clusterId of ['https:169.254.169.254', ' HTTPS:x', 'data:x', 'javascript:alert']) {
    const refused = mapHits(null, { clusters: [{ cluster_id: clusterId, members: [datedHit('Alpha Post', A_URL)] }] });
    assert.match(refused.clusters[0].cluster_id, /^[0-9a-f]{16}$/, clusterId);
  }
  const kept = mapHits(null, { clusters: [{ cluster_id: 'nj:cluster-7', members: [datedHit('Alpha Post', A_URL)] }] });
  assert.equal(kept.clusters[0].cluster_id, 'nj:cluster-7');
});

test('non-Latin and spacing variants of one outlet name are one outlet', () => {
  const urls = ['https://one.example/a', 'https://two.example/b'];
  const origin = sameStoryOrigin(urls);
  for (const [first, second] of [['新华社', '新华 社'], ['BBC News', 'BBC-News'], ['BBC News', 'ＢＢＣ News']]) {
    const document = mapHits([datedHit(first, urls[0]), datedHit(second, urls[1], 'same_story')], { origin });
    assert.equal(document.clusters[0].independent_outlet_count, 0, `${first} / ${second}`);
  }
});

test('impossible dates and inverted windows are refused, not rolled over', () => {
  const document = mapHits([{ ...datedHit('Alpha Post', A_URL), published_at: '2026-02-30T12:00:00Z' }]);
  assert.equal(document.clusters[0].members[0].published_at, null);
  assert.equal(sanitizeWindow({ start: RETRIEVED_AT, end: WINDOW.start, hours: 24 }), null);
  assert.equal(sanitizeWindow({ start: '2026-02-30T00:00:00Z', end: RETRIEVED_AT, hours: 24 }), null);
  assert.equal(mapHits([datedHit('Alpha Post', A_URL)], { window: { start: RETRIEVED_AT, end: WINDOW.start, hours: 24 } }).reason, 'window_missing');
  assert.equal(mapHits([datedHit('Alpha Post', A_URL)], { retrievedAt: '2026-09-31T00:00:00Z' }).reason, 'retrieved_at_missing');
});

test('provider ids are limited to the adapter\'s own values', () => {
  for (const providerId of ['newsjack:medialyst', 'fixture:host_web_search', 'newsjack:rss_atom', 'fixture:Newsjack']) {
    assert.throws(() => mapHits([], { providerId }), (err) => err.code === 'INVALID_DISCOVERY_LABEL' && err.field === 'provider_id', providerId);
  }
});

test('a disabled or unconfigured adapter reports not_live, not a fixture check', async () => {
  const disabled = await createNewsjackAdapter({ mode: 'disabled' }).discoverStoryDocument({ retrievedAt: RETRIEVED_AT, window: WINDOW });
  assert.equal(disabled.status, 'not_live');
  assert.equal(disabled.reason, 'discovery_disabled');
  assert.equal(disabled.sources_checked[0].outcome, 'not_checked');
  assert.equal(disabled.sources_checked[0].error, 'discovery_disabled');
  assert.match(disabled.message, /disabled\. Nothing was read or checked/);
  assert.equal(validateStoryDiscovery(disabled).ok, true);

  const unconfigured = await createNewsjackAdapter({ mode: 'fixture' }).discoverStoryDocument({ retrievedAt: RETRIEVED_AT, window: WINDOW });
  assert.equal(unconfigured.status, 'not_live');
  assert.equal(unconfigured.reason, 'fixture_not_configured');
  assert.equal(unconfigured.sources_checked[0].outcome, 'not_checked');
  assert.match(unconfigured.message, /No Newsjack fixture is configured/);
  assert.equal(validateStoryDiscovery(unconfigured).ok, true);

  const missing = await createNewsjackAdapter({ mode: 'fixture', fixtureId: 'absent', fixtureDir: await mkdtemp(join(tmpdir(), 'newsjack-discovery-nofix-')) })
    .discoverStoryDocument({ retrievedAt: RETRIEVED_AT, window: WINDOW });
  assert.equal(missing.reason, 'artifacts_unavailable');
  assert.match(missing.message, /^The Newsjack fixture file was not read\./);

  const empty = mapHits([]);
  assert.match(empty.message, /^No usable story members were present\. Dropped records were not filled in; the sources_checked row counts them by reason\./);
});

test('unrecognized artifact shapes and non-regular files are invalid, not empty reads', async () => {
  const member = datedHit('Alpha Post', A_URL);
  const bodies = [
    JSON.stringify([member]),
    JSON.stringify({ clusters: [], members: [member] }),
    JSON.stringify({ members: [], cluster: { members: [member] } }),
    JSON.stringify({ items: [member] }),
    JSON.stringify({ clusters: [{ items: [member] }] })
  ];
  for (const body of bodies) {
    const dir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-unrecognized-'));
    await writeFile(join(dir, 'clustered_candidates.json'), body);
    const document = await artifactAdapter(dir);
    assert.equal(document.reason, 'artifacts_invalid', body);
    assert.equal(document.sources_checked[0].error, 'artifact_shape_invalid', body);
  }

  const keylessFixture = await mkdtemp(join(tmpdir(), 'newsjack-discovery-keyless-fixture-'));
  await writeFile(join(keylessFixture, 'keyless.json'), JSON.stringify({ story_origin: sameStoryOrigin([A_URL]), hits: [member] }));
  const keyless = await createNewsjackAdapter({ mode: 'fixture', fixtureId: 'keyless', fixtureDir: keylessFixture }).discoverStoryDocument({ retrievedAt: RETRIEVED_AT, window: WINDOW });
  assert.equal(keyless.reason, 'artifacts_invalid');
  assert.equal(keyless.sources_checked[0].error, 'artifact_shape_invalid');

  const asDirectory = await mkdtemp(join(tmpdir(), 'newsjack-discovery-dirfile-'));
  await mkdir(join(asDirectory, 'cluster.json'));
  assert.equal((await artifactAdapter(asDirectory)).sources_checked[0].error, 'artifact_not_regular_file');

  const linked = await mkdtemp(join(tmpdir(), 'newsjack-discovery-symlink-'));
  await writeFile(join(linked, 'real.json'), JSON.stringify({ members: [member] }));
  await symlink(join(linked, 'real.json'), join(linked, 'cluster.json'));
  assert.equal((await artifactAdapter(linked)).sources_checked[0].error, 'artifact_not_regular_file');

  const large = await mkdtemp(join(tmpdir(), 'newsjack-discovery-large-'));
  await writeFile(join(large, 'cluster.json'), '{}');
  await truncate(join(large, 'cluster.json'), 10 * 1024 * 1024 + 1);
  assert.equal((await artifactAdapter(large)).sources_checked[0].error, 'artifact_too_large');

  const fifo = await mkdtemp(join(tmpdir(), 'newsjack-discovery-fifo-'));
  let made = false;
  try {
    execFileSync('mkfifo', [join(fifo, 'cluster.json')]);
    made = true;
  } catch {
    made = false;
  }
  if (made) assert.equal((await artifactAdapter(fifo)).sources_checked[0].error, 'artifact_not_regular_file');
});

test('getStoryContext applies the same artifact guards as discovery (no OOM / symlink / JSON crash)', async () => {
  const url = 'https://fictional-daily.example/a';
  const empty = { story_origin: null, freshness_gate: null, cluster: null, provenance: 'none' };

  const oversized = await mkdtemp(join(tmpdir(), 'newsjack-analyze-large-'));
  await writeFile(
    join(oversized, 'candidates.json'),
    JSON.stringify([{ url, story_origin: { origin_url: url }, pad: 'x'.repeat(11 * 1024 * 1024) }])
  );
  assert.deepEqual(
    await createNewsjackAdapter({ mode: 'artifacts', artifactsDir: oversized }).getStoryContext({ url }),
    empty
  );

  const linked = await mkdtemp(join(tmpdir(), 'newsjack-analyze-symlink-'));
  await writeFile(join(linked, 'secret.json'), JSON.stringify([{ url, story_origin: { origin_url: url, note: 'secret' } }]));
  await symlink(join(linked, 'secret.json'), join(linked, 'candidates.json'));
  assert.deepEqual(
    await createNewsjackAdapter({ mode: 'artifacts', artifactsDir: linked }).getStoryContext({ url }),
    empty
  );

  const badJson = await mkdtemp(join(tmpdir(), 'newsjack-analyze-badjson-'));
  await writeFile(join(badJson, 'candidates.json'), '{not-json');
  assert.deepEqual(
    await createNewsjackAdapter({ mode: 'artifacts', artifactsDir: badJson }).getStoryContext({ url }),
    empty
  );

  const badFixture = await mkdtemp(join(tmpdir(), 'newsjack-analyze-badfix-'));
  await writeFile(join(badFixture, 'broken.json'), '{not-json');
  assert.deepEqual(
    await createNewsjackAdapter({ mode: 'fixture', fixtureId: 'broken', fixtureDir: badFixture }).getStoryContext({ url }),
    empty
  );

  const ok = await mkdtemp(join(tmpdir(), 'newsjack-analyze-ok-'));
  await writeFile(
    join(ok, 'candidates.json'),
    JSON.stringify([{ url, story_origin: { origin_url: url }, freshness_gate: { ok: true } }])
  );
  const ctx = await createNewsjackAdapter({ mode: 'artifacts', artifactsDir: ok }).getStoryContext({ url });
  assert.equal(ctx.provenance, 'newsjack_artifacts');
  assert.equal(ctx.story_origin.origin_url, url);
});

test('the mapper refuses malformed evidence shapes from direct callers', () => {
  for (const extra of [{ clusters: { a: 1 } }, { clusters: [{ members: 'x' }] }, { clusters: [42] }, { clusters: [{}] }]) {
    const document = mapHits([datedHit('Alpha Post', A_URL)], extra);
    assert.equal(document.status, 'abstain', JSON.stringify(extra));
    assert.equal(document.reason, 'artifacts_invalid', JSON.stringify(extra));
    assert.equal(document.sources_checked[0].error, 'evidence_shape_invalid', JSON.stringify(extra));
    assert.match(document.message, /did not have the expected shape/);
  }
  assert.equal(mapHits('x').reason, 'artifacts_invalid');
});

test('rejected_members is capped while counters keep every drop, and article_title is accepted', () => {
  const drops = Array.from({ length: 250 }, (_, index) => ({ outlet: `Outlet ${index}`, url: `https://o${index}.example/x` }));
  const document = mapHits(drops);
  const row = document.sources_checked[0];
  assert.equal(row.rejected_incomplete, 250);
  assert.equal(row.rejected_total, 250);
  assert.equal(row.rejected_members.length, 200);

  const titled = mapHits([{ article_title: 'Fare vote', url: A_URL, outlet: 'Alpha Post' }]);
  assert.equal(titled.clusters[0].members[0].article_title, 'Fare vote');
});

test('every non-public suffix has an explicit refused example', () => {
  const examples = [
    'https://instance-data.ec2.internal/', 'https://1.0.0.127.in-addr.arpa/', 'https://printer.home.arpa/', 'https://box.localdomain/',
    'https://nas.lan/', 'https://wiki.intranet/', 'https://mail.corp/', 'https://db.private/', 'https://router.home/',
    'https://kubernetes.default.svc/', 'https://x.alt/', 'https://site.test/', 'https://site.invalid/', 'https://abc.onion/',
    'https://vault.service.consul/', 'https://kubernetes.default/', 'https://169.254.169.254.nip.io/', 'https://127.0.0.1.sslip.io/',
    'https://10.0.0.1.xip.io/', 'https://app.localtest.me/', 'https://app.lvh.me/', 'https://10.0.0.1.traefik.me/',
    'https://x.backname.io/', 'https://x.1u.ms/', 'https://x.rbndr.us/', 'https://x.vcap.me/', 'https://x.local.gd/',
    'https://x.localhost.direct/', 'https://metadata.tencentyun.com/latest/meta-data/'
  ];
  for (const url of examples) assert.equal(classifySourceUrl(url).reason, 'non_public_url', url);
  const covered = (suffix) => examples.some((url) => {
    const host = new URL(url).hostname;
    return host === suffix.slice(1) || host.endsWith(suffix);
  });
  assert.deepEqual(NON_PUBLIC_HOST_SUFFIXES.filter((suffix) => !covered(suffix)), []);
  assert.equal(classifySourceUrl('https://fictional-daily.example/a').reason, null);
});

test('an invalid fixture-file window falls back to the caller window', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'newsjack-discovery-fixture-window-'));
  await writeFile(join(fixtureDir, 'win.json'), JSON.stringify({ window: { start: 'x', end: 'y', hours: 24, url: 'https://10.0.0.1/' }, members: [datedHit('Alpha Post', A_URL)] }));
  const document = await createNewsjackAdapter({ mode: 'fixture', fixtureId: 'win', fixtureDir }).discoverStoryDocument({ retrievedAt: RETRIEVED_AT, window: WINDOW });
  assert.equal(document.status, 'ok');
  assert.deepEqual(document.window, WINDOW);
});

test('outlet identity joins chains deeper than one link', () => {
  const urls = {
    alpha: 'https://alpha-post.example/a',
    beta: 'https://beta-herald.example/b',
    gamma: 'https://gamma-news.example/c',
    delta: 'https://delta-daily.example/d'
  };
  const origin = sameStoryOrigin(Object.values(urls));
  // Alpha and Beta are joined only through the gamma domain. This order puts
  // the Beta candidate two links from the group root, so a lookup that
  // follows only one link would count Beta as a second outlet.
  const chain = [
    datedHit('Alpha Post', urls.alpha),
    datedHit('Beta Herald', 'https://gamma-news.example/c2', 'syndicated'),
    datedHit('Beta Herald', urls.beta, 'same_story'),
    datedHit('Alpha Post', 'https://gamma-news.example/c3', 'syndicated')
  ];
  for (const hits of [chain, [...chain].reverse()]) {
    assert.equal(mapHits(hits, { origin }).clusters[0].independent_outlet_count, 0);
  }
  // A four-hop chain through name, domain, and source_id.
  const long = mapHits(
    [
      datedHit('Alpha Post', urls.alpha),
      { ...datedHit('Alpha Post', 'https://mirror-one.example/x', 'syndicated'), source_id: 'approved:mirror' },
      { ...datedHit('Mirror Desk', 'https://mirror-two.example/y', 'syndicated'), source_id: 'approved:mirror' },
      datedHit('Mirror Desk', 'https://delta-daily.example/z', 'syndicated'),
      datedHit('Delta Daily', urls.delta, 'same_story')
    ],
    { origin }
  );
  assert.equal(long.clusters[0].independent_outlet_count, 0);
});
