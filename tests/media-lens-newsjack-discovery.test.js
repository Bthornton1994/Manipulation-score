import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNewsjackAdapter } from '../media-lens/worker/adapters/newsjack.js';
import { mapNewsjackEvidenceToStoryDiscovery, CLUSTER_BASIS, INDEPENDENCE_BASIS } from '../media-lens/worker/discovery/newsjack-discovery.js';
import { createFixtureSearchProvider, createMedialystSearchProvider, MEDIALYST_NOT_IMPLEMENTED } from '../media-lens/worker/discovery/search-provider.js';
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
