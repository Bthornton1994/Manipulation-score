import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import {
  ALTERNATIVE_READINGS_EMPTY,
  FIXTURE_LANES,
  FIXTURE_STORIES,
  OMISSION_EMPTY_COPY,
  activateFixtureLane,
  compareStatusCopy,
  filterFixtureStories,
  fixtureGraphUrl,
  membersForCompare,
  renderCoverageCountIndicator,
  renderCoverageDistribution,
  renderCoverageGap,
  renderInfluenceProfile,
  renderOmissionCandidates,
  storiesForLane
} from '../media-lens/media-lens.js';

const BIAS_METER = /bias meter|left-leaning|right-leaning|center-leaning|factuality rating|ownership rating|Ground News|blindspot|leaderboard/i;
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
  assert.match(html, /id="fixture-lanes"/);
  assert.match(html, /a lane does not follow live coverage/);
  assert.match(html, /aria-label="Compare recorded sources"/);
  assert.match(html, /id="question-reading"/);
  assert.match(html, /does not send feedback/);
  assert.match(html, /id="result-updated"/);
  const limitations = html.slice(html.indexOf('id="analysis-limitations"'), html.indexOf('id="engine-stats"'));
  assert.match(limitations, /id="question-reading-destination"/);
  assert.match(limitations, /does not send feedback/);
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
    const cluster = graph.coverage?.cluster;
    const hasMembers = Array.isArray(cluster?.members) && cluster.members.length > 0;
    if (!hasMembers) {
      assert.equal(story.coverageCount, null, story.id);
      assert.equal(story.lane, 'coverage-gap', story.id);
    } else {
      assert.deepEqual(
        story.coverageCount,
        {
          members: cluster.member_count,
          independent: cluster.independent_sources_estimate,
          syndicated: cluster.duplicate_or_syndicated_count,
          frames: graph.coverage.frames.length
        },
        story.id
      );
    }
  }
});

test('fixture lanes and coverage-count cards stay local and unlabeled by politics', () => {
  assert.deepEqual(
    FIXTURE_LANES.map((lane) => lane.id),
    ['all', 'quoted-language', 'syndicated-cluster', 'coverage-gap']
  );
  assert.deepEqual(
    storiesForLane('syndicated-cluster').map((story) => story.id),
    ['synthetic-02-syndicated-cluster']
  );
  assert.equal(storiesForLane('coverage-gap').length, 4);
  assert.equal(storiesForLane('all').length, FIXTURE_STORIES.length);
  const counted = renderCoverageCountIndicator(FIXTURE_STORIES[1].coverageCount);
  assert.match(counted, /Recorded coverage count: 5 cluster members/);
  assert.match(counted, /Independent-source estimate: 2/);
  assert.match(counted, /Syndicated or duplicate estimate: 3/);
  assert.match(counted, /not a list of outlets/i);
  assert.match(counted, /Fixture count only/);
  assert.match(counted, /No represented frames recorded/);
  const gap = renderCoverageCountIndicator(null);
  assert.match(gap, /Coverage gap in this fixture/);
  assert.match(gap, /not proof a fact was left out/);
  assert.doesNotMatch(`${counted} ${gap}`, BIAS_METER);
});

