// Live-host analysis journey: URL entry, consent, loading, errors, results,
// the no-analysis state, and returning to the start. Drives the real
// media-lens.js against the real index.html (tests/helpers/media-lens-dom.js)
// with graphs built by the worker's own code (tests/helpers/media-lens-graphs.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeEvent, loadMediaLensPage } from './helpers/media-lens-dom.js';
import { LIVE_ARTICLE_URL, UNATTRIBUTED_QUOTE, earlyExitGraphs, liveAbstentionGraph, liveUrlGraph } from './helpers/media-lens-graphs.js';
import {
  CANCELLED_MESSAGE,
  CREDENTIALS_URL_MESSAGE,
  NO_ANALYSIS_TITLE,
  buildAnalysisOverview,
  isNoAnalysisGraph,
  isRetryableApiError,
  renderUnattributedQuotes,
  stageForElapsed
} from '../media-lens/media-lens.js';

const LIVE_HREF = 'https://ml-jev.manipulationscore.com/media-lens/';
const ANALYZE_URL = 'https://ml-jev.manipulationscore.com/analyze';

function analyzeCalls(page) {
  return page.fetchCalls.filter((call) => call.url === ANALYZE_URL);
}

async function openConsentWithEnter(page, url = LIVE_ARTICLE_URL) {
  const input = page.byId('article-url');
  input.value = url;
  input.focus();
  const event = page.keydown(input, 'Enter');
  await page.flush();
  return event;
}

function overviewState(graph, label) {
  return buildAnalysisOverview(graph).find((item) => item.label === label);
}

test('Enter in the URL field opens the same consent step as Analyze, and nothing is sent before consent', async () => {
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(await liveUrlGraph()) });
  try {
    const event = await openConsentWithEnter(page);
    assert.equal(event.defaultPrevented, true);
    assert.equal(page.byId('consent-dialog').open, true);
    assert.equal(page.document.activeElement, page.byId('consent-checkbox'));
    assert.deepEqual(analyzeCalls(page), []);
    assert.equal(page.byId('analyze-submit').disabled, true);

    // Cancel returns focus to the URL field that started the step.
    page.byId('consent-cancel').click();
    await page.flush();
    assert.equal(page.byId('consent-dialog').open, false);
    assert.equal(page.document.activeElement, page.byId('article-url'));

    // The Analyze button opens the same dialog.
    page.byId('analyze-continue').focus();
    page.byId('analyze-continue').click();
    await page.flush();
    assert.equal(page.byId('consent-dialog').open, true);
    assert.deepEqual(analyzeCalls(page), []);
  } finally {
    page.restore();
  }
});

test('consent is given per analysis: the checkbox starts unchecked every time the dialog opens', async () => {
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(await liveUrlGraph()) });
  try {
    await openConsentWithEnter(page);
    const checkbox = page.byId('consent-checkbox');
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    const [first] = analyzeCalls(page);
    assert.equal(first.body.user_asserted_public, true);
    assert.match(first.body.consent_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(first.body.url, LIVE_ARTICLE_URL);
    assert.equal(first.body.mode, 'url');
    assert.equal(checkbox.checked, true);

    page.byId('analyze-another').click();
    await page.flush();
    await openConsentWithEnter(page);
    assert.equal(checkbox.checked, false, 'a second analysis needs fresh consent');
    assert.equal(page.byId('analyze-submit').disabled, true);
    // Submitting without the box checked sends nothing.
    page.byId('analyze-form').dispatchEvent(new FakeEvent('submit', { bubbles: true }));
    await page.flush();
    assert.equal(analyzeCalls(page).length, 1);
  } finally {
    page.restore();
  }
});

