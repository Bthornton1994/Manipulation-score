// Regression tests for the independent acceptance review of PR #117
// (findings H1, H2, M1, L6), the follow-up re-verification round
// (findings N1, N2, N3), and R1 (IPv4-mapped IPv6 hex forms). See also
// tests/media-lens-jev-adapter.test.js
// (H1 adapter-level check), tests/media-lens-fusion.test.js (H1 fusion
// defense-in-depth check), and tests/media-lens-schema.test.js /
// tests/media-lens-privacy.test.js (L8 validator gaps).

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, validateOrAbstain } from '../media-lens/worker/server.js';
import { loadConfig } from '../media-lens/worker/config.js';
import { validate } from '../media-lens/schema/validate.js';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { fetchArticleSafely, assertHostIsPublic } from '../media-lens/worker/safe-fetch.js';
import { createNewsjackAdapter } from '../media-lens/worker/adapters/newsjack.js';
import { createJevAdapter } from '../media-lens/worker/adapters/jev.js';
import { analyze } from '../media-lens/worker/analyze.js';
import { prepareFromPastedText, emptyPreparedArtifactStub } from '../media-lens/worker/prepare.js';

function requestJson(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: address.address,
        port: address.port,
        method,
        path,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function withMockJevServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

// ---------------------------------------------------------------------------
// H1: out-of-taxonomy Jev answer must never become a fabricated observation,
// and the server must run validate() before ever sending a graph.
// ---------------------------------------------------------------------------

test('H1: a mock Jev returning an out-of-taxonomy choice for every span never produces a fabricated observation, end to end through the live-mode server', async () => {
  const mockJev = await withMockJevServer(async (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: {
            // Exactly the reported reproduction: a fabricated, out-of-taxonomy signal.
            influence_signal: { choice: 'outlet_is_untrustworthy_propaganda', probabilities: { outlet_is_untrustworthy_propaganda: 0.99 }, confidence: 0.99 },
            is_quoted_or_attributed: { noul: 0.1 }
          }
        })
      );
    });
  });
  const mockJevAddress = mockJev.address();

  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key',
    MEDIA_LENS_TYPESAFE_BASE_URL: `http://127.0.0.1:${mockJevAddress.port}`
  });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial' }
    });
    assert.equal(res.status, 200);

    const { valid, errors } = validate(res.body);
    assert.deepEqual(errors, []);
    assert.equal(valid, true, 'server must never serve a document that fails its own schema');

    assert.ok(
      !res.body.observations.some((o) => o.signal === 'outlet_is_untrustworthy_propaganda'),
      'the fabricated out-of-taxonomy signal must never appear as an observation'
    );
    // The fabricated answer is correctly treated as an engine failure, not
    // silently dropped without a trace.
    assert.ok(res.body.engine.jev.failures > 0);
  } finally {
    server.close();
    mockJev.close();
  }
});

test('H1: validateOrAbstain discards a hand-broken graph and serves a valid abstention-only fallback instead', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const goodGraph = await runFixture('synthetic-01-quoted-vs-authorial');
  assert.equal(validate(goodGraph).valid, true);

  // Simulate "any other bug in the pipeline" by directly injecting a
  // fabricated, out-of-taxonomy observation into an otherwise-valid graph
  // -- i.e. exactly what an adapter/fusion bug would have let through.
  const brokenGraph = {
    ...goodGraph,
    observations: [
      ...goodGraph.observations,
      {
        id: 'obs-fabricated',
        dimension: 'language',
        signal: 'outlet_is_untrustworthy_propaganda',
        strength: 'observed',
        localization: 'unlocalized',
        span_ids: [],
        authorial_attribution: 'unknown',
        evidence: { engine: 'jev', question_id: 'influence_signal', top_probability: 0.99, answers_ref: null },
        review_status: 'auto',
        ui_phrase: 'Observed influence signal'
      }
    ]
  };
  assert.equal(validate(brokenGraph).valid, false, 'sanity check: this hand-broken graph must actually be invalid');

  const prepared = { ...emptyPreparedArtifactStub({ inputMode: 'fixture' }), textLengthChars: 500 };
  const result = await validateOrAbstain({ graph: brokenGraph, prepared, config, consentAt: '2026-09-18T00:00:00.000Z' });

  assert.equal(validate(result).valid, true, 'the fallback graph itself must be schema-valid');
  assert.ok(!result.observations.some((o) => o.signal === 'outlet_is_untrustworthy_propaganda'));
  assert.ok(result.abstentions.some((a) => a.reason === 'engine_failure'));
});

