#!/usr/bin/env node
// Local Jev Usage Lab CLI.
//
// Shadow mode is off unless MEDIA_LENS_JEV_SHADOW is the exact string true.
// This process does not call TypeSafe, does not change live flags, and does
// not write under docs/.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { runUsageLab } from '../media-lens/worker/jev-usage-lab/run.js';

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] || null;
}

function underDir(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertOutputPathAllowed(outputPath, repoRoot) {
  const resolved = resolve(outputPath);
  const docsRoot = resolve(repoRoot, 'docs');
  if (underDir(resolved, docsRoot)) {
    throw new Error('usage lab output must not be written under docs/');
  }
  return resolved;
}

export async function runCli(argv = process.argv.slice(2), env = process.env, io = {}) {
  if (argv.includes('--live') || argv.includes('--network')) {
    const message = 'usage lab refuses live network calls';
    if (io.stderr) io.stderr(message);
    else console.error(message);
    return { status: 2, shadow_enabled: false, network_calls: 0 };
  }
  const shadowEnabled = env.MEDIA_LENS_JEV_SHADOW === 'true';
  const deploymentSha = env.GITHUB_SHA || env.GIT_COMMIT || null;
  if (!shadowEnabled) {
    const body = { shadow_enabled: false, acted: false, network_calls: 0, records: [] };
    const text = `${JSON.stringify(body)}\n`;
    if (io.stdout) io.stdout(text);
    else process.stdout.write(text);
    return { status: 0, ...body };
  }
  const result = await runUsageLab({
    shadowEnabled: true,
    deploymentSha,
    now: io.now || (() => new Date().toISOString())
  });
  const summary = {
    shadow_enabled: true,
    acted: false,
    network_calls: result.network_calls,
    question_set_sha256: result.question_set_sha256,
    deployment_sha: deploymentSha,
    calibration: {
      n: result.evaluation.calibration.n,
      abstained: result.evaluation.calibration.abstained,
      disagreements: result.evaluation.calibration.disagreements
    },
    holdout: {
      n: result.evaluation.holdout.n,
      abstained: result.evaluation.holdout.abstained,
      disagreements: result.evaluation.holdout.disagreements,
      untouched: true
    },
    adversarial_pass: result.evaluation.adversarial.pass,
    historical_disagreements: result.evaluation.historical?.disagreements ?? null,
    cost_available: false
  };
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (io.stdout) io.stdout(text);
  else process.stdout.write(text);
  const outputPath = argValue(argv, '--out');
  if (outputPath) {
    const repoRoot = io.repoRoot || resolve(dirname(new URL(import.meta.url).pathname), '..');
    const resolved = assertOutputPathAllowed(outputPath, repoRoot);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, result.report_markdown, 'utf8');
  }
  return { status: 0, ...summary };
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
  runCli().then((result) => {
    process.exitCode = result.status;
  });
}
