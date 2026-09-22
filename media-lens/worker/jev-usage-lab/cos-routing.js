// Chief-of-staff routing stub. Docs plus a pure function. It does not call
// Jev, does not write to another repo, and cannot authorize an action.

import { buildDecisionRecord } from './decision.js';

const AUTHORIZATIONS = Object.freeze({
  merge: false,
  deploy: false,
  spend: false,
  credentials: false,
  live_flags: false
});

function optionOf(records, questionId) {
  return records.find((record) => record.question_id === questionId) || null;
}

/**
 * Turn per-question shadow records into one route recommendation.
 * Human gates overwrite a model "route". executed is always false.
 */
export function decideCosRoute(records, { provenance, audit } = {}) {
  const routeRecord = optionOf(records, 'route_decision');
  const external = optionOf(records, 'external_write_required');
  const reversible = optionOf(records, 'reversible');
  const approval = optionOf(records, 'bryant_approval_required');
  const context = optionOf(records, 'enough_context');

  const modelRoute = routeRecord?.selected_option || routeRecord?.model_option || null;
  let recommendation = modelRoute;
  let policyOverride = null;
  const reasons = [];

  if (!routeRecord || routeRecord.abstained || recommendation == null) {
    recommendation = 'hold';
    policyOverride = 'route_unanswered';
    reasons.push('route_unanswered');
  }

  const contextOption = context?.selected_option || context?.model_option || null;
  if (!context || context.abstained || contextOption !== 'enough') {
    recommendation = contextOption === 'missing' ? 'clarify' : 'hold';
    policyOverride = 'context_gate';
    reasons.push('context_gate');
  }

  const externalOption = external?.selected_option || external?.model_option || null;
  const reversibleOption = reversible?.selected_option || reversible?.model_option || null;
  const approvalOption = approval?.selected_option || approval?.model_option || null;
  const humanGate =
    !external ||
    external.abstained ||
    externalOption !== 'no' ||
    !reversible ||
    reversible.abstained ||
    reversibleOption !== 'reversible' ||
    !approval ||
    approval.abstained ||
    approvalOption !== 'not_required';
  if (humanGate) {
    recommendation = 'escalate';
    policyOverride = 'human_gate';
    reasons.push('human_gate');
  }

  if (recommendation === 'route') reasons.push('recommendation_only_not_authorization');

  return {
    contract_version: '1.0.0',
    question_set_id: 'cos-routing.v1',
    question_set_version: '1',
    acted: false,
    executed: false,
    shadow_mode: true,
    recommendation,
    model_route: modelRoute,
    policy_override: policyOverride,
    reasons,
    authorizations: { ...AUTHORIZATIONS },
    provenance: provenance || routeRecord?.provenance || null,
    audit: audit || routeRecord?.audit || null
  };
}

export function buildCosRecords({ questionSet, answersByQuestion, provenance, audit, measurement }) {
  return Object.keys(questionSet.questions)
    .filter((questionId) => questionSet.questions[questionId].send_to_jev !== false)
    .map((questionId) =>
      buildDecisionRecord({
        questionSet,
        questionId,
        answer: answersByQuestion?.[questionId],
        provenance,
        audit,
        measurement
      })
    );
}

export function routeFromAnswers({ questionSet, answersByQuestion, provenance, audit, measurement }) {
  const records = buildCosRecords({ questionSet, answersByQuestion, provenance, audit, measurement });
  return { records, decision: decideCosRoute(records, { provenance, audit }) };
}
