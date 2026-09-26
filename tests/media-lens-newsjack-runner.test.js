import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { validateNewsjackCapture } from '../media-lens/schema/newsjack-capture.js';
import { validateStoryDiscovery } from '../media-lens/schema/story-discovery.js';
import {
  NEWSJACK_DEFAULT_PROFILE,
  classifySourceError,
  isTitleFromExcerpt,
  validateRawClusterOutput,
  validateRawDetectorOutput,
  validateRawOriginOutput
} from '../media-lens/tools/newsjack-raw.js';
import { CHILD_ENV_KEYS, CREDENTIAL_PASSTHROUGH, DEAD_PROXY, buildArgv, runNewsjackCapture } from '../media-lens/tools/newsjack-runner.js';
import { SEARCH_PROVIDER_MODE_STATUS } from '../media-lens/worker/discovery/search-provider.js';
import { main as captureCli } from '../scripts/newsjack-capture.js';
import { makeFakeNewsjack, mockSignalId } from './helpers/fake-newsjack.js';
import { FIXTURE_REQUEST, NEWSJACK_FIXTURE_DIR, raw, testPin, timing } from './helpers/newsjack-fixtures.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOPIC = 'transit fare vote';
const MOCK_TEMPLATE = join(NEWSJACK_FIXTURE_DIR, 'raw-detector-mock-shape.json');

function rawCheck(verdict, code) {
  assert.equal(verdict.ok, false, code);
  assert.equal(verdict.code, code);
}

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'newsjack-runner-'));
  const out = join(dir, 'out');
  const work = join(dir, 'work-root');
  await mkdir(out);
  await mkdir(work);
  return { dir, out, work, record: join(dir, 'record.jsonl'), marker: join(dir, 'executed') };
}

async function fake(ws, scenario = {}) {
  return makeFakeNewsjack(ws.dir, { record: ws.record, marker: ws.marker, detectorTemplate: MOCK_TEMPLATE, ...scenario });
}

function runOptions(ws, binary, extra = {}) {
  return {
    binaryPath: binary.path,
    query: TOPIC,
    outDir: ws.out,
    workRoot: ws.work,
    pin: testPin(binary.sha256),
    getuid: () => 1000,
    workerEnvPath: join(ws.dir, 'no-worker.env'),
    ...extra
  };
}

async function exists(path) {
  return access(path).then(
    () => true,
    () => false
  );
}

async function records(ws) {
  if (!(await exists(ws.record))) return [];
  return (await readFile(ws.record, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function sink() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk;
      callback();
    }
  });
  return { stream, text: () => text };
}

// --- raw output shapes -----------------------------------------------------

