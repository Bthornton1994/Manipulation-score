// Map fixture or operator Newsjack-shaped search/origin/cluster evidence
// into story-discovery.v1. No network, no Medialyst, no Jev, no CLI.

import { createHash } from 'node:crypto';
import { parseArticleUrl } from '../address-policy.js';
import { isPartnerRepublicationHost, isWireOrAdvocacyUrl } from '../fusion.js';
import { registrableHostKey } from '../host-key.js';
import { normalizedURLKey } from '../url-key.js';
import { FRAME_NOTE, OMISSION_NOTE, SAME_STORY_NOT_INDEPENDENT } from './cluster.js';
import { assertSearchProviderModeImplemented } from './search-provider.js';

export const CLUSTER_BASIS = 'newsjack_cluster_same_public_event';
export const INDEPENDENCE_BASIS = 'newsjack_origin_distinct_independent_outlets';
export const SAME_OUTLET_ADDITIONAL_URL_BASIS = 'same_outlet_additional_url';

// Reasons a Newsjack-shaped member is dropped before it can become a story
// member. Every drop is counted on the sources_checked row and listed in
// rejected_members, so nothing disappears silently.
export const REJECTION_REASONS = Object.freeze(['incomplete', 'non_https_url', 'non_public_url', 'different_story']);
const MAX_REJECTED_MEMBERS_LISTED = 200;

