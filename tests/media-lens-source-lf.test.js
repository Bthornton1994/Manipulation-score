// Issue #118: mutation and source-anchor tests must behave the same on CRLF
// (Windows core.autocrlf=true) and LF checkouts. Multi-line LF anchors used by
// the SSRF mutators must still match a CRLF copy of the worker source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLf, readSourceLf } from './helpers/read-source-lf.js';

const WORKER_SOURCES = [
  'media-lens/worker/address-policy.js',
  'media-lens/worker/pinned-http.js',
  'media-lens/worker/safe-fetch.js',
  'media-lens/worker/host-key.js',
  'media-lens/worker/config.js',
  'media-lens/worker/server.js'
];

// Same multi-line anchor mutation M1 replaces in tests/media-lens-ssrf-mutation.test.js.
const M1_PIN_ANCHOR = `      const pinnedOptions = {
        ...options,
        host: pin.address,
        hostname: pin.address,
        family: pin.family,
        lookup
      };`;

test('normalizeLf converts CRLF to LF and leaves LF and lone CR untouched', () => {
  assert.equal(normalizeLf('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(normalizeLf('a\nb\n'), 'a\nb\n');
  assert.equal(normalizeLf('a\rb'), 'a\rb');
});

test('readSourceLf returns LF-only text for every worker source used by mutation tests', async () => {
  for (const path of WORKER_SOURCES) {
    const src = await readSourceLf(path);
    assert.equal(src.includes('\r\n'), false, `${path} must be LF after readSourceLf`);
    assert.ok(src.length > 0, path);
  }
});

test('multi-line mutation anchor matches a CRLF checkout after normalization', async () => {
  const lf = normalizeLf(await readFile('media-lens/worker/pinned-http.js', 'utf8'));
  assert.ok(lf.includes(M1_PIN_ANCHOR), 'M1 anchor must exist in pinned-http.js');

  const dir = await mkdtemp(join(tmpdir(), 'media-lens-source-lf-'));
  const crlfPath = join(dir, 'pinned-http.js');
  await writeFile(crlfPath, lf.replace(/\n/g, '\r\n'));

  const rawCrlf = await readFile(crlfPath, 'utf8');
  assert.equal(rawCrlf.includes(M1_PIN_ANCHOR), false, 'raw CRLF text must not match the LF anchor');

  const normalized = await readSourceLf(crlfPath);
  assert.ok(normalized.includes(M1_PIN_ANCHOR), 'normalized CRLF text must match the LF anchor');
  assert.notEqual(normalized.replace(M1_PIN_ANCHOR, 'MUTATED'), normalized, 'mutator must change normalized source');
});
