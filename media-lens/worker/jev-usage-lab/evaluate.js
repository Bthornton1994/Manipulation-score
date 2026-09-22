// Fixture-only evaluation for shadow decisions.
//
// Counts are software checks against labeled replays. They are not
// real-world accuracy, and this module does not call Jev or fit thresholds.

import { FROZEN_FUSION_THRESHOLDS, SHADOW_MIN_MARGIN, COST_UNAVAILABLE } from './decision.js';

export const EVAL_DISCLAIMER =
  'Fixture replay only. Not real-world accuracy, not a production-readiness claim, and not a measurement of an external model.';

const CALIBRATION_BINS = [
  { name: '[0,0.5)', min: 0, max: 0.5 },
  { name: '[0.5,0.7)', min: 0.5, max: 0.7 },
  { name: '[0.7,1]', min: 0.7, max: 1.0000001 }
];

function round3(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return round3(numerator / denominator);
}

export function binaryScores(tp, fp, fn) {
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision == null || recall == null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision: round3(precision), recall: round3(recall), f1: round3(f1) };
}

function isAbstainedRecord(record) {
  return record?.abstained === true || record?.suppressed_by_span_abstain === true;
}

function predictedLabel(record) {
  if (isAbstainedRecord(record) || record.selected_option == null) return 'abstain';
  return record.selected_option;
}

function actualLabel(label) {
  if (!label || label.option == null || label.option === 'abstain') return 'abstain';
  return label.option;
}

function emptyMatrix(optionIds) {
  const labels = [...optionIds];
  if (!labels.includes('abstain')) labels.push('abstain');
  const matrix = {};
  for (const actual of labels) {
    matrix[actual] = {};
    for (const predicted of labels) matrix[actual][predicted] = 0;
  }
  return { labels, matrix };
}

function questionMetrics(question, cases) {
  const optionIds = Object.keys(question.criteria || {});
  const { labels, matrix } = emptyMatrix(optionIds);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const bins = CALIBRATION_BINS.map((bin) => ({ ...bin, n: 0, correct: 0 }));
  const positive = question.binary_positive || null;

  for (const item of cases) {
    const actual = actualLabel(item.label);
    const predicted = predictedLabel(item.record);
    if (!matrix[actual]) {
      matrix[actual] = {};
      for (const label of labels) matrix[actual][label] = 0;
      labels.push(actual);
    }
    if (matrix[actual][predicted] == null) matrix[actual][predicted] = 0;
    matrix[actual][predicted] += 1;

    if (positive && actual !== 'abstain' && predicted !== 'abstain') {
      const actualPos = actual === positive;
      const predPos = predicted === positive;
      if (actualPos && predPos) tp += 1;
      else if (!actualPos && predPos) fp += 1;
      else if (actualPos && !predPos) fn += 1;
      else tn += 1;
    }

    if (!isAbstainedRecord(item.record) && item.label?.option != null && item.label.option !== 'abstain') {
      const confidence = item.record.confidence;
      const bin = bins.find((candidate) => typeof confidence === 'number' && confidence >= candidate.min && confidence < candidate.max);
      if (bin) {
        bin.n += 1;
        if (item.record.selected_option === item.label.option) bin.correct += 1;
      }
    }
  }

  return {
    n: cases.length,
    confusion: { labels, matrix },
    binary: positive ? { positive, tn, ...binaryScores(tp, fp, fn) } : null,
    calibration: bins.map((bin) => ({
      bin: bin.name,
      n: bin.n,
      correct: bin.correct,
      rate: ratio(bin.correct, bin.n)
    }))
  };
}

function splitMetrics(questionSet, cases) {
  let abstained = 0;
  let scored = 0;
  let exact = 0;
  let disagreements = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let latencySum = 0;
  let latencyN = 0;
  let callSum = 0;
  const byQuestion = new Map();

  for (const item of cases) {
    const questionId = item.record.question_id;
    if (!byQuestion.has(questionId)) byQuestion.set(questionId, []);
    byQuestion.get(questionId).push(item);
    if (isAbstainedRecord(item.record)) abstained += 1;
    else scored += 1;
    if (item.record.disagreement === true) disagreements += 1;
    if (!isAbstainedRecord(item.record) && item.label?.option != null && item.label.option !== 'abstain' && item.record.selected_option === item.label.option) {
      exact += 1;
    }
    const question = questionSet.questions[questionId];
    const positive = question?.binary_positive;
    if (positive && !isAbstainedRecord(item.record) && item.label?.option != null && item.label.option !== 'abstain') {
      const actualPos = item.label.option === positive;
      const predPos = item.record.selected_option === positive;
      if (!actualPos && predPos) falsePositives += 1;
      if (actualPos && !predPos) falseNegatives += 1;
    }
    if (typeof item.record.measurement?.latency_ms === 'number') {
      latencySum += item.record.measurement.latency_ms;
      latencyN += 1;
    }
    if (typeof item.record.measurement?.call_count === 'number') callSum += item.record.measurement.call_count;
  }

  const questions = {};
  for (const [questionId, question] of Object.entries(questionSet.questions)) {
    if (question.send_to_jev === false) continue;
    questions[questionId] = questionMetrics(question, byQuestion.get(questionId) || []);
  }

  return {
    n: cases.length,
    abstained,
    abstention_rate: ratio(abstained, cases.length),
    scored,
    exact_on_non_abstain: exact,
    disagreements,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
    latency_ms_sum: latencyN ? latencySum : null,
    latency_ms_mean: ratio(latencySum, latencyN),
    call_count_sum: callSum,
    measurement_basis: 'fixture_declared',
    questions
  };
}

