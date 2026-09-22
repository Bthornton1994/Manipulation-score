// Shadow observation for POST /analyze.
//
// Schedules work only after the production response is sent. It does not
// call TypeSafe, does not import fusion, and does not write the graph.
// MEDIA_LENS_JEV_SHADOW is read by worker/config.js, not by this file.
// Extra Jev calls for media-lens-narrow.v1 are not implemented.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from '../jev/canonical-json.js';
import {
  COST_UNAVAILABLE,
  CURRENT_SIGNAL_OPTIONS,
  buildDecisionRecord,
  buildQuotedNoulRecord
} from './decision.js';
import { planQuestionBatch } from './batch-plan.js';
import { preJevRoleBySpan, productionInfluenceQuestionSet } from './historical.js';

const QUESTIONS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'jev', 'questions.v1.json');

export const SHADOW_EXTRA_JEV_CALLS_ENABLED = false;
export const SHADOW_NETWORK_CALLS = 0;
export const MAX_SHADOW_SPANS = 200;
export const SHADOW_RETENTION = 'stderr_process_log_only_no_disk_store';

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const FIXTURE_ID_RE = /^[a-z0-9-]{1,128}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SIGNAL_IDS = new Set(CURRENT_SIGNAL_OPTIONS);
const STRENGTHS = new Set(['observed', 'candidate']);
const SUPPORTS = new Set(['not_checked', 'supported', 'contradicted', 'mixed', 'unclear', 'abstain']);
const ROLES = new Set([
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
const ROLE_BASIS = new Set(['default', 'quote_marks', 'blockquote', 'html_structure', 'engine_disagreement']);
const ANSWER_KEYS = new Set(['type', 'choice', 'probabilities', 'confidence', 'noul']);
const DROP_KEYS = new Set([
  'text',
  'title',
  'byline',
  'url',
  'canonical_url',
  'html',
  'body',
  'instructions',
  'prompt',
  'authorization',
  'api_key',
  'apikey',
  'token',
  'password',
  'secret',
  'cookie',
  'message',
  'ui_phrase',
  'explanation'
]);
const SECRET_VALUE = /sk-[A-Za-z0-9]{8,}|Bearer\s+\S+|Authorization\s*[:=]|[a-z]+:\/\/[^/\s]+:[^@/\s]+@/i;

let questionAuditPromise = null;

function isSafeId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

function cleanTimestamp(value) {
  return typeof value === 'string' && TIMESTAMP_RE.test(value) ? value : null;
}

function cleanRunId(value) {
  return typeof value === 'string' && RUN_ID_RE.test(value) ? value.toLowerCase() : null;
}

function cleanSignal(value) {
  if (value === 'none') return 'none';
  return SIGNAL_IDS.has(value) ? value : 'none';
}

function cleanStrength(value) {
  return STRENGTHS.has(value) ? value : null;
}

function cleanSupport(value) {
  return SUPPORTS.has(value) ? value : 'other';
}

function cleanRole(value) {
  return ROLES.has(value) ? value : null;
}

function cleanRoleBasis(value) {
  return ROLE_BASIS.has(value) ? value : null;
}

export function articleIdFromAnalyze({ mode, fixtureId, textSha256 } = {}) {
  if (mode === 'fixture' && typeof fixtureId === 'string' && FIXTURE_ID_RE.test(fixtureId)) return fixtureId;
  if (typeof textSha256 === 'string' && SHA256_RE.test(textSha256)) return textSha256;
  return null;
}

function emptyCapture() {
  return {
    answers: [],
    failed_span_ids: [],
    calls: 0,
    failures: 0,
    model_reported: null
  };
}

function copyProbabilities(source) {
  const probabilities = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return probabilities;
  for (const key of Object.keys(source).sort()) {
    const value = source[key];
    if (!isSafeId(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) continue;
    probabilities[key] = value;
  }
  return probabilities;
}

function droppedNames(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return [];
  return Object.keys(answer)
    .filter((key) => !ANSWER_KEYS.has(key))
    .sort();
}

function withDroppedNames(safe, dropped) {
  const copy = { ...safe };
  for (const name of dropped) {
    if (isSafeId(name) || /^[a-z0-9_-]{1,64}$/i.test(name)) copy[name] = true;
  }
  return copy;
}

function copyChoice(answer) {
  if (!answer || typeof answer !== 'object') return null;
  const dropped = droppedNames(answer);
  return withDroppedNames(
    {
      type: 'choice',
      choice: typeof answer.choice === 'string' && isSafeId(answer.choice) ? answer.choice : null,
      probabilities: copyProbabilities(answer.probabilities),
      confidence: typeof answer.confidence === 'number' ? answer.confidence : null
    },
    dropped
  );
}

function copyNoul(answer) {
  if (!answer || typeof answer !== 'object') return null;
  const dropped = droppedNames(answer);
  return withDroppedNames(
    {
      type: 'noul',
      noul: typeof answer.noul === 'number' ? answer.noul : null
    },
    dropped
  );
}

export function sanitizeJevResult(result) {
  if (!result || typeof result !== 'object') return emptyCapture();
  const answers = [];
  const map = result.answersBySpanId;
  if (map && typeof map.entries === 'function') {
    for (const [spanId, value] of map.entries()) {
      if (!isSafeId(spanId) || !value || typeof value !== 'object') continue;
      answers.push({
        span_id: spanId,
        influence_signal: copyChoice(value.influence_signal),
        is_quoted_or_attributed: copyNoul(value.is_quoted_or_attributed)
      });
    }
  }
  answers.sort((a, b) => (a.span_id < b.span_id ? -1 : a.span_id > b.span_id ? 1 : 0));
  const failed = [];
  if (result.failedSpanIds && typeof result.failedSpanIds[Symbol.iterator] === 'function') {
    for (const spanId of result.failedSpanIds) {
      if (isSafeId(spanId) && !failed.includes(spanId)) failed.push(spanId);
    }
  }
  failed.sort();
  const model = result.modelReported;
  return {
    answers,
    failed_span_ids: failed,
    calls: Number.isInteger(result.calls) && result.calls >= 0 ? result.calls : 0,
    failures: Number.isInteger(result.failures) && result.failures >= 0 ? result.failures : 0,
    model_reported: isSafeId(model) ? model : null
  };
}

export function createJevAnswerCapture() {
  let result = null;
  let sawResult = false;
  return {
    wrap(adapter) {
      if (!adapter || typeof adapter.analyzeSpans !== 'function') return adapter;
      return new Proxy(adapter, {
        get(target, prop, receiver) {
          if (prop !== 'analyzeSpans') return Reflect.get(target, prop, receiver);
          return function wrappedAnalyzeSpans(...args) {
            const pending = target.analyzeSpans.apply(target, args);
            if (pending && typeof pending.then === 'function') {
              pending.then(
                (value) => {
                  result = value;
                  sawResult = true;
                },
                () => {
                  result = null;
                  sawResult = true;
                }
              );
            }
            return pending;
          };
        }
      });
    },
    take() {
      const current = result;
      result = null;
      const seen = sawResult;
      sawResult = false;
      return { sawResult: seen, result: current };
    }
  };
}

export function projectGraphForShadow(graph) {
  const spans = [];
  for (const span of graph?.spans || []) {
    spans.push({
      id: span?.id,
      role: cleanRole(span?.role),
      role_basis: cleanRoleBasis(span?.role_basis)
    });
  }
  const observations = [];
  for (const observation of graph?.observations || []) {
    const spanId = Array.isArray(observation?.span_ids) ? observation.span_ids[0] : null;
    observations.push({
      signal: cleanSignal(observation?.signal),
      strength: cleanStrength(observation?.strength),
      span_id: isSafeId(spanId) ? spanId : null,
      engine: observation?.evidence?.engine === 'jev' ? 'jev' : null
    });
  }
  const claims = [];
  for (const claim of graph?.claims || []) {
    const spanId = Array.isArray(claim?.span_ids) ? claim.span_ids[0] : null;
    claims.push({
      span_id: isSafeId(spanId) ? spanId : null,
      support: cleanSupport(claim?.support)
    });
  }
  const abstentions = [];
  for (const item of graph?.abstentions || []) {
    abstentions.push({
      reason: isSafeId(item?.reason) ? item.reason : null,
      scope: item?.scope === 'graph' || item?.scope === 'span' ? item.scope : null
    });
  }
  const domain = graph?.artifact?.publisher?.domain;
  const sha = graph?.artifact?.text_sha256;
  const reported = graph?.engine?.jev?.model_reported;
  const calls = graph?.engine?.jev?.calls;
  return {
    graph_id: cleanRunId(graph?.graph_id),
    artifact: {
      text_sha256: typeof sha === 'string' && SHA256_RE.test(sha) ? sha : null,
      publisher_domain: isSafeId(domain) ? domain : null
    },
    spans,
    observations,
    claims,
    abstentions,
    jev: {
      mode: graph?.engine?.jev?.mode === 'live' || graph?.engine?.jev?.mode === 'fixture' || graph?.engine?.jev?.mode === 'disabled'
        ? graph.engine.jev.mode
        : null,
      model_reported: isSafeId(reported) ? reported : null,
      calls: Number.isInteger(calls) && calls >= 0 ? calls : 0
    }
  };
}

function productionDecision(projected, spanId) {
  const span = projected.spans.find((item) => item.id === spanId) || null;
  const observation = projected.observations.find((item) => item.engine === 'jev' && item.span_id === spanId) || null;
  const claimSupports = projected.claims.filter((item) => item.span_id === spanId).map((item) => item.support);
  return {
    signal: observation ? observation.signal : 'none',
    strength: observation ? observation.strength : null,
    role: span?.role ?? null,
    role_basis: span?.role_basis ?? null,
    claim_supports: claimSupports
  };
}

function classifyInfluence(record, production) {
  const prodSignal = production.signal || 'none';
  const prodStrength = production.strength ?? null;
  if (record.abstained || record.selected_option == null) {
    if (prodSignal === 'none' && prodStrength == null) return 'agree';
    return 'shadow_abstain';
  }
  const withheld =
    record.selected_option === 'none' ||
    record.final_action === 'no_ui_change' ||
    record.evidence_strength === 'below_threshold';
  const shadowSignal = withheld ? 'none' : record.selected_option;
  const shadowStrength = withheld ? null : record.evidence_strength;
  if (shadowSignal === 'none' && prodSignal === 'none') return 'agree';
  if (shadowSignal !== prodSignal) {
    if (prodSignal === 'none') return 'production_withheld';
    if (shadowSignal === 'none') return 'shadow_abstain';
    return 'signal';
  }
  if (shadowStrength !== prodStrength) return 'strength';
  return 'agree';
}

function classifyRole(quoted, production) {
  const recommends = quoted.role_effect === 'authorial_to_uncertain';
  const applied = production.role === 'uncertain' && production.role_basis === 'engine_disagreement';
  if (quoted.role_write_authorized !== false) return 'signal';
  if (recommends && applied) return 'agree';
  if (recommends && !applied) return 'role_recommendation_withheld';
  if (!recommends && applied) return 'signal';
  return 'agree';
}

function classifyClaim(supports) {
  if (supports.length === 0) return 'agree';
  return supports.every((support) => support === 'not_checked') ? 'agree' : 'claim_support';
}

function shadowDecision(influence, quoted) {
  return {
    selected_option: influence.selected_option,
    evidence_strength: influence.evidence_strength,
    abstained: influence.abstained,
    abstention_reason: influence.abstention_reason,
    final_action: influence.final_action,
    role_effect: quoted.role_effect,
    claim_support_applied: false,
    role_write_authorized: false
  };
}

async function loadProductionQuestionAudit() {
  if (!questionAuditPromise) {
    questionAuditPromise = readFile(QUESTIONS_PATH, 'utf8')
      .then((raw) => {
        const sha256 = createHash('sha256').update(canonicalStringify(JSON.parse(raw)), 'utf8').digest('hex');
        return { sha256, questionSet: productionInfluenceQuestionSet() };
      })
      .catch((err) => {
        questionAuditPromise = null;
        throw err;
      });
  }
  return questionAuditPromise;
}

function failureReport() {
  return {
    shadow_enabled: true,
    shadow_failed: true,
    acted: false,
    not_model_accuracy: true,
    label: 'fixture_replay',
    network_calls: SHADOW_NETWORK_CALLS,
    extra_jev_calls_enabled: SHADOW_EXTRA_JEV_CALLS_ENABLED,
    extra_jev_calls: 0,
    records: [],
    retention: SHADOW_RETENTION,
    cost: { ...COST_UNAVAILABLE }
  };
}

export async function buildAnalyzeShadowReport(input = {}) {
  const started = Date.now();
  const projected = projectGraphForShadow(input.graph);
  const taken = input.capture?.take ? input.capture.take() : { sawResult: false, result: input.capturedResult || null };
  const captured = sanitizeJevResult(taken.result);
  if (input && Object.prototype.hasOwnProperty.call(input, 'graph')) input.graph = null;

  const articleId = articleIdFromAnalyze({
    mode: input.articleHint?.mode,
    fixtureId: input.articleHint?.fixtureId,
    textSha256: projected.artifact.text_sha256
  });
  const analysisRunId = projected.graph_id;
  const { sha256, questionSet } = await loadProductionQuestionAudit();
  const recordedAt = cleanTimestamp(input.recordedAt) || new Date().toISOString();
  const deploymentSha = null;
  const latency =
    typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0
      ? input.elapsedMs
      : Math.max(0, Date.now() - started);
  const jevMode = input.jevMode === 'live' || input.jevMode === 'fixture' || input.jevMode === 'disabled' ? input.jevMode : projected.jev.mode;
  const label = jevMode === 'fixture' ? 'fixture_replay' : 'runtime_shadow';
  const modelReported = captured.model_reported || projected.jev.model_reported || null;
  const audit = {
    model_reported: modelReported,
    deployment_sha: deploymentSha,
    question_set_sha256: sha256,
    recorded_at: recordedAt
  };
  const measurement = { latency_ms: latency, call_count: SHADOW_NETWORK_CALLS, basis: 'in_process' };
  const sourceId = projected.artifact.publisher_domain;

  if (!articleId || !analysisRunId) {
    return scrubReport({
      shadow_enabled: true,
      shadow_failed: false,
      acted: false,
      not_model_accuracy: true,
      label,
      network_calls: SHADOW_NETWORK_CALLS,
      extra_jev_calls_enabled: false,
      extra_jev_calls: 0,
      production_jev_calls: projected.jev.calls,
      captured_calls: captured.calls,
      decision_count: 0,
      latency_ms: latency,
      call_count: SHADOW_NETWORK_CALLS,
      cross_span_batched: false,
      http_calls: 0,
      provenance_plan_ok: false,
      refused: 'missing_provenance',
      disagreement_count: 0,
      claim_support_applied: false,
      role_write_authorized: false,
      holdout_scored: false,
      fixture_manifest_loaded: false,
      splits_scored: false,
      narrow_question_set: { id: 'media-lens-narrow.v1', version: '1', asked: false, reason: 'extra_jev_calls_disabled' },
      question_set_id: questionSet.id,
      question_set_version: String(questionSet.version),
      question_set_sha256: sha256,
      model_requested: questionSet.model_requested,
      model_reported: modelReported,
      deployment_sha: deploymentSha,
      analysis_run_id: analysisRunId,
      article_id: articleId,
      retention: SHADOW_RETENTION,
      cost: { ...COST_UNAVAILABLE },
      records: []
    });
  }

  const roles = preJevRoleBySpan({ spans: projected.spans });
  const spanIds = [];
  for (const answer of captured.answers) {
    if (!spanIds.includes(answer.span_id)) spanIds.push(answer.span_id);
  }
  for (const spanId of captured.failed_span_ids) {
    if (!spanIds.includes(spanId)) spanIds.push(spanId);
  }
  spanIds.sort();
  const limited = spanIds.slice(0, MAX_SHADOW_SPANS);
  const answersBySpan = new Map(captured.answers.map((answer) => [answer.span_id, answer]));
  const plan = planQuestionBatch(
    limited.map((spanId) => ({
      provenance: {
        article_id: articleId,
        source_id: sourceId,
        span_id: spanId,
        span_role: roles.get(spanId) || null
      },
      question_ids: ['influence_signal', 'is_quoted_or_attributed']
    })),
    questionSet
  );

  const records = [];
  for (const spanId of limited) {
    const answer = answersBySpan.get(spanId) || null;
    const production = productionDecision(projected, spanId);
    const provenance = {
      article_id: articleId,
      source_id: sourceId,
      span_id: spanId,
      source_ids: sourceId ? [sourceId] : [],
      span_role: roles.get(spanId) || null
    };
    const influence = buildDecisionRecord({
      questionSet,
      questionId: 'influence_signal',
      answer: answer?.influence_signal || null,
      provenance,
      audit,
      measurement,
      requireCompleteDistribution: false,
      deterministicMarker: null
    });
    const quoted = buildQuotedNoulRecord({
      questionSet,
      answer: answer?.is_quoted_or_attributed || null,
      provenance,
      audit,
      measurement
    });
    const influenceClass = classifyInfluence(influence, production);
    const roleClass = classifyRole(quoted, production);
    const claimClass = classifyClaim(production.claim_supports);
    influence.disagreement = influenceClass !== 'agree';
    influence.model_disagreement = null;
    influence.outcome = null;
    influence.historical_action = null;
    quoted.disagreement = roleClass !== 'agree';
    quoted.model_disagreement = null;
    quoted.outcome = null;
    quoted.historical_action = null;
    quoted.role_write_authorized = false;
    quoted.claim_support_applied = false;
    influence.claim_support_applied = false;
    influence.role_write_authorized = false;
    influence.acted = false;
    quoted.acted = false;
    records.push({
      analysis_run_id: analysisRunId,
      article_id: articleId,
      source_id: sourceId,
      span_id: spanId,
      text_sha256: projected.artifact.text_sha256,
      question_set_id: questionSet.id,
      question_set_version: String(questionSet.version),
      question_set_sha256: sha256,
      model_requested: questionSet.model_requested,
      model_reported: modelReported,
      deployment_sha: deploymentSha,
      production_decision: production,
      shadow_decision: shadowDecision(influence, quoted),
      disagreement_class: influenceClass,
      role_disagreement_class: roleClass,
      claim_disagreement_class: claimClass,
      influence,
      quoted
    });
  }

  const disagreementCount = records.filter(
    (row) => row.disagreement_class !== 'agree' || row.role_disagreement_class !== 'agree' || row.claim_disagreement_class !== 'agree'
  ).length;

  return scrubReport({
    shadow_enabled: true,
    shadow_failed: false,
    acted: false,
    not_model_accuracy: true,
    label,
    network_calls: SHADOW_NETWORK_CALLS,
    extra_jev_calls_enabled: false,
    extra_jev_calls: 0,
    production_jev_calls: projected.jev.calls,
    captured_calls: captured.calls,
    decision_count: records.length,
    omitted_span_count: spanIds.length - limited.length,
    latency_ms: latency,
    call_count: SHADOW_NETWORK_CALLS,
    cross_span_batched: plan.cross_span_batched,
    http_calls: plan.http_calls,
    planned_request_count: plan.requests.length,
    provenance_plan_ok: plan.requests.length === limited.length && plan.refused.length === 0 && plan.http_calls === 0,
    refused: null,
    disagreement_count: disagreementCount,
    claim_support_applied: false,
    role_write_authorized: false,
    holdout_scored: false,
    fixture_manifest_loaded: false,
    splits_scored: false,
    narrow_question_set: { id: 'media-lens-narrow.v1', version: '1', asked: false, reason: 'extra_jev_calls_disabled' },
    question_set_id: questionSet.id,
    question_set_version: String(questionSet.version),
    question_set_sha256: sha256,
    model_requested: questionSet.model_requested,
    model_reported: modelReported,
    deployment_sha: deploymentSha,
    analysis_run_id: analysisRunId,
    article_id: articleId,
    production_graph_abstained: projected.abstentions.some((item) => item.scope === 'graph'),
    saw_jev_result: taken.sawResult,
    retention: SHADOW_RETENTION,
    cost: { ...COST_UNAVAILABLE },
    records
  });
}

function scrubString(value) {
  if (value.length > 180) return null;
  if (SECRET_VALUE.test(value)) return null;
  if (value.includes('://')) return null;
  if (/[?&](token|key|password|secret|auth)=/i.test(value)) return null;
  return value;
}

function scrub(value, depth) {
  if (depth > 12) return null;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (DROP_KEYS.has(key)) continue;
      out[key] = scrub(item, depth + 1);
    }
    return out;
  }
  return null;
}

export function redactShadowReport(report) {
  return scrub(report, 0);
}

function scrubReport(report) {
  return redactShadowReport(report);
}

export function emitShadowReport(report, write = (line) => process.stderr.write(`${line}\n`)) {
  write(JSON.stringify(redactShadowReport(report)));
}

export function scheduleAnalyzeShadow({
  enabled,
  input,
  sink,
  build = buildAnalyzeShadowReport,
  schedule = (fn) => setTimeout(fn, 0)
} = {}) {
  if (enabled !== true) return { scheduled: false, network_calls: 0, done: Promise.resolve(null) };
  let resolve;
  const done = new Promise((resolveDone) => {
    resolve = resolveDone;
  });
  const timer = schedule(() => {
    Promise.resolve()
      .then(() => build(input))
      .then((report) => {
        const safe = redactShadowReport(report);
        try {
          if (typeof sink === 'function') sink(safe);
          else emitShadowReport(safe);
        } catch {
          resolve({ ok: false, shadow_failed: true, network_calls: 0, acted: false });
          return;
        }
        resolve({ ok: safe?.shadow_failed !== true, network_calls: 0, acted: false });
      })
      .catch(() => {
        const safe = failureReport();
        try {
          if (typeof sink === 'function') sink(safe);
          else emitShadowReport(safe);
        } catch {
          // The production response was already sent.
        }
        resolve({ ok: false, shadow_failed: true, network_calls: 0, acted: false });
      });
  });
  return { scheduled: true, network_calls: 0, done };
}

export function armAnalyzeShadow({ enabled, graph, capture, articleHint, jevMode, sink, recordedAt, elapsedMs } = {}) {
  if (enabled !== true) return { scheduled: false, network_calls: 0, done: Promise.resolve(null) };
  return scheduleAnalyzeShadow({
    enabled: true,
    input: { graph, capture, articleHint, jevMode, recordedAt, elapsedMs },
    sink
  });
}
