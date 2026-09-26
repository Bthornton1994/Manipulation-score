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
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LIMITS } from '../media-lens/worker/config.js';
import { sanitizeBudgetStoreRecord } from '../media-lens/worker/typesafe-budget-store.js';

const ARCHITECTURE = 'docs/media-lens-live-url-v2-architecture.md';
const PLAN = 'docs/media-lens-live-url-v2-implementation-plan.md';
const RUNBOOK = 'docs/media-lens-ops-runbook-v2.md';
const CANARY_DRILL = 'docs/media-lens-canary-drill-v1.md';

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
  await access(CANARY_DRILL);
  assert.ok(PAGES_FORBIDDEN_NAMES.includes('docs'), 'docs/ must remain on the Pages forbidden list');
  assert.equal(isAllowedSitePath(ARCHITECTURE), false);
  assert.equal(isAllowedSitePath(PLAN), false);
  assert.equal(isAllowedSitePath(RUNBOOK), false);
  assert.equal(isAllowedSitePath(CANARY_DRILL), false);
  assert.equal(isForbiddenSitePath(ARCHITECTURE), true);
  assert.equal(isForbiddenSitePath(PLAN), true);
  assert.equal(isForbiddenSitePath(RUNBOOK), true);
  assert.equal(isForbiddenSitePath(CANARY_DRILL), true);

  const dest = await mkdtemp(join(tmpdir(), 'clarity-pages-live-url-v2-docs-'));
  await buildPagesSite(dest);
  const files = await listSiteFiles(dest);
  assert.equal(files.includes(ARCHITECTURE), false);
  assert.equal(files.includes(PLAN), false);
  assert.equal(files.includes(RUNBOOK), false);
  assert.equal(files.includes(CANARY_DRILL), false);
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
  assert.match(architecture, /ISATAP/);
  assert.match(architecture, /fec0::\/10/);
  assert.match(architecture, /3ffe::\/16/);
  assert.match(architecture, /RFC 3879/);
  assert.match(architecture, /nat64-extra-nonzero-64-95-loopback/);
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
  assert.match(plan, /nat64-extra-nonzero-64-95-loopback/);
  assert.match(plan, /isatap-loopback/);
  assert.match(plan, /siit-loopback/);
  assert.match(plan, /compat-96-loopback/);
  assert.match(plan, /v6-site-local/);
  assert.match(plan, /v6-6bone/);
  assert.match(plan, /fec0::\/10/);
  assert.match(plan, /3ffe::\/16/);
  assert.match(plan, /MEDIA_LENS_ENABLE_LIVE_URL/);
  assert.match(plan, /MEDIA_LENS_KILL_SWITCH/);
  assert.match(plan, /media-lens-canary-drill-v1/);
  assert.match(plan, /DRILL_PACKET_ONLY|does \*\*not\*\* grant `READY_FOR_CANARY`/);
});

const FRONTEND_DEPLOYMENT = 'docs/media-lens-frontend-deployment.md';
const CADDYFILE = 'media-lens/deploy/Caddyfile';

// The worker's abstention copy when the ESTIMATED budget record cannot be
// read or a durable write of it fails. Docs quote it exactly.
const BUDGET_UNAVAILABLE_COPY =
  'The TypeSafe ESTIMATED budget record could not be read or updated, so no live Jev analysis was performed.';
const OLD_BUDGET_UNAVAILABLE_COPY =
  'The TypeSafe ESTIMATED budget record could not be read, so no live Jev analysis was performed.';

// The exact blocker statement for live coverage. It must stay identical in
// every place that explains why story discovery and coverage comparison are
// not live, so a future edit cannot soften one copy.
const COVERAGE_BLOCKER =
  'Real story discovery, same-story clustering, and cross-outlet coverage comparison are not live. The worker can read allowlisted RSS or Atom feeds only when `MEDIA_LENS_ENABLE_STORY_DISCOVERY` is the exact value true and the source registry marks that feed approved. No feed is approved. Every named candidate stays `candidate_pending_owner_approval` and is not fetched. Fixture discovery is labeled and is refused by a live-mode worker. The worker reads no Newsjack output, and no Newsjack binary is approved for ml-jev. Article URL analysis does not discover stories or compare outlet coverage.';

function caddyServedPatterns(caddy) {
  const patterns = [];
  for (const name of ['api', 'media_lens_ui', 'shared_assets']) {
    const line = caddy.split('\n').find((l) => l.trim().startsWith(`@${name} path `));
    assert.ok(line, `Caddyfile is missing the @${name} matcher`);
    patterns.push(...line.trim().split(/\s+/).slice(2));
  }
  return patterns;
}

function caddyPathMatches(pattern, path) {
  return pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
}

