import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DOCUMENTED_ACCEPTANCE_THRESHOLDS,
  EVAL_DISCLAIMER,
  EVAL_PATHS,
  deterministicPolicyPredict,
  evaluateEvalHarness
} from '../media-lens/worker/classifier-dev/eval-harness.js';

test('eval harness reports placeholder metrics and never claims thresholds are met', async () => {
  const cases = JSON.parse(await readFile('media-lens/fixtures/classifier-dev-eval/cases.json', 'utf8'));
  const recorded = JSON.parse(await readFile('media-lens/fixtures/classifier-dev-eval/recorded-paths.json', 'utf8'));
  const report = evaluateEvalHarness(cases.cases, recorded);
  assert.equal(report.evaluation_only, true);
  assert.equal(report.claimed_thresholds_met, false);
  assert.equal(report.disclaimer, EVAL_DISCLAIMER);
  for (const path of EVAL_PATHS) {
    assert.ok(report.paths[path]);
    assert.equal(report.paths[path].claimed_thresholds_met, false);
    assert.equal(typeof report.paths[path].macro_f1, 'number');
    assert.equal(typeof report.paths[path].macro_p, 'number');
    assert.equal(typeof report.paths[path].macro_r, 'number');
    assert.ok(report.paths[path].confusion);
    assert.equal(typeof report.paths[path].fp, 'number');
    assert.equal(typeof report.paths[path].fn, 'number');
    assert.ok(report.paths[path].calibration_bands);
    assert.equal(typeof report.paths[path].abstention_rate, 'number');
    assert.equal(typeof report.paths[path].latency_ms_mean, 'number');
  }
  assert.equal(DOCUMENTED_ACCEPTANCE_THRESHOLDS.macro_f1.claimed_met, false);
  assert.equal(report.documented_thresholds.macro_f1.claimed_met, false);
  assert.doesNotMatch(JSON.stringify(report), /production-ready|thresholds met|AG News/i);
});

test('synthetic eval fixtures are public-safe and deterministic policy is local-only', async () => {
  const cases = JSON.parse(await readFile('media-lens/fixtures/classifier-dev-eval/cases.json', 'utf8'));
  const blob = JSON.stringify(cases);
  assert.doesNotMatch(blob, /reuters|ap news|nytimes|scraped/i);
  assert.equal(deterministicPolicyPredict('This plan will undeniably fix every school in the county.').label, 'certainty_beyond_evidence');
  assert.equal(deterministicPolicyPredict('The committee met on Tuesday and approved the budget amendment.').label, 'none');
  assert.equal(deterministicPolicyPredict('').abstain, true);
});