// ---------------------------------------------------------------------------
// H2: URL fetch timeout / size cap / SSRF guard, and per-analysis timeout.
// ---------------------------------------------------------------------------

function hasCode(code) {
  return (err) => err.code === code;
}

test('H2: assertHostIsPublic rejects loopback and private/link-local hosts', async () => {
  await assert.rejects(() => assertHostIsPublic('localhost'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('127.0.0.1'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('169.254.169.254'), hasCode('BLOCKED_HOST')); // cloud metadata
  await assert.rejects(() => assertHostIsPublic('10.0.0.5'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('192.168.1.1'), hasCode('BLOCKED_HOST'));
});

test('H2: assertHostIsPublic allows a public-looking address', async () => {
  // 203.0.113.0/24 is TEST-NET-3 (RFC 5737), reserved for documentation —
  // not private/loopback/link-local, and dns.lookup resolves an IP literal
  // instantly without a real network query, so this is deterministic.
  await assert.doesNotReject(() => assertHostIsPublic('203.0.113.7'));
});

test('H2: fetchArticleSafely rejects a non-http(s) scheme before ever calling the pinned client', async () => {
  let called = false;
  await assert.rejects(
    () =>
      fetchArticleSafely('file:///etc/passwd', {
        timeoutMs: 1000,
        maxBytes: 1000,
        requestImpl: async () => {
          called = true;
          return { status: 200, headers: {}, remoteAddress: '203.0.113.7', body: 'x' };
        }
      }),
    hasCode('BAD_SCHEME')
  );
  assert.equal(called, false);
});

test('H2: fetchArticleSafely rejects a loopback URL outright', async () => {
  await assert.rejects(() => fetchArticleSafely('http://127.0.0.1:9/secret', { timeoutMs: 1000, maxBytes: 1000 }), hasCode('BLOCKED_HOST'));
});

test('H2: fetchArticleSafely re-validates the host after following a redirect', async () => {
  let hop = 0;
  const requestImpl = async ({ parsed, pin }) => {
    hop += 1;
    if (hop === 1) {
      return {
        status: 302,
        headers: { location: 'http://127.0.0.1:9/internal' },
        rawHeaders: ['Location', 'http://127.0.0.1:9/internal'],
        remoteAddress: pin.address,
        body: ''
      };
    }
    throw new Error('should never reach the second (internal) hop');
  };
  await assert.rejects(() => fetchArticleSafely('http://203.0.113.7/start', { timeoutMs: 1000, maxBytes: 1000, requestImpl }), hasCode('BLOCKED_HOST'));
  assert.equal(hop, 1);
});

test('H2: fetchArticleSafely enforces a byte cap on the response body', async () => {
  const requestImpl = async ({ pin }) => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    rawHeaders: ['Content-Type', 'text/html'],
    remoteAddress: pin.address,
    body: 'x'.repeat(1000)
  });
  await assert.rejects(() => fetchArticleSafely('http://203.0.113.7/big', { timeoutMs: 1000, maxBytes: 100, requestImpl }), hasCode('TOO_LARGE'));
});

test('H2: fetchArticleSafely times out a hanging fetch within the configured limit', async () => {
  const requestImpl = ({ signal } = {}) =>
    new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  const startedAt = Date.now();
  await assert.rejects(() => fetchArticleSafely('http://203.0.113.7/hangs', { timeoutMs: 60, maxBytes: 1000, requestImpl }), hasCode('TIMEOUT'));
  assert.ok(Date.now() - startedAt < 2000, 'must not wait anywhere close to the default 8s timeout');
});

test('H2: analyze() returns an engine_unavailable abstention graph when the whole pipeline hangs past perAnalysisTimeoutMs', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  config.limits = { ...config.limits, perAnalysisTimeoutMs: 80 };

  const prepared = prepareFromPastedText({ text: 'A '.repeat(150) + 'sentence that is long enough to analyze.' });
  const hangingJevAdapter = { mode: 'live', analyzeSpans: () => new Promise(() => {}) }; // never settles
  const newsjackAdapter = createNewsjackAdapter({ mode: 'disabled' });

  const startedAt = Date.now();
  const graph = await analyze({
    prepared,
    config,
    jevAdapter: hangingJevAdapter,
    newsjackAdapter,
    userAssertedPublic: true,
    consentAt: '2026-09-18T00:00:00.000Z'
  });
  assert.ok(Date.now() - startedAt < 5000, 'must be bounded by perAnalysisTimeoutMs, not hang indefinitely');
  assert.equal(validate(graph).valid, true);
  assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable'));
});

