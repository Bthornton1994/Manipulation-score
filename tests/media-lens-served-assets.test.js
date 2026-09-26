// Contract between the Media Lens page and the live host's Caddyfile: every
// asset the page loads must be a path Caddy serves, and on the live host the
// page script requests only GET /health and POST /analyze besides those
// static assets. Fixture graphs are never requested outside catalog mode.

import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { loadMediaLensPage } from './helpers/media-lens-dom.js';
import { LIVE_ARTICLE_URL, liveUrlGraph } from './helpers/media-lens-graphs.js';

const LIVE_ORIGIN = 'https://ml-jev.manipulationscore.com';
const PAGE_URL = `${LIVE_ORIGIN}/media-lens/index.html`;

async function caddyMatchers() {
  const caddy = await readFile('media-lens/deploy/Caddyfile', 'utf8');
  const matchers = {};
  for (const match of caddy.matchAll(/^\s*@([a-z_]+)\s+path\s+(.+)$/gm)) {
    matchers[match[1]] = match[2].trim().split(/\s+/);
  }
  return matchers;
}

function pathServed(pathname, patterns) {
  return patterns.some((pattern) => (pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern));
}

function servedStatically(pathname, matchers) {
  return pathServed(pathname, matchers.media_lens_ui) || pathServed(pathname, matchers.shared_assets);
}

function repoPath(pathname) {
  return pathname.replace(/^\//, '');
}

async function referencedAssets() {
  const html = await readFile('media-lens/index.html', 'utf8');
  const refs = [];
  for (const match of html.matchAll(/<(link|script|img|source)\b[^>]*\b(?:href|src)="([^"]+)"/g)) {
    refs.push({ tag: match[1], url: new URL(match[2], PAGE_URL) });
  }
  return refs;
}

test('the Caddyfile serves exactly the three Media Lens files, shared assets, and the API', async () => {
  const matchers = await caddyMatchers();
  assert.deepEqual(matchers.api, ['/health', '/analyze']);
  assert.deepEqual(matchers.media_lens_ui, ['/media-lens/', '/media-lens/index.html', '/media-lens/media-lens.js', '/media-lens/media-lens.css']);
  assert.deepEqual(matchers.shared_assets, ['/fonts.css', '/styles.css', '/icon.svg', '/fonts/*']);
});

test('every asset referenced by media-lens/index.html resolves to a path the Caddyfile serves', async () => {
  const matchers = await caddyMatchers();
  const refs = await referencedAssets();
  assert.ok(refs.length >= 5, 'expected the icon, three stylesheets, and the module script');
  const stylesheets = [];
  for (const { tag, url } of refs) {
    assert.equal(url.origin, LIVE_ORIGIN, `${tag} ${url.href} must be same-origin`);
    assert.ok(servedStatically(url.pathname, matchers), `${url.pathname} is not served by the Caddyfile`);
    await access(repoPath(url.pathname));
    if (url.pathname.endsWith('.css')) stylesheets.push(url);
  }
  // Stylesheets pull fonts through url(); those must be served too.
  for (const sheet of stylesheets) {
    const css = await readFile(repoPath(sheet.pathname), 'utf8');
    for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (match[1].startsWith('data:')) continue;
      const asset = new URL(match[1], sheet);
      assert.equal(asset.origin, LIVE_ORIGIN, `${sheet.pathname} -> ${match[1]}`);
      assert.ok(servedStatically(asset.pathname, matchers), `${sheet.pathname} -> ${asset.pathname} is not served`);
      await access(repoPath(asset.pathname));
    }
  }
});

test('page code requests fixture graphs only from inside the catalog-mode guard', async () => {
  const js = await readFile('media-lens/media-lens.js', 'utf8');
  const fetches = [...js.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(
    fetches.sort(),
    [
      '`${WORKER_BASE_URL}/analyze`',
      '`${WORKER_BASE_URL}/health`',
      '`${WORKER_BASE_URL}/stories`',
      '`${WORKER_BASE_URL}/stories/cluster/${encodeURIComponent(clusterId',
      'url'
    ].sort()
  );
  assert.equal(js.split('loadStoryDiscovery()').length - 1, 2);
  assert.match(js, /if \(CATALOG_MODE\) loadStoryDiscovery\(\)/);
  const loader = js.slice(js.indexOf('async function loadFixtureGraph'), js.indexOf('function setupResultControls'));
  assert.match(loader, /^async function loadFixtureGraph\(id\) \{[\s\S]*?if \(!CATALOG_MODE\) return;[\s\S]*?const url = fixtureGraphUrl\(id\);/);
  assert.match(loader, /fetch\(url, \{ method: 'GET', credentials: 'same-origin'/);
  const relativePaths = [...js.matchAll(/['`]\.\.?\/[^'`]*['`]/g)].map((m) => m[0]);
  assert.deepEqual(relativePaths, ['`./fixtures/expected/${id}.graph.json`']);
});

test('on the live host a full journey requests only GET /health and POST /analyze', async () => {
  const graph = await liveUrlGraph();
  const page = await loadMediaLensPage({
    href: `${LIVE_ORIGIN}/media-lens/#story=synthetic-01-quoted-vs-authorial`,
    analyze: async () => page.jsonResponse(graph)
  });
  try {
    const input = page.byId('article-url');
    input.value = LIVE_ARTICLE_URL;
    page.byId('analyze-continue').click();
    await page.flush();
    await page.submitConsent();
    await page.waitFor(() => page.byId('results').hidden === false);
    page.byId('analyze-another').click();
    await page.flush();
    // Hidden catalog controls stay inert even if clicked programmatically.
    for (const el of page.document.querySelectorAll('[data-fixture-id]')) el.click();
    page.byId('sample-analyze').click();
    await page.flush();
    const requests = page.fetchCalls.map((call) => `${call.method} ${call.url}`);
    assert.deepEqual(requests, [`GET ${LIVE_ORIGIN}/health`, `POST ${LIVE_ORIGIN}/analyze`]);
    const matchers = await caddyMatchers();
    for (const call of page.fetchCalls) assert.ok(pathServed(new URL(call.url).pathname, matchers.api), call.url);
  } finally {
    page.restore();
  }
});
