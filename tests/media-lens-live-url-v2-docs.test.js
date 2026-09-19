import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  PAGES_FORBIDDEN_NAMES,
  buildPagesSite,
  isAllowedSitePath,
  isForbiddenSitePath,
  listSiteFiles
} from '../scripts/build-pages-site.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ARCHITECTURE = 'docs/media-lens-live-url-v2-architecture.md';
const PLAN = 'docs/media-lens-live-url-v2-implementation-plan.md';
const RUNBOOK = 'docs/media-lens-ops-runbook-v2.md';

const CONCEPTS = [
  'Factual verification',
  'Source perspective/ownership',
  'Coverage differences',
  'Omission',
  'Emotional/coercive language',
  'Propaganda/persuasion signals',
  'Potential manipulation',
  'Uncertainty and abstention'
];

test('Live URL v2 Phase 1 design artifacts exist and stay off GitHub Pages', async () => {
  await access(ARCHITECTURE);
  await access(PLAN);
  await access(RUNBOOK);
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('docs'), 'docs/ must remain on the Pages forbidden list');
  assert.equal(isAllowedSitePath(ARCHITECTURE), false);
  assert.equal(isAllowedSitePath(PLAN), false);
  assert.equal(isAllowedSitePath(RUNBOOK), false);
  assert.equal(isForbiddenSitePath(ARCHITECTURE), true);
  assert.equal(isForbiddenSitePath(PLAN), true);
  assert.equal(isForbiddenSitePath(RUNBOOK), true);

  const dest = await mkdtemp(join(tmpdir(), 'clarity-pages-live-url-v2-docs-'));
  await buildPagesSite(dest);
  const files = await listSiteFiles(dest);
  assert.equal(files.includes(ARCHITECTURE), false);
  assert.equal(files.includes(PLAN), false);
  assert.equal(files.includes(RUNBOOK), false);
});

test('Live URL v2 design docs link Issue #118, stay disabled-by-default, and do not claim production readiness', async () => {
  const architecture = await readFile(ARCHITECTURE, 'utf8');
  const plan = await readFile(PLAN, 'utf8');

  for (const [path, content] of [
    [ARCHITECTURE, architecture],
    [PLAN, plan]
  ]) {
    assert.match(content, /Issue #118/);
    assert.match(content, /https:\/\/github\.com\/Bthornton1994\/Manipulation-score\/issues\/118/);
    assert.match(content, /9cca5648c41410631b11605a538200cd28fce04a/);
    assert.match(content, /a1e7e4a1e28fab15a3988ac794379bd85fed9141/);
    assert.match(content, /disabled by default/i);
    assert.match(content, /Live pasted-text/);
    assert.match(content, /fail closed/i);
    assert.doesNotMatch(content, /sk-[A-Za-z0-9]{16,}/, `${path} must not contain a live-looking secret`);
    assert.doesNotMatch(
      content,
      /live URL is production-ready|production-ready live URL|ready for production/i,
      `${path} must not claim live URL production readiness`
    );
  }
});

test('Live URL v2 architecture keeps the eight concepts distinct and forbids emitting potential manipulation', async () => {
  const architecture = await readFile(ARCHITECTURE, 'utf8');
  for (const concept of CONCEPTS) {
    assert.match(architecture, new RegExp(concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing concept: ${concept}`);
  }
  assert.match(architecture, /must not collapse/i);
  assert.match(architecture, /potential_manipulation/);
  assert.match(architecture, /Nowhere in the graph/);
  assert.match(architecture, /connect-time destination pinning/i);
  assert.match(architecture, /NAT64/);
  assert.match(architecture, /SIIT/);
  assert.match(architecture, /::\/96/);
  assert.match(architecture, /DNS rebinding/i);
  assert.match(architecture, /Threat model/);
  assert.match(architecture, /typed/i);
  assert.match(architecture, /jev-1\.13\.0/);
});

test('Live URL v2 implementation plan maps Issue #118 gates and separates the security fetch PR from product UI', async () => {
  const plan = await readFile(PLAN, 'utf8');
  assert.match(plan, /Security fetch PR/);
  assert.match(plan, /product UI/);
  assert.match(plan, /Connect-time/);
  assert.match(plan, /Independent security review/);
  assert.match(plan, /Canary/);
  assert.match(plan, /rebind-ttl/);
  assert.match(plan, /nat64-wk-loopback/);
  assert.match(plan, /siit-loopback/);
  assert.match(plan, /compat-96-loopback/);
  assert.match(plan, /MEDIA_LENS_ENABLE_LIVE_URL/);
  assert.match(plan, /MEDIA_LENS_KILL_SWITCH/);
});
