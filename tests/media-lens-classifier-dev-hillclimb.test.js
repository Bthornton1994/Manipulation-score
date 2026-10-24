import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  EVAL_PATHS,
  deterministicPolicyPredict,
  pathLabelOptions,
  validateGraderStability
} from '../media-lens/worker/classifier-dev/eval-harness.js';
import {
  EVIDENCE_DOES_NOT_SUPPORT,
  EVIDENCE_SUPPORTS,
  PILOT_BASE_SHA,
  REPORT_FILES,
  ROUND1_CANDIDATE,
  TUNE_FILES,
  assertSplitIntegrity,
  buildBaselineReport,
  buildRoundReport,
  candidatePolicyPredict,
  checkEvalPlumbing,
  decideRound,
  loadPilotDocuments,
  modelSweepStatus,
  predictionsFromPolicy,
  projectSplitDocument,
  renderBaselineMarkdown,
  renderRoundMarkdown,
  runTuneEvaluation
} from '../media-lens/worker/classifier-dev/hillclimb.js';
import { assertHillclimbOutputAllowed, runCli } from '../scripts/classifier-dev-hillclimb.js';

const DIR = 'media-lens/fixtures/classifier-dev-eval';
const HOLDOUT_TEXT = [
  'We will act immediately.',
  'The minutes note that a speaker asked people to decide quickly, and the board recorded no position.',
  'The leaflet states the result is guaranteed for every resident.',
  '…'
];

async function readJson(name) {
  return JSON.parse(await readFile(`${DIR}/${name}`, 'utf8'));
}

async function loadDocs() {
  const [catalog, train, holdout, holdoutIds, recorded] = await Promise.all([
    readJson('cases.json'),
    readJson('cases.train.json'),
    readJson('cases.holdout.json'),
    readJson('holdout-ids.json'),
    readJson('recorded-paths.json')
  ]);
  return { catalog, train, holdout, holdoutIds, recorded };
}

test('train and holdout files stay sealed, disjoint, and aligned with the catalog', async () => {
  const docs = await loadDocs();
  const integrity = assertSplitIntegrity(docs);
  assert.deepEqual(integrity.errors, []);
  assert.equal(integrity.pass, true);
  assert.deepEqual(docs.train, projectSplitDocument(docs.catalog, 'train'));
  assert.deepEqual(docs.holdout, projectSplitDocument(docs.catalog, 'holdout'));
  const trainIds = new Set(docs.train.cases.map((item) => item.id));
  const holdoutIds = new Set(docs.holdout.cases.map((item) => item.id));
  for (const id of trainIds) assert.equal(holdoutIds.has(id), false);
  assert.equal(trainIds.size + holdoutIds.size, docs.catalog.cases.length);
  assert.ok(docs.catalog.cases.some((item) => item.set_role === 'hard_context'));
  assert.ok(docs.catalog.cases.some((item) => item.set_role === 'negative_control'));
  assert.ok(docs.catalog.cases.some((item) => item.set_role === 'abstain_insufficient'));
  assert.match(docs.catalog.disclaimer, /not selected by searching for current-policy errors/i);
  assert.doesNotMatch(JSON.stringify(docs.catalog), /reuters|ap news|nytimes|scraped/i);
});

test('grader stability and plumbing reject a broken fixture before a round', async () => {
  const { train } = await loadDocs();
  const predictions = predictionsFromPolicy(train.cases, deterministicPolicyPredict);
  const stable = validateGraderStability(train.cases, predictions, pathLabelOptions('deterministic_policy'));
  assert.equal(stable.pass, true);
  assert.equal(stable.repeat_agreement, true);
  assert.equal(stable.order_agreement, true);
  assert.equal(stable.claimed_thresholds_met, false);
  const duplicate = checkEvalPlumbing({
    cases: [train.cases[0], { ...train.cases[0] }],
    predictions,
    labelKey: 'jev'
  });
  assert.equal(duplicate.pass, false);
  const missing = checkEvalPlumbing({
    cases: train.cases,
    predictions: predictions.slice(1),
    labelKey: 'jev'
  });
  assert.equal(missing.pass, false);
});

