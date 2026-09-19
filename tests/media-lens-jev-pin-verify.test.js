import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildContractAnswers,
  loadQuestionSet,
  JEV_MODEL_REQUESTED,
  JEV_MAX_SPAN_CHARS,
  JEV_MAX_CONTEXT_CHARS
} from '../media-lens/worker/adapters/jev.js';
import {
  PAGES_FORBIDDEN_NAMES,
  isAllowedSitePath,
  isForbiddenSitePath
} from '../scripts/build-pages-site.js';
import {
  DEFAULT_PIN_VERIFY_FIXTURE,
  JEV_PIN_VERIFY_REASONS,
  JEV_STATE_TOKEN_BUDGET,
  assertArtifactPathAllowed,
  assertArticlesDir,
  evaluateJevVerifyGate,
  listSyntheticArticleFixtureIds,
  loadSyntheticFixtureCases,
  measureMaxSpanTokenBudget,
  repoRootFromModule,
  runJevPinVerify
} from '../media-lens/worker/jev-pin-verify.js';

const PIN_VERIFY_KEY = 'pin-verify-test-key';
const VERIFY_ENV = {
  MEDIA_LENS_JEV_VERIFY: 'true',
  MEDIA_LENS_TYPESAFE_API_KEY: PIN_VERIFY_KEY
};

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

async function contractBody({
  choice = 'none',
  probability = 0.9,
  noul = 0.1,
  model = JEV_MODEL_REQUESTED,
  extraAnswers = null
} = {}) {
  const { optionIds } = await loadQuestionSet();
  const answers = buildContractAnswers({ optionIds, choice, probability, noul });
  if (extraAnswers) Object.assign(answers, extraAnswers);
  return { model, answers };
}

function forbiddenNetwork() {
  return async () => {
    throw new Error('network must not be used');
  };
}

async function runCli(env, args, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/jev-pin-verify.js', ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('evaluateJevVerifyGate fails closed unless the exact flag and a key are present', () => {
  assert.deepEqual(evaluateJevVerifyGate({}).reason, JEV_PIN_VERIFY_REASONS.FLAG_OFF);
  assert.equal(evaluateJevVerifyGate({}).allowed, false);
  assert.equal(evaluateJevVerifyGate({ MEDIA_LENS_JEV_VERIFY: 'TRUE', MEDIA_LENS_TYPESAFE_API_KEY: PIN_VERIFY_KEY }).allowed, false);
  assert.equal(evaluateJevVerifyGate({ MEDIA_LENS_JEV_VERIFY: '1', MEDIA_LENS_TYPESAFE_API_KEY: PIN_VERIFY_KEY }).reason, JEV_PIN_VERIFY_REASONS.FLAG_OFF);
  assert.equal(
    evaluateJevVerifyGate({ MEDIA_LENS_JEV_VERIFY: 'true' }).reason,
    JEV_PIN_VERIFY_REASONS.NO_KEY
  );
  assert.equal(
    evaluateJevVerifyGate({ MEDIA_LENS_JEV_VERIFY: 'true', MEDIA_LENS_TYPESAFE_API_KEY: '   ' }).reason,
    JEV_PIN_VERIFY_REASONS.NO_KEY
  );
  const ok = evaluateJevVerifyGate(VERIFY_ENV);
  assert.equal(ok.allowed, true);
  assert.equal(ok.apiKey, PIN_VERIFY_KEY);
});

test('pin-verify gate does not call the network when the flag is off', async () => {
  const report = await runJevPinVerify({
    env: {},
    fetchImpl: forbiddenNetwork(),
    commitSha: 'test-sha-flag-off',
    now: () => new Date('2026-09-19T00:00:00.000Z')
  });
  assert.equal(report.pass, false);
  assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.FLAG_OFF);
  assert.equal(report.networkCalls, 0);
  assert.equal(report.production_ready, false);
  assert.equal(report.live_url_enabled, false);
  assert.equal(report.live_pasted_text_enabled, false);
  assert.equal(report.not_an_accuracy_claim, true);
  assert.equal(report.commitSha, 'test-sha-flag-off');
});

