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
import { mapNewsjackEvidenceToStoryDiscovery, sanitizeWindow } from '../discovery/newsjack-discovery.js';
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
      const read = await readJsonArtifact(join(fixtureDir, `${fixtureId}.json`), `${fixtureId}.json`, signal, { allowArray: false });
      if (!read.ok) {
        return mapNewsjackEvidenceToStoryDiscovery({
          retrievedAt,
          window,
          providerId: 'fixture:newsjack_shaped',
          providerMode: 'fixture',
          freshnessGrade: 'fixture',
          query,
          dataOrigin: 'fixture',
          artifactRead: read
        });
      }
      const parsed = read.value;
      const fixtureClusters = discoveryClusters(parsed);
      if (fixtureClusters === null) {
        return mapNewsjackEvidenceToStoryDiscovery({
          retrievedAt,
          window,
          providerId: 'fixture:newsjack_shaped',
          providerMode: 'fixture',
          freshnessGrade: 'fixture',
          query,
          dataOrigin: 'fixture',
          artifactRead: { ok: false, reason: 'invalid', error: 'artifact_shape_invalid', file: `${fixtureId}.json` }
        });
      }
      return mapNewsjackEvidenceToStoryDiscovery({
        retrievedAt,
        window: sanitizeWindow(parsed.window) || window,
        providerId: 'fixture:newsjack_shaped',
        providerMode: 'fixture',
        freshnessGrade: 'fixture',
        query,
        clusters: fixtureClusters,
        origin: parsed.story_origin || parsed.origin_findings || null,
        dataOrigin: 'fixture'
      });
    }
    if (mode === 'artifacts') {
      const loaded = artifactsDir
        ? await readDiscoveryArtifacts(artifactsDir, signal)
        : { ok: false, error: 'artifacts_dir_missing', clusters: [], origin: null, window: null };
      return mapNewsjackEvidenceToStoryDiscovery({
        retrievedAt,
        window: sanitizeWindow(loaded.window) || window,
        providerId: 'newsjack:artifacts',
        providerMode: 'fixture',
        freshnessGrade: 'unknown',
        query,
        clusters: loaded.ok ? loaded.clusters : [],
        origin: loaded.ok ? loaded.origin : null,
        dataOrigin: 'newsjack_artifacts',
        artifactRead: loaded.ok ? { ok: true } : { ok: false, reason: loaded.reason, error: loaded.error, file: loaded.file }
      });
    }
    throw new Error(`Unknown Newsjack adapter mode: ${mode}`);
  }

  return { mode, getStoryContext, discoverStoryDocument };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Returns the cluster groups, or null when the shape is not usable (a group
// that is not an object, or members that are not an array). Callers treat
// null as an invalid artifact instead of guessing.
function discoveryClusters(parsed) {
  const has = (key) => Boolean(parsed) && Object.prototype.hasOwnProperty.call(parsed, key);
  let groups;
  if (has('clusters')) {
    if (!Array.isArray(parsed.clusters)) return null;
    groups = parsed.clusters;
  } else if (has('members')) {
    groups = [{ cluster_id: parsed.cluster_id || null, members: parsed.members }];
  } else if (has('cluster')) {
    const cluster = parsed.cluster;
    if (Array.isArray(cluster)) groups = cluster;
    else if (isPlainObject(cluster)) groups = [cluster];
    else return null;
  } else {
    return [];
  }
  const out = [];
  for (const item of groups) {
    if (!isPlainObject(item)) return null;
    const members = item.members === undefined ? [] : item.members;
    if (!Array.isArray(members)) return null;
    out.push({ cluster_id: typeof item.cluster_id === 'string' ? item.cluster_id : null, members });
  }
  return out;
}

// Read and parse one JSON artifact. Never throws for file or JSON problems:
// a read error, malformed JSON, or an unexpected top-level type becomes a
// fail-closed result the mapper turns into an abstention. Aborts still throw.
async function readJsonArtifact(path, file, signal, { allowArray }) {
  let text;
  try {
    text = await readFile(path, { encoding: 'utf8', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ok: false, reason: 'unavailable', error: err?.code || 'artifact_unreadable', file };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid', error: 'artifact_json_invalid', file };
  }
  if (!(isPlainObject(value) || (allowArray && Array.isArray(value)))) {
    return { ok: false, reason: 'invalid', error: 'artifact_shape_invalid', file };
  }
  return { ok: true, value };
}

async function readDiscoveryArtifacts(artifactsDir, signal) {
  throwIfAborted(signal);
  let entries;
  try {
    entries = await readdir(artifactsDir, { signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ok: false, reason: 'unavailable', error: err?.code || 'artifacts_unreadable', clusters: [], origin: null, window: null };
  }
  const clusterName = ['clustered_candidates.json', 'cluster.json'].find((name) => entries.includes(name));
  const originName = ['origin_findings.json', 'story_origin.json'].find((name) => entries.includes(name));
  let clusters = [];
  let window = null;
  if (clusterName) {
    const read = await readJsonArtifact(join(artifactsDir, clusterName), clusterName, signal, { allowArray: true });
    if (!read.ok) return { ...read, clusters: [], origin: null, window: null };
    const parsed = read.value;
    window = isPlainObject(parsed) ? parsed.window || null : null;
    clusters = Array.isArray(parsed) ? discoveryClusters({ cluster: parsed }) : discoveryClusters(parsed);
    if (clusters === null) {
      return { ok: false, reason: 'invalid', error: 'artifact_shape_invalid', file: clusterName, clusters: [], origin: null, window: null };
    }
  }
  let origin = null;
  if (originName) {
    const read = await readJsonArtifact(join(artifactsDir, originName), originName, signal, { allowArray: false });
    if (!read.ok) return { ...read, clusters: [], origin: null, window: null };
    const candidate = isPlainObject(read.value.story_origin) ? read.value.story_origin : read.value;
    origin = candidate;
  }
  return { ok: true, clusters, origin, window };
}