export function adversarialFindings(cases) {
  const failures = [];
  for (const item of cases) {
    const json = JSON.stringify(item.record);
    if (item.record.acted !== false) failures.push(`${item.id}: acted`);
    if (item.record.claim_support_applied !== false) failures.push(`${item.id}: claim support applied`);
    if (item.record.role_write_authorized !== false) failures.push(`${item.id}: role write authorized`);
    for (const [key, present] of Object.entries(item.record.prohibited_outputs_present || {})) {
      if (present !== false) failures.push(`${item.id}: prohibited ${key} present`);
    }
    if (/sk-[A-Za-z0-9]{8,}/.test(json) || /Bearer\s+\S+/.test(json)) failures.push(`${item.id}: secret-shaped value`);
    if (item.expect === 'abstain' && item.record.abstained !== true) failures.push(`${item.id}: expected abstain`);
    if (item.forbidden_substrings) {
      for (const snippet of item.forbidden_substrings) {
        if (json.includes(snippet)) failures.push(`${item.id}: stored forbidden snippet`);
      }
    }
  }
  return { n: cases.length, pass: failures.length === 0, failures };
}

export function evaluateLab({ questionSet, cases, historical = null, splitIsolation = null }) {
  const grouped = { calibration: [], holdout: [], adversarial: [] };
  for (const item of cases) {
    if (!grouped[item.split]) continue;
    grouped[item.split].push(item);
  }
  return {
    disclaimer: EVAL_DISCLAIMER,
    thresholds_frozen: true,
    thresholds_fit_on_holdout: false,
    thresholds: {
      ...FROZEN_FUSION_THRESHOLDS,
      shadow_min_margin: SHADOW_MIN_MARGIN
    },
    network_calls: 0,
    cost: { ...COST_UNAVAILABLE },
    split_isolation: splitIsolation,
    calibration: splitMetrics(questionSet, grouped.calibration),
    holdout: splitMetrics(questionSet, grouped.holdout),
    adversarial: adversarialFindings(grouped.adversarial),
    historical: historical
      ? {
          n: historical.n,
          disagreements: historical.disagreements,
          network_calls: 0,
          rows: historical.rows.map((row) => ({
            fixture_id: row.fixture_id,
            span_id: row.span_id,
            disagreement: row.disagreement,
            expected_signal: row.expected.signal,
            expected_strength: row.expected.strength,
            historical_signal: row.historical.signal,
            historical_strength: row.historical.strength
          }))
        }
      : null
  };
}

function fmt(value) {
  if (value == null) return 'n/a';
  return String(value);
}