test('raw detector output must match the pinned v0.1.19 shape and the request that was made', () => {
  const t = timing('detector_run');
  assert.deepEqual(validateRawDetectorOutput(raw('raw-detector.json'), FIXTURE_REQUEST, t, 'fixture'), { ok: true, code: null, path: null });
  const cases = [
    ['unexpected_field', (c) => (c.debug = {})],
    ['unexpected_field', (c) => (c.version = 1)],
    ['missing_field', (c) => delete c.store],
    ['unexpected_field', (c) => (c.signals[0].evidence[0].extra = 1)],
    ['missing_field', (c) => delete c.signals[0].evidence[0].excerpt],
    ['client_profile_present', (c) => (c.monitor.profile.company = 'Acme Corp')],
    ['client_profile_present', (c) => (c.monitor.profile.spokespeople = ['Jane Doe'])],
    ['monitor_name_set', (c) => (c.monitor.name = 'acme-monitor')],
    ['request_mismatch', (c) => (c.monitor.queries = ['other topic'])],
    ['request_mismatch', (c) => (c.monitor.feed_urls = ['https://feeds.example/rss'])],
    ['request_mismatch', (c) => (c.monitor.new_only = true)],
    ['request_mismatch', (c) => (c.monitor.mock = true)],
    ['provider_clock_inconsistent', (c) => (c.monitor.generated_at = '2026-09-25T17:00:00Z')],
    ['provider_clock_inconsistent', (c) => (c.monitor.generated_at = '2026-09-25 18:00:00')],
    ['signal_id_invalid', (c) => (c.signals[0].id = 'not-hex')],
    ['signal_id_duplicate', (c) => (c.signals[1].id = c.signals[0].id)],
    ['evidence_invalid', (c) => (c.signals[0].evidence = [])],
    ['evidence_invalid', (c) => (c.signals[0].features.evidence_count = 1)],
    ['unrequested_source_kind', (c) => (c.signals[0].evidence[0].source = 'reddit')],
    ['unrequested_source_kind', (c) => (c.diagnostics.source_status.x = { requested: false, available: false, attempted: false, evidence_count: 2, status: 'not_requested' })],
    ['source_status_invalid', (c) => delete c.diagnostics.source_status.news_search],
    ['selection_inconsistent', (c) => (c.diagnostics.total_emitted_signals = 3)],
    ['source_errors_invalid', (c) => (c.source_errors = { q: 'text' })],
    ['store_saved_unsupported', (c) => (c.store = { saved: true, run_id: 7, path: '/home/operator/.local/share/newsjack/monitor.db' })]
  ];
  for (const [code, fn] of cases) {
    const candidates = raw('raw-detector.json');
    fn(candidates);
    rawCheck(validateRawDetectorOutput(candidates, FIXTURE_REQUEST, t, 'fixture'), code);
  }
  rawCheck(validateRawDetectorOutput(raw('raw-detector.json'), { ...FIXTURE_REQUEST, limit: 2 }, t, 'fixture'), 'signals_invalid');
  rawCheck(validateRawDetectorOutput([], FIXTURE_REQUEST, t, 'fixture'), 'artifact_shape_invalid');
  // Evidence without metadata is valid: upstream omits empty metadata.
  const mock = raw('raw-detector-mock-shape.json');
  assert.equal(Object.hasOwn(mock.signals[0].evidence[0], 'metadata'), false);
  assert.equal(validateRawDetectorOutput(mock, FIXTURE_REQUEST, { startedMs: Date.parse('2026-09-25T18:00:00.000Z'), exitedMs: Date.parse('2026-09-25T18:00:00.500Z') }, 'mock').ok, true);
  assert.deepEqual(raw('raw-detector.json').monitor.profile, NEWSJACK_DEFAULT_PROFILE);
});

test('raw cluster output must bind to the detector output it was given', () => {
  const candidates = raw('raw-detector.json');
  const t = timing('cluster');
  assert.equal(validateRawClusterOutput(raw('raw-cluster.json'), candidates, t).ok, true);
  const cases = [
    ['version_mismatch', (c) => (c.version = 2)],
    ['stage_time_invalid', (c) => (c.generated_at = '2026-09-25T19:00:00Z')],
    ['artifact_binding_mismatch', (c) => (c.monitor.lookback_days = 7)],
    ['artifact_binding_mismatch', (c) => (c.source_errors = { [TOPIC]: { news_search: 'added after the detector ran' } })],
    ['coarse_decisions_present', (c) => (c.coarse_relevance = { decisions: [] })],
    ['drop_stale_unsupported', (c) => c.pre_gated_stale.push({})],
    ['drop_stale_unsupported', (c) => (c.clustering.drop_stale = true)],
    ['cluster_params_mismatch', (c) => (c.clustering.title_overlap = 0.3)],
    ['clustering_counts_invalid', (c) => (c.clustering.duplicate_count = 5)],
    ['representative_mismatch', (c) => (c.signals[0].title = 'Edited title')],
    ['representative_mismatch', (c) => (c.signals[0].cluster.member_ids = ['ffffffffffffffff'])],
    ['duplicate_summary_mismatch', (c) => (c.clustered_duplicates[0].evidence_urls = ['https://other.example/x'])],
    ['duplicate_summary_mismatch', (c) => (c.clustered_duplicates[0].representative_id = c.signals[1].id)]
  ];
  for (const [code, fn] of cases) {
    const clustered = raw('raw-cluster.json');
    fn(clustered);
    rawCheck(validateRawClusterOutput(clustered, candidates, t), code);
  }
});

