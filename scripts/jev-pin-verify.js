#!/usr/bin/env node
// Isolated Jev jev-1.13.0 pin verification CLI (Issue #118 Phase 4).
//
// Live HTTP runs only when MEDIA_LENS_JEV_VERIFY=true (exact) and
// MEDIA_LENS_TYPESAFE_API_KEY is set. This does not enable live URL or
// live pasted-text. A pass is pin evidence, not an accuracy claim, and
// not production-ready.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runJevPinVerify, DEFAULT_PIN_VERIFY_FIXTURE } from '../media-lens/worker/jev-pin-verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function readGitSha(env) {
  if (typeof env.GITHUB_SHA === 'string' && env.GITHUB_SHA.trim()) return env.GITHUB_SHA.trim();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function parseArgs(argv) {
  const out = { artifact: 'artifacts/jev-pin-verify.json', fixtures: [], allFixtures: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--artifact') {
      out.artifact = argv[i + 1];
      i += 1;
    } else if (arg === '--fixture') {
      out.fixtures.push(argv[i + 1]);
      i += 1;
    } else if (arg === '--all-fixtures') {
      out.allFixtures = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    }
  }
  return out;
}

function printHelp() {
  const text = [
    'Isolated TypeSafe Jev pin verify (Issue #118 Phase 4).',
    'Live URL remains disabled by default. Live pasted-text remains disabled.',
    'Not production-ready. This is pin-verify evidence plumbing, not a quality study.',
    '',
    'Requires MEDIA_LENS_JEV_VERIFY=true and MEDIA_LENS_TYPESAFE_API_KEY (never commit the key).',
    'Sends model jev-1.13.0 only. Does not fall back to jev-latest.',
    '',
    'Usage:',
    '  MEDIA_LENS_JEV_VERIFY=true MEDIA_LENS_TYPESAFE_API_KEY=... node scripts/jev-pin-verify.js',
    '',
    'Options:',
    `  --fixture <id>     Synthetic fixture under media-lens/fixtures/articles/ (default ${DEFAULT_PIN_VERIFY_FIXTURE})`,
    '  --all-fixtures     Use every synthetic article fixture',
    '  --artifact <path>  Report JSON path (not under docs/; default artifacts/jev-pin-verify.json)'
  ].join('\n');
  console.log(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const report = await runJevPinVerify({
    env: process.env,
    repoRoot: REPO_ROOT,
    commitSha: readGitSha(process.env),
    artifactPath: args.artifact,
    fixtureIds: args.fixtures,
    allFixtures: args.allFixtures
  });

  const summary = {
    pass: report.pass,
    reason: report.reason,
    commitSha: report.commitSha,
    requestedModel: report.requestedModel,
    reportedModel: report.reportedModel,
    networkCalls: report.networkCalls,
    artifact: args.artifact,
    not_an_accuracy_claim: true,
    production_ready: false
  };
  const line = JSON.stringify(summary);
  if (report.pass) console.log(line);
  else console.error(line);
  process.exitCode = report.pass ? 0 : 1;
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
  main().catch((err) => {
    console.error(JSON.stringify({ pass: false, reason: 'cli_error', error: err.message, production_ready: false }));
    process.exitCode = 1;
  });
}
