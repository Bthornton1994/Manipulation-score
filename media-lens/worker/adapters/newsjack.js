// Newsjack substrate seam. `fixture` mode (the v1 default) reads
// fixtures/newsjack/<id>.json. `artifacts` mode reads a Newsjack run
// directory produced out-of-band by an operator running the Newsjack
// detector/skills in their own agent, and matches by normalized URL. The
// worker never spawns the Newsjack CLI and never calls Medialyst; `cli`
// mode is intentionally unimplemented in v1 (see docs/media-lens-influence-graph-plan.md
// section 6) so the seam exists without adding a supply-chain dependency.
//
// Contract shapes (story_origin, freshness_gate, cluster field names) are
// reused verbatim from Newsjack (https://github.com/elvisun/newsjack) as
// data contracts only; no Go code or skills prose is copied. See
// docs/NEWSJACK-LICENSE.md.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { abortableDelay, throwIfAborted } from '../abort-utils.js';
import { mapNewsjackEvidenceToStoryDiscovery } from '../discovery/newsjack-discovery.js';
import { normalizedURLKey } from '../url-key.js';

export function emptyStoryContext(provenance = 'none') {
  return {
    story_origin: null,
    freshness_gate: null,
    cluster: null,
    provenance
  };
}

async function readFixture(fixtureDir, fixtureId, signal) {
  throwIfAborted(signal);
  const path = join(fixtureDir, `${fixtureId}.json`);
  let raw;
  try {
    raw = await readFile(path, { encoding: 'utf8', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return emptyStoryContext('none');
  }
  const parsed = JSON.parse(raw);
  return {
    story_origin: parsed.story_origin ?? null,
    freshness_gate: parsed.freshness_gate ?? null,
    cluster: parsed.cluster ?? null,
    provenance: 'fixture'
  };
}

async function readArtifactsDir(artifactsDir, { url, canonical_url, signal }) {
  throwIfAborted(signal);
  let entries;
  try {
    entries = await readdir(artifactsDir, { signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return emptyStoryContext('none');
  }
  const candidatesFile = entries.find((f) => f === 'candidates.json');
  const clusterFile = entries.find((f) => f === 'cluster.json');
  if (!candidatesFile) return emptyStoryContext('none');

  const candidates = JSON.parse(await readFile(join(artifactsDir, candidatesFile), { encoding: 'utf8', signal }));
  const targetKey = normalizedURLKey(canonical_url) || normalizedURLKey(url);
  const match = (Array.isArray(candidates) ? candidates : candidates.items || []).find((c) => normalizedURLKey(c.url) === targetKey);
  if (!match) return emptyStoryContext('none');

  let cluster = null;
  if (clusterFile) {
    const clusterData = JSON.parse(await readFile(join(artifactsDir, clusterFile), { encoding: 'utf8', signal }));
    cluster = (Array.isArray(clusterData) ? clusterData : clusterData.clusters || []).find(
      (c) => (c.members || []).some((m) => normalizedURLKey(m.url) === targetKey)
    ) || null;
  }

  return {
    story_origin: match.story_origin || null,
    freshness_gate: match.freshness_gate || null,
    cluster,
    provenance: 'newsjack_artifacts'
  };
}

/**
 * Create a Newsjack adapter bound to a mode.
 */
export function createNewsjackAdapter({ mode, fixtureId = null, fixtureDir = null, artifactsDir = null }) {
  async function getStoryContext({ url, canonical_url, title, published_at, signal } = {}) {
    throwIfAborted(signal);
    if (mode === 'disabled') return emptyStoryContext('none');
    if (mode === 'fixture') {
      if (!fixtureId) return emptyStoryContext('none');
      return readFixture(fixtureDir, fixtureId, signal);
    }
    if (mode === 'artifacts') {
      if (!artifactsDir) return emptyStoryContext('none');
      await abortableDelay(0, signal);
      return readArtifactsDir(artifactsDir, { url, canonical_url, title, published_at, signal });
    }
    if (mode === 'cli') {
      throw new Error('Newsjack CLI mode is not implemented in v1 (see plan section 6 / 11)');
    }
    throw new Error(`Unknown Newsjack adapter mode: ${mode}`);
  }

  async function discoverStoryDocument({ retrievedAt, window, query = null, signal } = {}) {
    throwIfAborted(signal);
    if (mode === 'cli') {
      throw new Error('Newsjack CLI mode is not implemented in v1 (see plan section 6 / 11)');
    }
    if (mode === 'disabled') {
      return mapNewsjackEvidenceToStoryDiscovery({
        retrievedAt,
        window,
        providerId: 'newsjack:disabled',
        providerMode: 'fixture',
        freshnessGrade: 'fixture',
        query,
        hits: [],
        dataOrigin: 'fixture'
      });
    }
    if (mode === 'fixture') {
      if (!fixtureId || !fixtureDir) {
        return mapNewsjackEvidenceToStoryDiscovery({
          retrievedAt,
          window,
          query,
          hits: [],
          dataOrigin: 'fixture'
        });
      }
      const parsed = JSON.parse(await readFile(join(fixtureDir, `${fixtureId}.json`), { encoding: 'utf8', signal }));
      return mapNewsjackEvidenceToStoryDiscovery({
        retrievedAt,
        window: parsed.window || window,
        providerId: 'fixture:newsjack_shaped',
        providerMode: 'fixture',
        freshnessGrade: 'fixture',
        query,
        clusters: discoveryClusters(parsed),
        origin: parsed.story_origin || parsed.origin_findings || null,
        dataOrigin: 'fixture'
      });
    }
    if (mode === 'artifacts') {
      if (!artifactsDir) {
        return mapNewsjackEvidenceToStoryDiscovery({
          retrievedAt,
          window,
          providerId: 'newsjack:artifacts',
          providerMode: 'fixture',
          freshnessGrade: 'unknown',
          query,
          hits: [],
          dataOrigin: 'newsjack_artifacts'
        });
      }
      const loaded = await readDiscoveryArtifacts(artifactsDir, signal);
      return mapNewsjackEvidenceToStoryDiscovery({
        retrievedAt,
        window: loaded.window || window,
        providerId: 'newsjack:artifacts',
        providerMode: 'fixture',
        freshnessGrade: 'unknown',
        query,
        clusters: loaded.clusters,
        origin: loaded.origin,
        dataOrigin: 'newsjack_artifacts'
      });
    }
    throw new Error(`Unknown Newsjack adapter mode: ${mode}`);
  }

  return { mode, getStoryContext, discoverStoryDocument };
}

function discoveryClusters(parsed) {
  if (Array.isArray(parsed?.clusters)) return parsed.clusters;
  if (Array.isArray(parsed?.members)) {
    return [{ cluster_id: parsed.cluster_id || null, members: parsed.members }];
  }
  const cluster = parsed?.cluster;
  if (!cluster) return [];
  const list = Array.isArray(cluster) ? cluster : [cluster];
  return list.map((item) => ({
    cluster_id: item.cluster_id || null,
    members: item.members || []
  }));
}

async function readDiscoveryArtifacts(artifactsDir, signal) {
  throwIfAborted(signal);
  let entries;
  try {
    entries = await readdir(artifactsDir, { signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { clusters: [], origin: null, window: null };
  }
  const clusterName = ['clustered_candidates.json', 'cluster.json'].find((name) => entries.includes(name));
  const originName = ['origin_findings.json', 'story_origin.json'].find((name) => entries.includes(name));
  let clusters = [];
  let window = null;
  if (clusterName) {
    const parsed = JSON.parse(await readFile(join(artifactsDir, clusterName), { encoding: 'utf8', signal }));
    window = parsed?.window || null;
    if (Array.isArray(parsed)) clusters = discoveryClusters({ cluster: parsed });
    else clusters = discoveryClusters(parsed);
  }
  let origin = null;
  if (originName) {
    const parsed = JSON.parse(await readFile(join(artifactsDir, originName), { encoding: 'utf8', signal }));
    origin = parsed.story_origin || parsed;
  }
  return { clusters, origin, window };
}
