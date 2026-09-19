import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  CLASSIFY_PATH,
  DEFAULT_BASE_URL,
  STATIC_INSTRUCTIONS,
  buildClassifyRequest,
  classifyUrl,
  isRetryableClassifierDevStatus,
  parseRetryAfterMs,
  resolveClassifierDevBaseUrl,
  validateClassifyResponse
} from '../media-lens/worker/classifier-dev/contract.js';
import { CDEV_LABEL_IDS } from '../media-lens/worker/classifier-dev/taxonomy.js';
import { createClassifierDevAdapter } from '../media-lens/worker/adapters/classifier-dev.js';
import { createCircuitBreaker, createDailyBudget } from '../media-lens/worker/classifier-dev/ops.js';
import { classifierDevAdapterEnabled, loadConfig } from '../media-lens/worker/config.js';
import { createAuditLogger, redactAuditRecord, AUDIT_EVENTS } from '../media-lens/worker/audit.js';

async function withMockServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, server);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(JSON.parse(raw || '{}')));
  });
}

function okBody({ label = 'no_detected_signal', confidence = 0.9, model = 'jev-eval', tier = 'smart' } = {}) {
  return {
    tier,
    model,
    results: [{ label, confidence, scores: { [label]: confidence }, model }],
    usage: { classifications: 1 }
  };
}

test('versioned classify path is /v1/classify, not unversioned /', () => {
  assert.equal(CLASSIFY_PATH, '/v1/classify');
  assert.equal(classifyUrl(DEFAULT_BASE_URL), 'https://classifier.dev/v1/classify');
  assert.notEqual(classifyUrl(DEFAULT_BASE_URL), 'https://classifier.dev/');
  assert.notEqual(classifyUrl(DEFAULT_BASE_URL), 'https://classifier.dev/v1/classify/batch');
});

test('request schema accepts inputs+labels and rejects empty or oversized fields', () => {
  const ok = buildClassifyRequest({
    inputs: ['The committee met on Tuesday.'],
    labels: ['alpha', 'beta'],
    tier: 'smart'
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.body.inputs, ['The committee met on Tuesday.']);
  assert.equal(ok.body.tier, 'smart');
  assert.equal(ok.body.instructions, STATIC_INSTRUCTIONS);

  assert.equal(buildClassifyRequest({ inputs: [], labels: ['a', 'b'] }).ok, false);
  assert.ok(buildClassifyRequest({ inputs: ['x'], labels: ['only'] }).errors.includes('too_few_labels'));
  assert.ok(buildClassifyRequest({ inputs: [''], labels: ['a', 'b'] }).errors.includes('empty_input'));
  assert.ok(buildClassifyRequest({ inputs: ['x'], labels: ['a', 'a'] }).errors.includes('duplicate_labels'));
  assert.ok(buildClassifyRequest({ inputs: ['x'], labels: ['a', 'b'], tier: 'other' }).errors.includes('bad_tier'));
});

test('response schema requires matching results, a model, and in-taxonomy labels', () => {
  const inputs = ['hello'];
  const labels = ['alpha', 'beta'];
  const valid = validateClassifyResponse(
    {
      tier: 'fast',
      model: 'jev-eval',
      results: [{ label: 'alpha', confidence: 0.8, scores: { alpha: 0.8 } }]
    },
    { inputs, labels, requestedTier: 'fast' }
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.body.modelMatch, true);

  assert.equal(
    validateClassifyResponse({ tier: 'fast', model: 'jev-eval', results: [] }, { inputs, labels, requestedTier: 'fast' }).ok,
    false
  );
  assert.equal(
    validateClassifyResponse(
      { tier: 'fast', model: 'jev-eval', results: [{ label: 'gamma', confidence: 0.9 }] },
      { inputs, labels, requestedTier: 'fast' }
    ).reason,
    'label_not_in_request'
  );
  assert.equal(
    validateClassifyResponse(
      { tier: 'fast', model: 'mixed', results: [{ label: 'alpha', confidence: 0.9, scores: { alpha: 0.9 } }] },
      { inputs, labels, requestedTier: 'fast' }
    ).body.modelMatch,
    false
  );
});

test('retryable statuses are 429 and selected 502 codes only', () => {
  assert.equal(isRetryableClassifierDevStatus(429, 'rate_limit_minute'), true);
  assert.equal(isRetryableClassifierDevStatus(502, 'typesafe'), true);
  assert.equal(isRetryableClassifierDevStatus(502, 'typesafe_503'), true);
  assert.equal(isRetryableClassifierDevStatus(502, 'openrouter_502'), true);
  assert.equal(isRetryableClassifierDevStatus(502, 'timeout'), true);
  assert.equal(isRetryableClassifierDevStatus(502, 'mystery'), false);
  assert.equal(isRetryableClassifierDevStatus(500, 'internal'), false);
  assert.equal(isRetryableClassifierDevStatus(400, 'bad_json'), false);
  assert.equal(parseRetryAfterMs({ get: (name) => (name.toLowerCase() === 'retry-after' ? '2' : null) }), 2000);
});

test('base URL rejects credentials and non-loopback http', () => {
  assert.equal(resolveClassifierDevBaseUrl('https://classifier.dev').ok, true);
  assert.equal(resolveClassifierDevBaseUrl('https://user:pass@classifier.dev').ok, false);
  assert.equal(resolveClassifierDevBaseUrl('http://example.com').ok, false);
  assert.equal(resolveClassifierDevBaseUrl('http://127.0.0.1:9').ok, true);
});

test('MEDIA_LENS_ENABLE_CLASSIFIER_DEV default-off makes zero network calls', async () => {
  let hits = 0;
  const config = loadConfig({});
  assert.equal(config.classifierDev.enabled, false);
  assert.equal(classifierDevAdapterEnabled(config), false);
  const adapter = createClassifierDevAdapter({
    enabled: classifierDevAdapterEnabled(config),
    fetchImpl: async () => {
      hits += 1;
      throw new Error('default-off must not fetch');
    }
  });
  const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: ['alpha', 'beta'] });
  assert.equal(hits, 0);
  assert.equal(result.networkCalls, 0);
  assert.equal(result.results[0].reason, 'disabled');
});

