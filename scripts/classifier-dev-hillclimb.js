#!/usr/bin/env node
// Fixture-only hillclimb CLI for the classifier.dev evaluation harness.
// Default `tune` does not open the holdout case file and does not call a model.
// Holdout reports require MEDIA_LENS_EVAL_UNSEAL_HOLDOUT=report.
// This process has no Messages API client.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBaselineReport,
  buildRoundReport,
  loadPilotDocuments,
  modelSweepStatus,
  renderBaselineMarkdown,
  renderRoundMarkdown,
  runTuneEvaluation
} from '../media-lens/worker/classifier-dev/hillclimb.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = resolve(ROOT, 'media-lens/fixtures/classifier-dev-eval');
const REPORT_DIR = resolve(FIXTURE_DIR, 'reports');

function underDir(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertHillclimbOutputAllowed(outputPath, repoRoot = ROOT) {
  const resolved = resolve(outputPath);
  if (underDir(resolved, resolve(repoRoot, 'docs'))) {
    throw new Error('hillclimb output must not be written under docs/');
  }
  return resolved;
}

function flag(argv, name) {
  return argv.includes(name);
}

export async function runCli(argv = process.argv.slice(2), env = process.env, io = {}) {
  const write = (text) => {
    if (io.stdout) io.stdout(text);
    else process.stdout.write(text);
  };
  const command = argv.find((arg) => !arg.startsWith('--')) || 'tune';
  const unseal = env.MEDIA_LENS_EVAL_UNSEAL_HOLDOUT || '';
  if (command === 'model-sweep') {
    const status = modelSweepStatus(env);
    write(`${JSON.stringify(status, null, 2)}\n`);
    return { status: 0, body: status };
  }
  if (command === 'tune') {
    const docs = await loadPilotDocuments(io.readFile || readFile, FIXTURE_DIR, { role: 'tune', unseal });
    const body = runTuneEvaluation({ trainCases: docs.train.cases, sealedIds: docs.holdoutIds.ids });
    write(`${JSON.stringify(body, null, 2)}\n`);
    return { status: 0, body };
  }
  if (command !== 'baseline' && command !== 'round') {
    const body = { error: `unknown command ${command}`, claimed_thresholds_met: false };
    write(`${JSON.stringify(body)}\n`);
    return { status: 2, body };
  }
  const docs = await loadPilotDocuments(io.readFile || readFile, FIXTURE_DIR, { role: 'report', unseal });
  const report = command === 'baseline'
    ? buildBaselineReport(docs)
    : buildRoundReport(docs);
  const markdown = command === 'baseline' ? renderBaselineMarkdown(report) : renderRoundMarkdown(report);
  write(`${JSON.stringify(report, null, 2)}\n`);
  if (flag(argv, '--write')) {
    const jsonPath = assertHillclimbOutputAllowed(resolve(REPORT_DIR, command === 'baseline' ? 'baseline.json' : 'round-1.json'));
    const mdPath = assertHillclimbOutputAllowed(resolve(REPORT_DIR, command === 'baseline' ? 'baseline.md' : 'round-1.md'));
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(mdPath, markdown);
  }
  return { status: 0, body: report, markdown };
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
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
