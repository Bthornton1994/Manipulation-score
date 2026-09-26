// Hand checks for story-discovery.v1 documents. Not a claim that a live
// source set is approved.

const STATUSES = new Set(['not_live', 'abstain', 'ok', 'empty']);
const RELATIONS = new Set(['syndicated', 'same_story', 'independent_reporting']);

export function validateStoryDiscovery(document) {
  const errors = [];
  if (!document || document.contract !== 'story-discovery.v1') errors.push('contract');
  if (!STATUSES.has(document?.status)) errors.push('status');
  if (!Array.isArray(document?.sources_checked)) errors.push('sources_checked');
  if (!Array.isArray(document?.clusters)) errors.push('clusters');
  if (document?.privacy?.full_text_persisted !== false) errors.push('retention');
  if (document?.privacy?.jev_used !== false) errors.push('jev');
  if (document?.data_origin === 'fixture' && document?.fixture_labeled !== true) errors.push('fixture_label');
  for (const cluster of document?.clusters || []) {
    if (!cluster.cluster_id || !cluster.cluster_basis || !cluster.window) errors.push('cluster_fields');
    if (cluster.coverage_gap !== null) errors.push('invented_gap');
    if (!Array.isArray(cluster.frames) || cluster.frames.length !== 0) errors.push('frames');
    for (const member of cluster.members || []) {
      if (!member.outlet || !member.article_title || !member.canonical_url || !member.retrieved_at) {
        errors.push('source_record');
      }
      if (!RELATIONS.has(member.relation) || typeof member.labeling_basis !== 'string') errors.push('relation');
      if (member.relation === 'same_story' && member.independent_reporting !== false) errors.push('same_story_independent');
    }
    const expected = (cluster.members || []).filter((member) => member.independent_reporting).map((member) => member.canonical_url);
    const listed = (cluster.independent_reporting || []).map((item) => item.canonical_url);
    if (expected.join('|') !== listed.join('|')) errors.push('independent_list');
  }
  return { ok: errors.length === 0, errors };
}
