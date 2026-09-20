// Issue #118 remediation E: canary/kill-switch drill packet lock.
// Local mocks only. No live network. No TypeSafe key. Flags stay default-off
// in this process. Completing these tests does not grant READY_FOR_CANARY.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PAGES_FORBIDDEN_NAMES,
  buildPagesSite,
  isAllowedSitePath,
  isForbiddenSitePath,
  listSiteFiles
} from '../scripts/build-pages-site.js';
import {
  loadConfig,
  effectiveLiveFlags,
  isKillSwitchAsserted,
  publicConfig,
  classifierDevAdapterEnabled
} from '../media-lens/worker/config.js';
import { createServer } from '../media-lens/worker/server.js';
import { createAuditLogger } from '../media-lens/worker/audit.js';
import { hostIsAllowlisted } from '../media-lens/worker/host-key.js';
import {
  evaluateJevVerifyGate,
  runJevPinVerify,
  JEV_PIN_VERIFY_REASONS
} from '../media-lens/worker/jev-pin-verify.js';
import { createClassifierDevAdapter } from '../media-lens/worker/adapters/classifier-dev.js';
import { CDEV_LABEL_IDS } from '../media-lens/worker/classifier-dev/taxonomy.js';
import {
  CANARY_DRILL_DOC,
  CANARY_DRILL_RUNBOOK,
  CANARY_DRILL_STATUS,
  REQUIRED_DOC_MARKERS,
  FORBIDDEN_PRODUCTION_CLAIMS,
  EVIDENCE_TEMPLATE_FIELDS,
  DEFAULT_OFF_FLAG_NAMES,
  liveFlagsAreDefaultOff
} from './helpers/media-lens-canary-drill-packet.js';

const SECRET_SHAPE = /sk-[A-Za-z0-9]{16,}/;

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
        res.on('data', (chunk) => {
          raw += chunk;
        });
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

function collectAudit() {
  const lines = [];
  return {
    logger: createAuditLogger({ write: (line) => lines.push(line) }),
    events() {
      return lines.map((line) => JSON.parse(line));
    },
    joined() {
      return lines.join('\n');
    }
  };
}

function forbiddenNetwork() {
  return async () => {
    throw new Error('drill packet tests must not call the network');
  };
}

test('canary drill packet exists, stays off Pages, and does not claim production readiness', async () => {
  await access(CANARY_DRILL_DOC);
  await access(CANARY_DRILL_RUNBOOK);
  const body = await readFile(CANARY_DRILL_DOC, 'utf8');
  const runbook = await readFile(CANARY_DRILL_RUNBOOK, 'utf8');

  assert.equal(CANARY_DRILL_STATUS, 'DRILL_PACKET_ONLY');
  assert.match(body, /DRILL_PACKET_ONLY/);
  for (const marker of REQUIRED_DOC_MARKERS) {
    assert.match(body, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing marker: ${marker}`);
  }
  for (const claim of FORBIDDEN_PRODUCTION_CLAIMS) {
    assert.doesNotMatch(body, claim);
  }
  assert.doesNotMatch(body, SECRET_SHAPE);
  assert.match(body, /does \*\*not\*\* grant `READY_FOR_CANARY`/);
  assert.match(runbook, /media-lens-canary-drill-v1\.md/);
  assert.match(runbook, /DRILL_PACKET_ONLY/);
  assert.match(runbook, /does \*\*not\*\* grant `READY_FOR_CANARY`/);
  assert.doesNotMatch(runbook, SECRET_SHAPE);

  for (const field of EVIDENCE_TEMPLATE_FIELDS) {
    assert.match(body, new RegExp(field));
  }

  assert.ok(PAGES_FORBIDDEN_NAMES.includes('docs'));
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('media-lens'));
  assert.equal(isAllowedSitePath(CANARY_DRILL_DOC), false);
  assert.equal(isForbiddenSitePath(CANARY_DRILL_DOC), true);

  const dest = await mkdtemp(join(tmpdir(), 'clarity-pages-canary-drill-'));
  await buildPagesSite(dest);
  const files = await listSiteFiles(dest);
  assert.equal(files.includes(CANARY_DRILL_DOC), false);
  assert.equal(files.includes(CANARY_DRILL_RUNBOOK), false);
  assert.equal(
    files.some((file) => file.includes('media-lens-canary-drill')),
    false
  );
});

test('repository and CI defaults remain off; helper reports default-off', async () => {
  assert.equal(liveFlagsAreDefaultOff(process.env), true);
  for (const name of DEFAULT_OFF_FLAG_NAMES) {
    assert.notEqual(process.env[name], 'true', `${name} must stay off in this process`);
  }

  const unset = loadConfig({});
  assert.equal(unset.mode, 'fixture');
  assert.equal(unset.liveEnabled, false);
  assert.equal(unset.liveUrlEnabled, false);
  assert.equal(unset.classifierDev.enabled, false);
  assert.equal(unset.killSwitch, false);
  assert.equal(isKillSwitchAsserted(unset), false);
  assert.equal(effectiveLiveFlags(unset).liveUrlEnabled, false);
  assert.equal(effectiveLiveFlags(unset).classifierDevEnabled, false);

  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.doesNotMatch(ci, /MEDIA_LENS_ENABLE_LIVE=true/);
  assert.doesNotMatch(ci, /MEDIA_LENS_ENABLE_LIVE_URL=true/);
  assert.doesNotMatch(ci, /MEDIA_LENS_ENABLE_CLASSIFIER_DEV=true/);
});

test('kill-file drill: live /analyze returns 503 live_killed with zero provider calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-canary-kill-'));
  const killFile = join(dir, 'KILL');
  const audit = collectAudit();
  let fetchHits = 0;
  let jevHits = 0;
  const mockJev = http.createServer((req, res) => {
    jevHits += 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'jev-1.13.0', answers: {} }));
  });
  await new Promise((resolve) => mockJev.listen(0, '127.0.0.1', resolve));

  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_ENABLE_LIVE_URL: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key-not-used',
    MEDIA_LENS_TYPESAFE_BASE_URL: `http://127.0.0.1:${mockJev.address().port}`,
    MEDIA_LENS_KILL_SWITCH_FILE: killFile,
    MEDIA_LENS_PORT: '0'
  });
  const server = await listen(
    createServer(config, {
      auditLogger: audit.logger,
      fetchArticle: async () => {
        fetchHits += 1;
        throw new Error('fetch must not run under kill switch');
      }
    })
  );

  try {
    await writeFile(killFile, '');
    assert.equal(isKillSwitchAsserted(config), true);

    const health = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(health.body.killSwitch, true);
    assert.equal(Object.hasOwn(health.body, 'secrets'), false);
    assert.doesNotMatch(JSON.stringify(health.body), /test-key-not-used/);

    const killed = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'url', url: 'http://8.8.8.8/article' }
    });
    assert.equal(killed.status, 503);
    assert.equal(killed.body.error, 'live_killed');
    assert.equal(fetchHits, 0);
    assert.equal(jevHits, 0);
    assert.ok(audit.events().some((event) => event.event === 'kill_switch'));
    assert.doesNotMatch(audit.joined(), /test-key-not-used/);
  } finally {
    server.close();
    mockJev.close();
    await unlink(killFile).catch(() => {});
  }
});

