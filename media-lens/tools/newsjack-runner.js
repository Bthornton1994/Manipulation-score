// Operator tool: the process boundary around a pinned Newsjack binary.
// Never imported under media-lens/worker/**. The worker never spawns
// Newsjack; tests/media-lens-newsjack-boundary.test.js enforces that.
//
// What this does, in order, failing closed at every step:
// 1. Checks the request (query policy, parameter ranges, paths).
// 2. Refuses live mode: no approved news-search transport exists, and no
//    credential is ever passed to the child.
// 3. Refuses to run as root or where the worker's secrets file is readable.
// 4. Copies the operator-supplied binary into a private 0700 directory and
//    executes the copy only if its sha256 equals the pinned hash. Every
//    pinned hash is null today, so nothing real can run until the owner
//    records one.
// 5. Runs only `version`, `detector run --mock`, `cluster`, and optionally
//    `origin-apply`, each with an exact environment allowlist (no
//    credentials, private HOME and state, empty PATH, auto-update locked
//    five ways, a dead-port proxy tripwire), a wall-clock limit that kills
//    the whole process group, and a stdout cap. stderr is counted, never
//    read or kept.
// 6. Validates every output against the pinned shapes, projects a
//    media-lens.newsjack-capture.v1 record, converts it to
//    story-discovery.v1, and writes both files atomically.
//
// OS-level isolation (a dedicated user, egress rules, a container) is still
// required before any live use. Nothing here is a sandbox.

import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNewsjackQuery, validateNewsjackCapture } from '../schema/newsjack-capture.js';
import { validateStoryDiscovery } from '../schema/story-discovery.js';
import { captureToStoryDiscovery } from '../worker/discovery/newsjack-discovery.js';
import { NEWSJACK_PIN, pinnedBinarySha256 } from '../worker/discovery/newsjack-pin.js';
import { SEARCH_PROVIDER_MODE_STATUS } from '../worker/discovery/search-provider.js';
import { projectCapture, validateRawClusterOutput, validateRawDetectorOutput, validateRawOriginOutput } from './newsjack-raw.js';

const DEFAULT_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_BINARY_BYTES = 64 * 1024 * 1024;
const MAX_FINDINGS_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_STDOUT_BYTES = 10 * 1024 * 1024;
const KILL_GRACE_MS = 2000;
export const DEFAULT_STEP_TIMEOUTS = Object.freeze({ version: 5000, detector_run: 20000, cluster: 20000, origin_apply: 20000 });
export const DEAD_PROXY = 'http://127.0.0.1:9';

// The complete environment a Newsjack child process receives. Nothing from
// the operator's environment is inherited.
export const CHILD_ENV_KEYS = Object.freeze([
  'HOME',
  'NEWSJACK_HOME',
  'NEWSJACK_ROOT',
  'NEWSJACK_WORKDIR',
  'NEWSJACK_STORE',
  'NEWSJACK_IGNORE_DOTENV',
  'NEWSJACK_AUTO_UPDATE',
  'NEWSJACK_NO_AUTO_UPDATE',
  'NEWSJACK_AUTO_UPDATE_RUNNING',
  'NEWSJACK_DISTRIBUTION',
  'NO_COLOR',
  'TERM',
  'PATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'NO_PROXY',
  'no_proxy'
]);

// Credentials the child may receive. Empty: Medialyst, X, and TypeSafe keys
// never reach Newsjack through this tool.
export const CREDENTIAL_PASSTHROUGH = Object.freeze([]);

const EXIT = Object.freeze({ ok: 0, usage: 2, refused: 3, process: 4, invalid: 5, write: 6 });

class RunnerError extends Error {
  constructor(code, exitCode) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
  }
}

const fail = (code, exitCode) => {
  throw new RunnerError(code, exitCode);
};

