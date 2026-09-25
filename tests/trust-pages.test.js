import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const TRUST_PAGES = [
  'methodology.html',
  'contact.html',
  'acceptable-use.html',
  'accessibility.html',
  'changelog.html'
];

const FOOTER_LINKS = [
  'methodology.html',
  'contact.html',
  'acceptable-use.html',
  'accessibility.html',
  'changelog.html'
];

test('trust pages have title, description, and main heading', async () => {
  for (const page of TRUST_PAGES) {
    const html = await readFile(page, 'utf8');
    assert.match(html, /<title>.*Clarity.*Manipulation Score<\/title>/);
    assert.match(html, /meta name="description"/);
    assert.match(html, /<h1>/);
    assert.match(html, /rel="canonical" href="https:\/\/manipulationscore\.com\//);
  }
});

test('index footer links to trust pages', async () => {
  const html = await readFile('index.html', 'utf8');
  for (const link of FOOTER_LINKS) {
    assert.match(html, new RegExp(`href="${link}"`));
  }
});

test('methodology discloses regression count not accuracy percentage', async () => {
  const html = await readFile('methodology.html', 'utf8');
  assert.match(html, /targeted audit fixtures/i);
  assert.match(html, /benign adversarial controls/i);
  assert.match(html, /representative validation study/i);
  assert.doesNotMatch(html, /100\s*%\s*accur/i);
});

test('acceptable use prohibits named-person scoring', async () => {
  const html = await readFile('acceptable-use.html', 'utf8');
  assert.match(html, /Publicly score, rank, or label named individuals/i);
  assert.match(html, /proof in legal/i);
});

test('privacy links to working contact channel', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, /feedback@manipulationscore\.com/);
  assert.match(html, /href="contact\.html"/);
});

test('service worker shells trust pages with network-first', async () => {
  const worker = await readFile('service-worker.js', 'utf8');
  for (const page of TRUST_PAGES) {
    assert.match(worker, new RegExp(`'\\./${page}'`));
  }
  assert.match(worker, /methodology\.html/);
  assert.match(worker, /contact\.html/);
  assert.match(worker, /acceptable-use\.html/);
});

test('changelog records the September 25, 2026 Media Lens disclosure entry above the earlier Unreleased entry', async () => {
  const html = await readFile('changelog.html', 'utf8');
  const entryIdx = html.indexOf('<h2>September 25, 2026 | Media Lens preview disclosures</h2>');
  const unreleasedIdx = html.indexOf('<h2>Unreleased | Media Lens preview (not deployed)</h2>');
  assert.ok(entryIdx !== -1, 'expected the September 25, 2026 Media Lens entry');
  assert.ok(unreleasedIdx !== -1, 'the earlier Unreleased entry stays as a historical record');
  assert.ok(entryIdx < unreleasedIdx, 'the dated entry sits above the historical Unreleased entry');
  const entry = html.slice(entryIdx, unreleasedIdx);
  assert.match(entry, /separate operator host, ml-jev\.manipulationscore\.com/);
  assert.match(entry, /experimental and not production-ready/);
  assert.match(entry, /Comparing coverage across outlets is not live/);
  assert.match(entry, /The retention period of the host's logs is not yet documented/);
  assert.match(entry, /a page recognized as paywalled is analyzed from its visible excerpt only/);
  assert.match(entry, /access log set in the host's own configuration/);
  assert.match(entry, /clarity-v37/);
  assert.doesNotMatch(entry, /accura|generally available|is production-ready/i);
});

test('trust pages changed for the Media Lens operator preview carry the September 25, 2026 date', async () => {
  for (const page of ['privacy.html', 'limitations.html', 'acceptable-use.html', 'methodology.html', 'changelog.html']) {
    const html = await readFile(page, 'utf8');
    assert.match(html, /<p class="legal-updated">Last updated: September 25, 2026<\/p>/, page);
  }
});
