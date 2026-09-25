// Live-host analysis journey: URL entry, consent, loading, errors, results,
// the no-analysis state, and returning to the start. Drives the real
// media-lens.js against the real index.html (tests/helpers/media-lens-dom.js)
// with graphs built by the worker's own code (tests/helpers/media-lens-graphs.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeEvent, LIVE_HEALTH, loadMediaLensPage } from './helpers/media-lens-dom.js';
import {
  LIVE_ARTICLE_URL,
  UNATTRIBUTED_QUOTE,
  earlyExitGraphs,
  liveAbstentionGraph,
  liveTimeoutAbstentionGraph,
  liveUrlGraph
} from './helpers/media-lens-graphs.js';
import {
  CANCELLED_MESSAGE,
  CREDENTIALS_URL_MESSAGE,
  NO_ANALYSIS_TITLE,
  RATE_LIMITED_HOST_MESSAGE,
  STOPPED_ANALYSIS_TITLE,
  apiErrorMessage,
  buildAnalysisOverview,
  isNoAnalysisGraph,
  isRetryableApiError,
  renderUnattributedQuotes,
  stageForElapsed,
  toEvidenceOnlyExport
} from '../media-lens/media-lens.js';

const LIVE_HREF = 'https://ml-jev.manipulationscore.com/media-lens/';
const LOCAL_HREF = 'http://127.0.0.1:8123/media-lens/';
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

// The last element brought into view, as recorded by the fake DOM.
function lastScrolled(page) {
  return page.document.scrollLog.at(-1)?.id;
}

// True when the element is the one focused. Compared by identity so a
// failing check does not try to diff two whole fake DOM trees.
function isFocused(page, id) {
  return page.document.activeElement === page.byId(id);
}

function focusedId(page) {
  return page.document.activeElement?.id || page.document.activeElement?.tagName;
}

test('Retry reopens consent for the same request and sends it only after fresh consent', async () => {
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
    assert.equal(banner.getAttribute('tabindex'), '-1');
    assert.equal(page.byId('error-actions').hidden, false);
    assert.ok(isFocused(page, 'analyze-error'), `focus is on ${focusedId(page)}`);
    assert.equal(lastScrolled(page), 'analyze-error');
    assert.equal(page.announcements().includes(banner.textContent), false, 'errors are not also sent to the polite status');

    // Someone edits the field, then chooses Retry: the field is set back to
    // the address being retried, and nothing is sent yet.
    page.byId('article-url').value = 'https://en.wikipedia.org/wiki/Another_Page';
    await new Promise((resolve) => setTimeout(resolve, 5));
    page.byId('analyze-retry').focus();
    page.byId('analyze-retry').click();
    await page.flush();
    assert.equal(page.byId('consent-dialog').open, true, 'Retry opens the consent step');
    assert.equal(page.byId('consent-checkbox').checked, false, 'consent starts unchecked on Retry');
    assert.equal(page.byId('analyze-submit').disabled, true);
    assert.equal(page.byId('article-url').value, LIVE_ARTICLE_URL);
    assert.equal(analyzeCalls(page).length, 1, 'Retry alone sends nothing');

    // Cancel keeps the error and returns focus to Retry.
    page.byId('consent-cancel').click();
    await page.flush();
    assert.equal(page.byId('consent-dialog').open, false);
    assert.equal(analyzeCalls(page).length, 1);
    assert.equal(page.byId('error-actions').hidden, false);
    assert.ok(isFocused(page, 'analyze-retry'), `focus is on ${focusedId(page)}`);

    page.byId('analyze-retry').click();
    await page.flush();
    await page.submitConsent();
    await page.waitFor(() => analyzeCalls(page).length === 2 && page.byId('article-url-error').hidden === false);
    const [first, second] = analyzeCalls(page);
    const { consent_at: firstConsent, ...firstRest } = first.body;
    const { consent_at: secondConsent, ...secondRest } = second.body;
    assert.deepEqual(secondRest, firstRest, 'Retry sends the same request');
    assert.match(secondConsent, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(secondConsent > firstConsent, 'the retried request carries the new consent time');

    // A not-approved source is a URL field error with no Retry.
    assert.match(page.byId('article-url-error').textContent, /not currently approved/);
    assert.equal(page.byId('analyze-error').hidden, true);
    assert.equal(page.byId('error-actions').hidden, true, 'a validation-type error has no Retry');
  } finally {
    page.restore();
  }
});