test('raw origin-apply output must use the run clock and window the runner set', () => {
  const candidates = raw('raw-detector.json');
  const clustered = raw('raw-cluster.json');
  const t = timing('origin_apply');
  assert.equal(validateRawOriginOutput(raw('raw-origin.json'), candidates, clustered, FIXTURE_REQUEST, t).ok, true);
  const cases = [
    ['origin_run_time_override', (c) => (c.freshness_gate.run_generated_at = '2026-09-25T12:00:00Z')],
    ['origin_window_mismatch', (c) => (c.freshness_gate.freshness_window_hours = 72)],
    ['origin_window_mismatch', (c) => (c.freshness_gate.deterministic_authority = false)],
    ['origin_finding_invalid', (c) => (c.signals[0].freshness_gate.computed_status = 'verified')],
    ['origin_finding_invalid', (c) => (c.signals[0].id = 'ffffffffffffffff')],
    ['origin_signal_mismatch', (c) => (c.signals[0].title = 'Edited title')],
    ['coarse_decisions_present', (c) => (c.coarse_relevance = {})]
  ];
  for (const [code, fn] of cases) {
    const targeted = raw('raw-origin.json');
    fn(targeted);
    rawCheck(validateRawOriginOutput(targeted, candidates, clustered, FIXTURE_REQUEST, t), code);
  }
});

test('source error text is reduced to a class and copied snippets are detected', () => {
  const table = [
    ['Get "https://x/?q=a": context deadline exceeded (Client.Timeout exceeded)', 'timeout'],
    ['dial tcp: lookup medialyst.example: no such host', 'dns'],
    ['tls: failed to verify certificate: x509: unknown authority', 'tls'],
    ['dial tcp 127.0.0.1:9: connect: connection refused', 'refused'],
    ['HTTP 429: {"error":"rate limited"}', 'http_status'],
    ['invalid character < looking for beginning of value', 'parse'],
    ['something else entirely', 'other']
  ];
  for (const [text, expected] of table) assert.equal(classifySourceError(text), expected, text);
  const snippet = 'Officials across the region said on Tuesday that the transit fare vote would be delayed until';
  assert.equal(isTitleFromExcerpt(snippet, snippet), true);
  assert.equal(isTitleFromExcerpt(`${snippet} next spring, citing budget reviews.`, `${snippet}�`), true);
  assert.equal(isTitleFromExcerpt('Council sets fare vote date', snippet), false);
  assert.equal(isTitleFromExcerpt('Short', 'Sh'), false);
});

// --- process boundary --------------------------------------------------------

test('nothing runs while the pinned hash is unrecorded, mismatched, or the host gates fail', async () => {
  const ws = await workspace();
  const binary = await fake(ws);
  const cases = [
    [{ pin: undefined }, 'binary_hash_unrecorded'],
    [{ pin: testPin('b'.repeat(64)) }, 'binary_hash_mismatch'],
    [{ getuid: () => 0 }, 'running_as_root'],
    [{ workerEnvPath: binary.path }, 'worker_secrets_readable'],
    [{ live: true }, 'no_approved_transport'],
    [{ live: true, searchProviderStatus: { ...SEARCH_PROVIDER_MODE_STATUS, medialyst: 'implemented' } }, 'live_credentials_not_supported']
  ];
  for (const [extra, code] of cases) {
    const options = runOptions(ws, binary, extra);
    if ('pin' in extra && extra.pin === undefined) delete options.pin;
    const result = await runNewsjackCapture(options);
    assert.equal(result.status, 'error', code);
    assert.equal(result.code, code);
    assert.equal(result.exitCode, 3, code);
  }
  assert.equal(await exists(ws.marker), false, 'the binary was never executed');
  assert.deepEqual(await readdir(ws.out), []);
  assert.deepEqual(await readdir(ws.work), [], 'no private directory is left behind');
  assert.deepEqual([...CREDENTIAL_PASSTHROUGH], []);
});

