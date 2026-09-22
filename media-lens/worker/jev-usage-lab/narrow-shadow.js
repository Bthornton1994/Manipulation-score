// Optional narrow-question shadow execution for POST /analyze.
//
// MEDIA_LENS_JEV_SHADOW remains the capture/projection flag in
// analyze-shadow.js. This module is the separate path that can ask
// media-lens-narrow.v1. It does not read process.env. It does not import
// analyze(), fusion, or the production Jev adapter. It does not write the
// graph, the production budget, live flags, or credentials.
//
// Live TypeSafe calls stay off unless worker/config.js has the exact flag
// and every numeric limit, including a positive per-call estimate, and the
// server finds live mode, no CI block, no kill switch, and an API key.
// The 2026-09-22 PT operating points are named in worker/config.js and are
// not applied here. An unset estimate keeps this path at zero calls.
// Fixture mode never takes the live path. Tests inject a mock provider.
// This file's live client only runs when a caller passes fetchImpl.

import { articleIdFromAnalyze, projectGraphForShadow, redactShadowReport, SHADOW_RETENTION } from './analyze-shadow.js';
import { planQuestionBatch } from './batch-plan.js';
import { COST_UNAVAILABLE, buildDecisionRecord } from './decision.js';
import { preJevRoleBySpan } from './historical.js';
import { NARROW_QUESTION_SET_PATH, loadQuestionSetFile } from './run.js';
import { prepareLabCases } from './split-isolation.js';

export const NARROW_SHADOW_ENV = 'MEDIA_LENS_JEV_SHADOW_NARROW';

export const NARROW_SHADOW_LIMIT_ENV = Object.freeze({
  maxCallsPerAnalysis: 'MEDIA_LENS_JEV_SHADOW_NARROW_MAX_CALLS_PER_ANALYSIS',
  timeoutMs: 'MEDIA_LENS_JEV_SHADOW_NARROW_TIMEOUT_MS',
  rateLimitPerMinute: 'MEDIA_LENS_JEV_SHADOW_NARROW_RATE_LIMIT_PER_MINUTE',
  monthlyCostCeilingUsd: 'MEDIA_LENS_JEV_SHADOW_NARROW_MONTHLY_COST_CEILING_USD',
  estimatedUsdPerCall: 'MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL'
});

export const NARROW_SHADOW_LABELS = Object.freeze({
  shadow_only: true,
  not_model_accuracy: true,
  not_production_ready: true,
  label: 'narrow_shadow_only'
});

export const NARROW_AUTHORIZATION = Object.freeze({
  http_response: false,
  observations: false,
  observed_thresholds: false,
  candidate_thresholds: false,
  abstentions: false,
  claim_support: false,
  role_writes: false,
  live_flags: false,
  credentials: false,
  deployments: false,
  spending: false,
  merge: false
});

const NARROW_QUESTION_SET_ID = 'media-lens-narrow.v1';
const PRODUCTION_QUESTION_SET_ID = 'influence-questions.v1';
const RUNTIME_SPLIT = 'runtime_shadow';
export const NARROW_SHADOW_MAX_SPAN_CHARS = 1200;
export const NARROW_SHADOW_MAX_CONTEXT_CHARS = 400;
export const NARROW_SHADOW_MAX_TITLE_CHARS = 2000;
const EXCLUDED_ROLES = new Set(['boilerplate', 'byline_meta']);
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SAFE_NAME_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const DISAGREEMENT_CLASSES = new Set([
  'differ',
  'strength',
  'shadow_abstain',
  'production_withheld',
  'role_recommendation_withheld',
  'held_not_applied'
]);
const POSITIVE_SIGNAL = Object.freeze({
  emotionally_loaded_language: { option: 'loaded_moralized', signal: 'loaded_moralized' },
  false_dilemma: { option: 'present', signal: 'false_dilemma' }
});
const ROLE_BY_OPTION = Object.freeze({
  authorial: 'authorial',
  quotation: 'quoted',
  attributed_paraphrase: 'attributed_paraphrase',
  uncertain: 'uncertain'
});
const CLAIM_HELD = new Set(['supported', 'contradicted', 'mixed']);
const PROVIDER_ERRORS = new Set([
  'timeout',
  'provider_failed',
  'redirect_rejected',
  'malformed_json',
  'malformed_body',
  'missing_answers',
  'live_fetch_unavailable',
  'PIN_MISMATCH',
  'BLOCKED_HOST',
  'BAD_SCHEME',
  'BAD_URL',
  'DNS_ERROR',
  'TLS_ERROR',
  'aborted'
]);

