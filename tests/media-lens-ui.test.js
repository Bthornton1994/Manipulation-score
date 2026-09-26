import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveUrlDisclosure, consentDisclosure } from '../media-lens/media-lens.js';

const BANNED_PHRASES = ['manipulative', 'proves', 'misinformation', 'unsafe', 'propaganda'];
const ALLOWED_UI_PHRASES = [
  'Observed influence signal',
  'Possible selective-context candidate',
  'Claim support unclear',
  'Quoted language not attributed as authorial',
  'Insufficient context'
];
const STRENGTH_DISPLAY_LABELS = ['Observed influence signal', 'Possible influence signal'];

test('URL help names the approved example host precisely and keeps the abstain and not-allowed notes', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const help = html.match(/<p class="ml-form-note" id="article-url-help">([\s\S]*?)<\/p>/)[1].replace(/\s+/g, ' ');
  assert.match(help, /accepts only public <code>https:\/\/<\/code> pages from a short list of sites the operator approves\./);
  assert.match(help, /English Wikipedia article addresses on <code>en\.wikipedia\.org<\/code> are on the list\./);
  assert.match(help, /Mobile links on <code>en\.m\.wikipedia\.org<\/code> are not\./);
  assert.match(help, /Long pages may abstain/);
  assert.match(help, /Private, paywalled, internal, and unauthorized material is not allowed/);
  assert.doesNotMatch(help, /—/);
  assert.match(html, /<p class="ml-field-error" id="article-url-error" role="alert" hidden><\/p>/);
  // The worker's allowlist is an exact host match, so the mobile host is a
  // different site unless an operator adds it.
  const hostKey = await readFile('media-lens/worker/host-key.js', 'utf8');
  assert.match(hostKey, /return allowlist\.includes\(host\);/);
});

test('the error banner can take focus, and view changes do not use scroll anchoring', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /<p class="ml-status ml-error-banner" id="analyze-error" data-state="error" role="alert" tabindex="-1" hidden><\/p>/);
  const css = await readFile('media-lens/media-lens.css', 'utf8');
  assert.match(css, /\.ml-main \{[^}]*overflow-anchor: none;/);
});

test('the consent dialog is described by the operator-host fetch notice', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const dialog = html.match(/<dialog\b[^>]*>/)[0];
  assert.match(dialog, /aria-labelledby="consent-dialog-title"/);
  assert.match(dialog, /aria-describedby="consent-fetch-notice"/);
  const inside = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
  assert.match(inside, /<p id="consent-fetch-notice">/);
});

test('the sample card is named by its "Made-up example" label and its title, and notes that live analyses show no coverage counts', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /<aside class="ml-sample-card" aria-labelledby="ml-sample-kicker ml-sample-heading">/);
  assert.match(html, /<p class="ml-sample-kicker" id="ml-sample-kicker">Made-up example<\/p>/);
  const note = html.match(/<p class="ml-sample-note">([\s\S]*?)<\/p>/)[1].replace(/\s+/g, ' ');
  assert.match(note, /Live analyses do not show coverage counts\./);
});

test('heading levels never skip and the results view has a single top-level heading', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(levels[i] <= levels[i - 1] + 1, `heading jumps from h${levels[i - 1]} to h${levels[i]}`);
  }
  const results = html.slice(html.indexOf('<div class="ml-results"'), html.indexOf('<p class="ml-footer-note">'));
  assert.deepEqual([...results.matchAll(/<h1\b[^>]*>/g)].map((m) => m[0]), ['<h1 class="ml-result-title" id="result-title" tabindex="-1">']);
  const resultLevels = [...results.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  assert.equal(resultLevels[0], 1);
  assert.ok(resultLevels.slice(1).every((level) => level >= 2), 'every section heading sits below the result title');
  for (let i = 1; i < resultLevels.length; i += 1) {
    assert.ok(resultLevels[i] <= resultLevels[i - 1] + 1, `result heading jumps from h${resultLevels[i - 1]} to h${resultLevels[i]}`);
  }
  // The coverage-gap card the renderer adds sits under an h3 subsection.
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /<article class="ml-gap-card"><h4>Coverage gap<\/h4>/);
  assert.doesNotMatch(js, /<h5>/);
  // The hero display size applies only to the hero, not to the result or loading titles.
  const css = await readFile('media-lens/media-lens.css', 'utf8');
  assert.doesNotMatch(css, /\.ml-main h1/);
  assert.match(css, /\.ml-loading h1 \{/);
  assert.match(css, /\.ml-dimension h2 \{/);
  assert.match(results, /<nav class="ml-workspace-nav" aria-label="Result sections">/);
  assert.doesNotMatch(results, /Story workspace|Back to stories/);
  assert.match(results, /id="analyze-another">Back to start</);
  const footer = html.match(/<p class="ml-footer-note">([\s\S]*?)<\/p>/)[1].replace(/\s+/g, ' ');
  assert.doesNotMatch(footer, /fixture-first coverage workspace/);
  assert.match(footer, /limited Jev-only preview/);
  assert.match(footer, /no overall score for an article, person, or outlet/);
});

