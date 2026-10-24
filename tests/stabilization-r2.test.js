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

test('service worker includes history-storage in app shell', async () => {
  const worker = await readFile('service-worker.js', 'utf8');
  assert.match(worker, /history-storage\.js/);
});

test('service worker precaches versioned stylesheet URL used by HTML', async () => {
  const [worker, index] = await Promise.all([
    readFile('service-worker.js', 'utf8'),
    readFile('index.html', 'utf8')
  ]);
  const versionedStyles = index.match(/styles\.css\?v=[^"']+/)?.[0];
  assert.ok(versionedStyles, 'expected versioned stylesheet href in HTML');
  assert.match(worker, new RegExp(versionedStyles.replace('?', '\\?')));
  assert.match(worker, /ignoreSearch:\s*true/);
});

test('app suppresses pattern section for safety and abstention results', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /analysis\.abstained \|\| analysis\.safetyNotice/);
  assert.match(app, /sw-update-banner/);
  assert.match(app, /hadControllerAtLoad/);
  assert.match(app, /migrateHistoryStorage/);
});
