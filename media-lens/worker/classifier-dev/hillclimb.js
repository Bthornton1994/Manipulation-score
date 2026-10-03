// Hillclimb workflow on top of the classifier.dev evaluation harness.
// Fixture-only. The tune role cannot open the holdout case file.
// Metrics come from eval-harness.js. This module does not call a model,
// does not enable live URL, and does not claim thresholds are met.

import { resolve } from 'node:path';
import {
  EVAL_DISCLAIMER,
  EVAL_PATHS,
  deterministicPolicyPredict,
  evaluatePath,
  pathLabelOptions,
  validateGraderStability
} from './eval-harness.js';

export const HILLCLIMB_VERSION = 'cdev-hillclimb-0.1.0';
export const PILOT_BASE_SHA = '1398d17d69b1ad2f93a80823d7a68b1b6e6baf93';
export const HILLCLIMB_REPEAT_NOISE_FLOOR = 0;
export const HILLCLIMB_STALL_STOP = 3;
export const POLICY_LATENCY_MS = 1;

export const TUNE_FILES = Object.freeze(['cases.train.json', 'holdout-ids.json']);
export const REPORT_FILES = Object.freeze([
  'cases.json',
  'cases.train.json',
  'cases.holdout.json',
  'holdout-ids.json',
  'recorded-paths.json'
]);

const STRONG_CERTAINTY_PATTERN = /\b(guaranteed|undeniably|indisputably)\b/i;
const SET_ROLES = new Set(['negative_control', 'positive_control', 'hard_context', 'abstain_insufficient']);

export const ROUND1_CANDIDATE = Object.freeze({
  id: 'deterministic_policy_round1_strong_markers_only',
  attributable_change:
    'One rule edit on the train case eval-personal-attack: treat only guaranteed, undeniably, and indisputably as certainty markers. Do not install this rule unless holdout macro F1 improves beyond repeat noise.',
  motivating_case_ids: Object.freeze(['eval-personal-attack']),
  installed: false
});

export const EVIDENCE_SUPPORTS = Object.freeze([
  'The deterministic grader agrees with itself on a repeated grade of the same outputs and on a reversed prediction order.',
  'The tune command reads cases.train.json and holdout-ids.json. It does not open cases.holdout.json or the full catalog.',
  'Round 1 moves train macro F1 and leaves holdout macro F1 unchanged, so the candidate is reverted.',
  'The fixture path records cost_usd 0 and network_calls 0.'
]);

export const EVIDENCE_DOES_NOT_SUPPORT = Object.freeze([
  'Real-world accuracy, sensitivity, specificity, or fairness.',
  'Meeting documented acceptance thresholds. claimed_thresholds_met is false.',
  'Production readiness, live URL quality, feed quality, or classifier.dev quality.',
  'A kept edit to deterministic_policy. The installed rule remains the baseline.',
  'A measured quality, cost, or latency difference between an Opus-oriented workflow and Sonnet 5.5. The live sweep is BLOCKED.'
]);

export function candidatePolicyPredict(spanText) {
  if (typeof spanText !== 'string' || spanText.trim().length === 0) {
    return { abstain: true, label: null, confidence: null };
  }
  if (STRONG_CERTAINTY_PATTERN.test(spanText)) {
    return { abstain: false, label: 'certainty_beyond_evidence', confidence: null };
  }
  return { abstain: false, label: 'none', confidence: null };
}

export function predictionsFromPolicy(cases, predict, latencyMs = POLICY_LATENCY_MS) {
  return cases.map((item) => {
    const result = predict(item.span?.text);
    return {
      caseId: item.id,
      label: result.label,
      confidence: result.confidence,
      abstain: result.abstain === true,
      latencyMs
    };
  });
}

export function projectSplitDocument(catalog, split) {
  return {
    disclaimer: catalog.disclaimer,
    taxonomy_version: catalog.taxonomy_version,
    policy_version: catalog.policy_version,
    split,
    cases: catalog.cases.filter((item) => item.split === split)
  };
}