test('pin-verify gate does not call the network when the flag is on but no key is supplied', async () => {
  const report = await runJevPinVerify({
    env: { MEDIA_LENS_JEV_VERIFY: 'true' },
    fetchImpl: forbiddenNetwork(),
    commitSha: 'test-sha-no-key'
  });
  assert.equal(report.pass, false);
  assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.NO_KEY);
  assert.equal(report.networkCalls, 0);
});

test('kill switch env var fail-closes pin-verify with zero network calls even when flag and key are set', async () => {
  assert.equal(
    evaluateJevVerifyGate({ ...VERIFY_ENV, MEDIA_LENS_KILL_SWITCH: 'true' }).reason,
    JEV_PIN_VERIFY_REASONS.KILL_SWITCH
  );
  assert.equal(evaluateJevVerifyGate({ ...VERIFY_ENV, MEDIA_LENS_KILL_SWITCH: 'TRUE' }).allowed, true);
  assert.equal(evaluateJevVerifyGate({ ...VERIFY_ENV, MEDIA_LENS_KILL_SWITCH: '1' }).allowed, true);
  assert.equal(evaluateJevVerifyGate({ ...VERIFY_ENV, MEDIA_LENS_KILL_SWITCH: 'yes' }).allowed, true);

  const report = await runJevPinVerify({
    env: { ...VERIFY_ENV, MEDIA_LENS_KILL_SWITCH: 'true', MEDIA_LENS_TYPESAFE_BASE_URL: 'http://127.0.0.1:9' },
    fetchImpl: forbiddenNetwork(),
    commitSha: 'test-sha-kill-switch'
  });
  assert.equal(report.pass, false);
  assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.KILL_SWITCH);
  assert.equal(report.networkCalls, 0);
  assert.equal(report.production_ready, false);
});

test('kill switch file fail-closes pin-verify with zero network calls even when flag and key are set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-pin-verify-kill-'));
  const killFile = join(dir, 'KILL');
  const missingFile = join(dir, 'missing-KILL');

  assert.equal(
    evaluateJevVerifyGate({ ...VERIFY_ENV, MEDIA_LENS_KILL_SWITCH_FILE: missingFile }).allowed,
    true
  );

  await writeFile(killFile, '');
  assert.equal(
    evaluateJevVerifyGate({ ...VERIFY_ENV, MEDIA_LENS_KILL_SWITCH_FILE: killFile }).reason,
    JEV_PIN_VERIFY_REASONS.KILL_SWITCH
  );

  const report = await runJevPinVerify({
    env: { ...VERIFY_ENV, MEDIA_LENS_KILL_SWITCH_FILE: killFile, MEDIA_LENS_TYPESAFE_BASE_URL: 'http://127.0.0.1:9' },
    fetchImpl: forbiddenNetwork(),
    commitSha: 'test-sha-kill-file'
  });
  assert.equal(report.pass, false);
  assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.KILL_SWITCH);
  assert.equal(report.networkCalls, 0);
});

test('CI default environment does not enable isolated Jev pin verify', () => {
  assert.notEqual(process.env.MEDIA_LENS_JEV_VERIFY, 'true');
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE, 'true');
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE_URL, 'true');
});

test('default CI workflow stays fixture-only and does not run live Jev pin verify', async () => {
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /node --test tests\/\*\.test\.js/);
  assert.doesNotMatch(ci, /MEDIA_LENS_JEV_VERIFY/);
  assert.doesNotMatch(ci, /MEDIA_LENS_ENABLE_LIVE=true/);
  assert.doesNotMatch(ci, /MEDIA_LENS_ENABLE_LIVE_URL=true/);
  assert.doesNotMatch(ci, /jev-pin-verify/);
});

