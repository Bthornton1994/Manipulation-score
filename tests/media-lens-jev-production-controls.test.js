import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  DEFAULT_TYPESAFE_BUDGET_STORE_FILE,
  readBudgetStore,
  sanitizeBudgetStoreRecord
} from '../media-lens/worker/typesafe-budget-store.js';
import { abortableDelay } from '../media-lens/worker/abort-utils.js';
import {
  ALERT_RECIPIENT,
  BLOCKED_ALERT_TRANSPORT,
  buildBudgetWarnAlert,
  createAlertTransport,
  parseCredential,
  parseSmtpCredentialUrl,
  redactedSmtpEndpoint,
  resolveAlertCredentialPath,
  sendSmtpEmail,
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

  const prepared = await prepareFromPastedText({ text: 'The council voted on Tuesday to approve the drainage plan. '.repeat(12) });
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

  const prepared = await prepareFromPastedText({ text: 'A '.repeat(150) + 'long enough body.' });
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

test('R1: per-analysis timeout return prevents newsjack and downstream adapter work after abort', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  config.limits = { ...config.limits, perAnalysisTimeoutMs: 50, maxJevCallsPerAnalysis: 160 };

  const prepared = await prepareFromPastedText({ text: 'A '.repeat(150) + 'long enough body for timeout guard test.' });
  let newsjackCalls = 0;
  let cascadeCalls = 0;

  const jevAdapter = {
    mode: 'live',
    analyzeSpans: (_spans, _artifact, { signal } = {}) =>
      new Promise((resolve) => {
        signal?.addEventListener(
          'abort',
          () => {
            setTimeout(() => {
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
            }, 120);
          },
          { once: true }
        );
      })
  };

  const newsjackAdapter = {
    mode: 'artifacts',
    getStoryContext: async () => {
      newsjackCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { story_origin: null, freshness_gate: null, cluster: null, provenance: 'newsjack_artifacts' };
    }
  };

  const classifierDevAdapter = {
    enabled: true,
    classify: async () => {
      cascadeCalls += 1;
      throw new Error('classifier.dev must not run after timeout');
    }
  };

  const startedAt = Date.now();
  const graph = await analyze({
    prepared,
    config,
    jevAdapter,
    newsjackAdapter,
    classifierDevAdapter,
    userAssertedPublic: true,
    consentAt: '2026-09-21T00:00:00.000Z'
  });

  assert.ok(Date.now() - startedAt < 2000);
  assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable'));
  assert.equal(newsjackCalls, 0);
  assert.equal(cascadeCalls, 0);

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(newsjackCalls, 0);
  assert.equal(cascadeCalls, 0);
});

test('Fix 1: in-flight newsjack observes shared AbortSignal when per-analysis timeout fires', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  config.limits = { ...config.limits, perAnalysisTimeoutMs: 50, maxJevCallsPerAnalysis: 160 };

  const prepared = await prepareFromPastedText({ text: 'A '.repeat(150) + 'long enough body for in-flight newsjack abort test.' });
  let newsjackStarted = false;
  let newsjackAborted = false;

  const jevAdapter = {
    mode: 'live',
    analyzeSpans: async () => ({
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
    })
  };

  const newsjackAdapter = {
    mode: 'artifacts',
    getStoryContext: async ({ signal } = {}) => {
      newsjackStarted = true;
      try {
        await abortableDelay(5000, signal);
      } catch (err) {
        if (err?.name === 'AbortError') newsjackAborted = true;
        throw err;
      }
      return { story_origin: null, freshness_gate: null, cluster: null, provenance: 'newsjack_artifacts' };
    }
  };

  const graph = await analyze({
    prepared,
    config,
    jevAdapter,
    newsjackAdapter,
    classifierDevAdapter: createClassifierDevAdapter({ enabled: false }),
    userAssertedPublic: true,
    consentAt: '2026-09-21T00:00:00.000Z'
  });

  assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable'));
  assert.equal(newsjackStarted, true);
  assert.equal(newsjackAborted, true);
  // Jev already billed one call before newsjack hung; timeout abstention must
  // keep that count so server-side ESTIMATED budget accounting can record it.
  assert.equal(graph.engine.jev.calls, 1);
  assert.equal(graph.engine.jev.mode, 'live');
});

