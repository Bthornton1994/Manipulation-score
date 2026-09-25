// Jev Decision Contract v1 for Usage Lab shadow records.
//
// A record is a typed recommendation plus the app's mapping. It never
// authorizes a merge, deploy, spend, credential change, or live flag, and
// it never stores article text. Production fusion is not called from here.

import { TAXONOMY_IDS, SELECTIVE_CONTEXT_ONLY_CANDIDATE_ID } from '../../schema/taxonomy.js';

export const CONTRACT_VERSION = '1.0.0';
export const PROBABILITY_SUM_EPSILON = 1e-6;

/** Frozen from worker/fusion.js. The lab does not refit these on holdout. */
export const FROZEN_FUSION_THRESHOLDS = Object.freeze({
  observed_min_probability: 0.6,
  candidate_min_probability: 0.45,
  quoted_agreement_min: 0.7,
  failure_rate_abstain: 0.2
});

/**
 * Shadow-only margin. Not a production fusion threshold and not fit on
 * the untouched holdout. Below this, the lab abstains instead of emitting
 * a class.
 */
export const SHADOW_MIN_MARGIN = 0.15;
export const SHADOW_REVIEW_MIN_CONFIDENCE = 0.5;

export const COST_UNAVAILABLE = Object.freeze({
  available: false,
  reason: 'Provider cost is not recorded. External pricing and rate limits are unverified and are not hardcoded.'
});

export const CURRENT_SIGNAL_OPTIONS = Object.freeze([
  ...TAXONOMY_IDS.filter((id) => id !== SELECTIVE_CONTEXT_ONLY_CANDIDATE_ID),
  'none'
]);

const MARKER_GATED_CHOICES = new Set(['certainty_beyond_evidence', 'vague_authority']);
const CLAIM_HOLD_OPTIONS = new Set(['supported', 'contradicted', 'mixed']);
const ANSWER_KEYS = new Set(['type', 'choice', 'probabilities', 'confidence', 'noul']);
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
export const SPAN_ROLES = new Set([
  'headline',
  'subhead',
  'authorial',
  'quoted',
  'attributed_paraphrase',
  'caption',
  'byline_meta',
  'boilerplate',
  'uncertain'
]);