test('optional pin-verify workflow is workflow_dispatch only and does not enable live URL', async () => {
  const workflow = await readFile('.github/workflows/jev-pin-verify.yml', 'utf8');
  const triggerBlock = workflow.split('jobs:')[0];
  assert.match(triggerBlock, /workflow_dispatch:/);
  assert.doesNotMatch(triggerBlock, /pull_request:/);
  assert.doesNotMatch(triggerBlock, /push:/);
  assert.match(workflow, /vars\.MEDIA_LENS_JEV_VERIFY/);
  assert.match(workflow, /secrets\.MEDIA_LENS_TYPESAFE_API_KEY/);
  assert.match(workflow, /scripts\/jev-pin-verify\.js/);
  assert.doesNotMatch(workflow, /MEDIA_LENS_ENABLE_LIVE/);
  assert.doesNotMatch(workflow, /MEDIA_LENS_ENABLE_LIVE_URL/);
  assert.match(workflow, /node-version: '20'/);
  assert.doesNotMatch(workflow, /sk-[A-Za-z0-9]{8,}/);
});

test('pin-verify artifacts and scripts stay off the GitHub Pages allowlist', () => {
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('docs'));
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('media-lens'));
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('scripts'));
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('.github'));
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('artifacts'));
  assert.equal(isAllowedSitePath('scripts/jev-pin-verify.js'), false);
  assert.equal(isAllowedSitePath('.github/workflows/jev-pin-verify.yml'), false);
  assert.equal(isAllowedSitePath('artifacts/jev-pin-verify.json'), false);
  assert.equal(isAllowedSitePath('docs/media-lens-jev-integration-v2.md'), false);
  assert.equal(isForbiddenSitePath('scripts/jev-pin-verify.js'), true);
  assert.equal(isForbiddenSitePath('artifacts/jev-pin-verify.json'), true);
});

test('pin-verify may only read invented fixture articles', async () => {
  const repoRoot = repoRootFromModule();
  assert.throws(() => assertArticlesDir('/tmp/not-fixtures', repoRoot), /fixtures\/articles/);
  const ids = await listSyntheticArticleFixtureIds();
  assert.ok(ids.includes(DEFAULT_PIN_VERIFY_FIXTURE));
  assert.equal(ids.some((id) => id.includes('..')), false);
  const cases = await loadSyntheticFixtureCases({ fixtureIds: [DEFAULT_PIN_VERIFY_FIXTURE] });
  assert.equal(cases.length, 1);
  assert.ok(cases[0].spans.length >= 1);
  assert.ok(
    cases[0].spans.some((span) => /Main Street|road closure|repaving/i.test(span.text)),
    'synthetic-06 spans must come from the invented fixture article'
  );
});

test('max span plus questions stays under the documented 32k state token budget', async () => {
  const { questions } = await loadQuestionSet();
  const budget = measureMaxSpanTokenBudget(questions);
  assert.equal(budget.budget, JEV_STATE_TOKEN_BUDGET);
  assert.ok(budget.stateTokens > 0);
  assert.ok(budget.withinBudget);
  assert.ok(budget.total < JEV_STATE_TOKEN_BUDGET);
  assert.equal(JEV_MAX_SPAN_CHARS, 1200);
  assert.equal(JEV_MAX_CONTEXT_CHARS, 400);
});

test('pin-verify refuses to write reports under docs/', async () => {
  const repoRoot = repoRootFromModule();
  assert.throws(
    () => assertArtifactPathAllowed(join(repoRoot, 'docs', 'jev-pin-verify.json'), { repoRoot }),
    /docs/
  );
  const tmp = await mkdtemp(join(tmpdir(), 'jev-pin-verify-'));
  const allowed = assertArtifactPathAllowed(join(tmp, 'report.json'), { repoRoot, tmpRoot: tmp });
  assert.ok(allowed.endsWith('report.json'));
});