let questionSetPromise = null;

function isSafeId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

function truncate(text, max) {
  if (typeof text !== 'string') return null;
  return text.length > max ? text.slice(0, max) : text;
}

function monthKey(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function cleanDeploymentSha(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(text) || /^[a-f0-9]{64}$/.test(text)) return text;
  return null;
}

function cleanTimestamp(value) {
  return typeof value === 'string' && TIMESTAMP_RE.test(value) ? value : null;
}

function safeDropped(names) {
  if (!Array.isArray(names)) return [];
  return names.filter((name) => typeof name === 'string' && SAFE_NAME_RE.test(name));
}

function safeProviderError(value) {
  if (typeof value === 'string' && PROVIDER_ERRORS.has(value)) return value;
  if (typeof value === 'string' && /^http_[1-5]\d\d$/.test(value)) return value;
  return 'provider_failed';
}

function isProvider(value) {
  return Boolean(value) && typeof value.ask === 'function';
}

export function narrowLimitsPresent(limits) {
  if (!limits || typeof limits !== 'object') return false;
  const calls = limits.maxCallsPerAnalysis;
  const timeout = limits.timeoutMs;
  const rate = limits.rateLimitPerMinute;
  const ceiling = limits.monthlyCostCeilingUsd;
  const estimate = limits.estimatedUsdPerCall;
  return (
    Number.isInteger(calls) &&
    calls >= 1 &&
    Number.isInteger(timeout) &&
    timeout >= 1 &&
    Number.isInteger(rate) &&
    rate >= 1 &&
    typeof ceiling === 'number' &&
    Number.isFinite(ceiling) &&
    ceiling > 0 &&
    typeof estimate === 'number' &&
    Number.isFinite(estimate) &&
    estimate > 0
  );
}

export function narrowNetworkBlockReason(config, { killSwitchAsserted = false } = {}) {
  const narrow = config?.jevShadowNarrow;
  if (!narrow || narrow.enabled !== true) return 'flag_off';
  if (!narrowLimitsPresent(narrow)) return 'owner_limits_unset';
  if (!(narrow.estimatedUsdPerCall <= narrow.monthlyCostCeilingUsd + 1e-9)) return 'monthly_cost_ceiling';
  if (config.mode !== 'live') return 'fixture_mode';
  if (narrow.ciDisablesNetwork === true) return 'ci';
  if (killSwitchAsserted || config.killSwitch === true) return 'kill_switch';
  if (!config.secrets?.typesafeApiKey) return 'missing_api_key';
  if (typeof config.jev?.baseUrl !== 'string' || config.jev.baseUrl.length === 0) return 'missing_base_url';
  return null;
}

export function narrowShadowLiveNetworkPermitted(config, options) {
  return narrowNetworkBlockReason(config, options) == null;
}

export function selectNarrowProvider({ injected = null, livePermitted = false, createLive = null } = {}) {
  if (isProvider(injected)) return { provider: injected, kind: 'injected_mock' };
  if (livePermitted === true && typeof createLive === 'function') {
    let provider = null;
    try {
      provider = createLive();
    } catch {
      provider = null;
    }
    if (isProvider(provider)) return { provider, kind: 'live_provider' };
  }
  return { provider: null, kind: 'network_disabled' };
}

export function createNarrowRateLimiter({ perMinute = null, now = () => Date.now(), windowMs = 60000 } = {}) {
  let windowStart = now();
  let count = 0;
  const limit = Number.isInteger(perMinute) && perMinute > 0 ? perMinute : null;
  return {
    perMinute: limit,
    tryAcquire() {
      if (limit == null) return { ok: false, reason: 'rate_limit_unset' };
      const current = now();
      if (current - windowStart >= windowMs) {
        windowStart = current;
        count = 0;
      }
      if (count >= limit) return { ok: false, reason: 'rate_limited' };
      count += 1;
      return { ok: true, remaining: limit - count };
    }
  };
}