test('retryable API errors are limited to transient failures', () => {
  assert.equal(isRetryableApiError({ error: 'internal_error' }, 500), true);
  assert.equal(isRetryableApiError({ error: 'rate_limited' }, 429), true);
  assert.equal(isRetryableApiError({}, 502), true);
  assert.equal(isRetryableApiError({}, 429), true);
  // The kill switch stays on until an operator turns it off.
  assert.equal(isRetryableApiError({ error: 'live_killed' }, 503), false);
  for (const error of ['live_url_not_allowlisted', 'BAD_URL', 'BLOCKED_HOST', 'BAD_SCHEME', 'consent_required', 'oversized_input', 'live_pasted_text_disabled', 'live_fixture_disabled', 'live_url_disabled', 'invalid_kind']) {
    assert.equal(isRetryableApiError({ error }, error === 'oversized_input' ? 413 : 400), false, error);
  }
});

test('cancel says the server may still finish, focuses the message, and Retry asks for consent again', async () => {
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
    assert.ok(isFocused(page, 'analyze-error'), `focus is on ${focusedId(page)}`);
    assert.equal(lastScrolled(page), 'analyze-error');

    page.byId('analyze-retry').click();
    await page.flush();
    assert.equal(page.byId('consent-dialog').open, true);
    assert.equal(page.byId('consent-checkbox').checked, false);
    assert.equal(analyzeCalls(page).length, 1);
  } finally {
    page.restore();
  }
});

test('after a previous result, a not-approved URL is a focused, visible URL field error', async () => {
  const graph = await liveUrlGraph();
  const page = await loadMediaLensPage({
    href: LIVE_HREF,
    analyze: async (payload, init, n) =>
      n === 1
        ? page.jsonResponse(graph)
        : page.jsonResponse({ error: 'live_url_not_allowlisted', message: 'This host is not on the operator URL allowlist.' }, 400)
  });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    page.byId('analyze-another').click();
    await page.flush();

    await openConsentWithEnter(page, 'https://example.com/x');
    await page.submitConsent();
    await page.waitFor(() => page.byId('article-url-error').hidden === false);

    const input = page.byId('article-url');
    const fieldError = page.byId('article-url-error');
    assert.equal(page.byId('landing-view').hidden, false);
    assert.equal(page.byId('results').hidden, true);
    assert.equal(page.byId('loading-panel').hidden, true);
    assert.equal(fieldError.isRendered(), true);
    assert.equal(fieldError.textContent, 'This source is not currently approved for live analysis. Try an approved public URL.');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.ok(input.getAttribute('aria-describedby').split(' ').includes('article-url-error'));
    assert.ok(input.getAttribute('aria-describedby').split(' ').includes('article-url-help'));
    assert.ok(isFocused(page, 'article-url'), `focus is on ${focusedId(page)}`);
    assert.equal(lastScrolled(page), 'article-url-error', 'the field error is scrolled into view');
    assert.deepEqual(page.document.scrollLog.at(-1).options, { block: 'center', behavior: 'instant' });
    assert.equal(page.byId('analyze-error').hidden, true, 'no banner for a URL error');
    assert.equal(page.byId('error-actions').hidden, true);
    assert.equal(input.value, 'https://example.com/x');
  } finally {
    page.restore();
  }
});

test('every URL-policy error from the worker is shown on the URL field', async () => {
  for (const error of ['BAD_URL', 'BLOCKED_HOST', 'BAD_SCHEME']) {
    const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse({ error, message: 'raw worker text' }, 400) });
    try {
      await openConsentWithEnter(page);
      await page.submitConsent();
      await page.waitFor(() => page.byId('article-url-error').hidden === false);
      assert.equal(page.byId('article-url-error').textContent, 'This URL is not allowed. Use a public https:// address from an approved host.', error);
      assert.ok(isFocused(page, 'article-url'), `${error}: focus is on ${focusedId(page)}`);
      assert.equal(page.byId('article-url').getAttribute('aria-invalid'), 'true', error);
      assert.equal(page.byId('analyze-error').hidden, true, error);
    } finally {
      page.restore();
    }
  }
});

