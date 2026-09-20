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

const CLARITY_PRIVACY_SUMMARY =
  'We do not operate accounts, servers that receive your pasted text, or analytics that track what you analyze.';
const CLARITY_PRIVACY_HOW_ANALYSIS_WORKS =
  'When you analyze a message, processing happens entirely in your browser using local JavaScript. Nothing is uploaded to Clarity or any third-party service for analysis.';
const MEDIA_LENS_PRIVACY_DISCLOSURE =
  'Media Lens is an unreleased, separate preview for public articles, advertisements, speeches, and campaign material. It is not deployed on this site. Its default fixture mode uses local example material and makes no network calls. Do not enter private messages or material you are not authorized to review. Any future live mode that sends prepared public text to an external service will require separate informed consent, an updated privacy notice, and additional security review before enablement. Clarity’s private analyzer remains governed by the on-device behavior described above.';

test('privacy.html keeps Clarity analysis language unchanged and adds the Media Lens preview disclosure after it', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, new RegExp(CLARITY_PRIVACY_SUMMARY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(CLARITY_PRIVACY_HOW_ANALYSIS_WORKS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, new RegExp(MEDIA_LENS_PRIVACY_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const howIdx = html.indexOf('<h2>How analysis works</h2>');
  const mediaLensIdx = html.indexOf('<h2>Media Lens preview</h2>');
  const futureLiveIdx = html.indexOf('<h2>Future Media Lens live URL (not available)</h2>');
  const localIdx = html.indexOf('<h2>Local storage on your device</h2>');
  assert.ok(
    howIdx !== -1 && mediaLensIdx !== -1 && futureLiveIdx !== -1 && localIdx !== -1,
    'expected How analysis works, Media Lens preview, Future Media Lens live URL, and Local storage headings'
  );
  const claimsIdx = html.indexOf('<h2>Media Lens public claims (flags off)</h2>');
  assert.ok(claimsIdx !== -1, 'expected Media Lens public claims heading');
  assert.ok(
    howIdx < mediaLensIdx && mediaLensIdx < futureLiveIdx && futureLiveIdx < claimsIdx && claimsIdx < localIdx,
    'Media Lens preview then future live URL then public claims must sit after How analysis works and before Local storage'
  );
  assert.match(html, /The Summary and How analysis works sections describe Clarity, the private message analyzer\./);
  assert.doesNotMatch(html, /live Media Lens processing is currently available/i);
  assert.doesNotMatch(html, /Media Lens is deployed on this site/i);
});

test('/health never echoes a key value even when one is configured', async () => {
  const { loadConfig, publicConfig } = await import('../media-lens/worker/config.js');
  const config = loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_TYPESAFE_API_KEY: 'super-secret-value-123' });
  const serialized = JSON.stringify(publicConfig(config));
  assert.doesNotMatch(serialized, /super-secret-value-123/);
});