test('request and path problems are usage errors and execute nothing', async () => {
  const ws = await workspace();
  const binary = await fake(ws);
  const link = join(ws.dir, 'link-to-binary');
  await symlink(binary.path, link);
  const outLink = join(ws.dir, 'out-link');
  await symlink(ws.out, outLink);
  const cases = [
    [{ query: 'jane@example.com' }, 'query_policy_violation'],
    [{ query: '--profile=/etc/passwd' }, 'query_policy_violation'],
    [{ maxAgeHours: 72 }, 'parameter_out_of_range'],
    [{ depth: 'deep' }, 'parameter_out_of_range'],
    [{ limit: 0 }, 'parameter_out_of_range'],
    [{ originFindings: 'relative/findings.json' }, 'origin_findings_invalid'],
    [{ outDir: 'relative/out' }, 'out_dir_invalid'],
    [{ outDir: outLink }, 'out_dir_invalid'],
    [{ outDir: join(REPO_ROOT, 'media-lens') }, 'out_dir_in_repo'],
    [{ binaryPath: 'newsjack' }, 'binary_path_invalid'],
    [{ binaryPath: link }, 'binary_path_invalid'],
    [{ binaryPath: ws.dir }, 'binary_path_invalid'],
    [{ workRoot: 'relative/work' }, 'work_root_invalid'],
    [{ workRoot: join(ws.dir, 'missing') }, 'work_root_invalid'],
    [{ workRoot: binary.path }, 'work_root_invalid'],
    [{ workRoot: outLink }, 'work_root_invalid'],
    [{ workRoot: join(REPO_ROOT, 'media-lens') }, 'work_root_in_repo']
  ];
  for (const [extra, code] of cases) {
    const result = await runNewsjackCapture(runOptions(ws, binary, extra));
    assert.equal(result.code, code, JSON.stringify(extra));
    assert.equal(result.exitCode, 2);
  }
  assert.equal(await exists(ws.marker), false);
});

