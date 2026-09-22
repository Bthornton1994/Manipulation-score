import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import {
  ALTERNATIVE_READINGS_EMPTY,
  FIXTURE_STORIES,
  OMISSION_EMPTY_COPY,
  filterFixtureStories,
  fixtureGraphUrl,
  renderCoverageDistribution,
  renderInfluenceProfile,
  renderOmissionCandidates
} from '../media-lens/media-lens.js';

const BIAS_METER = /bias meter|left-leaning|right-leaning|factuality rating|Ground News|leaderboard/i;
const EXTERNAL_DISCOVERY = /classifier\.dev|ml-jev|medialyst|news-search|api\.typesafe\.ai|\/v1\/cluster/i;

async function golden(id) {
  return JSON.parse(await readFile(`media-lens/fixtures/expected/${id}.graph.json`, 'utf8'));
}

test('home is a media-intelligence workspace with separate story search and URL entry', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /media-intelligence workspace/i);
  assert.match(html, /id="story-explore-heading"/);
  assert.match(html, /id="url-entry-heading"/);
  assert.match(html, /id="story-query"/);
  assert.match(html, /<label class="ml-field-label" for="story-query">/);
  assert.match(html, /does not discover live coverage/);
  assert.match(html, /Sample coverage only/);
  assert.match(html, /Clarity does not use this workspace/);
  assert.match(html, /id="retrieval-panel"/);
  assert.match(html, /Story origin and canonical source/);
  assert.match(html, /Related sources/);
  assert.match(html, /Independent reporting and syndicated repetition/);
  assert.match(html, /Coverage distribution and represented frames/);
  assert.match(html, /Coverage gaps and omission candidates/);
  assert.match(html, /does not establish that a fact was concealed/);
  assert.doesNotMatch(html, /proven omission/i);
  assert.match(html, /Claim ledger/);
  assert.match(html, /id="influence-profile"/);
  assert.match(html, /Structured summary of observable evidence/);
  assert.match(html, /id="alternative-readings"/);
  assert.match(html, /id="story-search-form"/);
  assert.doesNotMatch(html, BIAS_METER);
  const storyForm = html.slice(html.indexOf('id="story-search-form"'), html.indexOf('id="analyze-form"'));
  assert.doesNotMatch(storyForm, /name="url"/);
});

test('fixture catalog matches golden titles and domains and does not invent extra stories', async () => {
  const files = (await readdir('media-lens/fixtures/expected')).filter((name) => name.endsWith('.graph.json')).sort();
  assert.deepEqual(
    FIXTURE_STORIES.map((story) => story.id).sort(),
    files.map((name) => name.replace(/\.graph\.json$/, '')).sort()
  );
  for (const story of FIXTURE_STORIES) {
    const graph = await golden(story.id);
    assert.equal(story.title, graph.artifact.title, story.id);
    assert.equal(story.domain, graph.artifact.publisher.domain, story.id);
    assert.equal(story.byline || null, graph.artifact.byline, story.id);
    assert.match(story.fixtureNote, /^Fixture example\./);
    assert.equal(fixtureGraphUrl(story.id), `./fixtures/expected/${story.id}.graph.json`);
  }
});

test('topic search filters fixture stories locally and rejects paths outside the catalog', () => {
  assert.equal(filterFixtureStories('').length, FIXTURE_STORIES.length);
  assert.deepEqual(
    filterFixtureStories('transit').map((story) => story.id),
    ['synthetic-02-syndicated-cluster']
  );
  assert.deepEqual(
    filterFixtureStories('PAYWALL').map((story) => story.id),
    ['synthetic-05-paywall']
  );
  assert.deepEqual(filterFixtureStories('no-such-live-story'), []);
  assert.equal(fixtureGraphUrl('../worker/config.js'), null);
  assert.equal(fixtureGraphUrl('synthetic-02-syndicated-cluster/../../package.json'), null);
  assert.equal(fixtureGraphUrl('https://example.com/story'), null);
  assert.equal(fixtureGraphUrl('synthetic-99-not-a-story'), null);
});

test('fixture open does not request TypeSafe, classifier.dev, ml-jev, or a cluster API', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(js, /fetch\(url, \{ method: 'GET', credentials: 'same-origin'/);
  assert.match(js, /schema !== 'influence-graph\.v1'/);
  assert.doesNotMatch(js, EXTERNAL_DISCOVERY);
  assert.doesNotMatch(html, EXTERNAL_DISCOVERY);
  const searchFn = js.slice(js.indexOf('function filterFixtureStories'), js.indexOf('function fixtureGraphUrl'));
  assert.doesNotMatch(searchFn, /fetch\(/);
  const setup = js.slice(js.indexOf('function setupStoryExplorer'), js.indexOf('function goToLanding'));
  assert.doesNotMatch(setup, /\/analyze|WORKER_BASE_URL/);
});

test('workspace renderers use recorded fixture fields and keep empty states honest', async () => {
  const cluster = await golden('synthetic-02-syndicated-cluster');
  const distribution = renderCoverageDistribution(cluster.coverage);
  assert.match(distribution, /Fixture distribution of recorded cluster relations/);
  assert.match(distribution, /Not a live census and not a political bias chart/);
  assert.match(distribution, /Syndicated repetition/);
  assert.match(distribution, /Same story/);
  assert.doesNotMatch(distribution, BIAS_METER);
  assert.doesNotMatch(distribution, /\bscore\b/i);

  const missing = await golden('synthetic-03-no-timestamp');
  assert.match(renderCoverageDistribution(missing.coverage), /No coverage distribution was recorded/);
  assert.equal(renderOmissionCandidates(cluster), `<li class="ml-empty-state">${OMISSION_EMPTY_COPY}</li>`);
  assert.match(OMISSION_EMPTY_COPY, /not proof a fact was left out/);
  assert.doesNotMatch(OMISSION_EMPTY_COPY, /\bproves\b|\bproven omission\b/i);

  const profile = renderInfluenceProfile(cluster);
  assert.match(profile, /Language/);
  assert.match(profile, /Possible/);
  assert.match(profile, /Coverage/);
  assert.doesNotMatch(profile, /\bscore\b|0\s*[–-]\s*100|ranking|manipulative/i);
  assert.equal(ALTERNATIVE_READINGS_EMPTY, 'No alternative reading was recorded for this result.');
});

test('candidate omission observations stay possible and are not called observed facts', async () => {
  const graph = await golden('synthetic-01-quoted-vs-authorial');
  graph.observations.push({
    id: 'obs-gap-1',
    dimension: 'coverage',
    signal: 'selective_context_candidate',
    strength: 'candidate',
    localization: 'unlocalized',
    span_ids: [],
    authorial_attribution: 'unknown',
    evidence: { engine: 'rule', question_id: null, top_probability: null, answers_ref: null },
    review_status: 'needs_review',
    ui_phrase: 'Possible selective-context candidate'
  });
  const html = renderOmissionCandidates(graph);
  assert.match(html, /data-strength="candidate">Possible selective-context candidate</);
  assert.match(html, /Needs review/);
  assert.doesNotMatch(html, /Observed influence signal|proven omission|they hid/i);
});