export function buildChildEnv({ privateDir }) {
  const env = {
    HOME: join(privateDir, 'home'),
    NEWSJACK_HOME: join(privateDir, 'newsjack-home'),
    NEWSJACK_ROOT: join(privateDir, 'newsjack-root'),
    NEWSJACK_WORKDIR: join(privateDir, 'work'),
    NEWSJACK_STORE: join(privateDir, 'store', 'monitor.db'),
    // Stop the .env walk and every dotenv read.
    NEWSJACK_IGNORE_DOTENV: '1',
    // Auto-update locks: two explicit switches, the recursion guard, the
    // npm distribution marker, and (by construction) a binary that is not
    // $NEWSJACK_HOME/bin/newsjack.
    NEWSJACK_AUTO_UPDATE: '0',
    NEWSJACK_NO_AUTO_UPDATE: '1',
    NEWSJACK_AUTO_UPDATE_RUNNING: '1',
    NEWSJACK_DISTRIBUTION: 'npm',
    NO_COLOR: '1',
    TERM: 'dumb',
    // An empty directory, so no helper binary (curl, sh) can be found.
    PATH: join(privateDir, 'empty-path'),
    // Every Go HTTP client in the pinned build uses the default transport,
    // which honors these. A request would go to a closed local port.
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    http_proxy: DEAD_PROXY,
    https_proxy: DEAD_PROXY,
    NO_PROXY: '',
    no_proxy: ''
  };
  return Object.freeze(env);
}