test('timeout after live Jev still exposes calls for ESTIMATED budget accounting', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_ENABLE_LIVE: 'true', MEDIA_LENS_TYPESAFE_API_KEY: 'k' });
  config.limits = { ...config.limits, perAnalysisTimeoutMs: 40, maxJevCallsPerAnalysis: 160 };

  const prepared = prepareFromPastedText({
    text: 'A '.repeat(150) + 'long enough body for timeout budget undercount regression.'
  });
  const billedCalls = 4;
  const budget = createTypesafeBudget({
    estimatedUsdPerCall: 1,
    warnUsd: 100,
    stopUsd: 200
  });

  const jevAdapter = {
    mode: 'live',
    analyzeSpans: async () => ({
      answersBySpanId: new Map(),
      failedSpanIds: new Set(['span-1']),
      reviewSpanIds: new Set(),
      unavailableSpanIds: new Set(['span-1']),
      dispositionsBySpanId: new Map(),
      calls: billedCalls,
      failures: 1,
      elapsedMs: 5,
      modelReported: 'jev-1.13.0',
      modelMatch: true,
      capReached: false
    })
  };

  const newsjackAdapter = {
    mode: 'artifacts',
    getStoryContext: async ({ signal } = {}) => {
      await abortableDelay(5000, signal);
      return { story_origin: null, freshness_gate: null, cluster: null, provenance: 'newsjack_artifacts' };
    }
  };

  const graph = await analyze({
    prepared,
    config,
    jevAdapter,
    newsjackAdapter,
    typesafeBudget: budget,
    userAssertedPublic: true,
    consentAt: '2026-09-21T00:00:00.000Z'
  });

  assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable'));
  assert.equal(graph.engine.jev.calls, billedCalls);
  assert.equal(validate(graph).valid, true);

  // Mirror server.js: record whatever live calls the graph reports.
  if (jevAdapter.mode === 'live' && (graph.engine?.jev?.calls || 0) > 0) {
    budget.recordCalls(graph.engine.jev.calls);
  }
  assert.equal(budget.getSnapshot().calls, billedCalls);
});

test('timeout while live Jev is in-flight still records calls once the adapter settles', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_ENABLE_LIVE: 'true', MEDIA_LENS_TYPESAFE_API_KEY: 'k' });
  config.limits = { ...config.limits, perAnalysisTimeoutMs: 30, maxJevCallsPerAnalysis: 160 };

  const prepared = prepareFromPastedText({
    text: 'A '.repeat(150) + 'long enough body for in-flight Jev timeout budget test.'
  });
  const budget = createTypesafeBudget({ estimatedUsdPerCall: 1, warnUsd: 100, stopUsd: 200 });

  const jevAdapter = {
    mode: 'live',
    analyzeSpans: (_spans, _artifact, { signal } = {}) =>
      new Promise((resolve) => {
        signal?.addEventListener(
          'abort',
          () => {
            setTimeout(() => {
              resolve({
                answersBySpanId: new Map(),
                failedSpanIds: new Set(['span-1']),
                reviewSpanIds: new Set(),
                unavailableSpanIds: new Set(['span-1']),
                dispositionsBySpanId: new Map(),
                calls: 3,
                failures: 1,
                elapsedMs: 0,
                modelReported: 'jev-1.13.0',
                modelMatch: true,
                capReached: false
              });
            }, 20);
          },
          { once: true }
        );
      })
  };

  const graph = await analyze({
    prepared,
    config,
    jevAdapter,
    newsjackAdapter: createNewsjackAdapter({ mode: 'disabled' }),
    typesafeBudget: budget,
    userAssertedPublic: true,
    consentAt: '2026-09-21T00:00:00.000Z'
  });

  assert.ok(graph.abstentions.some((a) => a.reason === 'engine_unavailable'));
  assert.equal(graph.engine.jev.calls, 3);
  if (graph.engine.jev.calls > 0) budget.recordCalls(graph.engine.jev.calls);
  assert.equal(budget.getSnapshot().calls, 3);
});