test('gitignore keeps pin-verify artifacts and secrets out of git', async () => {
  const gitignore = await readFile('.gitignore', 'utf8');
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^artifacts\/$/m);
});

test('successful mock pin verify records SHA, timestamp, model match, and ignores extra answer keys', async () => {
  const dest = await mkdtemp(join(tmpdir(), 'jev-pin-verify-ok-'));
  const artifactPath = join(dest, 'jev-pin-verify.json');
  const body = await contractBody({
    extraAnswers: {
      influence_signal: undefined,
      generated_text: 'ignore me',
      explanation: 'not product truth'
    }
  });
  const answers = await contractBody();
  answers.answers.influence_signal.explanation = 'dropped extra key';
  answers.answers.generated_text = 'also dropped';
  const requested = [];
  await withMockServer(
    async (req, res) => {
      const json = await readJsonBody(req);
      requested.push(json.model);
      assert.equal(json.model, JEV_MODEL_REQUESTED);
      assert.equal('jev-latest' in json, false);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answers));
    },
    async (baseUrl) => {
      const report = await runJevPinVerify({
        env: { ...VERIFY_ENV, MEDIA_LENS_TYPESAFE_BASE_URL: baseUrl },
        commitSha: 'abc123def456',
        now: () => new Date('2026-09-19T12:00:00.000Z'),
        artifactPath,
        tmpRoot: dest,
        fixtureIds: [DEFAULT_PIN_VERIFY_FIXTURE]
      });
      assert.equal(report.pass, true);
      assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.OK);
      assert.equal(report.commitSha, 'abc123def456');
      assert.equal(report.timestamp, '2026-09-19T12:00:00.000Z');
      assert.equal(report.requestedModel, 'jev-1.13.0');
      assert.equal(report.reportedModel, 'jev-1.13.0');
      assert.equal(report.modelMatch, true);
      assert.ok(report.networkCalls >= 1);
      assert.ok(requested.length >= 1);
      assert.equal(requested.every((model) => model === JEV_MODEL_REQUESTED), true);
      assert.equal(requested.includes('jev-latest'), false);
      assert.equal(report.live_url_enabled, false);
      assert.doesNotMatch(JSON.stringify(report), new RegExp(PIN_VERIFY_KEY));
    }
  );
  const saved = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(saved.pass, true);
  assert.equal(saved.not_an_accuracy_claim, true);
  assert.equal(saved.production_ready, false);
});

test('pin-verify fails the gate on model jev-9.9.9 and does not treat it as a pin match', async () => {
  const body = await contractBody({ model: 'jev-9.9.9' });
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (baseUrl) => {
      const report = await runJevPinVerify({
        env: { ...VERIFY_ENV, MEDIA_LENS_TYPESAFE_BASE_URL: baseUrl },
        commitSha: 'mismatch-sha',
        fixtureIds: [DEFAULT_PIN_VERIFY_FIXTURE]
      });
      assert.equal(report.pass, false);
      assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.MODEL_MISMATCH);
      assert.equal(report.reportedModel, 'jev-9.9.9');
      assert.ok(report.networkCalls >= 1);
    }
  );
});

test('pin-verify fails if the API reports jev-latest instead of the pinned id', async () => {
  const body = await contractBody({ model: 'jev-latest' });
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    async (baseUrl) => {
      const report = await runJevPinVerify({
        env: { ...VERIFY_ENV, MEDIA_LENS_TYPESAFE_BASE_URL: baseUrl },
        fixtureIds: [DEFAULT_PIN_VERIFY_FIXTURE]
      });
      assert.equal(report.pass, false);
      assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.MODEL_MISMATCH);
    }
  );
});