test('source comparison filters recorded relations and coverage gaps stay non-claims', async () => {
  const cluster = await golden('synthetic-02-syndicated-cluster');
  assert.equal(membersForCompare(cluster.coverage, 'syndicated').length, 2);
  assert.equal(membersForCompare(cluster.coverage, 'same_story').length, 2);
  assert.deepEqual(
    membersForCompare(cluster.coverage, 'independent').map((member) => member.source),
    ['Fictional Daily', 'Second Outlet']
  );
  assert.equal(
    membersForCompare(cluster.coverage, 'independent').some((member) => member.source === 'PR Newswire'),
    false
  );
  assert.equal(membersForCompare(cluster.coverage, 'frames').length, 0);
  assert.equal(membersForCompare(cluster.coverage, 'all').length, 5);
  const independentStatus = compareStatusCopy(cluster.coverage, 'independent', 2, 5);
  assert.match(independentStatus, /Independent-source estimate recorded separately: 2/);
  assert.match(independentStatus, /same-story relation alone is not independent reporting/);
  assert.doesNotMatch(independentStatus, /Surfaced and same-story/);
  assert.equal(renderCoverageGap(cluster.coverage), '');
  const missing = await golden('synthetic-03-no-timestamp');
  const gap = renderCoverageGap(missing.coverage);
  assert.match(gap, /Coverage gap/);
  assert.match(gap, /insufficient/);
  assert.match(gap, /not proof a fact was left out/);
  assert.doesNotMatch(gap, /proven omission|blindspot|left-leaning|right-leaning/i);
  const distribution = renderCoverageDistribution(cluster.coverage);
  assert.match(distribution, /Independent-source estimate: 2/);
  assert.match(distribution, /Syndicated or duplicate estimate: 3/);
  assert.match(distribution, /Represented frames recorded: 0/);
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

test('independent reporting lists recorded evidence and excludes wire copy', async () => {
  const cluster = await golden('synthetic-02-syndicated-cluster');
  assert.deepEqual(
    membersForCompare(cluster.coverage, 'independent').map((member) => member.source),
    ['Fictional Daily', 'Second Outlet']
  );
  const single = await golden('synthetic-01-quoted-vs-authorial');
  assert.deepEqual(
    membersForCompare(single.coverage, 'independent').map((member) => member.source),
    ['Fictional Daily']
  );

  const wireInEvidence = structuredClone(cluster.coverage);
  const wire = wireInEvidence.cluster.members.find((member) => member.source === 'PR Newswire');
  wireInEvidence.story_origin.evidence_urls.push(wire.url);
  wireInEvidence.story_origin.timestamp_evidence.push({ url_key: wire.url_key, published_at: wire.published_at });
  assert.deepEqual(
    membersForCompare(wireInEvidence, 'independent').map((member) => member.source),
    ['Fictional Daily', 'Second Outlet']
  );

  const sameStoryOnly = structuredClone(cluster.coverage);
  sameStoryOnly.cluster.members.push({
    url: 'https://fourth-outlet.example/news/transit-fare-increase',
    url_key: 'https://fourth-outlet.example/news/transit-fare-increase',
    source: 'Fourth Outlet',
    published_at: '2026-09-16T09:30:00.000Z',
    relation: 'same_story'
  });
  sameStoryOnly.cluster.independent_sources_estimate = sameStoryOnly.cluster.members.length;
  assert.deepEqual(
    membersForCompare(sameStoryOnly, 'independent').map((member) => member.source),
    ['Fictional Daily', 'Second Outlet']
  );

  const partner = structuredClone(cluster.coverage);
  const yahoo = 'https://www.yahoo.com/news/transit-fare-increase';
  partner.story_origin.evidence_urls.push(yahoo);
  partner.cluster.members.push({
    url: yahoo,
    url_key: yahoo,
    source: 'Yahoo News',
    published_at: '2026-09-16T09:16:00.000Z',
    relation: 'same_story'
  });
  assert.equal(
    membersForCompare(partner, 'independent').some((member) => member.source === 'Yahoo News'),
    false
  );

  const unnamed = structuredClone(cluster.coverage);
  unnamed.story_origin.evidence_urls = [];
  unnamed.story_origin.timestamp_evidence = [];
  unnamed.story_origin.canonical_coverage_url = null;
  unnamed.story_origin.canonical_coverage_basis = null;
  unnamed.cluster.independent_sources_estimate = 5;
  assert.deepEqual(membersForCompare(unnamed, 'independent'), []);
  assert.match(compareStatusCopy(unnamed, 'independent', 0, 5), /not inferred from the estimate/);
});

test('keyboard activation of a fixture lane restores focus to that lane button', () => {
  const nodes = new Map();
  function create(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      attrs: {},
      children: [],
      parentNode: null,
      className: '',
      textContent: '',
      type: '',
      id: '',
      value: '',
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      replaceChildren() {
        for (const child of this.children) child.parentNode = null;
        this.children = [];
      },
      contains(other) {
        let current = other;
        while (current) {
          if (current === this) return true;
          current = current.parentNode;
        }
        return false;
      },
      querySelectorAll() {
        return this.children.filter((child) => child.getAttribute('data-lane'));
      },
      focus() {
        document.activeElement = this;
      }
    };
  }
  const body = create('body');
  const host = create('div');
  host.id = 'fixture-lanes';
  nodes.set('fixture-lanes', host);
  body.appendChild(host);
  const query = create('input');
  query.id = 'story-query';
  nodes.set('story-query', query);
  const previous = globalThis.document;
  globalThis.document = {
    body,
    activeElement: body,
    createElement: create,
    getElementById(id) {
      return nodes.get(id) || null;
    },
    readyState: 'complete',
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  try {
    activateFixtureLane('all');
    const syndicated = host.children.find((button) => button.getAttribute('data-lane') === 'syndicated-cluster');
    syndicated.focus();
    assert.equal(document.activeElement, syndicated);
    // Enter on a focused button activates it. Re-rendering must not drop focus to body.
    activateFixtureLane(syndicated.getAttribute('data-lane'));
    assert.notEqual(document.activeElement, body);
    assert.notEqual(document.activeElement, syndicated);
    assert.equal(document.activeElement.getAttribute('data-lane'), 'syndicated-cluster');
    assert.equal(document.activeElement.getAttribute('aria-pressed'), 'true');
    assert.equal(syndicated.parentNode, null);
    const nextQuoted = host.children.find((button) => button.getAttribute('data-lane') === 'quoted-language');
    assert.equal(nextQuoted.getAttribute('aria-pressed'), 'false');

    query.focus();
    activateFixtureLane('coverage-gap');
    assert.equal(document.activeElement, query);
    activateFixtureLane('all');
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