export function createNarrowCostLedger({
  ceilingUsd = null,
  estimatedUsdPerCall = null,
  now = () => new Date()
} = {}) {
  const ceiling = typeof ceilingUsd === 'number' && Number.isFinite(ceilingUsd) ? ceilingUsd : null;
  const estimate = typeof estimatedUsdPerCall === 'number' && Number.isFinite(estimatedUsdPerCall) ? estimatedUsdPerCall : null;
  let key = monthKey(now()) || 'unknown';
  let spent = 0;
  function sync() {
    const next = monthKey(now()) || 'unknown';
    if (next !== key) {
      key = next;
      spent = 0;
    }
  }
  return {
    ceilingUsd: ceiling,
    estimatedUsdPerCall: estimate,
    tryReserve() {
      sync();
      if (ceiling == null || estimate == null || estimate <= 0 || ceiling <= 0) {
        return { ok: false, reason: 'cost_ceiling_unset', estimated_usd: spent, month_key: key };
      }
      const next = spent + estimate;
      if (next > ceiling + 1e-9) {
        return { ok: false, reason: 'monthly_cost_ceiling', estimated_usd: spent, month_key: key };
      }
      spent = next;
      return { ok: true, estimated_usd: spent, month_key: key };
    },
    unreserve() {
      sync();
      if (estimate == null || estimate <= 0 || spent < estimate) return;
      spent -= estimate;
    },
    snapshot() {
      sync();
      return {
        estimated_usd: spent,
        month_key: key,
        ceiling_usd: ceiling,
        estimated_usd_per_call: estimate
      };
    }
  };
}

function loadNarrowQuestionSet() {
  if (!questionSetPromise) {
    questionSetPromise = loadQuestionSetFile(NARROW_QUESTION_SET_PATH).catch((err) => {
      questionSetPromise = null;
      throw err;
    });
  }
  return questionSetPromise;
}

function jevQuestionPayload(question) {
  return {
    type: question.type,
    instructions: question.instructions,
    criteria: question.criteria
  };
}

function sendableQuestionIds(questionSet) {
  const ids = [];
  for (const [questionId, question] of Object.entries(questionSet.questions || {})) {
    if (!question || question.send_to_jev === false || question.policy === 'derived') continue;
    ids.push(questionId);
  }
  return ids;
}

function authorizationCopy() {
  return { ...NARROW_AUTHORIZATION };
}

function costEnvelope({ estimate, thisAnalysis, ledger, scope }) {
  const snap = typeof ledger?.snapshot === 'function' ? ledger.snapshot() : null;
  return {
    available: false,
    reason: 'Process-memory placeholder. Not verified billing. Does not write the production TypeSafe budget.',
    placeholder: true,
    not_a_production_budget: true,
    estimated_usd_per_call: typeof estimate === 'number' ? estimate : null,
    estimated_usd_this_analysis: thisAnalysis,
    monthly_ceiling_usd: snap ? snap.ceiling_usd : null,
    month_key: snap ? snap.month_key : null,
    estimated_usd_reserved_in_ledger: snap ? snap.estimated_usd : null,
    ledger_scope: scope,
    production_budget_written: false
  };
}

function baseReport(extra) {
  return {
    ...NARROW_SHADOW_LABELS,
    shadow_enabled: true,
    narrow_shadow_enabled: true,
    acted: false,
    claim_support_applied: false,
    role_write_authorized: false,
    holdout_scored: false,
    splits_scored: false,
    authorizes: authorizationCopy(),
    production_question_set: { id: PRODUCTION_QUESTION_SET_ID, authoritative: true },
    retention: SHADOW_RETENTION,
    ...extra
  };
}

function disabledReport() {
  return baseReport({
    shadow_enabled: false,
    narrow_shadow_enabled: false,
    shadow_failed: false,
    network_calls: 0,
    provider_kind: 'network_disabled',
    live_network_permitted: false,
    live_network_block_reason: 'flag_off',
    refused: 'flag_off',
    records: [],
    span_results: [],
    production_disagreements: [],
    disagreement_count: 0,
    provider_failure_count: 0,
    narrow_question_set: { id: NARROW_QUESTION_SET_ID, version: '1', asked: false, reason: 'flag_off' },
    cost: { ...COST_UNAVAILABLE, placeholder: true, not_a_production_budget: true, production_budget_written: false }
  });
}

function failureReport(providerCalls) {
  return baseReport({
    shadow_failed: true,
    network_calls: providerCalls,
    provider_kind: 'network_disabled',
    live_network_permitted: false,
    refused: 'shadow_failed',
    records: [],
    span_results: [],
    production_disagreements: [],
    disagreement_count: 0,
    provider_failure_count: 0,
    narrow_question_set: { id: NARROW_QUESTION_SET_ID, version: '1', asked: false, reason: 'shadow_failed' },
    cost: { ...COST_UNAVAILABLE, placeholder: true, not_a_production_budget: true, production_budget_written: false }
  });
}

