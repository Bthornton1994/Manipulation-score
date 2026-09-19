// Selective cascade: direct Jev is primary. classifier.dev smart is an
// evaluation-only escalation, not a second independent model. Agreement
// may be recorded as calibrated only when supported. Disagreement and
// unavailability become explicit review or unavailable. Never a silent
// fallback.

import { JEV_SIGNAL_QUESTION_ID, JEV_QUOTED_QUESTION_ID, JEV_MAX_SPAN_CHARS } from '../adapters/jev.js';
import { THRESHOLDS } from '../fusion.js';
import { CDEV_LABEL_IDS, isAbstentionLabel } from './taxonomy.js';
import { DEFAULT_MIN_CONFIDENCE_FOR_ESCALATION, DEFAULT_TIER, isValidUnitInterval } from './contract.js';
import { canonicalStringify } from '../jev/canonical-json.js';

export const CASCADE_POLICY_VERSION = 'cdev-cascade-1.0.0';
export const CLOSE_PROBABILITY_DELTA = 0.08;
export const CALIBRATION_MIN_CONFIDENCE = 0.5;

const HIGH_IMPACT_JEV = new Set(['scapegoating_dehumanizing', 'fear_threat', 'urgency']);
const ABSOLUTE_QUANTIFIER_PATTERN = /\b(always|never|everyone|no one|guaranteed|undeniably|indisputably)\b/i;

const FAMILY_BY_ID = Object.freeze({
  loaded_moralized: 'loaded',
  emotional_loading: 'loaded',
  loaded_framing: 'loaded_frame',
  fear_threat: 'fear_urgency',
  urgency: 'fear_urgency',
  fear_urgency: 'fear_urgency',
  call_to_action_pressure: 'call_to_action',
  scapegoating_dehumanizing: 'harm_group',
  dehumanization: 'harm_group',
  scapegoating: 'harm_group',
  certainty_beyond_evidence: 'certainty',
  unsupported_certainty: 'certainty',
  selective_context_candidate: 'omission',
  misleading_omission_candidate: 'omission',
  personal_attack: 'personal_attack',
  attribution_quotation_ambiguity: 'attribution',
  none: 'none',
  no_detected_signal: 'none',
  insufficient_evidence: 'abstain',
  human_review_required: 'review'
});

export function familyForLabel(id) {
  if (typeof id !== 'string') return null;
  return FAMILY_BY_ID[id] || null;
}

export function labelsAgree(jevChoice, cdevLabel) {
  const left = familyForLabel(jevChoice);
  const right = familyForLabel(cdevLabel);
  if (!left || !right) return false;
  if (left === 'abstain' || right === 'abstain' || left === 'review' || right === 'review') return false;
  return left === right;
}

export function areCloseProbabilities(probabilities, delta = CLOSE_PROBABILITY_DELTA) {
  if (!probabilities || typeof probabilities !== 'object') return false;
  const values = Object.values(probabilities).filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (values.length < 2) return false;
  const ranked = [...values].sort((a, b) => b - a);
  return ranked[0] - ranked[1] < delta;
}

export function shouldEscalate({
  span,
  jevDisposition,
  jevAnswers,
  injected = false,
  minConfidence = DEFAULT_MIN_CONFIDENCE_FOR_ESCALATION
} = {}) {
  if (!span || typeof span.id !== 'string') {
    return { escalate: false, reason: null };
  }
  if (injected) return { escalate: true, reason: 'deterministic_conflict' };
  const status = jevDisposition?.status;
  if (!status || status === 'unavailable') return { escalate: true, reason: 'invalid' };

  const signal = jevAnswers?.[JEV_SIGNAL_QUESTION_ID];
  const confidence = signal?.confidence;
  if (!signal || typeof signal.choice !== 'string' || !isValidUnitInterval(confidence)) {
    return { escalate: true, reason: 'invalid' };
  }
  if (status === 'review' || confidence < minConfidence) {
    return { escalate: true, reason: 'low_confidence' };
  }
  if (areCloseProbabilities(signal.probabilities)) {
    return { escalate: true, reason: 'close_probabilities' };
  }
  if (HIGH_IMPACT_JEV.has(signal.choice)) {
    return { escalate: true, reason: 'high_impact_review' };
  }
  const noul = jevAnswers?.[JEV_QUOTED_QUESTION_ID]?.noul;
  if (span.role === 'authorial' && typeof noul === 'number' && noul >= THRESHOLDS.quoted_agreement_min) {
    return { escalate: true, reason: 'deterministic_conflict' };
  }
  if (signal.choice === 'certainty_beyond_evidence' && !ABSOLUTE_QUANTIFIER_PATTERN.test(span.text || '')) {
    return { escalate: true, reason: 'deterministic_conflict' };
  }
  return { escalate: false, reason: null };
}

