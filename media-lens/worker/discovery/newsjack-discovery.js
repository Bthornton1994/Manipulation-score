// Map fixture or operator Newsjack-shaped search/origin/cluster evidence
// into story-discovery.v1. No network, no Medialyst, no Jev, no CLI.

import { createHash } from 'node:crypto';
import { isPartnerRepublicationHost, isWireOrAdvocacyUrl } from '../fusion.js';
import { normalizedURLKey } from '../url-key.js';
import { FRAME_NOTE, OMISSION_NOTE, SAME_STORY_NOT_INDEPENDENT } from './cluster.js';

export const CLUSTER_BASIS = 'newsjack_cluster_same_public_event';
export const INDEPENDENCE_BASIS = 'newsjack_origin_two_independent_urls';

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

function httpsUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
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

function evidenceKeys(origin) {
  if (!origin || typeof origin !== 'object') return new Set();
  if (origin.same_story_assessment === 'unclear' || origin.same_story_assessment == null) return new Set();
  const keys = new Set();
  for (const item of origin.timestamp_evidence || []) {
    const key = normalizedURLKey(item?.url_key || item?.url);
    if (!key || !knownPublishedAt(item?.published_at)) continue;
    if (isWireOrAdvocacyUrl(key) || isPartnerRepublicationHost(key)) continue;
    keys.add(key);
  }
  if (keys.size < 2) return new Set();
  return keys;
}

function labelMember(hit, url, seenUrlKeys, independentKeys, originUncertain) {
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

function memberFromHit(hit, retrievedAt, seenUrlKeys, independentKeys, originUncertain, rejected) {
  const outlet = typeof hit.outlet === 'string' ? hit.outlet.trim() : typeof hit.source === 'string' ? hit.source.trim() : '';
  const title = typeof hit.title === 'string' ? hit.title.trim() : typeof hit.article_title === 'string' ? hit.article_title.trim() : '';
  const url = httpsUrl(hit.url || hit.canonical_url);
  if (!outlet || !title || !url) {
    rejected.count += 1;
    return null;
  }
  const label = labelMember(hit, url, seenUrlKeys, independentKeys, originUncertain);
  const urlKey = normalizedURLKey(url);
  if (urlKey) seenUrlKeys.add(urlKey);
  if (!label.keep) {
    rejected.different_story += 1;
    return null;
  }
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

function clusterFromGroup(group, { retrievedAt, window, sourcesChecked, independentKeys, originUncertain }) {
  const seenUrlKeys = new Set();
  const rejected = { count: 0, different_story: 0 };
  const members = [];
  for (const hit of group.members || []) {
    const member = memberFromHit(hit, retrievedAt, seenUrlKeys, independentKeys, originUncertain, rejected);
    if (member) members.push(member);
  }
  if (members.length === 0) return { cluster: null, rejected };
  const independent = members.filter((member) => member.independent_reporting);
  const title = members[0].article_title;
  const idKey = group.cluster_id || `${title}|${window.start}`;
  return {
    rejected,
    cluster: {
      cluster_id: typeof group.cluster_id === 'string' && group.cluster_id.trim()
        ? group.cluster_id.trim()
        : clusterIdFor(String(idKey)),
      title,
      cluster_basis: CLUSTER_BASIS,
      window,
      sources_checked: sourcesChecked.map((source) => source.source_id),
      members,
      independent_reporting: independent.map((member) => ({
        outlet: member.outlet,
        canonical_url: member.canonical_url,
        labeling_basis: member.labeling_basis
      })),
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
  dataOrigin = 'fixture'
} = {}) {
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

  const originUncertain = Boolean(origin) && (origin.same_story_assessment === 'unclear' || origin.same_story_assessment == null);
  const independentKeys = evidenceKeys(origin);
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
  let rejected = 0;
  for (const group of groups) {
    const result = clusterFromGroup(group, {
      retrievedAt,
      window,
      sourcesChecked: [checked],
      independentKeys,
      originUncertain
    });
    rejected += result.rejected.count;
    if (result.cluster) built.push(result.cluster);
  }
  checked.item_count = built.reduce((sum, cluster) => sum + cluster.members.length, 0);
  checked.rejected_incomplete = rejected;

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