export function compareNarrowDecisionToProduction(record, production) {
  const observations = Array.isArray(production?.observations) ? production.observations : [];
  const claimSupports = Array.isArray(production?.claim_supports) ? production.claim_supports : [];
  const base = {
    question_id: record?.question_id || null,
    span_id: record?.provenance?.span_id || null,
    applied_to_production: false,
    production_signal: production?.signal ?? 'none',
    production_strength: production?.strength ?? null,
    production_role: production?.role ?? null,
    production_claim_supports: claimSupports
  };
  if (!record) return { ...base, class: 'not_comparable', comparable: false };
  if (record.abstained) return { ...base, class: 'shadow_abstain', comparable: true };

  const positive = POSITIVE_SIGNAL[record.question_id];
  if (positive) {
    const matched = observations.find((item) => item.signal === positive.signal) || null;
    const shadowPositive =
      record.selected_option === positive.option &&
      record.evidence_strength !== 'below_threshold' &&
      record.final_action !== 'no_ui_change';
    if (shadowPositive && matched) {
      if (record.evidence_strength && matched.strength && record.evidence_strength !== matched.strength) {
        return { ...base, class: 'strength', comparable: true, production_signal: matched.signal, production_strength: matched.strength };
      }
      return { ...base, class: 'agree', comparable: true, production_signal: matched.signal, production_strength: matched.strength };
    }
    if (!shadowPositive && !matched) return { ...base, class: 'agree', comparable: true };
    if (!shadowPositive && matched) {
      return { ...base, class: 'shadow_abstain', comparable: true, production_signal: matched.signal, production_strength: matched.strength };
    }
    return { ...base, class: 'differ', comparable: true };
  }

  if (record.question_id === 'authorial_vs_quotation') {
    const recommended = ROLE_BY_OPTION[record.selected_option] || null;
    if (!recommended) return { ...base, class: 'not_comparable', comparable: false };
    if (recommended === production?.role) return { ...base, class: 'agree', comparable: true };
    return { ...base, class: 'role_recommendation_withheld', comparable: true };
  }

  if (record.question_id === 'claim_support_status') {
    if (record.final_action === 'hold_for_human' || CLAIM_HELD.has(record.selected_option)) {
      return { ...base, class: 'held_not_applied', comparable: true };
    }
    if (claimSupports.length === 0 || claimSupports.every((item) => item === 'not_checked')) {
      if (record.selected_option === 'not_checked' || record.selected_option === 'unclear' || record.final_action === 'no_ui_change') {
        return { ...base, class: 'agree', comparable: true };
      }
    }
    if (claimSupports.includes(record.selected_option)) return { ...base, class: 'agree', comparable: true };
    return { ...base, class: 'differ', comparable: true };
  }

  if (record.question_id === 'should_abstain') {
    const productionWithheld =
      (production?.signal || 'none') === 'none' && claimSupports.every((item) => item === 'not_checked');
    if (productionWithheld) return { ...base, class: 'production_withheld', comparable: true };
    return { ...base, class: 'agree', comparable: true };
  }

  return { ...base, class: 'not_comparable', comparable: false };
}

function collectEligible(graph) {
  const eligible = [];
  const omitted = [];
  const seen = new Set();
  for (const span of graph?.spans || []) {
    const spanId = span?.id;
    if (!isSafeId(spanId)) {
      omitted.push({ span_id: null, reason: 'invalid_span_id' });
      continue;
    }
    if (seen.has(spanId)) {
      omitted.push({ span_id: spanId, reason: 'duplicate_span_id' });
      continue;
    }
    seen.add(spanId);
    if (EXCLUDED_ROLES.has(span.role)) {
      omitted.push({ span_id: spanId, reason: 'role_excluded' });
      continue;
    }
    if (typeof span.text !== 'string' || span.text.trim() === '') {
      omitted.push({ span_id: spanId, reason: 'missing_text' });
      continue;
    }
    eligible.push({
      id: spanId,
      role: typeof span.role === 'string' ? span.role : null,
      text: span.text
    });
  }
  return { eligible, omitted };
}

