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

test('index has no third-party runtime dependencies', async () => {
  const html = await readFile('index.html', 'utf8');
  const externalHosts = [...html.matchAll(/https?:\/\/([^/"'\s]+)/g)].map(([, host]) => host);
  for (const host of externalHosts) {
    assert.match(host, /^(manipulationscore\.com|www\.manipulationscore\.com)$/);
  }
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html, /Content-Security-Policy/);
});

test('legal pages exist and link back to home', async () => {
  for (const page of ['privacy.html', 'terms.html', 'limitations.html']) {
    const html = await readFile(page, 'utf8');
    assert.match(html, /href="\.\/"/);
    assert.doesNotMatch(html, /https?:\/\//);
  }
});

test('fonts are self-hosted', async () => {
  const fontsCss = await readFile('fonts.css', 'utf8');
  assert.doesNotMatch(fontsCss, /https?:\/\//);
  const paths = [...fontsCss.matchAll(/url\('\.\/(.*?)'\)/g)].map(([, path]) => path);
  await Promise.all(paths.map((path) => access(path)));
});

test('custom domain CNAME is configured', async () => {
  const cname = (await readFile('CNAME', 'utf8')).trim();
  assert.equal(cname, 'manipulationscore.com');
});

test('sitemap uses production domain', async () => {
  const sitemap = await readFile('sitemap.xml', 'utf8');
  assert.match(sitemap, /https:\/\/manipulationscore\.com\//);
  assert.doesNotMatch(sitemap, /github\.io/);
});

test('index hides desktop nav on mobile via stylesheet rules', async () => {
  const css = await readFile('styles.css', 'utf8');
  assert.match(css, /\.header-desktop-only.*display:\s*none/);
  assert.match(css, /@media\(max-width:768px\)/);
  assert.doesNotMatch(css, /\.site-header nav\{display:flex/);
});

test('readme documents apex and www hostnames', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /manipulationscore\.com/);
  assert.match(readme, /www\.manipulationscore\.com/);
});

test('logo shows clarity and MANIPULATION SCORE without uses', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /class="brand-name">clarity/);
  assert.match(html, />MANIPULATION SCORE</);
  assert.doesNotMatch(html, /uses/i);
});

test('index supports client-side image upload', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /id="image-upload-btn"/);
  assert.match(html, />Attach image</);
  assert.match(html, /Images are read on your device only/);
  assert.match(html, /id="message-image"/);
  assert.match(html, /worker-src/);
  assert.match(html, /blob:/);
});

test('ocr module and vendor assets exist locally', async () => {
  await access('ocr.js');
  await access('vendor/tesseract/tesseract.esm.min.js');
  await access('vendor/tesseract/worker.min.js');
  await access('vendor/tesseract/tesseract-core.wasm.js');
  await access('vendor/tesseract/lang/eng.traineddata.gz');
});