function matrixMarkdown(block) {
  const labels = block.confusion.labels;
  const header = `| actual \\\\ predicted | ${labels.join(' | ')} |`;
  const rule = `| --- | ${labels.map(() => '---').join(' | ')} |`;
  const lines = [header, rule];
  for (const actual of labels) {
    const cells = labels.map((predicted) => String(block.confusion.matrix[actual]?.[predicted] || 0));
    lines.push(`| ${actual} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function splitMarkdown(split) {
  const lines = [
    `Cases: ${split.n}. Abstained: ${split.abstained}. Abstention rate: ${fmt(split.abstention_rate)}. Scored (not abstained): ${split.scored}. Exact selected-option matches among non-abstentions: ${split.exact_on_non_abstain}. Disagreements with the fixture label: ${split.disagreements}. Binary false positives: ${split.false_positives}. Binary false negatives: ${split.false_negatives}.`,
    '',
    `Fixture-declared latency sum (ms): ${fmt(split.latency_ms_sum)}. Mean: ${fmt(split.latency_ms_mean)}. Fixture-declared call count sum: ${split.call_count_sum}. Basis: \`${split.measurement_basis}\`. These are labels in the fixture file, not measured HTTP.`,
    ''
  ];
  for (const [questionId, block] of Object.entries(split.questions)) {
    if (block.n === 0) continue;
    lines.push(`### ${questionId}`, '');
    lines.push(matrixMarkdown(block), '');
    if (block.binary) {
      lines.push(
        `Binary positive \`${block.binary.positive}\` (abstentions excluded): tp ${block.binary.tp}, fp ${block.binary.fp}, fn ${block.binary.fn}, tn ${block.binary.tn}, precision ${fmt(block.binary.precision)}, recall ${fmt(block.binary.recall)}, f1 ${fmt(block.binary.f1)}.`,
        ''
      );
    }
    lines.push('Calibration bins (non-abstained cases with a class label; rate is exact option match):', '');
    lines.push('| bin | n | correct | rate |', '| --- | --- | --- | --- |');
    for (const bin of block.calibration) {
      lines.push(`| ${bin.bin} | ${bin.n} | ${bin.correct} | ${fmt(bin.rate)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function splitIsolationMarkdown(splitIsolation) {
  if (!splitIsolation) {
    return 'Split isolation was not attached to this evaluation.';
  }
  return `Article and span identity is grouped before split assignment. A shared article id and span id stays in one split. Cross-split collisions reassigned: ${splitIsolation.collisions.length}. Cases moved off their declared split: ${splitIsolation.reassigned_cases}. The span-abstain gate runs only inside an assigned split, so a calibration record cannot change a holdout score. Suppressed sibling questions are abstentions (\`abstained: true\`, \`selected_option: null\`) and are not scored as ordinary decisions.`;
}

export function renderAccuracyReport({ evaluation, questionSet, generatedAt }) {
  const historicalRows = evaluation.historical?.rows || [];
  const historicalMismatches = historicalRows.filter((row) => row.disagreement);
  const historicalLines = historicalMismatches.map(
    (row) =>
      `- \`${row.fixture_id}\` / \`${row.span_id}\`: expected ${row.expected_signal}/${fmt(row.expected_strength)} vs graph ${row.historical_signal}/${fmt(row.historical_strength)}`
  );
  const paywallNote = historicalMismatches.some((row) => row.fixture_id === 'synthetic-05-paywall' && row.span_id === 'span-3')
    ? 'The synthetic-05-paywall span-3 row is the pipeline-versus-answer-file case: the stored graph abstains for insufficient text and paywall, so it has no Jev observation, while the recorded answer file still has vague_authority. The shadow projection of that answer is candidate because no deterministic marker flag is stored. This is not a tuned accuracy result.'
    : '';
  return `# Jev accuracy and abstention report (fixture only)

Generated for review from the Usage Lab replay. Timestamp: ${generatedAt}.

${evaluation.disclaimer}

This report does not cite external accuracy, price, or rate-limit figures. Cost: unavailable (${evaluation.cost.reason}). Network calls performed by this replay: ${evaluation.network_calls}.

Thresholds are frozen from \`media-lens/worker/fusion.js\` plus shadow margin ${evaluation.thresholds.shadow_min_margin}. \`thresholds_fit_on_holdout\` is ${evaluation.thresholds_fit_on_holdout}. Holdout cases were not used to choose thresholds.

${splitIsolationMarkdown(evaluation.split_isolation)}

Question set: \`${questionSet.id}\` version \`${questionSet.version}\`. \`observed_vs_candidate\` is derived in the app and is not a Jev question.

## Calibration split

${splitMarkdown(evaluation.calibration)}

## Untouched holdout

${splitMarkdown(evaluation.holdout)}

The holdout split is scored with the same frozen thresholds. It is not a representative sample of articles, outlets, or people.

## Adversarial and distribution-shift stubs

Cases: ${evaluation.adversarial.n}. Invariants pass: ${evaluation.adversarial.pass}. Failures: ${evaluation.adversarial.failures.length === 0 ? 'none' : evaluation.adversarial.failures.join('; ')}.

These stubs check that unknown options abstain, that smuggled score or rank fields are dropped, and that source independence abstains when fewer than two source ids are present. They are not an adversarial-robustness claim.

## Historical fixture comparison

Production-shaped answers under \`media-lens/fixtures/jev/\` were replayed locally and compared with Jev observations in \`media-lens/fixtures/expected/\`. No span text is stored in the comparison rows.

Rows: ${evaluation.historical?.n ?? 0}. Matches: ${historicalRows.length - historicalMismatches.length}. Disagreements: ${evaluation.historical?.disagreements ?? 0}.

${historicalLines.join('\n') || '- none'}

${paywallNote}

A disagreement here means the shadow projection (frozen probability thresholds, and candidate downgrade when a marker-gated choice has no marker flag) did not match the stored graph observation. It is not an accuracy score.

## What this file is not

It is not evidence that Jev is correct on live articles. It is not permission to enable live mode, change a flag, merge, deploy, or close Issue #118.
`;
}