export function buildArgv(step, request, paths) {
  switch (step) {
    case 'version':
      return ['version'];
    case 'detector_run':
      return [
        'detector',
        'run',
        '--mock',
        '--sources=news_search',
        '--no-x-news',
        '--no-x-trends',
        '--no-profile-feeds',
        `--depth=${request.depth}`,
        `--lookback-days=${request.lookback_days}`,
        `--max-age-hours=${request.max_age_hours}`,
        `--limit=${request.limit}`,
        '--min-queue-priority=0',
        '--min-major-news=0',
        `--store=${paths.store}`,
        `--topic=${request.query}`
      ];
    case 'cluster':
      return ['cluster', `--candidates=${paths.candidates}`, '--title-overlap=0.6', '--min-shared-tokens=2'];
    case 'origin_apply':
      return ['origin-apply', `--candidates=${paths.clustered}`, `--origins=${paths.findings}`, `--window-hours=${request.max_age_hours}`, '--allow-missing'];
    default:
      throw new Error(`unknown step ${step}`);
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isInsideOrEqual(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && rel.split(sep)[0] !== '..');
}

async function regularFile(path, maxBytes) {
  if (typeof path !== 'string' || !isAbsolute(path)) return null;
  try {
    const info = await lstat(path);
    return info.isFile() && info.size <= maxBytes ? info : null;
  } catch {
    return null;
  }
}

function intInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export async function checkRunRequest(opts, { repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const query = checkNewsjackQuery(opts.query);
  if (!query.ok) fail('query_policy_violation', EXIT.usage);
  const request = {
    query: query.query,
    depth: opts.depth ?? 'quick',
    lookback_days: opts.lookbackDays ?? 1,
    max_age_hours: opts.maxAgeHours ?? 24,
    limit: opts.limit ?? 20
  };
  if (
    (request.depth !== 'quick' && request.depth !== 'default') ||
    !intInRange(request.lookback_days, 1, 7) ||
    !intInRange(request.max_age_hours, 1, 48) ||
    !intInRange(request.limit, 1, 50)
  ) {
    fail('parameter_out_of_range', EXIT.usage);
  }
  if (opts.originFindings !== undefined && opts.originFindings !== null && !(await regularFile(opts.originFindings, MAX_FINDINGS_BYTES))) {
    fail('origin_findings_invalid', EXIT.usage);
  }
  if (typeof opts.outDir !== 'string' || !isAbsolute(opts.outDir)) fail('out_dir_invalid', EXIT.usage);
  let outInfo;
  try {
    outInfo = await lstat(opts.outDir);
  } catch {
    fail('out_dir_invalid', EXIT.usage);
  }
  if (!outInfo.isDirectory() || outInfo.isSymbolicLink()) fail('out_dir_invalid', EXIT.usage);
  const outReal = await realpath(opts.outDir);
  const repoReal = await realpath(repoRoot).catch(() => repoRoot);
  if (isInsideOrEqual(repoReal, outReal)) fail('out_dir_in_repo', EXIT.usage);
  if (opts.workRoot !== undefined && opts.workRoot !== null) {
    if (typeof opts.workRoot !== 'string' || !isAbsolute(opts.workRoot)) fail('work_root_invalid', EXIT.usage);
    let workInfo;
    try {
      workInfo = await lstat(opts.workRoot);
    } catch {
      fail('work_root_invalid', EXIT.usage);
    }
    if (!workInfo.isDirectory() || workInfo.isSymbolicLink()) fail('work_root_invalid', EXIT.usage);
  }
  const workReal = await realpath(opts.workRoot ?? tmpdir()).catch(() => null);
  if (!workReal) fail('work_root_invalid', EXIT.usage);
  if (isInsideOrEqual(repoReal, workReal)) fail('work_root_in_repo', EXIT.usage);
  if (typeof opts.binaryPath !== 'string' || !isAbsolute(opts.binaryPath)) fail('binary_path_invalid', EXIT.usage);
  if (!(await regularFile(opts.binaryPath, MAX_BINARY_BYTES))) fail('binary_path_invalid', EXIT.usage);
  return { request, workRoot: workReal, outDir: outReal };
}

// Read a regular file without following a symlink swapped in after the
// request check, and never more than maxBytes.
async function readBoundedNoFollow(path, maxBytes) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const buffer = await handle.readFile();
    return buffer.length <= maxBytes ? buffer : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// The out dir is re-checked right before writing, so a symlink swapped in
// during the run cannot redirect the output.
async function checkOutDirUnchanged(outDir) {
  const info = await lstat(outDir).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) fail('out_dir_changed', EXIT.write);
  if ((await realpath(outDir).catch(() => null)) !== outDir) fail('out_dir_changed', EXIT.write);
}

function runStep({ spawnImpl, binary, argv, env, cwd, timeoutMs, maxStdoutBytes, now, signal }) {
  return new Promise((resolve) => {
    const startedMs = now();
    let child;
    try {
      child = spawnImpl(binary, argv, { shell: false, cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch {
      resolve({ spawnFailed: true, startedMs, exitedMs: now() });
      return;
    }
    const chunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let timedOut = false;
    let aborted = false;
    let spawnFailed = false;
    let killing = false;
    let settled = false;
    const timers = [];
    const later = (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      timers.push(timer);
    };
    const signalGroup = (name) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, name);
      } catch {
        // group already gone
      }
    };
    const settle = (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // Reap anything left in the group.
      signalGroup('SIGKILL');
      resolve({
        spawnFailed,
        exitCode,
        exitSignal,
        timedOut,
        overflow,
        aborted,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stdoutBytes,
        stderrBytes,
        startedMs,
        exitedMs: now()
      });
    };
    // Kill once: SIGTERM to the group, SIGKILL after a grace period, and a
    // hard deadline that stops waiting even if a descendant left the group
    // and still holds the output pipes.
    const killGroup = () => {
      if (killing) return;
      killing = true;
      signalGroup('SIGTERM');
      later(() => signalGroup('SIGKILL'), KILL_GRACE_MS);
      later(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle(null, 'SIGKILL');
      }, 2 * KILL_GRACE_MS);
    };
    const onAbort = () => {
      aborted = true;
      killGroup();
    };
    later(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        if (!overflow) {
          overflow = true;
          killGroup();
        }
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
    });
    child.on('error', () => {
      spawnFailed = true;
    });
    child.on('close', (exitCode, exitSignal) => settle(exitCode, exitSignal));
  });
}

