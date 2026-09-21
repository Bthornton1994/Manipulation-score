import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../media-lens/worker/server.js';
import {
  DEFAULT_LIMITS,
  LIVE_URL_OVERSIZED_MESSAGE,
  loadConfig,
  publicConfig,
  effectiveLiveFlags,
  isKillSwitchAsserted
} from '../media-lens/worker/config.js';
import { analyze } from '../media-lens/worker/analyze.js';
import { prepareFromPastedText, emptyPreparedArtifactStub } from '../media-lens/worker/prepare.js';
import { createJevAdapter } from '../media-lens/worker/adapters/jev.js';
import { createNewsjackAdapter } from '../media-lens/worker/adapters/newsjack.js';
import { createClassifierDevAdapter } from '../media-lens/worker/adapters/classifier-dev.js';
import { createTypesafeBudget } from '../media-lens/worker/typesafe-budget.js';
import {
  ALERT_RECIPIENT,
  BLOCKED_ALERT_TRANSPORT,
  buildBudgetWarnAlert,
  createAlertTransport,
  resolveAlertCredentialPath,
  shouldRunAlertDeliveryTest
} from '../media-lens/worker/alert.js';
import { validate } from '../media-lens/schema/validate.js';

const EXACT_LIVE_URL_OVERSIZED =
  'This public page is too long for Media Lens live analysis. No manipulation analysis or score was generated. Try a shorter public article.';

function requestJson(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body ? JSON.stringify(body) : undefined;
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
        res.on('data', (chunk) => (raw += chunk));
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

function liveUrlConfig(extra = {}) {
  return loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_ENABLE_LIVE_URL: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'sk-test-key-not-for-logs',
    MEDIA_LENS_PORT: '0',
    ...extra
  });
}

test('DEFAULT_LIMITS use Jev-only production controls (5/5/2/1, 160 cap, 15s analysis)', () => {
  assert.equal(DEFAULT_LIMITS.maxAnalysesPerMinute, 5);
  assert.equal(DEFAULT_LIMITS.maxLiveUrlPerMinute, 5);
  assert.equal(DEFAULT_LIMITS.maxLiveUrlPerHostPerMinute, 2);
  assert.equal(DEFAULT_LIMITS.maxConcurrentLiveUrl, 1);
  assert.equal(DEFAULT_LIMITS.maxJevCallsPerAnalysis, 160);
  assert.equal(DEFAULT_LIMITS.perAnalysisTimeoutMs, 15000);
  assert.equal(LIVE_URL_OVERSIZED_MESSAGE, EXACT_LIVE_URL_OVERSIZED);
});

test('publicConfig /health exposes updated limits, ESTIMATED budget, and alert transport status', async () => {
  const config = liveUrlConfig();
  const view = publicConfig(config);
  assert.equal(view.limits.maxAnalysesPerMinute, 5);
  assert.equal(view.limits.maxLiveUrlPerMinute, 5);
  assert.equal(view.limits.maxLiveUrlPerHostPerMinute, 2);
  assert.equal(view.limits.maxConcurrentLiveUrl, 1);
  assert.equal(view.limits.maxJevCallsPerAnalysis, 160);
  assert.equal(view.limits.perAnalysisTimeoutMs, 15000);
  assert.equal(view.typesafeBudget.basis, 'ESTIMATED');
  assert.equal(view.typesafeBudget.warnUsd, 20);
  assert.equal(view.typesafeBudget.stopUsd, 30);
  assert.equal(view.alert.recipient, ALERT_RECIPIENT);
  assert.equal(view.alert.transport, BLOCKED_ALERT_TRANSPORT);
  assert.equal(Object.hasOwn(view, 'secrets'), false);

  const server = await listen(createServer(config));
  try {
    const health = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(health.body.limits.maxJevCallsPerAnalysis, 160);
    assert.equal(health.body.typesafeBudget.basis, 'ESTIMATED');
    assert.equal(health.body.alert.transport, BLOCKED_ALERT_TRANSPORT);
  } finally {
    server.close();
  }
});