test('a 503 and a per-site 429 move focus to the error banner and bring it into view', async () => {
  const cases = [
    {
      status: 503,
      body: { error: 'live_killed', message: 'Live URL and live Jev are disabled by the operator kill switch.' },
      text: 'Live analysis is temporarily paused by the operator. No analysis was run.',
      retry: false
    },
    {
      status: 429,
      body: { error: 'rate_limited', message: 'Too many live URL attempts for this host. Wait a minute and try again.' },
      text: RATE_LIMITED_HOST_MESSAGE,
      retry: true
    }
  ];
  for (const { status, body, text, retry } of cases) {
    const graph = await liveUrlGraph();
    const page = await loadMediaLensPage({
      href: LIVE_HREF,
      analyze: async (payload, init, n) => (n === 1 ? page.jsonResponse(graph) : page.jsonResponse(body, status))
    });
    try {
      // Start from a previous result, as a phone user would.
      await openConsentWithEnter(page);
      await page.submitConsent();
      await page.waitFor(() => page.byId('results').hidden === false);
      page.byId('analyze-another').click();
      await page.flush();
      await openConsentWithEnter(page);
      await page.submitConsent();
      await page.waitFor(() => page.byId('analyze-error').hidden === false);

      const banner = page.byId('analyze-error');
      assert.equal(banner.textContent, text, String(status));
      assert.equal(banner.isRendered(), true, String(status));
      assert.ok(isFocused(page, 'analyze-error'), `${status}: focus is on ${focusedId(page)}`);
      assert.equal(lastScrolled(page), 'analyze-error', String(status));
      assert.equal(page.byId('landing-view').hidden, false, String(status));
      assert.equal(page.byId('error-actions').hidden, !retry, String(status));
      assert.equal(page.byId('article-url-error').hidden, true, String(status));
    } finally {
      page.restore();
    }
  }
});

test('rate-limit copy is plain and never repeats the worker wording', () => {
  assert.equal(RATE_LIMITED_HOST_MESSAGE, 'Media Lens has reached its per-minute limit for this site. Wait a minute and try again.');
  const host = apiErrorMessage({ error: 'rate_limited', message: 'Too many live URL attempts for this host. Wait a minute and try again.' }, 429);
  assert.equal(host, RATE_LIMITED_HOST_MESSAGE);
  const busy = apiErrorMessage({ error: 'rate_limited', message: 'A live URL fetch is already in progress on this worker.' }, 429);
  assert.equal(busy, 'Media Lens is already analyzing another page. Wait a moment and try again.');
  for (const message of ['Too many live URL attempts. Wait a minute and try again.', 'Too many analyses requested. Wait a minute and try again.', undefined]) {
    assert.equal(apiErrorMessage({ error: 'rate_limited', message }, 429), 'Media Lens has reached its per-minute limit. Wait a minute and try again.');
  }
  for (const text of [host, busy]) assert.doesNotMatch(text, /worker|host\b|Too many/);
});

