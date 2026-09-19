// Jev (TypeSafe) adapter. Fixture mode reads pre-recorded answers from
// fixtures/jev/<id>.answers.json; live mode (shipped but not exercised by
// default or in CI) calls TypeSafe's /v1/systemone endpoint.
//
// Retry/backoff shape and the engine disclosure block layout are ported
// from Newsjack (https://github.com/elvisun/newsjack) coarse_filter.go,
// commit bdb41b8, MIT License, Copyright (c) 2026 Elvis Sun. Only the
// retry-attempt/backoff-delay behavior is ported (not the Go code itself);
// this file is an independent JavaScript implementation for our own typed
// question set. Retryable HTTP statuses additionally follow the public
// TypeSafe SDK RetryPolicy (408, 429, 500-599), verified against
// docs.typesafe.ai on 2026-09-19.
//
// Article text never appears in a live request except as span.text, capped
// at MAX_SPAN_CHARS. Instructions in questions.v1.json are static and never
// interpolate article content, so injected text in a span cannot alter what
// question is asked (see worker/fusion.js for prompt-injection handling of
// the *answers*).
//
// Jev is a typed classifier, not an authority and not a fact checker.
// Free-form fields on a response are dropped. Answers are never treated as
// verification of whether a claim is true.

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
const PROBABILITY_SUM_EPSILON = 1e-6;
const REVIEW_MIN_CONFIDENCE = 0.5;
const MAX_RETRY_AFTER_MS = 5000;
const SIGNAL_QUESTION_ID = 'influence_signal';
const QUOTED_QUESTION_ID = 'is_quoted_or_attributed';
const SIGNAL_NONE = 'none';

let cachedQuestionSet = null;

export async function loadQuestionSet() {
  if (cachedQuestionSet) return cachedQuestionSet;
  const raw = await readFile(QUESTIONS_PATH, 'utf8');
  const questions = JSON.parse(raw);
  const optionIds = validateQuestionSetContract(questions);
  const sha256 = createHash('sha256').update(canonicalStringify(questions), 'utf8').digest('hex');
  const committed = (await readFile(QUESTIONS_HASH_PATH, 'utf8')).trim();
  cachedQuestionSet = { questions, sha256, committed, name: QUESTION_SET_NAME, optionIds };
  return cachedQuestionSet;
}

/**
 * Choice criteria must be a map of closed option id -> description (TypeSafe
 * ChoiceCriteria). Noul criteria, when present, must be { true, false }.
 * Arrays are Score-level criteria and are not valid for our Choice question.
 * `selective_context_candidate` is a fusion-only taxonomy id and must not
 * appear as a Jev option.
 */
export function validateQuestionSetContract(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new Error('questions.v1.json must be an object map of question id to question');
  }
  const signal = questions[SIGNAL_QUESTION_ID];
  const quoted = questions[QUOTED_QUESTION_ID];
  if (!signal || signal.type !== 'choice') {
    throw new Error('influence_signal must be a choice question');
  }
  if (typeof signal.instructions !== 'string' || !signal.instructions.includes('`span.text`')) {
    throw new Error('influence_signal.instructions must be a string that references `span.text`');
  }
  if (!isPlainObject(signal.criteria) || Array.isArray(signal.criteria)) {
    throw new Error('influence_signal.criteria must be a TypeSafe Choice map, not an array');
  }
  const optionIds = Object.keys(signal.criteria);
  if (optionIds.length < 2 || !optionIds.includes(SIGNAL_NONE)) {
    throw new Error('influence_signal.criteria must include at least two options including none');
  }
  if (optionIds.includes('selective_context_candidate')) {
    throw new Error('selective_context_candidate is fusion-only and must not be a Jev choice option');
  }
  for (const [optionId, description] of Object.entries(signal.criteria)) {
    if (typeof optionId !== 'string' || optionId.length === 0) {
      throw new Error('influence_signal option ids must be non-empty strings');
    }
    if (typeof description !== 'string' || description.length === 0) {
      throw new Error(`influence_signal.criteria.${optionId} must be a non-empty string description`);
    }
  }
  if (!quoted || quoted.type !== 'noul') {
    throw new Error('is_quoted_or_attributed must be a noul question');
  }
  if (typeof quoted.instructions !== 'string' || !quoted.instructions.includes('`span.text`')) {
    throw new Error('is_quoted_or_attributed.instructions must be a string that references `span.text`');
  }
  if (!isPlainObject(quoted.criteria) || Array.isArray(quoted.criteria)) {
    throw new Error('is_quoted_or_attributed.criteria must be a { true, false } map');
  }
  if (typeof quoted.criteria.true !== 'string' || typeof quoted.criteria.false !== 'string') {
    throw new Error('is_quoted_or_attributed.criteria must define string true and false descriptions');
  }
  const allowedIds = new Set([SIGNAL_QUESTION_ID, QUOTED_QUESTION_ID]);
  for (const id of Object.keys(questions)) {
    if (!allowedIds.has(id)) {
      throw new Error(`unexpected question id ${id}; only influence_signal and is_quoted_or_attributed are allowed`);
    }
  }
  return Object.freeze([...optionIds]);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