test('form controls use borders with at least 3:1 contrast and links keep a 24px hit area', async () => {
  const css = await readFile('media-lens/media-lens.css', 'utf8');
  const shared = await readFile('styles.css', 'utf8');
  assert.match(css, /--ml-control-border: var\(--text-faint\)/);
  for (const selector of [".ml-entry input\\[type='search'\\]", '\\.ml-form select,', '\\.ml-lane,']) {
    assert.match(css, new RegExp(`${selector}[^{]*\\{[^}]*border: 1px solid var\\(--ml-control-border\\)`), selector);
  }
  const hex = (name) => shared.match(new RegExp(`--${name}:(#[0-9a-f]{6})`))[1];
  const luminance = (value) => {
    const channels = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const background of ['surface', 'ink-soft']) {
    assert.ok(ratio(hex('text-faint'), hex(background)) >= 3, `control border vs --${background}`);
  }
  assert.match(css, /\.ml-trust-links a,\s*\.media-lens-page \.legal-mini-nav a \{[^}]*min-height: 32px/);
});

test('index.html has a skip link and one h1 in each of its three views', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /class="skip-link"/);
  const landing = html.slice(html.indexOf('<div id="landing-view">'), html.indexOf('<section class="ml-loading"'));
  const loading = html.slice(html.indexOf('<section class="ml-loading"'), html.indexOf('<div class="ml-results"'));
  const results = html.slice(html.indexOf('<div class="ml-results"'), html.indexOf('<p class="ml-footer-note">'));
  for (const [name, view] of [['landing', landing], ['loading', loading], ['results', results]]) {
    assert.equal((view.match(/<h1[\s>]/g) || []).length, 1, `expected exactly one <h1> in the ${name} view`);
  }
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 3, 'no <h1> outside the three views');
  assert.match(loading, /<h1 id="ml-loading-heading">Analyzing the article<\/h1>/);
  // Only one view is shown at a time.
  assert.match(loading, /<section class="ml-loading" id="loading-panel" hidden/);
  assert.match(results, /<div class="ml-results" id="results" hidden>/);
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /landing\.hidden = view !== 'landing';\s*loading\.hidden = view !== 'loading';\s*results\.hidden = view !== 'results';/);
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
      assert.doesNotMatch(content, new RegExp(`\\b${banned}\\b`), `${file} contains banned phrase "${banned}"`);
    }
  }

  // taxonomy.js legitimately defines the BANNED_PHRASES list by name; check
  // only the human-facing label/explanation text, not that constant.
  const taxonomySrc = await readFile('media-lens/schema/taxonomy.js', 'utf8');
  const bannedPhrasesBlock = taxonomySrc.slice(taxonomySrc.indexOf('export const BANNED_PHRASES'));
  const taxonomyWithoutBannedList = taxonomySrc.slice(0, taxonomySrc.indexOf('export const BANNED_PHRASES')).toLowerCase();
  assert.match(bannedPhrasesBlock, /manipulative/); // sanity: the constant itself still exists
  for (const banned of BANNED_PHRASES) {
    assert.doesNotMatch(taxonomyWithoutBannedList, new RegExp(`\\b${banned}\\b`), `taxonomy.js label/explanation text contains "${banned}"`);
  }
});