export function checkEvalPlumbing({ cases, predictions, labelKey }) {
  const errors = [];
  if (!Array.isArray(cases) || cases.length === 0) errors.push('cases must be a non-empty array');
  if (!Array.isArray(predictions)) errors.push('predictions must be an array');
  const ids = new Set();
  for (const item of cases || []) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) {
      errors.push('case missing id');
      continue;
    }
    if (ids.has(item.id)) errors.push(`duplicate case id ${item.id}`);
    ids.add(item.id);
    if (typeof item.span?.text !== 'string') errors.push(`${item.id} missing span text`);
    if (typeof item.label?.[labelKey] !== 'string' || item.label[labelKey].length === 0) {
      errors.push(`${item.id} missing ${labelKey} label`);
    }
  }
  const seen = new Set();
  for (const row of predictions || []) {
    if (!row || typeof row.caseId !== 'string') {
      errors.push('prediction missing caseId');
      continue;
    }
    if (seen.has(row.caseId)) errors.push(`duplicate prediction ${row.caseId}`);
    seen.add(row.caseId);
    if (!ids.has(row.caseId)) errors.push(`orphan prediction ${row.caseId}`);
    if (typeof row.abstain !== 'boolean') errors.push(`${row.caseId} abstain must be boolean`);
    if (row.latencyMs != null && (typeof row.latencyMs !== 'number' || !Number.isFinite(row.latencyMs))) {
      errors.push(`${row.caseId} latencyMs must be a finite number`);
    }
  }
  for (const id of ids) {
    if (!seen.has(id)) errors.push(`missing prediction ${id}`);
  }
  return { pass: errors.length === 0, errors };
}

export function assertSplitIntegrity({ catalog, train, holdout, holdoutIds }) {
  const errors = [];
  const keys = Object.keys(holdoutIds || {}).sort();
  if (keys.join(',') !== 'disclaimer,ids') errors.push('holdout id file must contain only disclaimer and ids');
  const idBlob = JSON.stringify(holdoutIds || {});
  if (idBlob.includes('"text"') || idBlob.includes('"label"') || idBlob.includes('"span"')) {
    errors.push('holdout id file must not carry span text or labels');
  }
  const catalogCases = catalog?.cases || [];
  const trainCases = train?.cases || [];
  const holdoutCases = holdout?.cases || [];
  const sealed = holdoutIds?.ids || [];
  const sealedSet = new Set(sealed);
  const seen = new Set();
  for (const item of catalogCases) {
    if (seen.has(item.id)) errors.push(`duplicate catalog id ${item.id}`);
    seen.add(item.id);
    if (item.split !== 'train' && item.split !== 'holdout') errors.push(`${item.id} has an invalid split`);
    if (!SET_ROLES.has(item.set_role)) errors.push(`${item.id} has an invalid set_role`);
    if (item.split === 'holdout' && !sealedSet.has(item.id)) errors.push(`${item.id} is missing from sealed ids`);
    if (item.split === 'train' && sealedSet.has(item.id)) errors.push(`${item.id} is both train and sealed`);
  }
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (!same(trainCases, catalogCases.filter((item) => item.split === 'train'))) {
    errors.push('cases.train.json does not match the catalog train split');
  }
  if (!same(holdoutCases, catalogCases.filter((item) => item.split === 'holdout'))) {
    errors.push('cases.holdout.json does not match the catalog holdout split');
  }
  if (!same(sealed, holdoutCases.map((item) => item.id))) {
    errors.push('sealed ids do not match the holdout file');
  }
  for (const role of ['hard_context', 'negative_control', 'abstain_insufficient']) {
    if (!catalogCases.some((item) => item.set_role === role)) errors.push(`catalog is missing ${role}`);
  }
  for (const id of ROUND1_CANDIDATE.motivating_case_ids) {
    const item = catalogCases.find((row) => row.id === id);
    if (!item || item.split !== 'train') errors.push(`motivating case ${id} must stay on train`);
  }
  return { pass: errors.length === 0, errors };
}

