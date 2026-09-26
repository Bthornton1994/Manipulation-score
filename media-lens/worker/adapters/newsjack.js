// Newsjack story-context seam for article analysis. `fixture` mode (the
// fixture-worker default) reads the repository's labeled examples in
// fixtures/newsjack/<id>.json. `disabled` returns an empty context and is
// what a live worker uses: live analysis reads no Newsjack output.
//
// The worker never spawns the Newsjack CLI and never calls Medialyst. Real
// Newsjack runs happen only through the operator tool in media-lens/tools/,
// outside the worker; see media-lens/docs/newsjack-discovery.md.
//
// The fixture field names (story_origin, freshness_gate, cluster) follow
// Newsjack's data contract only; no Newsjack code is copied. See
// docs/NEWSJACK-LICENSE.md.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { throwIfAborted } from '../abort-utils.js';

export const NEWSJACK_ADAPTER_MODES = Object.freeze(['fixture', 'disabled']);

export function emptyStoryContext(provenance = 'none') {
  return {
    story_origin: null,
    freshness_gate: null,
    cluster: null,
    provenance
  };
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
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
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyStoryContext('none');
  }
  if (!objectOrNull(parsed)) return emptyStoryContext('none');
  const fields = ['story_origin', 'freshness_gate', 'cluster'];
  if (fields.some((field) => parsed[field] !== undefined && parsed[field] !== null && !objectOrNull(parsed[field]))) {
    return emptyStoryContext('none');
  }
  return {
    story_origin: parsed.story_origin ?? null,
    freshness_gate: parsed.freshness_gate ?? null,
    cluster: parsed.cluster ?? null,
    provenance: 'fixture'
  };
}

/**
 * Create a Newsjack adapter bound to a mode. Unknown modes, including the
 * removed `artifacts` and `cli` modes, throw at construction.
 */
export function createNewsjackAdapter({ mode, fixtureId = null, fixtureDir = null } = {}) {
  if (!NEWSJACK_ADAPTER_MODES.includes(mode)) {
    throw new Error(`Unknown Newsjack adapter mode: ${mode}`);
  }

  async function getStoryContext({ signal } = {}) {
    throwIfAborted(signal);
    if (mode === 'disabled' || !fixtureId || !fixtureDir) return emptyStoryContext('none');
    return readFixture(fixtureDir, fixtureId, signal);
  }

  return { mode, getStoryContext };
}