test('the only observation-header phrases used by the renderer are the allowed UI phrases', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  // Stored observation phrases stay in the schema allowlist. Strength display
  // labels are presentation copy and may differ when the stored phrase would
  // call a candidate "Observed".
  const quoted = [...js.matchAll(/'([A-Z][^']{5,60})'/g)].map((m) => m[1]);
  const sentenceLike = quoted.filter((s) => /^[A-Z][a-z]/.test(s) && /\s/.test(s));
  for (const phrase of sentenceLike) {
    if (ALLOWED_UI_PHRASES.includes(phrase) || STRENGTH_DISPLAY_LABELS.includes(phrase)) continue;
    // Anything else quoted must not read like a fabricated verdict phrase.
    for (const banned of BANNED_PHRASES) {
      assert.doesNotMatch(phrase.toLowerCase(), new RegExp(banned));
    }
  }
  assert.match(js, /observed:\s*'Observed influence signal'/);
  assert.match(js, /candidate:\s*'Possible influence signal'/);
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
  assert.match(html, /href="https:\/\/manipulationscore\.com\/analyze\.html"/);
});

test('M2: coverage freshness status and rationale are rendered, not silently discarded', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /freshness_gate\.computed_status/);
  assert.match(js, /coverage-freshness-rationale/);
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /id="coverage-freshness-rationale"/);
});

test('L5: a quoted claim renders a "Quoted" chip distinguishing it from an authorial claim', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /claim\.attribution !== 'authorial'/);
  assert.match(js, /'Quoted'/);
});

test('L7: the reduced-motion rule in media-lens.css only targets selectors that actually declare a transition', async () => {
  const css = await readFile('media-lens/media-lens.css', 'utf8');
  const reducedMotionBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const selectorsInReducedMotionBlock = [...reducedMotionBlock.matchAll(/^\s*(\.[\w-]+)/gm)].map((m) => m[1]);
  assert.ok(selectorsInReducedMotionBlock.length > 0, 'expected at least one selector in the reduced-motion block');
  for (const selector of selectorsInReducedMotionBlock) {
    const baseRulePattern = new RegExp(`${selector.replace('.', '\\.')}[^{]*\\{[^}]*transition:`);
    assert.match(css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce)')), baseRulePattern, `${selector} has no base transition to neutralize`);
  }
});

test('Info: aria-live is scoped to a dedicated status line, not the whole results tree', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const resultsTag = html.match(/<div class="ml-results"[^>]*>/)[0];
  assert.doesNotMatch(resultsTag, /aria-live/);
  assert.match(html, /id="analyze-status-live"[^>]*aria-live="polite"/);
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /analyze-status-live/);
});

test('L3: the browser sends the consent-checkbox timestamp, not just a boolean, as consent_at', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /consentCheckedAt/);
  assert.match(js, /consent_at:\s*consentCheckedAt/);
});

test('live frontend resolves the worker through same origin and never embeds provider configuration', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /window\.location\.origin/);
  assert.match(js, /LOCAL_WORKER_BASE_URL/);
  assert.match(js, /liveUrlReady/);
  assert.match(js, /payload\.url = url/);
  assert.doesNotMatch(js, /MEDIA_LENS_TYPESAFE_API_KEY/);
  assert.doesNotMatch(js, /process\.env/);
});

test('frontend deployment serves only the UI surface and shared assets', async () => {
  const caddy = await readFile('media-lens/deploy/Caddyfile', 'utf8');
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8787/);
  assert.match(caddy, /\/media-lens\/index\.html/);
  assert.match(caddy, /\/media-lens\/media-lens\.js/);
  assert.match(caddy, /\/media-lens\/media-lens\.css/);
  assert.match(caddy, /respond 404/);
  assert.doesNotMatch(caddy, /path \/media-lens\/\*/);
});

