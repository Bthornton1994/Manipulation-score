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
// use it. The last group is well-known wildcard DNS names that resolve to
// loopback or private addresses. Other names that happen to resolve to a
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
  '.nip.io',
  '.sslip.io',
  '.xip.io',
  '.localtest.me',
  '.lvh.me'
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

// Judged on the host alone: a wire path marker such as /statement on an
// outlet's own site does not make that site a shared host.
function sharedSyndicationHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return isWireOrAdvocacyUrl(`https://${host}/`) || isPartnerRepublicationHost(url);
  } catch {
    return false;
  }
}

function outletDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return registrableHostKey(host) || host;
  } catch {
    return null;
  }
}

// A stated source_id is kept only when it is a short opaque token. Anything
// URL-shaped or free-form is replaced by an id derived from the outlet name.
const SAFE_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,79}$/;

function outletSlug(outlet) {
  return String(outlet || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function statedSourceId(hit) {
  const raw = typeof hit.source_id === 'string' ? hit.source_id.trim() : '';
  return raw && SAFE_SOURCE_ID.test(raw) ? raw : null;
}

function sourceIdFor(hit, outlet) {
  const stated = statedSourceId(hit);
  if (stated) return stated;
  const slug = outletSlug(outlet);
  return slug ? `newsjack:${slug}` : 'newsjack:unknown_outlet';
}

// Outlet names are display text. A URL-shaped value is not an outlet name.
function outletText(hit) {
  const raw = typeof hit.outlet === 'string' ? hit.outlet : typeof hit.source === 'string' ? hit.source : '';
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (!normalized || /:\/\//.test(normalized) || /^(?:javascript|data|vbscript|file):/i.test(normalized)) return '';
  return normalized.slice(0, 200);
}

function titleText(hit) {
  const raw = typeof hit.title === 'string' ? hit.title : typeof hit.article_title === 'string' ? hit.article_title : '';
  return raw.trim();
}

function truncateCodePoints(value, max) {
  return Array.from(value).slice(0, max).join('');
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

// Identity keys that tie records to one outlet: the normalized name, the name
// slug, the registrable domain, and a stated source_id. Records sharing any
// key are joined transitively (union-find), so an outlet that publishes on
// two domains, or under two spellings, is still one outlet. Wire, press
// release, and partner republication hosts carry many outlets' copy, so their
// domain does not identify an outlet.
function identityKeys(entry) {
  const keys = [];
  const name = outletIdentity(entry.outlet);
  if (name) keys.push(`name:${name}`);
  const slug = outletSlug(entry.outlet);
  if (slug) keys.push(`slug:${slug}`);
  const domain = sharedSyndicationHost(entry.url) ? null : outletDomain(entry.url);
  if (domain) keys.push(`domain:${domain}`);
  const stated = statedSourceId(entry.hit);
  if (stated) keys.push(`sid:${stated.toLowerCase()}`);
  return keys;
}

function groupOutlets(entries) {
  const parent = entries.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const owner = new Map();
  entries.forEach((entry, index) => {
    for (const key of identityKeys(entry)) {
      if (owner.has(key)) {
        const a = find(owner.get(key));
        const b = find(index);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      } else {
        owner.set(key, index);
      }
    }
  });
  return entries.map((_, index) => find(index));
}

function recordRejection(rejected, reason, groupIndex, clusterId, outlet) {
  rejected[reason] += 1;
  if (rejected.members.length < MAX_REJECTED_MEMBERS_LISTED) {
    // No URL is listed: a rejected URL may be non-public, and it must not
    // become a user-facing link through diagnostics either.
    const entry = { cluster_id: clusterId, group_index: groupIndex, reason, outlet: outlet ? truncateCodePoints(outlet, 120) : null };
    rejected.members.push(entry);
    return entry;
  }
  return null;
}

// Decide every record's fate in one pass, then compute independence only from
// members that will be shown and can be labeled independent. A record that is
// dropped (incomplete, non-https, non-public, different_story) or whose
// relation is never labeled independent cannot satisfy the two-outlet rule.
function clusterFromGroup(group, groupIndex, { retrievedAt, window, sourcesChecked, origin, originUncertain, rejected }) {
  const hits = Array.isArray(group?.members) ? group.members : [];
  const statedId = typeof group?.cluster_id === 'string' && group.cluster_id.trim() ? group.cluster_id.trim() : null;
  const eligible = datedSameStoryKeys(origin);
  const groupRejections = [];
  const reject = (reason, outlet) => {
    const entry = recordRejection(rejected, reason, groupIndex, statedId, outlet);
    if (entry) groupRejections.push(entry);
  };

  const kept = [];
  const seenUrlKeys = new Set();
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object' || Array.isArray(hit)) {
      reject('incomplete', null);
      continue;
    }
    const outlet = outletText(hit);
    const title = titleText(hit);
    const classified = classifySourceUrl(hit.url || hit.canonical_url);
    if (!outlet || !title || classified.reason === 'incomplete') {
      reject('incomplete', outlet);
      continue;
    }
    if (!classified.url) {
      reject(classified.reason, outlet);
      continue;
    }
    // A Newsjack different_story assessment wins over wire, partner, and
    // repeated-URL rules: that record is not coverage of this story.
    if (hit.relation === 'different_story') {
      reject('different_story', outlet);
      continue;
    }
    const url = classified.url;
    const urlKey = normalizedURLKey(url);
    let label;
    if (isWireOrAdvocacyUrl(url) || isPartnerRepublicationHost(url)) {
      label = { relation: 'syndicated', labeling_basis: 'wire_press_release_or_partner_url' };
    } else if (urlKey && seenUrlKeys.has(urlKey)) {
      label = { relation: 'syndicated', labeling_basis: 'same_canonical_url' };
    } else if (hit.relation === 'syndicated') {
      label = { relation: 'syndicated', labeling_basis: 'newsjack_relation_syndicated' };
    } else if (originUncertain || hit.relation === 'unclear') {
      label = { relation: 'same_story', labeling_basis: 'newsjack_origin_uncertain' };
    } else if (hit.relation === 'surfaced' || hit.relation == null) {
      label = { relation: 'same_story', labeling_basis: 'newsjack_relation_surfaced' };
    } else {
      label = { relation: 'same_story', labeling_basis: 'newsjack_relation_same_story' };
    }
    const candidate =
      label.relation === 'same_story' &&
      label.labeling_basis !== 'newsjack_origin_uncertain' &&
      (hit.relation === 'surfaced' || hit.relation === 'same_story' || hit.relation == null) &&
      Boolean(urlKey) &&
      eligible.has(urlKey) &&
      Boolean(outletIdentity(outlet));
    if (urlKey) seenUrlKeys.add(urlKey);
    kept.push({ hit, outlet, title, url, urlKey, label, candidate });
  }

  // Independence: one row per distinct outlet among candidates, with outlet
  // identity grouped transitively over every kept member.
  const roots = groupOutlets(kept);
  const candidateRoots = new Set(kept.flatMap((entry, index) => (entry.candidate ? [roots[index]] : [])));
  if (candidateRoots.size >= 2) {
    const chosenRoots = new Set();
    kept.forEach((entry, index) => {
      if (!entry.candidate) return;
      if (chosenRoots.has(roots[index])) {
        entry.label = { relation: 'same_story', labeling_basis: SAME_OUTLET_ADDITIONAL_URL_BASIS };
        return;
      }
      chosenRoots.add(roots[index]);
      entry.label = { relation: 'independent_reporting', labeling_basis: INDEPENDENCE_BASIS };
    });
  }

  if (kept.length === 0) return { cluster: null };
  const members = kept.map((entry) => ({
    outlet: entry.outlet,
    article_title: truncateCodePoints(entry.title, 300),
    published_at: knownPublishedAt(entry.hit.published_at),
    canonical_url: entry.url,
    retrieved_at: retrievedAt,
    source_id: sourceIdFor(entry.hit, entry.outlet),
    relation: entry.label.relation,
    labeling_basis: entry.label.labeling_basis,
    independent_reporting: entry.label.relation === 'independent_reporting'
  }));
  const independent = members.filter((member) => member.independent_reporting);
  const title = members[0].article_title;
  const clusterId = statedId || clusterIdFor(String(`${title}|${window.start}`));
  for (const entry of groupRejections) entry.cluster_id = clusterId;
  return {
    cluster: {
      cluster_id: clusterId,
      title,
      cluster_basis: CLUSTER_BASIS,
      window,
      sources_checked: sourcesChecked.map((source) => source.source_id),
      members,
      // One row per distinct qualifying outlet (see groupOutlets).
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

const MAX_WINDOW_HOURS = 24 * 366;
const DATA_ORIGINS = new Set(['fixture', 'newsjack_artifacts']);
const FRESHNESS_GRADES = new Set(['fixture', 'unknown']);
const PROVIDER_ID = /^(?:fixture|newsjack):[a-z0-9_:-]{1,60}$/;

// Copy only a well-formed window: ISO UTC start and end, and a positive,
// bounded hour count. Anything else is treated as no window.
export function sanitizeWindow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const start = knownPublishedAt(value.start);
  const end = knownPublishedAt(value.end);
  const hours = value.hours;
  if (!start || !end || typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > MAX_WINDOW_HOURS) return null;
  return { start, end, hours };
}

// Labels come from the adapter, not from evidence. Refuse values that would
// present mapped fixture or artifact evidence as another kind of source.
function assertDocumentLabels({ providerId, freshnessGrade, dataOrigin }) {
  const fail = (field, value) => {
    throw Object.assign(new Error(`Unsupported story-discovery ${field}: ${String(value)}`), { code: 'INVALID_DISCOVERY_LABEL', field });
  };
  if (typeof dataOrigin !== 'string' || !DATA_ORIGINS.has(dataOrigin)) fail('data_origin', dataOrigin);
  if (typeof freshnessGrade !== 'string' || !FRESHNESS_GRADES.has(freshnessGrade)) fail('freshness_grade', freshnessGrade);
  if (typeof providerId !== 'string' || !PROVIDER_ID.test(providerId)) fail('provider_id', providerId);
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
  // as host web search, RSS/Atom, or Medialyst results, and the data origin,
  // provider id, and freshness grade must be one of the adapter's own values.
  assertSearchProviderModeImplemented(providerMode);
  assertDocumentLabels({ providerId, freshnessGrade, dataOrigin });
  window = sanitizeWindow(window);
  const readFailed = (dataOrigin === 'newsjack_artifacts' && artifactRead?.ok !== true) || artifactRead?.ok === false;
  if (readFailed) {
    const stamp = knownPublishedAt(retrievedAt);
    const statedWindow = window;
    const invalid = artifactRead?.reason === 'invalid';
    const what = dataOrigin === 'fixture' ? 'fixture file' : 'artifact file';
    const unreadMessage = dataOrigin === 'fixture'
      ? 'The Newsjack fixture file was not read. No story members were checked. This is not a live provider result.'
      : 'The Newsjack artifact directory or file was not read. No story members were checked. This is not a live provider result.';
    return baseDocument({
      status: 'abstain',
      reason: invalid ? 'artifacts_invalid' : 'artifacts_unavailable',
      message: invalid
        ? `A Newsjack ${what} could not be parsed as the expected JSON shape. No story members were checked. This is not a live provider result.`
        : unreadMessage,
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
  if (!window) {
    return baseDocument({
      status: 'abstain',
      reason: 'window_missing',
      message: 'No valid search or cluster window was supplied. A window was not invented from publication times.',
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
  for (const [groupIndex, group] of groups.entries()) {
    const result = clusterFromGroup(group, groupIndex, {
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
      : `No usable story members were present. Dropped records were not filled in; the sources_checked row counts them by reason. ${freshnessNote} ${OMISSION_NOTE}`,
    data_origin: dataOrigin,
    fixture_labeled: fixtureLabeled,
    retrieved_at: retrievedAt,
    window,
    sources_checked: [checked],
    clusters: built
  });
}
