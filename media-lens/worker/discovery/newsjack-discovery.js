// Convert a validated Newsjack capture (media-lens.newsjack-capture.v1) into
// story-discovery.v1. Pure and synchronous: no network, no child process,
// no environment, and no clock except the `now` the caller passes in.
//
// A capture is produced only by the operator tool in media-lens/tools/,
// which runs a pinned Newsjack binary outside the worker. The worker never
// imports that tool, never spawns Newsjack, and no route serves captures.
//
// Newsjack is a separate MIT-licensed project
// (https://github.com/elvisun/newsjack). This file shares no code with it.
// See docs/NEWSJACK-LICENSE.md and media-lens/docs/newsjack-discovery.md.

import { parseArticleUrl } from '../address-policy.js';
import { isPartnerRepublicationHost, isWireOrAdvocacyUrl } from '../fusion.js';
import { normalizedURLKey } from '../url-key.js';
import {
  NEWSJACK_CAPTURE_CONTRACT,
  NEWSJACK_CAPTURE_MAX_TEXT_BYTES,
  validateNewsjackCapture
} from '../../schema/newsjack-capture.js';
import { FRAME_NOTE, OMISSION_NOTE, SAME_STORY_NOT_INDEPENDENT } from './cluster.js';
import { NEWSJACK_PIN } from './newsjack-pin.js';
import { SEARCH_PROVIDER_MODE_STATUS } from './search-provider.js';

export const NEWSJACK_CLUSTER_BASIS = 'newsjack_cluster_shared_url_or_title_overlap';
export const NEWSJACK_MEMBER_BASIS = 'newsjack_cluster_member';
export const NEWSJACK_WINDOW_BASIS = 'media_lens_published_at_filter_from_max_age_hours';
export const NEWSJACK_RETRIEVED_AT_BASIS = 'runner_observed_detector_exit_upper_bound';
export const NEWSJACK_ORIGIN_NOTE =
  "Written by an AI agent following Newsjack's story-origin-check skill. Newsjack checked the finding's structure and computed the freshness status from the agent's timestamps. Nobody verified the timestamps or URLs. This is not independent reporting and does not change the cluster.";
export const NEWSJACK_INDEPENDENCE_NOTE =
  'Newsjack groups headlines by shared URLs or title words. That is not evidence of independent reporting, so no member is labeled independent.';

// Which Newsjack evidence kinds may become story members. Only Medialyst
// news_search returns publisher articles. Feeds are served by the approved
// feed client in discover.js instead, and forum, social, and trend kinds are
// not outlet articles.
export const NEWSJACK_SOURCE_KINDS = Object.freeze({
  news_search: Object.freeze({ member_eligible: true, live_search_provider_mode: 'medialyst' }),
  major_feed: Object.freeze({ member_eligible: false, reason: 'served_by_approved_feed_client' }),
  reddit: Object.freeze({ member_eligible: false, reason: 'forum_not_outlet' }),
  hackernews: Object.freeze({ member_eligible: false, reason: 'forum_not_outlet' }),
  x: Object.freeze({ member_eligible: false, reason: 'social_post_not_outlet' }),
  x_news: Object.freeze({ member_eligible: false, reason: 'synthetic_search_url' }),
  x_trends: Object.freeze({ member_eligible: false, reason: 'fetch_time_as_published_at' })
});

export const NEWSJACK_MEMBER_REJECTIONS = Object.freeze([
  'incomplete',
  'non_https_url',
  'non_public_url',
  'duplicate_url',
  'title_from_excerpt',
  'source_kind_excluded',
  'published_at_missing',
  'published_at_date_only',
  'published_at_precision',
  'published_at_unparseable',
  'published_at_rolled',
  'published_at_after_retrieval',
  'outside_window'
]);
const MAX_REJECTED_MEMBERS_LISTED = 200;
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

// Names that point at private networks, metadata services, or special-use
// namespaces. parseArticleUrl already refuses loopback and the exact
// metadata hostnames, *.local, *.localhost, single-label hosts, and every
// non-public IP literal (including exotic IPv4 forms). These suffixes cover
// the rest (for example instance-data.ec2.internal or printer.home.arpa).
// .example stays allowed because it is documentation-only and the fixtures
// use it. The last group is well-known wildcard DNS names that resolve to
// loopback or private addresses, plus a cloud metadata hostname that
// parseArticleUrl does not list. Other names that happen to resolve to a
// private address cannot be detected without DNS; nothing here fetches them.
export const NON_PUBLIC_HOST_SUFFIXES = Object.freeze([
  '.internal',
  '.arpa',
  '.localdomain',
  '.lan',
  '.intranet',
  '.corp',
  '.private',
  '.home',
  '.svc',
  '.alt',
  '.test',
  '.invalid',
  '.onion',
  '.consul',
  '.default',
  '.nip.io',
  '.sslip.io',
  '.xip.io',
  '.localtest.me',
  '.lvh.me',
  '.traefik.me',
  '.backname.io',
  '.1u.ms',
  '.rbndr.us',
  '.vcap.me',
  '.local.gd',
  '.localhost.direct',
  '.metadata.tencentyun.com'
]);