test('the kill switch and a disabled live URL mode re-check /health, update the status line, and offer no Retry', async () => {
  const cases = [
    {
      status: 503,
      body: { error: 'live_killed', message: 'Live URL and live Jev are disabled by the operator kill switch.' },
      laterHealth: { ...LIVE_HEALTH, killSwitch: true },
      statusText: 'Live analysis is paused by the operator kill switch.'
    },
    {
      status: 400,
      body: { error: 'live_url_disabled', message: 'Live URL fetch is disabled until MEDIA_LENS_ENABLE_LIVE_URL=true is set.' },
      laterHealth: { ...LIVE_HEALTH, liveUrlEnabled: false },
      statusText: 'Worker reachable, but live URL analysis is not currently available.'
    }
  ];
  for (const { status, body, laterHealth, statusText } of cases) {
    const page = await loadMediaLensPage({
      href: LIVE_HREF,
      health: (n) => (n === 1 ? LIVE_HEALTH : laterHealth),
      analyze: async () => page.jsonResponse(body, status)
    });
    try {
      assert.match(page.byId('worker-status-text').textContent, /^Live URL ready/);
      await openConsentWithEnter(page);
      await page.submitConsent();
      await page.waitFor(() => page.byId('analyze-error').hidden === false);
      await page.waitFor(() => page.byId('worker-status-text').textContent === statusText);
      const healthCalls = page.fetchCalls.filter((call) => call.url.endsWith('/health'));
      assert.equal(healthCalls.length, 2, `${body.error}: /health is checked again`);
      assert.equal(page.byId('worker-status').dataset.state, 'error', body.error);
      assert.equal(page.byId('article-url').disabled, true, `${body.error}: the URL field follows /health`);
      assert.equal(page.byId('error-actions').hidden, true, `${body.error}: no Retry`);
      assert.ok(isFocused(page, 'analyze-error'), `${body.error}: focus is on ${focusedId(page)}`);
      assert.match(page.byId('analyze-error').textContent, /No analysis was run\.$/);
    } finally {
      page.restore();
    }
  }
});

test('invalid_kind and live_fixture_disabled get their own plain messages, not the worker text', async () => {
  assert.equal(
    apiErrorMessage({ error: 'invalid_kind', message: 'payload.kind must be one of the artifact kinds' }, 400),
    'Media Lens did not accept the page type in this request, so no analysis was run. Reload this page and try again.'
  );
  assert.equal(
    apiErrorMessage({ error: 'live_fixture_disabled', message: 'Fixture examples are disabled in live mode.' }, 400),
    'Fixture examples are not available on this host. No analysis was run.'
  );

  const page = await loadMediaLensPage({
    href: LIVE_HREF,
    analyze: async () => page.jsonResponse({ error: 'invalid_kind', message: 'payload.kind must be one of the artifact kinds' }, 400)
  });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('analyze-error').hidden === false);
    assert.equal(analyzeCalls(page)[0].body.kind, 'article', 'the page sends a valid kind');
    assert.match(page.byId('analyze-error').textContent, /^Media Lens did not accept the page type/);
    assert.doesNotMatch(page.byId('analyze-error').textContent, /payload\.kind/);
    assert.equal(page.byId('error-actions').hidden, true);
    assert.ok(isFocused(page, 'analyze-error'), `focus is on ${focusedId(page)}`);
  } finally {
    page.restore();
  }
});

test('a live worker that refuses a local fixture analysis shows the live_fixture_disabled message', async () => {
  const page = await loadMediaLensPage({
    href: LOCAL_HREF,
    health: LIVE_HEALTH,
    analyze: async () =>
      page.jsonResponse(
        {
          error: 'live_fixture_disabled',
          message: 'Fixture examples are disabled in live mode. Use URL mode for approved public sources, or run a fixture-only worker for local development.'
        },
        400
      )
  });
  try {
    page.byId('sample-analyze').click();
    await page.flush();
    assert.equal(page.byId('consent-dialog').open, true);
    await page.submitConsent();
    await page.waitFor(() => page.byId('analyze-error').hidden === false);
    const [call] = page.fetchCalls.filter((entry) => entry.url === 'http://127.0.0.1:8787/analyze');
    assert.equal(call.body.mode, 'fixture');
    assert.equal(page.byId('analyze-error').textContent, 'Fixture examples are not available on this host. No analysis was run.');
    assert.equal(page.byId('error-actions').hidden, true);
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
    assert.equal(page.byId('consent-dialog').open, false);
  } finally {
    page.restore();
  }
});