test('kill switch makes zero network calls even when the enable flag is true', async () => {
  let hits = 0;
  const adapter = createClassifierDevAdapter({
    enabled: true,
    isKillSwitchAsserted: () => true,
    fetchImpl: async () => {
      hits += 1;
      throw new Error('kill switch must not fetch');
    }
  });
  const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: ['alpha', 'beta'] });
  assert.equal(hits, 0);
  assert.equal(result.networkCalls, 0);
  assert.equal(result.results[0].reason, 'killed');
});

test('mock /v1/classify succeeds; unversioned / is not used', async () => {
  let pathSeen = null;
  await withMockServer(
    async (req, res) => {
      pathSeen = req.url;
      const body = await readJsonBody(req);
      assert.equal(Array.isArray(body.inputs), true);
      assert.equal(body.tier, 'smart');
      res.writeHead(200, { 'content-type': 'application/json', 'x-api-version': 'v1' });
      res.end(JSON.stringify(okBody({ label: 'no_detected_signal' })));
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({
        enabled: true,
        baseUrl: base,
        fetchImpl: globalThis.fetch
      });
      const result = await adapter.classify({
        inputs: ['The committee met on Tuesday.'],
        labels: CDEV_LABEL_IDS
      });
      assert.equal(result.ok, true);
      assert.equal(result.networkCalls, 1);
      assert.equal(result.meta.api_version, 'v1');
      assert.equal(result.results[0].label, 'no_detected_signal');
      assert.equal(pathSeen, '/v1/classify');
    }
  );
});

test('429 is retried with Retry-After and then succeeds', async () => {
  let hits = 0;
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      hits += 1;
      if (hits === 1) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        res.end(JSON.stringify({ error: 'rate limited', code: 'rate_limit_minute' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'x-api-version': 'v1' });
      res.end(JSON.stringify(okBody()));
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base });
      const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
      assert.equal(result.ok, true);
      assert.equal(hits, 2);
      assert.equal(result.meta.retries, 1);
    }
  );
});

test('selected 502 typesafe is retried; unselected 502 is not', async () => {
  let selectedHits = 0;
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      selectedHits += 1;
      if (selectedHits === 1) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream', code: 'typesafe' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(okBody()));
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base });
      const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
      assert.equal(result.ok, true);
      assert.equal(selectedHits, 2);
    }
  );

  let otherHits = 0;
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      otherHits += 1;
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'nope', code: 'mystery' }));
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base });
      const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
      assert.equal(result.ok, false);
      assert.equal(otherHits, 1);
      assert.match(result.results[0].reason, /http_502/);
    }
  );
});