test('a URL with a username or password is rejected in the browser with a field error and no request', async () => {
  const page = await loadMediaLensPage({ href: LIVE_HREF });
  try {
    for (const url of ['https://user:secret@en.wikipedia.org/wiki/Yes', 'https://user@en.wikipedia.org/wiki/Yes', 'http://user:pw@example.com/']) {
      await openConsentWithEnter(page, url);
      const fieldError = page.byId('article-url-error');
      assert.equal(fieldError.hidden, false, url);
      assert.equal(fieldError.textContent, CREDENTIALS_URL_MESSAGE, url);
      assert.equal(fieldError.getAttribute('role'), 'alert');
      assert.equal(page.byId('article-url').getAttribute('aria-invalid'), 'true');
      assert.equal(page.byId('article-url').getAttribute('aria-describedby'), 'article-url-help article-url-error');
      assert.equal(page.byId('consent-dialog').open, false, url);
      // Validation errors show no Retry and no banner.
      assert.equal(page.byId('error-actions').hidden, true);
      assert.equal(page.byId('analyze-error').hidden, true);
      // One announcement channel: the field alert, not the polite status line.
      assert.equal(page.announcements().includes(CREDENTIALS_URL_MESSAGE), false);
    }
    assert.deepEqual(analyzeCalls(page), []);
    assert.equal(CREDENTIALS_URL_MESSAGE, 'Remove the username or password from the URL.');

    // Fixing the URL clears the error and resets aria-describedby.
    await openConsentWithEnter(page, LIVE_ARTICLE_URL);
    assert.equal(page.byId('article-url-error').hidden, true);
    assert.equal(page.byId('article-url').getAttribute('aria-invalid'), 'false');
    assert.equal(page.byId('article-url').getAttribute('aria-describedby'), 'article-url-help');
    assert.equal(page.byId('consent-dialog').open, true);
  } finally {
    page.restore();
  }
});

test('analysis errors offer Retry that re-runs the same analysis; validation-type API errors do not', async () => {
  const responses = [
    { status: 500, body: { error: 'internal_error' } },
    { status: 400, body: { error: 'live_url_not_allowlisted' } }
  ];
  const page = await loadMediaLensPage({
    href: LIVE_HREF,
    analyze: async (payload, init, n) => {
      const next = responses[Math.min(n - 1, responses.length - 1)];
      return page.jsonResponse(next.body, next.status);
    }
  });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('analyze-error').hidden === false);
    const banner = page.byId('analyze-error');
    assert.match(banner.textContent, /could not complete this analysis/);
    assert.equal(banner.getAttribute('role'), 'alert');
    assert.equal(page.byId('error-actions').hidden, false);
    assert.equal(page.document.activeElement, page.byId('analyze-retry'));
    assert.equal(page.announcements().includes(banner.textContent), false, 'errors are not also sent to the polite status');

    page.byId('analyze-retry').click();
    await page.waitFor(() => analyzeCalls(page).length === 2 && page.byId('analyze-error').hidden === false);
    const [first, second] = analyzeCalls(page);
    assert.deepEqual(second.body, first.body, 'Retry re-runs the last analysis');
    assert.match(page.byId('analyze-error').textContent, /not currently approved/);
    assert.equal(page.byId('error-actions').hidden, true, 'a validation-type error has no Retry');
  } finally {
    page.restore();
  }
});

test('retryable API errors are limited to transient failures', () => {
  assert.equal(isRetryableApiError({ error: 'internal_error' }, 500), true);
  assert.equal(isRetryableApiError({ error: 'rate_limited' }, 429), true);
  assert.equal(isRetryableApiError({ error: 'live_killed' }, 503), true);
  assert.equal(isRetryableApiError({}, 502), true);
  for (const error of ['live_url_not_allowlisted', 'BAD_URL', 'BLOCKED_HOST', 'consent_required', 'oversized_input', 'live_pasted_text_disabled', 'live_fixture_disabled', 'live_url_disabled']) {
    assert.equal(isRetryableApiError({ error }, error === 'oversized_input' ? 413 : 400), false, error);
  }
});

test('cancel says the server may still finish and offers Retry', async () => {
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => 'pending' });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    assert.equal(page.byId('loading-panel').hidden, false);
    page.byId('analyze-cancel').click();
    await page.waitFor(() => page.byId('analyze-error').hidden === false);
    assert.equal(page.byId('analyze-error').textContent, CANCELLED_MESSAGE);
    assert.match(CANCELLED_MESSAGE, /cancelled in this browser/);
    assert.match(CANCELLED_MESSAGE, /server may still finish the request/);
    assert.doesNotMatch(CANCELLED_MESSAGE, /Nothing was stored/);
    assert.equal(page.byId('error-actions').hidden, false);
    assert.equal(page.byId('landing-view').hidden, false);
  } finally {
    page.restore();
  }
});

test('the loading stage is announced only when it changes', async () => {
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => 'pending' });
  const realNow = Date.now;
  try {
    let now = realNow();
    Date.now = () => now;
    await openConsentWithEnter(page);
    await page.submitConsent();
    const tick = page.intervals.filter(Boolean).at(-1);
    assert.equal(typeof tick, 'function');
    const before = page.announcements().filter((text) => text === 'Requesting article').length;
    for (let i = 0; i < 5; i += 1) tick();
    assert.equal(page.announcements().filter((text) => text === 'Requesting article').length, before);
    now += 1700;
    tick();
    tick();
    assert.equal(page.announcements().filter((text) => text === 'Preparing evidence').length, 1);
    assert.equal(page.byId('loading-stage-text').textContent, 'Preparing evidence');
    page.byId('analyze-cancel').click();
    await page.waitFor(() => page.byId('analyze-error').hidden === false);
  } finally {
    Date.now = realNow;
    page.restore();
  }
  assert.equal(stageForElapsed(0), 0);
  assert.equal(stageForElapsed(1599), 0);
  assert.equal(stageForElapsed(1600), 1);
  assert.equal(stageForElapsed(9000), 3);
});

