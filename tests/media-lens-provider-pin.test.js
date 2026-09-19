// Issue #118 remediation C: connect-time pin for live Jev and classifier.dev.
// Local mocks and loopback fixtures only. Live flags stay off. No API keys.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import {
  createJevAdapter,
  loadQuestionSet,
  buildContractAnswers,
  JEV_MODEL_REQUESTED
} from '../media-lens/worker/adapters/jev.js';
import { createClassifierDevAdapter } from '../media-lens/worker/adapters/classifier-dev.js';
import { CDEV_LABEL_IDS } from '../media-lens/worker/classifier-dev/taxonomy.js';
import { DEFAULT_BASE_URL } from '../media-lens/worker/classifier-dev/contract.js';
import { classifierDevAdapterEnabled, loadConfig } from '../media-lens/worker/config.js';
import { pinProviderHost } from '../media-lens/worker/safe-fetch.js';
import { createProviderPinnedFetch } from '../media-lens/worker/provider-pinned-fetch.js';
import { classifyLoopbackFixture, lookupMap } from './helpers/media-lens-real-socket-fixtures.js';
import { runJevPinVerify, JEV_PIN_VERIFY_REASONS } from '../media-lens/worker/jev-pin-verify.js';

const PIN_HOST = 'provider.media-lens-pin-test.invalid';
const SAMPLE_SPAN = { id: 'span-1', role: 'authorial', text: 'The committee met on Tuesday.' };
const ARTIFACT = { kind: 'article', title: 't' };

function hasCode(code) {
  return (err) => err.code === code;
}

async function withMockServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, server, address.port);
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

async function jevOkBody() {
  const { optionIds } = await loadQuestionSet();
  return {
    model: JEV_MODEL_REQUESTED,
    answers: buildContractAnswers({ optionIds, choice: 'none', probability: 0.9, noul: 0.1 })
  };
}

function cdevOkBody() {
  return {
    tier: 'smart',
    model: 'jev-1.13.0',
    results: [
      {
        label: 'no_detected_signal',
        confidence: 0.9,
        scores: { no_detected_signal: 0.9 },
        model: 'jev-1.13.0'
      }
    ],
    usage: { classifications: 1 }
  };
}

function countingLookup(first, second) {
  let lookups = 0;
  const lookupImpl = async () => {
    lookups += 1;
    if (lookups === 1) return first;
    return second;
  };
  lookupImpl.count = () => lookups;
  return lookupImpl;
}

test('live flags and classifier.dev remain disabled by default (remediation C)', () => {
  const config = loadConfig({});
  assert.equal(config.liveEnabled, false);
  assert.equal(config.liveUrlEnabled, false);
  assert.equal(config.classifierDev.enabled, false);
  assert.equal(classifierDevAdapterEnabled(config), false);
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE, 'true');
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE_URL, 'true');
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_CLASSIFIER_DEV, 'true');
  assert.notEqual(process.env.MEDIA_LENS_JEV_VERIFY, 'true');
});

test('pinProviderHost DNS rebind mock: second answer is never used', async () => {
  const lookupImpl = countingLookup(
    [{ address: '203.0.113.7', family: 4 }],
    [{ address: '127.0.0.1', family: 4 }]
  );
  const pin = await pinProviderHost(PIN_HOST, { lookupImpl });
  assert.equal(lookupImpl.count(), 1);
  assert.equal(pin.address, '203.0.113.7');
  assert.equal(pin.family, 4);
});