export function minimumSpanText(span, maxChars = JEV_MAX_SPAN_CHARS) {
  const text = typeof span?.text === 'string' ? span.text.trim() : '';
  if (!text) return '';
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function calibrationSupported({ jevChoice, cdevLabel, jevConfidence, cdevConfidence, cdevOk, modelMatch }) {
  if (!cdevOk) return false;
  if (modelMatch === false) return false;
  if (!labelsAgree(jevChoice, cdevLabel)) return false;
  if (isAbstentionLabel(cdevLabel)) return false;
  if (!isValidUnitInterval(jevConfidence) || jevConfidence < CALIBRATION_MIN_CONFIDENCE) return false;
  if (cdevConfidence != null && (!isValidUnitInterval(cdevConfidence) || cdevConfidence < CALIBRATION_MIN_CONFIDENCE)) {
    return false;
  }
  return true;
}

export function decideDisposition({
  jevChoice = null,
  jevConfidence = null,
  cdev = null,
  escalateReason = null
} = {}) {
  if (!cdev || cdev.ok !== true) {
    return { disposition: 'unavailable', calibrated: false, escalateReason };
  }
  if (isAbstentionLabel(cdev.label) || cdev.label == null) {
    return { disposition: 'abstain', calibrated: false, escalateReason };
  }
  if (cdev.reason === 'model_mismatch' || cdev.modelMatch === false) {
    return { disposition: 'disagree_review', calibrated: false, escalateReason: escalateReason || 'model_mismatch' };
  }
  const agree = labelsAgree(jevChoice, cdev.label);
  if (!agree) {
    return { disposition: 'disagree_review', calibrated: false, escalateReason };
  }
  const supported = calibrationSupported({
    jevChoice,
    cdevLabel: cdev.label,
    jevConfidence,
    cdevConfidence: cdev.confidence,
    cdevOk: true,
    modelMatch: cdev.modelMatch
  });
  if (supported) {
    return { disposition: 'agree_calibrated', calibrated: true, escalateReason };
  }
  return { disposition: 'disagree_review', calibrated: false, escalateReason };
}

export function canonicalDecision(decision) {
  return canonicalStringify(decision);
}

function redactedSpanDecision(decision) {
  return {
    span_id: decision.spanId,
    escalate_reason: decision.escalateReason,
    disposition: decision.disposition,
    calibrated: decision.calibrated,
    jev_choice: decision.jevChoice,
    jev_confidence: decision.jevConfidence,
    cdev_label: decision.cdevLabel,
    cdev_confidence: decision.cdevConfidence,
    cdev_model: decision.cdevModel,
    cdev_reason: decision.cdevReason,
    taxonomy_version: decision.taxonomyVersion,
    policy_version: CASCADE_POLICY_VERSION
  };
}

/**
 * Run Jev-primary selective escalation. `adapter.classify` is the only
 * network seam. Empty/disabled adapters yield no calls.
 */
export async function runSelectiveCascade({
  spans,
  jevResult,
  adapter,
  taxonomyVersion,
  minConfidence = DEFAULT_MIN_CONFIDENCE_FOR_ESCALATION,
  injectedSpanIds = new Set(),
  signal,
  tier = DEFAULT_TIER
} = {}) {
  const bySpanId = new Map();
  const audit = [];
  const toSend = [];

  for (const span of spans || []) {
    const answers = jevResult?.answersBySpanId?.get(span.id) || null;
    const disposition = jevResult?.dispositionsBySpanId?.get(span.id) || null;
    const decision = shouldEscalate({
      span,
      jevDisposition: disposition,
      jevAnswers: answers,
      injected: injectedSpanIds.has(span.id),
      minConfidence
    });
    if (!decision.escalate) {
      bySpanId.set(span.id, {
        spanId: span.id,
        escalated: false,
        escalateReason: null,
        disposition: 'jev_primary',
        calibrated: false,
        jevChoice: answers?.[JEV_SIGNAL_QUESTION_ID]?.choice ?? null,
        jevConfidence: answers?.[JEV_SIGNAL_QUESTION_ID]?.confidence ?? null,
        cdevLabel: null,
        cdevConfidence: null,
        cdevModel: null,
        cdevReason: null,
        taxonomyVersion
      });
      continue;
    }
    const text = minimumSpanText(span);
    if (!text) {
      const emptyDecision = {
        spanId: span.id,
        escalated: true,
        escalateReason: decision.reason,
        disposition: 'abstain',
        calibrated: false,
        jevChoice: answers?.[JEV_SIGNAL_QUESTION_ID]?.choice ?? null,
        jevConfidence: answers?.[JEV_SIGNAL_QUESTION_ID]?.confidence ?? null,
        cdevLabel: 'insufficient_evidence',
        cdevConfidence: null,
        cdevModel: null,
        cdevReason: 'empty_span',
        taxonomyVersion
      };
      bySpanId.set(span.id, emptyDecision);
      audit.push(redactedSpanDecision(emptyDecision));
      continue;
    }
    toSend.push({ span, text, answers, escalateReason: decision.reason });
  }

  let classifyResult = {
    ok: true,
    results: [],
    meta: { classifications: 0, status: 'skipped' },
    networkCalls: 0
  };

  if (toSend.length > 0 && adapter && typeof adapter.classify === 'function') {
    classifyResult = await adapter.classify({
      inputs: toSend.map((item) => item.text),
      labels: CDEV_LABEL_IDS,
      tier,
      signal
    });
  } else if (toSend.length > 0) {
    classifyResult = {
      ok: false,
      results: toSend.map((_, index) => ({ ok: false, index, reason: 'disabled', label: null, confidence: null })),
      meta: { classifications: 0, status: 'disabled' },
      networkCalls: 0
    };
  }

  toSend.forEach((item, index) => {
    const cdev = classifyResult.results[index] || { ok: false, reason: 'unavailable' };
    const jevChoice = item.answers?.[JEV_SIGNAL_QUESTION_ID]?.choice ?? null;
    const jevConfidence = item.answers?.[JEV_SIGNAL_QUESTION_ID]?.confidence ?? null;
    const decided = decideDisposition({
      jevChoice,
      jevConfidence,
      cdev,
      escalateReason: item.escalateReason
    });
    const record = {
      spanId: item.span.id,
      escalated: true,
      escalateReason: item.escalateReason,
      disposition: decided.disposition,
      calibrated: decided.calibrated,
      jevChoice,
      jevConfidence,
      cdevLabel: cdev.label ?? null,
      cdevConfidence: cdev.confidence ?? null,
      cdevModel: cdev.model ?? null,
      cdevReason: cdev.reason ?? null,
      taxonomyVersion
    };
    bySpanId.set(item.span.id, record);
    audit.push(redactedSpanDecision(record));
  });

  return {
    policyVersion: CASCADE_POLICY_VERSION,
    taxonomyVersion,
    bySpanId,
    audit,
    meta: classifyResult.meta,
    networkCalls: classifyResult.networkCalls || 0,
    escalatedCount: toSend.length
  };
}

function abstentionMessage(disposition) {
  if (disposition === 'unavailable') {
    return 'An evaluation-only escalation classifier was unavailable, so this section is flagged for review. The primary typed classifier was not replaced.';
  }
  if (disposition === 'abstain') {
    return 'The evaluation-only escalation classifier abstained, so this section is flagged for human review rather than labeled more strongly.';
  }
  return 'The evaluation-only escalation classifier disagreed with the primary typed classifier, so this section is flagged for human review rather than resolved automatically.';
}

export function applyCascadeDispositions(fusionResult, cascadeResult) {
  if (!fusionResult || !cascadeResult) return fusionResult;
  const observations = fusionResult.observations || [];
  const abstentions = fusionResult.abstentions || [];
  const seen = new Set();

  for (const [spanId, decision] of cascadeResult.bySpanId) {
    if (!decision.escalated) continue;
    if (decision.disposition === 'jev_primary') continue;

    for (const obs of observations) {
      if (obs.evidence?.engine !== 'jev') continue;
      if (!Array.isArray(obs.span_ids) || !obs.span_ids.includes(spanId)) continue;
      if (decision.disposition === 'agree_calibrated') {
        obs.evidence = { ...obs.evidence, cascade_agreement: true, cascade_policy: CASCADE_POLICY_VERSION };
      } else {
        obs.review_status = 'needs_review';
      }
    }

    if (decision.disposition === 'agree_calibrated') continue;
    const key = `${spanId}:${decision.disposition}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = decision.disposition === 'unavailable' ? 'engine_unavailable' : 'low_confidence';
    abstentions.push({
      id: `abst-cdev-${decision.disposition}-${spanId}`,
      scope: 'span',
      target: spanId,
      reason,
      message: abstentionMessage(decision.disposition)
    });
  }

  fusionResult.observations = observations;
  fusionResult.abstentions = abstentions;
  return fusionResult;
}

export function cascadeEngineMeta(cascadeResult, { enabled, elapsedMs }) {
  if (!enabled) return null;
  return {
    mode: 'evaluation',
    evaluation_only: true,
    taxonomy_version: cascadeResult?.taxonomyVersion || null,
    policy_version: CASCADE_POLICY_VERSION,
    api_version: cascadeResult?.meta?.api_version || null,
    model_reported: cascadeResult?.meta?.model || null,
    model_match: cascadeResult?.meta?.model == null ? null : cascadeResult.meta.reason !== 'model_mismatch',
    tier_requested: cascadeResult?.meta?.tier || DEFAULT_TIER,
    calls: cascadeResult?.networkCalls || 0,
    classifications: cascadeResult?.meta?.classifications || 0,
    failures: cascadeResult?.audit?.filter((row) => row.disposition === 'unavailable').length || 0,
    escalated_span_count: cascadeResult?.escalatedCount || 0,
    elapsed_ms: elapsedMs,
    circuit_open: Boolean(cascadeResult?.meta?.circuit_open)
  };
}