test('R2: ESTIMATED budget store persists across process restart within the same UTC month', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-budget-store-'));
  const storePath = join(dir, 'typesafe-budget.json');
  const fixedNow = () => Date.UTC(2026, 8, 21, 12, 0, 0);

  const first = createTypesafeBudget({
    estimatedUsdPerCall: 1,
    warnUsd: 20,
    stopUsd: 30,
    storePath,
    now: fixedNow
  });
  first.recordCalls(5);
  assert.equal(first.getSnapshot().calls, 5);

  const reloaded = createTypesafeBudget({
    estimatedUsdPerCall: 1,
    warnUsd: 20,
    stopUsd: 30,
    storePath,
    now: fixedNow
  });
  assert.equal(reloaded.getSnapshot().calls, 5);
  assert.equal(reloaded.wouldExceed(26), true);
  reloaded.recordCalls(25);
  assert.equal(reloaded.isStopped(), true);

  const raw = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(raw.month, '2026-09');
  assert.equal(raw.calls, 30);
  assert.equal(Object.hasOwn(raw, 'article'), false);
  assert.equal(Object.hasOwn(raw, 'text'), false);
  assert.equal(sanitizeBudgetStoreRecord({ ...raw, text: 'article body' }), null);
  assert.equal(DEFAULT_TYPESAFE_BUDGET_STORE_FILE, '/var/lib/media-lens/typesafe-budget.json');
});

test('R2b: corrupt budget store fails closed instead of resetting the monthly stop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-budget-corrupt-'));
  const storePath = join(dir, 'typesafe-budget.json');
  const fixedNow = () => Date.UTC(2026, 8, 21, 12, 0, 0);
  const opts = { estimatedUsdPerCall: 1, warnUsd: 20, stopUsd: 30, storePath, now: fixedNow };

  createTypesafeBudget(opts).recordCalls(30);
  await writeFile(storePath, '{not-json', 'utf8');

  const reloaded = createTypesafeBudget(opts);
  assert.equal(reloaded.isStopped(), true);
  assert.equal(reloaded.wouldExceed(1), true);
  assert.equal(reloaded.getSnapshot().storeUnavailable, true);
});

