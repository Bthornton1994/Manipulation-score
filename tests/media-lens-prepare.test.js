import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareFromHtml, prepareFromPastedText } from '../media-lens/worker/prepare.js';

test('quoted text with a "said" cue produces role quoted with a captured speaker', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'https://fictional-daily.example/x', inputMode: 'fixture' });
  const quoted = prepared.spans.find((s) => s.role === 'quoted');
  assert.ok(quoted);
  assert.equal(quoted.role_basis, 'quote_marks');
  assert.equal(quoted.attribution.speaker, 'the mayor');
  assert.equal(quoted.attribution.cue, 'said');
});

test('identical content stated without quote marks is authorial', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  const authorial = prepared.spans.find((s) => s.text.startsWith('The council said it would fix'));
  assert.ok(authorial);
  assert.equal(authorial.role, 'authorial');
});

test('h1 becomes headline, and byline paragraph becomes byline_meta', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(prepared.spans[0].role, 'headline');
  assert.equal(prepared.spans[0].role_basis, 'html_structure');
  assert.equal(prepared.spans.some((s) => s.role === 'byline_meta'), false);
  assert.equal(prepared.preparedText.includes('By Jordan Reyes'), false);
});

test('metadata is extracted from meta tags, canonical link, and author', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(prepared.artifact.title, 'Council approves downtown drainage upgrade');
  assert.equal(prepared.artifact.byline, 'Jordan Reyes');
  assert.equal(prepared.artifact.publishedAt, '2026-09-15T14:00:00.000Z');
  assert.equal(prepared.artifact.timestampPrecision, 'time');
  assert.equal(prepared.artifact.canonicalUrl, 'https://fictional-daily.example/articles/synthetic-01-quoted-vs-authorial');
});

test('a document with no publish timestamp gets timestamp_precision "none"', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-03-no-timestamp.html', 'utf8');
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(prepared.artifact.publishedAt, null);
  assert.equal(prepared.artifact.timestampPrecision, 'none');
});

test('JSON-LD isAccessibleForFree:false is detected as a paywall', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-05-paywall.html', 'utf8');
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(prepared.paywallDetected, true);
});

test('subscribe/newsletter classed elements are treated as boilerplate, not article content', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-05-paywall.html', 'utf8');
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.ok(!prepared.spans.some((s) => s.text.includes('Subscribe to continue')));
});

test('script and style tag content never leaks into prepared text', async () => {
  const html = `<!doctype html><html><head></head><body><article>
    <h1>Title</h1>
    <script>window.doNotLeak = "leaked-script-content";</script>
    <style>.doNotLeak { color: red; }</style>
    <p>Real paragraph text.</p>
  </article></body></html>`;
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
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
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.doesNotMatch(prepared.preparedText, /Should not appear/);
  assert.doesNotMatch(prepared.preparedText, /Also should not appear/);
  assert.match(prepared.preparedText, /Visible paragraph/);
});

test('prepareFromPastedText splits on blank lines and detects quotes without any HTML structure', async () => {
  const text = `The mayor made a statement today.\n\n"We will fix this," the mayor said in the statement.`;
  const prepared = await prepareFromPastedText({ text, kind: 'other_public' });
  assert.equal(prepared.artifact.inputMode, 'pasted_text');
  const quoted = prepared.spans.find((s) => s.role === 'quoted');
  assert.ok(quoted);
  assert.equal(quoted.attribution.speaker, 'the mayor');
});

test('claim candidates are proposed for numerals, dates, and attribution cues', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-02-syndicated-cluster.html', 'utf8');
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.ok(prepared.claimCandidates.length > 0);
  assert.ok(prepared.claimCandidates.some((c) => c.kind === 'statistic'));
});

test('L4: publisher name comes from og:site_name, not the domain', async () => {
  const html = `<!doctype html><html><head>
    <meta property="og:site_name" content="Fictional Daily" />
    <meta property="og:title" content="Some headline" />
    <link rel="canonical" href="https://fictional-daily.example/articles/x" />
  </head><body><article><h1>Some headline</h1><p>Enough authorial text to be analyzable in this test case.</p></article></body></html>`;
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'https://fictional-daily.example/articles/x', inputMode: 'fixture' });
  assert.equal(prepared.artifact.publisherName, 'Fictional Daily');
});

test('L4: publisher name is null when no og:site_name meta tag is present', async () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Some headline" />
  </head><body><article><h1>Some headline</h1><p>Enough authorial text to be analyzable in this test case.</p></article></body></html>`;
  const prepared = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'https://fictional-daily.example/articles/x', inputMode: 'fixture' });
  assert.equal(prepared.artifact.publisherName, null);
});

test('L4: pasted text has no publisher name (no metadata available)', async () => {
  const prepared = await prepareFromPastedText({ text: 'Some plain pasted paragraph of text.' });
  assert.equal(prepared.artifact.publisherName, null);
});

test('text_sha256 is deterministic for identical prepared text', async () => {
  const html = await readFile('media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html', 'utf8');
  const first = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  const second = await prepareFromHtml({ html, kind: 'article', sourceUrl: 'x', inputMode: 'fixture' });
  assert.equal(first.textSha256, second.textSha256);
  assert.equal(first.textSha256.length, 64);
});
