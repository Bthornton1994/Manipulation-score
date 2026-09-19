// Isolated Jev jev-1.13.0 pin verification (Issue #118 Phase 4).
//
// This module never reads process.env. The CLI in scripts/jev-pin-verify.js
// passes an env map. It does not start the Media Lens worker, does not fetch
// article URLs, and does not enable live pasted-text. A pass is evidence that
// the pinned model id was accepted and echoed — not an accuracy claim and
// not production-ready.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareFromHtml } from './prepare.js';
import {
  createJevAdapter,
  loadQuestionSet,
  JEV_MODEL_REQUESTED,
  JEV_MAX_SPAN_CHARS,
  JEV_MAX_CONTEXT_CHARS
} from './adapters/jev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_ARTICLES_DIR = join(__dirname, '..', 'fixtures', 'articles');
const DEFAULT_ANSWERS_DIR = join(__dirname, '..', 'fixtures', 'jev');
const SPAN_ROLES_EXCLUDED_FROM_JEV = new Set(['boilerplate', 'byline_meta']);
const FIXTURE_ID_RE = /^[a-z0-9-]+$/i;
const FORBIDDEN_REQUEST_MODELS = new Set(['jev-latest']);

export const DEFAULT_PIN_VERIFY_FIXTURE = 'synthetic-06-short-excerpt';
export const JEV_STATE_TOKEN_BUDGET = 32000;
export const JEV_PIN_VERIFY_KIND = 'jev-pin-verify';

export const JEV_PIN_VERIFY_REASONS = Object.freeze({
  FLAG_OFF: 'verify_flag_off',
  NO_KEY: 'verify_key_missing',
  MODEL_MISMATCH: 'model_mismatch',
  MODEL_MISSING: 'model_missing',
  FALLBACK_FORBIDDEN: 'jev_latest_fallback_forbidden',
  HTTP_ERROR: 'http_error',
  MALFORMED: 'malformed_response',
  MISSING_ANSWERS: 'missing_answers',
  TYPED_SHAPE: 'typed_shape_rejected',
  NO_SPANS: 'no_synthetic_spans',
  TOKEN_BUDGET: 'token_budget_exceeded',
  UNKNOWN_FIXTURE: 'unknown_fixture',
  OK: 'ok'
});

export function evaluateJevVerifyGate(env = {}) {
  const flagOn = env.MEDIA_LENS_JEV_VERIFY === 'true';
  const rawKey = typeof env.MEDIA_LENS_TYPESAFE_API_KEY === 'string' ? env.MEDIA_LENS_TYPESAFE_API_KEY : '';
  const apiKey = rawKey.trim();
  if (!flagOn) {
    return { allowed: false, reason: JEV_PIN_VERIFY_REASONS.FLAG_OFF, apiKey: null };
  }
  if (!apiKey) {
    return { allowed: false, reason: JEV_PIN_VERIFY_REASONS.NO_KEY, apiKey: null };
  }
  return { allowed: true, reason: null, apiKey };
}

export function assertArticlesDir(articlesDir, repoRoot = REPO_ROOT) {
  const resolved = resolve(articlesDir).replace(/\\/g, '/');
  const expected = resolve(repoRoot, 'media-lens', 'fixtures', 'articles').replace(/\\/g, '/');
  if (resolved !== expected) {
    throw new Error('pin-verify may only read media-lens/fixtures/articles');
  }
  return resolved;
}

export function assertAnswersDir(answersDir, repoRoot = REPO_ROOT) {
  const resolved = resolve(answersDir).replace(/\\/g, '/');
  const expected = resolve(repoRoot, 'media-lens', 'fixtures', 'jev').replace(/\\/g, '/');
  if (resolved !== expected) {
    throw new Error('pin-verify diagnostic answers may only be read from media-lens/fixtures/jev');
  }
  return resolved;
}

export function assertArtifactPathAllowed(artifactPath, { repoRoot = REPO_ROOT, tmpRoot = tmpdir() } = {}) {
  const resolved = resolve(artifactPath);
  const repo = resolve(repoRoot);
  const tmp = resolve(tmpRoot);
  const docsRoot = join(repo, 'docs');
  const under = (root) => resolved === root || resolved.startsWith(root + sep);
  if (under(docsRoot)) {
    throw new Error('pin-verify artifacts must not be written under docs/');
  }
  if (under(repo) || under(tmp)) return resolved;
  throw new Error('pin-verify artifacts must be written under the repository (not docs/) or a temp directory');
}

