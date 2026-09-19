import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PAGES_FORBIDDEN_NAMES,
  PAGES_ROOT_DIRS,
  PAGES_ROOT_FILES,
  buildPagesSite,
  isAllowedSitePath,
  isForbiddenSitePath,
  listSiteFiles
} from '../scripts/build-pages-site.js';

test('ci.yml builds Pages from the shared allowlist script, not a repo-wide rsync', async () => {
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /node scripts\/build-pages-site\.js/);
  assert.doesNotMatch(ci, /\brsync\b/);
});

test('the Pages allowlist is Clarity site files only', () => {
  assert.ok(PAGES_ROOT_FILES.includes('privacy.html'));
  assert.ok(PAGES_ROOT_FILES.includes('index.html'));
  assert.ok(PAGES_ROOT_DIRS.includes('fonts'));
  assert.ok(PAGES_ROOT_DIRS.includes('vendor'));
  for (const name of [
    'docs',
    'media-lens',
    'artifacts',
    'tests',
    '.agents',
    '.claude',
    '.cursor',
    '.grok',
    '.github',
    'AGENTS.md',
    'BRAND.md',
    'DESIGN.md',
    'README.md',
    'VISION.md',
    'package.json',
    'package-lock.json'
  ]) {
    assert.ok(PAGES_FORBIDDEN_NAMES.includes(name), `expected ${name} to be forbidden`);
    assert.equal(PAGES_ROOT_FILES.includes(name), false, `${name} must not be an allowed root file`);
    assert.equal(PAGES_ROOT_DIRS.includes(name), false, `${name} must not be an allowed root dir`);
  }
});

test('building the Pages artifact copies only allowlisted paths and excludes governance/source files', async () => {
  const dest = await mkdtemp(join(tmpdir(), 'clarity-pages-artifact-'));
  await buildPagesSite(dest);
  const files = await listSiteFiles(dest);

  assert.ok(files.includes('privacy.html'));
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('CNAME'));
  assert.ok(files.some((f) => f.startsWith('fonts/')));
  assert.ok(files.some((f) => f.startsWith('vendor/')));

  for (const file of files) {
    assert.equal(isForbiddenSitePath(file), false, `${file} is a forbidden Pages path`);
    assert.equal(isAllowedSitePath(file), true, `${file} is not on the Pages allowlist`);
  }

  const forbiddenRelatives = [
    'docs/NEWSJACK-LICENSE.md',
    'docs/media-lens-build-brief.md',
    'docs/media-lens-live-url-v2-architecture.md',
    'docs/media-lens-live-url-v2-implementation-plan.md',
    'docs/media-lens-ops-runbook-v2.md',
    'docs/media-lens-canary-drill-v1.md',
    'docs/media-lens-jev-integration-v2.md',
    'docs/media-lens-classifier-dev-privacy.md',
    'docs/media-lens-classifier-dev-eval.md',
    'media-lens/index.html',
    'media-lens/README.md',
    'tests/pages-artifact-boundary.test.js',
    'AGENTS.md',
    'BRAND.md',
    'DESIGN.md',
    'README.md',
    'VISION.md',
    'package.json',
    'package-lock.json',
    'scripts/build-pages-site.js',
    'scripts/jev-pin-verify.js',
    '.github/workflows/jev-pin-verify.yml'
  ];
  for (const rel of forbiddenRelatives) {
    assert.equal(files.includes(rel), false, `${rel} must not be published via Pages`);
  }

  await access('docs/NEWSJACK-LICENSE.md');
  await access('docs/media-lens-live-url-v2-architecture.md');
  await access('docs/media-lens-live-url-v2-implementation-plan.md');
  await access('docs/media-lens-ops-runbook-v2.md');
  await access('docs/media-lens-canary-drill-v1.md');
  await access('docs/media-lens-classifier-dev-privacy.md');
  await access('docs/media-lens-classifier-dev-eval.md');
  await access('media-lens/README.md');
  await access('README.md');
});
