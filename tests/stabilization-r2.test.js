import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('service worker uses network-first for safety-critical assets', async () => {
  const worker = await readFile('service-worker.js', 'utf8');
  assert.match(worker, /NETWORK_FIRST_PATTERN/);
  assert.match(worker, /networkFirst/);
  assert.match(worker, /app\.js/);
  assert.match(worker, /scoring\.js/);
  assert.match(worker, /safety\.js/);
  assert.match(worker, /index\.html/);
  assert.match(worker, /cacheFirst/);
});

test('service worker cache fallback ignores query strings for shell assets', async () => {
  const [worker, analyzeHtml, learnHtml] = await Promise.all([
    readFile('service-worker.js', 'utf8'),
    readFile('analyze.html', 'utf8'),
    readFile('learn.html', 'utf8')
  ]);

  // Versioned stylesheet URLs and Learn example deep-links must still resolve
  // to APP_SHELL entries cached without search params when offline.
  assert.match(worker, /ignoreSearch:\s*true/);
  assert.match(worker, /caches\.match\(request,\s*CACHE_MATCH_OPTIONS\)/);
  assert.match(worker, /'\.\/styles\.css'/);
  assert.match(analyzeHtml, /styles\.css\?v=/);
  assert.match(learnHtml, /analyze\.html\?e=/);
});

test('service worker includes history-storage in app shell', async () => {
  const worker = await readFile('service-worker.js', 'utf8');
  assert.match(worker, /history-storage\.js/);
});

test('app suppresses pattern section for safety and abstention results', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /analysis\.abstained \|\| analysis\.safetyNotice/);
  assert.match(app, /sw-update-banner/);
  assert.match(app, /hadControllerAtLoad/);
  assert.match(app, /migrateHistoryStorage/);
});