const PROHIBITED_PRESENT = Object.freeze({
  final_prose: false,
  overall_manipulation_score: false,
  outlet_rank: false,
  person_rank: false,
  unsupported_claim_applied: false,
  merge_authorization: false,
  deploy_authorization: false,
  spend_authorization: false,
  credential_authorization: false,
  live_flag_authorization: false
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidUnitInterval(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isSafeId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

export function deriveEvidenceStrength(topProbability, thresholds = FROZEN_FUSION_THRESHOLDS) {
  if (!isValidUnitInterval(topProbability)) return null;
  if (topProbability >= thresholds.observed_min_probability) return 'observed';
  if (topProbability >= thresholds.candidate_min_probability) return 'candidate';
  return 'below_threshold';
}

export function applyObservedSafety({ choice, strength, deterministicMarker }) {
  if (strength !== 'observed') return strength;
  if (MARKER_GATED_CHOICES.has(choice) && deterministicMarker !== true) return 'candidate';
  return strength;
}

function probabilityMargin(probabilities, topId) {
  const values = Object.values(probabilities);
  if (values.length < 2) return null;
  const top = probabilities[topId];
  let second = -Infinity;
  for (const [id, value] of Object.entries(probabilities)) {
    if (id === topId) continue;
    if (value > second) second = value;
  }
  if (!Number.isFinite(second)) return null;
  return top - second;
}

function argmaxIds(probabilities) {
  let best = -Infinity;
  const winners = [];
  for (const [id, value] of Object.entries(probabilities)) {
    if (value > best) {
      best = value;
      winners.length = 0;
      winners.push(id);
    } else if (value === best) {
      winners.push(id);
    }
  }
  return winners;
}

export function cleanProvenance(input) {
  const source = isPlainObject(input) ? input : {};
  const sourceIds = [];
  if (Array.isArray(source.source_ids)) {
    for (const id of source.source_ids) {
      if (isSafeId(id) && !sourceIds.includes(id)) sourceIds.push(id);
    }
  }
  const sourceId = isSafeId(source.source_id) ? source.source_id : sourceIds[0] || null;
  if (sourceId && !sourceIds.includes(sourceId)) sourceIds.unshift(sourceId);
  return {
    article_id: isSafeId(source.article_id) ? source.article_id : null,
    source_id: sourceId,
    span_id: isSafeId(source.span_id) ? source.span_id : null,
    source_ids: sourceIds,
    span_role: SPAN_ROLES.has(source.span_role) ? source.span_role : null
  };
}

function droppedFieldNames(answer) {
  if (!isPlainObject(answer)) return [];
  return Object.keys(answer)
    .filter((key) => !ANSWER_KEYS.has(key))
    .sort();
}

function blankMeasurement(measurement) {
  const latency = measurement?.latency_ms;
  const calls = measurement?.call_count;
  const latencyOk = typeof latency === 'number' && Number.isFinite(latency) && latency >= 0;
  const callsOk = Number.isInteger(calls) && calls >= 0;
  // Fixture replay omits basis and keeps the historical label. The /analyze
  // shadow schedule passes basis "in_process" for a local timer. That timer
  // is not an HTTP measurement and not a fixture declaration.
  if (measurement?.basis === 'not_measured') {
    return { latency_ms: null, call_count: null, basis: 'not_measured' };
  }
  if (measurement?.basis === 'in_process' || measurement?.basis === 'fixture_declared') {
    return {
      latency_ms: latencyOk ? latency : null,
      call_count: callsOk ? calls : null,
      basis: measurement.basis
    };
  }
  return {
    latency_ms: latencyOk ? latency : null,
    call_count: callsOk ? calls : null,
    basis: latencyOk || callsOk ? 'fixture_declared' : 'not_measured'
  };
}

function shellRecord({ questionSet, questionId, provenance, audit, measurement, outcome, historicalAction }) {
  return {
    contract_version: CONTRACT_VERSION,
    question_set_id: questionSet.id,
    question_set_version: String(questionSet.version),
    question_id: questionId,
    acted: false,
    shadow_mode: true,
    model_option: null,
    selected_option: null,
    probabilities: null,
    confidence: null,
    noul: null,
    margin: null,
    evidence_strength: null,
    review: false,
    abstained: true,
    abstention_reason: null,
    escalation: 'none',
    final_action: 'shadow_abstain',
    mapped_ui_state: 'abstain',
    blocks_downstream_observation: true,
    policy_override: null,
    role_effect: null,
    role_write_authorized: false,
    claim_support_applied: false,
    suppressed_by_span_abstain: false,
    dropped_fields: [],
    provenance,
    disagreement: null,
    model_disagreement: null,
    outcome: outcome || null,
    historical_action: historicalAction || null,
    measurement: blankMeasurement(measurement),
    cost: { ...COST_UNAVAILABLE },
    audit: {
      model_requested: questionSet.model_requested || 'jev-1.13.0',
      model_reported: audit?.model_reported || null,
      deployment_sha: audit?.deployment_sha || null,
      question_set_sha256: audit?.question_set_sha256 || null,
      recorded_at: audit?.recorded_at || null,
      contract_version: CONTRACT_VERSION
    },
    prohibited_outputs_present: { ...PROHIBITED_PRESENT }
  };
}

function attachComparison(record, label) {
  const labelOption = label && Object.prototype.hasOwnProperty.call(label, 'option') ? label.option : undefined;
  if (!label) {
    record.disagreement = null;
    record.model_disagreement = null;
    record.outcome = record.outcome || null;
    return record;
  }
  record.outcome = label.outcome_class || null;
  record.historical_action = label.historical_action || null;
  if (labelOption === undefined) {
    record.disagreement = null;
    record.model_disagreement = null;
    return record;
  }
  if (labelOption == null) {
    record.disagreement = !record.abstained;
    record.model_disagreement = record.model_option != null;
  } else if (labelOption === 'abstain') {
    record.disagreement = !record.abstained;
    record.model_disagreement = record.model_option !== 'abstain';
  } else {
    record.disagreement = record.abstained || record.selected_option !== labelOption;
    record.model_disagreement = record.model_option !== labelOption;
  }
  return record;
}

function fail(record, reason, { escalation = 'human_review', dropped = [] } = {}) {
  record.abstained = true;
  record.abstention_reason = reason;
  record.selected_option = null;
  record.final_action = 'shadow_abstain';
  record.mapped_ui_state = 'abstain';
  record.blocks_downstream_observation = true;
  record.escalation = escalation;
  record.dropped_fields = dropped;
  record.probabilities = null;
  return record;
}

/**
 * Parse a Choice answer. `requireCompleteDistribution` matches the live
 * adapter rule. Fixture replay of the current question set passes false.
 */
export function parseChoiceAnswer(answer, optionIds, { requireCompleteDistribution }) {
  const dropped = droppedFieldNames(answer);
  if (!isPlainObject(answer)) return { ok: false, reason: 'malformed', dropped };
  if (answer.type !== 'choice') return { ok: false, reason: 'wrong_type', dropped };
  if (typeof answer.choice !== 'string' || !optionIds.includes(answer.choice)) {
    return { ok: false, reason: 'unknown_option', dropped };
  }
  if (!isPlainObject(answer.probabilities)) return { ok: false, reason: 'invalid_probabilities', dropped };
  const optionSet = new Set(optionIds);
  const keys = Object.keys(answer.probabilities);
  if (keys.length === 0) return { ok: false, reason: 'invalid_probabilities', dropped };
  const probabilities = {};
  for (const key of keys) {
    if (!optionSet.has(key)) return { ok: false, reason: 'unknown_option', dropped };
    if (!isValidUnitInterval(answer.probabilities[key])) return { ok: false, reason: 'invalid_probabilities', dropped };
    probabilities[key] = answer.probabilities[key];
  }
  if (!(answer.choice in probabilities)) return { ok: false, reason: 'invalid_probabilities', dropped };
  const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
  if (sum <= 0 || sum > 1 + PROBABILITY_SUM_EPSILON) return { ok: false, reason: 'invalid_probabilities', dropped };
  if (requireCompleteDistribution) {
    if (keys.length !== optionIds.length || Math.abs(sum - 1) > PROBABILITY_SUM_EPSILON) {
      return { ok: false, reason: 'incomplete_distribution', dropped };
    }
    for (const id of optionIds) {
      if (!(id in probabilities)) return { ok: false, reason: 'incomplete_distribution', dropped };
    }
  }
  const winners = argmaxIds(probabilities);
  if (winners.length !== 1) return { ok: false, reason: 'ambiguous_tie', dropped };
  if (winners[0] !== answer.choice) return { ok: false, reason: 'choice_not_argmax', dropped };
  if (!isValidUnitInterval(answer.confidence)) return { ok: false, reason: 'invalid_probabilities', dropped };
  return {
    ok: true,
    choice: answer.choice,
    probabilities,
    confidence: answer.confidence,
    margin: probabilityMargin(probabilities, answer.choice),
    dropped
  };
}

function mappedState(question, optionId) {
  const mapped = question.app_mapping?.[optionId];
  return typeof mapped === 'string' && mapped.length > 0 ? mapped : 'unmapped';
}

function influenceBlocks(question, selected, strength) {
  if (question.policy === 'blocks_influence_when_missing') {
    return selected === 'missing' || selected === 'insufficient_context' || selected === 'abstain';
  }
  if (selected === 'abstain' || strength === 'below_threshold') return true;
  return false;
}

/**
 * Build one shadow decision from a replayed answer. Does not call Jev.
 */
export function buildDecisionRecord({
  questionSet,
  questionId,
  answer,
  provenance,
  audit,
  measurement,
  label = null,
  requireCompleteDistribution = true,
  deterministicMarker = null,
  minMargin = SHADOW_MIN_MARGIN
}) {
  const question = questionSet?.questions?.[questionId];
  const clean = cleanProvenance(provenance);
  const record = shellRecord({
    questionSet,
    question,
    questionId,
    provenance: clean,
    audit,
    measurement,
    outcome: label?.outcome_class || null,
    historicalAction: label?.historical_action || null
  });
  if (!clean.article_id || !clean.span_id) {
    return attachComparison(fail(record, 'malformed', { dropped: droppedFieldNames(answer) }), label);
  }
  if (!question) return attachComparison(fail(record, 'unknown_question'), label);
  if (question.send_to_jev === false || question.policy === 'derived') {
    return attachComparison(fail(record, 'derived_in_app', { escalation: 'none' }), label);
  }
  const optionIds = Object.keys(question.criteria || {});
  const parsed = parseChoiceAnswer(answer, optionIds, { requireCompleteDistribution });
  record.dropped_fields = parsed.dropped;
  if (!parsed.ok) return attachComparison(fail(record, parsed.reason, { dropped: parsed.dropped }), label);

  record.model_option = parsed.choice;
  record.probabilities = parsed.probabilities;
  record.confidence = parsed.confidence;
  record.margin = parsed.margin;
  record.review = parsed.confidence < SHADOW_REVIEW_MIN_CONFIDENCE;

  if (question.policy === 'source_minimum_two' && clean.source_ids.length < 2) {
    record.policy_override = 'insufficient_source_context';
    record.abstention_reason = 'insufficient_source_context';
    record.abstained = true;
    record.selected_option = null;
    record.evidence_strength = null;
    record.final_action = 'shadow_abstain';
    record.mapped_ui_state = 'insufficient_context';
    record.blocks_downstream_observation = true;
    record.escalation = 'human_review';
    return attachComparison(record, label);
  }

  if (parsed.margin != null && parsed.margin < minMargin) {
    record.abstention_reason = 'low_margin';
    record.abstained = true;
    record.selected_option = null;
    record.evidence_strength = null;
    record.final_action = 'shadow_abstain';
    record.mapped_ui_state = 'abstain';
    record.blocks_downstream_observation = true;
    record.escalation = 'human_review';
    return attachComparison(record, label);
  }

  if (parsed.choice === 'abstain') {
    record.abstention_reason = 'explicit_abstain';
    record.abstained = true;
    record.selected_option = null;
    record.final_action = 'shadow_abstain';
    record.mapped_ui_state = 'abstain';
    record.blocks_downstream_observation = true;
    record.escalation = record.review ? 'human_review' : 'none';
    return attachComparison(record, label);
  }

  let strength = deriveEvidenceStrength(parsed.probabilities[parsed.choice]);
  strength = applyObservedSafety({ choice: parsed.choice, strength, deterministicMarker });
  if (question.policy === 'source_minimum_two' && strength === 'observed') strength = 'candidate';
  record.evidence_strength = strength;
  record.selected_option = parsed.choice;
  record.abstained = false;
  record.abstention_reason = null;
  record.mapped_ui_state = mappedState(question, parsed.choice);
  record.blocks_downstream_observation = influenceBlocks(question, parsed.choice, strength);

  if (question.policy === 'claim_support' && CLAIM_HOLD_OPTIONS.has(parsed.choice)) {
    record.policy_override = 'claim_support_not_authorized';
    record.final_action = 'hold_for_human';
    record.escalation = 'hold';
    record.mapped_ui_state = 'hold_unsupported_claim';
    record.blocks_downstream_observation = true;
    record.claim_support_applied = false;
    return attachComparison(record, label);
  }

  if (record.review) record.escalation = 'human_review';
  if (record.mapped_ui_state === 'no_signal' || strength === 'below_threshold') {
    record.final_action = 'no_ui_change';
    record.blocks_downstream_observation = true;
  } else {
    record.final_action = 'shadow_record';
  }
  return attachComparison(record, label);
}

/**
 * Shadow record for the current production noul question. Does not change
 * span role. A high noul on an authorial span is only a recommendation to
 * move that span to uncertain, matching fusion.js.
 */
export function buildQuotedNoulRecord({
  questionSet,
  answer,
  provenance,
  audit,
  measurement,
  quotedAgreementMin = FROZEN_FUSION_THRESHOLDS.quoted_agreement_min,
  label = null
}) {
  const clean = cleanProvenance(provenance);
  const record = shellRecord({
    questionSet: questionSet || {
      id: 'influence-questions.v1',
      version: '1',
      model_requested: 'jev-1.13.0'
    },
    questionId: 'is_quoted_or_attributed',
    provenance: clean,
    audit,
    measurement,
    outcome: label?.outcome_class || null,
    historicalAction: label?.historical_action || null
  });
  record.dropped_fields = droppedFieldNames(answer);
  if (!clean.article_id || !clean.span_id) return attachComparison(fail(record, 'malformed'), label);
  if (!isPlainObject(answer) || answer.type !== 'noul' || !isValidUnitInterval(answer.noul)) {
    return attachComparison(fail(record, 'wrong_type', { dropped: record.dropped_fields }), label);
  }
  record.noul = answer.noul;
  record.abstained = false;
  record.abstention_reason = null;
  record.model_option = null;
  record.selected_option = null;
  const authorial = clean.span_role === 'authorial';
  if (authorial && answer.noul >= quotedAgreementMin) {
    record.role_effect = 'authorial_to_uncertain';
    record.mapped_ui_state = 'authorial_role_uncertain';
    record.final_action = 'shadow_record';
    record.escalation = 'human_review';
    record.blocks_downstream_observation = false;
  } else {
    record.role_effect = 'none';
    record.mapped_ui_state = 'no_signal';
    record.final_action = 'no_ui_change';
    record.blocks_downstream_observation = true;
    if (answer.noul >= quotedAgreementMin && clean.span_role == null) {
      record.policy_override = 'span_role_unknown';
    }
  }
  record.role_write_authorized = false;
  return attachComparison(record, label);
}

function spanAbstainKey(record) {
  const articleId = record?.provenance?.article_id ?? '';
  const spanId = record?.provenance?.span_id ?? '';
  return `${articleId}\u0000${spanId}`;
}

/**
 * Turn a sibling decision into an abstention. `model_option` stays so the
 * log still shows what the model selected. Scoring uses `abstained` and
 * `selected_option`, so both have to move with the gate.
 */
function suppressForSpanAbstain(record, label) {
  const suppressed = {
    ...record,
    suppressed_by_span_abstain: true,
    abstained: true,
    abstention_reason: 'span_abstain',
    selected_option: null,
    evidence_strength: null,
    final_action: 'shadow_abstain',
    mapped_ui_state: 'abstain',
    blocks_downstream_observation: true,
    escalation: 'human_review',
    policy_override: 'span_abstain',
    role_effect: null,
    acted: false,
    claim_support_applied: false,
    role_write_authorized: false
  };
  if (label) return attachComparison(suppressed, label);
  return suppressed;
}

/**
 * If should_abstain withholds a span, other questions on that span stay
 * logged but are abstentions: `abstained` is true, `selected_option` is
 * null, and derived strength / UI / action are cleared. Does not call Jev.
 *
 * Pass labels aligned with `records` so disagreement is recomputed. The
 * gate only sees records in this list, so callers must not mix splits.
 */
export function applySpanAbstainGate(records, labels = undefined) {
  const withheld = new Set();
  for (const record of records) {
    if (record.question_id !== 'should_abstain') continue;
    if (record.abstained || record.model_option === 'abstain') {
      withheld.add(spanAbstainKey(record));
    }
  }
  return records.map((record, index) => {
    if (record.question_id === 'should_abstain') return record;
    if (!withheld.has(spanAbstainKey(record))) return record;
    const label = Array.isArray(labels) ? labels[index] : undefined;
    return suppressForSpanAbstain(record, label);
  });
}