test('H2: server.js passes config.limits.jevCallTimeoutMs into the Jev adapter (not the adapter default)', async () => {
  const { readFile } = await import('node:fs/promises');
  const serverSrc = await readFile('media-lens/worker/server.js', 'utf8');
  assert.match(serverSrc, /timeoutMs:\s*config\.limits\.jevCallTimeoutMs/);

  const mockJev = await withMockJevServer(async (req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      // Deliberately slower than the small configured timeout below, on
      // every attempt (including retries). Guarded against writing to an
      // already-aborted connection, which the client will do at ~40ms.
      setTimeout(() => {
        if (res.writableEnded || res.destroyed) return;
        try {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { influence_signal: { choice: 'none' }, is_quoted_or_attributed: { noul: 0.1 } } }));
        } catch {
          // Connection already closed client-side; nothing to do.
        }
      }, 300);
    });
  });
  mockJev.on('clientError', () => {}); // ignore aborted-connection noise from the client
  const mockJevAddress = mockJev.address();

  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key',
    MEDIA_LENS_TYPESAFE_BASE_URL: `http://127.0.0.1:${mockJevAddress.port}`
  });
  // A tiny per-call timeout: if this value is actually threaded into the
  // adapter, the call fails fast (bounded by the 4-attempt retry/backoff
  // shape, roughly 40ms + 250ms + 40ms + 500ms + 40ms + 1000ms + 40ms ~= 2s);
  // if it silently used the adapter's 8000ms default instead, the same retry
  // shape would take tens of seconds, far past the bound asserted below.
  config.limits = { ...config.limits, jevCallTimeoutMs: 40, perAnalysisTimeoutMs: 30000 };

  const prepared = prepareFromPastedText({ text: 'A '.repeat(150) + 'short article body for the test.' });
  const jevAdapter = createJevAdapter({
    mode: 'live',
    baseUrl: config.jev.baseUrl,
    apiKey: 'test-key',
    timeoutMs: config.limits.jevCallTimeoutMs,
    concurrency: 1
  });
  const newsjackAdapter = createNewsjackAdapter({ mode: 'disabled' });

  try {
    const startedAt = Date.now();
    const graph = await analyze({
      prepared,
      config,
      jevAdapter,
      newsjackAdapter,
      userAssertedPublic: true,
      consentAt: '2026-09-18T00:00:00.000Z'
    });
    const elapsedMs = Date.now() - startedAt;
    assert.ok(graph.engine.jev.failures > 0, 'the slow mock response should have been treated as a timeout failure');
    assert.ok(elapsedMs < 5000, `expected the small configured jevCallTimeoutMs to be honored, took ${elapsedMs}ms`);
  } finally {
    mockJev.close();
  }
});

// ---------------------------------------------------------------------------
// M1: fixture_id path traversal.
// ---------------------------------------------------------------------------

test('M1: a path-traversal fixture_id is rejected with 400, never read from disk', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: '../../../analyze' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_fixture_id');
  } finally {
    server.close();
  }
});

test('M1: a well-formed but nonexistent fixture_id is also rejected with 400', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'not-a-real-fixture' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_fixture_id');
  } finally {
    server.close();
  }
});

test('M1: an uppercase or otherwise pattern-violating fixture_id is rejected before any file read', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial/../../etc/passwd' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_fixture_id');
  } finally {
    server.close();
  }
});

test('M1: a legitimate fixture_id still works normally', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.schema, 'influence-graph.v1');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// L6: rate limit must be checked before the body is read.
// ---------------------------------------------------------------------------

test('L6: once the rate limit is exhausted, an oversized body still gets 429 (rate_limited), not 413', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  config.limits = { ...config.limits, maxAnalysesPerMinute: 1, maxRequestBodyBytes: 200 };
  const server = await listen(createServer(config));
  try {
    // Exhaust the one allowed request per minute with a small, valid body.
    const first = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial' }
    });
    assert.equal(first.status, 200);

    // A second request whose body is larger than maxRequestBodyBytes:
    // if the rate limit were checked *after* reading the body (the old
    // order), this would return 413. Checking it first must return 429.
    const oversizedBody = { user_asserted_public: true, mode: 'pasted_text', text: 'x'.repeat(500) };
    const second = await requestJson(server, { method: 'POST', path: '/analyze', body: oversizedBody });
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'rate_limited');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// N1: consent_at/user_asserted_public must survive every abstention-only
// early-return path in analyze(), not just the per-analysis-timeout one.
// (The fixture-06/insufficient_text case, matching the review's exact
// repro, is covered end to end through the real server in
// tests/media-lens-worker.test.js.)
// ---------------------------------------------------------------------------

