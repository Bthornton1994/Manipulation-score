#!/usr/bin/env node
// Operator CLI for the Newsjack capture path. Not part of the worker, not a
// route, and not run in CI with a real binary.
//
//   node scripts/newsjack-capture.js run --binary <abs path> --query "<public topic>" --out-dir <abs dir>
//       [--max-age-hours 1-48] [--lookback-days 1-7] [--depth quick|default] [--limit 1-50]
//       [--origin-findings <abs path>] [--work-root <abs dir>] [--live]
//   node scripts/newsjack-capture.js convert <capture.json>
//
// `run` executes only a binary whose sha256 matches NEWSJACK_PIN, and every
// pinned hash is null until the owner records one, so it refuses today.
// `--live` is always refused: no approved news-search transport exists.
// Output is a code-only JSON summary. Queries, titles, stderr, and paths are
// never printed.
//
// Exit codes: 0 ok, 1 convert abstained, 2 usage, 3 gate or pin refused,
// 4 Newsjack process failure, 5 output validation failure, 6 write failure.

import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { validateStoryDiscovery } from '../media-lens/schema/story-discovery.js';
import { runNewsjackCapture } from '../media-lens/tools/newsjack-runner.js';
import { isKillSwitchAsserted } from '../media-lens/worker/config.js';
import { captureToStoryDiscovery } from '../media-lens/worker/discovery/newsjack-discovery.js';
import { NEWSJACK_PIN } from '../media-lens/worker/discovery/newsjack-pin.js';

const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const RUN_FLAGS = new Map([
  ['--binary', 'binaryPath'],
  ['--query', 'query'],
  ['--out-dir', 'outDir'],
  ['--max-age-hours', 'maxAgeHours'],
  ['--lookback-days', 'lookbackDays'],
  ['--depth', 'depth'],
  ['--limit', 'limit'],
  ['--origin-findings', 'originFindings'],
  ['--work-root', 'workRoot']
]);
const INTEGER_FLAGS = new Set(['maxAgeHours', 'lookbackDays', 'limit']);

function parseRunArgs(args) {
  const opts = { live: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--live') {
      opts.live = true;
      continue;
    }
    const key = RUN_FLAGS.get(arg);
    if (!key || i + 1 >= args.length || Object.prototype.hasOwnProperty.call(opts, key)) return null;
    const value = args[i + 1];
    i += 1;
    if (INTEGER_FLAGS.has(key)) {
      if (!/^\d{1,3}$/.test(value)) return null;
      opts[key] = Number(value);
    } else {
      opts[key] = value;
    }
  }
  if (!opts.binaryPath || !opts.query || !opts.outDir) return null;
  if (opts.workRoot !== undefined && !isAbsolute(opts.workRoot)) return null;
  return opts;
}

function write(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

async function convert(path, { stdout, stderr, now, pin }) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    write(stderr, { status: 'error', code: 'usage_invalid' });
    return 2;
  }
  let info;
  try {
    info = await lstat(path);
  } catch {
    write(stderr, { status: 'error', code: 'capture_unreadable' });
    return 1;
  }
  // lstat first, so a FIFO or symlink cannot block or redirect the read.
  if (!info.isFile() || info.size > MAX_CAPTURE_BYTES) {
    write(stderr, { status: 'error', code: 'capture_not_regular_file' });
    return 1;
  }
  let text;
  try {
    text = await readFile(path, { encoding: 'utf8', signal: AbortSignal.timeout(10000) });
  } catch {
    write(stderr, { status: 'error', code: 'capture_unreadable' });
    return 1;
  }
  const document = captureToStoryDiscovery(text, { now: now(), pin });
  if (!validateStoryDiscovery(document).ok) {
    write(stderr, { status: 'error', code: 'document_invalid' });
    return 5;
  }
  stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  return document.status === 'abstain' ? 1 : 0;
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {object} deps injectable for tests
 */
export async function main(argv, deps = {}) {
  const {
    stdout = process.stdout,
    stderr = process.stderr,
    now = () => Date.now(),
    pin = NEWSJACK_PIN,
    runCapture = runNewsjackCapture,
    runOptions = {},
    env = process.env
  } = deps;
  const [command, ...rest] = argv;
  if (command === 'convert' && rest.length === 1) return convert(rest[0], { stdout, stderr, now, pin });
  if (command !== 'run') {
    write(stderr, { status: 'error', code: 'usage_invalid' });
    return 2;
  }
  const opts = parseRunArgs(rest);
  if (!opts) {
    write(stderr, { status: 'error', code: 'usage_invalid' });
    return 2;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const result = await runCapture({
      ...opts,
      pin,
      now,
      signal: controller.signal,
      killSwitchAsserted: () => isKillSwitchAsserted({ _env: env }),
      ...runOptions
    });
    const summary =
      result.status === 'ok'
        ? {
            status: 'ok',
            capture_id: result.capture_id,
            document_status: result.document_status,
            document_reason: result.document_reason,
            counts: result.counts
          }
        : { status: 'error', code: result.code };
    write(result.status === 'ok' ? stdout : stderr, summary);
    return result.exitCode;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
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
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write(`${JSON.stringify({ status: 'error', code: 'cli_error' })}\n`);
      process.exitCode = 4;
    }
  );
}
