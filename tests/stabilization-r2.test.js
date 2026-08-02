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

test('app suppresses pattern section for safety and abstention results', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /analysis\.abstained \|\| analysis\.safetyNotice/);
  assert.match(app, /sw-update-banner/);
  assert.match(app, /hadControllerAtLoad/);
  assert.match(app, /migrateHistoryStorage/);
});
