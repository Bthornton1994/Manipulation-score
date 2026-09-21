import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COVERAGE_FRAMES_EMPTY_COPY,
  buildAnalysisOverview,
  renderAnalysisOverview,
  renderClusterMember,
  renderCoverageFrames
} from '../media-lens/media-lens.js';

const FORBIDDEN_PUBLIC_COPY = /fusion currently|schema includes a frames list|the schema includes/i;
const SCORE_LANGUAGE = /\b(manipulative|credibility|accuracy|ranking|top_probability|probability)\b|0\s*[–-]\s*100|\bscore\b/i;

async function fixture(name) {
  return JSON.parse(await readFile(`media-lens/fixtures/expected/${name}.graph.json`, 'utf8'));
}

function stateFor(items, label) {
  const item = items.find((entry) => entry.label === label);
  assert.ok(item, `missing overview row for ${label}`);
  return item;
}

test('analysis overview sits after the masthead and before Language', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const masthead = html.indexOf('class="ml-result-masthead"');
  const overview = html.indexOf('id="ml-overview-heading"');
  const language = html.indexOf('id="ml-language-heading"');
  assert.ok(masthead >= 0 && overview > masthead && language > overview);
  assert.match(html, /<h2 id="ml-overview-heading">Analysis overview<\/h2>/);
  assert.match(html, /id="overview-list"/);
  assert.match(html, /not a score for the article, a person, or an outlet/);
});

test('overview states come only from influence-graph fields and do not add a score', async () => {
  const graph = await fixture('synthetic-01-quoted-vs-authorial');
  graph.observations[0].evidence.top_probability = 0.91;
  const items = buildAnalysisOverview(graph);
  const rendered = renderAnalysisOverview(graph);
  assert.deepEqual(
    items.map((item) => item.label),
    ['Language', 'Claims', 'Coverage', 'Source context']
  );
  assert.equal(stateFor(items, 'Language').state, 'Observed');
  assert.match(stateFor(items, 'Language').detail, /1 observed/);
  assert.match(stateFor(items, 'Language').detail, /2 possible/);
  assert.equal(stateFor(items, 'Claims').state, 'Not available');
  assert.match(stateFor(items, 'Claims').detail, /3 claims · support not checked/);
  assert.equal(stateFor(items, 'Coverage').state, 'Observed');
  assert.match(stateFor(items, 'Coverage').detail, /1 independent source/);
  assert.match(stateFor(items, 'Coverage').detail, /0 duplicate or syndicated/);
  assert.match(stateFor(items, 'Coverage').detail, /freshness stale/);
  assert.equal(stateFor(items, 'Source context').state, 'Observed');
  assert.match(stateFor(items, 'Source context').detail, /Metadata only · fictional-daily\.example/);
  assert.doesNotMatch(rendered, SCORE_LANGUAGE);
  assert.doesNotMatch(rendered, /0\.91/);
  assert.match(rendered, /href="#ml-language-heading"/);
  assert.match(rendered, /href="#ml-claims-heading"/);
  assert.match(rendered, /href="#ml-coverage-heading"/);
  assert.match(rendered, /href="#ml-source-context-heading"/);
});

test('candidate-only language is Possible and syndicated coverage counts stay numeric', async () => {
  const graph = await fixture('synthetic-02-syndicated-cluster');
  const items = buildAnalysisOverview(graph);
  assert.equal(stateFor(items, 'Language').state, 'Possible');
  assert.match(stateFor(items, 'Language').detail, /1 possible/);
  assert.equal(stateFor(items, 'Claims').state, 'Not available');
  assert.equal(stateFor(items, 'Coverage').state, 'Observed');
  assert.match(stateFor(items, 'Coverage').detail, /2 independent sources/);
  assert.match(stateFor(items, 'Coverage').detail, /3 duplicate or syndicated/);
  assert.match(stateFor(items, 'Coverage').detail, /freshness fresh/);
});

test('missing provenance and short excerpts use abstention reasons already on the graph', async () => {
  const missing = buildAnalysisOverview(await fixture('synthetic-03-no-timestamp'));
  assert.equal(stateFor(missing, 'Language').state, 'Not observed');
  assert.equal(stateFor(missing, 'Claims').state, 'Not observed');
  assert.equal(stateFor(missing, 'Coverage').state, 'Insufficient evidence');

  const shortGraph = await fixture('synthetic-06-short-excerpt');
  const short = buildAnalysisOverview(shortGraph);
  assert.equal(stateFor(short, 'Language').state, 'Insufficient evidence');
  assert.equal(stateFor(short, 'Claims').state, 'Insufficient evidence');
  assert.equal(stateFor(short, 'Coverage').state, 'Not available');
  assert.equal(stateFor(short, 'Source context').state, 'Observed');
});

