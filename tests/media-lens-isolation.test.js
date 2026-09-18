import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const CLARITY_MODULES = ['app.js', 'scoring.js', 'safety.js', 'text-normalize.js', 'history-storage.js', 'ocr.js', 'ocr-clean.js'];
const NETWORK_PATTERNS = [/fetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /new\s+WebSocket/];

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursive(full)));
    else files.push(full);
  }
  return files;
}

test('Clarity modules make no network calls', async () => {
  for (const file of CLARITY_MODULES) {
    const src = await readFile(file, 'utf8');
    for (const pattern of NETWORK_PATTERNS) {
      assert.doesNotMatch(src, pattern, `${file} matched ${pattern}`);
    }
  }
});

test('no Clarity file imports anything from media-lens/', async () => {
  for (const file of CLARITY_MODULES) {
    const src = await readFile(file, 'utf8');
    assert.doesNotMatch(src, /media-lens/, `${file} references media-lens/`);
  }
});

test('no media-lens/ file imports a Clarity module', async () => {
  const mediaLensFiles = (await listFilesRecursive('media-lens')).filter((f) => f.endsWith('.js'));
  for (const file of mediaLensFiles) {
    const src = await readFile(file, 'utf8');
    for (const clarityModule of CLARITY_MODULES) {
      const importPattern = new RegExp(`['"\`][^'"\`]*${clarityModule.replace('.', '\\.')}['"\`]`);
      assert.doesNotMatch(src, importPattern, `${file} imports Clarity module ${clarityModule}`);
    }
  }
});

test('analyze.html and index.html do not reference media-lens/', async () => {
  for (const page of ['analyze.html', 'index.html']) {
    const html = await readFile(page, 'utf8');
    assert.doesNotMatch(html, /media-lens/, `${page} references media-lens/`);
  }
});

test('analyze.html CSP connect-src remains self-only', async () => {
  const html = await readFile('analyze.html', 'utf8');
  const cspMatch = html.match(/Content-Security-Policy[^>]*content="([^"]+)"/);
  assert.ok(cspMatch, 'CSP meta tag not found in analyze.html');
  assert.match(cspMatch[1], /connect-src 'self';/);
  assert.doesNotMatch(cspMatch[1], /connect-src[^;]*127\.0\.0\.1/);
  assert.doesNotMatch(cspMatch[1], /connect-src[^;]*localhost/);
});

test('index.html CSP connect-src remains self-only', async () => {
  const html = await readFile('index.html', 'utf8');
  const cspMatch = html.match(/Content-Security-Policy[^>]*content="([^"]+)"/);
  assert.ok(cspMatch, 'CSP meta tag not found in index.html');
  assert.match(cspMatch[1], /connect-src 'self'/);
});

test('scoring.js analyzeMessage never calls fetch, even if fetch is stubbed to throw', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('scoring.js must never call fetch');
  };
  try {
    const { analyzeMessage } = await import('../scoring.js');
    const inputs = [
      'You always do this to me. If you loved me you would just do what I ask right now.',
      'Can we talk about the schedule for next week sometime?',
      'Everyone agrees you are the problem here, so just admit it before things get worse.'
    ];
    for (const text of inputs) {
      const result = analyzeMessage(text);
      assert.ok(result, 'analyzeMessage should return a result without calling fetch');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('media-lens worker modules are entirely separate from the Clarity PWA app shell', async () => {
  const serviceWorker = await readFile('service-worker.js', 'utf8');
  assert.doesNotMatch(serviceWorker, /media-lens/);
});