function isNonPublicHostName(host) {
  return NON_PUBLIC_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

// Classify a candidate canonical source link. Only public https URLs can
// become user-facing links. Nothing here fetches the URL.
export function classifySourceUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return { url: null, reason: 'incomplete' };
  const raw = value.trim();
  let scheme;
  try {
    scheme = new URL(raw).protocol;
  } catch {
    return { url: null, reason: 'incomplete' };
  }
  if (scheme !== 'https:') return { url: null, reason: scheme === 'http:' ? 'non_https_url' : 'non_public_url' };
  let checked;
  try {
    checked = parseArticleUrl(raw);
  } catch {
    return { url: null, reason: 'non_public_url' };
  }
  if (isNonPublicHostName(checked.bareHost)) return { url: null, reason: 'non_public_url' };
  return { url: checked.parsed.toString(), reason: null };
}

// Text that a URL parser or a browser would read as a link.
const URL_SCHEME_TEXT = /^(?:https?|ftp|wss?|javascript|data|vbscript|file|mailto|blob):/i;

export function isUrlLikeText(value) {
  return value.includes('://') || value.startsWith('//') || URL_SCHEME_TEXT.test(value);
}

// Upstream falls back to a feed URL or local file path when a feed has no
// title. A path is not an outlet name.
function isPathLikeText(value) {
  return /^(?:\/|~|\.{1,2}\/|[A-Za-z]:[\\/])/.test(value) || value.includes('\\');
}

// Outlet names are display text. Invisible format characters are removed. A
// value with no letter or digit, or one that reads as a URL or a file path,
// is not an outlet name.
export function outletText(value) {
  const raw = typeof value === 'string' ? value : '';
  const normalized = raw.replace(/\p{Cf}/gu, '').trim().replace(/\s+/g, ' ');
  if (!normalized || !/[\p{L}\p{N}]/u.test(normalized) || isUrlLikeText(normalized) || isPathLikeText(normalized)) return '';
  return normalized.slice(0, 200);
}

function outletSlug(outlet) {
  return String(outlet || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function truncateCodePoints(value, max) {
  return Array.from(value).slice(0, max).join('');
}

const PROVIDER_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Parse a provider-reported time. Accepts only a full date and time with Z
// or a numeric offset and at most millisecond precision, and returns UTC
// milliseconds as ISO text. Newsjack turns relative dates such as
// "3 hours ago" into clock estimates with nanosecond digits, so more than
// three fractional digits is refused rather than trusted. A date without a
// time, an impossible calendar date, or anything else is refused with a
// reason. Nothing is rolled over or filled in.
export function parseProviderTimestamp(value) {
  if (value === null || value === undefined || value === '') return { value: null, reason: 'missing' };
  if (typeof value !== 'string') return { value: null, reason: 'unparseable' };
  const raw = value.trim();
  if (DATE_ONLY.test(raw)) return { value: null, reason: 'date_only' };
  const match = PROVIDER_TIME.exec(raw);
  if (!match) return { value: null, reason: 'unparseable' };
  if (match[7] && match[7].length - 1 > 3) return { value: null, reason: 'precision' };
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return { value: null, reason: 'unparseable' };
  if (match[9] !== undefined && (Number(match[10]) > 23 || Number(match[11]) > 59)) return { value: null, reason: 'unparseable' };
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return { value: null, reason: 'rolled' };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { value: null, reason: 'unparseable' };
  return { value: new Date(ms).toISOString(), reason: null };
}

// Judged on the host alone: a wire path marker such as /statement on an
// outlet's own site does not make that site a shared host.
function isSharedSyndicationHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return isWireOrAdvocacyUrl(`https://${host}/`) || isPartnerRepublicationHost(url);
  } catch {
    return false;
  }
}

