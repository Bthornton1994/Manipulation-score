// Group retrieved feed records into story clusters. A shared title is
// same_story, not independent reporting. Wire, press-release, and partner
// URLs are syndicated from the same markers fusion.js already uses.

import { createHash } from 'node:crypto';
import { normalizedURLKey } from '../url-key.js';
import { isPartnerRepublicationHost, isWireOrAdvocacyUrl } from '../fusion.js';

export const OMISSION_NOTE =
  'A missing article is not proof an outlet omitted this story. Counts reflect only the sources checked in the stated window.';

export const FRAME_NOTE = 'No coverage-frame comparison was available for this cluster.';

export const SAME_STORY_NOT_INDEPENDENT =
  'A matching title is same-story evidence only. It is not independent reporting.';

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function clusterIdFor(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function labelMember(record, seenUrlKeys) {
  const urlKey = normalizedURLKey(record.canonical_url);
  if (isWireOrAdvocacyUrl(record.canonical_url) || isPartnerRepublicationHost(record.canonical_url)) {
    return {
      relation: 'syndicated',
      labeling_basis: 'wire_press_release_or_partner_url',
      independent_reporting: false
    };
  }
  if (urlKey && seenUrlKeys.has(urlKey)) {
    return {
      relation: 'syndicated',
      labeling_basis: 'same_canonical_url',
      independent_reporting: false
    };
  }
  // origin_evidence is a tag the feed itself supplied
  // (mediaLens:originEvidence). This repository only has that tag in fixture
  // XML. It is not a separate evidence store.
  if (record.origin_evidence === 'first_independent_report') {
    return {
      relation: 'independent_reporting',
      labeling_basis: 'feed_supplied_tag_first_independent_report',
      independent_reporting: true
    };
  }
  return {
    relation: 'same_story',
    labeling_basis: 'normalized_title_match',
    independent_reporting: false
  };
}

export function clusterRecords(records, { window, sourcesChecked }) {
  const groups = new Map();
  for (const record of records) {
    const titleKey = normalizeTitle(record.article_title);
    if (!titleKey) continue;
    if (!groups.has(titleKey)) groups.set(titleKey, []);
    groups.get(titleKey).push(record);
  }

  const clusters = [];
  for (const [titleKey, members] of groups) {
    const seenUrlKeys = new Set();
    const labeled = members.map((record) => {
      const label = labelMember(record, seenUrlKeys);
      const urlKey = normalizedURLKey(record.canonical_url);
      if (urlKey) seenUrlKeys.add(urlKey);
      return {
        outlet: record.outlet,
        article_title: record.article_title,
        published_at: record.published_at,
        canonical_url: record.canonical_url,
        retrieved_at: record.retrieved_at,
        source_id: record.source_id,
        relation: label.relation,
        labeling_basis: label.labeling_basis,
        independent_reporting: label.independent_reporting
      };
    });
    const independent = labeled.filter((member) => member.independent_reporting);
    clusters.push({
      cluster_id: clusterIdFor(`${titleKey}|${window.start}`),
      title: members[0].article_title,
      cluster_basis: 'normalized_title',
      window,
      sources_checked: sourcesChecked.map((source) => source.source_id),
      members: labeled,
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
    });
  }

  clusters.sort((a, b) => a.title.localeCompare(b.title));
  return clusters;
}

export function compareCluster(cluster) {
  const members = cluster?.members || [];
  return {
    cluster_id: cluster?.cluster_id || null,
    retrieved_reports: members,
    syndicated: members.filter((member) => member.relation === 'syndicated'),
    same_story_not_independent: members.filter((member) => member.relation === 'same_story'),
    independent_reporting: cluster?.independent_reporting || [],
    frames: [],
    frame_note: FRAME_NOTE,
    coverage_gap: null,
    omission_note: OMISSION_NOTE,
    same_story_note: SAME_STORY_NOT_INDEPENDENT,
    article_pages_fetched: false
  };
}
