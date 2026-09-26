// media-lens.newsjack-capture.v1: the repository-owned record of one
// Newsjack run made by the operator tool in media-lens/tools/. It is a
// whitelist projection of Newsjack's own output plus the runner's
// observations of the process. Every level is strict: unknown keys are
// refused, so client-profile data, excerpts, authors, raw error text, or
// agent rationale can never ride along.
//
// Pure: no network, no environment, no filesystem.

import { createHash } from 'node:crypto';
import { NEWSJACK_PIN, recordedBinaryHashes } from '../worker/discovery/newsjack-pin.js';

export const NEWSJACK_CAPTURE_CONTRACT = 'media-lens.newsjack-capture.v1';
export const NEWSJACK_ARGV_TEMPLATE = 'media-lens.newsjack-argv.v1';
export const NEWSJACK_CAPTURE_MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const NEWSJACK_CAPTURE_LIMITS = Object.freeze({
  signals: 50,
  evidence_per_signal: 8,
  timestamp_evidence_per_claim: 10,
  title_chars: 1000,
  url_chars: 2048,
  container_chars: 300,
  published_at_chars: 64
});

export const NEWSJACK_SOURCE_KIND_NAMES = Object.freeze(['news_search', 'x_news', 'x', 'x_trends', 'major_feed', 'reddit', 'hackernews']);
export const NEWSJACK_SOURCE_STATUSES = Object.freeze(['used', 'no_results', 'unavailable', 'error', 'partial_error', 'not_requested']);
export const NEWSJACK_ERROR_CLASSES = Object.freeze(['timeout', 'dns', 'tls', 'http_status', 'refused', 'parse', 'other']);
export const NEWSJACK_FRESHNESS_STATUSES = Object.freeze([
  'fresh',
  'fresh_new_development',
  'stale',
  'unverified_boundary',
  'unverified_no_timestamp',
  'unverified_no_corroboration'
]);
export const NEWSJACK_SAME_STORY_ASSESSMENTS = Object.freeze(['same_story', 'different_story', 'unclear', 'fresh_new_development']);
export const NEWSJACK_CONFIDENCE_VALUES = Object.freeze(['low', 'medium', 'high']);
export const NEWSJACK_BASIS_FIELDS = Object.freeze([
  'first_public_at',
  'new_development_at',
  'surfaced_article_published_at',
  'canonical_coverage_published_at',
  'timestamp_evidence.published_at',
  'evidence.published_at'
]);
export const NEWSJACK_RUNNER_MODES = Object.freeze(['fixture', 'mock', 'live']);
export const NEWSJACK_STEPS = Object.freeze(['version', 'detector_run', 'cluster', 'origin_apply']);

const HEX16 = /^[a-f0-9]{16}$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const STRICT_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RFC3339_NANO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const CLOCK_SLACK_MS = 2000;