function productionBySpanFrom(graph, projected) {
  const roles = preJevRoleBySpan({ spans: graph?.spans || [] });
  const view = new Map();
  const spanIds = new Set();
  for (const span of projected.spans || []) {
    if (isSafeId(span?.id)) spanIds.add(span.id);
  }
  for (const spanId of spanIds) {
    const observations = [];
    for (const observation of projected.observations || []) {
      if (observation?.engine === 'jev' && observation.span_id === spanId) {
        observations.push({ signal: observation.signal, strength: observation.strength });
      }
    }
    const first = observations[0] || null;
    view.set(spanId, {
      observations,
      signal: first ? first.signal : 'none',
      strength: first ? first.strength : null,
      role: roles.get(spanId) || null,
      claim_supports: (projected.claims || []).filter((item) => item.span_id === spanId).map((item) => item.support)
    });
  }
  return { roles, view };
}

async function askWithTimeout(provider, request, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
  });
  const attempt = Promise.resolve()
    .then(() => provider.ask(request, { signal: controller.signal }))
    .then((value) => {
      if (!value || typeof value !== 'object' || value.ok !== true) {
        return { ok: false, error: safeProviderError(value?.error) };
      }
      const answers = value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers) ? value.answers : null;
      if (!answers) return { ok: false, error: 'missing_answers' };
      return {
        ok: true,
        answers,
        model_reported: isSafeId(value.model_reported) ? value.model_reported : null
      };
    })
    .catch(() => ({ ok: false, error: 'provider_failed' }));
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

function finishReport(report) {
  return redactShadowReport(report);
}

