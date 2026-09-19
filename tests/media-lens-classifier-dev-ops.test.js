import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PAGES_FORBIDDEN_NAMES,
  buildPagesSite,
  isAllowedSitePath,
  isForbiddenSitePath,
  listSiteFiles
} from '../scripts/build-pages-site.js';
import { loadConfig, publicConfig, classifierDevAdapterEnabled } from '../media-lens/worker/config.js';
import { createClassifierDevAdapter } from '../media-lens/worker/adapters/classifier-dev.js';
import { CDEV_LABEL_IDS } from '../media-lens/worker/classifier-dev/taxonomy.js';

const PRIVACY = 'docs/media-lens-classifier-dev-privacy.md';
const EVAL_DOC = 'docs/media-lens-classifier-dev-eval.md';
const RUNBOOK = 'docs/media-lens-ops-runbook-v2.md';

test('classifier.dev docs stay off the Pages allowlist with docs/ and media-lens/', async () => {
  await access(PRIVACY);
  await access(EVAL_DOC);
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('docs'));
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('media-lens'));
  assert.equal(isAllowedSitePath(PRIVACY), false);
  assert.equal(isForbiddenSitePath(PRIVACY), true);
  assert.equal(isAllowedSitePath(EVAL_DOC), false);
  const dest = await mkdtemp(join(tmpdir(), 'clarity-pages-cdev-'));
  await buildPagesSite(dest);
  const files = await listSiteFiles(dest);
  assert.equal(files.includes(PRIVACY), false);
  assert.equal(files.includes(EVAL_DOC), false);
  assert.equal(files.some((file) => file.startsWith('media-lens/')), false);
});

test('privacy disposition lists provider claims as UNVERIFIED and stays evaluation-only', async () => {
  const body = await readFile(PRIVACY, 'utf8');
  assert.match(body, /UNVERIFIED/);
  assert.match(body, /evaluation-only/);
  assert.match(body, /Issue #118/);
  assert.match(body, /does \*\*not\*\* close/);
  assert.match(body, /Private messages/);
  assert.match(body, /pasted sensitive/);
  assert.doesNotMatch(body, /production-ready live classifier\.dev/i);
  assert.doesNotMatch(body, /sk-[A-Za-z0-9]{16,}/);
});

test('eval doc documents thresholds without claiming they are met or citing AG News as proof', async () => {
  const body = await readFile(EVAL_DOC, 'utf8');
  assert.match(body, /claimed_thresholds_met/);
  assert.match(body, /Not met, not claimed/i);
  assert.match(body, /AG News/);
  assert.match(body, /not claimed/i);
  assert.doesNotMatch(body, /AG News proves|thresholds are met/i);
});

test('runbook can disable classifier.dev independently of Jev and fail closed when unavailable', async () => {
  const body = await readFile(RUNBOOK, 'utf8');
  assert.match(body, /MEDIA_LENS_ENABLE_CLASSIFIER_DEV/);
  assert.match(body, /independently disableable/);
  assert.match(body, /unset MEDIA_LENS_ENABLE_CLASSIFIER_DEV/);
  assert.match(body, /POST \/v1\/classify/);
  assert.match(body, /selected 502/);
  assert.match(body, /circuit_open/);
  assert.match(body, /not a second independent model/i);
  assert.match(body, /every external Jev-capable path, including isolated pin verification and classifier\.dev/);
  assert.match(body, /Redirects are not followed/);
  assert.match(body, /agree_calibrated/);
  assert.match(body, /jev-1\.13\.0/);
  assert.match(body, /MEDIA_LENS_CLASSIFIER_DEV_TIER/);
  assert.match(body, /Unset\/empty → `fast`/);
});

test('browser Media Lens files never call classifier.dev', async () => {
  for (const file of ['media-lens/media-lens.js', 'media-lens/index.html', 'media-lens/media-lens.css']) {
    const src = await readFile(file, 'utf8');
    assert.doesNotMatch(src, /classifier\.dev/);
    assert.doesNotMatch(src, /\/v1\/classify/);
  }
});

test('publicConfig never includes a classifier.dev URL with credentials', () => {
  const config = loadConfig({
    MEDIA_LENS_ENABLE_CLASSIFIER_DEV: 'true',
    MEDIA_LENS_CLASSIFIER_DEV_BASE_URL: 'https://user:s3cret@classifier.dev'
  });
  const view = publicConfig(config);
  const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /s3cret/);
  assert.doesNotMatch(serialized, /user:s3cret/);
  assert.equal(view.classifierDev.host, null);
  assert.equal(view.classifierDev.evaluationOnly, true);
});

test('kill switch disables classifier.dev even when ENABLE_CLASSIFIER_DEV=true', async () => {
  const config = loadConfig({
    MEDIA_LENS_ENABLE_CLASSIFIER_DEV: 'true',
    MEDIA_LENS_KILL_SWITCH: 'true'
  });
  assert.equal(config.classifierDev.enabled, true);
  assert.equal(classifierDevAdapterEnabled(config), false);
  let hits = 0;
  const adapter = createClassifierDevAdapter({
    enabled: classifierDevAdapterEnabled(config),
    isKillSwitchAsserted: () => true,
    fetchImpl: async () => {
      hits += 1;
      throw new Error('kill switch must not fetch');
    }
  });
  const result = await adapter.classify({ inputs: ['The committee met on Tuesday.'], labels: CDEV_LABEL_IDS });
  assert.equal(hits, 0);
  assert.equal(result.networkCalls, 0);
});

test('default CI environment does not enable classifier.dev', async () => {
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_CLASSIFIER_DEV, 'true');
  assert.notEqual(process.env.MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE, 'true');
  const adapter = createClassifierDevAdapter({
    enabled: classifierDevAdapterEnabled(loadConfig(process.env)),
    fetchImpl: async () => {
      throw new Error('CI default must not call classifier.dev');
    }
  });
  assert.equal(adapter.enabled, false);
  assert.ok(CDEV_LABEL_IDS.length >= 13);
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /node --test tests\/\*\.test\.js/);
  assert.doesNotMatch(ci, /MEDIA_LENS_ENABLE_CLASSIFIER_DEV/);
  assert.doesNotMatch(ci, /MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE/);
});