export function listOutcomes(cases, predictions, labelKey, { includeText }) {
  const byId = new Map(predictions.map((row) => [row.caseId, row]));
  const mismatches = [];
  const abstentions = [];
  for (const item of cases) {
    const predicted = byId.get(item.id);
    const base = includeText ? { case_id: item.id, text: item.span.text } : { case_id: item.id };
    if (predicted.abstain) {
      abstentions.push({ ...base, expected: item.label[labelKey] });
      continue;
    }
    if (predicted.label !== item.label[labelKey]) {
      mismatches.push({ ...base, expected: item.label[labelKey], predicted: predicted.label });
    }
  }
  return { mismatches, abstentions };
}

function metricSummary(metrics) {
  return {
    n: metrics.n,
    scored: metrics.scored,
    macro_p: metrics.macro_p,
    macro_r: metrics.macro_r,
    macro_f1: metrics.macro_f1,
    fp: metrics.fp,
    fn: metrics.fn,
    abstention_rate: metrics.abstention_rate,
    latency_ms_mean: metrics.latency_ms_mean,
    claimed_thresholds_met: false
  };
}

export function scoreCases(cases, predictions, path, { includeText }) {
  const options = pathLabelOptions(path);
  const plumbing = checkEvalPlumbing({ cases, predictions, labelKey: options.labelKey });
  if (!plumbing.pass) {
    return { plumbing, grader: null, metrics: null, outcomes: null };
  }
  const grader = validateGraderStability(cases, predictions, options);
  const metrics = evaluatePath(cases, predictions, options);
  return {
    plumbing,
    grader,
    metrics,
    outcomes: listOutcomes(cases, predictions, options.labelKey, { includeText })
  };
}

export function filterRecorded(recorded, cases) {
  const allow = new Set(cases.map((item) => item.id));
  const out = {};
  for (const path of EVAL_PATHS) {
    if (!Array.isArray(recorded?.[path])) throw new Error(`missing recorded path ${path}`);
    out[path] = recorded[path].filter((row) => allow.has(row.caseId));
  }
  return out;
}

export function recordedMatchesPolicy(cases, recordedRows, predict) {
  const expected = predictionsFromPolicy(cases, predict);
  const byId = new Map(recordedRows.map((row) => [row.caseId, row]));
  const mismatches = [];
  for (const row of expected) {
    const recorded = byId.get(row.caseId);
    if (!recorded || recorded.label !== row.label || recorded.abstain !== row.abstain) mismatches.push(row.caseId);
  }
  return { pass: mismatches.length === 0, mismatches };
}

function packScore(scored) {
  return {
    metrics: metricSummary(scored.metrics),
    confusion: scored.metrics.confusion,
    grader_pass: scored.grader.pass,
    plumbing_pass: scored.plumbing.pass,
    plumbing_errors: scored.plumbing.errors,
    mismatches: scored.outcomes.mismatches,
    abstentions: scored.outcomes.abstentions
  };
}

function scorePolicy(cases, predict, includeText) {
  return packScore(scoreCases(cases, predictionsFromPolicy(cases, predict), 'deterministic_policy', { includeText }));
}

function scoreRecordedSplit(cases, recorded, includeText) {
  const filtered = filterRecorded(recorded, cases);
  const paths = {};
  const errors = [];
  for (const path of EVAL_PATHS) {
    const scored = scoreCases(cases, filtered[path], path, { includeText });
    if (!scored.plumbing.pass) errors.push(...scored.plumbing.errors.map((error) => `${path}: ${error}`));
    if (scored.grader && !scored.grader.pass) errors.push(`${path}: grader stability failed`);
    paths[path] = scored.metrics ? packScore(scored) : { plumbing_pass: false, plumbing_errors: scored.plumbing.errors };
  }
  return { pass: errors.length === 0, errors, paths };
}