test('a live result is a public page analysis with one coverage statement and each quote shown once', async () => {
  const graph = await liveUrlGraph();
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(graph) });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);

    assert.equal(page.byId('result-kicker').textContent, 'Public page analysis');
    assert.equal(page.byId('result-fixture-badge').hidden, true);
    const nav = page.document.querySelector('nav[aria-label="Result sections"]');
    assert.ok(nav, 'results nav has a neutral label');
    assert.equal(page.document.querySelectorAll('nav[aria-label="Story workspace"]').length, 0);
    assert.equal(page.byId('result-title').textContent, 'Harbor Bridge Synthetic');
    assert.equal(page.document.activeElement, page.byId('result-title'));
    assert.equal(page.byId('result-title').getAttribute('tabindex'), '-1');

    // One plain statement replaces the comparison blocks.
    assert.equal(page.byId('coverage-not-run').isRendered(), true);
    assert.match(page.byId('coverage-not-run')._text, /Coverage comparison was not run for this result\./);
    assert.match(page.byId('coverage-not-run')._text, /says nothing about how other outlets covered it/);
    assert.equal(page.byId('coverage-comparison').hidden, true);
    assert.equal(page.byId('compare-status').textContent, '');
    for (const id of ['coverage-origin', 'coverage-cluster', 'reporting-split', 'coverage-distribution', 'coverage-gap', 'omission-list', 'coverage-stats']) {
      assert.equal(page.byId(id).innerHTML, '', id);
    }

    // The unattributed quote renders once, under "Quotes without a named speaker".
    assert.equal(page.byId('unattributed-quotes').isRendered(), true);
    const quotes = page.byId('unattributed-list').innerHTML;
    assert.equal((quotes.match(/class="ml-observation"/g) || []).length, 1);
    assert.match(quotes, /Possible selective-context candidate/);
    assert.match(quotes, /Signal: selective context candidate/);
    const resultsHtml = page.document
      .querySelectorAll('ul')
      .filter((el) => page.byId('results').contains(el))
      .map((el) => el.innerHTML)
      .join('\n');
    assert.equal(resultsHtml.split(UNATTRIBUTED_QUOTE).length - 1, 1, 'the quote appears exactly once in the results');
    assert.doesNotMatch(resultsHtml, /missing from another/);
    assert.doesNotMatch(resultsHtml, /Fixture comparison only/);

    const overview = page.byId('overview-list').innerHTML;
    assert.match(overview, /data-overview-state="Abstained">Abstained<\/span>\s*<span class="ml-overview-detail">Other coverage not checked · 1 quote without a named speaker</);
    assert.match(page.announcements().at(-1), /^Analysis complete: 0 language observations, 1 claim found\.$/);
    assert.match(page.byId('retrieval-metadata').innerHTML, /Entered URL: <a /);
  } finally {
    page.restore();
  }
});

test('Back to start returns to the landing view, clears the result and payload, and focuses the URL field', async () => {
  const graph = await liveUrlGraph();
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(graph) });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    assert.equal(page.byId('analyze-another')._text.trim(), 'Back to start');
    page.byId('analyze-another').click();
    await page.flush();
    assert.equal(page.byId('landing-view').hidden, false);
    assert.equal(page.byId('results').hidden, true);
    assert.equal(page.document.activeElement, page.byId('article-url'));
    for (const id of ['language-list', 'claims-list', 'unattributed-list', 'overview-list', 'engine-stats']) {
      assert.equal(page.byId(id).innerHTML, '', id);
    }
    assert.equal(page.byId('result-title').textContent, '');
    // With the previous payload cleared, Retry has nothing to re-run.
    page.byId('analyze-retry').click();
    await page.flush();
    assert.equal(analyzeCalls(page).length, 1);
  } finally {
    page.restore();
  }
});