test('HTTP 401, 422, 429, and 529 fail the pin-verify gate without falling back to jev-latest', async () => {
  for (const status of [401, 422, 429, 529]) {
    const requested = [];
    await withMockServer(
      async (req, res) => {
        const json = await readJsonBody(req);
        requested.push(json.model);
        res.writeHead(status, { 'content-type': 'application/json', 'retry-after-ms': '1' });
        res.end(JSON.stringify({ error: `status_${status}` }));
      },
      async (baseUrl) => {
        const report = await runJevPinVerify({
          env: { ...VERIFY_ENV, MEDIA_LENS_TYPESAFE_BASE_URL: baseUrl },
          fixtureIds: [DEFAULT_PIN_VERIFY_FIXTURE],
          timeoutMs: 1000
        });
        assert.equal(report.pass, false, `status ${status} must fail the gate`);
        assert.equal(report.reason, `http_${status}`, `status ${status} reason`);
        assert.ok(requested.length >= 1);
        assert.equal(
          requested.every((model) => model === JEV_MODEL_REQUESTED),
          true,
          `status ${status} must keep requesting jev-1.13.0`
        );
        assert.equal(requested.includes('jev-latest'), false);
      }
    );
  }
});

test('malformed JSON fails the pin-verify gate', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not-json');
    },
    async (baseUrl) => {
      const report = await runJevPinVerify({
        env: { ...VERIFY_ENV, MEDIA_LENS_TYPESAFE_BASE_URL: baseUrl },
        fixtureIds: [DEFAULT_PIN_VERIFY_FIXTURE]
      });
      assert.equal(report.pass, false);
      assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.MALFORMED);
    }
  );
});

test('missing answers fail the pin-verify gate', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: JEV_MODEL_REQUESTED }));
    },
    async (baseUrl) => {
      const report = await runJevPinVerify({
        env: { ...VERIFY_ENV, MEDIA_LENS_TYPESAFE_BASE_URL: baseUrl },
        fixtureIds: [DEFAULT_PIN_VERIFY_FIXTURE]
      });
      assert.equal(report.pass, false);
      assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.MISSING_ANSWERS);
    }
  );
});

test('out-of-taxonomy choices are rejected by the existing adapter path and fail the gate', async () => {
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: JEV_MODEL_REQUESTED,
          answers: {
            influence_signal: {
              type: 'choice',
              choice: 'outlet_is_untrustworthy_propaganda',
              probabilities: { outlet_is_untrustworthy_propaganda: 0.99 },
              confidence: 0.99
            },
            is_quoted_or_attributed: { type: 'noul', noul: 0.1 }
          }
        })
      );
    },
    async (baseUrl) => {
      const report = await runJevPinVerify({
        env: { ...VERIFY_ENV, MEDIA_LENS_TYPESAFE_BASE_URL: baseUrl },
        fixtureIds: [DEFAULT_PIN_VERIFY_FIXTURE]
      });
      assert.equal(report.pass, false);
      assert.equal(report.reason, JEV_PIN_VERIFY_REASONS.TYPED_SHAPE);
    }
  );
});

test('optional diagnostic diff compares live choices to fixture answers without claiming accuracy', async () => {
  const { optionIds } = await loadQuestionSet();
  const liveAnswers = buildContractAnswers({ optionIds, choice: 'urgency', probability: 0.8, noul: 0.9 });
  await withMockServer(
    async (req, res) => {
      await readJsonBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: JEV_MODEL_REQUESTED, answers: liveAnswers }));
    },
    async (baseUrl) => {
      const report = await runJevPinVerify({
        env: { ...VERIFY_ENV, MEDIA_LENS_TYPESAFE_BASE_URL: baseUrl },
        fixtureIds: ['synthetic-01-quoted-vs-authorial']
      });
      assert.equal(report.pass, true);
      assert.equal(report.diagnosticDiff.not_an_accuracy_claim, true);
      const caseDiff = report.diagnosticDiff.cases[0];
      assert.equal(caseDiff.fixtureId, 'synthetic-01-quoted-vs-authorial');
      assert.equal(caseDiff.fixtureAnswersPresent, true);
      assert.equal(caseDiff.not_an_accuracy_claim, true);
      const span1 = caseDiff.rows.find((row) => row.spanId === 'span-1');
      assert.ok(span1);
      assert.equal(span1.fixtureChoice, 'none');
      assert.equal(span1.liveChoice, 'urgency');
      assert.equal(span1.choiceMatch, false);
    }
  );
});

