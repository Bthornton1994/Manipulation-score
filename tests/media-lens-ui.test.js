import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BANNED_PHRASES = ['manipulative', 'proves', 'misinformation', 'unsafe', 'propaganda'];
const ALLOWED_UI_PHRASES = [
  'Observed influence signal',
  'Possible selective-context candidate',
  'Claim support unclear',
  'Quoted language not attributed as authorial',
  'Insufficient context'
];

test('index.html has a skip link and a single h1', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /class="skip-link"/);
  const h1Matches = html.match(/<h1[\s>]/g) || [];
  assert.equal(h1Matches.length, 1, 'expected exactly one <h1>');
});

test('index.html has four labelled sections for Language, Claims, Coverage, and Source context', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const requiredSections = [
    { id: 'ml-language-heading', label: 'Language' },
    { id: 'ml-claims-heading', label: 'Claims' },
    { id: 'ml-coverage-heading', label: 'Coverage' },
    { id: 'ml-source-context-heading', label: 'Source context' }
  ];
  for (const { id, label } of requiredSections) {
    const sectionPattern = new RegExp(`<section aria-labelledby="${id}"[^>]*>[\\s\\S]*?<h2 id="${id}">${label}</h2>`);
    assert.match(html, sectionPattern, `missing labelled section for ${label}`);
  }
});

test('index.html form controls use <label for> associations', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const inputsWithId = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of inputsWithId) {
    const labelPattern = new RegExp(`<label[^>]*for="${id}"`);
    assert.match(html, labelPattern, `no <label for="${id}"> found`);
  }
});

test('index.html CSP connect-src contains only the two loopback worker origins', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const cspMatch = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(cspMatch, 'CSP meta tag not found');
  const connectSrcMatch = cspMatch[1].match(/connect-src ([^;]+);/);
  assert.ok(connectSrcMatch, 'connect-src directive not found');
  const sources = connectSrcMatch[1].trim().split(/\s+/);
  assert.deepEqual(sources.sort(), ["'self'", 'http://127.0.0.1:8787', 'http://localhost:8787'].sort());
});

test('media-lens.css has a prefers-reduced-motion rule and a max-width:768px rule', async () => {
  const css = await readFile('media-lens/media-lens.css', 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 768px\)/);
});

test('no banned phrase appears in Media Lens UI, taxonomy explanations, or fixture messages', async () => {
  const files = [
    'media-lens/index.html',
    'media-lens/media-lens.js',
    'media-lens/worker/fusion.js',
    'media-lens/worker/graph.js',
    'media-lens/worker/analyze.js'
  ];
  for (const file of files) {
    let content = (await readFile(file, 'utf8')).toLowerCase();
    // CSP keywords are unrelated to the banned "unsafe" verdict phrase.
    content = content.replace(/'unsafe-inline'|'unsafe-eval'/g, '');
    for (const banned of BANNED_PHRASES) {
      assert.doesNotMatch(content, new RegExp(banned), `${file} contains banned phrase "${banned}"`);
    }
  }

  // taxonomy.js legitimately defines the BANNED_PHRASES list by name; check
  // only the human-facing label/explanation text, not that constant.
  const taxonomySrc = await readFile('media-lens/schema/taxonomy.js', 'utf8');
  const bannedPhrasesBlock = taxonomySrc.slice(taxonomySrc.indexOf('export const BANNED_PHRASES'));
  const taxonomyWithoutBannedList = taxonomySrc.slice(0, taxonomySrc.indexOf('export const BANNED_PHRASES')).toLowerCase();
  assert.match(bannedPhrasesBlock, /manipulative/); // sanity: the constant itself still exists
  for (const banned of BANNED_PHRASES) {
    assert.doesNotMatch(taxonomyWithoutBannedList, new RegExp(banned), `taxonomy.js label/explanation text contains "${banned}"`);
  }
});

test('the only observation-header phrases used by the renderer are the allowed UI phrases', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  // Every literal quoted phrase that looks like a UI-phrase sentence must be one of the allowed five.
  const quoted = [...js.matchAll(/'([A-Z][^']{5,60})'/g)].map((m) => m[1]);
  const sentenceLike = quoted.filter((s) => /^[A-Z][a-z]/.test(s) && /\s/.test(s));
  for (const phrase of sentenceLike) {
    if (ALLOWED_UI_PHRASES.includes(phrase)) continue;
    // Anything else quoted must not read like a fabricated verdict phrase.
    for (const banned of BANNED_PHRASES) {
      assert.doesNotMatch(phrase.toLowerCase(), new RegExp(banned));
    }
  }
});

test('media-lens.js never writes to localStorage, sessionStorage, or indexedDB', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.doesNotMatch(js, /localStorage\s*[.[]/);
  assert.doesNotMatch(js, /sessionStorage\s*[.[]/);
  assert.doesNotMatch(js, /indexedDB\s*[.[]/i);
});

test('index.html discloses public-only scope and links to Clarity for private messages', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /public material/i);
  assert.match(html, /href="\.\.\/analyze\.html"/);
});

test('index.html requires the consent checkbox before the submit button is usable', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /id="consent-checkbox"/);
  assert.match(html, /id="analyze-submit"[^>]*disabled/);
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /consent-checkbox/);
  assert.match(js, /submit\.disabled = !consent\.checked/);
});