export async function buildNarrowShadowReport(input = {}) {
  let providerCalls = 0;
  try {
    if (input.enabled !== true) return finishReport(disabledReport());
    const questionSet = await loadNarrowQuestionSet();
    const graph = input.graph;
    const projected = projectGraphForShadow(graph);
    const { eligible, omitted } = collectEligible(graph);
    const { roles, view } = productionBySpanFrom(graph, projected);
    const articleId = articleIdFromAnalyze({
      mode: input.articleHint?.mode,
      fixtureId: input.articleHint?.fixtureId,
      textSha256: projected.artifact.text_sha256
    });
    const analysisRunId = projected.graph_id;
    const sourceId = projected.artifact.publisher_domain;
    const deploymentSha = cleanDeploymentSha(input.deploymentSha);
    const recordedAt = cleanTimestamp(input.recordedAt) || new Date().toISOString();
    const limits = input.limits || {};
    const limitsPresent = narrowLimitsPresent(limits);
    const providerKind = input.providerKind === 'injected_mock' || input.providerKind === 'live_provider' ? input.providerKind : 'network_disabled';
    const liveNetworkPermitted = input.liveNetworkPermitted === true;
    const liveNetworkBlockReason = typeof input.liveNetworkBlockReason === 'string' ? input.liveNetworkBlockReason : null;
    const ledgerScope = input.costLedger ? 'process_local_placeholder' : 'analysis_local_placeholder';
    const rateLimiter = input.rateLimiter || createNarrowRateLimiter({ perMinute: limits.rateLimitPerMinute });
    const costLedger =
      input.costLedger ||
      createNarrowCostLedger({
        ceilingUsd: limits.monthlyCostCeilingUsd,
        estimatedUsdPerCall: limits.estimatedUsdPerCall
      });

    if (input && Object.prototype.hasOwnProperty.call(input, 'graph') && !Object.isFrozen(input)) input.graph = null;

    const shared = {
      question_set_id: questionSet.id,
      question_set_version: String(questionSet.version),
      question_set_sha256: questionSet.sha256,
      model_requested: questionSet.model_requested,
      deployment_sha: deploymentSha,
      analysis_run_id: analysisRunId,
      article_id: articleId,
      source_id: sourceId,
      provider_kind: providerKind,
      live_network_permitted: liveNetworkPermitted,
      live_network_block_reason: liveNetworkBlockReason,
      cross_span_batched: false,
      planner_http_calls: 0,
      holdout_scored: false,
      splits_scored: false
    };

    if (!articleId || !analysisRunId) {
      return finishReport(
        baseReport({
          ...shared,
          shadow_failed: false,
          network_calls: 0,
          refused: 'missing_provenance',
          records: [],
          span_results: [],
          production_disagreements: [],
          disagreement_count: 0,
          provider_failure_count: 0,
          omitted_spans: omitted,
          narrow_question_set: { id: questionSet.id, version: String(questionSet.version), asked: false, reason: 'missing_provenance' },
          cost: costEnvelope({ estimate: null, thisAnalysis: 0, ledger: costLedger, scope: ledgerScope })
        })
      );
    }

    if (!limitsPresent) {
      return finishReport(
        baseReport({
          ...shared,
          shadow_failed: false,
          network_calls: 0,
          refused: 'owner_limits_unset',
          records: [],
          span_results: [],
          production_disagreements: [],
          disagreement_count: 0,
          provider_failure_count: 0,
          omitted_spans: omitted,
          narrow_question_set: { id: questionSet.id, version: String(questionSet.version), asked: false, reason: 'owner_limits_unset' },
          cost: costEnvelope({ estimate: null, thisAnalysis: 0, ledger: costLedger, scope: ledgerScope })
        })
      );
    }

    const sendable = sendableQuestionIds(questionSet);
    const plannedItems = eligible.map((span) => ({
      provenance: {
        article_id: articleId,
        source_id: sourceId,
        span_id: span.id,
        source_ids: sourceId ? [sourceId] : [],
        span_role: roles.get(span.id) || null
      },
      question_ids: [...sendable, 'observed_vs_candidate']
    }));
    const plan = planQuestionBatch(plannedItems, questionSet);
    const cap = limits.maxCallsPerAnalysis;
    const executable = plan.requests.slice(0, cap);
    for (const request of plan.requests.slice(cap)) {
      omitted.push({ span_id: request.provenance.span_id, reason: 'call_cap' });
    }

    if (!isProvider(input.provider)) {
      for (const span of eligible) {
        if (!omitted.some((item) => item.span_id === span.id)) omitted.push({ span_id: span.id, reason: liveNetworkBlockReason || 'network_disabled' });
      }
      return finishReport(
        baseReport({
          ...shared,
          shadow_failed: false,
          network_calls: 0,
          refused: liveNetworkBlockReason || 'network_disabled',
          planned_request_count: plan.requests.length,
          executed_request_count: 0,
          cross_span_batched: plan.cross_span_batched,
          planner_http_calls: plan.http_calls,
          provenance_plan_ok:
            plan.cross_span_batched === false && plan.http_calls === 0 && plan.requests.length === eligible.length && plan.refused.length === eligible.length,
          records: [],
          span_results: [],
          production_disagreements: [],
          disagreement_count: 0,
          provider_failure_count: 0,
          omitted_spans: omitted,
          narrow_question_set: {
            id: questionSet.id,
            version: String(questionSet.version),
            asked: false,
            reason: liveNetworkBlockReason || 'network_disabled'
          },
          split_isolation: { split: RUNTIME_SPLIT, collisions: [], reassigned_cases: 0, gate: 'per_assigned_split', holdout_scored: false },
          cost: costEnvelope({ estimate: limits.estimatedUsdPerCall, thisAnalysis: 0, ledger: costLedger, scope: ledgerScope })
        })
      );
    }

    const kind = typeof graph?.artifact?.kind === 'string' ? graph.artifact.kind : null;
    const title = truncate(
      typeof graph?.artifact?.title === 'string' ? graph.artifact.title : null,
      NARROW_SHADOW_MAX_TITLE_CHARS
    );
    const shells = new Map();
    const drafts = [];
    let stopReason = null;
    let providerFailures = 0;
    let modelReported = null;

    for (let index = 0; index < executable.length; index += 1) {
      const request = executable[index];
      const spanId = request.provenance.span_id;
      const span = eligible.find((item) => item.id === spanId);
      const markRest = (reason) => {
        omitted.push({ span_id: spanId, reason });
        for (const later of executable.slice(index + 1)) {
          omitted.push({ span_id: later.provenance.span_id, reason });
        }
      };
      if (stopReason) break;
      if (providerCalls >= cap) {
        markRest('call_cap');
        break;
      }
      const reserved = costLedger.tryReserve();
      if (!reserved.ok) {
        stopReason = reserved.reason || 'monthly_cost_ceiling';
        markRest(stopReason);
        break;
      }
      const rate = rateLimiter.tryAcquire();
      if (!rate.ok) {
        if (typeof costLedger.unreserve === 'function') costLedger.unreserve();
        stopReason = rate.reason || 'rate_limited';
        markRest(stopReason);
        break;
      }

      const before = index > 0 ? eligible.find((item) => item.id === executable[index - 1].provenance.span_id)?.text : null;
      const after = index + 1 < executable.length ? eligible.find((item) => item.id === executable[index + 1].provenance.span_id)?.text : null;
      const questions = {};
      for (const questionId of request.question_ids) {
        const question = questionSet.questions[questionId];
        if (question) questions[questionId] = jevQuestionPayload(question);
      }
      const payload = {
        article_id: articleId,
        source_id: sourceId,
        span_id: spanId,
        analysis_run_id: analysisRunId,
        question_set_id: questionSet.id,
        question_set_version: String(questionSet.version),
        question_set_sha256: questionSet.sha256,
        model_requested: questionSet.model_requested,
        deployment_sha: deploymentSha,
        question_ids: [...request.question_ids],
        questions,
        state: {
          artifact: { kind, title },
          span: {
            id: spanId,
            role: roles.get(spanId) || span?.role || null,
            text: truncate(span?.text || '', NARROW_SHADOW_MAX_SPAN_CHARS)
          },
          context: { before: truncate(before, NARROW_SHADOW_MAX_CONTEXT_CHARS), after: truncate(after, NARROW_SHADOW_MAX_CONTEXT_CHARS) },
          provenance: request.provenance
        }
      };

      providerCalls += 1;
      const result = await askWithTimeout(input.provider, payload, limits.timeoutMs);
      const shell = {
        ...NARROW_SHADOW_LABELS,
        span_id: spanId,
        article_id: articleId,
        source_id: sourceId,
        analysis_run_id: analysisRunId,
        question_set_id: questionSet.id,
        question_set_version: String(questionSet.version),
        question_set_sha256: questionSet.sha256,
        model_requested: questionSet.model_requested,
        model_reported: null,
        deployment_sha: deploymentSha,
        question_ids: [...request.question_ids],
        provider_status: result.ok ? 'ok' : 'error',
        provider_error: result.ok ? null : result.error,
        records: [],
        production_disagreements: [],
        acted: false,
        claim_support_applied: false,
        role_write_authorized: false
      };
      shells.set(spanId, shell);
      if (!result.ok) {
        providerFailures += 1;
        continue;
      }
      shell.model_reported = result.model_reported;
      if (result.model_reported) modelReported = result.model_reported;
      const audit = {
        model_reported: result.model_reported,
        deployment_sha: deploymentSha,
        question_set_sha256: questionSet.sha256,
        recorded_at: recordedAt
      };
      for (const questionId of request.question_ids) {
        const record = buildDecisionRecord({
          questionSet,
          questionId,
          answer: result.answers[questionId] || null,
          provenance: request.provenance,
          audit,
          measurement: { latency_ms: null, call_count: null, basis: 'not_measured' },
          requireCompleteDistribution: true,
          deterministicMarker: null
        });
        record.dropped_fields = safeDropped(record.dropped_fields);
        record.acted = false;
        record.claim_support_applied = false;
        record.role_write_authorized = false;
        drafts.push({ span_id: spanId, record });
      }
    }

    for (const span of eligible) span.text = '';

    const prepared = prepareLabCases(drafts.map((draft) => ({ record: draft.record, split: RUNTIME_SPLIT, label: null })));
    const disagreements = [];
    prepared.cases.forEach((item, index) => {
      const spanId = drafts[index]?.span_id || item.record?.provenance?.span_id;
      const shell = shells.get(spanId);
      const disagreement = compareNarrowDecisionToProduction(item.record, view.get(spanId));
      if (shell) {
        shell.records.push(item.record);
        shell.production_disagreements.push(disagreement);
      }
      disagreements.push(disagreement);
    });

    const records = prepared.cases.map((item) => item.record);
    const disagreementCount = disagreements.filter((item) => DISAGREEMENT_CLASSES.has(item.class)).length;
    const asked = providerCalls > 0;
    return finishReport(
      baseReport({
        ...shared,
        model_reported: modelReported,
        shadow_failed: providerFailures > 0,
        network_calls: providerCalls,
        refused: null,
        planned_request_count: plan.requests.length,
        executed_request_count: shells.size,
        cross_span_batched: plan.cross_span_batched,
        planner_http_calls: plan.http_calls,
        provenance_plan_ok:
          plan.cross_span_batched === false &&
          plan.http_calls === 0 &&
          plan.requests.length === eligible.length &&
          plan.refused.length === eligible.length &&
          plan.requests.every((request) => request.provenance?.article_id && request.provenance?.span_id),
        omitted_span_count: omitted.length,
        omitted_spans: omitted,
        disagreement_count: disagreementCount,
        provider_failure_count: providerFailures,
        narrow_question_set: {
          id: questionSet.id,
          version: String(questionSet.version),
          asked,
          reason: asked ? 'shadow_comparison_only' : stopReason || 'no_calls'
        },
        split_isolation: {
          split: RUNTIME_SPLIT,
          collisions: prepared.collisions,
          reassigned_cases: prepared.reassigned_cases,
          gate: prepared.gate,
          holdout_scored: false
        },
        cost: costEnvelope({
          estimate: limits.estimatedUsdPerCall,
          thisAnalysis: providerCalls * limits.estimatedUsdPerCall,
          ledger: costLedger,
          scope: ledgerScope
        }),
        records,
        span_results: [...shells.values()],
        production_disagreements: disagreements
      })
    );
  } catch {
    return finishReport(failureReport(providerCalls));
  }
}

