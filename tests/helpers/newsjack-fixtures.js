// Shared Newsjack capture fixtures for tests. The raw files in
// media-lens/fixtures/newsjack-capture/ are hand-written to follow the key
// structure, story-size shape, scores, and source status the pinned Newsjack
// v0.1.19 source emits for the default empty profile. Some evidence values are
// unusual on purpose (see media-lens/docs/newsjack-discovery.md). They were
// not produced by a Newsjack binary.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectCapture } from '../../media-lens/tools/newsjack-raw.js';
import { NEWSJACK_PIN } from '../../media-lens/worker/discovery/newsjack-pin.js';

export const NEWSJACK_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'media-lens', 'fixtures', 'newsjack-capture');

export function rawText(name) {
  return readFileSync(join(NEWSJACK_FIXTURE_DIR, name), 'utf8');
}

export function raw(name) {
  return JSON.parse(rawText(name));
}

export const FIXTURE_REQUEST = Object.freeze({ query: 'transit fare vote', depth: 'quick', lookback_days: 1, max_age_hours: 24, limit: 20 });

// Synthetic runner observations that bracket the raw files' own clocks.
export const FIXTURE_TIMINGS = Object.freeze({
  version: ['2026-09-25T17:59:59.900Z', '2026-09-25T17:59:59.950Z'],
  detector_run: ['2026-09-25T18:00:00.000Z', '2026-09-25T18:00:03.410Z'],
  cluster: ['2026-09-25T18:00:03.420Z', '2026-09-25T18:00:03.470Z'],
  origin_apply: ['2026-09-25T18:00:03.480Z', '2026-09-25T18:00:03.520Z']
});

export function timing(step) {
  const [started, exited] = FIXTURE_TIMINGS[step];
  return { startedMs: Date.parse(started), exitedMs: Date.parse(exited) };
}

function step(name, file) {
  const [started, exited] = FIXTURE_TIMINGS[name];
  return {
    step: name,
    started_at: started,
    exited_at: exited,
    exit_code: 0,
    timed_out: false,
    stdout_bytes: file ? Buffer.byteLength(rawText(file)) : Buffer.byteLength('v0.1.19\n'),
    stderr_bytes: 0
  };
}

export function buildFixtureCapture({ withOrigin = true } = {}) {
  const steps = [step('version'), step('detector_run', 'raw-detector.json'), step('cluster', 'raw-cluster.json')];
  if (withOrigin) steps.push(step('origin_apply', 'raw-origin.json'));
  return projectCapture({
    request: FIXTURE_REQUEST,
    pin: NEWSJACK_PIN,
    binarySha256: null,
    mode: 'fixture',
    steps,
    candidates: raw('raw-detector.json'),
    clustered: raw('raw-cluster.json'),
    targeted: withOrigin ? raw('raw-origin.json') : null,
    findingsSha256: withOrigin ? createHash('sha256').update(rawText('origin-findings.json')).digest('hex') : null
  });
}

// A pin for tests that run fake binaries. Production code never accepts a
// pin from a flag or environment variable.
export function testPin(binarySha256) {
  return {
    ...NEWSJACK_PIN,
    binaries: { ...NEWSJACK_PIN.binaries, [`${process.platform}-${process.arch}`]: binarySha256 }
  };
}