test('provider pinned fetch ignores a second DNS answer and connects only to the pin', async () => {
  const body = await jevOkBody();
  await withMockServer(
    async (req, res) => {
      assert.equal(req.method, 'POST');
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (_base, _server, port) => {
      const lookupImpl = countingLookup(
        [{ address: '127.0.0.1', family: 4 }],
        [{ address: '10.0.0.1', family: 4 }]
      );
      const fetchImpl = createProviderPinnedFetch({
        lookupImpl,
        classifyImpl: classifyLoopbackFixture
      });
      const response = await fetchImpl(`http://${PIN_HOST}:${port}/v1/systemone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: JEV_MODEL_REQUESTED })
      });
      assert.equal(response.ok, true);
      assert.equal(lookupImpl.count(), 1);
      const json = await response.json();
      assert.equal(json.model, JEV_MODEL_REQUESTED);
    }
  );
});

test('live Jev uses connect-time pin: rebind mock second DNS answer is ignored', async () => {
  const body = await jevOkBody();
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (_base, _server, port) => {
      const lookupImpl = countingLookup(
        [{ address: '127.0.0.1', family: 4 }],
        [{ address: '169.254.169.254', family: 4 }]
      );
      const adapter = createJevAdapter({
        mode: 'live',
        baseUrl: `http://${PIN_HOST}:${port}`,
        apiKey: 'test-key-not-used',
        concurrency: 1,
        lookupImpl,
        classifyImpl: classifyLoopbackFixture
      });
      const result = await adapter.analyzeSpans([SAMPLE_SPAN], ARTIFACT);
      assert.equal(result.failures, 0);
      assert.equal(lookupImpl.count(), 1);
      assert.equal(result.answersBySpanId.get('span-1').influence_signal.choice, 'none');
    }
  );
});

test('classifier.dev uses connect-time pin: rebind mock second DNS answer is ignored', async () => {
  await withMockServer(
    async (req, res) => {
      assert.equal(req.url, '/v1/classify');
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json', 'x-api-version': 'v1' });
      res.end(JSON.stringify(cdevOkBody()));
    },
    async (base) => {
      const lookupImpl = countingLookup(
        [{ address: '127.0.0.1', family: 4 }],
        [{ address: '10.0.0.1', family: 4 }]
      );
      // Loopback origin stays on the classifier.dev allowlist; pin still
      // resolves once and ignores a later private answer.
      const adapter = createClassifierDevAdapter({
        enabled: true,
        baseUrl: base,
        lookupImpl,
        classifyImpl: classifyLoopbackFixture
      });
      const result = await adapter.classify({
        inputs: ['The committee met on Tuesday.'],
        labels: CDEV_LABEL_IDS
      });
      assert.equal(result.ok, true);
      assert.equal(lookupImpl.count(), 0, 'loopback IP literal must not call DNS');
      assert.equal(result.results[0].label, 'no_detected_signal');
    }
  );
});

test('classifier.dev hostname pin ignores a second DNS answer', async () => {
  let connects = 0;
  const lookupImpl = countingLookup(
    [{ address: '203.0.113.7', family: 4 }],
    [{ address: '169.254.169.254', family: 4 }]
  );
  const adapter = createClassifierDevAdapter({
    enabled: true,
    baseUrl: DEFAULT_BASE_URL,
    lookupImpl,
    createConnectionImpl(options) {
      connects += 1;
      assert.equal(options.host, '203.0.113.7');
      const socket = new net.Socket();
      queueMicrotask(() => socket.destroy(Object.assign(new Error('pin recorded'), { code: 'ECONNREFUSED' })));
      return socket;
    }
  });
  const result = await adapter.classify({
    inputs: ['The committee met on Tuesday.'],
    labels: CDEV_LABEL_IDS
  });
  assert.equal(result.ok, false);
  assert.equal(lookupImpl.count(), 1);
  assert.ok(connects >= 1);
  assert.match(String(result.results[0].reason), /transport_error|TIMEOUT|timeout/i);
});

test('live Jev 302 to a private or off-origin Location is not followed', async () => {
  let attackerHits = 0;
  const attacker = http.createServer((req, res) => {
    attackerHits += 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ stolen: true }));
  });
  await new Promise((resolve) => attacker.listen(0, '127.0.0.1', resolve));
  const attackerUrl = `http://127.0.0.1:${attacker.address().port}/steal`;
  try {
    await withMockServer(
      async (req, res) => {
        await readJsonBody(req);
        res.writeHead(302, { location: attackerUrl });
        res.end('redirect');
      },
      async (base) => {
        const adapter = createJevAdapter({
          mode: 'live',
          baseUrl: base,
          apiKey: 'test-key-not-used',
          concurrency: 1
        });
        const result = await adapter.analyzeSpans([SAMPLE_SPAN], ARTIFACT);
        assert.equal(result.failures, 1);
        assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'redirect_rejected');
        assert.equal(attackerHits, 0);
      }
    );

    await withMockServer(
      async (req, res) => {
        await readJsonBody(req);
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end('redirect');
      },
      async (base) => {
        const adapter = createJevAdapter({
          mode: 'live',
          baseUrl: base,
          apiKey: 'test-key-not-used',
          concurrency: 1
        });
        const result = await adapter.analyzeSpans([SAMPLE_SPAN], ARTIFACT);
        assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'redirect_rejected');
      }
    );

    await withMockServer(
      async (req, res) => {
        await readJsonBody(req);
        res.writeHead(302, { location: 'https://evil.example/v1/systemone' });
        res.end('redirect');
      },
      async (base) => {
        const adapter = createJevAdapter({
          mode: 'live',
          baseUrl: base,
          apiKey: 'test-key-not-used',
          concurrency: 1
        });
        const result = await adapter.analyzeSpans([SAMPLE_SPAN], ARTIFACT);
        assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'redirect_rejected');
      }
    );
  } finally {
    if (typeof attacker.closeAllConnections === 'function') attacker.closeAllConnections();
    await new Promise((resolve) => attacker.close(resolve));
  }
});