export function emitNarrowShadowReport(report, write = (line) => process.stderr.write(`${line}\n`)) {
  write(JSON.stringify(redactShadowReport(report)));
}

export function scheduleNarrowShadow({
  enabled,
  input,
  sink,
  build = buildNarrowShadowReport,
  schedule = (fn) => setTimeout(fn, 0)
} = {}) {
  if (enabled !== true) return { scheduled: false, network_calls: 0, done: Promise.resolve(null) };
  let resolve;
  const done = new Promise((resolveDone) => {
    resolve = resolveDone;
  });
  schedule(() => {
    Promise.resolve()
      .then(() => build(input))
      .then((report) => {
        const safe = redactShadowReport(report);
        try {
          if (typeof sink === 'function') sink(safe);
          else emitNarrowShadowReport(safe);
        } catch {
          resolve({ ok: false, shadow_failed: true, network_calls: Number(safe?.network_calls) || 0, acted: false });
          return;
        }
        resolve({ ok: safe?.shadow_failed !== true, network_calls: Number(safe?.network_calls) || 0, acted: false });
      })
      .catch(() => {
        const safe = failureReport(0);
        try {
          if (typeof sink === 'function') sink(redactShadowReport(safe));
          else emitNarrowShadowReport(safe);
        } catch {
          // The production response was already sent.
        }
        resolve({ ok: false, shadow_failed: true, network_calls: 0, acted: false });
      });
  });
  return { scheduled: true, network_calls: 0, done };
}