test('a pinned run executes a private copy with an exact, credential-free environment', async () => {
  const ws = await workspace();
  const binary = await fake(ws);
  const secrets = { MEDIALYST_API_KEY: 'mlst_SENTINEL', MEDIA_LENS_TYPESAFE_API_KEY: 'sk-SENTINEL', X_BEARER_TOKEN: 'x-SENTINEL', NEWSJACK_HOME: '/home/operator/.newsjack' };
  const saved = Object.fromEntries(Object.keys(secrets).map((key) => [key, process.env[key]]));
  Object.assign(process.env, secrets);
  let result;
  try {
    result = await runNewsjackCapture(runOptions(ws, binary));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(result.document_status, 'empty');
  assert.equal(result.document_reason, 'no_accepted_members');

  const calls = await records(ws);
  assert.deepEqual(calls.map((call) => call.argv[0]), ['version', 'detector', 'cluster']);
  for (const call of calls) {
    // The hashed private copy runs, never the operator's file.
    assert.notEqual(call.script, binary.path);
    assert.ok(call.script.startsWith(join(ws.work, 'ml-newsjack-')), call.script);
    assert.ok(call.script.endsWith(join('bin', 'newsjack')), call.script);
    assert.deepEqual(Object.keys(call.env).sort(), [...CHILD_ENV_KEYS].sort());
    assert.ok(!JSON.stringify(call.env).includes('SENTINEL'));
    assert.equal(call.env.NEWSJACK_AUTO_UPDATE, '0');
    assert.equal(call.env.NEWSJACK_NO_AUTO_UPDATE, '1');
    assert.equal(call.env.NEWSJACK_AUTO_UPDATE_RUNNING, '1');
    assert.equal(call.env.NEWSJACK_DISTRIBUTION, 'npm');
    assert.equal(call.env.NEWSJACK_IGNORE_DOTENV, '1');
    assert.equal(call.env.HTTPS_PROXY, DEAD_PROXY);
    assert.equal(call.env.https_proxy, DEAD_PROXY);
    assert.equal(call.env.NO_PROXY, '');
    assert.ok(call.env.HOME.startsWith(join(ws.work, 'ml-newsjack-')));
    assert.ok(call.env.PATH.endsWith('empty-path'));
    assert.equal(call.cwd, call.env.NEWSJACK_WORKDIR);
  }
  assert.deepEqual(calls[1].argv, buildArgv('detector_run', { ...FIXTURE_REQUEST }, { store: calls[1].env.NEWSJACK_STORE }));
  assert.ok(calls[1].argv.includes('--mock'));
  assert.ok(!calls.some((call) => call.argv.some((arg) => /--(save|profile|feed-url|feed-file|major-feeds|output|run-time|scored-output)/.test(arg))));

  const files = (await readdir(ws.out)).sort();
  assert.deepEqual(files.map((name) => name.replace(/[a-f0-9]{16}/, 'ID')), ['newsjack-capture-ID.json', 'story-discovery-ID.json']);
  for (const name of files) assert.equal((await lstat(join(ws.out, name))).mode & 0o777, 0o600);
  const capture = JSON.parse(await readFile(join(ws.out, files[0]), 'utf8'));
  assert.equal(capture.runner.mode, 'mock');
  assert.equal(capture.newsjack.binary_sha256, binary.sha256);
  assert.deepEqual(validateNewsjackCapture(capture, { pin: testPin(binary.sha256) }), { ok: true, errors: [] });
  const document = JSON.parse(await readFile(join(ws.out, files[1]), 'utf8'));
  assert.deepEqual(validateStoryDiscovery(document), { ok: true, errors: [] });
  assert.equal(document.provenance.binary_sha256, binary.sha256);
  assert.deepEqual(await readdir(ws.work), [], 'the private directory is removed');
});

test('process failures are reported by code and write nothing', async () => {
  const ws = await workspace();
  const cases = [
    [{ version: 'v0.1.18' }, {}, 'version_mismatch', 3],
    [{ steps: { cluster: { action: 'exit', code: 1 } } }, {}, 'newsjack_exit_nonzero:cluster', 4],
    [{ steps: { detector_run: { action: 'malformed' } } }, {}, 'newsjack_output_invalid:candidates.json:artifact_json_invalid', 5],
    [{ steps: { detector_run: { patch: { 'monitor.profile.company': 'Acme Corp' } } } }, {}, 'newsjack_output_invalid:candidates.json:client_profile_present', 5],
    [{ steps: { detector_run: { patch: { 'store.saved': true } } } }, {}, 'newsjack_output_invalid:candidates.json:store_saved_unsupported', 5],
    [{ steps: { cluster: { patch: { coarse_relevance: { keep: [] } } } } }, {}, 'newsjack_output_invalid:clustered_candidates.json:coarse_decisions_present', 5],
    [{ steps: { detector_run: { action: 'sleep' } } }, { timeouts: { version: 5000, detector_run: 300, cluster: 5000, origin_apply: 5000 } }, 'newsjack_timeout:detector_run', 4],
    [{ steps: { detector_run: { action: 'flood' } } }, { maxStdoutBytes: 256 * 1024 }, 'newsjack_output_too_large:detector_run', 4],
    [{ steps: { version: { action: 'mutate-self' } } }, {}, 'binary_hash_mismatch', 3]
  ];
  for (const [scenario, extra, code, exitCode] of cases) {
    const binary = await fake(ws, scenario);
    const result = await runNewsjackCapture(runOptions(ws, binary, extra));
    assert.equal(result.code, code);
    assert.equal(result.exitCode, exitCode, code);
  }
  assert.deepEqual(await readdir(ws.out), []);
  assert.deepEqual(await readdir(ws.work), []);
});

test('a timeout kills the whole process group, including grandchildren', { timeout: 30000 }, async () => {
  const ws = await workspace();
  const pidFile = join(ws.dir, 'grandchild.pid');
  const binary = await fake(ws, { steps: { detector_run: { action: 'grandchild', pidFile } } });
  const result = await runNewsjackCapture(runOptions(ws, binary, { timeouts: { version: 5000, detector_run: 1500, cluster: 5000, origin_apply: 5000 } }));
  assert.equal(result.code, 'newsjack_timeout:detector_run');
  const pid = await readPid(pidFile);
  let alive = true;
  for (let i = 0; i < 40 && alive; i += 1) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false, 'the grandchild was killed with the group');
});

