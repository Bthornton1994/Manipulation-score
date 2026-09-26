// Operator-side only. Validates the raw JSON that a pinned Newsjack binary
// prints for `detector run`, `cluster`, and `origin-apply`, then builds the
// whitelist projection media-lens.newsjack-capture.v1. Nothing here runs a
// process, reads files, or touches the network. The worker never imports
// this module.
//
// Every rule encodes an output shape read from the pinned upstream source
// (see NEWSJACK_PIN.reviewed_emitters). Newsjack does not stamp a version
// into these files, so shape drift is caught here and fails closed.

import {
  NEWSJACK_ARGV_TEMPLATE,
  NEWSJACK_BASIS_FIELDS,
  NEWSJACK_CAPTURE_CONTRACT,
  NEWSJACK_CAPTURE_LIMITS,
  NEWSJACK_CONFIDENCE_VALUES,
  NEWSJACK_FRESHNESS_STATUSES,
  NEWSJACK_SAME_STORY_ASSESSMENTS,
  NEWSJACK_SOURCE_KIND_NAMES,
  NEWSJACK_SOURCE_STATUSES,
  canonicalCaptureId,
  isRealDate,
  parseNewsjackClock
} from '../schema/newsjack-capture.js';
import { classifySourceUrl, parseProviderTimestamp } from '../worker/discovery/newsjack-discovery.js';

const HEX16 = /^[a-f0-9]{16}$/;
const CLOCK_SLACK_MS = 2000;

// detector_profile.go defaultProfile().publicDict(). Any other profile means
// client data (company, competitors, spokespeople, exclusions) was loaded.
export const NEWSJACK_DEFAULT_PROFILE = Object.freeze({
  company: null,
  topics: [],
  competitors: [],
  search_terms: [],
  feed_urls: [],
  x_news: { enabled: true },
  x_trends: { mode: 'none', woeids: [], locations: [] },
  spokespeople: [],
  standing: [],
  exclusions: []
});

