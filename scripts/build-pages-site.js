#!/usr/bin/env node
// Explicit GitHub Pages allowlist. The public site is Clarity only:
// Media Lens, repository documentation, agent-control files, tests,
// fixtures, and other non-site source must never enter the Pages artifact.
// CI and tests must use this module so the published inventory cannot
// drift from what we verify.

import { access, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PAGES_ROOT_FILES = Object.freeze([
  'acceptable-use.html',
  'accessibility.html',
  'analyze.html',
  'app.js',
  'changelog.html',
  'CNAME',
  'contact.html',
  'fonts.css',
  'history-storage.js',
  'icon.svg',
  'index.html',
  'learn.html',
  'limitations.html',
  'manifest.webmanifest',
  'methodology.html',
  'ocr-clean.js',
  'ocr.js',
  'privacy.html',
  'robots.txt',
  'safety.js',
  'scoring.js',
  'service-worker.js',
  'sitemap.xml',
  'styles.css',
  'terms.html',
  'text-normalize.js'
]);

export const PAGES_ROOT_DIRS = Object.freeze(['fonts', 'vendor']);

export const PAGES_FORBIDDEN_NAMES = Object.freeze([
  'docs',
  'media-lens',
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
  'package-lock.json',
  'scripts',
  'evaluations',
  'fixtures',
  'artifacts',
  'NEWSJACK-LICENSE.md'
]);

export function isAllowedSitePath(relativePath) {
  const norm = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!norm || norm === '.' || norm.includes('..')) return false;
  if (PAGES_ROOT_FILES.includes(norm)) return true;
  return PAGES_ROOT_DIRS.some((dir) => norm === dir || norm.startsWith(`${dir}/`));
}

export function isForbiddenSitePath(relativePath) {
  const norm = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = norm.split('/').filter(Boolean);
  if (parts.some((part) => PAGES_FORBIDDEN_NAMES.includes(part))) return true;
  if (PAGES_FORBIDDEN_NAMES.includes(norm)) return true;
  return false;
}

export async function listSiteFiles(root) {
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(full)));
      else files.push(relative(root, full).replace(/\\/g, '/'));
    }
    return files;
  }
  return (await walk(root)).sort();
}

export async function buildPagesSite(dest = '_site', { repoRoot = REPO_ROOT } = {}) {
  const destAbs = resolve(dest);
  await rm(destAbs, { recursive: true, force: true });
  await mkdir(destAbs, { recursive: true });

  for (const file of PAGES_ROOT_FILES) {
    const from = join(repoRoot, file);
    await access(from);
    await cp(from, join(destAbs, file));
  }
  for (const dir of PAGES_ROOT_DIRS) {
    const from = join(repoRoot, dir);
    await access(from);
    await cp(from, join(destAbs, dir), { recursive: true });
  }
  return destAbs;
}

function isRunAsCli() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
}

if (isRunAsCli()) {
  const dest = process.argv[2] || join(REPO_ROOT, '_site');
  buildPagesSite(dest)
    .then(async (built) => {
      const files = await listSiteFiles(built);
      console.log(`Built Pages artifact at ${built} (${files.length} files)`);
    })
    .catch((err) => {
      console.error(`Pages allowlist build failed: ${err.message}`);
      process.exitCode = 1;
    });
}