export function modelSweepStatus(env = {}) {
  const hasKey = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.length > 0;
  const optedIn = env.MEDIA_LENS_EVAL_LIVE_MODEL_SWEEP === 'report';
  let reason = 'ANTHROPIC_API_KEY is absent. No Messages API call is implemented in this pilot.';
  if (hasKey && !optedIn) {
    reason = 'MEDIA_LENS_EVAL_LIVE_MODEL_SWEEP is not the exact string report. The live sweep stays off.';
  } else if (hasKey && optedIn) {
    reason = 'This pilot has no Messages API client. Setting the opt-in flag cannot spend.';
  }
  return {
    status: 'BLOCKED',
    reason,
    network_calls: 0,
    cost_usd: 0,
    effort: 'N/A',
    effort_sweep: 'not_run',
    effort_levels_in_provider_docs: ['low', 'medium', 'high', 'xhigh', 'max'],
    effort_sweep_skipped_because: 'A live effort sweep would be new spend. Provider docs list effort levels, and this pilot does not call them.',
    messages_api_migration_applied: false,
    messages_api_caller_present: false,
    command: 'MEDIA_LENS_EVAL_LIVE_MODEL_SWEEP=report node scripts/classifier-dev-hillclimb.js model-sweep',
    claimed_thresholds_met: false
  };
}

export function sonnetRoutingNote() {
  return {
    recommendation:
      'For this bounded fixture, grader, and report task, the routing recommendation is Sonnet 5.5 (claude-sonnet-5-5). Keep the Opus-oriented workflow for methodology judgment, safety-claim wording, and unbounded product changes. This pilot does not change global model assignments.',
    compared_task: 'bounded eval and hillclimb tooling',
    sonnet_model_id: 'claude-sonnet-5-5',
    opus_api_model_id: null,
    quality: 'not_measured_live',
    safety:
      'Model routing is not a safety control. Merge readiness for this pilot uses the deterministic grader and tests. An LLM is not the judge. Live URL, feeds, Medialyst, and classifier.dev stay off.',
    cost: 'Fixture path cost_usd is 0. Live comparison cost was not measured.',
    latency: 'Reported latency is fixture-declared or the local policy constant of 1 ms. Live latency was not measured.',
    uncertainty: 'No paired model repeats. Deterministic grader repeat delta is 0. Case counts are small, so a nonzero F1 move would still be software consistency, not population accuracy.',
    messages_api_migration_applied: false
  };
}

function envelope(extra) {
  return {
    schema: 'media-lens-cdev-hillclimb-report.v1',
    disclaimer: EVAL_DISCLAIMER,
    evaluation_only: true,
    claimed_thresholds_met: false,
    harness: 'media-lens/worker/classifier-dev/eval-harness.js',
    workflow: 'media-lens/worker/classifier-dev/hillclimb.js',
    harness_version: HILLCLIMB_VERSION,
    base_sha: PILOT_BASE_SHA,
    model: null,
    model_version: null,
    effort: 'N/A',
    prompts: [],
    tools: ['deterministic_policy', 'evaluatePath'],
    cost_usd: 0,
    network_calls: 0,
    repeats: 2,
    latency_source: 'fixture_declared_or_policy_constant',
    live_url_enabled: false,
    ...extra
  };
}

export function runTuneEvaluation({ trainCases, sealedIds }) {
  const overlap = (trainCases || []).filter((item) => (sealedIds || []).includes(item.id)).map((item) => item.id);
  if (overlap.length > 0) throw new Error(`tune refused sealed ids: ${overlap.join(',')}`);
  for (const id of ROUND1_CANDIDATE.motivating_case_ids) {
    if ((sealedIds || []).includes(id) || !(trainCases || []).some((item) => item.id === id)) {
      throw new Error(`candidate motivation must stay on train: ${id}`);
    }
  }
  const baseline = scorePolicy(trainCases, deterministicPolicyPredict, true);
  const candidate = scorePolicy(trainCases, candidatePolicyPredict, true);
  if (!baseline.grader_pass || !candidate.grader_pass || !baseline.plumbing_pass || !candidate.plumbing_pass) {
    throw new Error('train grader or plumbing failed');
  }
  return {
    role: 'tune',
    holdout_file_read: false,
    holdout_span_text_included: false,
    sealed_holdout_count: sealedIds.length,
    candidate: ROUND1_CANDIDATE,
    baseline,
    candidate_score: candidate,
    train_macro_f1_delta: candidate.metrics.macro_f1 - baseline.metrics.macro_f1,
    claimed_thresholds_met: false,
    cost_usd: 0,
    network_calls: 0,
    effort: 'N/A'
  };
}