const DETECTOR_KEYS = ['monitor', 'signals', 'diagnostics', 'source_errors', 'store'];
const MONITOR_KEYS = ['name', 'generated_at', 'profile', 'queries', 'feed_urls', 'sources_requested', 'sources_used', 'lookback_days', 'max_age_hours', 'new_only', 'depth', 'mock'];
const DIAGNOSTICS_KEYS = [
  'evidence_by_source',
  'hygiene_rejections',
  'signals_by_lane',
  'emitted_by_lane',
  'lane_caps',
  'selection',
  'total_scored_signals',
  'total_emitted_signals',
  'source_status'
];
const SIGNAL_KEYS = ['id', 'title', 'sources', 'evidence', 'features', 'story_size', 'routing', 'mechanical_scores', 'query'];
const EVIDENCE_KEYS = ['source', 'title', 'url', 'author', 'container', 'published_at', 'excerpt', 'engagement'];
const SOURCE_STATUS_KEYS = ['requested', 'available', 'attempted', 'evidence_count', 'status'];
const CLUSTER_OUTPUT_KEYS = [
  'version',
  'generated_at',
  'monitor',
  'signals',
  'clustering',
  'clustered_duplicates',
  'pre_gated_stale',
  'coarse_relevance',
  'detector_diagnostics',
  'source_errors'
];
const CLUSTERING_KEYS = [
  'input_signal_count',
  'cluster_count',
  'representative_count',
  'duplicate_count',
  'pre_gated_count',
  'title_overlap',
  'min_shared_tokens',
  'drop_stale',
  'stale_max_band',
  'story_size_bands'
];
const CLUSTER_META_KEYS = ['cluster_id', 'cluster_index', 'cluster_size', 'role', 'member_count', 'member_ids', 'duplicate_count'];
const DUPLICATE_KEYS = ['signal_id', 'signal_title', 'sources', 'routing', 'evidence_urls', 'cluster_id', 'representative_id'];
const ORIGIN_OUTPUT_KEYS = ['version', 'generated_at', 'monitor', 'signals', 'coarse_relevance', 'freshness_gate', 'detector_diagnostics', 'source_errors'];
const FRESHNESS_GATE_SUMMARY_KEYS = [
  'input_signal_count',
  'origin_finding_count',
  'selected_count',
  'rejected_count',
  'missing_count',
  'status_counts',
  'freshness_window_hours',
  'run_generated_at',
  'freshness_cutoff',
  'included_statuses',
  'rejected_signals',
  'missing_signals',
  'deterministic_authority'
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(obj, keys) {
  if (!isPlainObject(obj)) return false;
  const actual = Object.keys(obj);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function keyProblem(obj, keys) {
  if (!isPlainObject(obj)) return 'artifact_shape_invalid';
  for (const key of Object.keys(obj)) if (!keys.includes(key)) return 'unexpected_field';
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(obj, key)) return 'missing_field';
  return null;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function omitKey(obj, key) {
  const { [key]: _omitted, ...rest } = obj;
  return rest;
}

function isStringOrNull(value) {
  return value === null || typeof value === 'string';
}

function withinStep(ms, timing) {
  return ms !== null && ms >= timing.startedMs - CLOCK_SLACK_MS && ms <= timing.exitedMs + CLOCK_SLACK_MS;
}

const invalid = (code, path = '$') => ({ ok: false, code, path });
const valid = { ok: true, code: null, path: null };

/**
 * Validate `detector run` stdout against the request the runner made.
 * @param {unknown} raw parsed JSON
 * @param {{ query: string, depth: string, lookback_days: number, max_age_hours: number, limit: number }} request
 * @param {{ startedMs: number, exitedMs: number }} timing runner observation of the detector step
 * @param {'fixture'|'mock'|'live'} mode
 */
export function validateRawDetectorOutput(raw, request, timing, mode) {
  if (!isPlainObject(raw)) return invalid('artifact_shape_invalid');
  const topProblem = keyProblem(raw, DETECTOR_KEYS);
  if (topProblem) return invalid(topProblem, '$');
  const monitor = raw.monitor;
  const monitorProblem = keyProblem(monitor, MONITOR_KEYS);
  if (monitorProblem) return invalid(monitorProblem, '$.monitor');
  if (monitor.name !== null) return invalid('monitor_name_set', '$.monitor.name');
  if (!deepEqual(monitor.profile, NEWSJACK_DEFAULT_PROFILE)) return invalid('client_profile_present', '$.monitor.profile');
  const requestMatches =
    monitor.new_only === false &&
    monitor.mock === (mode === 'mock') &&
    deepEqual(monitor.queries, [request.query]) &&
    deepEqual(monitor.feed_urls, []) &&
    deepEqual(monitor.sources_requested, ['news_search']) &&
    Array.isArray(monitor.sources_used) &&
    monitor.sources_used.every((source) => source === 'news_search') &&
    monitor.lookback_days === request.lookback_days &&
    monitor.max_age_hours === request.max_age_hours &&
    monitor.depth === request.depth;
  if (!requestMatches) return invalid('request_mismatch', '$.monitor');
  if (!withinStep(parseNewsjackClock(monitor.generated_at), timing)) return invalid('provider_clock_inconsistent', '$.monitor.generated_at');

  if (raw.signals !== null && !Array.isArray(raw.signals)) return invalid('signals_invalid', '$.signals');
  const signals = raw.signals || [];
  if (signals.length > request.limit) return invalid('signals_invalid', '$.signals');
  const ids = new Set();
  for (const [index, signal] of signals.entries()) {
    const path = `$.signals[${index}]`;
    const signalProblem = keyProblem(signal, SIGNAL_KEYS);
    if (signalProblem) return invalid(signalProblem, path);
    if (typeof signal.id !== 'string' || !HEX16.test(signal.id)) return invalid('signal_id_invalid', `${path}.id`);
    if (ids.has(signal.id)) return invalid('signal_id_duplicate', `${path}.id`);
    ids.add(signal.id);
    if (typeof signal.title !== 'string' || signal.query !== request.query) return invalid('signals_invalid', path);
    if (!Array.isArray(signal.evidence) || signal.evidence.length < 1 || signal.evidence.length > NEWSJACK_CAPTURE_LIMITS.evidence_per_signal) {
      return invalid('evidence_invalid', `${path}.evidence`);
    }
    if (!isPlainObject(signal.features) || !Number.isInteger(signal.features.evidence_count) || signal.features.evidence_count < signal.evidence.length) {
      return invalid('evidence_invalid', `${path}.features.evidence_count`);
    }
    for (const [evidenceIndex, evidence] of signal.evidence.entries()) {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      if (!isPlainObject(evidence)) return invalid('evidence_invalid', evidencePath);
      // evidenceItem.publicDict adds metadata only when it is non-empty.
      for (const key of Object.keys(evidence)) {
        if (!EVIDENCE_KEYS.includes(key) && key !== 'metadata') return invalid('unexpected_field', `${evidencePath}.${key}`);
      }
      for (const key of EVIDENCE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(evidence, key)) return invalid('missing_field', `${evidencePath}.${key}`);
      }
      if (evidence.source !== 'news_search') return invalid('unrequested_source_kind', `${evidencePath}.source`);
      const typesOk =
        typeof evidence.title === 'string' &&
        typeof evidence.url === 'string' &&
        typeof evidence.excerpt === 'string' &&
        isStringOrNull(evidence.author) &&
        isStringOrNull(evidence.container) &&
        isStringOrNull(evidence.published_at);
      if (!typesOk) return invalid('evidence_invalid', evidencePath);
    }
  }

  const diagnostics = raw.diagnostics;
  const diagnosticsProblem = keyProblem(diagnostics, DIAGNOSTICS_KEYS);
  if (diagnosticsProblem) return invalid(diagnosticsProblem, '$.diagnostics');
  const status = diagnostics.source_status;
  if (!isPlainObject(status) || !isPlainObject(status.news_search)) return invalid('source_status_invalid', '$.diagnostics.source_status');
  for (const [kind, entry] of Object.entries(status)) {
    const path = `$.diagnostics.source_status.${kind}`;
    if (!NEWSJACK_SOURCE_KIND_NAMES.includes(kind) || !hasExactKeys(entry, SOURCE_STATUS_KEYS)) return invalid('source_status_invalid', path);
    const entryOk =
      typeof entry.requested === 'boolean' &&
      typeof entry.available === 'boolean' &&
      typeof entry.attempted === 'boolean' &&
      Number.isInteger(entry.evidence_count) &&
      entry.evidence_count >= 0 &&
      NEWSJACK_SOURCE_STATUSES.includes(entry.status);
    if (!entryOk) return invalid('source_status_invalid', path);
    if (kind !== 'news_search' && entry.evidence_count > 0) return invalid('unrequested_source_kind', path);
  }
  if (
    !Number.isInteger(diagnostics.total_scored_signals) ||
    diagnostics.total_emitted_signals !== signals.length ||
    diagnostics.total_scored_signals < diagnostics.total_emitted_signals
  ) {
    return invalid('selection_inconsistent', '$.diagnostics');
  }
  if (!isPlainObject(diagnostics.hygiene_rejections) || Object.values(diagnostics.hygiene_rejections).some((count) => !Number.isInteger(count) || count < 0)) {
    return invalid('selection_inconsistent', '$.diagnostics.hygiene_rejections');
  }
  if (!isPlainObject(raw.source_errors) || Object.values(raw.source_errors).some((entry) => !isPlainObject(entry) || Object.values(entry).some((text) => typeof text !== 'string'))) {
    return invalid('source_errors_invalid', '$.source_errors');
  }
  if (!deepEqual(raw.store, { saved: false, run_id: null, path: null })) return invalid('store_saved_unsupported', '$.store');
  return valid;
}

function expectedEvidenceUrls(signal) {
  const urls = signal.evidence.map((item) => item.url).filter((url) => typeof url === 'string' && url !== '');
  return urls.length ? urls.slice(0, 5) : null;
}

/**
 * Validate `cluster` stdout against the detector output it was given.
 */
export function validateRawClusterOutput(raw, candidates, timing) {
  if (!isPlainObject(raw)) return invalid('artifact_shape_invalid');
  const topProblem = keyProblem(raw, CLUSTER_OUTPUT_KEYS);
  if (topProblem) return invalid(topProblem, '$');
  if (raw.version !== 1) return invalid('version_mismatch', '$.version');
  if (!withinStep(parseNewsjackClock(raw.generated_at), timing)) return invalid('stage_time_invalid', '$.generated_at');
  if (!deepEqual(raw.monitor, candidates.monitor) || !deepEqual(raw.source_errors, candidates.source_errors)) {
    return invalid('artifact_binding_mismatch', '$.monitor');
  }
  if (raw.coarse_relevance !== null) return invalid('coarse_decisions_present', '$.coarse_relevance');
  if (!deepEqual(raw.detector_diagnostics, {})) return invalid('artifact_binding_mismatch', '$.detector_diagnostics');
  if (!Array.isArray(raw.pre_gated_stale) || raw.pre_gated_stale.length !== 0) return invalid('drop_stale_unsupported', '$.pre_gated_stale');
  const clustering = raw.clustering;
  if (!hasExactKeys(clustering, CLUSTERING_KEYS)) return invalid('clustering_counts_invalid', '$.clustering');
  if (clustering.drop_stale !== false) return invalid('drop_stale_unsupported', '$.clustering.drop_stale');
  if (clustering.title_overlap !== 0.6 || clustering.min_shared_tokens !== 2) return invalid('cluster_params_mismatch', '$.clustering');
  if (!Array.isArray(raw.signals) || !Array.isArray(raw.clustered_duplicates)) return invalid('artifact_shape_invalid', '$.signals');

  const candidateSignals = candidates.signals || [];
  const byId = new Map(candidateSignals.map((signal) => [signal.id, signal]));
  const countsOk =
    clustering.input_signal_count === candidateSignals.length &&
    clustering.representative_count === raw.signals.length &&
    clustering.cluster_count === raw.signals.length &&
    clustering.duplicate_count === raw.clustered_duplicates.length &&
    clustering.pre_gated_count === 0;
  if (!countsOk) return invalid('clustering_counts_invalid', '$.clustering');

  const placed = new Set();
  const membersOf = new Map();
  for (const [index, representative] of raw.signals.entries()) {
    const path = `$.signals[${index}]`;
    const candidate = isPlainObject(representative) ? byId.get(representative.id) : null;
    if (!candidate || !deepEqual(omitKey(representative, 'cluster'), candidate)) return invalid('representative_mismatch', path);
    const meta = representative.cluster;
    if (!hasExactKeys(meta, CLUSTER_META_KEYS) || meta.cluster_id !== representative.id || meta.role !== 'representative') {
      return invalid('representative_mismatch', `${path}.cluster`);
    }
    const memberIds = meta.member_ids;
    const sorted = Array.isArray(memberIds) && memberIds.every((id, i) => typeof id === 'string' && byId.has(id) && id !== representative.id && (i === 0 || memberIds[i - 1] < id));
    if (
      !sorted ||
      meta.member_count !== memberIds.length ||
      meta.duplicate_count !== memberIds.length ||
      meta.cluster_size !== memberIds.length + 1 ||
      meta.cluster_index !== index
    ) {
      return invalid('representative_mismatch', `${path}.cluster`);
    }
    for (const id of [representative.id, ...memberIds]) {
      if (placed.has(id)) return invalid('group_partition_invalid', path);
      placed.add(id);
    }
    membersOf.set(representative.id, new Set(memberIds));
  }
  for (const [index, duplicate] of raw.clustered_duplicates.entries()) {
    const path = `$.clustered_duplicates[${index}]`;
    if (!hasExactKeys(duplicate, DUPLICATE_KEYS)) return invalid('duplicate_summary_mismatch', path);
    const candidate = byId.get(duplicate.signal_id);
    const owner = membersOf.get(duplicate.representative_id);
    const matches =
      candidate &&
      owner &&
      owner.has(duplicate.signal_id) &&
      duplicate.cluster_id === duplicate.representative_id &&
      duplicate.signal_title === candidate.title &&
      deepEqual(duplicate.sources, candidate.sources) &&
      deepEqual(duplicate.routing, candidate.routing) &&
      deepEqual(duplicate.evidence_urls, expectedEvidenceUrls(candidate));
    if (!matches) return invalid('duplicate_summary_mismatch', path);
  }
  const duplicateCount = [...membersOf.values()].reduce((sum, members) => sum + members.size, 0);
  if (duplicateCount !== raw.clustered_duplicates.length || placed.size !== candidateSignals.length) return invalid('group_partition_invalid', '$');
  return valid;
}

function findingFor(raw, id) {
  const selected = (raw.signals || []).find((signal) => signal.id === id);
  if (selected) return { story_origin: selected.story_origin, freshness_gate: selected.freshness_gate };
  const rejected = (raw.freshness_gate.rejected_signals || []).find((signal) => signal.signal_id === id);
  if (rejected) return { story_origin: rejected.story_origin, freshness_gate: rejected.freshness_gate };
  return null;
}

/**
 * Validate `origin-apply` stdout. Agent-authored content inside story_origin
 * is not trusted here; it is filtered during projection.
 */
export function validateRawOriginOutput(raw, candidates, clustered, request, timing) {
  if (!isPlainObject(raw)) return invalid('artifact_shape_invalid');
  const topProblem = keyProblem(raw, ORIGIN_OUTPUT_KEYS);
  if (topProblem) return invalid(topProblem, '$');
  if (raw.version !== 1) return invalid('version_mismatch', '$.version');
  if (!withinStep(parseNewsjackClock(raw.generated_at), timing)) return invalid('stage_time_invalid', '$.generated_at');
  if (!deepEqual(raw.monitor, candidates.monitor)) return invalid('artifact_binding_mismatch', '$.monitor');
  if (raw.coarse_relevance !== null) return invalid('coarse_decisions_present', '$.coarse_relevance');
  const gate = raw.freshness_gate;
  if (!hasExactKeys(gate, FRESHNESS_GATE_SUMMARY_KEYS)) return invalid('artifact_shape_invalid', '$.freshness_gate');
  if (gate.run_generated_at !== candidates.monitor.generated_at) return invalid('origin_run_time_override', '$.freshness_gate.run_generated_at');
  if (gate.freshness_window_hours !== request.max_age_hours || gate.deterministic_authority !== true) {
    return invalid('origin_window_mismatch', '$.freshness_gate');
  }
  if (gate.input_signal_count !== clustered.signals.length) return invalid('artifact_binding_mismatch', '$.freshness_gate.input_signal_count');
  for (const key of ['rejected_signals', 'missing_signals']) {
    if (gate[key] !== null && !Array.isArray(gate[key])) return invalid('artifact_shape_invalid', `$.freshness_gate.${key}`);
  }
  if (raw.signals !== null && !Array.isArray(raw.signals)) return invalid('artifact_shape_invalid', '$.signals');

  const representatives = new Map(clustered.signals.map((signal) => [signal.id, signal]));
  const seen = new Set();
  const checkGate = (entryGate, path) =>
    isPlainObject(entryGate) &&
    NEWSJACK_FRESHNESS_STATUSES.includes(entryGate.computed_status) &&
    (entryGate.basis_precision === null || entryGate.basis_precision === 'time' || entryGate.basis_precision === 'date') &&
    entryGate.run_generated_at === candidates.monitor.generated_at
      ? null
      : invalid('origin_finding_invalid', path);
  for (const [index, signal] of (raw.signals || []).entries()) {
    const path = `$.signals[${index}]`;
    if (!isPlainObject(signal) || !representatives.has(signal.id) || seen.has(signal.id)) return invalid('origin_finding_invalid', path);
    seen.add(signal.id);
    const problem = checkGate(signal.freshness_gate, `${path}.freshness_gate`);
    if (problem) return problem;
    if (!isPlainObject(signal.story_origin)) return invalid('origin_finding_invalid', `${path}.story_origin`);
    const stripped = omitKey(omitKey(signal, 'story_origin'), 'freshness_gate');
    if (!deepEqual(stripped, representatives.get(signal.id))) return invalid('origin_signal_mismatch', path);
  }
  for (const [index, entry] of (gate.rejected_signals || []).entries()) {
    const path = `$.freshness_gate.rejected_signals[${index}]`;
    if (!isPlainObject(entry) || !representatives.has(entry.signal_id) || seen.has(entry.signal_id)) return invalid('origin_finding_invalid', path);
    seen.add(entry.signal_id);
    const problem = checkGate(entry.freshness_gate, `${path}.freshness_gate`);
    if (problem) return problem;
    if (!isPlainObject(entry.story_origin)) return invalid('origin_finding_invalid', `${path}.story_origin`);
  }
  return valid;
}

/** Reduce raw source error text to a class. The text itself is dropped. */
export function classifySourceError(text) {
  const value = String(text || '');
  if (/timeout|deadline exceeded|timed out/i.test(value)) return 'timeout';
  if (/no such host|lookup |dns/i.test(value)) return 'dns';
  if (/tls|x509|certificate/i.test(value)) return 'tls';
  if (/connection refused|econnrefused/i.test(value)) return 'refused';
  if (/\bHTTP\s*\d{3}\b|status(?: code)?\s*\d{3}|\b[45]\d{2}\b/i.test(value)) return 'http_status';
  if (/parse|unmarshal|invalid character|unexpected end|syntax/i.test(value)) return 'parse';
  return 'other';
}

// news_search uses the snippet as the title when the provider gives none,
// and excerpts are cut at 500 bytes (possibly mid-character, which JSON
// encodes as U+FFFD). Such a title is a copied snippet, not a headline.
export function isTitleFromExcerpt(title, excerpt) {
  if (typeof title !== 'string' || typeof excerpt !== 'string') return false;
  const cleanTitle = title.trim();
  if (!cleanTitle) return false;
  if (cleanTitle === excerpt.trim()) return true;
  const prefix = excerpt.replace(/[�\s]+$/u, '');
  return Buffer.byteLength(prefix, 'utf8') >= 60 && cleanTitle.startsWith(prefix);
}

// Cut to at most `max` UTF-16 units without splitting a character.
function truncateUtf16(value, max) {
  if (value.length <= max) return value;
  let out = '';
  for (const char of value) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}

function floorToMsIso(value) {
  const ms = parseNewsjackClock(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function projectEvidence(item) {
  const titleFromExcerpt = isTitleFromExcerpt(item.title, item.excerpt);
  return {
    source: item.source,
    // A copied snippet is excerpt text, so it is not written.
    title: titleFromExcerpt ? '' : truncateUtf16(item.title, NEWSJACK_CAPTURE_LIMITS.title_chars),
    url: item.url.length <= NEWSJACK_CAPTURE_LIMITS.url_chars ? item.url : '',
    // Over-long names and times are dropped, not cut: cutting could turn a
    // refused value into an accepted one.
    container: item.container === null || item.container.length > NEWSJACK_CAPTURE_LIMITS.container_chars ? null : item.container,
    published_at:
      item.published_at === null || item.published_at.length > NEWSJACK_CAPTURE_LIMITS.published_at_chars ? null : item.published_at,
    title_from_excerpt: titleFromExcerpt
  };
}

function publicCitation(value) {
  if (typeof value !== 'string' || value.trim() === '') return { url: null, withheld: false };
  const classified = classifySourceUrl(value);
  // Search-result URLs carry the agent's query terms, which can name a
  // client. A citation with any query string is withheld.
  if (!classified.url || new URL(classified.url).search !== '') return { url: null, withheld: true };
  return { url: classified.url, withheld: false };
}

function projectClaim(clusterId, finding) {
  const origin = finding.story_origin;
  const gate = finding.freshness_gate;
  const withheld = { urls: 0, invalid_values: 0, timestamp_evidence_truncated: 0 };
  const pickEnum = (value, allowed) => {
    if (value === undefined || value === null || value === '') return null;
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (allowed.includes(normalized)) return normalized;
    withheld.invalid_values += 1;
    return null;
  };
  // The story-origin skill allows a date without a time when only the date
  // is known; origin-apply handles that precision itself. Keep it labeled.
  const originTime = (value) => {
    if (value === undefined || value === null || value === '') return { value: null, precision: null, ok: true };
    if (typeof value === 'string' && isRealDate(value)) return { value, precision: 'date', ok: true };
    const parsed = parseProviderTimestamp(value);
    return parsed.value ? { value: parsed.value, precision: 'time', ok: true } : { value: null, precision: null, ok: false };
  };
  const first = originTime(origin.first_public_at);
  if (!first.ok) withheld.invalid_values += 1;
  const original = publicCitation(origin.original_url);
  if (original.withheld) withheld.urls += 1;
  const timestampEvidence = [];
  for (const entry of Array.isArray(origin.timestamp_evidence) ? origin.timestamp_evidence : []) {
    if (!isPlainObject(entry)) {
      withheld.invalid_values += 1;
      continue;
    }
    const citation = publicCitation(entry.url);
    const published = originTime(entry.published_at);
    if (!citation.url) {
      withheld.urls += 1;
      continue;
    }
    if (!published.ok) withheld.invalid_values += 1;
    if (timestampEvidence.length >= NEWSJACK_CAPTURE_LIMITS.timestamp_evidence_per_claim) {
      withheld.timestamp_evidence_truncated += 1;
      continue;
    }
    timestampEvidence.push({ url: citation.url, published_at: published.value, precision: published.precision });
  }
  const basisField = NEWSJACK_BASIS_FIELDS.includes(gate.basis_field) ? gate.basis_field : null;
  return {
    cluster_id: clusterId,
    same_story_assessment: pickEnum(origin.same_story_assessment, NEWSJACK_SAME_STORY_ASSESSMENTS),
    first_public_at: first.value,
    first_public_at_precision: first.precision,
    original_url: original.url,
    timestamp_evidence: timestampEvidence,
    confidence: pickEnum(origin.confidence, NEWSJACK_CONFIDENCE_VALUES),
    freshness_status: gate.computed_status,
    freshness_basis_field: basisField,
    freshness_basis_precision: gate.basis_precision === 'time' || gate.basis_precision === 'date' ? gate.basis_precision : null,
    freshness_window: {
      start: floorToMsIso(gate.freshness_cutoff),
      end: floorToMsIso(gate.run_generated_at),
      hours: gate.freshness_window_hours
    },
    detector_timestamp_fallback: gate.detector_timestamp_fallback === true,
    withheld
  };
}

/**
 * Build a media-lens.newsjack-capture.v1 record from validated raw output.
 * Only whitelisted fields are copied; everything else is dropped here.
 */
export function projectCapture({ request, pin, binarySha256, mode, steps, candidates, clustered, targeted = null, findingsSha256 = null }) {
  const signals = candidates.signals || [];
  const diagnostics = candidates.diagnostics;
  const sources = {};
  for (const [kind, entry] of Object.entries(diagnostics.source_status)) {
    let errorText = null;
    for (const key of Object.keys(candidates.source_errors).sort()) {
      const perSource = candidates.source_errors[key];
      if (Object.prototype.hasOwnProperty.call(perSource, kind)) {
        errorText = perSource[kind];
        break;
      }
    }
    sources[kind] = {
      requested: entry.requested,
      available: entry.available,
      attempted: entry.attempted,
      evidence_count: entry.evidence_count,
      status: entry.status,
      error_class: errorText === null ? null : classifySourceError(errorText)
    };
  }
  const groups = clustered.signals.map((representative) => ({
    cluster_id: representative.id,
    signal_ids: [representative.id, ...representative.cluster.member_ids]
  }));
  let origin = null;
  if (targeted) {
    const claims = [];
    for (const group of groups) {
      const finding = findingFor(targeted, group.cluster_id);
      if (finding) claims.push(projectClaim(group.cluster_id, finding));
    }
    origin = { claims };
  }
  const capture = {
    contract: NEWSJACK_CAPTURE_CONTRACT,
    capture_id: null,
    newsjack: { version: pin.version, commit: pin.commit, binary_sha256: binarySha256 },
    runner: { mode, argv_template: NEWSJACK_ARGV_TEMPLATE },
    request: {
      query: request.query,
      sources: ['news_search'],
      depth: request.depth,
      lookback_days: request.lookback_days,
      max_age_hours: request.max_age_hours,
      limit: request.limit,
      origin_findings_sha256: findingsSha256
    },
    process: { steps: steps.map((step) => ({ ...step })) },
    monitor: { generated_at: candidates.monitor.generated_at },
    selection: {
      total_scored_signals: diagnostics.total_scored_signals,
      total_emitted_signals: diagnostics.total_emitted_signals,
      signals_not_emitted: diagnostics.total_scored_signals - diagnostics.total_emitted_signals,
      hygiene_rejected_total: Object.values(diagnostics.hygiene_rejections).reduce((sum, count) => sum + count, 0),
      evidence_truncated: signals.reduce((sum, signal) => sum + (signal.features.evidence_count - signal.evidence.length), 0),
      limit: request.limit
    },
    sources,
    signals: signals.map((signal) => ({ id: signal.id, evidence: signal.evidence.map(projectEvidence) })),
    clustering: { title_overlap: 0.6, min_shared_tokens: 2, groups },
    origin
  };
  capture.capture_id = canonicalCaptureId(capture);
  return capture;
}
