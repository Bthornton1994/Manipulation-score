// Story discovery. Live network runs only when MEDIA_LENS_ENABLE_STORY_DISCOVERY
// is the exact string true AND the source is approved. Pending candidates are
// never fetched. Fixture XML is labeled and is refused in live mode.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArticleUrl } from '../address-policy.js';
import { fetchArticleSafely } from '../safe-fetch.js';
import { SOURCE_REGISTRY, approvedSources } from './source-registry.js';
import { parseFeedXml } from './feed-parse.js';
import { clusterRecords, compareCluster, OMISSION_NOTE } from './cluster.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/discovery');
const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 48;
const MAX_FEED_BYTES = 512 * 1024;

export const NOT_LIVE_MESSAGE =
  'Story discovery is not live. No feeds were checked. Article URL analysis does not discover stories or compare outlet coverage.';

export const NO_APPROVED_MESSAGE =
  'Story discovery is enabled, but no source is approved for retrieval. No feeds were checked. Candidate feeds were not fetched.';

function hoursFromQuery(raw) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_HOURS;
  return Math.min(MAX_WINDOW_HOURS, Math.max(1, parsed));
}

function windowFor(now, hours) {
  const end = new Date(now);
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), hours };
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

function notLiveDocument() {
  return baseDocument({
    status: 'not_live',
    reason: 'story_discovery_disabled',
    message: NOT_LIVE_MESSAGE,
    data_origin: 'none',
    fixture_labeled: false,
    retrieved_at: null,
    window: null,
    sources_checked: []
  });
}

export function assertApprovedFeedUrl(source) {
  if (!source || source.approval_status !== 'approved') {
    throw Object.assign(new Error('Source is not approved'), { code: 'SOURCE_NOT_APPROVED' });
  }
  const { parsed, bareHost, kind } = parseArticleUrl(source.feed_url);
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Feed URL must be https'), { code: 'BAD_SCHEME' });
  }
  if (kind !== 'dns' || bareHost !== source.feed_host) {
    throw Object.assign(new Error('Feed host is not the registered host'), { code: 'FEED_HOST_MISMATCH' });
  }
  return { parsed, bareHost };
}

function inWindow(record, window) {
  if (!record.published_at) return false;
  return record.published_at >= window.start && record.published_at <= window.end;
}

async function readLabeledFixtures() {
  const manifest = JSON.parse(await readFile(join(FIXTURE_DIR, 'manifest.json'), 'utf8'));
  const bodies = new Map();
  for (const entry of manifest.feeds) {
    bodies.set(entry.source_id, await readFile(join(FIXTURE_DIR, entry.file), 'utf8'));
  }
  return { sources: manifest.sources, bodies, label: manifest.label };
}