test('coverage frames public copy does not describe schema or fusion internals', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  const rendered = renderCoverageFrames({ frames: [] });
  assert.equal(rendered, 'No coverage-frame comparison was available for this analysis.');
  assert.equal(rendered, COVERAGE_FRAMES_EMPTY_COPY);
  assert.equal(renderCoverageFrames({}), COVERAGE_FRAMES_EMPTY_COPY);
  assert.equal(renderCoverageFrames({ frames: null }), COVERAGE_FRAMES_EMPTY_COPY);
  assert.doesNotMatch(rendered, FORBIDDEN_PUBLIC_COPY);
  assert.doesNotMatch(html, FORBIDDEN_PUBLIC_COPY);
  assert.doesNotMatch(js, FORBIDDEN_PUBLIC_COPY);
  assert.doesNotMatch(js, /\bfusion\b/i);
  assert.equal(renderCoverageFrames({ frames: [{ id: 'frame-1' }] }), '1 coverage-frame record is included in this result.');
  assert.doesNotMatch(renderCoverageFrames({ frames: [{ schema: 'secret' }] }), /schema|fusion|secret/);
});

test('a valid HTTPS cluster member becomes a safe external link', () => {
  const html = renderClusterMember({
    url: 'https://second-outlet.example/news/transit-fare-increase',
    source: 'Second Outlet',
    relation: 'same_story'
  });
  assert.match(html, /<a class="ml-cluster-link"/);
  assert.match(html, /href="https:\/\/second-outlet\.example\/news\/transit-fare-increase"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, />Second Outlet</);
  assert.doesNotMatch(html, /transit-fare-increase</);
});

test('HTTP, javascript, data, malformed, and credential URLs never become anchors', () => {
  const cases = [
    { url: 'http://example.com/story', source: 'Example' },
    { url: 'javascript:alert(1)', source: 'Example' },
    { url: 'data:text/html,<script>alert(1)</script>', source: 'Example' },
    { url: 'not a url', source: 'Example' },
    { url: 'https://user:pass@example.com/secret', source: 'Example' },
    { url: 'https://user@example.com/story', source: 'Example' },
    { url: 'https://example.com/\nsecret', source: 'Example' }
  ];
  for (const member of cases) {
    const html = renderClusterMember({ ...member, relation: 'same_story' });
    assert.doesNotMatch(html, /<a\b/, member.url);
    assert.match(html, /Example/, member.url);
    assert.doesNotMatch(html, /user:pass|javascript:|data:text|http:\/\//i, member.url);
  }
});

test('malicious titles are escaped and non-URL labels stay plain text', () => {
  const hostile = renderClusterMember({
    url: 'https://example.com/story?q=1&x=2',
    source: '<img src=x onerror=alert(1)>',
    relation: '<script>alert(1)</script>'
  });
  assert.match(hostile, /<a class="ml-cluster-link"/);
  assert.match(hostile, /href="https:\/\/example\.com\/story\?q=1&amp;x=2"/);
  assert.match(hostile, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(hostile, /<img|<script>/);

  const plain = renderClusterMember({ source: 'Fictional Daily', relation: 'surfaced' });
  assert.doesNotMatch(plain, /<a\b/);
  assert.match(plain, /<strong>Fictional Daily<\/strong>/);

  const domain = '<svg onload=alert(1)>';
  const overview = renderAnalysisOverview({
    observations: [],
    claims: [],
    coverage: { status: 'not_requested' },
    source_context: { canonical_domain: domain, publisher: {}, metadata: {} },
    abstentions: []
  });
  assert.match(overview, /&lt;svg onload=alert\(1\)&gt;/);
  assert.doesNotMatch(overview, /<svg/);
});

test('cancelled consent is not stored as a retryable analysis payload', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  const openConsent = js.slice(js.indexOf('function requestConsentThenAnalyze'), js.indexOf('async function handleSubmit'));
  assert.match(openConsent, /pendingPayload = built\.payload/);
  assert.doesNotMatch(openConsent, /lastPayload\s*=/);
  assert.match(js, /consent-dialog'\)\.addEventListener\('close'/);
  assert.match(js, /pendingPayload = null/);
  const submit = js.slice(js.indexOf('async function handleSubmit'), js.indexOf('function setup()'));
  assert.match(submit, /pendingPayload \? \{ payload: pendingPayload \}/);
  assert.doesNotMatch(submit, /lastPayload \?/);
});

test('the fixture sample stays static and the local sample action is hidden until local preview', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(html, /id="sample-analyze"[^>]*hidden/);
  assert.match(html, /Static excerpt of the in-repo golden graph/);
  assert.match(js, /if \(sampleAnalyze\) sampleAnalyze\.hidden = false/);
  assert.match(js, /fixtureRadio\.checked = true/);
  assert.doesNotMatch(js, /sample-analyze[\s\S]{0,240}value = 'url'|sample-analyze[\s\S]{0,240}mode = 'url'/);
});