export function armNarrowShadow(args = {}) {
  if (args.enabled !== true) return { scheduled: false, network_calls: 0, done: Promise.resolve(null) };
  return scheduleNarrowShadow({
    enabled: true,
    input: args,
    sink: args.sink
  });
}

export function narrowLiveRequestBody(model, request) {
  return {
    model,
    state: request?.state,
    questions: request?.questions
  };
}

export function createNarrowLiveProvider({ fetchImpl, baseUrl, apiKey, model }) {
  if (typeof fetchImpl !== 'function' || typeof baseUrl !== 'string' || !baseUrl || typeof apiKey !== 'string' || !apiKey) {
    return {
      async ask() {
        return { ok: false, error: 'live_fetch_unavailable' };
      }
    };
  }
  return {
    async ask(request, { signal } = {}) {
      let response;
      try {
        response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/systemone`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(narrowLiveRequestBody(model, request)),
          signal,
          redirect: 'manual'
        });
      } catch (err) {
        if (err?.name === 'AbortError' || err?.code === 'TIMEOUT' || err?.code === 'ABORT_ERR') {
          return { ok: false, error: 'timeout' };
        }
        if (PROVIDER_ERRORS.has(err?.code)) return { ok: false, error: err.code };
        return { ok: false, error: 'provider_failed' };
      }
      if (!response || typeof response !== 'object') return { ok: false, error: 'provider_failed' };
      if (response.redirected === true || response.type === 'opaqueredirect') return { ok: false, error: 'redirect_rejected' };
      const status = response.status;
      if (Number.isInteger(status) && status >= 300 && status < 400) return { ok: false, error: 'redirect_rejected' };
      if (!response.ok) return { ok: false, error: Number.isInteger(status) ? `http_${status}` : 'provider_failed' };
      let body;
      try {
        body = await response.json();
      } catch {
        return { ok: false, error: 'malformed_json' };
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'malformed_body' };
      const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : null;
      if (!answers) return { ok: false, error: 'missing_answers' };
      return {
        ok: true,
        answers,
        model_reported: isSafeId(body.model) ? body.model : null
      };
    }
  };
}