export async function discoverStories({
  config,
  now = new Date(),
  windowHours = DEFAULT_WINDOW_HOURS,
  registry = SOURCE_REGISTRY,
  fetchFeed = null,
  feedBodies = null,
  allowFixtures = false
} = {}) {
  const enabled = config?.storyDiscoveryEnabled === true;
  const liveMode = config?.mode === 'live';
  if (!enabled && !(allowFixtures && !liveMode)) return notLiveDocument();

  const window = windowFor(now, hoursFromQuery(windowHours));
  const retrievedAt = window.end;

  let sources = [];
  let bodies = feedBodies;
  let dataOrigin = 'live_feed';
  let fixtureLabeled = false;

  if (bodies) {
    if (liveMode) return notLiveDocument();
    sources = registry;
    dataOrigin = 'fixture';
    fixtureLabeled = true;
  } else if (allowFixtures && !liveMode) {
    const fixtures = await readLabeledFixtures();
    sources = fixtures.sources;
    bodies = fixtures.bodies;
    dataOrigin = 'fixture';
    fixtureLabeled = true;
  } else if (!enabled) {
    return notLiveDocument();
  } else {
    sources = approvedSources(registry);
    if (sources.length === 0) {
      return baseDocument({
        status: 'abstain',
        reason: 'no_approved_sources',
        message: NO_APPROVED_MESSAGE,
        data_origin: 'none',
        fixture_labeled: false,
        retrieved_at: null,
        window,
        sources_checked: []
      });
    }
  }

  const sourcesChecked = [];
  const records = [];
  for (const source of sources) {
    const checked = {
      source_id: source.source_id,
      outlet: source.outlet,
      feed_url: source.feed_url,
      checked_at: retrievedAt,
      outcome: 'not_checked',
      item_count: 0,
      stale_or_undated_excluded: 0,
      rejected_unsafe_or_incomplete: 0,
      error: null
    };
    try {
      if (source.approval_status !== 'approved' && dataOrigin !== 'fixture') {
        checked.outcome = 'skipped_not_approved';
        sourcesChecked.push(checked);
        continue;
      }
      let xml = bodies ? bodies.get(source.source_id) : null;
      if (!xml && dataOrigin === 'live_feed') {
        assertApprovedFeedUrl(source);
        const fetcher = fetchFeed || ((url) => fetchArticleSafely(url, {
          timeoutMs: 8000,
          maxBytes: MAX_FEED_BYTES,
          urlAllowlist: [source.feed_host]
        }));
        const response = await fetcher(source.feed_url, source);
        xml = typeof response === 'string' ? response : response?.body;
      }
      if (typeof xml !== 'string') {
        checked.outcome = 'empty';
        sourcesChecked.push(checked);
        continue;
      }
      const parsed = parseFeedXml(xml, source, retrievedAt);
      checked.rejected_unsafe_or_incomplete = parsed.rejected_unsafe_or_incomplete;
      let kept = 0;
      let excluded = 0;
      for (const record of parsed.records) {
        if (!inWindow(record, window)) {
          excluded += 1;
          continue;
        }
        records.push(record);
        kept += 1;
      }
      checked.item_count = kept;
      checked.stale_or_undated_excluded = excluded;
      checked.outcome = 'checked';
    } catch (err) {
      checked.outcome = 'failed';
      checked.error = err?.code || 'fetch_failed';
    }
    sourcesChecked.push(checked);
  }

  const clusters = clusterRecords(records, { window, sourcesChecked });
  const anyChecked = sourcesChecked.some((source) => source.outcome === 'checked');
  const status = clusters.length > 0 ? 'ok' : anyChecked ? 'empty' : 'abstain';
  const checkedOutlets = sourcesChecked.filter((source) => source.outcome === 'checked').map((source) => source.outlet);
  const message = clusters.length
    ? `Showing clusters from ${checkedOutlets.length} source${checkedOutlets.length === 1 ? '' : 's'} checked between ${window.start} and ${window.end}. ${OMISSION_NOTE}`
    : `No current stories were retrieved. Sources checked: ${checkedOutlets.join(', ') || 'none'}. Window ${window.start} to ${window.end}. ${OMISSION_NOTE}`;

  return baseDocument({
    status,
    reason: status === 'ok' ? 'clusters_from_retrieved_items' : 'no_current_items',
    message,
    data_origin: dataOrigin,
    fixture_labeled: fixtureLabeled,
    retrieved_at: retrievedAt,
    window,
    sources_checked: sourcesChecked,
    clusters
  });
}

export function clusterFromDocument(document, clusterId) {
  if (!document || document.status === 'not_live' || document.status === 'abstain' && !document.clusters?.length) {
    return document;
  }
  const cluster = (document.clusters || []).find((item) => item.cluster_id === clusterId);
  if (!cluster) {
    return baseDocument({
      status: 'empty',
      reason: 'cluster_not_in_retrieved_set',
      message: `No retrieved cluster has id ${clusterId}. ${OMISSION_NOTE}`,
      data_origin: document.data_origin,
      fixture_labeled: document.fixture_labeled === true,
      retrieved_at: document.retrieved_at,
      window: document.window,
      sources_checked: document.sources_checked || [],
      clusters: []
    });
  }
  return {
    ...document,
    clusters: [cluster],
    comparison: compareCluster(cluster)
  };
}

export { compareCluster };
