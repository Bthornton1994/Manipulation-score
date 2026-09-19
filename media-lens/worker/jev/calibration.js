// Synthetic Jev calibration/quality eval harness.
//
// Measures exact-match, binary signal FP/FN, abstention, and review rates
// against labeled fixtures. Results are software-consistency numbers for
// recorded or mock-HTTP answers. They are not representative real-world
// accuracy and must not be published as sensitivity, specificity, or
// established model quality.

import { createJevAdapter, JEV_SIGNAL_NONE, JEV_SIGNAL_QUESTION_ID } from '../adapters/jev.js';

export const CALIBRATION_DISCLAIMER =
  'Synthetic labeled fixtures for software consistency only. Not representative real-world accuracy.';

function predictedChoice(adapterResult, spanId) {
  if (adapterResult.unavailableSpanIds.has(spanId) || adapterResult.failedSpanIds.has(spanId)) {
    return { kind: 'abstain', choice: null, review: false };
  }
  const answers = adapterResult.answersBySpanId.get(spanId);
  const choice = answers?.[JEV_SIGNAL_QUESTION_ID]?.choice ?? null;
  const review = adapterResult.reviewSpanIds.has(spanId);
  if (choice == null) return { kind: 'abstain', choice: null, review };
  return { kind: 'predict', choice, review };
}

/**
 * @param {Array<{ id: string, label: { influence_signal: string }, span: { id: string } }>} cases
 * @param {Array<{ caseId: string, result: object }>} runs
 */
export function evaluateCalibrationRuns(cases, runs) {
  const byId = new Map(runs.map((run) => [run.caseId, run]));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let abstentions = 0;
  let reviews = 0;
  let exactMatch = 0;
  let scored = 0;
  const rows = [];

  for (const labeled of cases) {
    const run = byId.get(labeled.id);
    if (!run) {
      throw new Error(`missing calibration run for case ${labeled.id}`);
    }
    const spanId = labeled.span.id;
    const predicted = predictedChoice(run.result, spanId);
    const label = labeled.label.influence_signal;
    const labelPositive = label !== JEV_SIGNAL_NONE;

    if (predicted.kind === 'abstain') {
      abstentions += 1;
      rows.push({ id: labeled.id, label, predicted: null, outcome: 'abstain', review: predicted.review });
      continue;
    }

    scored += 1;
    if (predicted.review) reviews += 1;
    if (predicted.choice === label) exactMatch += 1;

    const predPositive = predicted.choice !== JEV_SIGNAL_NONE;
    if (labelPositive && predPositive) tp += 1;
    else if (!labelPositive && predPositive) fp += 1;
    else if (labelPositive && !predPositive) fn += 1;
    else tn += 1;

    rows.push({
      id: labeled.id,
      label,
      predicted: predicted.choice,
      outcome: predicted.choice === label ? 'exact' : 'mismatch',
      review: predicted.review
    });
  }

  return {
    disclaimer: CALIBRATION_DISCLAIMER,
    n: cases.length,
    scored,
    exact_match: exactMatch,
    tp,
    fp,
    fn,
    tn,
    abstentions,
    reviews,
    rows
  };
}

export async function runCalibrationCases(cases, { mode, fixtureDir, baseUrl, apiKey, fetchImpl, timeoutMs, concurrency = 1 }) {
  const runs = [];
  for (const labeled of cases) {
    const adapter = createJevAdapter({
      mode,
      fixtureId: labeled.id,
      fixtureDir,
      baseUrl,
      apiKey,
      fetchImpl,
      timeoutMs,
      concurrency
    });
    const result = await adapter.analyzeSpans([labeled.span], labeled.artifact);
    runs.push({ caseId: labeled.id, result });
  }
  return evaluateCalibrationRuns(cases, runs);
}
