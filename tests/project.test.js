import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('web app manifest is valid and its icon exists', async () => {
  const manifest = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  await Promise.all(manifest.icons.map(({ src }) => access(src)));
});

test('service worker app shell contains existing local assets', async () => {
  const worker = await readFile('service-worker.js', 'utf8');
  const assets = [...worker.matchAll(/'\.\/(.*?)'/g)].map(([, path]) => path || 'index.html');
  await Promise.all(assets.map((path) => access(path)));
});

test('page has no third-party runtime dependencies', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /Content-Security-Policy/);
});