test('N1: consent_at and user_asserted_public survive the oversized_input (too many spans) abstention path', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  config.limits = { ...config.limits, maxSpans: 1 };

  const prepared = prepareFromPastedText({
    text: Array.from({ length: 5 }, (_, i) => `This is paragraph number ${i + 1} with enough words to be its own span.`).join('\n\n')
  });
  assert.ok(prepared.spans.length > config.limits.maxSpans, 'sanity check: this input must actually exceed maxSpans');

  const suppliedConsentAt = '2026-07-04T00:00:00.000Z';
  const graph = await analyze({
    prepared,
    config,
    jevAdapter: createJevAdapter({ mode: 'disabled' }),
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: suppliedConsentAt
  });

  assert.equal(validate(graph).valid, true);
  assert.ok(graph.abstentions.some((a) => a.reason === 'oversized_input'));
  assert.equal(graph.artifact.authorization.consent_at, suppliedConsentAt);
  assert.equal(graph.artifact.authorization.user_asserted_public, true);
});

test('N1: consent_at and user_asserted_public survive the oversized_input (too much text) abstention path', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  config.limits = { ...config.limits, maxPreparedTextChars: 100 };

  const prepared = prepareFromPastedText({ text: 'A '.repeat(200) + 'sentence that is long enough to exceed the tiny configured limit above.' });
  assert.ok(prepared.textLengthChars > config.limits.maxPreparedTextChars, 'sanity check: this input must actually exceed maxPreparedTextChars');

  const suppliedConsentAt = '2026-07-04T00:00:00.000Z';
  const graph = await analyze({
    prepared,
    config,
    jevAdapter: createJevAdapter({ mode: 'disabled' }),
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: suppliedConsentAt
  });

  assert.equal(validate(graph).valid, true);
  assert.ok(graph.abstentions.some((a) => a.reason === 'oversized_input'));
  assert.equal(graph.artifact.authorization.consent_at, suppliedConsentAt);
  assert.equal(graph.artifact.authorization.user_asserted_public, true);
});

// ---------------------------------------------------------------------------
// N2: the losing pipeline must actually stop (abort) once the per-analysis
// timeout fires, instead of continuing to retry in the background after
// the caller has already been served an abstention graph.
// ---------------------------------------------------------------------------

test('N2: no further Jev requests are made once the per-analysis timeout has fired and the abstention is served', async () => {
  let requestCount = 0;
  const mockJev = await withMockJevServer((req, res) => {
    requestCount += 1;
    req.on('data', () => {});
    req.on('end', () => {
      // Deliberately never responds: only an explicit abort should ever
      // end this connection from the client side.
    });
  });
  const mockJevAddress = mockJev.address();

  try {
    const config = loadConfig({
      MEDIA_LENS_MODE: 'live',
      MEDIA_LENS_ENABLE_LIVE: 'true',
      MEDIA_LENS_TYPESAFE_API_KEY: 'test-key',
      MEDIA_LENS_TYPESAFE_BASE_URL: `http://127.0.0.1:${mockJevAddress.port}`
    });
    // The per-analysis timeout (50ms) fires well before the per-call
    // timeout (200ms). This is deliberate: if the outer abort were *not*
    // wired through, the first attempt would keep running until its own
    // 200ms timer fired, then retry after a ~250ms backoff -- a second
    // request would land well within this test's wait window below. With
    // the fix, the outer abort stops everything at ~50ms and no amount of
    // extra waiting produces a second request.
    config.limits = { ...config.limits, perAnalysisTimeoutMs: 50, jevCallTimeoutMs: 200 };

    const prepared = prepareFromPastedText({ text: 'A '.repeat(150) + 'sentence that is long enough to analyze in this test.' });
    const jevAdapter = createJevAdapter({
      mode: 'live',
      baseUrl: config.jev.baseUrl,
      apiKey: 'test-key',
      timeoutMs: config.limits.jevCallTimeoutMs,
      concurrency: 4
    });
    const newsjackAdapter = createNewsjackAdapter({ mode: 'disabled' });

    const graph = await analyze({
      prepared,
      config,
      jevAdapter,
      newsjackAdapter,
      userAssertedPublic: true,
      consentAt: '2026-07-04T00:00:00.000Z'
    });
    assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable'));

    const requestCountAtReturn = requestCount;
    assert.ok(requestCountAtReturn >= 1, 'expected at least the initial in-flight request(s) to have been sent');

    // If the outer abort were not wired through, the 4-attempt retry/backoff
    // shape (each with its own 5s timeout that would never even fire here,
    // since the mock never responds and ignores the abort only if we failed
    // to wire it) would keep sending requests well past this point. Wait
    // comfortably longer than a single retry backoff and confirm nothing
    // new arrived.
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(requestCount, requestCountAtReturn, 'no further Jev requests should be made after the abstention was already served');
  } finally {
    mockJev.close();
  }
});