test('an abstention-only graph from the worker shows "No analysis was run", not "Analysis complete"', async () => {
  const message = 'The article could not be fetched in time, so no analysis was performed.';
  const graph = await liveAbstentionGraph({ reason: 'engine_unavailable', message });
  assert.equal(isNoAnalysisGraph(graph), true);
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(graph) });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    assert.equal(page.byId('result-title').textContent, NO_ANALYSIS_TITLE);
    assert.equal(page.byId('result-overview').textContent, message, 'the abstention message comes first');
    assert.equal(page.byId('result-meta').textContent, 'Entered URL: en.wikipedia.org');
    assert.equal(page.announcements().at(-1), 'No analysis was run.');
    assert.equal(page.announcements().some((text) => /Analysis complete/.test(text)), false);
    assert.match(page.byId('language-list').innerHTML, /No analysis was run, so no language observations are shown\./);
    assert.match(page.byId('claims-list').innerHTML, /No analysis was run, so no claims are listed\./);
    assert.doesNotMatch(page.byId('language-list').innerHTML, /reporting threshold/);
    const overview = page.byId('overview-list').innerHTML;
    assert.match(overview, /Language<\/span>\s*<span class="ml-chip" data-overview-state="Abstained">/);
    assert.match(overview, /Claims<\/span>\s*<span class="ml-chip" data-overview-state="Abstained">/);
    assert.match(overview, /From the entered URL · en\.wikipedia\.org/);
    const source = page.byId('source-context-stats').innerHTML;
    assert.match(source, /Domain \(from the entered URL\)/);
    assert.match(source, /en\.wikipedia\.org/);
    assert.doesNotMatch(source, /Has byline/);
    assert.match(page.byId('source-context-note').textContent, /not from reading the page/);
    assert.equal(page.byId('coverage-not-run').hidden, false);
    assert.equal(page.byId('unattributed-quotes').hidden, true);
    assert.match(page.byId('abstention-list').innerHTML, /could not be fetched in time/);
  } finally {
    page.restore();
  }
});

test('every worker early-exit abstention is recognized as no analysis, and ordinary results are not', async () => {
  const early = await earlyExitGraphs();
  assert.deepEqual(Object.keys(early).sort(), ['engine_failure', 'insufficient_text', 'oversized_input', 'unsupported_language']);
  for (const [reason, graph] of Object.entries(early)) {
    assert.equal(graph.abstentions[0].reason, reason);
    assert.equal(isNoAnalysisGraph(graph), true, reason);
    assert.equal(overviewState(graph, 'Language').state, 'Abstained', reason);
    assert.equal(overviewState(graph, 'Claims').state, 'Abstained', reason);
    assert.equal(overviewState(graph, 'Coverage').state, 'Abstained', reason);
    assert.equal(overviewState(graph, 'Coverage').detail, 'Other coverage not checked', reason);
  }
  for (const reason of ['engine_unavailable', 'engine_failure']) {
    assert.equal(isNoAnalysisGraph(await liveAbstentionGraph({ reason, message: 'stopped' })), true, reason);
  }
  assert.equal(isNoAnalysisGraph(await liveUrlGraph()), false);
  for (const id of ['synthetic-01-quoted-vs-authorial', 'synthetic-02-syndicated-cluster', 'synthetic-03-no-timestamp', 'synthetic-04-injection']) {
    const graph = JSON.parse(await readFile(`media-lens/fixtures/expected/${id}.graph.json`, 'utf8'));
    assert.equal(isNoAnalysisGraph(graph), false, id);
  }
  for (const id of ['synthetic-05-paywall', 'synthetic-06-short-excerpt']) {
    const graph = JSON.parse(await readFile(`media-lens/fixtures/expected/${id}.graph.json`, 'utf8'));
    assert.equal(isNoAnalysisGraph(graph), true, id);
  }
});

test('the only coverage-dimension observation the worker emits is the unattributed-quote rule', async () => {
  // The "Quotes without a named speaker" heading depends on this contract.
  const fusion = await readFile('media-lens/worker/fusion.js', 'utf8');
  const coverageBlocks = [...fusion.matchAll(/dimension:\s*'coverage'[\s\S]{0,400}?ui_phrase:\s*([A-Z_]+)/g)];
  assert.equal(coverageBlocks.length, 1);
  assert.equal(coverageBlocks[0][1], 'QUOTED_UI_PHRASE');
  assert.match(coverageBlocks[0][0], /signal:\s*'selective_context_candidate'/);
  assert.match(coverageBlocks[0][0], /authorial_attribution:\s*'quoted'/);
  const graph = await liveUrlGraph();
  assert.equal(renderUnattributedQuotes(graph).split(UNATTRIBUTED_QUOTE).length - 1, 1);
  assert.equal(renderUnattributedQuotes({ observations: [], spans: [] }), '');
});