// Names that point at private networks, metadata services, or special-use
// namespaces. parseArticleUrl already refuses loopback and the exact
// metadata hostnames, *.local, *.localhost, single-label hosts, and every
// non-public IP literal (including exotic IPv4 forms). These suffixes cover
// the rest (for example instance-data.ec2.internal or printer.home.arpa).
// .example stays allowed because it is documentation-only and the fixtures
// use it.
const NON_PUBLIC_HOST_SUFFIXES = Object.freeze([
  '.internal',
  '.arpa',
  '.localdomain',
  '.lan',
  '.intranet',
  '.corp',
  '.private',
  '.test',
  '.invalid',
  '.onion'
]);

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function clusterIdFor(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function knownPublishedAt(value) {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function isNonPublicHostName(host) {
  return NON_PUBLIC_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

// Classify a candidate canonical source link. Only public https URLs can
// become user-facing links. Nothing here fetches the URL.
export function classifySourceUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return { url: null, reason: 'incomplete' };
  let raw = value.trim();
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

function publicSourceUrl(value) {
  return classifySourceUrl(value).url;
}

function outletDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return registrableHostKey(host) || host;
  } catch {
    return null;
  }
}

function sourceIdFor(hit, outlet) {
  if (typeof hit.source_id === 'string' && hit.source_id.trim()) return hit.source_id.trim();
  const slug = String(outlet || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? `newsjack:${slug}` : 'newsjack:unknown_outlet';
}

function baseDocument(extra) {
  return {
    contract: 'story-discovery.v1',
    clusters: [],
    privacy: {
      full_text_persisted: false,
      article_pages_fetched: false,
      retention: 'none',
      jev_used: false
    },
    omission_note: OMISSION_NOTE,
    ...extra
  };
}

function outletIdentity(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || /^unknown$/i.test(normalized)) return null;
  return normalized.toLowerCase();
}

function datedSameStoryKeys(origin) {
  const keys = new Set();
  if (!origin || typeof origin !== 'object' || origin.same_story_assessment !== 'same_story') return keys;
  for (const item of Array.isArray(origin.timestamp_evidence) ? origin.timestamp_evidence : []) {
    const key = normalizedURLKey(item?.url_key || item?.url);
    if (!key || !knownPublishedAt(item?.published_at)) continue;
    if (isWireOrAdvocacyUrl(key) || isPartnerRepublicationHost(key)) continue;
    keys.add(key);
  }
  return keys;
}

// Pick at most one qualifying URL per distinct outlet. Two candidates are the
// same outlet when their normalized outlet names match or their URLs share a
// registrable domain, so an extra URL (or an alias name on the same domain)
// never counts as another independent outlet. Returns the chosen URL keys and
// the keys of extra qualifying URLs from outlets already counted.
function independenceSelection(members, origin) {
  const eligible = datedSameStoryKeys(origin);
  const counted = [];
  const chosen = new Set();
  const additional = new Set();
  const processed = new Set();
  for (const hit of members || []) {
    if (!hit || typeof hit !== 'object') continue;
    const url = publicSourceUrl(hit.url || hit.canonical_url);
    const urlKey = url ? normalizedURLKey(url) : null;
    if (!urlKey || processed.has(urlKey) || !eligible.has(urlKey)) continue;
    processed.add(urlKey);
    if (hit.relation === 'syndicated' || hit.relation === 'different_story' || hit.relation === 'unclear') continue;
    if (isWireOrAdvocacyUrl(url) || isPartnerRepublicationHost(url)) continue;
    const name = outletIdentity(hit.outlet || hit.source);
    if (!name) continue;
    const domain = outletDomain(url);
    const already = counted.some((outlet) => outlet.name === name || (domain && outlet.domain === domain));
    if (already) {
      additional.add(urlKey);
      continue;
    }
    counted.push({ name, domain });
    chosen.add(urlKey);
  }
  if (counted.length < 2) return { independentKeys: new Set(), sameOutletKeys: new Set(), distinctOutlets: 0 };
  return { independentKeys: chosen, sameOutletKeys: additional, distinctOutlets: counted.length };
}

function labelMember(hit, url, seenUrlKeys, { independentKeys, sameOutletKeys }, originUncertain) {
  const urlKey = normalizedURLKey(url);
  if (isWireOrAdvocacyUrl(url) || isPartnerRepublicationHost(url)) {
    return { relation: 'syndicated', labeling_basis: 'wire_press_release_or_partner_url', independent_reporting: false, keep: true };
  }
  if (urlKey && seenUrlKeys.has(urlKey)) {
    return { relation: 'syndicated', labeling_basis: 'same_canonical_url', independent_reporting: false, keep: true };
  }
  if (hit.relation === 'syndicated') {
    return { relation: 'syndicated', labeling_basis: 'newsjack_relation_syndicated', independent_reporting: false, keep: true };
  }
  if (hit.relation === 'different_story') {
    return { keep: false };
  }
  if (originUncertain || hit.relation === 'unclear') {
    return { relation: 'same_story', labeling_basis: 'newsjack_origin_uncertain', independent_reporting: false, keep: true };
  }
  if (urlKey && sameOutletKeys.has(urlKey)) {
    return { relation: 'same_story', labeling_basis: SAME_OUTLET_ADDITIONAL_URL_BASIS, independent_reporting: false, keep: true };
  }
  if (urlKey && independentKeys.has(urlKey) && (hit.relation === 'surfaced' || hit.relation === 'same_story' || hit.relation == null)) {
    return {
      relation: 'independent_reporting',
      labeling_basis: INDEPENDENCE_BASIS,
      independent_reporting: true,
      keep: true
    };
  }
  if (hit.relation === 'surfaced' || hit.relation == null) {
    return { relation: 'same_story', labeling_basis: 'newsjack_relation_surfaced', independent_reporting: false, keep: true };
  }
  return { relation: 'same_story', labeling_basis: 'newsjack_relation_same_story', independent_reporting: false, keep: true };
}

function recordRejection(rejected, reason, clusterId, outlet) {
  rejected[reason] += 1;
  if (rejected.members.length < MAX_REJECTED_MEMBERS_LISTED) {
    // No URL is listed: a rejected URL may be non-public, and it must not
    // become a user-facing link through diagnostics either.
    rejected.members.push({ cluster_id: clusterId, reason, outlet: outlet ? outlet.slice(0, 120) : null });
  }
}

function memberFromHit(hit, retrievedAt, seenUrlKeys, selection, originUncertain, rejected, clusterId) {
  if (!hit || typeof hit !== 'object' || Array.isArray(hit)) {
    recordRejection(rejected, 'incomplete', clusterId, null);
    return null;
  }
  const outlet = typeof hit.outlet === 'string' ? hit.outlet.trim() : typeof hit.source === 'string' ? hit.source.trim() : '';
  const title = typeof hit.title === 'string' ? hit.title.trim() : typeof hit.article_title === 'string' ? hit.article_title.trim() : '';
  const classified = classifySourceUrl(hit.url || hit.canonical_url);
  if (!outlet || !title || classified.reason === 'incomplete') {
    recordRejection(rejected, 'incomplete', clusterId, outlet);
    return null;
  }
  if (!classified.url) {
    recordRejection(rejected, classified.reason, clusterId, outlet);
    return null;
  }
  const url = classified.url;
  const label = labelMember(hit, url, seenUrlKeys, selection, originUncertain);
  if (!label.keep) {
    recordRejection(rejected, 'different_story', clusterId, outlet);
    return null;
  }
  const urlKey = normalizedURLKey(url);
  if (urlKey) seenUrlKeys.add(urlKey);
  return {
    outlet,
    article_title: title.slice(0, 300),
    published_at: knownPublishedAt(hit.published_at),
    canonical_url: url,
    retrieved_at: retrievedAt,
    source_id: sourceIdFor(hit, outlet),
    relation: label.relation,
    labeling_basis: label.labeling_basis,
    independent_reporting: label.independent_reporting
  };
}

function clusterFromGroup(group, { retrievedAt, window, sourcesChecked, origin, originUncertain, rejected }) {
  const hits = Array.isArray(group?.members) ? group.members : [];
  const selection = independenceSelection(hits, origin);
  const seenUrlKeys = new Set();
  const members = [];
  const statedId = typeof group?.cluster_id === 'string' && group.cluster_id.trim() ? group.cluster_id.trim() : null;
  for (const hit of hits) {
    const member = memberFromHit(hit, retrievedAt, seenUrlKeys, selection, originUncertain, rejected, statedId);
    if (member) members.push(member);
  }
  if (members.length === 0) return { cluster: null };
  const independent = members.filter((member) => member.independent_reporting);
  const title = members[0].article_title;
  const idKey = statedId || `${title}|${window.start}`;
  return {
    cluster: {
      cluster_id: statedId || clusterIdFor(String(idKey)),
      title,
      cluster_basis: CLUSTER_BASIS,
      window,
      sources_checked: sourcesChecked.map((source) => source.source_id),
      members,
      // One row per distinct qualifying outlet (see independenceSelection).
      independent_reporting: independent.map((member) => ({
        outlet: member.outlet,
        canonical_url: member.canonical_url,
        labeling_basis: member.labeling_basis
      })),
      independent_outlet_count: independent.length,
      frames: [],
      frame_note: FRAME_NOTE,
      coverage_gap: null,
      omission_note: OMISSION_NOTE,
      same_story_note: SAME_STORY_NOT_INDEPENDENT
    }
  };
}

export function mapNewsjackEvidenceToStoryDiscovery({
  retrievedAt,
  window = null,
  providerId = 'fixture:newsjack_shaped',
  providerMode = 'fixture',
  freshnessGrade = 'fixture',
  query = null,
  hits = null,
  clusters = null,
  origin = null,
  dataOrigin = 'fixture',
  artifactRead = null
} = {}) {
  // Only fixture evidence is implemented. A caller cannot label mapped output
  // as host web search, RSS/Atom, or Medialyst results.
  assertSearchProviderModeImplemented(providerMode);
  const readFailed = (dataOrigin === 'newsjack_artifacts' && artifactRead?.ok !== true) || artifactRead?.ok === false;
  if (readFailed) {
    const stamp = knownPublishedAt(retrievedAt);
    const statedWindow = window && typeof window.start === 'string' && typeof window.end === 'string' && Number.isFinite(window.hours)
      ? window
      : null;
    const invalid = artifactRead?.reason === 'invalid';
    const what = dataOrigin === 'fixture' ? 'fixture file' : 'artifact file';
    return baseDocument({
      status: 'abstain',
      reason: invalid ? 'artifacts_invalid' : 'artifacts_unavailable',
      message: invalid
        ? `A Newsjack ${what} could not be parsed as the expected JSON shape. No story members were checked. This is not a live provider result.`
        : 'The Newsjack artifact directory was not read. No story members were checked. This is not a live provider result.',
      data_origin: dataOrigin,
      fixture_labeled: dataOrigin === 'fixture',
      retrieved_at: stamp,
      window: statedWindow,
      sources_checked: [{
        source_id: providerId,
        provider: providerId,
        provider_mode: providerMode,
        outlet: null,
        query: query || null,
        feed_url: null,
        checked_at: stamp,
        outcome: 'failed',
        item_count: 0,
        freshness_grade: freshnessGrade,
        error: artifactRead?.error || 'artifacts_unreadable',
        ...(artifactRead?.file ? { error_file: artifactRead.file } : {})
      }]
    });
  }
  if (typeof retrievedAt !== 'string' || !knownPublishedAt(retrievedAt)) {
    return baseDocument({
      status: 'abstain',
      reason: 'retrieved_at_missing',
      message: 'No retrieval time was supplied, so no story-discovery document was built. Published times were not copied into retrieved_at.',
      data_origin: dataOrigin,
      fixture_labeled: dataOrigin === 'fixture',
      retrieved_at: null,
      window: null,
      sources_checked: []
    });
  }
  if (!window || typeof window.start !== 'string' || typeof window.end !== 'string' || !Number.isFinite(window.hours)) {
    return baseDocument({
      status: 'abstain',
      reason: 'window_missing',
      message: 'No search or cluster window was supplied. A window was not invented from publication times.',
      data_origin: dataOrigin,
      fixture_labeled: dataOrigin === 'fixture',
      retrieved_at: retrievedAt,
      window: null,
      sources_checked: []
    });
  }

  const originUncertain = Boolean(origin) && (typeof origin !== 'object' || origin.same_story_assessment !== 'same_story');
  const groups = Array.isArray(clusters) && clusters.length > 0
    ? clusters
    : [{ cluster_id: null, members: Array.isArray(hits) ? hits : [] }];

  const checked = {
    source_id: providerId,
    provider: providerId,
    provider_mode: providerMode,
    outlet: null,
    query: query || null,
    feed_url: null,
    checked_at: retrievedAt,
    outcome: dataOrigin === 'newsjack_artifacts' ? 'artifacts_read' : 'fixture_checked',
    item_count: 0,
    freshness_grade: freshnessGrade,
    error: null
  };

  const built = [];
  const rejected = { incomplete: 0, non_https_url: 0, non_public_url: 0, different_story: 0, members: [] };
  for (const group of groups) {
    const result = clusterFromGroup(group, {
      retrievedAt,
      window,
      sourcesChecked: [checked],
      origin,
      originUncertain,
      rejected
    });
    if (result.cluster) built.push(result.cluster);
  }
  checked.item_count = built.reduce((sum, cluster) => sum + cluster.members.length, 0);
  checked.rejected_incomplete = rejected.incomplete;
  checked.rejected_non_https_url = rejected.non_https_url;
  checked.rejected_non_public_url = rejected.non_public_url;
  checked.rejected_different_story = rejected.different_story;
  checked.rejected_total = REJECTION_REASONS.reduce((sum, reason) => sum + rejected[reason], 0);
  checked.rejected_members = rejected.members;

  const fixtureLabeled = dataOrigin === 'fixture';
  const freshnessNote = freshnessGrade === 'fixture'
    ? 'Fixture evidence only. This is not a live provider result and not Medialyst-grade attribution.'
    : 'Freshness is best-effort for this provider mode. Medialyst-grade attribution is not claimed.';
  const status = built.length > 0 ? 'ok' : 'empty';
  return baseDocument({
    status,
    reason: status === 'ok' ? 'clusters_from_newsjack_shaped_evidence' : 'no_usable_members',
    message: built.length
      ? `Fixture or artifact clusters only. ${freshnessNote} ${OMISSION_NOTE}`
      : `No usable story members were present. Incomplete records were dropped instead of filled in. ${freshnessNote} ${OMISSION_NOTE}`,
    data_origin: dataOrigin,
    fixture_labeled: fixtureLabeled,
    retrieved_at: retrievedAt,
    window,
    sources_checked: [checked],
    clusters: built
  });
}