test('each view shows exactly one h1: the landing hero, the loading heading, or the result title', async () => {
  const graph = await liveUrlGraph();
  let release;
  const page = await loadMediaLensPage({
    href: LIVE_HREF,
    analyze: () => new Promise((resolve) => (release = () => resolve(page.jsonResponse(graph))))
  });
  const visibleH1 = () => page.document.querySelectorAll('h1').filter((el) => el.isRendered()).map((el) => el.id);
  try {
    assert.deepEqual(visibleH1(), ['ml-hero-heading']);
    await openConsentWithEnter(page);
    await page.submitConsent();
    assert.equal(page.byId('loading-panel').hidden, false);
    assert.deepEqual(visibleH1(), ['ml-loading-heading']);
    release();
    await page.waitFor(() => page.byId('results').hidden === false);
    assert.deepEqual(visibleH1(), ['result-title']);
    assert.ok(isFocused(page, 'result-title'), `focus is on ${focusedId(page)}`);
  } finally {
    page.restore();
  }
});

test('an abstention-only graph after live Jev calls says the analysis stopped and that spans were sent', async () => {
  // The worker's real timeout shape: Jev ran live and was billed, then the
  // per-analysis limit stopped the pipeline before a result.
  const graph = await liveTimeoutAbstentionGraph({ calls: 3 });
  assert.equal(graph.engine.jev.mode, 'live');
  assert.equal(graph.engine.jev.calls, 3);
  assert.equal(graph.privacy.external_processing.some((entry) => entry.occurred === true), true);
  assert.equal(isNoAnalysisGraph(graph), true);
  const stopMessage = graph.abstentions.find((item) => item.reason === 'engine_unavailable').message;

  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(graph) });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    assert.equal(STOPPED_ANALYSIS_TITLE, 'Analysis stopped before completion');
    assert.equal(page.byId('result-title').textContent, STOPPED_ANALYSIS_TITLE);
    const overview = page.byId('result-overview').textContent;
    assert.ok(overview.startsWith(stopMessage), overview);
    assert.match(overview, /Prepared public spans from this page were already sent to TypeSafe AI’s Jev service\. No result is shown\./);
    assert.equal(
      page.announcements().at(-1),
      'Analysis stopped before completion. Prepared public spans from this page were already sent to TypeSafe AI’s Jev service. No result is shown.'
    );
    assert.equal(page.byId('result-limits').textContent, 'Experimental Jev-only preview. No result or score is shown for this page.');
    assert.doesNotMatch(page.byId('result-limits').textContent, /No manipulation analysis or score was generated/);

    // Nothing on the result says that no analysis was run.
    const results = page.byId('results');
    const texts = [...results.descendants()].map((el) => `${el._text} ${el.innerHTML}`).join('\n');
    assert.doesNotMatch(texts, /No analysis was run/);
    assert.doesNotMatch(page.announcements().join('\n'), /No analysis was run|Analysis complete/);
    assert.match(page.byId('language-list').innerHTML, /stopped before completion, so no language observations are shown/);
    assert.match(page.byId('claims-list').innerHTML, /stopped before completion, so no claims are listed/);
    assert.match(page.byId('overview-list').innerHTML, /Stopped before completion/);
    assert.match(page.byId('source-context-note').textContent, /stopped before completion/);
  } finally {
    page.restore();
  }

  // Either record is enough: a privacy entry that says processing occurred
  // marks the analysis as stopped even if the call count is missing.
  const privacyOnly = structuredClone(graph);
  privacyOnly.engine.jev.calls = 0;
  assert.equal(overviewState(privacyOnly, 'Language').detail, 'Stopped before completion');
  const callsOnly = structuredClone(graph);
  callsOnly.privacy.external_processing = [];
  assert.equal(overviewState(callsOnly, 'Language').detail, 'Stopped before completion');

  // Without external processing the same shape keeps "No analysis was run".
  const untouched = structuredClone(graph);
  untouched.engine.jev.calls = 0;
  untouched.engine.jev.mode = 'disabled';
  untouched.privacy.external_processing = [];
  const second = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => second.jsonResponse(untouched) });
  try {
    await openConsentWithEnter(second);
    await second.submitConsent();
    await second.waitFor(() => second.byId('results').hidden === false);
    assert.equal(second.byId('result-title').textContent, NO_ANALYSIS_TITLE);
    assert.equal(second.announcements().at(-1), 'No analysis was run.');
  } finally {
    second.restore();
  }
});