async function writeAtomic(path, text) {
  const existing = await readFile(path, 'utf8').catch(() => null);
  if (existing !== null) {
    if (existing === text) return;
    fail('output_collision', EXIT.write);
  }
  const temp = `${path}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, path);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    if (error instanceof RunnerError) throw error;
    fail('write_failed', EXIT.write);
  }
}

/**
 * Run one Newsjack capture. Returns a code-only summary; never returns
 * queries, titles, stderr, or paths.
 */
export async function runNewsjackCapture(opts = {}) {
  const {
    live = false,
    pin = NEWSJACK_PIN,
    spawnImpl = nodeSpawn,
    now = () => Date.now(),
    getuid = () => (typeof process.getuid === 'function' ? process.getuid() : null),
    workerEnvPath = '/etc/media-lens/worker.env',
    killSwitchAsserted = () => false,
    searchProviderStatus = SEARCH_PROVIDER_MODE_STATUS,
    timeouts = DEFAULT_STEP_TIMEOUTS,
    maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
    repoRoot = DEFAULT_REPO_ROOT,
    platformKey = `${process.platform}-${process.arch}`,
    signal = null
  } = opts;
  let privateDir = null;
  const checkAbort = () => {
    if (signal?.aborted) fail('newsjack_killed:aborted', EXIT.process);
  };
  try {
    const { request, workRoot, outDir } = await checkRunRequest(opts, { repoRoot });
    checkAbort();

    if (live) {
      if (searchProviderStatus?.medialyst !== 'implemented') fail('no_approved_transport', EXIT.refused);
      if (CREDENTIAL_PASSTHROUGH.length === 0) fail('live_credentials_not_supported', EXIT.refused);
      if (killSwitchAsserted()) fail('kill_switch_asserted', EXIT.refused);
    }
    if (getuid() === 0) fail('running_as_root', EXIT.refused);
    const secretsReadable = await access(workerEnvPath, fsConstants.R_OK).then(
      () => true,
      () => false
    );
    if (secretsReadable) fail('worker_secrets_readable', EXIT.refused);

    const expectedHash = pinnedBinarySha256(pin, platformKey);
    if (!expectedHash) fail('binary_hash_unrecorded', EXIT.refused);

    privateDir = await mkdtemp(join(workRoot, 'ml-newsjack-'));
    await chmod(privateDir, 0o700);
    for (const dir of ['bin', 'home', 'newsjack-home', 'newsjack-root', 'work', 'store', 'empty-path']) {
      await mkdir(join(privateDir, dir), { mode: 0o700 });
    }
    const binary = join(privateDir, 'bin', 'newsjack');
    await copyFile(opts.binaryPath, binary);
    await chmod(binary, 0o500);
    const verifyBinary = async () => {
      if (sha256(await readFile(binary)) !== expectedHash) fail('binary_hash_mismatch', EXIT.refused);
    };
    await verifyBinary();

    const env = buildChildEnv({ privateDir });
    const workDir = join(privateDir, 'work');
    const paths = {
      store: join(privateDir, 'store', 'monitor.db'),
      candidates: join(workDir, 'candidates.json'),
      clustered: join(workDir, 'clustered_candidates.json'),
      findings: join(workDir, 'origin_findings.json')
    };
    const steps = [];
    const runPinnedStep = async (step) => {
      checkAbort();
      // Re-verify the exact bytes before every execution.
      await verifyBinary();
      const result = await runStep({
        spawnImpl,
        binary,
        argv: buildArgv(step, request, paths),
        env,
        cwd: workDir,
        timeoutMs: timeouts[step],
        maxStdoutBytes,
        now,
        signal
      });
      if (result.spawnFailed) fail(`spawn_failed:${step}`, EXIT.process);
      if (result.aborted) fail(`newsjack_killed:${step}`, EXIT.process);
      if (result.timedOut) fail(`newsjack_timeout:${step}`, EXIT.process);
      if (result.overflow) fail(`newsjack_output_too_large:${step}`, EXIT.process);
      if (result.exitSignal) fail(`newsjack_killed:${step}`, EXIT.process);
      if (result.exitCode !== 0) fail(`newsjack_exit_nonzero:${step}`, EXIT.process);
      steps.push({
        step,
        started_at: new Date(result.startedMs).toISOString(),
        exited_at: new Date(result.exitedMs).toISOString(),
        exit_code: 0,
        timed_out: false,
        stdout_bytes: result.stdoutBytes,
        stderr_bytes: result.stderrBytes
      });
      return result;
    };
    const parse = (text, file) => {
      try {
        return JSON.parse(text);
      } catch {
        return fail(`newsjack_output_invalid:${file}:artifact_json_invalid`, EXIT.invalid);
      }
    };
    const check = (verdict, file) => {
      if (!verdict.ok) fail(`newsjack_output_invalid:${file}:${verdict.code}`, EXIT.invalid);
    };

    const version = await runPinnedStep('version');
    if (version.stdout.trim() !== pin.version) fail('version_mismatch', EXIT.refused);

    const detector = await runPinnedStep('detector_run');
    const candidates = parse(detector.stdout, 'candidates.json');
    check(validateRawDetectorOutput(candidates, request, { startedMs: detector.startedMs, exitedMs: detector.exitedMs }, 'mock'), 'candidates.json');
    await writeFileExclusive(paths.candidates, detector.stdout);

    const clusterRun = await runPinnedStep('cluster');
    const clustered = parse(clusterRun.stdout, 'clustered_candidates.json');
    check(validateRawClusterOutput(clustered, candidates, { startedMs: clusterRun.startedMs, exitedMs: clusterRun.exitedMs }), 'clustered_candidates.json');

    let targeted = null;
    let findingsSha256 = null;
    if (opts.originFindings) {
      const findingsText = await readBoundedNoFollow(opts.originFindings, MAX_FINDINGS_BYTES);
      if (!findingsText) fail('origin_findings_invalid', EXIT.usage);
      findingsSha256 = sha256(findingsText);
      await writeFileExclusive(paths.clustered, clusterRun.stdout);
      await writeFileExclusive(paths.findings, findingsText);
      const originRun = await runPinnedStep('origin_apply');
      targeted = parse(originRun.stdout, 'targeted_candidates.json');
      check(
        validateRawOriginOutput(targeted, candidates, clustered, request, { startedMs: originRun.startedMs, exitedMs: originRun.exitedMs }),
        'targeted_candidates.json'
      );
    }

    const capture = projectCapture({
      request,
      pin,
      binarySha256: expectedHash,
      mode: 'mock',
      steps,
      candidates,
      clustered,
      targeted,
      findingsSha256
    });
    const captureCheck = validateNewsjackCapture(capture, { pin });
    if (!captureCheck.ok) fail(`capture_invalid:${captureCheck.errors[0].code}`, EXIT.invalid);
    const document = captureToStoryDiscovery(capture, { now: now(), pin });
    if (document.status !== 'ok' && document.status !== 'empty') fail(`document_invalid:${document.reason}`, EXIT.invalid);
    if (!validateStoryDiscovery(document).ok) fail('document_invalid', EXIT.invalid);

    checkAbort();
    const id16 = capture.capture_id.slice(0, 16);
    const captureFile = `newsjack-capture-${id16}.json`;
    const documentFile = `story-discovery-${id16}.json`;
    await checkOutDirUnchanged(outDir);
    await writeAtomic(join(outDir, captureFile), `${JSON.stringify(capture, null, 2)}\n`);
    await writeAtomic(join(outDir, documentFile), `${JSON.stringify(document, null, 2)}\n`);
    return {
      status: 'ok',
      exitCode: EXIT.ok,
      code: null,
      capture_id: capture.capture_id,
      document_status: document.status,
      document_reason: document.reason,
      counts: {
        clusters: document.clusters.length,
        members: document.clusters.reduce((sum, cluster) => sum + cluster.members.length, 0),
        rejected: document.sources_checked.reduce((sum, row) => sum + row.rejected_total, 0)
      },
      files: [captureFile, documentFile]
    };
  } catch (error) {
    if (error instanceof RunnerError) return { status: 'error', exitCode: error.exitCode, code: error.code };
    return { status: 'error', exitCode: EXIT.process, code: 'runner_internal_error' };
  } finally {
    if (privateDir) await rm(privateDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeFileExclusive(path, content) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}