function baseDocument(extra) {
  return {
    contract: 'story-discovery.v1',
    clusters: [],
    privacy: {
      full_text_persisted: false,
      article_pages_fetched: false,
      retention: 'operator_capture_file',
      jev_used: false,
      provider_article_pages_fetched: false
    },
    omission_note: OMISSION_NOTE,
    ...extra
  };
}

function abstain(reason, code, message, extra = {}) {
  return baseDocument({
    status: 'abstain',
    reason,
    message,
    data_origin: 'newsjack_capture',
    fixture_labeled: false,
    retrieved_at: null,
    window: null,
    sources_checked: [
      {
        source_id: 'newsjack:capture',
        provider: 'newsjack:capture',
        provider_mode: null,
        outlet: null,
        query: null,
        feed_url: null,
        checked_at: null,
        outcome: 'failed',
        item_count: 0,
        freshness_grade: null,
        error: code
      }
    ],
    ...extra
  });
}

const SOURCE_OUTCOMES = Object.freeze({
  used: 'checked',
  no_results: 'checked',
  partial_error: 'partial',
  error: 'failed',
  unavailable: 'not_checked',
  not_requested: 'not_requested'
});

function readCapture(input) {
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > NEWSJACK_CAPTURE_MAX_TEXT_BYTES) return { error: 'capture_too_large' };
    try {
      input = JSON.parse(input);
    } catch {
      return { error: 'capture_json_invalid' };
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'capture_not_object' };
  return { capture: input };
}

function stepTime(capture, step, field) {
  return capture.process.steps.find((entry) => entry.step === step)?.[field] ?? null;
}

function originClaimFor(capture, clusterId) {
  const claim = capture.origin?.claims.find((entry) => entry.cluster_id === clusterId);
  if (!claim) return null;
  return {
    authored_by: 'ai_agent_via_story_origin_skill',
    verification: 'unverified',
    checked_by: 'newsjack origin-apply: structure and timestamp arithmetic only',
    note: NEWSJACK_ORIGIN_NOTE,
    same_story_assessment: claim.same_story_assessment,
    first_public_at: claim.first_public_at,
    original_url: claim.original_url,
    timestamp_evidence: claim.timestamp_evidence.map((entry) => ({ url: entry.url, published_at: entry.published_at })),
    confidence: claim.confidence,
    freshness_status: claim.freshness_status,
    freshness_basis_field: claim.freshness_basis_field,
    freshness_basis_precision: claim.freshness_basis_precision,
    freshness_window: { ...claim.freshness_window },
    detector_timestamp_fallback: claim.detector_timestamp_fallback,
    withheld: { ...claim.withheld }
  };
}

/**
 * Convert a Newsjack capture into story-discovery.v1.
 *
 * @param {object|string} input capture object or its JSON text
 * @param {{ now: number, pin?: object, searchProviderStatus?: object }} options
 */