test('an unreadable or unwritable TypeSafe budget record is shown as no analysis, with the worker reason first', async () => {
  // The worker abstains before any provider call, so no Jev calls are
  // recorded and the page must not say the analysis stopped after sending.
  const message = 'The TypeSafe ESTIMATED budget record could not be read or updated, so no live Jev analysis was performed.';
  const graph = await liveAbstentionGraph({ reason: 'engine_unavailable', message });
  assert.equal(graph.engine.jev.calls, 0);
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(graph) });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    assert.equal(page.byId('result-title').textContent, NO_ANALYSIS_TITLE);
    assert.equal(page.byId('result-overview').textContent, message);
    assert.equal(page.announcements().at(-1), 'No analysis was run.');
    assert.doesNotMatch(page.byId('result-overview').textContent, /already sent/);
  } finally {
    page.restore();
  }
});

test('the no-analysis headline never uses the page title, which stays in the meta line', async () => {
  const early = await earlyExitGraphs();
  const graph = early.insufficient_text;
  assert.equal(graph.artifact.title, 'Harbor Bridge Synthetic');
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(graph) });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    assert.equal(page.byId('result-title').textContent, NO_ANALYSIS_TITLE);
    assert.notEqual(page.byId('result-title').textContent, graph.artifact.title);
    assert.equal(page.byId('result-meta').textContent, 'Entered URL: en.wikipedia.org · Page title: Harbor Bridge Synthetic');
  } finally {
    page.restore();
  }
});

test('the evidence-only export blanks span text not tied to a shown observation or claim', async () => {
  const graph = await liveUrlGraph();
  const tied = new Set([...graph.observations.flatMap((obs) => obs.span_ids), ...graph.claims.flatMap((claim) => claim.span_ids)]);
  const untied = graph.spans.filter((span) => !tied.has(span.id));
  assert.ok(tied.size > 0 && untied.length > 0, 'the graph has both kinds of span');

  const direct = toEvidenceOnlyExport(graph);
  for (const span of direct.spans) {
    assert.equal(span.text, tied.has(span.id) ? graph.spans.find((s) => s.id === span.id).text : '', span.id);
  }
  assert.equal(direct.privacy.spans_included, 'evidence_only');
  assert.notEqual(graph.spans.find((span) => span.id === untied[0].id).text, '', 'the source graph is not changed');

  // The page's export button writes that same evidence-only document.
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(graph) });
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  let blob = null;
  URL.createObjectURL = (value) => {
    blob = value;
    return 'blob:media-lens-test';
  };
  URL.revokeObjectURL = () => {};
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    page.byId('export-json-btn').click();
    assert.ok(blob, 'export created a file');
    const exported = JSON.parse(await blob.text());
    for (const span of exported.spans) {
      if (tied.has(span.id)) assert.notEqual(span.text, '', span.id);
      else assert.equal(span.text, '', span.id);
    }
    assert.equal(exported.privacy.spans_included, 'evidence_only');
    assert.equal(exported.spans.length, graph.spans.length);
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    page.restore();
  }
});

test('no Jev probability is rendered anywhere in the results', async () => {
  const graph = JSON.parse(await readFile('media-lens/fixtures/expected/synthetic-01-quoted-vs-authorial.graph.json', 'utf8'));
  for (const obs of graph.observations) obs.evidence = { ...obs.evidence, top_probability: 0.8731 };
  const page = await loadMediaLensPage({ href: LIVE_HREF, analyze: async () => page.jsonResponse(graph) });
  try {
    await openConsentWithEnter(page);
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    assert.match(page.byId('language-list').innerHTML, /class="ml-observation"/, 'observations were rendered');
    const results = page.byId('results');
    const texts = [...results.descendants()].map((el) => `${el._text} ${el.innerHTML}`).join('\n');
    assert.doesNotMatch(texts, /0\.8731|87\.31|87%|0\.873\b/);
    assert.doesNotMatch(texts, /probabilit|top_probability/i);
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