export function estimateTokensFromJson(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

export function measureMaxSpanTokenBudget(questions) {
  const maxState = {
    artifact: { kind: 'article', title: 't' },
    span: { id: 'span-1', role: 'authorial', text: 'x'.repeat(JEV_MAX_SPAN_CHARS) },
    context: {
      before: 'y'.repeat(JEV_MAX_CONTEXT_CHARS),
      after: 'z'.repeat(JEV_MAX_CONTEXT_CHARS)
    }
  };
  let longestQuestionTokens = 0;
  for (const question of Object.values(questions || {})) {
    longestQuestionTokens = Math.max(longestQuestionTokens, estimateTokensFromJson(question));
  }
  const stateTokens = estimateTokensFromJson(maxState);
  const questionSetTokens = estimateTokensFromJson(questions || {});
  const total = stateTokens + longestQuestionTokens;
  return {
    stateTokens,
    longestQuestionTokens,
    questionSetTokens,
    total,
    budget: JEV_STATE_TOKEN_BUDGET,
    withinBudget: total < JEV_STATE_TOKEN_BUDGET
  };
}

function isSafeFixtureId(id) {
  return typeof id === 'string' && FIXTURE_ID_RE.test(id);
}

export async function listSyntheticArticleFixtureIds(articlesDir = DEFAULT_ARTICLES_DIR, repoRoot = REPO_ROOT) {
  const dir = assertArticlesDir(articlesDir, repoRoot);
  const names = await readdir(dir);
  return names
    .filter((name) => name.endsWith('.html'))
    .map((name) => name.slice(0, -'.html'.length))
    .filter(isSafeFixtureId)
    .sort();
}

export async function loadSyntheticFixtureCases({
  articlesDir = DEFAULT_ARTICLES_DIR,
  fixtureIds = [DEFAULT_PIN_VERIFY_FIXTURE],
  repoRoot = REPO_ROOT
} = {}) {
  const dir = assertArticlesDir(articlesDir, repoRoot);
  const available = new Set(await listSyntheticArticleFixtureIds(dir, repoRoot));
  const cases = [];
  for (const fixtureId of fixtureIds) {
    if (!isSafeFixtureId(fixtureId) || !available.has(fixtureId)) {
      const error = new Error(`unknown synthetic fixture: ${fixtureId}`);
      error.reason = JEV_PIN_VERIFY_REASONS.UNKNOWN_FIXTURE;
      throw error;
    }
    const html = await readFile(join(dir, `${fixtureId}.html`), 'utf8');
    const prepared = prepareFromHtml({
      html,
      kind: 'article',
      sourceUrl: `https://fictional-daily.example/articles/${fixtureId}`,
      inputMode: 'fixture'
    });
    const spans = prepared.spans.filter((span) => !SPAN_ROLES_EXCLUDED_FROM_JEV.has(span.role));
    cases.push({
      fixtureId,
      artifact: { kind: prepared.artifact.kind, title: prepared.artifact.title },
      spans
    });
  }
  return cases;
}

async function loadFixtureAnswers(fixtureId, answersDir, repoRoot) {
  const dir = assertAnswersDir(answersDir, repoRoot);
  try {
    return JSON.parse(await readFile(join(dir, `${fixtureId}.answers.json`), 'utf8'));
  } catch {
    return null;
  }
}

function diagnosticDiffForCase(fixtureId, liveResult, fixtureAnswers) {
  const fixtureMap = fixtureAnswers?.answers && typeof fixtureAnswers.answers === 'object' ? fixtureAnswers.answers : {};
  const liveIds = [...liveResult.answersBySpanId.keys()];
  const fixtureIds = Object.keys(fixtureMap);
  const ids = [...new Set([...fixtureIds, ...liveIds])].sort();
  const rows = ids.map((spanId) => {
    const liveChoice = liveResult.answersBySpanId.get(spanId)?.influence_signal?.choice ?? null;
    const fixtureChoice = fixtureMap[spanId]?.influence_signal?.choice ?? null;
    return {
      spanId,
      fixtureChoice,
      liveChoice,
      choiceMatch: fixtureChoice != null && liveChoice != null && fixtureChoice === liveChoice
    };
  });
  return {
    not_an_accuracy_claim: true,
    fixtureId,
    fixtureAnswersPresent: Boolean(fixtureAnswers),
    rows
  };
}

function mapUnavailableReason(reason) {
  if (!reason) return JEV_PIN_VERIFY_REASONS.TYPED_SHAPE;
  if (reason === 'malformed_json' || reason === 'malformed_body') return JEV_PIN_VERIFY_REASONS.MALFORMED;
  if (reason === 'answers_not_object' || reason === 'missing_influence_signal' || reason === 'missing_quoted_noul') {
    return JEV_PIN_VERIFY_REASONS.MISSING_ANSWERS;
  }
  if (String(reason).startsWith('http_')) return reason;
  return JEV_PIN_VERIFY_REASONS.TYPED_SHAPE;
}

function firstUnavailableReason(liveResult) {
  for (const disposition of liveResult.dispositionsBySpanId.values()) {
    if (disposition?.status === 'unavailable') return mapUnavailableReason(disposition.reason);
  }
  return JEV_PIN_VERIFY_REASONS.TYPED_SHAPE;
}

function emptyReport({ commitSha, timestamp, reason, tokenBudget, fixtures = [], extra = {} }) {
  return {
    kind: JEV_PIN_VERIFY_KIND,
    issue: 118,
    phase: 4,
    not_an_accuracy_claim: true,
    production_ready: false,
    live_url_enabled: false,
    live_pasted_text_enabled: false,
    commitSha,
    timestamp,
    pass: false,
    reason,
    requestedModel: JEV_MODEL_REQUESTED,
    reportedModel: null,
    modelMatch: null,
    networkCalls: 0,
    requestedModels: [],
    reportedModels: [],
    fixtures,
    spanCount: 0,
    tokenBudget,
    diagnosticDiff: null,
    ...extra
  };
}

function redactReport(report) {
  const json = JSON.stringify(report);
  if (/sk-[A-Za-z0-9]{8,}/.test(json) || /Bearer\s+\S+/i.test(json)) {
    throw new Error('pin-verify report attempted to persist a secret-shaped string');
  }
  return report;
}

async function writeReport(report, artifactPath, options) {
  if (!artifactPath) return report;
  const resolved = assertArtifactPathAllowed(artifactPath, options);
  await mkdir(dirname(resolved), { recursive: true });
  const safe = redactReport(report);
  await writeFile(resolved, `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
  return safe;
}

async function parseResponseCopy(response) {
  const text = await response.text();
  let reportedModel = null;
  try {
    const body = JSON.parse(text);
    if (body && typeof body.model === 'string') reportedModel = body.model;
  } catch {
    reportedModel = null;
  }
  return {
    reportedModel,
    replay: new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  };
}

/**
 * Run isolated pin verification. Live HTTP happens only when
 * MEDIA_LENS_JEV_VERIFY=true and a key is present. The gate never falls
 * back to jev-latest. Default CI must call this with a mock fetchImpl.
 */
export async function runJevPinVerify(options = {}) {
  const env = options.env || {};
  const repoRoot = options.repoRoot || REPO_ROOT;
  const articlesDir = options.articlesDir || DEFAULT_ARTICLES_DIR;
  const answersDir = options.answersDir || DEFAULT_ANSWERS_DIR;
  const timestamp = (options.now ? options.now() : new Date()).toISOString();
  const commitSha = options.commitSha || env.GITHUB_SHA || 'unknown';
  const artifactPath = options.artifactPath || null;
  const writeOpts = { repoRoot, tmpRoot: options.tmpRoot || tmpdir() };

  const questionSet = await loadQuestionSet();
  const tokenBudget = measureMaxSpanTokenBudget(questionSet.questions);
  const gate = evaluateJevVerifyGate(env);

  if (!gate.allowed) {
    return writeReport(
      emptyReport({ commitSha, timestamp, reason: gate.reason, tokenBudget }),
      artifactPath,
      writeOpts
    );
  }

  if (!tokenBudget.withinBudget) {
    return writeReport(
      emptyReport({ commitSha, timestamp, reason: JEV_PIN_VERIFY_REASONS.TOKEN_BUDGET, tokenBudget }),
      artifactPath,
      writeOpts
    );
  }

  let fixtureIds = options.fixtureIds;
  if (!fixtureIds || fixtureIds.length === 0) {
    fixtureIds = options.allFixtures
      ? await listSyntheticArticleFixtureIds(articlesDir, repoRoot)
      : [DEFAULT_PIN_VERIFY_FIXTURE];
  }

  let cases;
  try {
    cases = await loadSyntheticFixtureCases({ articlesDir, fixtureIds, repoRoot });
  } catch (err) {
    return writeReport(
      emptyReport({
        commitSha,
        timestamp,
        reason: err.reason || JEV_PIN_VERIFY_REASONS.UNKNOWN_FIXTURE,
        tokenBudget,
        fixtures: fixtureIds
      }),
      artifactPath,
      writeOpts
    );
  }

  const spanCount = cases.reduce((sum, item) => sum + item.spans.length, 0);
  if (spanCount === 0) {
    return writeReport(
      emptyReport({
        commitSha,
        timestamp,
        reason: JEV_PIN_VERIFY_REASONS.NO_SPANS,
        tokenBudget,
        fixtures: fixtureIds
      }),
      artifactPath,
      writeOpts
    );
  }

  const requestedModels = [];
  const reportedModels = [];
  let networkCalls = 0;
  const innerFetch = options.fetchImpl || globalThis.fetch;
  const wrappedFetch = async (url, init) => {
    networkCalls += 1;
    try {
      const body = JSON.parse(init?.body || '{}');
      if (typeof body.model === 'string') requestedModels.push(body.model);
    } catch {
      requestedModels.push(null);
    }
    const response = await innerFetch(url, init);
    const copied = await parseResponseCopy(response);
    if (copied.reportedModel) reportedModels.push(copied.reportedModel);
    return copied.replay;
  };

  const adapter = createJevAdapter({
    mode: 'live',
    baseUrl: env.MEDIA_LENS_TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
    apiKey: gate.apiKey,
    fetchImpl: wrappedFetch,
    timeoutMs: options.timeoutMs || 8000,
    concurrency: 1
  });

  const fixtureReports = [];
  const diagnosticDiff = [];
  let failReason = null;
  let reportedModel = null;

  for (const item of cases) {
    const liveResult = await adapter.analyzeSpans(item.spans, item.artifact);
    reportedModel = liveResult.modelReported || reportedModel;
    const fixtureAnswers = await loadFixtureAnswers(item.fixtureId, answersDir, repoRoot);
    diagnosticDiff.push(diagnosticDiffForCase(item.fixtureId, liveResult, fixtureAnswers));
    fixtureReports.push({
      fixtureId: item.fixtureId,
      spanCount: item.spans.length,
      calls: liveResult.calls,
      failures: liveResult.failures,
      modelReported: liveResult.modelReported,
      modelMatch: liveResult.modelMatch,
      unavailableReasons: [...liveResult.dispositionsBySpanId.values()]
        .filter((row) => row.status === 'unavailable')
        .map((row) => row.reason)
    });

    if (!failReason && requestedModels.some((model) => model !== JEV_MODEL_REQUESTED || FORBIDDEN_REQUEST_MODELS.has(model))) {
      failReason = JEV_PIN_VERIFY_REASONS.FALLBACK_FORBIDDEN;
    }
    if (!failReason && liveResult.failures > 0) {
      failReason = firstUnavailableReason(liveResult);
    }
    if (!failReason && (liveResult.modelMatch === false || reportedModels.some((model) => model !== JEV_MODEL_REQUESTED))) {
      failReason = JEV_PIN_VERIFY_REASONS.MODEL_MISMATCH;
    }
    if (!failReason && (liveResult.modelReported == null || liveResult.modelMatch == null)) {
      failReason = JEV_PIN_VERIFY_REASONS.MODEL_MISSING;
    }
  }

  const uniqueReported = [...new Set(reportedModels)];
  const modelMatch =
    uniqueReported.length === 1 && uniqueReported[0] === JEV_MODEL_REQUESTED && !failReason;
  const pass = !failReason && modelMatch && networkCalls > 0;
  const report = {
    kind: JEV_PIN_VERIFY_KIND,
    issue: 118,
    phase: 4,
    not_an_accuracy_claim: true,
    production_ready: false,
    live_url_enabled: false,
    live_pasted_text_enabled: false,
    commitSha,
    timestamp,
    pass,
    reason: pass ? JEV_PIN_VERIFY_REASONS.OK : failReason || JEV_PIN_VERIFY_REASONS.MODEL_MISMATCH,
    requestedModel: JEV_MODEL_REQUESTED,
    reportedModel: uniqueReported.length === 1 ? uniqueReported[0] : reportedModel,
    modelMatch: pass ? true : uniqueReported.every((model) => model === JEV_MODEL_REQUESTED) && uniqueReported.length > 0,
    networkCalls,
    requestedModels: [...requestedModels],
    reportedModels: [...reportedModels],
    fixtures: fixtureIds,
    spanCount,
    fixtureReports,
    tokenBudget,
    diagnosticDiff: {
      not_an_accuracy_claim: true,
      cases: diagnosticDiff
    }
  };

  return writeReport(report, artifactPath, writeOpts);
}

export function repoRootFromModule() {
  return REPO_ROOT;
}

export { DEFAULT_ARTICLES_DIR, DEFAULT_ANSWERS_DIR };
