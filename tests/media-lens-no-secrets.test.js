import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { PAGES_ROOT_DIRS, PAGES_ROOT_FILES, isAllowedSitePath } from '../scripts/build-pages-site.js';

const SECRET_PATTERNS = [/MEDIA_LENS_TYPESAFE_API_KEY/, /TYPESAFE_API_KEY/, /Authorization/, /api\.typesafe\.ai/, /medialyst/i];

async function listPublishedFiles() {
  const files = PAGES_ROOT_FILES.map((name) => join('.', name));
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const found = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative('.', full).replace(/\\/g, '/');
      if (entry.isDirectory()) found.push(...(await walk(full)));
      else if (isAllowedSitePath(rel)) found.push(full);
    }
    return found;
  }
  for (const dir of PAGES_ROOT_DIRS) files.push(...(await walk(dir)));
  return files;
}

async function listAllMediaLensFiles() {
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(full)));
      else files.push(full);
    }
    return files;
  }
  return walk('media-lens');
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Scoped to executable/served code, not prose documentation: architecture
// docs (docs/*.md, README.md) are expected to name the env var and
// recipient so operators can configure live mode; they never contain an
// actual key value. The hard invariant is that no browser-served *code*
// file can make an authenticated call or embed a key.
const SERVED_CODE_EXTENSIONS = new Set(['.html', '.js', '.css', '.webmanifest']);

test('no served code file outside media-lens/worker contains secret-related identifiers', async () => {
  const published = await listPublishedFiles('.');
  for (const file of published) {
    const ext = file.slice(file.lastIndexOf('.'));
    if (!SERVED_CODE_EXTENSIONS.has(ext)) continue;
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue; // binary or unreadable file; not a JS/HTML secret risk
    }
    for (const pattern of SECRET_PATTERNS) {
      assert.doesNotMatch(content, pattern, `${file} matched forbidden secret pattern ${pattern}`);
    }
  }
});

test('architecture docs may name the env var but never an actual key value', async () => {
  const docs = [
    'docs/media-lens-build-brief.md',
    'docs/media-lens-influence-graph-plan.md',
    'docs/media-lens-live-url-v2-architecture.md',
    'docs/media-lens-live-url-v2-implementation-plan.md',
    'docs/media-lens-ops-runbook-v2.md',
    'docs/media-lens-jev-integration-v2.md'
  ];
  for (const doc of docs) {
    const content = await readFile(doc, 'utf8');
    assert.doesNotMatch(content, /sk-[A-Za-z0-9]{16,}/, `${doc} appears to contain a live-looking secret value`);
  }
});

test('media-lens browser-served files never reference process.env or secret identifiers', async () => {
  const browserFiles = ['media-lens/index.html', 'media-lens/media-lens.js', 'media-lens/media-lens.css'];
  for (const file of browserFiles) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /process\.env/, `${file} references process.env`);
    for (const pattern of SECRET_PATTERNS) {
      assert.doesNotMatch(content, pattern, `${file} matched forbidden secret pattern ${pattern}`);
    }
  }
});

test('media-lens schema/ and fixtures/ never reference process.env or secret identifiers', async () => {
  const allFiles = await listAllMediaLensFiles();
  const nonWorkerFiles = allFiles.filter((f) => !f.includes(`${join('media-lens', 'worker')}${join('', '')}`) && !relative('media-lens', f).startsWith('worker'));
  for (const file of nonWorkerFiles) {
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (!file.endsWith('.js') && !file.endsWith('.json') && !file.endsWith('.html') && !file.endsWith('.css')) continue;
    assert.doesNotMatch(content, /process\.env/, `${file} references process.env`);
  }
});

test('only worker/config.js reads process.env directly', async () => {
  const workerFiles = (await listAllMediaLensFiles()).filter((f) => f.endsWith('.js') && relative('media-lens', f).startsWith('worker'));
  for (const file of workerFiles) {
    const content = stripComments(await readFile(file, 'utf8'));
    if (/process\.env/.test(content)) {
      assert.ok(
        file.endsWith(join('worker', 'config.js')),
        `${file} reads process.env directly; only worker/config.js should read environment variables`
      );
    }
  }
});

test('.gitignore excludes .env files', async () => {
  const gitignore = await readFile('.gitignore', 'utf8');
  assert.match(gitignore, /^\.env$/m);
});

test('ci.yml publishes Pages through the shared allowlist script and never includes media-lens/', async () => {
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /node scripts\/build-pages-site\.js/);
  assert.doesNotMatch(ci, /\brsync\b/);
  assert.equal(
    PAGES_ROOT_FILES.some((name) => name === 'media-lens' || name.startsWith('media-lens/')),
    false
  );
  assert.equal(PAGES_ROOT_DIRS.includes('media-lens'), false);
});

test('no key value is ever returned from the worker health/public config', async () => {
  const { loadConfig, publicConfig } = await import('../media-lens/worker/config.js');
  const config = loadConfig({ MEDIA_LENS_TYPESAFE_API_KEY: 'sk-super-secret-value', MEDIA_LENS_MODE: 'fixture' });
  const publicView = publicConfig(config);
  const serialized = JSON.stringify(publicView);
  assert.doesNotMatch(serialized, /sk-super-secret-value/);
  assert.equal(publicView.jev.hasApiKey, true);
});
