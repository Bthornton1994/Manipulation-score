// Jev (TypeSafe) adapter. Fixture mode reads pre-recorded answers from
// fixtures/jev/<id>.answers.json; live mode (shipped but not exercised by
// default or in CI) calls TypeSafe's /v1/systemone endpoint.
//
// Retry/backoff shape and the engine disclosure block layout are ported
// from Newsjack (https://github.com/elvisun/newsjack) coarse_filter.go,
// commit bdb41b8, MIT License, Copyright (c) 2026 Elvis Sun. Only the
// retry-attempt/backoff-delay behavior is ported (not the Go code itself);
// this file is an independent JavaScript implementation for our own typed
// question set.
//
// Article text never appears in a live request except as span.text, capped
// at MAX_SPAN_CHARS. Instructions in questions.v1.json are static and never
// interpolate article content, so injected text in a span cannot alter what
// question is asked (see worker/fusion.js for prompt-injection handling of
// the *answers*).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalStringify } from '../jev/canonical-json.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = join(__dirname, '..', 'jev', 'questions.v1.json');
const QUESTIONS_HASH_PATH = join(__dirname, '..', 'jev', 'questions.v1.sha256');
const QUESTION_SET_NAME = 'influence-questions.v1';
const MODEL_REQUESTED = 'jev-1.13.0';
const MAX_SPAN_CHARS = 1200;
const MAX_CONTEXT_CHARS = 400;
const MAX_RETRY_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 4;

let cachedQuestionSet = null;

export async function loadQuestionSet() {
  if (cachedQuestionSet) return cachedQuestionSet;
  const raw = await readFile(QUESTIONS_PATH, 'utf8');
  const questions = JSON.parse(raw);
  const sha256 = createHash('sha256').update(canonicalStringify(questions), 'utf8').digest('hex');
  const committed = (await readFile(QUESTIONS_HASH_PATH, 'utf8')).trim();
  cachedQuestionSet = { questions, sha256, committed, name: QUESTION_SET_NAME };
  return cachedQuestionSet;
}

function truncate(text, max) {
  if (typeof text !== 'string') return null;
  return text.length > max ? text.slice(0, max) : text;
}

function buildRequestState({ artifact, span, before, after }) {
  return {
    artifact: { kind: artifact.kind, title: artifact.title },
    span: { id: span.id, role: span.role, text: truncate(span.text, MAX_SPAN_CHARS) },
    context: { before: truncate(before, MAX_CONTEXT_CHARS), after: truncate(after, MAX_CONTEXT_CHARS) }
  };
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlausibleAnswers(answers) {
  if (!answers || typeof answers !== 'object') return false;
  if (!answers.influence_signal || typeof answers.influence_signal.choice !== 'string') return false;
  if (!answers.is_quoted_or_attributed || typeof answers.is_quoted_or_attributed.noul !== 'number') return false;
  if (!answers.is_checkable_claim || typeof answers.is_checkable_claim.noul !== 'number') return false;
  return true;
}

async function callLive({ baseUrl, apiKey, fetchImpl, timeoutMs, state, questions }) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL_REQUESTED, state, questions }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.ok) {
        const body = await response.json();
        return { ok: true, body };
      }
      if (isRetryableStatus(response.status) && attempt < MAX_RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      return { ok: false, error: `http_${response.status}` };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
    }
  }
  return { ok: false, error: lastError ? `transport_error:${lastError.message}` : 'unknown_error' };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(workers);
  return results;
}

/**
 * Create a Jev adapter bound to a mode. Fixture mode never touches the
 * network. Live mode is only reachable when explicitly configured; it is
 * not exercised in CI or by any default test.
 */
export function createJevAdapter({
  mode,
  fixtureId = null,
  fixtureDir = null,
  baseUrl = null,
  apiKey = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  concurrency = DEFAULT_CONCURRENCY
}) {
  async function analyzeSpans(spans, artifact) {
    const startedAt = Date.now();
    if (mode === 'disabled') {
      return { answersBySpanId: new Map(), failedSpanIds: new Set(), calls: 0, failures: 0, elapsedMs: 0, modelReported: null, modelMatch: null };
    }

    if (mode === 'fixture') {
      const fixturePath = join(fixtureDir, `${fixtureId}.answers.json`);
      let raw = { answers: {}, model_reported: null };
      try {
        raw = JSON.parse(await readFile(fixturePath, 'utf8'));
      } catch {
        // No fixture answers file: every span fails (exercises the failure path).
      }
      const answersBySpanId = new Map();
      const failedSpanIds = new Set();
      let calls = 0;
      for (const span of spans) {
        calls++;
        const answers = raw.answers?.[span.id];
        if (isPlausibleAnswers(answers)) {
          answersBySpanId.set(span.id, answers);
        } else {
          failedSpanIds.add(span.id);
        }
      }
      return {
        answersBySpanId,
        failedSpanIds,
        calls,
        failures: failedSpanIds.size,
        elapsedMs: Date.now() - startedAt,
        modelReported: raw.model_reported || null,
        modelMatch: raw.model_reported ? raw.model_reported === MODEL_REQUESTED : null
      };
    }

    if (mode === 'live') {
      const { questions } = await loadQuestionSet();
      const answersBySpanId = new Map();
      const failedSpanIds = new Set();
      let calls = 0;
      let modelReported = null;

      await runWithConcurrency(spans, concurrency, async (span, index) => {
        calls++;
        const before = spans[index - 1]?.text || null;
        const after = spans[index + 1]?.text || null;
        const state = buildRequestState({ artifact, span, before, after });
        const result = await callLive({ baseUrl, apiKey, fetchImpl, timeoutMs, state, questions });
        if (!result.ok) {
          failedSpanIds.add(span.id);
          return;
        }
        const answers = result.body?.answers;
        if (!isPlausibleAnswers(answers)) {
          failedSpanIds.add(span.id);
          return;
        }
        answersBySpanId.set(span.id, answers);
        if (result.body?.model) modelReported = result.body.model;
      });

      return {
        answersBySpanId,
        failedSpanIds,
        calls,
        failures: failedSpanIds.size,
        elapsedMs: Date.now() - startedAt,
        modelReported,
        modelMatch: modelReported ? modelReported === MODEL_REQUESTED : null
      };
    }

    throw new Error(`Unknown Jev adapter mode: ${mode}`);
  }

  return { mode, analyzeSpans };
}

export const JEV_MODEL_REQUESTED = MODEL_REQUESTED;
export const JEV_QUESTION_SET_NAME = QUESTION_SET_NAME;