async function readPid(pidFile) {
  for (let i = 0; i < 100; i += 1) {
    const text = await readFile(pidFile, 'utf8').catch(() => '');
    if (/^\d+$/.test(text)) return Number(text);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the fake never wrote its pid file');
}

test('a descendant that leaves the process group cannot hold the run open', async () => {
  const ws = await workspace();
  const pidFile = join(ws.dir, 'setsid.pid');
  const binary = await fake(ws, { steps: { detector_run: { action: 'setsid', pidFile } } });
  const killDescendant = async () => {
    const pid = await readPid(pidFile).catch(() => null);
    if (!pid) return;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  };
  const run = runNewsjackCapture(runOptions(ws, binary, { timeouts: { version: 5000, detector_run: 1000, cluster: 5000, origin_apply: 5000 } }));
  // Without the hard deadline the run would wait as long as the descendant
  // lives. Race it, and on a hang kill the descendant so the test fails
  // instead of hanging the whole suite.
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('hung'), 20000);
  });
  const outcome = await Promise.race([run, deadline]);
  clearTimeout(timer);
  await killDescendant();
  if (outcome === 'hung') {
    await run;
    assert.fail('the runner waited on a descendant past the hard deadline');
  }
  assert.equal(outcome.code, 'newsjack_timeout:detector_run');
  assert.deepEqual(await readdir(ws.out), []);
});

test('an abort before or between steps stops the run without executing more', async () => {
  const ws = await workspace();
  const binary = await fake(ws);
  const controller = new AbortController();
  controller.abort();
  const result = await runNewsjackCapture(runOptions(ws, binary, { signal: controller.signal }));
  assert.equal(result.code, 'newsjack_killed:aborted');
  assert.equal(result.exitCode, 4);
  assert.equal(await exists(ws.marker), false);
  assert.deepEqual(await readdir(ws.out), []);
  assert.deepEqual(await readdir(ws.work), []);
});

test('origin-apply output is validated in the run, not only in unit checks', async () => {
  const ws = await workspace();
  const findings = join(ws.dir, 'findings.json');
  await writeFile(findings, JSON.stringify({ findings: [{ signal_id: mockSignalId(TOPIC), same_story_assessment: 'same_story', first_public_at: null, timestamp_evidence: [] }] }));
  const binary = await fake(ws, { steps: { origin_apply: { patch: { 'freshness_gate.freshness_window_hours': 72 } } } });
  const result = await runNewsjackCapture(runOptions(ws, binary, { originFindings: findings }));
  assert.equal(result.code, 'newsjack_output_invalid:targeted_candidates.json:origin_window_mismatch');
  assert.equal(result.exitCode, 5);
  assert.deepEqual(await readdir(ws.out), []);
});

test('an out dir swapped for a symlink during the run receives nothing', async () => {
  const ws = await workspace();
  const elsewhere = join(ws.dir, 'elsewhere');
  const binary = await fake(ws, { steps: { cluster: { swapDir: { path: ws.out, target: elsewhere } } } });
  const result = await runNewsjackCapture(runOptions(ws, binary));
  assert.equal(result.code, 'out_dir_changed');
  assert.equal(result.exitCode, 6);
  assert.deepEqual(await readdir(elsewhere), []);
});

test('an abort signal stops the running step', { timeout: 30000 }, async () => {
  const ws = await workspace();
  const binary = await fake(ws, { steps: { detector_run: { action: 'sleep' } } });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const result = await runNewsjackCapture(runOptions(ws, binary, { signal: controller.signal }));
  assert.equal(result.code, 'newsjack_killed:detector_run');
  assert.deepEqual(await readdir(ws.work), []);
});