test('hard Jev cap (160) fail-closes with controlled abstention when span budget is exceeded', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_ENABLE_LIVE: 'true' });
  config.limits = { ...config.limits, maxJevCallsPerAnalysis: 2 };

  const prepared = prepareFromPastedText({ text: 'Word '.repeat(200) });
  prepared.artifact.inputMode = 'url';
  prepared.spans = Array.from({ length: 3 }, (_, i) => ({
    id: `span-${i}`,
    role: 'authorial',
    text: `Span ${i} with enough words to pass minimum checks easily here.`
  }));

  let fetchHits = 0;
  const jevAdapter = createJevAdapter({
    mode: 'live',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'test-key',
    maxCallsPerAnalysis: config.limits.maxJevCallsPerAnalysis,
    fetchImpl: async () => {
      fetchHits += 1;
      throw new Error('must not call provider when cap pre-check fails');
    }
  });

  const graph = await analyze({
    prepared,
    config,
    jevAdapter,
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: '2026-09-21T00:00:00.000Z'
  });

  assert.equal(fetchHits, 0);
  assert.equal(validate(graph).valid, true);
  assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable' && a.message.includes('Jev call cap')));
});

test('perAnalysisTimeoutMs aborts in-flight Jev via shared AbortController', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  config.limits = { ...config.limits, perAnalysisTimeoutMs: 60, maxJevCallsPerAnalysis: 160 };

  const prepared = prepareFromPastedText({ text: 'A '.repeat(150) + 'long enough body.' });
  let abortSeen = false;
  const jevAdapter = {
    mode: 'live',
    analyzeSpans: (_spans, _artifact, { signal } = {}) =>
      new Promise((resolve) => {
        signal?.addEventListener('abort', () => {
          abortSeen = true;
          resolve({
            answersBySpanId: new Map(),
            failedSpanIds: new Set(['span-1']),
            reviewSpanIds: new Set(),
            unavailableSpanIds: new Set(['span-1']),
            dispositionsBySpanId: new Map(),
            calls: 1,
            failures: 1,
            elapsedMs: 0,
            modelReported: null,
            modelMatch: null,
            capReached: false
          });
        });
      })
  };

  const startedAt = Date.now();
  const graph = await analyze({
    prepared,
    config,
    jevAdapter,
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: '2026-09-21T00:00:00.000Z'
  });

  assert.equal(abortSeen, true);
  assert.ok(Date.now() - startedAt < 2000);
  assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable'));
});

test('default rate limits fail-closed at 5 analyses/min, 5 live URL/min, 2/host/min, concurrency 1', async () => {
  const defaults = liveUrlConfig();
  assert.equal(defaults.limits.maxAnalysesPerMinute, 5);
  assert.equal(defaults.limits.maxLiveUrlPerMinute, 5);
  assert.equal(defaults.limits.maxLiveUrlPerHostPerMinute, 2);
  assert.equal(defaults.limits.maxConcurrentLiveUrl, 1);

  const config = liveUrlConfig({
    MEDIA_LENS_MAX_ANALYSES_PER_MINUTE: '50',
    MEDIA_LENS_MAX_LIVE_URL_PER_HOST_PER_MINUTE: '50'
  });

  let fetchHits = 0;
  const server = await listen(
    createServer(config, {
      fetchArticle: async () => {
        fetchHits += 1;
        throw Object.assign(new Error('mock fetch failure'), { code: 'FETCH_ERROR' });
      }
    })
  );
  try {
    const urlBody = { user_asserted_public: true, mode: 'url', url: 'http://8.8.8.8/article' };
    for (let i = 0; i < 5; i += 1) {
      const res = await requestJson(server, { method: 'POST', path: '/analyze', body: urlBody });
      assert.notEqual(res.status, 429, `request ${i + 1} should not be rate limited yet`);
    }
    const sixth = await requestJson(server, { method: 'POST', path: '/analyze', body: urlBody });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error, 'rate_limited');
    assert.equal(fetchHits, 5);
  } finally {
    server.close();
  }

  const hostConfig = liveUrlConfig({
    MEDIA_LENS_MAX_ANALYSES_PER_MINUTE: '50',
    MEDIA_LENS_MAX_LIVE_URL_PER_MINUTE: '50'
  });
  assert.equal(hostConfig.limits.maxLiveUrlPerHostPerMinute, 2);
  const hostServer = await listen(
    createServer(hostConfig, {
      fetchArticle: async () => {
        throw Object.assign(new Error('mock fetch failure'), { code: 'FETCH_ERROR' });
      }
    })
  );
  try {
    const hostBody = { user_asserted_public: true, mode: 'url', url: 'http://8.8.8.8/host-limit' };
    await requestJson(hostServer, { method: 'POST', path: '/analyze', body: hostBody });
    await requestJson(hostServer, { method: 'POST', path: '/analyze', body: hostBody });
    const thirdHost = await requestJson(hostServer, { method: 'POST', path: '/analyze', body: hostBody });
    assert.equal(thirdHost.status, 429);
    assert.equal(thirdHost.body.error, 'rate_limited');
  } finally {
    hostServer.close();
  }
});

