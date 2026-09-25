import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import {
  ABSTENTION_EMPTY_COPY,
  COVERAGE_FRAMES_EMPTY_COPY,
  buildAnalysisOverview,
  consentDisclosure,
  liveUrlDisclosure,
  observationDisplayLabel,
  renderAbstentionList,
  renderAnalysisOverview,
  renderClusterMember,
  renderCoverageFrames,
  renderObservation,
  renderOmissionCandidates,
  renderUnattributedQuotes,
  safeHttpsUrl
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
  assert.match(html, /<h3 id="ml-overview-heading">Analysis overview<\/h3>/);
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
  // No cluster and no story origin: other coverage was not checked.
  assert.equal(stateFor(missing, 'Coverage').state, 'Abstained');
  assert.equal(stateFor(missing, 'Coverage').detail, 'Other coverage not checked');

  // synthetic-06 is an abstention-only graph: no analysis was run.
  const shortGraph = await fixture('synthetic-06-short-excerpt');
  const short = buildAnalysisOverview(shortGraph);
  assert.equal(stateFor(short, 'Language').state, 'Abstained');
  assert.equal(stateFor(short, 'Language').detail, 'No analysis was run');
  assert.equal(stateFor(short, 'Claims').state, 'Abstained');
  assert.equal(stateFor(short, 'Coverage').state, 'Abstained');
  assert.equal(stateFor(short, 'Source context').state, 'Observed');
  assert.match(stateFor(short, 'Source context').detail, /^From the recorded URL · fictional-daily\.example$/);

  const allowed = new Set(['Observed', 'Possible', 'Not observed', 'Insufficient evidence', 'Abstained', 'Not available']);
  for (const name of ['synthetic-01-quoted-vs-authorial', 'synthetic-02-syndicated-cluster', 'synthetic-03-no-timestamp', 'synthetic-04-injection', 'synthetic-05-paywall', 'synthetic-06-short-excerpt']) {
    for (const item of buildAnalysisOverview(await fixture(name))) assert.ok(allowed.has(item.state), `${name} ${item.label} ${item.state}`);
  }
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

test('static sample strength labels follow synthetic-01 strength, not a misleading phrase', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const graph = await fixture('synthetic-01-quoted-vs-authorial');
  const sampleStart = html.indexOf('<ul class="ml-sample-findings">');
  const sampleEnd = html.indexOf('</ul>', sampleStart);
  const sample = html.slice(sampleStart, sampleEnd);
  const items = [...sample.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)];
  assert.equal(items.length, graph.observations.length);
  for (const [, attrs, body] of items) {
    const id = attrs.match(/data-observation-id="([^"]+)"/)?.[1];
    const obs = graph.observations.find((entry) => entry.id === id);
    assert.ok(obs, `sample finding is not a graph observation: ${id}`);
    const strengthChip = body.match(/<span class="ml-chip" data-strength="([^"]+)">([^<]*)<\/span>/);
    assert.ok(strengthChip, `${id} is missing a strength chip`);
    assert.equal(strengthChip[1], obs.strength, id);
    assert.equal(strengthChip[2], observationDisplayLabel(obs), id);
    if (obs.strength === 'candidate') {
      assert.equal(strengthChip[2], 'Possible influence signal', id);
      assert.doesNotMatch(body, /Observed influence signal/, id);
    }
    if (obs.strength === 'observed') {
      assert.equal(strengthChip[2], obs.ui_phrase, id);
      assert.notEqual(strengthChip[2], 'Possible influence signal', id);
    }
    const strengths = [...body.matchAll(/data-strength="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(strengths, [obs.strength], id);
    if (obs.review_status === 'needs_review') {
      assert.match(body, /data-review="needs_review">Needs review</);
    } else {
      assert.doesNotMatch(body, /data-review=/);
    }
    const span = graph.spans.find((entry) => entry.id === obs.span_ids[0]);
    assert.match(body, new RegExp(span.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const signal = body.match(/class="ml-sample-signal">([^<]+)</)[1];
    if (obs.signal === 'urgency') {
      assert.equal(signal, `Urgency framing, quoted as ${span.attribution.speaker}`);
    } else if (obs.signal === 'certainty_beyond_evidence') {
      assert.equal(signal, 'Certainty beyond evidence');
    } else if (obs.signal === 'vague_authority') {
      assert.equal(signal, 'Vague authority');
    } else {
      assert.fail(`unexpected sample signal ${obs.signal}`);
    }
  }
  assert.equal(
    graph.observations.find((entry) => entry.id === 'obs-jev-2').strength,
    'candidate'
  );
  assert.match(
    html,
    new RegExp(`<dt>Independent sources</dt>\\s*<dd>${graph.coverage.cluster.independent_sources_estimate}</dd>`)
  );
  assert.match(
    html,
    new RegExp(`<dt>Duplicate or syndicated</dt>\\s*<dd>${graph.coverage.cluster.duplicate_or_syndicated_count}</dd>`)
  );
  assert.match(html, new RegExp(`<dt>Freshness</dt>\\s*<dd>${graph.coverage.freshness_gate.computed_status}</dd>`));
  assert.match(html, new RegExp(graph.coverage.freshness_gate.rationale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('candidate observations display Possible influence signal and stay candidates', async () => {
  const files = (await readdir('media-lens/fixtures/expected')).filter((name) => name.endsWith('.graph.json'));
  assert.ok(files.length >= 6);
  let candidateCount = 0;
  for (const file of files) {
    const graph = JSON.parse(await readFile(`media-lens/fixtures/expected/${file}`, 'utf8'));
    for (const obs of graph.observations) {
      const label = observationDisplayLabel(obs);
      const rendered = renderObservation(graph, obs);
      const chip = rendered.match(/<span class="ml-chip" data-strength="([^"]+)">([^<]*)<\/span>/);
      assert.ok(chip, `${file} ${obs.id}`);
      assert.equal(chip[1], obs.strength, `${file} ${obs.id}`);
      assert.equal(chip[2], label, `${file} ${obs.id}`);
      if (obs.strength === 'candidate') {
        candidateCount += 1;
        assert.notEqual(label, 'Observed influence signal', `${file} ${obs.id}`);
        assert.doesNotMatch(rendered, /Observed influence signal/, `${file} ${obs.id}`);
        if (obs.ui_phrase === 'Observed influence signal') {
          assert.equal(label, 'Possible influence signal', `${file} ${obs.id}`);
          assert.equal(obs.ui_phrase, 'Observed influence signal', `${file} ${obs.id}`);
        }
      }
      if (obs.strength === 'observed') {
        assert.equal(label, obs.ui_phrase, `${file} ${obs.id}`);
        assert.notEqual(label, 'Possible influence signal', `${file} ${obs.id}`);
      }
      if (obs.review_status === 'needs_review') {
        assert.match(rendered, /data-review="needs_review">Needs review</, `${file} ${obs.id}`);
      }
    }
  }
  assert.ok(candidateCount >= 4);

  const graph = await fixture('synthetic-01-quoted-vs-authorial');
  const jev2 = graph.observations.find((obs) => obs.id === 'obs-jev-2');
  const jev3 = graph.observations.find((obs) => obs.id === 'obs-jev-3');
  const jev1 = graph.observations.find((obs) => obs.id === 'obs-jev-1');
  assert.equal(jev2.strength, 'candidate');
  assert.equal(jev3.strength, 'candidate');
  assert.equal(jev2.ui_phrase, 'Observed influence signal');
  assert.equal(jev3.ui_phrase, 'Observed influence signal');
  assert.equal(observationDisplayLabel(jev2), 'Possible influence signal');
  assert.equal(observationDisplayLabel(jev3), 'Possible influence signal');
  assert.equal(jev3.review_status, 'needs_review');
  assert.match(renderObservation(graph, jev3), /data-review="needs_review">Needs review</);
  assert.equal(jev1.strength, 'observed');
  assert.equal(observationDisplayLabel(jev1), 'Quoted language not attributed as authorial');
  assert.equal(
    observationDisplayLabel({ strength: 'observed', ui_phrase: 'Observed influence signal' }),
    'Observed influence signal'
  );
  assert.equal(
    observationDisplayLabel({ strength: 'candidate', ui_phrase: 'Possible selective-context candidate' }),
    'Possible selective-context candidate'
  );
  assert.equal(
    observationDisplayLabel({ strength: 'candidate', ui_phrase: 'This source is unsafe' }),
    'Insufficient context'
  );
  assert.doesNotMatch(renderObservation(graph, jev2), /Observed influence signal/);
  assert.match(renderObservation(graph, jev2), /data-strength="candidate">Possible influence signal</);
});

test('missing coverage observations and abstentions use neutral accessible copy', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const graph = await fixture('synthetic-01-quoted-vs-authorial');
  assert.equal(graph.observations.filter((obs) => obs.dimension === 'coverage').length, 0);
  assert.equal(renderUnattributedQuotes(graph), '');
  assert.equal(renderCoverageFrames(graph.coverage), 'No coverage-frame comparison was available for this analysis.');
  const coverage = renderOmissionCandidates(graph);
  assert.doesNotMatch(coverage, SCORE_LANGUAGE);
  assert.doesNotMatch(coverage, FORBIDDEN_PUBLIC_COPY);
  // Coverage observations have one list: no separate coverage-list element.
  assert.doesNotMatch(html, /id="coverage-list"/);
  const notRun = html.match(/<p class="ml-coverage-status" id="coverage-not-run" hidden>([\s\S]*?)<\/p>/)[1].replace(/\s+/g, ' ').trim();
  assert.equal(
    notRun,
    'Coverage comparison was not run for this result. Media Lens does not yet have an approved source for finding other reports of this story, so this result says nothing about how other outlets covered it.'
  );
  assert.match(html, /<h4 id="ml-unattributed-heading">Quotes without a named speaker<\/h4>/);
  assert.match(html, /no named speaker or attribution in the page\. It is flagged as a possible selective-context\s+candidate\. No other coverage was compared, so this does not show that anything was left out\./);
  assert.match(html, /<h3 id="ml-abstention-heading">Analysis limitations<\/h3>/);
  assert.match(html, /aria-labelledby="ml-abstention-heading"/);
  const limitations = renderAbstentionList(graph);
  assert.match(limitations, /The typed classifier did not return a usable answer/);
  const empty = renderAbstentionList({ abstentions: [] });
  assert.equal(ABSTENTION_EMPTY_COPY, 'No abstentions were recorded for this analysis.');
  assert.match(empty, /No abstentions were recorded for this analysis\./);
  assert.doesNotMatch(`${coverage} ${empty} ${html.slice(html.indexOf('id="analysis-limitations"'), html.indexOf('id="engine-stats"'))}`, SCORE_LANGUAGE);
});

test('operator-hosted disclosure names the operator host and TypeSafe AI’s Jev service', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const operator = liveUrlDisclosure('operator');
  const local = liveUrlDisclosure('local');
  const fixturePreview = liveUrlDisclosure('fixture-preview');
  assert.match(operator, /approved operator host requests the public page/);
  assert.match(operator, /operator host\u2019s network address/);
  assert.match(operator, /TypeSafe AI\u2019s Jev service/);
  assert.doesNotMatch(operator, /this computer\u2019s network address/);
  assert.doesNotMatch(operator, /your computer/);
  assert.doesNotMatch(operator, /TypeSafe\u2019s Jev classifier/);
  assert.match(local, /the request may originate from your computer/);
  assert.match(local, /this computer\u2019s network address/);
  assert.doesNotMatch(local, /approved operator host requests/);
  assert.match(fixturePreview, /does not request the article URL/);
  assert.match(fixturePreview, /Neither your computer nor an operator host contacts the destination site/);
  assert.doesNotMatch(fixturePreview, /this computer\u2019s network address/);
  assert.doesNotMatch(fixturePreview, /will see the operator host/);
  for (const text of [operator, local, fixturePreview]) {
    assert.match(text, /TypeSafe AI\u2019s Jev service/);
    assert.match(text, /Full article text is not kept by Media Lens by default/);
    assert.match(text, /private messages/);
    assert.match(text, /information about children/);
    assert.match(text, /paywalled content/);
    assert.match(text, /non-public\/internal addresses/);
    assert.match(text, /Live pasted-text analysis stays disabled/);
    assert.doesNotMatch(text, /\b(accuracy|credibility|ranking)\b/i);
    assert.doesNotMatch(text, /TypeSafe\u2019s Jev classifier/);
  }
  assert.match(consentDisclosure('operator'), /approved operator host may request/);
  assert.match(consentDisclosure('operator'), /TypeSafe AI\u2019s Jev service/);
  assert.doesNotMatch(consentDisclosure('operator'), /this computer\u2019s network address/);
  assert.match(consentDisclosure('local'), /may originate from your computer/);
  assert.match(consentDisclosure('local'), /TypeSafe AI\u2019s Jev service/);
  assert.doesNotMatch(consentDisclosure('fixture-preview'), /this computer\u2019s network address/);
  assert.match(consentDisclosure('fixture-preview'), /does not request an article URL/);
  assert.match(operator, /TypeSafe does not fetch the URL/);
  assert.match(operator, /Live pasted-text analysis stays disabled/);
  assert.match(local, /TypeSafe does not fetch the URL/);
  assert.match(fixturePreview, /Live pasted-text analysis stays disabled/);
  assert.match(html, /TypeSafe AI\u2019s Jev service/);
  assert.doesNotMatch(html, /TypeSafe\u2019s Jev classifier/);
  assert.doesNotMatch(html, /this computer\u2019s network address/);
});

test('percent-encoded line breaks and tabs never become HTTPS links', () => {
  const rejected = [
    'https://example.com/%0A',
    'https://example.com/%0a',
    'https://example.com/%0D',
    'https://example.com/%0d',
    'https://example.com/%09',
    'https://example.com/path%0Asecret',
    'https://example.com/?next=%0d%0aSet-Cookie:%09x',
    'https://example.com/%250A',
    'https://example.com/%250d',
    'https://example.com/%2509'
  ];
  for (const url of rejected) {
    assert.equal(safeHttpsUrl(url), null, url);
    const html = renderClusterMember({ url, source: 'Example', relation: 'same_story' });
    assert.doesNotMatch(html, /<a\b/, url);
    assert.doesNotMatch(html, /%0a|%0d|%09/i, url);
    assert.match(html, /Example/, url);
  }
  const ordinary = renderClusterMember({
    url: 'https://example.com/ordinary/path?q=1&x=%2Fok',
    source: 'Example',
    relation: 'same_story'
  });
  assert.match(ordinary, /<a class="ml-cluster-link"/);
  assert.match(ordinary, /href="https:\/\/example.com\/ordinary\/path\?q=1&amp;x=%2Fok"/);
  assert.ok(safeHttpsUrl('https://example.com/ordinary/path?q=hello'));
});

test('cancelled consent is not stored as a retryable analysis payload', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  const openConsent = js.slice(js.indexOf('function requestConsentThenAnalyze'), js.indexOf('async function handleSubmit'));
  assert.match(openConsent, /pendingPayload = built\.payload/);
  assert.doesNotMatch(openConsent, /lastPayload\s*=/);
  assert.match(js, /consent-dialog'\)\.addEventListener\('close'/);
  assert.match(js, /pendingPayload = null/);
  assert.match(js, /consentTrigger = document\.activeElement/);
  assert.match(js, /trigger\.focus\(\)/);
  const submit = js.slice(js.indexOf('async function handleSubmit'), js.indexOf('function setup()'));
  assert.match(submit, /pendingPayload \? \{ payload: pendingPayload \}/);
  assert.doesNotMatch(submit, /lastPayload \?/);
});

test('the fixture sample stays static and the local sample action is hidden until local preview', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(html, /id="sample-analyze" data-local-only hidden/);
  assert.match(html, /A fixed excerpt from a made-up test article that ships with this page/);
  const reveal = js.slice(js.indexOf('function revealCatalogControls'), js.indexOf('function setupInputModeToggle'));
  assert.match(reveal, /if \(!CATALOG_MODE\) return;/);
  assert.match(reveal, /querySelectorAll\('\[data-local-only\]'\)/);
  assert.match(js, /fixtureRadio\.checked = true/);
  assert.doesNotMatch(js, /sample-analyze[\s\S]{0,240}value = 'url'|sample-analyze[\s\S]{0,240}mode = 'url'/);
});