test('stderr is counted, never read, stored, or echoed', async () => {
  const ws = await workspace();
  const canary = 'SENTINEL-STDERR mlst_live_key Authorization: Bearer abc';
  const binary = await fake(ws, { steps: { detector_run: { stderr: canary }, cluster: { stderr: canary } } });
  const result = await runNewsjackCapture(runOptions(ws, binary));
  assert.equal(result.status, 'ok');
  assert.ok(!JSON.stringify(result).includes('SENTINEL'));
  for (const name of await readdir(ws.out)) {
    const text = await readFile(join(ws.out, name), 'utf8');
    assert.ok(!text.includes('SENTINEL') && !text.includes('mlst_') && !text.includes('Bearer'), name);
  }
  const capture = JSON.parse(await readFile(join(ws.out, (await readdir(ws.out)).find((name) => name.startsWith('newsjack-capture'))), 'utf8'));
  assert.equal(capture.process.steps[1].stderr_bytes, Buffer.byteLength(canary));
});

test('origin findings run origin-apply and land only as unverified claims', async () => {
  const ws = await workspace();
  const findings = join(ws.dir, 'findings.json');
  await writeFile(findings, JSON.stringify({ findings: [{ signal_id: mockSignalId(TOPIC), same_story_assessment: 'same_story', first_public_at: new Date(Date.now() - 3600000).toISOString(), rationale: 'SENTINEL-RATIONALE', timestamp_evidence: [] }] }));
  const binary = await fake(ws, { originStatus: 'unverified_no_corroboration' });
  const result = await runNewsjackCapture(runOptions(ws, binary, { originFindings: findings }));
  assert.equal(result.status, 'ok', JSON.stringify(result));
  const calls = await records(ws);
  assert.deepEqual(calls.map((call) => call.argv[0]), ['version', 'detector', 'cluster', 'origin-apply']);
  assert.ok(calls[3].argv.includes('--allow-missing'));
  assert.ok(!calls[3].argv.some((arg) => arg.startsWith('--run-time') || arg.startsWith('--allow-unknown')));
  const captureFile = (await readdir(ws.out)).find((name) => name.startsWith('newsjack-capture'));
  const capture = JSON.parse(await readFile(join(ws.out, captureFile), 'utf8'));
  assert.match(capture.request.origin_findings_sha256, /^[a-f0-9]{64}$/);
  assert.equal(capture.origin.claims.length, 1);
  assert.equal(capture.origin.claims[0].freshness_status, 'unverified_no_corroboration');
  assert.ok(!JSON.stringify(capture).includes('SENTINEL'));
});

test('an empty Newsjack run is a valid capture that converts to empty', async () => {
  const ws = await workspace();
  const binary = await fake(ws, { emptyRun: true });
  const result = await runNewsjackCapture(runOptions(ws, binary));
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(result.document_status, 'empty');
  assert.deepEqual(result.counts, { clusters: 0, members: 0, rejected: 0 });
});

test('the fake binary cannot resolve helpers through PATH', async () => {
  const ws = await workspace();
  const binary = await fake(ws);
  await runNewsjackCapture(runOptions(ws, binary));
  const [call] = await records(ws);
  const which = () => execFileSync(process.execPath, ['-e', 'require("node:child_process").execSync("curl --version", {stdio:"ignore"})'], { env: call.env, stdio: 'ignore' });
  assert.throws(which, 'curl is not reachable with the child PATH');
});

// --- operator CLI ------------------------------------------------------------