// Strict millisecond UTC time that survives a round trip (no rollover).
export function isStrictUtcMs(value) {
  if (typeof value !== 'string' || !STRICT_UTC_MS.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

// Newsjack's own RFC3339Nano UTC clock string, checked for a real date.
export function parseNewsjackClock(value) {
  if (typeof value !== 'string' || !RFC3339_NANO_UTC.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  if (new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return ms;
}

// A capture query is an operator-typed public topic. It must not look like
// a person's contact detail, an identifier, a URL, or a command-line flag.
export function checkNewsjackQuery(value) {
  if (typeof value !== 'string') return { ok: false, query: null };
  const query = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const tokens = query.split(' ').filter(Boolean);
  const refused =
    query.length < 3 ||
    query.length > 120 ||
    tokens.length > 12 ||
    /[\p{Cc}\p{Cf}]/u.test(value) ||
    query.startsWith('-') ||
    query.includes('@') ||
    query.includes('://') ||
    /(^|\s)www\./i.test(query) ||
    /\d{6,}/.test(query);
  return refused ? { ok: false, query: null } : { ok: true, query };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalCaptureId(capture) {
  const { capture_id: _ignored, ...rest } = capture || {};
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isHttpsNoQuery(value) {
  if (typeof value !== 'string' || value.length > NEWSJACK_CAPTURE_LIMITS.url_chars) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.search === '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function isNullableString(value, max) {
  return value === null || (typeof value === 'string' && value.length <= max);
}

/**
 * @param {unknown} value
 * @param {{ pin?: object }} [options]
 * @returns {{ ok: boolean, errors: Array<{ code: string, path: string }> }}
 */
export function validateNewsjackCapture(value, { pin = NEWSJACK_PIN } = {}) {
  const errors = [];
  const fail = (code, path) => {
    errors.push({ code, path });
    return false;
  };
  const exactKeys = (obj, keys, path, optional = []) => {
    if (!isPlainObject(obj)) return fail('missing_field', path);
    let ok = true;
    for (const key of Object.keys(obj)) {
      if (!keys.includes(key) && !optional.includes(key)) ok = fail(`unknown_field`, `${path}.${key}`);
    }
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) ok = fail('missing_field', `${path}.${key}`);
    }
    return ok;
  };

  if (!isPlainObject(value)) {
    fail('capture_not_object', '$');
    return { ok: false, errors };
  }
  if (value.contract !== NEWSJACK_CAPTURE_CONTRACT) {
    fail('contract_mismatch', '$.contract');
    return { ok: false, errors };
  }
  const topKeys = ['contract', 'capture_id', 'newsjack', 'runner', 'request', 'process', 'monitor', 'selection', 'sources', 'signals', 'clustering', 'origin'];
  if (!exactKeys(value, topKeys, '$')) return { ok: false, errors };

  if (typeof value.capture_id !== 'string' || !HEX64.test(value.capture_id) || canonicalCaptureId(value) !== value.capture_id) {
    fail('capture_id_mismatch', '$.capture_id');
  }

  // Tool identity and pin.
  const newsjack = value.newsjack;
  if (exactKeys(newsjack, ['version', 'commit', 'binary_sha256'], '$.newsjack')) {
    if (newsjack.version !== pin.version || newsjack.commit !== pin.commit || !HEX40.test(String(newsjack.commit))) {
      fail('pin_mismatch', '$.newsjack');
    }
  }
  const runner = value.runner;
  if (exactKeys(runner, ['mode', 'argv_template'], '$.runner')) {
    if (!NEWSJACK_RUNNER_MODES.includes(runner.mode)) fail('runner_mode_invalid', '$.runner.mode');
    if (runner.argv_template !== NEWSJACK_ARGV_TEMPLATE) fail('argv_template_mismatch', '$.runner.argv_template');
    if (isPlainObject(newsjack)) {
      const hash = newsjack.binary_sha256;
      if (runner.mode === 'fixture') {
        if (hash !== null) fail('binary_hash_unexpected', '$.newsjack.binary_sha256');
      } else if (typeof hash !== 'string' || !HEX64.test(hash) || !recordedBinaryHashes(pin).includes(hash)) {
        fail('binary_hash_unrecorded', '$.newsjack.binary_sha256');
      }
    }
  }

  // Request.
  const request = value.request;
  if (exactKeys(request, ['query', 'sources', 'depth', 'lookback_days', 'max_age_hours', 'limit', 'origin_findings_sha256'], '$.request')) {
    const policy = checkNewsjackQuery(request.query);
    if (!policy.ok || policy.query !== request.query) fail('query_policy_violation', '$.request.query');
    if (!Array.isArray(request.sources) || request.sources.length !== 1 || request.sources[0] !== 'news_search') {
      fail('request_sources_invalid', '$.request.sources');
    }
    if (request.depth !== 'quick' && request.depth !== 'default') fail('depth_invalid', '$.request.depth');
    if (!isInt(request.lookback_days, 1, 7)) fail('lookback_invalid', '$.request.lookback_days');
    if (!isInt(request.max_age_hours, 1, 48)) fail('max_age_invalid', '$.request.max_age_hours');
    if (!isInt(request.limit, 1, NEWSJACK_CAPTURE_LIMITS.signals)) fail('limit_invalid', '$.request.limit');
    if (request.origin_findings_sha256 !== null && !(typeof request.origin_findings_sha256 === 'string' && HEX64.test(request.origin_findings_sha256))) {
      fail('origin_findings_hash_invalid', '$.request.origin_findings_sha256');
    }
  }

  // Process timeline observed by the runner.
  const processSteps = value.process;
  let detectorStep = null;
  if (exactKeys(processSteps, ['steps'], '$.process')) {
    const steps = Array.isArray(processSteps.steps) ? processSteps.steps : null;
    if (!steps) {
      fail('process_incomplete', '$.process.steps');
    } else {
      const expected = ['version', 'detector_run', 'cluster'];
      if (isPlainObject(request) && request.origin_findings_sha256 !== null) expected.push('origin_apply');
      if (steps.length !== expected.length || steps.some((step, index) => !isPlainObject(step) || step.step !== expected[index])) {
        fail('process_order_invalid', '$.process.steps');
      } else {
        let previousExit = -Infinity;
        steps.forEach((step, index) => {
          const path = `$.process.steps[${index}]`;
          if (!exactKeys(step, ['step', 'started_at', 'exited_at', 'exit_code', 'timed_out', 'stdout_bytes', 'stderr_bytes'], path)) return;
          if (step.exit_code !== 0 || step.timed_out !== false) fail('process_incomplete', path);
          if (!isStrictUtcMs(step.started_at) || !isStrictUtcMs(step.exited_at)) {
            fail('time_invalid', path);
            return;
          }
          const started = Date.parse(step.started_at);
          const exited = Date.parse(step.exited_at);
          if (started > exited || started < previousExit) fail('process_order_invalid', path);
          previousExit = exited;
          if (!isInt(step.stdout_bytes, 0, Number.MAX_SAFE_INTEGER) || !isInt(step.stderr_bytes, 0, Number.MAX_SAFE_INTEGER)) fail('process_incomplete', path);
          if (step.step === 'detector_run') detectorStep = { started, exited };
        });
      }
    }
  }

  // Newsjack's clock at detector start must fall inside the observed step.
  if (exactKeys(value.monitor, ['generated_at'], '$.monitor')) {
    const generated = parseNewsjackClock(value.monitor.generated_at);
    if (generated === null) {
      fail('time_invalid', '$.monitor.generated_at');
    } else if (detectorStep && (generated < detectorStep.started - CLOCK_SLACK_MS || generated > detectorStep.exited + CLOCK_SLACK_MS)) {
      fail('run_time_inconsistent', '$.monitor.generated_at');
    }
  }

  // Signals and evidence.
  const signalIds = new Set();
  if (!Array.isArray(value.signals) || value.signals.length > NEWSJACK_CAPTURE_LIMITS.signals) {
    fail('signals_invalid', '$.signals');
  } else {
    value.signals.forEach((signal, index) => {
      const path = `$.signals[${index}]`;
      if (!exactKeys(signal, ['id', 'evidence'], path)) return;
      if (typeof signal.id !== 'string' || !HEX16.test(signal.id) || signalIds.has(signal.id)) fail('signals_invalid', `${path}.id`);
      signalIds.add(signal.id);
      if (!Array.isArray(signal.evidence) || signal.evidence.length < 1 || signal.evidence.length > NEWSJACK_CAPTURE_LIMITS.evidence_per_signal) {
        fail('evidence_invalid', `${path}.evidence`);
        return;
      }
      signal.evidence.forEach((evidence, evidenceIndex) => {
        const evidencePath = `${path}.evidence[${evidenceIndex}]`;
        if (!exactKeys(evidence, ['source', 'title', 'url', 'container', 'published_at', 'title_from_excerpt'], evidencePath)) return;
        const valid =
          NEWSJACK_SOURCE_KIND_NAMES.includes(evidence.source) &&
          typeof evidence.title === 'string' &&
          evidence.title.length <= NEWSJACK_CAPTURE_LIMITS.title_chars &&
          typeof evidence.url === 'string' &&
          evidence.url.length <= NEWSJACK_CAPTURE_LIMITS.url_chars &&
          isNullableString(evidence.container, NEWSJACK_CAPTURE_LIMITS.container_chars) &&
          isNullableString(evidence.published_at, NEWSJACK_CAPTURE_LIMITS.published_at_chars) &&
          typeof evidence.title_from_excerpt === 'boolean';
        if (!valid) fail('evidence_invalid', evidencePath);
      });
    });
  }

  // Selection counts disclose Newsjack's top-N and evidence caps.
  const selection = value.selection;
  if (exactKeys(selection, ['total_scored_signals', 'total_emitted_signals', 'signals_not_emitted', 'hygiene_rejected_total', 'evidence_truncated', 'limit'], '$.selection')) {
    const counts = ['total_scored_signals', 'total_emitted_signals', 'signals_not_emitted', 'hygiene_rejected_total', 'evidence_truncated'];
    if (counts.some((key) => !isInt(selection[key], 0, Number.MAX_SAFE_INTEGER))) {
      fail('selection_invalid', '$.selection');
    } else if (
      (Array.isArray(value.signals) && selection.total_emitted_signals !== value.signals.length) ||
      selection.total_scored_signals < selection.total_emitted_signals ||
      selection.signals_not_emitted !== selection.total_scored_signals - selection.total_emitted_signals ||
      (isPlainObject(request) && selection.limit !== request.limit)
    ) {
      fail('selection_invalid', '$.selection');
    }
  }

  // Per-source status.
  const sources = value.sources;
  if (!isPlainObject(sources) || !Object.prototype.hasOwnProperty.call(sources, 'news_search')) {
    fail('source_status_invalid', '$.sources');
  } else {
    for (const [kind, entry] of Object.entries(sources)) {
      const path = `$.sources.${kind}`;
      if (!NEWSJACK_SOURCE_KIND_NAMES.includes(kind)) {
        fail('source_status_invalid', path);
        continue;
      }
      if (!exactKeys(entry, ['requested', 'available', 'attempted', 'evidence_count', 'status', 'error_class'], path)) continue;
      if (
        typeof entry.requested !== 'boolean' ||
        typeof entry.available !== 'boolean' ||
        typeof entry.attempted !== 'boolean' ||
        !isInt(entry.evidence_count, 0, Number.MAX_SAFE_INTEGER) ||
        !NEWSJACK_SOURCE_STATUSES.includes(entry.status)
      ) {
        fail('source_status_invalid', path);
      }
      if (entry.error_class !== null && !NEWSJACK_ERROR_CLASSES.includes(entry.error_class)) fail('error_class_invalid', `${path}.error_class`);
    }
  }

  // Clustering groups must partition the signal ids, representative first.
  const clustering = value.clustering;
  const representatives = new Set();
  if (exactKeys(clustering, ['title_overlap', 'min_shared_tokens', 'groups'], '$.clustering')) {
    if (clustering.title_overlap !== 0.6 || clustering.min_shared_tokens !== 2) fail('clustering_inconsistent', '$.clustering');
    if (!Array.isArray(clustering.groups)) {
      fail('clustering_inconsistent', '$.clustering.groups');
    } else {
      const seen = new Set();
      clustering.groups.forEach((group, index) => {
        const path = `$.clustering.groups[${index}]`;
        if (!exactKeys(group, ['cluster_id', 'signal_ids'], path)) return;
        if (!Array.isArray(group.signal_ids) || group.signal_ids.length === 0 || group.signal_ids[0] !== group.cluster_id) {
          fail('clustering_inconsistent', path);
          return;
        }
        representatives.add(group.cluster_id);
        for (const id of group.signal_ids) {
          if (!signalIds.has(id) || seen.has(id)) fail('clustering_inconsistent', path);
          seen.add(id);
        }
      });
      if (seen.size !== signalIds.size) fail('clustering_inconsistent', '$.clustering.groups');
    }
  }

  // Unverified agent origin claims, present only with origin findings.
  const origin = value.origin;
  const wantsOrigin = isPlainObject(request) && request.origin_findings_sha256 !== null;
  if (origin === null) {
    if (wantsOrigin) fail('origin_invalid', '$.origin');
  } else if (!wantsOrigin) {
    fail('origin_invalid', '$.origin');
  } else if (exactKeys(origin, ['claims'], '$.origin')) {
    if (!Array.isArray(origin.claims)) {
      fail('origin_invalid', '$.origin.claims');
    } else {
      const claimed = new Set();
      origin.claims.forEach((claim, index) => {
        const path = `$.origin.claims[${index}]`;
        const keys = [
          'cluster_id',
          'same_story_assessment',
          'first_public_at',
          'original_url',
          'timestamp_evidence',
          'confidence',
          'freshness_status',
          'freshness_basis_field',
          'freshness_basis_precision',
          'freshness_window',
          'detector_timestamp_fallback',
          'withheld'
        ];
        if (!exactKeys(claim, keys, path)) return;
        if (!representatives.has(claim.cluster_id) || claimed.has(claim.cluster_id)) fail('origin_invalid', `${path}.cluster_id`);
        claimed.add(claim.cluster_id);
        const enumsOk =
          (claim.same_story_assessment === null || NEWSJACK_SAME_STORY_ASSESSMENTS.includes(claim.same_story_assessment)) &&
          (claim.confidence === null || NEWSJACK_CONFIDENCE_VALUES.includes(claim.confidence)) &&
          NEWSJACK_FRESHNESS_STATUSES.includes(claim.freshness_status) &&
          (claim.freshness_basis_field === null || NEWSJACK_BASIS_FIELDS.includes(claim.freshness_basis_field)) &&
          (claim.freshness_basis_precision === null || claim.freshness_basis_precision === 'time' || claim.freshness_basis_precision === 'date') &&
          typeof claim.detector_timestamp_fallback === 'boolean';
        if (!enumsOk) fail('origin_invalid', path);
        if (claim.first_public_at !== null && !isStrictUtcMs(claim.first_public_at)) fail('origin_invalid', `${path}.first_public_at`);
        if (claim.original_url !== null && !isHttpsNoQuery(claim.original_url)) fail('origin_invalid', `${path}.original_url`);
        if (!Array.isArray(claim.timestamp_evidence) || claim.timestamp_evidence.length > NEWSJACK_CAPTURE_LIMITS.timestamp_evidence_per_claim) {
          fail('origin_invalid', `${path}.timestamp_evidence`);
        } else {
          claim.timestamp_evidence.forEach((entry, entryIndex) => {
            const entryPath = `${path}.timestamp_evidence[${entryIndex}]`;
            if (!exactKeys(entry, ['url', 'published_at'], entryPath)) return;
            if (!isHttpsNoQuery(entry.url) || !isStrictUtcMs(entry.published_at)) fail('origin_invalid', entryPath);
          });
        }
        if (exactKeys(claim.freshness_window, ['start', 'end', 'hours'], `${path}.freshness_window`)) {
          const window = claim.freshness_window;
          if (!isStrictUtcMs(window.start) || !isStrictUtcMs(window.end) || !isInt(window.hours, 1, 48) || window.start > window.end) {
            fail('origin_invalid', `${path}.freshness_window`);
          }
        }
        if (exactKeys(claim.withheld, ['urls', 'invalid_values', 'timestamp_evidence_truncated'], `${path}.withheld`)) {
          if (['urls', 'invalid_values', 'timestamp_evidence_truncated'].some((key) => !isInt(claim.withheld[key], 0, Number.MAX_SAFE_INTEGER))) {
            fail('origin_invalid', `${path}.withheld`);
          }
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