test('L1: docs describe claim support as always not_checked, matching fusion.js (no operator-supplied-evidence path exists)', async () => {
  const limitations = await readFile('limitations.html', 'utf8');
  assert.doesNotMatch(limitations, /unless a fixture or an operator-supplied Newsjack artifact provides evidence/);
  assert.match(limitations, /always "not checked" in this preview/);

  const readme = await readFile('media-lens/README.md', 'utf8');
  assert.doesNotMatch(readme, /claims are `not_checked` unless a fixture or artifact supplies evidence/);
  assert.match(readme, /always `not_checked` in this preview/);

  const methodology = await readFile('methodology.html', 'utf8');
  assert.doesNotMatch(methodology, /support marked "not checked" unless evidence is supplied/);

  const fusionSrc = await readFile('media-lens/worker/fusion.js', 'utf8');
  assert.match(fusionSrc, /support:\s*'not_checked'/);
  // Confirm fusion.js truly never sets any other support value (the claim
  // the docs must stay synchronized with).
  assert.doesNotMatch(fusionSrc, /support:\s*(?!'not_checked')['"]\w+['"]/);
});

test('index.html requires the consent checkbox before the submit button is usable', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /id="consent-checkbox"/);
  assert.match(html, /id="analyze-submit"[^>]*disabled/);
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /consent-checkbox/);
  assert.match(js, /submit\.disabled = isSubmitting \|\| !consent\.checked \|\| !hasInput/);
});

const CONSENT_CHECKBOX_V2 =
  'I confirm this is public material I am allowed to analyze, and I understand that live URL mode may send prepared public spans to TypeSafe AI\u2019s Jev service.';

test('index.html uses the v2 consent checkbox and keeps the full live-URL disclosure visible before submit', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  const consentLabel = html.match(/<label for="consent-checkbox">([^<]+)<\/label>/);
  assert.ok(consentLabel, 'consent checkbox label missing');
  assert.equal(consentLabel[1], CONSENT_CHECKBOX_V2);
  assert.doesNotMatch(html, /<label for="consent-checkbox">This is public material I am allowed to analyze\.<\/label>/);

  const disclosure = html.match(/<section class="ml-disclosure"[^>]*>[\s\S]*?<\/section>/);
  assert.ok(disclosure, 'persistent disclosure section missing');
  assert.match(disclosure[0], /id="ml-live-url-notice"/);
  assert.doesNotMatch(disclosure[0], /\shidden(?:[\s>=])/);
  const notice = html.match(/<p id="ml-live-url-notice">\s*([\s\S]*?)\s*<\/p>/);
  assert.ok(notice, 'live URL notice missing');
  assert.equal(notice[1].replace(/\s+/g, ' ').trim(), liveUrlDisclosure('operator'));
  const consentNotice = html.match(/<p id="consent-fetch-notice">\s*([\s\S]*?)\s*<\/p>/);
  assert.ok(consentNotice, 'consent fetch notice missing');
  assert.equal(consentNotice[1].replace(/\s+/g, ' ').trim(), consentDisclosure('operator'));

  const urlField = html.match(/<div id="url-field"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(urlField);
  assert.doesNotMatch(urlField[0], /\shidden(?:[\s>=])/);
  assert.doesNotMatch(urlField[0], /id="ml-live-url-notice"/);
  const fixtureField = html.match(/<div id="fixture-field"[^>]*>/);
  assert.ok(fixtureField);
  assert.match(fixtureField[0], /\shidden(?:[\s>=])/);

  assert.match(html, /Limited Jev-only experimental preview/);
  assert.match(html, /Jev-only live URL mode/);
  assert.match(html, /secondary classifier are disabled/);
  assert.match(html, /not production-ready for general use/);
  assert.match(html, /Analyze an approved public URL/);
  assert.match(html, /id="article-url"[^>]*disabled/);
  assert.match(html, /Live pasted-text analysis stays disabled/);
  // The inherited em dash is replaced with a period in both HTML and JS.
  assert.match(notice[1], /Live pasted-text analysis stays disabled\. Use Clarity for private messages\./);
  assert.doesNotMatch(html, /stays disabled \u2014/);
  assert.doesNotMatch(liveUrlDisclosure('operator'), /\u2014/);
  // The full disclosure is visible: no max-height scroll clipping.
  const css = await readFile('media-lens/media-lens.css', 'utf8');
  assert.doesNotMatch(css, /#ml-live-url-notice\s*\{/);
});

test('public landing leads with URL analysis, describes only what works, and keeps a labeled sample card', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /<h1[^>]*>Discover how outlets cover a story<\/h1>/);
  assert.match(html, /Limited Jev-only experimental preview/);
  const lede = html.match(/<p class="ml-lede">([\s\S]*?)<\/p>/)[1].replace(/\s+/g, ' ');
  assert.match(lede, /compares only retrieved reports/);
  assert.match(lede, /Live discovery is off until the owner approves named feeds/);
  assert.match(lede, /no score for an article, a person, or an outlet/);
  assert.doesNotMatch(html, /media-intelligence workspace|fixture-first/i);
  const compare = html.match(/<ul class="ml-compare">([\s\S]*?)<\/ul>/)[1].replace(/\s+/g, ' ');
  assert.match(compare, /does not yet check live feeds or compare how outlets covered a story/);
  assert.match(compare, /Analyzing one article URL does not do that/);
  assert.ok(html.indexOf('id="story-discovery-heading"') < html.indexOf('id="url-entry-heading"'));
  assert.match(compare, /Examples on this page are made up and labeled/);
  assert.match(compare, /<strong>Clarity<\/strong> reviews a private message on your device\./);
  // The URL entry comes first in the DOM, then the Coverage context section.
  const urlEntry = html.indexOf('id="url-entry-heading"');
  const coverageContext = html.indexOf('id="coverage-context-heading"');
  const explorer = html.indexOf('id="fixture-explorer"');
  assert.ok(urlEntry > html.indexOf('id="ml-hero-heading"'));
  assert.ok(coverageContext > urlEntry && explorer > coverageContext);
  assert.match(html, /<h2 id="coverage-context-heading">Coverage context<\/h2>/);
  assert.match(html, /Not live yet\. Media Lens has no approved source for finding other reports of the same story/);
  assert.match(html, /<p class="ml-sample-kicker" id="ml-sample-kicker">Made-up example<\/p>/);
  assert.match(html, /<h3 id="ml-sample-heading">Council approves downtown drainage upgrade<\/h3>/);
  assert.match(html, /Analyze a public article URL/);
  assert.match(html, /Council approves downtown drainage upgrade/);
  assert.match(html, /synthetic-01-quoted-vs-authorial/);
  assert.match(html, /fictional-daily\.example/);
  assert.match(html, /We will fix the flooding problem this year,/);
  assert.match(html, /id="analyze-continue"/);
  assert.match(html, /href="https:\/\/manipulationscore\.com\/privacy\.html"/);
  assert.match(html, /href="https:\/\/manipulationscore\.com\/acceptable-use\.html"/);
});