test('the capture CLI converts a capture file and refuses non-regular files', async () => {
  const out = sink();
  const err = sink();
  const code = await captureCli(['convert', join(NEWSJACK_FIXTURE_DIR, 'capture-fixture.json')], { stdout: out.stream, stderr: err.stream, now: () => Date.parse('2026-09-26T00:00:00.000Z') });
  assert.equal(code, 0);
  const document = JSON.parse(out.text());
  assert.equal(document.status, 'ok');
  assert.equal(document.data_origin, 'fixture');

  const ws = await workspace();
  const fifo = join(ws.dir, 'capture.fifo');
  execFileSync('mkfifo', [fifo]);
  const fifoErr = sink();
  assert.equal(await captureCli(['convert', fifo], { stdout: sink().stream, stderr: fifoErr.stream }), 1);
  assert.equal(JSON.parse(fifoErr.text()).code, 'capture_not_regular_file');

  const junk = join(ws.dir, 'junk.json');
  await writeFile(junk, '{"contract": "media-lens.newsjack-capture.v1"}');
  const junkOut = sink();
  assert.equal(await captureCli(['convert', junk], { stdout: junkOut.stream, stderr: sink().stream }), 1);
  assert.equal(JSON.parse(junkOut.text()).status, 'abstain');
  assert.equal(await captureCli(['convert', 'relative.json'], { stdout: sink().stream, stderr: sink().stream }), 2);
});

test('the capture CLI run prints codes only and never the query or titles', async () => {
  const usage = sink();
  assert.equal(await captureCli([], { stdout: sink().stream, stderr: usage.stream }), 2);
  assert.equal(JSON.parse(usage.text()).code, 'usage_invalid');

  const ws = await workspace();
  const binary = await fake(ws);
  const refused = sink();
  const refusedCode = await captureCli(['run', '--binary', binary.path, '--query', TOPIC, '--out-dir', ws.out, '--work-root', ws.work], {
    stdout: sink().stream,
    stderr: refused.stream,
    runOptions: { getuid: () => 1000, workerEnvPath: join(ws.dir, 'none') }
  });
  assert.equal(refusedCode, 3);
  assert.deepEqual(JSON.parse(refused.text()), { status: 'error', code: 'binary_hash_unrecorded' });

  const live = sink();
  assert.equal(await captureCli(['run', '--binary', binary.path, '--query', TOPIC, '--out-dir', ws.out, '--live'], { stdout: sink().stream, stderr: live.stream }), 3);
  assert.equal(JSON.parse(live.text()).code, 'no_approved_transport');

  const ok = sink();
  const okCode = await captureCli(['run', '--binary', binary.path, '--query', TOPIC, '--out-dir', ws.out, '--work-root', ws.work], {
    stdout: ok.stream,
    stderr: sink().stream,
    pin: testPin(binary.sha256),
    runOptions: { getuid: () => 1000, workerEnvPath: join(ws.dir, 'none') }
  });
  assert.equal(okCode, 0);
  const summary = JSON.parse(ok.text());
  assert.deepEqual(Object.keys(summary).sort(), ['capture_id', 'counts', 'document_reason', 'document_status', 'status']);
  assert.ok(!ok.text().includes(TOPIC) && !ok.text().includes('Regulators'));
  assert.equal(await exists(ws.marker), true);
});

test('the capture CLI turns SIGINT, SIGTERM, and SIGHUP into an abort and removes its handlers', async () => {
  const ws = await workspace();
  const binary = await fake(ws);
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const before = process.listenerCount(name);
    const err = sink();
    const pending = captureCli(['run', '--binary', binary.path, '--query', TOPIC, '--out-dir', ws.out], {
      stdout: sink().stream,
      stderr: err.stream,
      runCapture: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ status: 'error', exitCode: 4, code: 'newsjack_killed:aborted' }), { once: true });
        })
    });
    setImmediate(() => process.emit(name));
    assert.equal(await pending, 4, name);
    assert.deepEqual(JSON.parse(err.text()), { status: 'error', code: 'newsjack_killed:aborted' });
    assert.equal(process.listenerCount(name), before, name);
  }
});

test('the capture CLI runs when invoked through a symlink', async () => {
  const ws = await workspace();
  const link = join(ws.dir, 'newsjack-capture.js');
  await symlink(join(REPO_ROOT, 'scripts', 'newsjack-capture.js'), link);
  let failure;
  try {
    execFileSync(process.execPath, [link], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'a usage error exits non-zero instead of silently doing nothing');
  assert.equal(failure.status, 2);
  assert.deepEqual(JSON.parse(failure.stderr.toString()), { status: 'error', code: 'usage_invalid' });
});