export function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function parseRetryAfterMs(headers, nowMs = Date.now()) {
  if (!headers || typeof headers.get !== 'function') return null;
  const retryAfterMsHeader = headers.get('retry-after-ms');
  if (retryAfterMsHeader != null && retryAfterMsHeader !== '') {
    const parsed = Number(retryAfterMsHeader);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  const retryAfter = headers.get('retry-after');
  if (retryAfter == null || retryAfter === '') return null;
  const asSeconds = Number(retryAfter);
  if (Number.isFinite(asSeconds) && asSeconds >= 0 && String(retryAfter).trim() !== '') {
    // HTTP Retry-After integer form is delay-seconds.
    if (/^\d+(\.\d+)?$/.test(String(retryAfter).trim())) return asSeconds * 1000;
  }
  const asDate = Date.parse(retryAfter);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - nowMs);
  return null;
}

function sleep(ms, signal) {
  const delay = Math.max(0, ms);
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delay);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    }
  });
}

export function isValidUnitInterval(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function probabilitySum(probabilities) {
  return Object.values(probabilities).reduce((sum, value) => sum + value, 0);
}

function argmaxIds(probabilities) {
  let best = -Infinity;
  const winners = [];
  for (const [id, value] of Object.entries(probabilities)) {
    if (value > best) {
      best = value;
      winners.length = 0;
      winners.push(id);
    } else if (value === best) {
      winners.push(id);
    }
  }
  return winners;
}

/**
 * Validate a TypeSafe-shaped answers object and return only the typed
 * fields we consume. Extra keys (explanations, generated text, unused
 * question ids) are dropped and never treated as product truth.
 *
 * @param {object} answers
 * @param {readonly string[]} optionIds
 * @param {{ requireCompleteDistribution?: boolean }} [options]
 * @returns {{ ok: true, answers: object, review: boolean } | { ok: false, reason: string }}
 */
export function validateAndSanitizeAnswers(answers, optionIds, { requireCompleteDistribution = false } = {}) {
  if (!isPlainObject(answers)) return { ok: false, reason: 'answers_not_object' };

  const optionSet = new Set(optionIds);
  const signal = answers[SIGNAL_QUESTION_ID];
  if (!isPlainObject(signal)) return { ok: false, reason: 'missing_influence_signal' };
  if (signal.type !== 'choice') return { ok: false, reason: 'influence_signal_type' };
  if (typeof signal.choice !== 'string' || !optionSet.has(signal.choice)) {
    return { ok: false, reason: 'influence_signal_choice' };
  }
  if (!isPlainObject(signal.probabilities)) return { ok: false, reason: 'missing_probabilities' };

  const keys = Object.keys(signal.probabilities);
  if (keys.length === 0) return { ok: false, reason: 'empty_probabilities' };
  for (const key of keys) {
    if (!optionSet.has(key)) return { ok: false, reason: 'unknown_probability_key' };
    if (!isValidUnitInterval(signal.probabilities[key])) return { ok: false, reason: 'probability_out_of_range' };
  }
  if (!(signal.choice in signal.probabilities)) return { ok: false, reason: 'choice_missing_probability' };

  const sum = probabilitySum(signal.probabilities);
  if (sum > 1 + PROBABILITY_SUM_EPSILON) return { ok: false, reason: 'probability_sum_gt_1' };
  if (sum <= 0) return { ok: false, reason: 'probability_sum_lte_0' };
  if (requireCompleteDistribution) {
    if (keys.length !== optionIds.length) return { ok: false, reason: 'incomplete_distribution' };
    for (const id of optionIds) {
      if (!(id in signal.probabilities)) return { ok: false, reason: 'incomplete_distribution' };
    }
    if (Math.abs(sum - 1) > PROBABILITY_SUM_EPSILON) return { ok: false, reason: 'probability_sum_not_1' };
  }

  const winners = argmaxIds(signal.probabilities);
  if (!winners.includes(signal.choice)) return { ok: false, reason: 'choice_not_argmax' };
  if (!isValidUnitInterval(signal.confidence)) return { ok: false, reason: 'confidence_out_of_range' };

  const quoted = answers[QUOTED_QUESTION_ID];
  if (!isPlainObject(quoted)) return { ok: false, reason: 'missing_quoted_noul' };
  if (quoted.type !== 'noul') return { ok: false, reason: 'quoted_type' };
  if (!isValidUnitInterval(quoted.noul)) return { ok: false, reason: 'noul_out_of_range' };

  const sanitized = {
    [SIGNAL_QUESTION_ID]: {
      type: 'choice',
      choice: signal.choice,
      probabilities: { ...signal.probabilities },
      confidence: signal.confidence
    },
    [QUOTED_QUESTION_ID]: {
      type: 'noul',
      noul: quoted.noul
    }
  };
  const review = signal.confidence < REVIEW_MIN_CONFIDENCE;
  return { ok: true, answers: sanitized, review };
}

export function buildContractChoiceAnswer({ optionIds, choice, probability, confidence = probability }) {
  if (!optionIds.includes(choice)) {
    throw new Error(`choice ${choice} is not in optionIds`);
  }
  if (!isValidUnitInterval(probability)) {
    throw new Error('probability must be a finite value in [0, 1]');
  }
  const others = optionIds.filter((id) => id !== choice);
  const remainder = 1 - probability;
  const each = others.length ? remainder / others.length : 0;
  const probabilities = {};
  for (const id of optionIds) {
    probabilities[id] = id === choice ? probability : each;
  }
  return {
    type: 'choice',
    choice,
    probabilities,
    confidence
  };
}

export function buildContractNoulAnswer(noul) {
  return { type: 'noul', noul };
}

export function buildContractAnswers({ optionIds, choice, probability, noul, confidence }) {
  return {
    [SIGNAL_QUESTION_ID]: buildContractChoiceAnswer({ optionIds, choice, probability, confidence }),
    [QUOTED_QUESTION_ID]: buildContractNoulAnswer(noul)
  };
}

function emptySpanResult() {
  return {
    answersBySpanId: new Map(),
    failedSpanIds: new Set(),
    reviewSpanIds: new Set(),
    unavailableSpanIds: new Set(),
    dispositionsBySpanId: new Map(),
    calls: 0,
    failures: 0,
    elapsedMs: 0,
    modelReported: null,
    modelMatch: null
  };
}

function recordUnavailable(bucket, spanId, reason) {
  bucket.failedSpanIds.add(spanId);
  bucket.unavailableSpanIds.add(spanId);
  bucket.dispositionsBySpanId.set(spanId, { status: 'unavailable', reason });
}

function recordReview(bucket, spanId, answers, reason) {
  bucket.answersBySpanId.set(spanId, answers);
  bucket.reviewSpanIds.add(spanId);
  bucket.dispositionsBySpanId.set(spanId, { status: 'review', reason });
}

function recordOk(bucket, spanId, answers) {
  bucket.answersBySpanId.set(spanId, answers);
  bucket.dispositionsBySpanId.set(spanId, { status: 'ok', reason: null });
}

function finalizeSpanResult(bucket, startedAt, modelReported) {
  return {
    answersBySpanId: bucket.answersBySpanId,
    failedSpanIds: bucket.failedSpanIds,
    reviewSpanIds: bucket.reviewSpanIds,
    unavailableSpanIds: bucket.unavailableSpanIds,
    dispositionsBySpanId: bucket.dispositionsBySpanId,
    calls: bucket.calls,
    failures: bucket.failedSpanIds.size,
    elapsedMs: Date.now() - startedAt,
    modelReported,
    modelMatch: modelReported ? modelReported === MODEL_REQUESTED : null
  };
}

async function callLive({ baseUrl, apiKey, fetchImpl, timeoutMs, state, questions, outerSignal }) {
  let lastError = 'unknown_error';
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    if (outerSignal?.aborted) {
      return { ok: false, error: 'aborted' };
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
    try {
      const response = await fetchImpl(`${baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL_REQUESTED, state, questions }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (outerSignal?.aborted) return { ok: false, error: 'aborted' };

      if (response.ok) {
        let body;
        try {
          body = await response.json();
        } catch {
          return { ok: false, error: 'malformed_json' };
        }
        if (!isPlainObject(body)) return { ok: false, error: 'malformed_body' };
        return { ok: true, body };
      }

      lastError = `http_${response.status}`;
      const retryable = isRetryableStatus(response.status) && attempt < MAX_RETRY_ATTEMPTS - 1;
      if (!retryable) return { ok: false, error: lastError };
      const retryAfterMs = parseRetryAfterMs(response.headers);
      const backoffMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
      const delayMs = retryAfterMs == null ? backoffMs : Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
      await sleep(delayMs, outerSignal);
      continue;
    } catch (err) {
      clearTimeout(timer);
      if (outerSignal?.aborted) return { ok: false, error: 'aborted' };
      if (timedOut) {
        lastError = 'timeout';
      } else {
        lastError = `transport_error:${err?.message || 'unknown'}`;
      }
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt, outerSignal);
        continue;
      }
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
  }
  return { ok: false, error: lastError };
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
  async function analyzeSpans(spans, artifact, { signal } = {}) {
    const startedAt = Date.now();
    if (mode === 'disabled') {
      return emptySpanResult();
    }

    const questionSet = await loadQuestionSet();
    const optionIds = questionSet.optionIds;
    const requireCompleteDistribution = mode === 'live';

    if (mode === 'fixture') {
      const fixturePath = join(fixtureDir, `${fixtureId}.answers.json`);
      let raw = { answers: {}, model_reported: null };
      try {
        raw = JSON.parse(await readFile(fixturePath, 'utf8'));
      } catch {
        // No fixture answers file: every span fails (exercises the failure path).
      }
      const bucket = emptySpanResult();
      for (const span of spans) {
        bucket.calls += 1;
        const answers = raw.answers?.[span.id];
        const validated = validateAndSanitizeAnswers(answers, optionIds, { requireCompleteDistribution: false });
        if (!validated.ok) {
          recordUnavailable(bucket, span.id, validated.reason || 'malformed_answers');
          continue;
        }
        if (validated.review) {
          recordReview(bucket, span.id, validated.answers, 'low_confidence');
        } else {
          recordOk(bucket, span.id, validated.answers);
        }
      }
      return finalizeSpanResult(bucket, startedAt, raw.model_reported || null);
    }

    if (mode === 'live') {
      const bucket = emptySpanResult();
      let modelReported = null;

      await runWithConcurrency(spans, concurrency, async (span, index) => {
        if (signal?.aborted) return;
        bucket.calls += 1;
        const before = spans[index - 1]?.text || null;
        const after = spans[index + 1]?.text || null;
        const state = buildRequestState({ artifact, span, before, after });
        const result = await callLive({
          baseUrl,
          apiKey,
          fetchImpl,
          timeoutMs,
          state,
          questions: questionSet.questions,
          outerSignal: signal
        });
        if (!result.ok) {
          recordUnavailable(bucket, span.id, result.error);
          return;
        }
        if (result.body?.model) modelReported = result.body.model;
        const validated = validateAndSanitizeAnswers(result.body?.answers, optionIds, {
          requireCompleteDistribution
        });
        if (!validated.ok) {
          recordUnavailable(bucket, span.id, validated.reason || 'malformed_answers');
          return;
        }
        if (validated.review) {
          recordReview(bucket, span.id, validated.answers, 'low_confidence');
        } else {
          recordOk(bucket, span.id, validated.answers);
        }
      });

      return finalizeSpanResult(bucket, startedAt, modelReported);
    }

    throw new Error(`Unknown Jev adapter mode: ${mode}`);
  }

  return { mode, analyzeSpans };
}

export const JEV_MODEL_REQUESTED = MODEL_REQUESTED;
export const JEV_QUESTION_SET_NAME = QUESTION_SET_NAME;
export const JEV_REVIEW_MIN_CONFIDENCE = REVIEW_MIN_CONFIDENCE;
export const JEV_PROBABILITY_SUM_EPSILON = PROBABILITY_SUM_EPSILON;
export const JEV_SIGNAL_QUESTION_ID = SIGNAL_QUESTION_ID;
export const JEV_QUOTED_QUESTION_ID = QUOTED_QUESTION_ID;
export const JEV_SIGNAL_NONE = SIGNAL_NONE;
export const JEV_MAX_RETRY_ATTEMPTS = MAX_RETRY_ATTEMPTS;
export const JEV_MAX_SPAN_CHARS = MAX_SPAN_CHARS;
export const JEV_MAX_CONTEXT_CHARS = MAX_CONTEXT_CHARS;
