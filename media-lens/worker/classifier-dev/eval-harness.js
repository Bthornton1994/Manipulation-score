// Fixture-based evaluation harness for Media Lens classifier.dev packaging.
// Metrics are software-consistency placeholders on synthetic fixtures.
// They are not representative real-world accuracy and must not be published
// as established quality, AG News/emotion benchmark substitutes, or
// production-readiness evidence.

export const EVAL_DISCLAIMER =
  'Synthetic/public-safe fixtures for software consistency only. Not representative real-world accuracy. Thresholds are documented, not met, and not claimed.';

export const EVAL_PATHS = Object.freeze([
  'direct_jev',
  'cdev_fast',
  'cdev_smart',
  'cascade',
  'deterministic_policy'
]);

export const DOCUMENTED_ACCEPTANCE_THRESHOLDS = Object.freeze({
  macro_f1: { documented: 0.8, claimed_met: false, note: 'Future owner-approved evaluation gate. Unset as a claim.' },
  abstention_rate_max: { documented: 0.35, claimed_met: false, note: 'Documented ceiling for a later eval, not a current result.' },
  calibration_ece_max: { documented: 0.15, claimed_met: false, note: 'Placeholder expected calibration error gate. Not measured as production quality.' },
  disagreement_must_review: { documented: true, claimed_met: false, note: 'Policy requirement; fixture harness checks software behavior, not field accuracy.' }
});

const BANDS = [
  { id: 'low', min: 0, max: 0.5 },
  { id: 'mid', min: 0.5, max: 0.8 },
  { id: 'high', min: 0.8, max: 1.0000001 }
];

function bandFor(confidence) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'unknown';
  for (const band of BANDS) {
    if (confidence >= band.min && confidence < band.max) return band.id;
  }
  return 'unknown';
}

function confusionMatrix(labels, pairs) {
  const index = new Map(labels.map((id, i) => [id, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (const pair of pairs) {
    const i = index.get(pair.label);
    const j = index.get(pair.predicted);
    if (i == null || j == null) continue;
    matrix[i][j] += 1;
  }
  return { labels, matrix };
}

function macroPrf(labels, pairs) {
  const stats = new Map(labels.map((id) => [id, { tp: 0, fp: 0, fn: 0 }]));
  for (const pair of pairs) {
    if (pair.label === pair.predicted) {
      stats.get(pair.label).tp += 1;
    } else {
      if (stats.has(pair.predicted)) stats.get(pair.predicted).fp += 1;
      if (stats.has(pair.label)) stats.get(pair.label).fn += 1;
    }
  }
  let pSum = 0;
  let rSum = 0;
  let counted = 0;
  for (const id of labels) {
    const { tp, fp, fn } = stats.get(id);
    if (tp + fp + fn === 0) continue;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    pSum += precision;
    rSum += recall;
    counted += 1;
  }
  const precision = counted ? pSum / counted : 0;
  const recall = counted ? rSum / counted : 0;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, classes_scored: counted };
}

function binaryFpFn(pairs, negativeId) {
  let fp = 0;
  let fn = 0;
  for (const pair of pairs) {
    const labelPositive = pair.label !== negativeId;
    const predPositive = pair.predicted !== negativeId;
    if (!labelPositive && predPositive) fp += 1;
    if (labelPositive && !predPositive) fn += 1;
  }
  return { fp, fn };
}

export function evaluatePath(cases, predictions, { labelKey, negativeId }) {
  const byId = new Map(predictions.map((row) => [row.caseId, row]));
  const pairs = [];
  let abstentions = 0;
  let latencySum = 0;
  let latencyN = 0;
  const calibration = { low: { n: 0, exact: 0 }, mid: { n: 0, exact: 0 }, high: { n: 0, exact: 0 }, unknown: { n: 0, exact: 0 } };

  for (const labeled of cases) {
    const predicted = byId.get(labeled.id);
    if (!predicted) throw new Error(`missing prediction for ${labeled.id}`);
    const expected = labeled.label[labelKey];
    latencySum += Number(predicted.latencyMs) || 0;
    latencyN += 1;
    if (predicted.abstain) {
      abstentions += 1;
      continue;
    }
    const exact = predicted.label === expected;
    const band = bandFor(predicted.confidence);
    calibration[band].n += 1;
    if (exact) calibration[band].exact += 1;
    pairs.push({ label: expected, predicted: predicted.label });
  }

  const labels = [...new Set(cases.map((item) => item.label[labelKey]).filter(Boolean))].sort();
  const prf = macroPrf(labels, pairs);
  return {
    disclaimer: EVAL_DISCLAIMER,
    claimed_thresholds_met: false,
    n: cases.length,
    scored: pairs.length,
    abstention_rate: cases.length ? abstentions / cases.length : 0,
    macro_p: prf.precision,
    macro_r: prf.recall,
    macro_f1: prf.f1,
    confusion: confusionMatrix(labels, pairs),
    ...binaryFpFn(pairs, negativeId),
    calibration_bands: calibration,
    latency_ms_mean: latencyN ? latencySum / latencyN : 0
  };
}

export function evaluateEvalHarness(cases, pathPredictions) {
  const paths = {};
  for (const path of EVAL_PATHS) {
    const predictions = pathPredictions[path];
    if (!Array.isArray(predictions)) {
      throw new Error(`missing predictions for path ${path}`);
    }
    const labelKey = path === 'direct_jev' || path === 'deterministic_policy' ? 'jev' : 'cdev';
    const negativeId = labelKey === 'jev' ? 'none' : 'no_detected_signal';
    paths[path] = evaluatePath(cases, predictions, { labelKey, negativeId });
  }
  return {
    disclaimer: EVAL_DISCLAIMER,
    evaluation_only: true,
    claimed_thresholds_met: false,
    documented_thresholds: DOCUMENTED_ACCEPTANCE_THRESHOLDS,
    paths
  };
}

export function deterministicPolicyPredict(spanText) {
  if (typeof spanText !== 'string' || spanText.trim().length === 0) {
    return { abstain: true, label: null, confidence: null };
  }
  if (/\b(always|never|everyone|no one|guaranteed|undeniably|indisputably)\b/i.test(spanText)) {
    return { abstain: false, label: 'certainty_beyond_evidence', confidence: null };
  }
  return { abstain: false, label: 'none', confidence: null };
}
