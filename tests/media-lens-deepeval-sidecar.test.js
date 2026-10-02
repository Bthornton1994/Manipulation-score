import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deterministicPolicyPredict } from '../media-lens/worker/classifier-dev/eval-harness.js';

const SIDECAR = 'media-lens/eval/deepeval';

test('recorded deterministic_policy rows equal the code-computed policy (independent of Jev)', async () => {
  const { cases } = JSON.parse(await readFile('media-lens/fixtures/classifier-dev-eval/cases.json', 'utf8'));
  const recorded = JSON.parse(await readFile('media-lens/fixtures/classifier-dev-eval/recorded-paths.json', 'utf8'));
  const byId = new Map(recorded.deterministic_policy.map((row) => [row.caseId, row]));
  assert.equal(byId.size, cases.length);
  for (const item of cases) {
    const computed = deterministicPolicyPredict(item.span.text);
    const row = byId.get(item.id);
    assert.ok(row, `missing deterministic_policy row for ${item.id}`);
    assert.equal(row.abstain, computed.abstain, item.id);
    assert.equal(row.label, computed.label, item.id);
  }
});

test('DeepEval sidecar stays out of product dependencies and ordinary CI', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
  assert.equal(Object.keys(deps).some((name) => /deepeval|langfuse/i.test(name)), false);
  for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/jev-pin-verify.yml']) {
    const src = await readFile(workflow, 'utf8');
    assert.doesNotMatch(src, /deepeval|langfuse|eval\/deepeval/i, `${workflow} must not run model-graded evals`);
  }
});

test('sidecar requirements contain only exact pins', async () => {
  const lines = (await readFile(`${SIDECAR}/requirements.txt`, 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const line of lines) {
    assert.match(line, /^[A-Za-z0-9._-]+==[A-Za-z0-9.+-]+$/, `requirement must be an exact pin: ${line}`);
  }
});

test('sidecar runner keeps model-graded metrics opt-in and never claims thresholds', async () => {
  const src = await readFile(`${SIDECAR}/run_offline_eval.py`, 'utf8');
  assert.match(src, /DEEPEVAL_TELEMETRY_OPT_OUT/);
  assert.match(src, /"claimed_thresholds_met": False/);
  assert.match(src, /--llm-judge/);
  assert.doesNotMatch(src, /GEval|AnswerRelevancy|Faithfulness|openai|anthropic/i);
});
