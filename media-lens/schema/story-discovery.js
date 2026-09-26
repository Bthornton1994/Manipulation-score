// Hand checks for story-discovery.v1 documents. Not a claim that a live
// source set is approved. Never throws on malformed input.

const STATUSES = new Set(['not_live', 'abstain', 'ok', 'empty']);
const RELATIONS = new Set(['syndicated', 'same_story', 'independent_reporting']);
const STRICT_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isStrictUtcMs(value) {
  if (typeof value !== 'string' || !STRICT_UTC_MS.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

// A document built from a Newsjack capture. These carry extra invariants:
// one runner-observed retrieval time, a window Media Lens derived itself,
// no independent reporting, and origin claims labeled unverified.
function isNewsjackDocument(document) {
  if (document?.provenance?.tool === 'newsjack') return true;
  if (list(document?.sources_checked).some((row) => typeof row?.provider === 'string' && row.provider.startsWith('newsjack'))) return true;
  return list(document?.clusters).some(
    (cluster) =>
      (typeof cluster?.cluster_basis === 'string' && cluster.cluster_basis.startsWith('newsjack_')) ||
      list(cluster?.members).some((member) => typeof member?.source_id === 'string' && member.source_id.startsWith('newsjack:'))
  );
}

function checkNewsjack(document, errors) {
  if (document.status !== 'ok' && document.status !== 'empty') return;
  const window = document.window;
  const retrievedAt = document.retrieved_at;
  const windowOk =
    isObject(window) &&
    isStrictUtcMs(retrievedAt) &&
    window.end === retrievedAt &&
    Number.isInteger(window.hours) &&
    window.hours >= 1 &&
    window.hours <= 48 &&
    isStrictUtcMs(window.start) &&
    Date.parse(window.end) - Date.parse(window.start) === window.hours * 60 * 60 * 1000;
  if (!windowOk) errors.push('newsjack_window');
  for (const cluster of list(document.clusters)) {
    if (list(cluster?.independent_reporting).length !== 0 || (cluster?.independent_outlet_count ?? 0) !== 0) errors.push('newsjack_independence');
    for (const member of list(cluster?.members)) {
      if (member?.retrieved_at !== retrievedAt) errors.push('newsjack_retrieved_at');
      if (member?.independent_reporting !== false || member?.relation === 'independent_reporting') errors.push('newsjack_independence');
    }
    for (const claim of list(cluster?.origin_claims)) {
      if (claim?.verification !== 'unverified' || claim?.authored_by !== 'ai_agent_via_story_origin_skill') errors.push('newsjack_origin_label');
    }
  }
}

export function validateStoryDiscovery(document) {
  const errors = [];
  if (!isObject(document) || document.contract !== 'story-discovery.v1') errors.push('contract');
  if (!STATUSES.has(document?.status)) errors.push('status');
  if (!Array.isArray(document?.sources_checked)) errors.push('sources_checked');
  if (!Array.isArray(document?.clusters)) errors.push('clusters');
  if (document?.privacy?.full_text_persisted !== false) errors.push('retention');
  if (document?.privacy?.jev_used !== false) errors.push('jev');
  if (document?.data_origin === 'fixture' && document?.fixture_labeled !== true) errors.push('fixture_label');
  for (const cluster of list(document?.clusters)) {
    if (!isObject(cluster)) {
      errors.push('cluster_fields');
      continue;
    }
    if (!cluster.cluster_id || !cluster.cluster_basis || !cluster.window) errors.push('cluster_fields');
    if (cluster.coverage_gap !== null) errors.push('invented_gap');
    if (!Array.isArray(cluster.frames) || cluster.frames.length !== 0) errors.push('frames');
    if (!Array.isArray(cluster.members)) errors.push('members');
    if (cluster.independent_reporting !== undefined && !Array.isArray(cluster.independent_reporting)) errors.push('independent_list');
    for (const member of list(cluster.members)) {
      if (!isObject(member)) {
        errors.push('source_record');
        continue;
      }
      if (!member.outlet || !member.article_title || !member.canonical_url || !member.retrieved_at) {
        errors.push('source_record');
      }
      if (member.retrieved_at && !isStrictUtcMs(member.retrieved_at)) errors.push('retrieved_at_format');
      if (!RELATIONS.has(member.relation) || typeof member.labeling_basis !== 'string') errors.push('relation');
      if (member.relation === 'same_story' && member.independent_reporting !== false) errors.push('same_story_independent');
    }
    const expected = list(cluster.members).filter((member) => member?.independent_reporting).map((member) => member.canonical_url);
    const listed = list(cluster.independent_reporting).map((item) => item?.canonical_url);
    if (expected.join('|') !== listed.join('|')) errors.push('independent_list');
    // Independent reporting counts outlets, not URLs: no two rows may share an
    // outlet name or a host.
    const names = new Set();
    const hosts = new Set();
    for (const item of list(cluster.independent_reporting)) {
      const name = String(item?.outlet || '').trim().replace(/\s+/g, ' ').toLowerCase();
      let host = '';
      try {
        host = new URL(item?.canonical_url).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        host = '';
      }
      if ((name && names.has(name)) || (host && hosts.has(host))) errors.push('independent_outlet_repeated');
      if (name) names.add(name);
      if (host) hosts.add(host);
    }
    if (cluster.independent_outlet_count !== undefined && cluster.independent_outlet_count !== listed.length) {
      errors.push('independent_outlet_count');
    }
  }
  if (isObject(document) && isNewsjackDocument(document)) checkNewsjack(document, errors);
  return { ok: errors.length === 0, errors };
}
