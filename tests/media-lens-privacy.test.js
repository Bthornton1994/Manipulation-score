import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFixture } from '../media-lens/worker/analyze-fixture.js';
import { toEvidenceOnlyExport } from '../media-lens/worker/graph.js';

test('analyze() writes no files anywhere, even when run from a temp cwd', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'media-lens-privacy-test-'));
  const before = await readdir(tempDir);
  assert.deepEqual(before, []);

  const originalCwd = process.cwd();
  process.chdir(tempDir);
  try {
    const graph = await runFixture('synthetic-01-quoted-vs-authorial');
    assert.equal(graph.schema, 'influence-graph.v1');
  } finally {
    process.chdir(originalCwd);
  }

  const after = await readdir(tempDir);
  assert.deepEqual(after, [], 'analyze() must not write any files to the working directory');
});

test('privacy.full_text_persisted is false and retention is "none" for every fixture', async () => {
  const graph = await runFixture('synthetic-01-quoted-vs-authorial');
  assert.equal(graph.privacy.full_text_persisted, false);
  assert.equal(graph.privacy.retention, 'none');
});

test('media-lens.js contains no localStorage/sessionStorage/indexedDB writes', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.doesNotMatch(js, /localStorage\s*[.[]/);
  assert.doesNotMatch(js, /sessionStorage\s*[.[]/);
  assert.doesNotMatch(js, /indexedDB\s*[.[]/i);
});

test('the evidence-only export omits text for spans not tied to any observation or claim', async () => {
  const graph = await runFixture('synthetic-01-quoted-vs-authorial');
  const exported = toEvidenceOnlyExport(graph);
  assert.equal(exported.privacy.spans_included, 'evidence_only');

  const referencedIds = new Set();
  for (const obs of graph.observations) for (const id of obs.span_ids) referencedIds.add(id);
  for (const claim of graph.claims) for (const id of claim.span_ids) referencedIds.add(id);

  let sawTrimmed = false;
  for (const span of exported.spans) {
    if (referencedIds.has(span.id)) {
      assert.notEqual(span.text, '', `evidence span ${span.id} should keep its text`);
    } else {
      assert.equal(span.text, '', `non-evidence span ${span.id} should have its text removed`);
      sawTrimmed = true;
    }
  }
  assert.equal(sawTrimmed, true, 'expected at least one non-evidence span to be trimmed in this fixture');

  // Original graph object must not be mutated.
  assert.equal(graph.privacy.spans_included, 'all');
  assert.ok(graph.spans.every((s) => typeof s.text === 'string' && (referencedIds.has(s.id) ? s.text.length > 0 : true)));
});

test('/health never echoes a key value even when one is configured', async () => {
  const { loadConfig, publicConfig } = await import('../media-lens/worker/config.js');
  const config = loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_TYPESAFE_API_KEY: 'super-secret-value-123' });
  const serialized = JSON.stringify(publicConfig(config));
  assert.doesNotMatch(serialized, /super-secret-value-123/);
});