test('tune reads only the train file and sealed ids', async () => {
  const seen = [];
  const readFileSpy = async (path, encoding) => {
    seen.push(basename(path));
    return readFile(path, encoding);
  };
  const docs = await loadPilotDocuments(readFileSpy, DIR, { role: 'tune', unseal: '' });
  assert.deepEqual(seen, [...TUNE_FILES]);
  assert.equal(seen.includes('cases.holdout.json'), false);
  assert.equal(seen.includes('cases.json'), false);
  assert.equal(seen.includes('recorded-paths.json'), false);
  const tune = runTuneEvaluation({ trainCases: docs.train.cases, sealedIds: docs.holdoutIds.ids });
  assert.equal(tune.holdout_file_read, false);
  assert.equal(tune.claimed_thresholds_met, false);
  assert.equal(tune.cost_usd, 0);
  assert.equal(tune.network_calls, 0);
  assert.equal(tune.effort, 'N/A');
  assert.ok(tune.train_macro_f1_delta > 0);
  assert.deepEqual([...ROUND1_CANDIDATE.motivating_case_ids], ['eval-personal-attack']);
  await assert.rejects(
    () => loadPilotDocuments(readFileSpy, DIR, { role: 'tune', unseal: 'report' }),
    /tune role cannot unseal holdout/
  );
  assert.throws(
    () => runTuneEvaluation({
      trainCases: [...docs.train.cases, { id: docs.holdoutIds.ids[0], span: { text: 'x' }, label: { jev: 'none' } }],
      sealedIds: docs.holdoutIds.ids
    }),
    /tune refused sealed ids/
  );
});

test('round 1 reverts on a flat holdout and leaves the installed policy in place', async () => {
  const docs = await loadDocs();
  const round = buildRoundReport(docs);
  assert.equal(round.evaluation_only, true);
  assert.equal(round.claimed_thresholds_met, false);
  assert.equal(round.base_sha, PILOT_BASE_SHA);
  assert.equal(round.model, null);
  assert.equal(round.effort, 'N/A');
  assert.equal(round.cost_usd, 0);
  assert.equal(round.network_calls, 0);
  assert.equal(round.live_url_enabled, false);
  assert.equal(round.holdout_span_text_included, false);
  assert.equal(round.decision, 'revert');
  assert.equal(round.reason, 'holdout_within_noise');
  assert.equal(round.holdout_macro_f1_delta, 0);
  assert.equal(round.holdout_baseline.metrics.macro_f1, 1);
  assert.equal(round.holdout_baseline.metrics.claimed_thresholds_met, false);
  assert.ok(round.train_macro_f1_delta > 0);
  assert.equal(round.stall_count, 1);
  assert.equal(round.installed_policy, 'deterministic_policy');
  assert.equal(round.candidate.installed, false);
  assert.equal(ROUND1_CANDIDATE.installed, false);
  assert.equal(
    deterministicPolicyPredict('Ignore the proposal; she is a fool and always has been.').label,
    'certainty_beyond_evidence'
  );
  assert.equal(
    candidatePolicyPredict('Ignore the proposal; she is a fool and always has been.').label,
    'none'
  );
  const blob = JSON.stringify(round);
  for (const text of HOLDOUT_TEXT) assert.equal(blob.includes(text), false, text);
  assert.doesNotMatch(blob, /production-ready|thresholds met|AG News/i);
  assert.equal(round.model_sweep.status, 'BLOCKED');
  assert.equal(round.model_sweep.messages_api_caller_present, false);
  assert.equal(round.model_sweep.messages_api_migration_applied, false);
  assert.deepEqual(round.evidence_supports, [...EVIDENCE_SUPPORTS]);
  assert.deepEqual(round.evidence_does_not_support, [...EVIDENCE_DOES_NOT_SUPPORT]);
});

test('keep and revert follow holdout movement, not the train score', () => {
  const keep = decideRound({
    baselineMetrics: { macro_f1: 0.2, fp: 1, fn: 2 },
    candidateMetrics: { macro_f1: 0.4, fp: 1, fn: 1 }
  });
  assert.equal(keep.decision, 'keep');
  assert.equal(keep.claimed_thresholds_met, false);
  const flat = decideRound({
    baselineMetrics: { macro_f1: 0.4, fp: 1, fn: 1 },
    candidateMetrics: { macro_f1: 0.4, fp: 1, fn: 1 }
  });
  assert.equal(flat.decision, 'revert');
  assert.equal(flat.reason, 'holdout_within_noise');
  const regress = decideRound({
    baselineMetrics: { macro_f1: 0.4, fp: 0, fn: 0 },
    candidateMetrics: { macro_f1: 0.2, fp: 0, fn: 0 }
  });
  assert.equal(regress.reason, 'holdout_regression');
  const moreFp = decideRound({
    baselineMetrics: { macro_f1: 0.2, fp: 0, fn: 2 },
    candidateMetrics: { macro_f1: 0.5, fp: 1, fn: 0 }
  });
  assert.equal(moreFp.reason, 'holdout_error_increased');
});