test('live URL oversized_input uses the exact locked copy string', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_ENABLE_LIVE: 'true' });
  config.limits = { ...config.limits, maxPreparedTextChars: 100 };

  const prepared = prepareFromPastedText({ text: 'Word '.repeat(80) });
  prepared.artifact.inputMode = 'url';

  const graph = await analyze({
    prepared,
    config,
    jevAdapter: createJevAdapter({ mode: 'disabled' }),
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    userAssertedPublic: true,
    consentAt: '2026-09-21T00:00:00.000Z'
  });

  const abstention = graph.abstentions.find((a) => a.reason === 'oversized_input');
  assert.ok(abstention);
  assert.equal(abstention.message, EXACT_LIVE_URL_OVERSIZED);
});

test('TypeSafe ESTIMATED budget warns at $20 and hard-stops at $30 without recording article text', () => {
  const budget = createTypesafeBudget({
    estimatedUsdPerCall: 1,
    warnUsd: 20,
    stopUsd: 30
  });

  for (let i = 0; i < 19; i += 1) {
    const record = budget.recordCalls(1);
    assert.equal(record.level, 'ok');
    assert.equal(record.shouldWarn, false);
  }
  const warnRecord = budget.recordCalls(1);
  assert.equal(warnRecord.level, 'warn');
  assert.equal(warnRecord.shouldWarn, true);
  assert.equal(warnRecord.estimatedUsd, 20);
  assert.equal(warnRecord.basis, 'ESTIMATED');
  assert.equal(JSON.stringify(warnRecord).includes('article'), false);

  for (let i = 0; i < 9; i += 1) budget.recordCalls(1);
  assert.equal(budget.isStopped(), false);
  assert.equal(budget.wouldExceed(2), true);
  const stopRecord = budget.recordCalls(1);
  assert.equal(stopRecord.level, 'stopped');
  assert.equal(stopRecord.estimatedUsd, 30);
});

test('analyze fail-closes live Jev when ESTIMATED monthly budget is already stopped', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_ENABLE_LIVE: 'true' });
  const budget = createTypesafeBudget({ estimatedUsdPerCall: 30, warnUsd: 20, stopUsd: 30 });
  budget.recordCalls(1);

  let fetchHits = 0;
  const graph = await analyze({
    prepared: prepareFromPastedText({ text: 'A '.repeat(150) + 'enough text here.' }),
    config,
    jevAdapter: createJevAdapter({
      mode: 'live',
      baseUrl: 'http://127.0.0.1:9',
      apiKey: 'test-key',
      fetchImpl: async () => {
        fetchHits += 1;
        throw new Error('must not call provider when budget stopped');
      }
    }),
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    typesafeBudget: budget,
    userAssertedPublic: true,
    consentAt: '2026-09-21T00:00:00.000Z'
  });

  assert.equal(fetchHits, 0);
  assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable' && a.message.includes('ESTIMATED monthly spend')));
});

test('classifier.dev and pasted-text remain zero-call when disabled', async () => {
  const unset = loadConfig({});
  assert.equal(unset.classifierDev.enabled, false);
  assert.equal(effectiveLiveFlags(unset).classifierDevEnabled, false);

  let cdevHits = 0;
  const cdevAdapter = createClassifierDevAdapter({
    enabled: false,
    baseUrl: 'http://127.0.0.1:9',
    fetchImpl: async () => {
      cdevHits += 1;
      throw new Error('must not call classifier.dev when disabled');
    }
  });
  const result = await cdevAdapter.classify({
    inputs: [{ text: 'public span text' }],
    labels: ['none']
  });
  assert.equal(cdevHits, 0);
  assert.equal(result.meta.status, 'disabled');

  const config = liveUrlConfig();
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'pasted_text', text: 'Public pasted text that is definitely long enough to analyze here.' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'live_pasted_text_disabled');
  } finally {
    server.close();
  }
});