test('Fix 4: concurrent budget ledger warns at $20 and hard-stops at $30', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-budget-concurrent-'));
  const storePath = join(dir, 'typesafe-budget.json');
  const fixedNow = () => Date.UTC(2026, 8, 21, 12, 0, 0);
  const opts = { estimatedUsdPerCall: 1, warnUsd: 20, stopUsd: 30, storePath, now: fixedNow };

  const warnResults = await Promise.all(
    Array.from({ length: 25 }, () => createTypesafeBudget(opts).recordCalls(1))
  );
  const mid = readBudgetStore(storePath);
  assert.equal(mid.calls, 25);
  assert.equal(mid.warnEmitted, true);
  assert.ok(warnResults.some((record) => record.shouldWarn));

  const stopResults = await Promise.all(
    Array.from({ length: 5 }, () => createTypesafeBudget(opts).recordCalls(1))
  );
  const final = readBudgetStore(storePath);
  assert.equal(final.calls, 30);
  assert.equal(final.warnEmitted, true);
  assert.ok(stopResults.some((record) => record.level === 'stopped'));
  assert.ok(stopResults.every((record) => record.level === 'stopped' || record.level === 'warn'));
  assert.equal(createTypesafeBudget(opts).isStopped(), true);
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

  const prepared = await prepareFromPastedText({ text: 'The council voted on Tuesday to approve the drainage plan. '.repeat(8) });
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
    prepared: await prepareFromPastedText({ text: 'A '.repeat(150) + 'enough text here.' }),
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

test('valid smtp:// and smtps:// credentials select SMTP transport without logging secrets', async () => {
  const smtpCredential = JSON.stringify({
    type: 'smtp',
    url: 'smtp://relay-operator:REDACTED-PASS@mail.example.test:587'
  });
  const smtpCalls = [];
  const smtpTransport = createAlertTransport({
    credential: smtpCredential,
    smtpSendImpl: async ({ smtp, message }) => {
      smtpCalls.push({ smtp, subject: message.subject });
      return { ok: true };
    }
  });
  assert.equal(smtpTransport.status, 'smtp');
  assert.notEqual(smtpTransport.status, BLOCKED_ALERT_TRANSPORT);

  const parsed = parseSmtpCredentialUrl(JSON.parse(smtpCredential).url);
  assert.deepEqual(redactedSmtpEndpoint(parsed), { host: 'mail.example.test', port: 587, secure: false });
  assert.equal(parsed.user, 'relay-operator');
  assert.equal(Object.hasOwn(redactedSmtpEndpoint(parsed), 'user'), false);
  assert.equal(Object.hasOwn(redactedSmtpEndpoint(parsed), 'pass'), false);

  const message = buildBudgetWarnAlert({
    estimatedUsd: 20,
    warnUsd: 20,
    stopUsd: 30,
    basis: 'ESTIMATED',
    calculationInputs: { estimatedUsdPerCall: 0.002, recordedCalls: 1 }
  });
  const sendResult = await smtpTransport.send(message);
  assert.equal(sendResult.ok, true);
  assert.equal(smtpCalls.length, 1);
  assert.deepEqual(smtpCalls[0].smtp, { host: 'mail.example.test', port: 587, secure: false });
  assert.equal(JSON.stringify(smtpCalls).includes('REDACTED-PASS'), false);
  assert.equal(JSON.stringify(smtpCalls).includes('relay-operator'), false);

  const smtpsTransport = createAlertTransport({
    credential: 'smtps://alerts%40example.test:secret@secure-mail.example.test:465',
    smtpSendImpl: async () => ({ ok: true })
  });
  assert.equal(smtpsTransport.status, 'smtp');
  assert.deepEqual(parseSmtpCredentialUrl('smtps://alerts%40example.test:secret@secure-mail.example.test:465'), {
    host: 'secure-mail.example.test',
    port: 465,
    secure: true,
    user: 'alerts@example.test',
    pass: 'secret'
  });
});

test('malformed or non-alert credentials remain BLOCKED_ALERT_TRANSPORT', () => {
  for (const credential of [
    null,
    '',
    'not-a-url',
    '{"type":"smtp"}',
    '{"type":"webhook","url":"smtp://x"}',
    '{"type":"webhook","url":"http://hooks.example.test/alert"}',
    'http://hooks.example.test/alert',
    'ftp://relay.example.test'
  ]) {
    const transport = createAlertTransport({ credential });
    assert.equal(transport.status, BLOCKED_ALERT_TRANSPORT, `credential ${String(credential)} must block`);
  }
  assert.equal(parseCredential('{"type":"webhook","url":"https://hooks.example.test/alert"}')?.type, 'webhook');
  assert.equal(parseCredential('smtp://user:pass@mail.example.test:587')?.type, 'smtp');
});

test('Fix 3: webhook transport accepts only https:// URLs', () => {
  assert.equal(parseCredential('http://hooks.example.test/alert'), null);
  assert.equal(parseCredential('{"type":"webhook","url":"http://hooks.example.test/alert"}'), null);
  assert.equal(createAlertTransport({ credential: 'http://hooks.example.test/alert' }).status, BLOCKED_ALERT_TRANSPORT);
});

test('webhook https credential still uses webhook transport', async () => {
  let fetchCalled = false;
  const transport = createAlertTransport({
    credential: JSON.stringify({ type: 'webhook', url: 'https://hooks.example.test/media-lens-alert' }),
    fetchImpl: async () => {
      fetchCalled = true;
      return { ok: true, status: 200 };
    }
  });
  assert.equal(transport.status, 'webhook');
  const result = await transport.send(
    buildBudgetWarnAlert({
      estimatedUsd: 20,
      warnUsd: 20,
      stopUsd: 30,
      basis: 'ESTIMATED',
      calculationInputs: { estimatedUsdPerCall: 0.002, recordedCalls: 1 }
    })
  );
  assert.equal(result.ok, true);
  assert.equal(fetchCalled, true);
});

class MockSmtpSocket {
  constructor(responses) {
    this.pendingResponses = responses.slice();
    this.written = [];
    this.listeners = new Map();
    this.dataBuffer = [];
    if (this.pendingResponses.length > 0) {
      this.queueData(this.pendingResponses.shift());
    }
  }

  queueData(chunk) {
    const handlers = this.listeners.get('data');
    if (!handlers || handlers.size === 0) {
      this.dataBuffer.push(chunk);
      return;
    }
    queueMicrotask(() => this.emit('data', chunk));
  }

  write(data) {
    this.written.push(data);
    const chunk = this.pendingResponses.shift();
    if (chunk) this.queueData(chunk);
  }

  once(event, handler) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    this.on(event, wrapped);
    if (event === 'data' && this.dataBuffer.length > 0) {
      const chunk = this.dataBuffer.shift();
      queueMicrotask(() => wrapped(chunk));
    }
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event, ...args) {
    for (const handler of this.listeners.get(event) || []) handler(...args);
  }

  end() {}
}