test('CLI exits 1 when the kill switch is asserted even with verify flag and key', async () => {
  const dest = await mkdtemp(join(tmpdir(), 'jev-pin-verify-cli-kill-'));
  const artifactPath = join(dest, 'report.json');
  const result = await runCli(
    {
      ...process.env,
      MEDIA_LENS_JEV_VERIFY: 'true',
      MEDIA_LENS_TYPESAFE_API_KEY: PIN_VERIFY_KEY,
      MEDIA_LENS_KILL_SWITCH: 'true',
      MEDIA_LENS_ENABLE_LIVE: '',
      MEDIA_LENS_ENABLE_LIVE_URL: ''
    },
    ['--artifact', artifactPath]
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verify_kill_switch/);
  const saved = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(saved.pass, false);
  assert.equal(saved.reason, JEV_PIN_VERIFY_REASONS.KILL_SWITCH);
  assert.equal(saved.networkCalls, 0);
});

test('CLI exits 1 when the verify flag is off and writes a local artifact, not a docs claim', async () => {
  const dest = await mkdtemp(join(tmpdir(), 'jev-pin-verify-cli-'));
  const artifactPath = join(dest, 'report.json');
  const result = await runCli(
    {
      ...process.env,
      MEDIA_LENS_JEV_VERIFY: '',
      MEDIA_LENS_TYPESAFE_API_KEY: '',
      MEDIA_LENS_ENABLE_LIVE: '',
      MEDIA_LENS_ENABLE_LIVE_URL: ''
    },
    ['--artifact', artifactPath]
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /verify_flag_off/);
  const saved = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.equal(saved.pass, false);
  assert.equal(saved.reason, JEV_PIN_VERIFY_REASONS.FLAG_OFF);
  assert.equal(saved.networkCalls, 0);
  assert.equal(saved.production_ready, false);
});

test('operator notes describe pin-verify as evidence plumbing, not a quality study or live enablement', async () => {
  const readme = await readFile('media-lens/README.md', 'utf8');
  assert.match(readme, /MEDIA_LENS_JEV_VERIFY/);
  assert.match(readme, /scripts\/jev-pin-verify\.js/);
  assert.match(readme, /not a quality study/i);
  assert.match(readme, /not production-ready/i);
  assert.match(readme, /does not enable live URL/i);
  assert.match(readme, /verify_kill_switch/);
  assert.match(
    readme,
    /every external Jev-capable path immediately \(live URL fetch, live Jev, isolated pin verification, and classifier\.dev\)/
  );
  assert.match(readme, /classifier\.dev makes zero outbound calls/);

  const notes = await readFile('docs/media-lens-jev-integration-v2.md', 'utf8');
  assert.match(notes, /MEDIA_LENS_JEV_VERIFY/);
  assert.match(notes, /not a quality study/i);
  assert.match(notes, /verify_kill_switch/);
  assert.doesNotMatch(notes, /sk-[A-Za-z0-9]{16,}/);
  assert.doesNotMatch(notes, /production-ready live URL/i);

  const runbook = await readFile('docs/media-lens-ops-runbook-v2.md', 'utf8');
  assert.match(runbook, /isolated pin verification/i);
  assert.match(runbook, /verify_kill_switch/);
  assert.match(runbook, /every external Jev-capable path|does not invoke the TypeSafe adapter/i);

  const root = await readFile('README.md', 'utf8');
  assert.match(root, /MEDIA_LENS_JEV_VERIFY/);
  assert.match(root, /not a quality study/i);
  assert.match(
    root,
    /every external Jev-capable path \(live URL fetch, live Jev, isolated pin verification, and classifier\.dev\)/
  );
});