test('kill switch fail-closes pin-verify as verify_kill_switch with zero network', async () => {
  const env = {
    MEDIA_LENS_JEV_VERIFY: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key-not-used',
    MEDIA_LENS_KILL_SWITCH: 'true',
    MEDIA_LENS_TYPESAFE_BASE_URL: 'http://127.0.0.1:9'
  };
  assert.equal(evaluateJevVerifyGate(env).reason, JEV_PIN_VERIFY_REASONS.KILL_SWITCH);

  const report = await runJevPinVerify({
    env,
    fetchImpl: forbiddenNetwork(),
    commitSha: 'test-sha-canary-drill'
  });
  assert.equal(report.pass, false);
  assert.equal(report.reason, 'verify_kill_switch');
  assert.equal(report.networkCalls, 0);
  assert.equal(report.production_ready, false);
});

test('kill switch keeps classifier.dev at zero provider calls', async () => {
  const config = loadConfig({
    MEDIA_LENS_ENABLE_CLASSIFIER_DEV: 'true',
    MEDIA_LENS_KILL_SWITCH: 'true'
  });
  assert.equal(classifierDevAdapterEnabled(config), false);
  let hits = 0;
  const adapter = createClassifierDevAdapter({
    enabled: classifierDevAdapterEnabled(config),
    isKillSwitchAsserted: () => true,
    fetchImpl: async () => {
      hits += 1;
      throw new Error('kill switch must not fetch');
    }
  });
  const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
  assert.equal(hits, 0);
  assert.equal(result.networkCalls, 0);
});

test('hop-scoped allowlist helper still fail-closes off-list hosts', () => {
  const list = ['example.com', 'www.example.com'];
  assert.equal(hostIsAllowlisted('example.com', list), true);
  assert.equal(hostIsAllowlisted('www.example.com', list), true);
  assert.equal(hostIsAllowlisted('other.example', list), false);
  assert.equal(hostIsAllowlisted('example.com', []), true);
});

test('publicConfig on a killed live worker still omits secrets', () => {
  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_ENABLE_LIVE_URL: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'sk-test-key-not-for-logs',
    MEDIA_LENS_KILL_SWITCH: 'true',
    MEDIA_LENS_URL_ALLOWLIST: 'example.com,www.example.com'
  });
  const view = publicConfig(config);
  const serialized = JSON.stringify(view);
  assert.equal(view.killSwitch, true);
  assert.equal(view.urlAllowlistConfigured, true);
  assert.doesNotMatch(serialized, /sk-test-key-not-for-logs/);
  assert.doesNotMatch(serialized, /example\.com/);
  assert.equal(Object.hasOwn(view, 'secrets'), false);
});