test('malformed JSON and result-length mismatch fail closed without retry', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{not-json');
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base });
      const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
      assert.equal(result.ok, false);
      assert.equal(result.results[0].reason, 'malformed_json');
    }
  );

  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tier: 'smart', model: 'jev-eval', results: [] }));
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base });
      const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
      assert.equal(result.results[0].reason, 'results_length_mismatch');
    }
  );
});

test('model mismatch is recorded and not treated as a silent success', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          tier: 'smart',
          model: 'mixed',
          results: [{ label: 'no_detected_signal', confidence: 0.9, scores: { no_detected_signal: 0.9 } }]
        })
      );
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base });
      const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
      assert.equal(result.results[0].ok, true);
      assert.equal(result.results[0].reason, 'model_mismatch');
      assert.equal(result.results[0].modelMatch, false);
    }
  );
});

test('timeout uses AbortController and does not retry', async () => {
  let hits = 0;
  await withMockServer(
    (req, res) => {
      hits += 1;
      req.resume();
      // never respond before the test timeout
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(okBody()));
      }, 400);
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base, timeoutMs: 50 });
      const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
      assert.equal(result.results[0].reason, 'timeout');
      assert.equal(hits, 1);
    }
  );
});

test('batch limit splits requests; daily budget fail-closes leftover inputs', async () => {
  let hits = 0;
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      hits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          tier: 'smart',
          model: 'jev-eval',
          results: [{ label: 'no_detected_signal', confidence: 0.9, scores: { no_detected_signal: 0.9 } }],
          usage: { classifications: 1 }
        })
      );
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({
        enabled: true,
        baseUrl: base,
        maxBatch: 1,
        dailyBudget: createDailyBudget(1)
      });
      const result = await adapter.classify({
        inputs: ['The committee met on Tuesday.', 'Rain is expected overnight.'],
        labels: CDEV_LABEL_IDS
      });
      assert.equal(hits, 1);
      assert.equal(result.results[0].ok, true);
      assert.equal(result.results[1].reason, 'daily_budget');
    }
  );
});

test('circuit breaker opens after repeated timeouts and then makes zero calls', async () => {
  let hits = 0;
  let now = 0;
  const circuit = createCircuitBreaker({ failureThreshold: 2, resetMs: 60_000, now: () => now });
  await withMockServer(
    (req, res) => {
      hits += 1;
      req.resume();
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(okBody()));
      }, 200);
    },
    async (base) => {
      const adapter = createClassifierDevAdapter({
        enabled: true,
        baseUrl: base,
        timeoutMs: 30,
        circuit,
        now: () => now
      });
      await adapter.classify({ inputs: ['one'], labels: CDEV_LABEL_IDS });
      await adapter.classify({ inputs: ['two'], labels: CDEV_LABEL_IDS });
      const before = hits;
      const third = await adapter.classify({ inputs: ['three'], labels: CDEV_LABEL_IDS });
      assert.equal(hits, before);
      assert.equal(third.results[0].reason, 'circuit_open');
    }
  );
});

test('redacted audit never keeps raw text, bearer tokens, or Authorization', () => {
  const dropped = redactAuditRecord({
    event: AUDIT_EVENTS.CLASSIFIER_DEV_CASCADE,
    cdev_model: 'jev-eval',
    text: 'secret article body',
    Authorization: 'Bearer sk-super-secret-value',
    cdev_calls: 1
  });
  assert.equal(dropped.event, AUDIT_EVENTS.CLASSIFIER_DEV_CASCADE);
  assert.equal(dropped.cdev_calls, 1);
  assert.equal(Object.hasOwn(dropped, 'text'), false);
  assert.equal(Object.hasOwn(dropped, 'Authorization'), false);
  const lines = [];
  const logger = createAuditLogger({ write: (line) => lines.push(line) });
  logger.emit(AUDIT_EVENTS.CLASSIFIER_DEV_CASCADE, {
    cdev_calls: 2,
    Authorization: 'Bearer sk-super-secret-value'
  });
  assert.doesNotMatch(lines.join('\n'), /sk-super-secret-value/);
  assert.doesNotMatch(lines.join('\n'), /Bearer /);
});

test('adapter source never logs request bodies or Authorization headers', async () => {
  const src = await readFile('media-lens/worker/adapters/classifier-dev.js', 'utf8');
  assert.doesNotMatch(src, /console\.(log|info|debug)\(/);
  assert.doesNotMatch(src, /['"`]authorization['"`]\s*:/i);
  assert.doesNotMatch(src, /authorization:\s*`Bearer/i);
});
