// Structured, redacted operational audit lines for Media Lens.
//
// Never log TypeSafe keys, Authorization, cookies, article/span/prepared
// text, query strings, userinfo, or full URLs with path+query. Callers must
// pass already-safe fields; this module also drops unknown keys and values
// that look like secrets or credentialed URLs.

export const AUDIT_EVENTS = Object.freeze({
  LIVE_URL_BLOCKED: 'live_url_blocked',
  SSRF_BLOCK: 'ssrf_block',
  KILL_SWITCH: 'kill_switch',
  RATE_LIMIT: 'rate_limit',
  ANALYZE_COMPLETE: 'analyze_complete',
  CLASSIFIER_DEV_CASCADE: 'classifier_dev_cascade'
});

const ALLOWED_EVENTS = new Set(Object.values(AUDIT_EVENTS));

const ALLOWED_KEYS = new Set([
  'ts',
  'event',
  'mode',
  'input_mode',
  'error',
  'reason',
  'scheme',
  'host_key',
  'host_kind',
  'pinned_family',
  'duration_ms',
  'byte_length',
  'hop_count',
  'jev_calls',
  'jev_failures',
  'model_match',
  'kill_switch',
  'limiter',
  'live_enabled',
  'live_url_enabled',
  'status',
  'retries',
  'abstention_reason',
  'abstention_count',
  'allowlist_configured',
  'classifier_dev_enabled',
  'cdev_calls',
  'cdev_classifications',
  'cdev_status',
  'cdev_model',
  'escalated_span_count',
  'circuit_open',
  'span_id',
  'escalate_reason',
  'disposition',
  'calibrated',
  'jev_choice',
  'jev_confidence',
  'cdev_label',
  'cdev_confidence',
  'cdev_reason',
  'taxonomy_version',
  'policy_version'
]);

const SECRET_VALUE =
  /sk-[A-Za-z0-9]{8,}|Bearer\s+\S+|Authorization\s*[:=]|[a-z]+:\/\/[^/\s]+:[^@/\s]+@/i;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueLooksUnsafe(value) {
  if (typeof value !== 'string') return false;
  if (SECRET_VALUE.test(value)) return true;
  if (/[?&](token|key|password|secret|auth)=/i.test(value)) return true;
  return false;
}

export function redactAuditRecord(record) {
  if (!isPlainObject(record)) return { event: 'dropped' };
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (value === undefined) continue;
    if (typeof value === 'string') {
      if (valueLooksUnsafe(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  if (!ALLOWED_EVENTS.has(out.event)) {
    return { ts: out.ts || new Date().toISOString(), event: 'dropped' };
  }
  return out;
}

export function createAuditLogger({ write } = {}) {
  const sink =
    typeof write === 'function'
      ? write
      : (line) => {
          process.stderr.write(`${line}\n`);
        };

  return {
    emit(event, fields = {}) {
      const record = redactAuditRecord({
        ts: new Date().toISOString(),
        event,
        ...fields
      });
      sink(JSON.stringify(record));
    }
  };
}
