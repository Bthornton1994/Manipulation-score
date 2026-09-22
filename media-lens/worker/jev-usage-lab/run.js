// Usage Lab runner. Replays fixture answers into shadow records.
//
// Default shadow is off. This module never calls TypeSafe and never reads
// process.env. scripts/jev-usage-lab.js is the only caller that inspects
// MEDIA_LENS_JEV_SHADOW.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from '../jev/canonical-json.js';
import { buildDecisionRecord } from './decision.js';
import { createShadowLog, isShadowEnabled } from './shadow.js';
import { evaluateLab, renderAccuracyReport } from './evaluate.js';
import { replayHistoricalFixtures } from './historical.js';
import { prepareLabCases } from './split-isolation.js';

const LAB_DIR = dirname(fileURLToPath(import.meta.url));
const MEDIA_LENS_DIR = join(LAB_DIR, '..', '..');

export const DEFAULT_MANIFEST = join(MEDIA_LENS_DIR, 'fixtures', 'jev-usage-lab', 'manifest.json');
export const NARROW_QUESTION_SET_PATH = join(LAB_DIR, 'question-sets', 'media-lens-narrow.v1.json');
export const COS_QUESTION_SET_PATH = join(LAB_DIR, 'question-sets', 'cos-routing.v1.json');

const HISTORICAL_FIXTURES = [
  'synthetic-01-quoted-vs-authorial',
  'synthetic-02-syndicated-cluster',
  'synthetic-03-no-timestamp',
  'synthetic-04-injection',
  'synthetic-05-paywall'
];

export async function loadQuestionSetFile(path) {
  const questions = JSON.parse(await readFile(path, 'utf8'));
  const sha256 = createHash('sha256').update(canonicalStringify(questions), 'utf8').digest('hex');
  return { ...questions, sha256 };
}

function disabledResult() {
  return {
    shadow_enabled: false,
    acted: false,
    network_calls: 0,
    records: [],
    evaluation: null,
    report_markdown: null,
    historical: null
  };
}

export async function runUsageLab({
  shadowEnabled = false,
  env = null,
  manifestPath = DEFAULT_MANIFEST,
  deploymentSha = null,
  now = () => new Date().toISOString(),
  includeHistorical = true
} = {}) {
  const enabled = shadowEnabled === true || (env ? isShadowEnabled(env) : false);
  if (!enabled) return disabledResult();

  const questionSet = await loadQuestionSetFile(NARROW_QUESTION_SET_PATH);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const recordedAt = now();
  const auditBase = {
    model_reported: null,
    deployment_sha: deploymentSha || null,
    question_set_sha256: questionSet.sha256,
    recorded_at: recordedAt
  };
  const log = createShadowLog();
  const cases = [];
  for (const item of manifest.cases) {
    const record = buildDecisionRecord({
      questionSet,
      questionId: item.question_id,
      answer: item.replay_answer,
      provenance: item.provenance,
      audit: auditBase,
      measurement: { latency_ms: item.latency_ms, call_count: item.call_count },
      label: item.label,
      requireCompleteDistribution: true
    });
    cases.push({
      id: item.id,
      split: item.split,
      label: item.label,
      record,
      expect: item.expect || null,
      forbidden_substrings: item.forbidden_substrings || null
    });
  }
  // Group by article+span and assign one split before the gate. Historical
  // production replay is a separate list and is not an input to the gate.
  const prepared = prepareLabCases(cases);
  for (const item of prepared.cases) log.record(item.record);
  const historical = includeHistorical
    ? await replayHistoricalFixtures({
        pairs: HISTORICAL_FIXTURES.map((fixtureId) => ({
          fixtureId,
          answersPath: join(MEDIA_LENS_DIR, 'fixtures', 'jev', `${fixtureId}.answers.json`),
          graphPath: join(MEDIA_LENS_DIR, 'fixtures', 'expected', `${fixtureId}.graph.json`)
        })),
        audit: auditBase
      })
    : null;
  const splitIsolation = {
    collisions: prepared.collisions,
    reassigned_cases: prepared.reassigned_cases,
    gate: prepared.gate
  };
  const evaluation = evaluateLab({
    questionSet,
    cases: prepared.cases,
    historical,
    splitIsolation
  });
  return {
    shadow_enabled: true,
    acted: false,
    network_calls: 0,
    question_set_sha256: questionSet.sha256,
    records: prepared.cases.map((item) => item.record),
    cases: prepared.cases,
    split_isolation: splitIsolation,
    evaluation,
    historical,
    report_markdown: renderAccuracyReport({ evaluation, questionSet, generatedAt: recordedAt })
  };
}
