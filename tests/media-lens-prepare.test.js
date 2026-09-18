import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareFromHtml, prepareFromPastedText } from '../media-lens/worker/prepare.js';

test('quoted text with a "said" cue produces role quoted with a captured speaker', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'https://fictional-daily.example/x', inputMode: 'fixture' });
  const quoted = prepared.spans.find((s) => s.role === 'quoted');
  assert.ok(quoted);
  assert.equal(quoted.role_basis, 'quote_marks');
  assert.equal(quoted.attribution.speaker, 'the mayor');
  assert.equal(quoted.attribution.cue, 'said');
});

test('identical content stated without quote marks is authorial', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  const authorial = prepared.spans.find((s) => s.text.startsWith('The council said it would fix'));
  assert.ok(authorial);
  assert.equal(authorial.role, 'authorial');
});

test('h1 becomes headline, and byline paragraph becomes byline_meta', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(prepared.spans[0].role, 'headline');
  assert.equal(prepared.spans[0].role_basis, 'html_structure');
  const byline = prepared.spans.find((s) => s.role === 'byline_meta');
  assert.ok(byline);
});

test('metadata is extracted from meta tags, canonical link, and author', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(prepared.artifact.title, 'Council approves downtown drainage upgrade');
  assert.equal(prepared.artifact.byline, 'Jordan Reyes');
  assert.equal(prepared.artifact.publishedAt, '2026-09-15T14:00:00.000Z');
  assert.equal(prepared.artifact.timestampPrecision, 'time');
  assert.equal(prepared.artifact.canonicalUrl, 'https://fictional-daily.example/articles/synthetic-01-quoted-vs-authorial');
});

test('a document with no publish timestamp gets timestamp_precision "none"', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-03-no-timestamp.html', 'utf8');
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(prepared.artifact.publishedAt, null);
  assert.equal(prepared.artifact.timestampPrecision, 'none');
});

test('JSON-LD isAccessibleForFree:false is detected as a paywall', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-05-paywall.html', 'utf8');
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(prepared.paywallDetected, true);
});

test('subscribe/newsletter classed elements are treated as boilerplate, not article content', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-05-paywall.html', 'utf8');
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.ok(!prepared.spans.some((s) => s.text.includes('Subscribe to continue')));
});

test('script and style tag content never leaks into prepared text', async () => {
  const html = `<!doctype html><html><head></head><body><article>
    <h1>Title</h1>
    <script>window.doNotLeak = "leaked-script-content";</script>
    <style>.doNotLeak { color: red; }</style>
    <p>Real paragraph text.</p>
  </article></body></html>`;
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.doesNotMatch(prepared.preparedText, /leaked-script-content/);
  assert.doesNotMatch(prepared.preparedText, /doNotLeak/);
});

test('hidden and aria-hidden elements are excluded from prepared text', async () => {
  const html = `<!doctype html><html><body><article>
    <h1>Title</h1>
    <p hidden>Should not appear.</p>
    <p aria-hidden="true">Also should not appear.</p>
    <p>Visible paragraph.</p>
  </article></body></html>`;
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.doesNotMatch(prepared.preparedText, /Should not appear/);
  assert.doesNotMatch(prepared.preparedText, /Also should not appear/);
  assert.match(prepared.preparedText, /Visible paragraph/);
});

test('prepareFromPastedText splits on blank lines and detects quotes without any HTML structure', () => {
  const text = `The mayor made a statement today.\n\n"We will fix this," the mayor said in the statement.`;
  const prepared = prepareFromPastedText({ text, kind: 'other_public' });
  assert.equal(prepared.artifact.inputMode, 'pasted_text');
  const quoted = prepared.spans.find((s) => s.role === 'quoted');
  assert.ok(quoted);
  assert.equal(quoted.attribution.speaker, 'the mayor');
});

test('claim candidates are proposed for numerals, dates, and attribution cues', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-02-syndicated-cluster.html', 'utf8');
  const prepared = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.ok(prepared.claimCandidates.length > 0);
  assert.ok(prepared.claimCandidates.some((c) => c.kind === 'statistic'));
});

test('text_sha256 is deterministic for identical prepared text', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const first = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  const second = prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(first.textSha256, second.textSha256);
  assert.equal(first.textSha256.length, 64);
});
