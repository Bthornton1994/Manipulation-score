// Optional development tracing for the Jev adapter (t1760u Langfuse pilot).
//
// Disabled by default: createJevAdapter only emits when a caller passes a
// devTracer built here. Nothing in server.js or config.js constructs one, so
// production and CI analysis paths never trace.
//
// Records carry operational metadata only: run id, provider, requested and
// reported model, question-set name and sha256, mode, latency, numeric usage
// fields, and a bounded error category. Span text, artifact titles, context,
// prompts/instructions, answers, URLs, and credentials are never copied in.
// The record is built from an allowlist, so new adapter fields cannot leak by
// default.
//
// Prompts stay versioned in Git (worker/jev/questions.v1.json). A trace names
// the question set and its hash; it never carries the question text.
//
// No Langfuse SDK is bundled. Exporters are plain functions; a Langfuse
// binding must receive these redacted records and nothing else.

import { randomUUID } from 'node:crypto';

const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const ERROR_CATEGORY_RE = /^[a-z0-9_]{1,64}$/;
const USAGE_KEY_RE = /^[a-z_]{1,40}$/;
const MAX_USAGE_KEYS = 10;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MODES = new Set(['fixture', 'live']);
const PROVIDER = 'typesafe';

function safeId(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

function safeErrorCategory(value) {
  if (value == null) return null;
  return typeof value === 'string' && ERROR_CATEGORY_RE.test(value) ? value : 'other';
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(usage)) {
    if (count >= MAX_USAGE_KEYS) break;
    if (!USAGE_KEY_RE.test(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    out[key] = value;
    count += 1;
  }
  return count ? out : null;
}

function safeLatency(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Build the only shape a trace exporter ever sees.
 * Unknown input fields are ignored.
 */
export function buildRedactedJevTraceRecord(runId, event) {
  return {
    run_id: safeId(runId),
    provider: PROVIDER,
    mode: MODES.has(event?.mode) ? event.mode : null,
    model_requested: safeId(event?.modelRequested),
    model_reported: safeId(event?.modelReported),
    question_set: safeId(event?.questionSetName),
    question_set_sha256: typeof event?.questionSetSha256 === 'string' && SHA256_RE.test(event.questionSetSha256)
      ? event.questionSetSha256
      : null,
    latency_ms: safeLatency(event?.latencyMs),
    usage: safeUsage(event?.usage),
    outcome: event?.outcome === 'ok' || event?.outcome === 'review' ? event.outcome : 'unavailable',
    error_category: safeErrorCategory(event?.errorCategory)
  };
}

export const JEV_TRACE_RECORD_KEYS = Object.freeze(Object.keys(buildRedactedJevTraceRecord('r', {})));

/**
 * @param {{ exporter: (record: object) => void, runId?: string }} options
 */
export function createJevDevTracer({ exporter, runId = randomUUID() } = {}) {
  if (typeof exporter !== 'function') {
    throw new Error('createJevDevTracer requires an exporter function');
  }
  return Object.freeze({
    runId,
    record(event) {
      try {
        exporter(buildRedactedJevTraceRecord(runId, event));
      } catch {
        // Tracing must never change analysis results.
      }
    }
  });
}

/** Local mock exporter: keeps records in memory, sends nothing. */
export function createMemoryTraceExporter() {
  const records = [];
  const exporter = (record) => {
    records.push(record);
  };
  return { exporter, records };
}