test('classifier.dev 302 to private or off-allowlist Location is not followed (pinned path)', async () => {
  let attackerHits = 0;
  const attacker = http.createServer((req, res) => {
    attackerHits += 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(cdevOkBody()));
  });
  await new Promise((resolve) => attacker.listen(0, '127.0.0.1', resolve));
  try {
    await withMockServer(
      async (req, res) => {
        await readJsonBody(req);
        res.writeHead(302, { location: `http://127.0.0.1:${attacker.address().port}/steal` });
        res.end('redirect');
      },
      async (base) => {
        const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base });
        const result = await adapter.classify({
          inputs: ['The committee met on Tuesday.'],
          labels: CDEV_LABEL_IDS
        });
        assert.equal(result.results[0].reason, 'redirect_rejected');
        assert.equal(attackerHits, 0);
      }
    );

    await withMockServer(
      async (req, res) => {
        await readJsonBody(req);
        res.writeHead(302, { location: 'https://evil.example/v1/classify' });
        res.end('redirect');
      },
      async (base) => {
        const adapter = createClassifierDevAdapter({ enabled: true, baseUrl: base });
        const result = await adapter.classify({
          inputs: ['The committee met on Tuesday.'],
          labels: CDEV_LABEL_IDS
        });
        assert.equal(result.results[0].reason, 'redirect_rejected');
      }
    );
  } finally {
    if (typeof attacker.closeAllConnections === 'function') attacker.closeAllConnections();
    await new Promise((resolve) => attacker.close(resolve));
  }
});

test('mixed public+private provider DNS is BLOCKED_HOST with no connect', async () => {
  let connects = 0;
  await assert.rejects(
    () =>
      pinProviderHost(PIN_HOST, {
        lookupImpl: async () => [
          { address: '203.0.113.7', family: 4 },
          { address: '10.0.0.1', family: 4 }
        ]
      }),
    hasCode('BLOCKED_HOST')
  );

  const adapter = createJevAdapter({
    mode: 'live',
    baseUrl: `https://${PIN_HOST}`,
    apiKey: 'test-key-not-used',
    concurrency: 1,
    lookupImpl: async () => [{ address: '169.254.169.254', family: 4 }],
    createConnectionImpl() {
      connects += 1;
      throw new Error('must not connect');
    }
  });
  const result = await adapter.analyzeSpans([SAMPLE_SPAN], ARTIFACT);
  assert.equal(result.failures, 1);
  assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'BLOCKED_HOST');
  assert.equal(connects, 0);
});

test('PIN_MISMATCH when the connected peer is not the pin', async () => {
  await withMockServer(
    async (req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(await jevOkBody()));
    },
    async (_base, _server, port) => {
      const adapter = createJevAdapter({
        mode: 'live',
        baseUrl: `http://${PIN_HOST}:${port}`,
        apiKey: 'test-key-not-used',
        concurrency: 1,
        lookupImpl: lookupMap({ [PIN_HOST]: [{ address: '203.0.113.7', family: 4 }] }),
        createConnectionImpl() {
          return net.connect({ host: '127.0.0.1', port });
        }
      });
      const result = await adapter.analyzeSpans([SAMPLE_SPAN], ARTIFACT);
      assert.equal(result.failures, 1);
      assert.equal(result.dispositionsBySpanId.get('span-1').reason, 'PIN_MISMATCH');
    }
  );
});