export function captureToStoryDiscovery(input, { now, pin = NEWSJACK_PIN, searchProviderStatus = SEARCH_PROVIDER_MODE_STATUS } = {}) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('captureToStoryDiscovery requires a numeric now');
  }
  const read = readCapture(input);
  if (read.error) {
    return abstain('newsjack_capture_invalid', read.error, 'The Newsjack capture could not be read. No story members were checked.');
  }
  const capture = read.capture;
  const validation = validateNewsjackCapture(capture, { pin });
  if (!validation.ok) {
    return abstain('newsjack_capture_invalid', validation.errors[0].code, 'The Newsjack capture did not match media-lens.newsjack-capture.v1. No story members were checked.', {
      errors: validation.errors.slice(0, 20).map((error) => ({ code: error.code, path: error.path }))
    });
  }

  const mode = capture.runner.mode;
  if (mode === 'live') {
    const code = searchProviderStatus?.medialyst === 'implemented' ? 'newsjack_live_capture_not_supported' : 'no_approved_transport';
    return abstain('newsjack_live_capture_not_supported', code, 'Live Newsjack captures are not supported. No approved news-search transport or live labels exist.');
  }

  const retrievedAt = stepTime(capture, 'detector_run', 'exited_at');
  const exitedMs = Date.parse(retrievedAt);
  if (exitedMs > now + FUTURE_TOLERANCE_MS) {
    return abstain('newsjack_capture_invalid', 'capture_from_future', 'The Newsjack capture ends in the future. No story members were checked.');
  }
  if (mode === 'mock' && now - exitedMs > STALE_AFTER_MS) {
    return abstain('newsjack_capture_stale', 'newsjack_capture_stale', 'The Newsjack capture is more than 48 hours old. No story members were checked.');
  }

  const hours = capture.request.max_age_hours;
  const window = { start: new Date(exitedMs - hours * 60 * 60 * 1000).toISOString(), end: retrievedAt, hours };
  const windowStartMs = Date.parse(window.start);
  const signalsById = new Map(capture.signals.map((signal) => [signal.id, signal]));
  const providerId = `newsjack:${mode}`;

  const rows = new Map();
  for (const [kind, status] of Object.entries(capture.sources)) {
    const policy = NEWSJACK_SOURCE_KINDS[kind];
    rows.set(kind, {
      source_id: `newsjack:${kind}`,
      provider: providerId,
      provider_mode: 'fixture',
      outlet: null,
      query: capture.request.query,
      feed_url: null,
      checked_at: retrievedAt,
      outcome: SOURCE_OUTCOMES[status.status],
      item_count: 0,
      freshness_grade: 'fixture',
      error: status.error_class,
      newsjack_status: status.status,
      newsjack_requested: status.requested,
      newsjack_available: status.available,
      newsjack_attempted: status.attempted,
      newsjack_evidence_count: status.evidence_count,
      member_eligible: policy.member_eligible,
      ...Object.fromEntries(NEWSJACK_MEMBER_REJECTIONS.map((reason) => [`rejected_${reason}`, 0])),
      rejected_total: 0,
      rejected_members: []
    });
  }
  const rowFor = (kind) => {
    if (!rows.has(kind)) {
      rows.set(kind, {
        source_id: `newsjack:${kind}`,
        provider: providerId,
        provider_mode: 'fixture',
        outlet: null,
        query: capture.request.query,
        feed_url: null,
        checked_at: retrievedAt,
        outcome: 'not_requested',
        item_count: 0,
        freshness_grade: 'fixture',
        error: null,
        newsjack_status: null,
        newsjack_requested: false,
        newsjack_available: false,
        newsjack_attempted: false,
        newsjack_evidence_count: 0,
        member_eligible: NEWSJACK_SOURCE_KINDS[kind].member_eligible,
        ...Object.fromEntries(NEWSJACK_MEMBER_REJECTIONS.map((reason) => [`rejected_${reason}`, 0])),
        rejected_total: 0,
        rejected_members: []
      });
    }
    return rows.get(kind);
  };
  const reject = (kind, reason, clusterId, signalId, outlet, detail = reason) => {
    const row = rowFor(kind);
    row[`rejected_${reason}`] += 1;
    row.rejected_total += 1;
    if (row.rejected_members.length < MAX_REJECTED_MEMBERS_LISTED) {
      // No URL is listed: a rejected URL may be non-public, and it must not
      // become a user-facing link through diagnostics either.
      row.rejected_members.push({ cluster_id: clusterId, newsjack_signal_id: signalId, reason: detail, outlet: outlet || null });
    }
  };

  const clusters = [];
  let clustersWithoutMembers = 0;
  for (const group of capture.clustering.groups) {
    const members = [];
    const seenUrlKeys = new Set();
    for (const signalId of group.signal_ids) {
      const signal = signalsById.get(signalId);
      for (const evidence of signal.evidence) {
        const kind = evidence.source;
        const outlet = outletText(evidence.container);
        if (!NEWSJACK_SOURCE_KINDS[kind].member_eligible) {
          reject(kind, 'source_kind_excluded', group.cluster_id, signalId, outlet, `source_kind_excluded:${kind}`);
          continue;
        }
        if (evidence.title_from_excerpt) {
          reject(kind, 'title_from_excerpt', group.cluster_id, signalId, outlet);
          continue;
        }
        const title = evidence.title.trim();
        const classified = classifySourceUrl(evidence.url);
        if (!outlet || !title || classified.reason === 'incomplete') {
          reject(kind, 'incomplete', group.cluster_id, signalId, outlet);
          continue;
        }
        if (!classified.url) {
          reject(kind, classified.reason, group.cluster_id, signalId, outlet);
          continue;
        }
        const urlKey = normalizedURLKey(classified.url);
        if (seenUrlKeys.has(urlKey)) {
          reject(kind, 'duplicate_url', group.cluster_id, signalId, outlet);
          continue;
        }
        const published = parseProviderTimestamp(evidence.published_at);
        if (!published.value) {
          reject(kind, `published_at_${published.reason}`, group.cluster_id, signalId, outlet);
          continue;
        }
        const publishedMs = Date.parse(published.value);
        if (publishedMs > exitedMs) {
          reject(kind, 'published_at_after_retrieval', group.cluster_id, signalId, outlet);
          continue;
        }
        if (publishedMs < windowStartMs) {
          reject(kind, 'outside_window', group.cluster_id, signalId, outlet);
          continue;
        }
        seenUrlKeys.add(urlKey);
        const syndicated = isSharedSyndicationHost(classified.url);
        members.push({
          outlet,
          outlet_basis: 'provider_reported_publication_name',
          article_title: truncateCodePoints(title, 300),
          published_at: published.value,
          published_at_basis: 'provider_reported_via_newsjack_unverified',
          canonical_url: classified.url,
          url_basis: 'provider_surfaced_url_not_canonicalized',
          retrieved_at: retrievedAt,
          retrieved_at_basis: NEWSJACK_RETRIEVED_AT_BASIS,
          source_id: `newsjack:${kind}:${outletSlug(outlet) || 'unknown_outlet'}`,
          source_kind: kind,
          newsjack_signal_id: signalId,
          relation: syndicated ? 'syndicated' : 'same_story',
          labeling_basis: syndicated ? 'wire_press_release_or_partner_url' : NEWSJACK_MEMBER_BASIS,
          independent_reporting: false
        });
        rowFor(kind).item_count += 1;
      }
    }
    if (members.length === 0) {
      clustersWithoutMembers += 1;
      continue;
    }
    const cluster = {
      cluster_id: group.cluster_id,
      title: members[0].article_title,
      cluster_basis: NEWSJACK_CLUSTER_BASIS,
      cluster_params: {
        title_overlap: capture.clustering.title_overlap,
        min_shared_tokens: capture.clustering.min_shared_tokens,
        detector_jaccard: 0.32,
        basis: 'pinned_source_review'
      },
      window,
      sources_checked: [...rows.values()].map((row) => row.source_id),
      members,
      independent_reporting: [],
      independent_outlet_count: 0,
      independence_note: NEWSJACK_INDEPENDENCE_NOTE,
      frames: [],
      frame_note: FRAME_NOTE,
      coverage_gap: null,
      omission_note: OMISSION_NOTE,
      same_story_note: SAME_STORY_NOT_INDEPENDENT
    };
    const claim = originClaimFor(capture, group.cluster_id);
    if (claim) cluster.origin_claims = [claim];
    clusters.push(cluster);
  }
  const sourcesChecked = [...rows.values()];
  for (const cluster of clusters) cluster.sources_checked = sourcesChecked.map((row) => row.source_id);

  const status = clusters.length > 0 ? 'ok' : 'empty';
  const label = mode === 'mock' ? 'Newsjack mock run: synthetic data from a pinned binary, not live coverage.' : 'Newsjack fixture capture: hand-written example data, not live coverage.';
  const document = baseDocument({
    status,
    reason: status === 'ok' ? 'newsjack_capture_converted' : 'no_accepted_members',
    message:
      status === 'ok'
        ? `${label} Members are grouped by shared URLs or title words, and none is labeled independent. ${OMISSION_NOTE}`
        : `${label} No evidence item met the member rules. Dropped items are counted by reason on each sources_checked row. ${OMISSION_NOTE}`,
    data_origin: 'fixture',
    fixture_labeled: true,
    retrieved_at: retrievedAt,
    retrieved_at_basis: NEWSJACK_RETRIEVED_AT_BASIS,
    window,
    window_basis: NEWSJACK_WINDOW_BASIS,
    sources_checked: sourcesChecked,
    clusters,
    provenance: {
      tool: 'newsjack',
      version: capture.newsjack.version,
      commit: capture.newsjack.commit,
      binary_sha256: capture.newsjack.binary_sha256,
      binary_check: mode === 'mock' ? 'matched' : 'fixture_unhashed',
      capture_id: capture.capture_id,
      capture_contract: NEWSJACK_CAPTURE_CONTRACT,
      runner_mode: mode,
      argv_template: capture.runner.argv_template,
      retrieval_interval: {
        not_before: new Date(Math.floor(Date.parse(capture.monitor.generated_at))).toISOString(),
        not_after: retrievedAt
      },
      provider_selection: {
        ...capture.selection,
        lookback_days: capture.request.lookback_days,
        depth: capture.request.depth,
        min_queue_priority: 0,
        min_major_news: 0,
        evidence_cap_per_signal: 8
      },
      clusters_without_members: clustersWithoutMembers
    }
  });
  if (capture.origin) document.privacy.provider_article_pages_fetched = 'unknown_agent_retrieval';
  return document;
}