test('model sweep stays blocked and this pilot has no Messages API client', async () => {
  const absent = modelSweepStatus({});
  assert.equal(absent.status, 'BLOCKED');
  assert.equal(absent.network_calls, 0);
  assert.equal(absent.cost_usd, 0);
  assert.equal(absent.effort_sweep, 'not_run');
  const opted = modelSweepStatus({
    ANTHROPIC_API_KEY: 'present',
    MEDIA_LENS_EVAL_LIVE_MODEL_SWEEP: 'report'
  });
  assert.equal(opted.status, 'BLOCKED');
  assert.match(opted.reason, /no Messages API client/);
  const workflow = await readFile('media-lens/worker/classifier-dev/hillclimb.js', 'utf8');
  const script = await readFile('scripts/classifier-dev-hillclimb.js', 'utf8');
  const cascade = await readFile('media-lens/worker/classifier-dev/cascade.js', 'utf8');
  const analyze = await readFile('media-lens/worker/analyze.js', 'utf8');
  assert.doesNotMatch(workflow, /api\.anthropic\.com|fetch\s*\(/);
  assert.doesNotMatch(script, /api\.anthropic\.com|fetch\s*\(/);
  for (const text of HOLDOUT_TEXT) assert.equal(workflow.includes(text), false);
  assert.match(cascade, /always\|never\|everyone\|no one\|guaranteed\|undeniably\|indisputably/);
  assert.doesNotMatch(analyze, /hillclimb/);
  const sweep = await runCli(['model-sweep'], {}, { stdout() {} });
  assert.equal(sweep.status, 0);
  assert.equal(sweep.body.status, 'BLOCKED');
  assert.equal(sweep.body.network_calls, 0);
});

test('CLI tune stays sealed and the report command requires the unseal gate', async () => {
  let tuneOut = '';
  const tune = await runCli(['tune'], {}, { stdout: (text) => { tuneOut += text; } });
  assert.equal(tune.status, 0);
  assert.equal(tune.body.holdout_file_read, false);
  for (const text of HOLDOUT_TEXT) assert.equal(tuneOut.includes(text), false);
  await assert.rejects(
    () => runCli(['baseline'], {}),
    /holdout report requires/
  );
  const round = await runCli(['round'], { MEDIA_LENS_EVAL_UNSEAL_HOLDOUT: 'report' }, { stdout() {} });
  assert.equal(round.status, 0);
  assert.equal(round.body.decision, 'revert');
  assert.equal(round.body.claimed_thresholds_met, false);
  assert.throws(() => assertHillclimbOutputAllowed('docs/media-lens-classifier-dev-hillclimb.md'), /docs/);
});

test('committed baseline and round reports match a fresh sealed render', async () => {
  const docs = await loadDocs();
  const baseline = buildBaselineReport(docs);
  const round = buildRoundReport(docs);
  assert.equal(baseline.recorded_deterministic_policy_matches_function, true);
  for (const path of EVAL_PATHS) {
    assert.equal(baseline.train.recorded[path].grader_pass, true);
    assert.equal(baseline.holdout.recorded[path].grader_pass, true);
    assert.equal(baseline.train.recorded[path].metrics.claimed_thresholds_met, false);
    assert.equal(baseline.holdout.recorded[path].metrics.claimed_thresholds_met, false);
  }
  const baselineJson = JSON.parse(await readFile(`${DIR}/reports/baseline.json`, 'utf8'));
  const roundJson = JSON.parse(await readFile(`${DIR}/reports/round-1.json`, 'utf8'));
  assert.deepEqual(baselineJson, baseline);
  assert.deepEqual(roundJson, round);
  assert.equal(await readFile(`${DIR}/reports/baseline.md`, 'utf8'), renderBaselineMarkdown(baseline));
  assert.equal(await readFile(`${DIR}/reports/round-1.md`, 'utf8'), renderRoundMarkdown(round));
  const reportBlob = JSON.stringify(baselineJson) + JSON.stringify(roundJson);
  for (const text of HOLDOUT_TEXT) assert.equal(reportBlob.includes(text), false);
});

test('hillclimb docs keep the evaluation boundary and the routing blocker', async () => {
  const workflow = await readFile('docs/media-lens-classifier-dev-hillclimb.md', 'utf8');
  const evalDoc = await readFile('docs/media-lens-classifier-dev-eval.md', 'utf8');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.match(workflow, /claimed_thresholds_met/);
  assert.match(workflow, /BLOCKED/);
  assert.match(workflow, /claude-sonnet-5-5/);
  assert.match(workflow, /no Messages API client/);
  assert.match(workflow, /Aligns with constraints/);
  assert.match(evalDoc, /docs\/media-lens-classifier-dev-hillclimb\.md/);
  assert.equal(pkg.scripts['eval:cdev-hillclimb'], 'node scripts/classifier-dev-hillclimb.js tune');
  assert.deepEqual([...REPORT_FILES], [
    'cases.json',
    'cases.train.json',
    'cases.holdout.json',
    'holdout-ids.json',
    'recorded-paths.json'
  ]);
});