export function decideRound({ baselineMetrics, candidateMetrics }) {
  const delta = candidateMetrics.macro_f1 - baselineMetrics.macro_f1;
  const fpIncreased = candidateMetrics.fp > baselineMetrics.fp;
  const fnIncreased = candidateMetrics.fn > baselineMetrics.fn;
  const beyondNoise = delta > HILLCLIMB_REPEAT_NOISE_FLOOR && !fpIncreased && !fnIncreased;
  let reason = 'holdout_within_noise';
  if (delta < HILLCLIMB_REPEAT_NOISE_FLOOR) reason = 'holdout_regression';
  else if (fpIncreased || fnIncreased) reason = 'holdout_error_increased';
  else if (beyondNoise) reason = 'holdout_improved_beyond_repeat_noise';
  return {
    decision: beyondNoise ? 'keep' : 'revert',
    reason,
    holdout_macro_f1_delta: delta,
    noise_floor_macro_f1: HILLCLIMB_REPEAT_NOISE_FLOOR,
    fp_increased: fpIncreased,
    fn_increased: fnIncreased,
    stall: !beyondNoise,
    installed_policy: 'deterministic_policy',
    claimed_thresholds_met: false
  };
}

export function buildBaselineReport({ catalog, train, holdout, holdoutIds, recorded }) {
  const integrity = assertSplitIntegrity({ catalog, train, holdout, holdoutIds });
  if (!integrity.pass) {
    throw new Error(`split integrity failed: ${integrity.errors.join('; ')}`);
  }
  const trainRecorded = scoreRecordedSplit(train.cases, recorded, true);
  const holdoutRecorded = scoreRecordedSplit(holdout.cases, recorded, false);
  if (!trainRecorded.pass || !holdoutRecorded.pass) {
    throw new Error(`recorded plumbing failed: ${[...trainRecorded.errors, ...holdoutRecorded.errors].join('; ')}`);
  }
  const functionMatch = recordedMatchesPolicy(
    catalog.cases,
    recorded.deterministic_policy,
    deterministicPolicyPredict
  );
  return envelope({
    report: 'baseline',
    holdout_span_text_included: false,
    split_integrity_pass: true,
    recorded_deterministic_policy_matches_function: functionMatch.pass,
    recorded_deterministic_policy_mismatches: functionMatch.mismatches,
    uncertainty: {
      repeat_macro_f1_delta: 0,
      small_n: true,
      population_interval: null,
      note: 'Repeat noise on this deterministic grader is 0. The case count is too small to support a population accuracy claim.'
    },
    inputs: {
      train_ids: train.cases.map((item) => item.id),
      holdout_ids: holdout.cases.map((item) => item.id),
      catalog_n: catalog.cases.length
    },
    train: {
      include_span_text_on_failures: true,
      recorded: trainRecorded.paths,
      deterministic_policy: scorePolicy(train.cases, deterministicPolicyPredict, true)
    },
    holdout: {
      include_span_text_on_failures: false,
      recorded: holdoutRecorded.paths,
      deterministic_policy: scorePolicy(holdout.cases, deterministicPolicyPredict, false)
    },
    model_sweep: modelSweepStatus({}),
    routing: sonnetRoutingNote(),
    evidence_supports: EVIDENCE_SUPPORTS,
    evidence_does_not_support: EVIDENCE_DOES_NOT_SUPPORT
  });
}