test('frontend deployment doc is a worker-restart release procedure, not a frontend-only packet', async () => {
  const doc = await readFile(FRONTEND_DEPLOYMENT, 'utf8');
  assert.match(doc, /\*\*not frontend-only\*\*/);
  assert.match(doc, /PR #146 `live_fixture_disabled`, PR #145 timeout call\s+accounting, PR #149 fail-closed budget record/);
  assert.match(doc, /git -C \/opt\/media-lens\/app rev-parse HEAD/);
  assert.match(doc, /md5sum \/etc\/media-lens\/worker\.env > \/root\/media-lens-worker-env\.md5/);
  assert.match(doc, /sudo md5sum -c --quiet \/root\/media-lens-worker-env\.md5/);
  assert.match(doc, /systemctl cat media-lens-worker/);
  assert.match(doc, /sudo systemctl restart media-lens-worker/);
  assert.match(doc, /Python 3\.12 or newer and Trafilatura `2\.2\.0`/);
  assert.match(doc, /No Caddy change is needed/);
  assert.match(doc, /"error":"live_fixture_disabled"/);
  assert.match(doc, /"error":"live_killed"/);
  assert.match(doc, /`\/health` is public/);
  assert.match(doc, /alert recipient email address/);
  assert.match(doc, /GitHub Pages/);
  assert.match(doc, /Vercel runs an automatic production build/);
  assert.match(doc, /Neither one is an ml-jev deploy/);
  assert.match(doc, /Issue #118 stays open/);
  assert.doesNotMatch(doc, /curl -i https:\/\/ml-jev\.manipulationscore\.com\/worker\/server\.js/);
  assert.doesNotMatch(doc, /\{"error":"not_found"\}/);
  assert.doesNotMatch(doc, /sk-[A-Za-z0-9]{16,}/);
});

test('frontend deployment 404 probes name real repository paths that the Caddy site does not serve', async () => {
  const doc = await readFile(FRONTEND_DEPLOYMENT, 'utf8');
  const caddy = await readFile(CADDYFILE, 'utf8');
  const loop = doc.slice(doc.indexOf('for p in '), doc.indexOf('; do', doc.indexOf('for p in ')));
  const probes = loop
    .replace('for p in ', '')
    .split(/[\s\\]+/)
    .filter(Boolean);
  assert.deepEqual(probes, [
    '/media-lens/worker/server.js',
    '/media-lens/worker/config.js',
    '/media-lens/README.md',
    '/media-lens/fixtures/expected/synthetic-01-quoted-vs-authorial.graph.json',
    '/media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html',
    '/docs/media-lens-ops-runbook-v2.md',
    '/tests/media-lens-ui.test.js',
    '/.git/HEAD',
    '/.env',
    '/package.json'
  ]);
  const served = caddyServedPatterns(caddy);
  assert.match(caddy, /respond 404/);
  for (const probe of probes) {
    assert.equal(
      served.some((pattern) => caddyPathMatches(pattern, probe)),
      false,
      `${probe} would be served by the Caddy site`
    );
    // Every probe except .env and .git (absent or a worktree pointer in some
    // checkouts) is a real file, so a 404 shows the boundary holds.
    if (probe !== '/.env' && probe !== '/.git/HEAD') await access(probe.slice(1));
  }
});

test('frontend deployment budget checks mirror the budget store schema and lock timing', async () => {
  const doc = await readFile(FRONTEND_DEPLOYMENT, 'utf8');
  const keys = Object.keys(
    sanitizeBudgetStoreRecord({ version: 1, month: '2026-09', calls: 0, estimatedTokens: 0, warnEmitted: false })
  )
    .sort()
    .join(',');
  assert.ok(doc.includes(`"${keys}"`), 'the doc validity check must list exactly the budget store keys');
  const flat = doc.replace(/\s+/g, ' ');
  assert.ok(flat.includes(BUDGET_UNAVAILABLE_COPY), 'the deploy doc must quote the abstention copy exactly');
  assert.ok(!flat.includes(OLD_BUDGET_UNAVAILABLE_COPY), 'the deploy doc must not quote the old abstention copy');
  // A failed write now fails closed until repair and restart; the doc must
  // not describe the old keep-in-memory-and-continue behavior.
  assert.match(flat, /A failed budget write also fails closed after this release\./);
  assert.match(flat, /the lock cannot be created, the lock wait times out, the directory is not writable, or the disk is full/);
  assert.match(flat, /until an operator repairs the record and restarts the worker/);
  assert.match(flat, /Same-month counts read from the file never lower the worker's in-memory counts\./);
  assert.doesNotMatch(flat, /spend is undercounted/);
  assert.doesNotMatch(flat, /give up and keep the calls in memory only/);
  // Writability must be checked as the systemd unit sees it.
  assert.match(flat, /A shell `test -w` is not enough on its own\./);
  assert.match(flat, /`ProtectSystem=`, `ReadOnlyPaths=`, `ReadWritePaths=`/);
  assert.match(flat, /systemctl show media-lens-worker -p User -p ProtectSystem -p ReadOnlyPaths/);
  assert.match(flat, /sudo systemd-run --wait --pipe --quiet -p User="\$WORKER_USER"/);
  assert.match(flat, /This repository does not record the unit's sandbox settings/);

  const storeSrc = await readFile('media-lens/worker/typesafe-budget-store.js', 'utf8');
  assert.match(storeSrc, /maxAttempts = 200, baseDelayMs = 2/);
  assert.match(storeSrc, /sleepMs\(baseDelayMs \+ Math\.min\(attempt, 40\)\)/);
  let totalMs = 0;
  for (let attempt = 0; attempt < 200; attempt += 1) totalMs += 2 + Math.min(attempt, 40);
  assert.equal(Math.round(totalMs / 100) / 10, 7.6);
  assert.match(doc, /about 7\.6\s+s\s+\(200\s+attempts\)/);
});

test('Media Lens docs state the worker/config.js limits, not the stale 10 per minute and 30 s values', async () => {
  assert.equal(DEFAULT_LIMITS.maxAnalysesPerMinute, 5);
  assert.equal(DEFAULT_LIMITS.perAnalysisTimeoutMs, 15000);
  for (const path of [ARCHITECTURE, 'docs/media-lens-influence-graph-plan.md', RUNBOOK, 'media-lens/README.md']) {
    const content = await readFile(path, 'utf8');
    assert.doesNotMatch(content, /10 analyses (\/|per) minute/, path);
    assert.doesNotMatch(content, /\b30\s?s (per )?analysis/, path);
  }
});

test('the coverage blocker statement is identical wherever live coverage is explained', async () => {
  for (const path of ['README.md', 'media-lens/README.md', 'docs/media-lens-story-workspace.md']) {
    const content = await readFile(path, 'utf8');
    assert.ok(content.includes(COVERAGE_BLOCKER), `${path} must carry the exact coverage blocker statement`);
    assert.match(content, /real story discovery, same-story clustering, and cross-outlet coverage comparison/i, path);
  }
});

test('media-lens/README.md quotes the worker copy for the #146 and #149 fixes exactly', async () => {
  const readme = await readFile('media-lens/README.md', 'utf8');
  const serverSrc = await readFile('media-lens/worker/server.js', 'utf8');
  const fixtureCopy =
    'Fixture examples are disabled in live mode. Use URL mode for approved public sources, or run a fixture-only worker for local development.';
  assert.ok(serverSrc.includes(fixtureCopy));
  assert.ok(readme.includes(fixtureCopy));
  assert.ok(readme.includes(BUDGET_UNAVAILABLE_COPY));
  assert.ok(!readme.includes(OLD_BUDGET_UNAVAILABLE_COPY));
  assert.match(readme, /`400 live_fixture_disabled`/);
  assert.match(readme, /This rejection writes no audit line/);
  assert.match(readme, /\*\*Release review, failed budget write\.\*\*/);
  assert.match(readme, /until an operator repairs the record and restarts the worker/);
});

test('ops runbook describes the fail-closed budget write with the exact copy', async () => {
  const runbook = (await readFile(RUNBOOK, 'utf8')).replace(/\s+/g, ' ');
  assert.ok(runbook.includes(BUDGET_UNAVAILABLE_COPY));
  assert.ok(!runbook.includes(OLD_BUDGET_UNAVAILABLE_COPY));
  assert.match(runbook, /a durable write of the record fails for any reason/);
  assert.match(runbook, /until an operator repairs the record and restarts it/);
  assert.doesNotMatch(runbook, /an unwritable file undercounts spend/);
});

// This cross-check follows the release-review worker change to analyze.js.
// It fails until that change lands, so the docs and the worker cannot drift.
test('the documented budget abstention copy is the copy analyze.js serves', async () => {
  const analyzeSrc = await readFile('media-lens/worker/analyze.js', 'utf8');
  assert.ok(analyzeSrc.includes(BUDGET_UNAVAILABLE_COPY), 'analyze.js must serve the documented budget abstention copy');
  assert.ok(!analyzeSrc.includes(OLD_BUDGET_UNAVAILABLE_COPY), 'analyze.js must not keep the old budget abstention copy');
});

test('both READMEs document the 400 invalid_kind rejection', async () => {
  const kinds = ['article', 'headline', 'excerpt', 'speech', 'ad', 'campaign', 'other_public'];
  const schema = JSON.parse(await readFile('media-lens/schema/influence-graph.v1.json', 'utf8'));
  assert.deepEqual(schema.properties.artifact.properties.kind.enum, kinds);
  const readme = await readFile('media-lens/README.md', 'utf8');
  assert.match(readme, /`400 invalid_kind` before any fetch or provider call/);
  assert.ok(readme.includes(kinds.map((kind) => `\`${kind}\``).join(', ')), 'media-lens/README.md lists the artifact kinds');
  const rootReadme = await readFile('README.md', 'utf8');
  assert.match(rootReadme, /`400 invalid_kind` before any fetch or provider call/);
});

test('Media Lens docs and trust pages keep Issue #118 open', async () => {
  const docs = (await readdir('docs')).filter((name) => name.startsWith('media-lens-') && name.endsWith('.md'));
  const files = [
    'README.md',
    'media-lens/README.md',
    ...docs.map((name) => `docs/${name}`),
    'privacy.html',
    'limitations.html',
    'acceptable-use.html',
    'methodology.html',
    'changelog.html'
  ];
  for (const path of files) {
    const content = await readFile(path, 'utf8');
    assert.doesNotMatch(content, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s*:?\s*#118\b/i, `${path} uses a closing keyword on #118`);
  }
});