test('analysis flow includes consent dialog, loading stages, cancel, and retry', async () => {
  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /<dialog class="ml-consent-dialog" id="consent-dialog"/);
  assert.match(html, /Requesting article/);
  assert.match(html, /Preparing evidence/);
  assert.match(html, /Evaluating signals/);
  assert.match(html, /Building the result/);
  assert.match(html, /id="analyze-cancel"/);
  assert.match(html, /id="analyze-retry"/);
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /AbortController/);
  assert.match(js, /LOADING_STAGES/);
  assert.match(js, /CANCELLED_MESSAGE/);
  assert.match(js, /live_killed/);
  assert.match(js, /rate_limited/);
  assert.match(js, /TIMEOUT/);
  assert.match(js, /BLOCKED_HOST/);
  assert.match(js, /internal_error/);
});

test('results renderer binds taxonomy labels and coverage origin from the graph schema', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  const taxonomySrc = await readFile('media-lens/schema/taxonomy.js', 'utf8');
  assert.match(js, /certainty_beyond_evidence/);
  assert.match(js, /selective_context_candidate/);
  assert.match(js, /story_origin/);
  assert.match(js, /coverage\.frames/);
  assert.match(js, /authorial_attribution/);
  assert.match(js, /freshness_gate\.computed_status/);
  assert.doesNotMatch(js, /process\.env/);
  for (const label of [
    'Loaded or moralized language',
    'Urgency framing',
    'Vague authority',
    'Possible selective-context candidate'
  ]) {
    assert.match(taxonomySrc, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(js, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