test('kill switch blocks live externals with zero provider calls', async () => {
  let fetchHits = 0;
  let jevHits = 0;
  const mockJev = http.createServer((req, res) => {
    jevHits += 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'jev-1.13.0', answers: {} }));
  });
  await new Promise((resolve) => mockJev.listen(0, '127.0.0.1', resolve));

  const config = liveUrlConfig({
    MEDIA_LENS_KILL_SWITCH: 'true',
    MEDIA_LENS_TYPESAFE_BASE_URL: `http://127.0.0.1:${mockJev.address().port}`
  });
  const server = await listen(
    createServer(config, {
      fetchArticle: async () => {
        fetchHits += 1;
        throw new Error('must not fetch under kill switch');
      }
    })
  );
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'url', url: 'http://8.8.8.8/article' }
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'live_killed');
    assert.equal(fetchHits, 0);
    assert.equal(jevHits, 0);
    assert.equal(isKillSwitchAsserted(config), true);
  } finally {
    server.close();
    mockJev.close();
  }
});

test('alert transport mock passes in CI; real delivery stays blocked without LoadCredential', async () => {
  const sent = [];
  const mock = createAlertTransport({
    sendImpl: async (message) => {
      sent.push(message);
      return { ok: true };
    }
  });
  const message = buildBudgetWarnAlert({
    estimatedUsd: 20,
    warnUsd: 20,
    stopUsd: 30,
    basis: 'ESTIMATED',
    calculationInputs: { estimatedUsdPerCall: 0.002, recordedCalls: 1 }
  });
  const result = await mock.send(message);
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /ESTIMATED/);
  assert.ok(sent[0].text.includes(ALERT_RECIPIENT));

  const blocked = createAlertTransport({ credential: null });
  assert.equal(blocked.status, BLOCKED_ALERT_TRANSPORT);
  const blockedResult = await blocked.send(message);
  assert.equal(blockedResult.ok, false);
  assert.equal(blockedResult.reason, BLOCKED_ALERT_TRANSPORT);
  assert.equal(shouldRunAlertDeliveryTest({}), false);
  assert.equal(
    shouldRunAlertDeliveryTest({ MEDIA_LENS_ALERT_DELIVERY_TEST: 'true', MEDIA_LENS_ALERT_CREDENTIAL_FILE: '/missing/path' }),
    false
  );
  assert.equal(resolveAlertCredentialPath({ CREDENTIALS_DIRECTORY: '/run/credentials' }).endsWith('media-lens-alert'), true);
});

test('server emits budget warn alert through injected mock transport without blocking analyze', async () => {
  const config = liveUrlConfig({
    MEDIA_LENS_TYPESAFE_ESTIMATED_USD_PER_CALL: '10',
    MEDIA_LENS_TYPESAFE_BUDGET_WARN_USD: '10',
    MEDIA_LENS_TYPESAFE_BUDGET_STOP_USD: '30'
  });
  const sent = [];
  const budget = createTypesafeBudget({
    estimatedUsdPerCall: 10,
    warnUsd: 10,
    stopUsd: 30
  });

  const mockJev = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          influence_signal: {
            type: 'choice',
            choice: 'none',
            probabilities: { none: 1 },
            confidence: 0.9
          },
          is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
        }
      })
    );
  });
  await new Promise((resolve) => mockJev.listen(0, '127.0.0.1', resolve));
  config.jev.baseUrl = `http://127.0.0.1:${mockJev.address().port}`;

  const server = await listen(
    createServer(config, {
      typesafeBudget: budget,
      alertTransport: createAlertTransport({
        sendImpl: async (message) => {
          sent.push(message);
          return { ok: true };
        }
      }),
      fetchArticle: async () => ({
        html: '<html><body><p>' + 'Word '.repeat(200) + '</p></body></html>'
      })
    })
  );
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'url', url: 'http://8.8.8.8/article' }
    });
    assert.equal(res.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(sent.length >= 1, 'budget warn alert should be sent through mock transport');
    assert.match(sent[0].text, /ESTIMATED/);
  } finally {
    server.close();
    mockJev.close();
  }
});