export function buildRoundReport({ catalog, train, holdout, holdoutIds, recorded }) {
  const baseline = buildBaselineReport({ catalog, train, holdout, holdoutIds, recorded });
  const tune = runTuneEvaluation({ trainCases: train.cases, sealedIds: holdoutIds.ids });
  const holdoutBaseline = scorePolicy(holdout.cases, deterministicPolicyPredict, false);
  const holdoutCandidate = scorePolicy(holdout.cases, candidatePolicyPredict, false);
  const decision = decideRound({
    baselineMetrics: holdoutBaseline.metrics,
    candidateMetrics: holdoutCandidate.metrics
  });
  return envelope({
    report: 'round-1',
    holdout_span_text_included: false,
    holdout_scored: true,
    candidate: ROUND1_CANDIDATE,
    train_macro_f1_delta: tune.train_macro_f1_delta,
    train_baseline_macro_f1: tune.baseline.metrics.macro_f1,
    train_candidate_macro_f1: tune.candidate_score.metrics.macro_f1,
    train_baseline_mismatches: tune.baseline.mismatches,
    train_candidate_mismatches: tune.candidate_score.mismatches,
    holdout_baseline: holdoutBaseline,
    holdout_candidate: holdoutCandidate,
    ...decision,
    stall_count: decision.stall ? 1 : 0,
    stop_rules: {
      revert_when_holdout_delta_at_or_below_repeat_noise: true,
      repeat_noise_floor_macro_f1: HILLCLIMB_REPEAT_NOISE_FLOOR,
      stop_search_after_consecutive_stalls: HILLCLIMB_STALL_STOP,
      stall_count_after_this_round: decision.stall ? 1 : 0,
      pilot_rounds_executed: 1,
      this_round: decision.stall
        ? 'Candidate reverted because holdout movement is inside repeat noise.'
        : 'Candidate beat repeat noise on holdout.',
      search: 'This pilot stops after one round. A later round needs a fresh attributable change and a holdout that has not been used to write that change.'
    },
    installed_policy_behavior: 'baseline_regex_unchanged',
    uncertainty: baseline.uncertainty,
    model_sweep: modelSweepStatus({}),
    routing: sonnetRoutingNote(),
    evidence_supports: EVIDENCE_SUPPORTS,
    evidence_does_not_support: EVIDENCE_DOES_NOT_SUPPORT,
    related: {
      jev_calibration_fixtures: 'media-lens/fixtures/jev-calibration/',
      usage_lab_holdout: 'docs/jev-usage-lab/06-evaluation-harness.md',
      note: 'Those sets are related sealed-fixture practice. This pilot does not score them and does not fit thresholds from them.'
    }
  });
}

function fmt(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(4);
}

function bullet(lines) {
  return lines.map((line) => `- ${line}`).join('\n');
}

export function renderBaselineMarkdown(report) {
  const rows = ['| path | split | n | macro_f1 | fp | fn | abstention_rate | latency_ms_mean |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const split of ['train', 'holdout']) {
    for (const path of EVAL_PATHS) {
      const metrics = report[split].recorded[path].metrics;
      rows.push(`| ${path} | ${split} | ${metrics.n} | ${fmt(metrics.macro_f1)} | ${metrics.fp} | ${metrics.fn} | ${fmt(metrics.abstention_rate)} | ${fmt(metrics.latency_ms_mean)} |`);
    }
    const policy = report[split].deterministic_policy.metrics;
    rows.push(`| deterministic_policy_function | ${split} | ${policy.n} | ${fmt(policy.macro_f1)} | ${policy.fp} | ${policy.fn} | ${fmt(policy.abstention_rate)} | ${fmt(policy.latency_ms_mean)} |`);
  }
  return `# classifier.dev hillclimb baseline

${report.disclaimer}

Evaluation only. \`claimed_thresholds_met\` is false. Base SHA \`${report.base_sha}\`. Harness \`${report.harness_version}\`. Model: none. Effort: N/A. Cost USD: ${report.cost_usd}. Network calls: ${report.network_calls}. Repeats: ${report.repeats}. Latency source: ${report.latency_source}.

Holdout span text is omitted from this report. Recorded deterministic_policy matches the local function: ${report.recorded_deterministic_policy_matches_function}.

## Scores

${rows.join('\n')}

## Uncertainty

${report.uncertainty.note} Population interval: none.

## Routing

${report.routing.recommendation}

Quality: ${report.routing.quality}. Safety: ${report.routing.safety} Cost: ${report.routing.cost} Latency: ${report.routing.latency} Uncertainty: ${report.routing.uncertainty}

Model sweep: ${report.model_sweep.status}. ${report.model_sweep.reason}

## Evidence

Supports:

${bullet(report.evidence_supports)}

Does not support:

${bullet(report.evidence_does_not_support)}
`;
}

