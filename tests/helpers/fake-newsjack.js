// A fake Newsjack binary for CI. It is a Node script with an absolute
// shebang (the runner gives children an empty PATH) that emulates the four
// subcommands the runner may call, in the pinned v0.1.19 output shapes, and
// can misbehave on request. No real Newsjack binary is ever downloaded,
// built, or executed in tests.

import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sha1 = (value) => createHash('sha1').update(value).digest('hex');

export function mockSignalId(topic) {
  const title = `Regulators open inquiry tied to ${topic}`;
  const url = `https://example.com/news/${sha1(topic).slice(0, 8)}`;
  return sha1([title, url].join('|')).slice(0, 16);
}

const PROGRAM = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const sha1 = (v) => createHash('sha1').update(v).digest('hex');
const argv = process.argv.slice(2);
if (SCENARIO.marker) fs.writeFileSync(SCENARIO.marker, 'executed');
if (SCENARIO.record) {
  fs.appendFileSync(SCENARIO.record, JSON.stringify({ argv, env: process.env, cwd: process.cwd(), script: process.argv[1] }) + '\n');
}
const stepName = argv[0] === 'detector' ? 'detector_run' : argv[0] === 'origin-apply' ? 'origin_apply' : argv[0];
const behavior = (SCENARIO.steps || {})[stepName] || { action: 'normal' };
const flag = (name) => { const hit = argv.find((a) => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : null; };
const nanoNow = () => new Date().toISOString().replace('Z', '') + String(Math.floor(Math.random() * 1e6)).padStart(6, '0') + 'Z';
const setPath = (obj, dotted, value) => { const keys = dotted.split('.'); let cur = obj; for (const k of keys.slice(0, -1)) cur = cur[k]; cur[keys[keys.length - 1]] = value; };
const patch = (obj) => { for (const [k, v] of Object.entries(behavior.patch || {})) setPath(obj, k, v); return obj; };
const emit = (obj) => process.stdout.write(JSON.stringify(patch(obj)));
if (behavior.stderr) process.stderr.write(behavior.stderr);
if (behavior.action === 'exit') process.exit(behavior.code);
if (behavior.action === 'sleep') { setTimeout(() => {}, 600000); return; }
if (behavior.action === 'mutate-self') {
  // Same uid as the runner, so it can undo the 0500 mode and rewrite itself.
  fs.chmodSync(process.argv[1], 0o700);
  fs.appendFileSync(process.argv[1], '\n// changed between steps\n');
}
if (behavior.swapDir) {
  fs.renameSync(behavior.swapDir.path, behavior.swapDir.path + '-moved');
  fs.mkdirSync(behavior.swapDir.target);
  fs.symlinkSync(behavior.swapDir.target, behavior.swapDir.path);
}
if (behavior.action === 'setsid') {
  // A descendant in its own session keeps the stdout pipe open after the
  // process group is killed.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: ['ignore', 'inherit', 'ignore'], detached: true });
  fs.writeFileSync(behavior.pidFile, String(child.pid));
  setTimeout(() => {}, 600000);
  return;
}
if (behavior.action === 'grandchild') {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' });
  fs.writeFileSync(behavior.pidFile, String(child.pid));
  setTimeout(() => {}, 600000);
  return;
}
if (behavior.action === 'flood') { const chunk = 'x'.repeat(65536); const pump = () => { while (process.stdout.write(chunk)) {} process.stdout.once('drain', pump); }; pump(); return; }
if (behavior.action === 'malformed') { process.stdout.write('{"monitor": '); process.exit(0); }
if (stepName === 'version') { process.stdout.write((SCENARIO.version || 'v0.1.19') + '\n'); process.exit(0); }
if (stepName === 'detector_run') {
  const topic = flag('topic');
  const template = JSON.parse(fs.readFileSync(SCENARIO.detectorTemplate, 'utf8'));
  const today = new Date().toISOString().slice(0, 10);
  const title = 'Regulators open inquiry tied to ' + topic;
  const url = 'https://example.com/news/' + sha1(topic).slice(0, 8);
  const signal = template.signals[0];
  signal.id = sha1([title, url].join('|')).slice(0, 16);
  signal.title = title;
  signal.query = topic;
  signal.evidence[0].title = title;
  signal.evidence[0].url = url;
  signal.evidence[0].published_at = today;
  signal.evidence[0].excerpt = 'Officials are examining claims and compliance practices around ' + topic + '.';
  template.monitor.generated_at = nanoNow();
  template.monitor.queries = [topic];
  template.monitor.lookback_days = Number(flag('lookback-days'));
  template.monitor.max_age_hours = Number(flag('max-age-hours'));
  template.monitor.depth = flag('depth');
  if (SCENARIO.emptyRun) { template.signals = null; template.diagnostics.total_scored_signals = 0; template.diagnostics.total_emitted_signals = 0; }
  emit(template);
  process.exit(0);
}
if (stepName === 'cluster') {
  const candidates = JSON.parse(fs.readFileSync(flag('candidates'), 'utf8'));
  const signals = (candidates.signals || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  emit({
    version: 1, generated_at: nanoNow(), monitor: candidates.monitor,
    signals: signals.map((s, i) => Object.assign({}, s, { cluster: { cluster_id: s.id, cluster_index: i, cluster_size: 1, role: 'representative', member_count: 0, member_ids: [], duplicate_count: 0 } })),
    clustering: { input_signal_count: signals.length, cluster_count: signals.length, representative_count: signals.length, duplicate_count: 0, pre_gated_count: 0, title_overlap: 0.6, min_shared_tokens: 2, drop_stale: false, stale_max_band: 'moderate', story_size_bands: {} },
    clustered_duplicates: [], pre_gated_stale: [], coarse_relevance: candidates.coarse_relevance === undefined ? null : candidates.coarse_relevance,
    detector_diagnostics: {}, source_errors: candidates.source_errors
  });
  process.exit(0);
}
if (stepName === 'origin_apply') {
  const clustered = JSON.parse(fs.readFileSync(flag('candidates'), 'utf8'));
  const findingsPayload = JSON.parse(fs.readFileSync(flag('origins'), 'utf8'));
  const findings = Array.isArray(findingsPayload) ? findingsPayload : findingsPayload.findings;
  const hours = Number(flag('window-hours'));
  const run = clustered.monitor.generated_at;
  const cutoff = new Date(Date.parse(run) - hours * 3600000).toISOString();
  const status = SCENARIO.originStatus || 'unverified_no_corroboration';
  const selected = []; const rejected = []; const missing = [];
  for (const s of clustered.signals) {
    const finding = findings.find((f) => f.signal_id === s.id);
    const urls = s.evidence.map((e) => e.url).filter(Boolean);
    const summary = { signal_id: s.id, signal_title: s.title, sources: s.sources, routing: s.routing, evidence_urls: urls.length ? urls.slice(0, 5) : null };
    if (!finding) { missing.push(summary); continue; }
    const gate = { computed_status: status, worker_status: null, run_generated_at: run, freshness_cutoff: cutoff, freshness_window_hours: hours, basis_field: 'first_public_at', basis_value: finding.first_public_at || null, basis_precision: 'time', rationale: 'fake', deterministic_authority: true };
    if (status === 'fresh' || status === 'fresh_new_development') selected.push(Object.assign({}, s, { story_origin: finding, freshness_gate: gate }));
    else rejected.push(Object.assign({}, summary, { story_origin: finding, freshness_gate: gate }));
  }
  emit({
    version: 1, generated_at: nanoNow(), monitor: clustered.monitor, signals: selected.length ? selected : null, coarse_relevance: null,
    freshness_gate: { input_signal_count: clustered.signals.length, origin_finding_count: findings.length, selected_count: selected.length, rejected_count: rejected.length, missing_count: missing.length, status_counts: {}, freshness_window_hours: hours, run_generated_at: run, freshness_cutoff: cutoff, included_statuses: ['fresh', 'fresh_new_development'], rejected_signals: rejected.length ? rejected : null, missing_signals: missing.length ? missing : null, deterministic_authority: true },
    detector_diagnostics: {}, source_errors: clustered.source_errors
  });
  process.exit(0);
}
process.stderr.write('unsupported fake command');
process.exit(9);
`;

/**
 * Write an executable fake Newsjack into `dir`.
 * @returns {Promise<{ path: string, sha256: string }>}
 */
export async function makeFakeNewsjack(dir, scenario = {}) {
  const path = join(dir, `fake-newsjack-${Math.random().toString(16).slice(2)}`);
  const body = `#!${process.execPath}\n'use strict';\nconst SCENARIO = ${JSON.stringify(scenario)};\n(function main() {${PROGRAM}})();\n`;
  await writeFile(path, body, { mode: 0o700 });
  await chmod(path, 0o700);
  return { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
}
