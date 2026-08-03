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
  const allowedHosts =
    /^(manipulationscore\.com|www\.manipulationscore\.com|988lifeline\.org|www\.988lifeline\.org|www\.thehotline\.org)$/;
  const externalHosts = [...html.matchAll(/https?:\/\/([^/"'\s]+)/g)].map(([, host]) => host);
  for (const host of externalHosts) {
    assert.match(host, allowedHosts);
  }
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html, /Content-Security-Policy/);
});

test('legal pages exist and link back to home', async () => {
  const selfHostedOnly = [
    'terms.html',
    'limitations.html',
    'methodology.html',
    'acceptable-use.html',
    'accessibility.html',
    'changelog.html'
  ];
  for (const page of selfHostedOnly) {
    const html = await readFile(page, 'utf8');
    assert.match(html, /href="\.\/"/);
    const externalHosts = [...html.matchAll(/https?:\/\/([^/"'\s]+)/g)].map(([, host]) => host);
    for (const host of externalHosts) {
      assert.equal(host, 'manipulationscore.com', `${page} links to unexpected host ${host}`);
    }
  }

  const contact = await readFile('contact.html', 'utf8');
  assert.match(contact, /href="\.\/"/);
  assert.match(contact, /feedback@manipulationscore\.com/);
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
  assert.match(sitemap, /methodology\.html/);
  assert.match(sitemap, /contact\.html/);
  assert.match(sitemap, /acceptable-use\.html/);
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

test('logo shows Manipulation Score as brand and Clarity as product', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /class="brand-name">Manipulation Score</);
  assert.match(html, /class="brand-sub">Clarity</);
  assert.doesNotMatch(html, /uses/i);
});

test('history is opt-in and guarded before localStorage writes', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /history-storage\.js/);
  assert.match(app, /if \(!isHistoryOptIn\(\)\) return/);
  assert.match(app, /history-opt-in/);
  assert.match(app, /history-delete-all/);
});

test('history uses v2 storage key', async () => {
  const storage = await readFile('history-storage.js', 'utf8');
  assert.match(storage, /clarity-history-v2/);
  assert.match(storage, /clarity-history-v1/);
  assert.match(storage, /migrateHistoryStorage/);
});

test('index labels hero example as experimental', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /Example, experimental/);
});

test('index discloses history off by default', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /History off by default|history-opt-in/);
  assert.match(html, /Delete all history/);
  assert.doesNotMatch(html, /No message storage/);
});

test('index supports client-side image upload', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /id="image-upload-btn"/);
  assert.match(html, /class="image-attach-btn"/);
  assert.match(html, /class="file-input-offscreen"/);
  assert.match(html, /Analyze message/);
  assert.match(html, /Images are read on your device only/);
  assert.match(html, /accept="[^"]*image\/\*[^"]*"/);
  assert.match(html, /\.heic/);
  assert.doesNotMatch(html, /screenshot/i);
});

test('index CSP allows on-device OCR', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /wasm-unsafe-eval/);
  assert.match(html, /worker-src[^;]*blob:/);
});

test('app moves focus to main when skip link is activated', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /skip-link/);
  assert.match(app, /mainContent\.focus/);
});

test('ocr module and vendor assets exist locally', async () => {
  await access('ocr.js');
  await access('vendor/tesseract/tesseract.esm.min.js');
  await access('vendor/tesseract/worker.min.js');
  await access('vendor/tesseract/tesseract-core.wasm.js');
  await access('vendor/tesseract/lang/eng.traineddata.gz');
  await access('vendor/heic2any/heic2any.min.js');
});