export function renderRoundMarkdown(report) {
  return `# classifier.dev hillclimb round 1

${report.disclaimer}

Evaluation only. \`claimed_thresholds_met\` is false. Decision: **${report.decision}** (${report.reason}). Installed policy: \`${report.installed_policy}\`.

Candidate \`${report.candidate.id}\` is not installed. ${report.candidate.attributable_change}

Train macro F1 ${fmt(report.train_baseline_macro_f1)} to ${fmt(report.train_candidate_macro_f1)} (delta ${fmt(report.train_macro_f1_delta)}). Holdout macro F1 ${fmt(report.holdout_baseline.metrics.macro_f1)} to ${fmt(report.holdout_candidate.metrics.macro_f1)} on n=${report.holdout_baseline.metrics.n} (delta ${fmt(report.holdout_macro_f1_delta)}). A holdout score of 1 on this slice is software consistency. \`claimed_thresholds_met\` stays false. Repeat noise floor ${fmt(report.noise_floor_macro_f1)}. Stall count ${report.stall_count}.

${report.stop_rules.this_round} ${report.stop_rules.search}

Holdout span text is omitted. Cost USD: ${report.cost_usd}. Network calls: ${report.network_calls}. Effort: ${report.effort}. Model: none.

## Train mismatches after the candidate

${report.train_candidate_mismatches.length === 0 ? 'None.' : bullet(report.train_candidate_mismatches.map((row) => `${row.case_id}: expected ${row.expected}, predicted ${row.predicted}`))}

## Holdout mismatches, baseline and candidate

Baseline: ${report.holdout_baseline.mismatches.length}. Candidate: ${report.holdout_candidate.mismatches.length}. Case ids only.

## Routing

${report.routing.recommendation}

Quality: ${report.routing.quality}. Safety: ${report.routing.safety} Cost: ${report.routing.cost} Latency: ${report.routing.latency} Uncertainty: ${report.routing.uncertainty}

Model sweep: ${report.model_sweep.status}. ${report.model_sweep.reason} Messages API migration applied: ${report.model_sweep.messages_api_migration_applied}.

## Evidence

Supports:

${bullet(report.evidence_supports)}

Does not support:

${bullet(report.evidence_does_not_support)}
`;
}

export async function loadPilotDocuments(readFile, dir, { role, unseal }) {
  const read = async (name) => JSON.parse(await readFile(resolve(dir, name), 'utf8'));
  if (role === 'tune') {
    if (unseal) throw new Error('tune role cannot unseal holdout');
    const train = await read('cases.train.json');
    const holdoutIds = await read('holdout-ids.json');
    return { train, holdoutIds };
  }
  if (role === 'report') {
    if (unseal !== 'report') throw new Error('holdout report requires MEDIA_LENS_EVAL_UNSEAL_HOLDOUT=report');
    const [catalog, train, holdout, holdoutIds, recorded] = await Promise.all(REPORT_FILES.map((name) => read(name)));
    return { catalog, train, holdout, holdoutIds, recorded };
  }
  throw new Error(`unknown hillclimb role ${role}`);
}