function mockSmtpConnect(responses) {
  return async () => new MockSmtpSocket(responses);
}

test('Fix 2: smtp:// without STARTTLS fails closed before AUTH', async () => {
  const smtp = parseSmtpCredentialUrl('smtp://relay:secret@mail.example.test:587');
  const result = await sendSmtpEmail({
    smtp,
    message: { subject: 'test', text: 'hello' },
    connectImpl: mockSmtpConnect(['220 mail.example.test ESMTP\r\n', '250-mail.example.test\r\n250 SIZE 1234\r\n'])
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'smtp_starttls_required');
});

test('Fix 2: smtp:// negotiates STARTTLS before AUTH', async () => {
  const smtp = parseSmtpCredentialUrl('smtp://relay:secret@mail.example.test:587');
  const result = await sendSmtpEmail({
    smtp,
    message: { subject: 'test', text: 'hello' },
    connectImpl: mockSmtpConnect([
      '220 mail.example.test ESMTP\r\n',
      '250-mail.example.test\r\n250 STARTTLS\r\n',
      '220 Ready to start TLS\r\n',
      '250-mail.example.test\r\n250 AUTH LOGIN\r\n',
      '334 Username:\r\n',
      '334 Password:\r\n',
      '235 Authenticated\r\n',
      '250 OK\r\n',
      '250 OK\r\n',
      '354 End data\r\n',
      '250 OK\r\n',
      '221 Bye\r\n'
    ]),
    startTlsImpl: async (socket) => socket
  });
  assert.equal(result.ok, true);
});

test('Fix 2: smtps://465 uses implicit TLS without STARTTLS upgrade', async () => {
  const smtp = parseSmtpCredentialUrl('smtps://relay:secret@secure-mail.example.test:465');
  const result = await sendSmtpEmail({
    smtp,
    message: { subject: 'test', text: 'hello' },
    connectImpl: mockSmtpConnect([
      '220 secure-mail.example.test ESMTP\r\n',
      '250-secure-mail.example.test\r\n250 AUTH LOGIN\r\n',
      '334 Username:\r\n',
      '334 Password:\r\n',
      '235 Authenticated\r\n',
      '250 OK\r\n',
      '250 OK\r\n',
      '354 End data\r\n',
      '250 OK\r\n',
      '221 Bye\r\n'
    ])
  });
  assert.equal(result.ok, true);
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
        html:
          '<html lang="en"><body><p>' +
          'The council voted on Tuesday to approve the drainage plan after the river flooded downtown streets. '.repeat(12) +
          '</p></body></html>'
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