// ---------------------------------------------------------------------------
// N3: IPv6 literal URLs must be recognized and rejected as BLOCKED_HOST,
// not fall through to DNS_ERROR because the brackets were left in place.
// ---------------------------------------------------------------------------

test('N3: assertHostIsPublic strips brackets from an IPv6 literal and rejects it as BLOCKED_HOST', async () => {
  await assert.rejects(() => assertHostIsPublic('[::1]'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('::1'), hasCode('BLOCKED_HOST'));
});

test('N3: fetchArticleSafely rejects an IPv6 loopback literal URL as BLOCKED_HOST, not DNS_ERROR', async () => {
  await assert.rejects(() => fetchArticleSafely('http://[::1]:9/secret', { timeoutMs: 1000, maxBytes: 1000 }), hasCode('BLOCKED_HOST'));
});

test('N3: media-lens/README.md documents the residual DNS-rebinding risk and IPv4-compatible ::/96', async () => {
  const { readFile } = await import('node:fs/promises');
  const readme = await readFile('media-lens/README.md', 'utf8');
  assert.match(readme, /DNS rebinding/i);
  assert.match(readme, /IPv4-compatible `::\/96`/);
  assert.match(readme, /Live URL mode is still not production-ready/);
});

// ---------------------------------------------------------------------------
// R1: IPv4-mapped IPv6 must go through the IPv4 blocked-range policy in
// every equivalent representation. The previous guard only inspected a
// dotted suffix after `::ffff:`, so hexadecimal mapped forms such as
// `::ffff:7f00:1` — which is what WHATWG URL serialization produces from
// `[::ffff:127.0.0.1]` — were treated as public and fetched in live URL
// mode. Unparsable mapped addresses must fail closed.
// ---------------------------------------------------------------------------

test('R1: assertHostIsPublic rejects IPv4-mapped IPv6 loopback in bracketed, bare, and hex forms', async () => {
  await assert.rejects(() => assertHostIsPublic('[::ffff:127.0.0.1]'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('::ffff:127.0.0.1'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('::ffff:7f00:1'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('[::ffff:7f00:1]'), hasCode('BLOCKED_HOST'));
});

test('R1: assertHostIsPublic rejects IPv4-mapped private and link-local addresses, dotted and hex', async () => {
  await assert.rejects(() => assertHostIsPublic('::ffff:169.254.169.254'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('::ffff:a9fe:a9fe'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('[::ffff:a9fe:a9fe]'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('::ffff:10.0.0.5'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('::ffff:a00:5'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => assertHostIsPublic('0:0:0:0:0:ffff:7f00:1'), hasCode('BLOCKED_HOST'));
});

test('R1: fetchArticleSafely rejects hex-mapped loopback URLs as BLOCKED_HOST after WHATWG re-serialization', async () => {
  // Dotted mapped input is re-serialized by `new URL` to [::ffff:7f00:1]
  // before the host check; that hex form is the live-mode bypass.
  await assert.rejects(
    () => fetchArticleSafely('http://[::ffff:127.0.0.1]:9/secret', { timeoutMs: 1000, maxBytes: 1000 }),
    hasCode('BLOCKED_HOST')
  );
  await assert.rejects(
    () => fetchArticleSafely('http://[::ffff:7f00:1]:9/secret', { timeoutMs: 1000, maxBytes: 1000 }),
    hasCode('BLOCKED_HOST')
  );
  await assert.rejects(
    () => fetchArticleSafely('http://[::ffff:169.254.169.254]/latest/meta-data', { timeoutMs: 1000, maxBytes: 1000 }),
    hasCode('BLOCKED_HOST')
  );
});

test('R1: a mapped public TEST-NET address is still allowed (IPv4 policy, not a blanket mapped ban)', async () => {
  await assert.doesNotReject(() => assertHostIsPublic('::ffff:203.0.113.7'));
  await assert.doesNotReject(() => assertHostIsPublic('::ffff:cb00:7107'));
});

test('R1: unparsable IPv4-mapped addresses fail closed as BLOCKED_HOST', async () => {
  const lookupImpl = async () => [{ address: '::ffff:not-valid', family: 6 }];
  await assert.rejects(() => assertHostIsPublic('example.invalid', { lookupImpl }), hasCode('BLOCKED_HOST'));
});