test('default-off and kill switch make zero provider DNS or HTTP', async () => {
  let lookups = 0;
  const lookupImpl = async () => {
    lookups += 1;
    return [{ address: '203.0.113.7', family: 4 }];
  };

  const disabledJev = createJevAdapter({
    mode: 'disabled',
    baseUrl: `https://${PIN_HOST}`,
    apiKey: 'test-key-not-used',
    lookupImpl
  });
  const disabledResult = await disabledJev.analyzeSpans([SAMPLE_SPAN], ARTIFACT);
  assert.equal(disabledResult.calls, 0);
  assert.equal(lookups, 0);

  const fixtureJev = createJevAdapter({
    mode: 'fixture',
    fixtureId: 'synthetic-01-quoted-vs-authorial',
    fixtureDir: 'media-lens/fixtures/jev',
    lookupImpl
  });
  await fixtureJev.analyzeSpans([SAMPLE_SPAN], ARTIFACT);
  assert.equal(lookups, 0);

  const disabledCdev = createClassifierDevAdapter({
    enabled: false,
    baseUrl: DEFAULT_BASE_URL,
    lookupImpl
  });
  const off = await disabledCdev.classify({
    inputs: ['The committee met on Tuesday.'],
    labels: ['alpha', 'beta']
  });
  assert.equal(off.networkCalls, 0);
  assert.equal(off.results[0].reason, 'disabled');
  assert.equal(lookups, 0);

  const killed = createClassifierDevAdapter({
    enabled: true,
    isKillSwitchAsserted: () => true,
    baseUrl: DEFAULT_BASE_URL,
    lookupImpl
  });
  const killedResult = await killed.classify({
    inputs: ['The committee met on Tuesday.'],
    labels: ['alpha', 'beta']
  });
  assert.equal(killedResult.networkCalls, 0);
  assert.equal(killedResult.results[0].reason, 'killed');
  assert.equal(lookups, 0);

  const report = await runJevPinVerify({
    env: {
      MEDIA_LENS_JEV_VERIFY: 'true',
      MEDIA_LENS_TYPESAFE_API_KEY: 'pin-verify-test-key',
      MEDIA_LENS_KILL_SWITCH: 'true',
      MEDIA_LENS_TYPESAFE_BASE_URL: `https://${PIN_HOST}`
    },
    lookupImpl,
    commitSha: 'remediation-c-kill'
  });
  assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.KILL_SWITCH);
  assert.equal(report.networkCalls, 0);
  assert.equal(lookups, 0);
});

test('classifier.dev origin allowlist and /v1/classify path are unchanged', async () => {
  let lookups = 0;
  const lookupImpl = async () => {
    lookups += 1;
    return [{ address: '203.0.113.7', family: 4 }];
  };
  const evil = createClassifierDevAdapter({
    enabled: true,
    baseUrl: 'https://evil.example',
    lookupImpl
  });
  const result = await evil.classify({
    inputs: ['The committee met on Tuesday.'],
    labels: ['alpha', 'beta']
  });
  assert.equal(result.results[0].reason, 'host_not_allowlisted');
  assert.equal(result.networkCalls, 0);
  assert.equal(lookups, 0);

  const src = await readFile('media-lens/worker/adapters/classifier-dev.js', 'utf8');
  assert.match(src, /redirect:\s*FETCH_REDIRECT_MODE/);
  const contract = await readFile('media-lens/worker/classifier-dev/contract.js', 'utf8');
  assert.match(contract, /PRODUCTION_CLASSIFIER_DEV_ORIGIN = 'https:\/\/classifier\.dev'/);
  assert.match(contract, /CLASSIFY_PATH = '\/v1\/classify'/);
  assert.match(contract, /ALLOWED_CLASSIFIER_DEV_CALIBRATION_MODELS = Object\.freeze\(\['jev-1\.13\.0'\]\)/);
});

test('Jev TypeSafe live client refuses to follow redirects even via fetchImpl', async () => {
  const src = await readFile('media-lens/worker/adapters/jev.js', 'utf8');
  assert.match(src, /redirect:\s*'manual'/);
  assert.match(src, /createProviderPinnedFetch/);
  assert.doesNotMatch(src, /fetchImpl = globalThis\.fetch/);
});
