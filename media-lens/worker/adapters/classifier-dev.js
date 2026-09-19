// classifier.dev evaluation adapter. Server-side only. Default-off.
// Uses POST /v1/classify exclusively. Never logs raw span text, credentials,
// or Authorization headers. Not a second independent Media Lens model.

import {
  CLASSIFY_PATH,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_BATCH,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_DAILY_CLASSIFICATIONS,
  DEFAULT_TIER,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  MAX_RETRY_AFTER_MS,
  DEFAULT_CONCURRENCY,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_RESET_MS,
  API_MAJOR,
  STATIC_INSTRUCTIONS,
  buildClassifyRequest,
  FETCH_REDIRECT_MODE,
  isClassifierDevRedirectResponse,
  isRetryableClassifierDevStatus,
  parseRetryAfterMs,
  readErrorCode,
  redactedCallMeta,
  resolveClassifierDevBaseUrl,
  resolveClassifierDevClassifyUrl,
  validateClassifyResponse,
  looksLikeSecret
} from '../classifier-dev/contract.js';
import { createCircuitBreaker, createDailyBudget, createConcurrencyGate } from '../classifier-dev/ops.js';
import { CDEV_LABEL_IDS } from '../classifier-dev/taxonomy.js';

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

function emptyUnavailable(inputs, reason, meta = {}) {
  return {
    ok: false,
    results: inputs.map((_, index) => ({
      ok: false,
      index,
      label: null,
      confidence: null,
      scoresPresent: false,
      model: null,
      escalated: false,
      unscored: false,
      ms: null,
      reason
    })),
    meta: redactedCallMeta({
      status: reason,
      classifications: 0,
      reason,
      ...meta
    }),
    networkCalls: 0
  };
}

function assertNoSecretLeak(value, context) {
  if (looksLikeSecret(value)) {
    throw new Error(`classifier.dev adapter refused to retain a secret-looking ${context}`);
  }
}

async function postClassify({
  href,
  body,
  timeoutMs,
  fetchImpl,
  outerSignal,
  circuit,
  now
}) {
  let lastError = 'unknown_error';
  let lastStatus = null;
  let lastApiVersion = null;
  let retries = 0;
  const started = now();

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    if (outerSignal?.aborted) {
      return { ok: false, error: 'aborted', status: lastStatus, apiVersion: lastApiVersion, retries, latencyMs: now() - started };
    }
    if (circuit.isOpen()) {
      return {
        ok: false,
        error: 'circuit_open',
        status: lastStatus,
        apiVersion: lastApiVersion,
        retries,
        latencyMs: now() - started,
        circuitOpen: true
      };
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
      const target = resolveClassifierDevClassifyUrl(href);
      if (!target.ok) {
        return {
          ok: false,
          error: target.reason || 'host_not_allowlisted',
          status: lastStatus,
          apiVersion: lastApiVersion,
          retries,
          latencyMs: now() - started,
          networkAttempted: false
        };
      }
      const response = await fetchImpl(target.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: FETCH_REDIRECT_MODE
      });
      lastStatus = response.status;
      lastApiVersion = response.headers?.get?.('x-api-version') || lastApiVersion;

      if (isClassifierDevRedirectResponse(response)) {
        return {
          ok: false,
          error: 'redirect_rejected',
          status: lastStatus,
          apiVersion: lastApiVersion,
          retries,
          latencyMs: now() - started
        };
      }

      if (response.ok) {
        let parsed;
        try {
          parsed = await response.json();
        } catch {
          circuit.recordFailure();
          return { ok: false, error: 'malformed_json', status: lastStatus, apiVersion: lastApiVersion, retries, latencyMs: now() - started };
        }
        circuit.recordSuccess();
        return { ok: true, body: parsed, status: lastStatus, apiVersion: lastApiVersion, retries, latencyMs: now() - started };
      }

      let errorBody = null;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = null;
      }
      const code = readErrorCode(errorBody);
      lastError = code ? `http_${response.status}:${code}` : `http_${response.status}`;
      const retryable = isRetryableClassifierDevStatus(response.status, code) && attempt < MAX_RETRY_ATTEMPTS - 1;
      if (!retryable) {
        if (response.status === 502 || response.status >= 500) circuit.recordFailure();
        return { ok: false, error: lastError, status: lastStatus, apiVersion: lastApiVersion, retries, latencyMs: now() - started };
      }
      retries += 1;
      const retryAfterMs = parseRetryAfterMs(response.headers, now());
      const backoffMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
      const delayMs = retryAfterMs == null ? backoffMs : Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
      await sleep(delayMs, outerSignal);
    } catch (err) {
      if (outerSignal?.aborted) {
        return { ok: false, error: 'aborted', status: lastStatus, apiVersion: lastApiVersion, retries, latencyMs: now() - started };
      }
      const message = String(err && err.message ? err.message : err);
      if (/redirect/i.test(message)) {
        lastError = 'redirect_rejected';
      } else {
        lastError = timedOut ? 'timeout' : 'transport_error';
      }
      circuit.recordFailure();
      return { ok: false, error: lastError, status: lastStatus, apiVersion: lastApiVersion, retries, latencyMs: now() - started };
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
  }

  return { ok: false, error: lastError, status: lastStatus, apiVersion: lastApiVersion, retries, latencyMs: now() - started };
}

/**
 * Create a classifier.dev adapter. Live HTTP happens only when `enabled`
 * is true, the kill switch callback is false, and the base URL is valid.
 * Callers must not pass Authorization headers or API keys through this
 * evaluation adapter.
 */
export function createClassifierDevAdapter({
  enabled = false,
  isKillSwitchAsserted = () => false,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBatch = DEFAULT_MAX_BATCH,
  maxDailyClassifications = DEFAULT_MAX_DAILY_CLASSIFICATIONS,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  circuit = null,
  dailyBudget = null,
  concurrency = DEFAULT_CONCURRENCY
} = {}) {
  const resolved = resolveClassifierDevBaseUrl(baseUrl);
  const circuitBreaker = circuit || createCircuitBreaker({ failureThreshold: CIRCUIT_FAILURE_THRESHOLD, resetMs: CIRCUIT_RESET_MS, now });
  const budget = dailyBudget || createDailyBudget(maxDailyClassifications, { now });
  const gate = createConcurrencyGate(Math.max(1, concurrency));

  async function classify({
    inputs,
    labels = CDEV_LABEL_IDS,
    tier = DEFAULT_TIER,
    instructions = STATIC_INSTRUCTIONS,
    signal
  } = {}) {
    const list = Array.isArray(inputs) ? inputs : [];
    if (isKillSwitchAsserted()) {
      return emptyUnavailable(list, 'killed');
    }
    if (!enabled) {
      return emptyUnavailable(list, 'disabled');
    }
    if (!resolved.ok) {
      return emptyUnavailable(list, resolved.reason || 'bad_base_url');
    }
    if (typeof fetchImpl !== 'function') {
      return emptyUnavailable(list, 'no_fetch');
    }

    const built = buildClassifyRequest({ inputs: list, labels, tier, instructions });
    if (!built.ok) {
      return emptyUnavailable(list, built.errors[0] || 'bad_request');
    }
    if (maxBatch <= 0) {
      return emptyUnavailable(list, 'batch_limit');
    }

    const chunks = [];
    for (let i = 0; i < list.length; i += maxBatch) {
      chunks.push(list.slice(i, i + maxBatch));
    }

    const combined = [];
    let networkCalls = 0;
    let retries = 0;
    let apiVersion = null;
    let model = null;
    let modelsUsed = null;
    let status = null;
    let latencyMs = 0;
    let classifications = 0;
    let lastReason = null;
    let circuitOpen = false;
    let anyOk = false;

    for (const chunk of chunks) {
      if (signal?.aborted) {
        combined.push(...emptyUnavailable(chunk, 'aborted').results);
        lastReason = 'aborted';
        continue;
      }
      if (circuitBreaker.isOpen()) {
        combined.push(...emptyUnavailable(chunk, 'circuit_open', { circuitOpen: true }).results);
        lastReason = 'circuit_open';
        circuitOpen = true;
        continue;
      }
      if (!budget.tryConsume(chunk.length)) {
        combined.push(...emptyUnavailable(chunk, 'daily_budget').results);
        lastReason = 'daily_budget';
        continue;
      }

      const chunkBody = {
        ...built.body,
        inputs: chunk
      };
      await gate.enter();
      let posted;
      try {
        posted = await postClassify({
          href: resolved.href,
          body: chunkBody,
          timeoutMs,
          fetchImpl,
          outerSignal: signal,
          circuit: circuitBreaker,
          now
        });
      } finally {
        gate.exit();
      }
      if (posted.networkAttempted !== false) {
        networkCalls += 1;
      }
      retries += posted.retries || 0;
      apiVersion = posted.apiVersion || apiVersion;
      status = posted.status;
      latencyMs += posted.latencyMs || 0;
      circuitOpen = Boolean(posted.circuitOpen) || circuitOpen;

      if (!posted.ok) {
        lastReason = posted.error;
        combined.push(...emptyUnavailable(chunk, posted.error || 'unavailable').results);
        continue;
      }

      const validated = validateClassifyResponse(posted.body, {
        inputs: chunk,
        labels,
        requestedTier: built.body.tier
      });
      if (!validated.ok) {
        lastReason = validated.reason;
        combined.push(...emptyUnavailable(chunk, validated.reason || 'malformed').results);
        continue;
      }

      anyOk = true;
      model = validated.body.model;
      modelsUsed = validated.body.modelsUsed;
      classifications += chunk.length;
      const internallyMatched = validated.body.modelMatch && validated.body.tierMatch;
      const allowlisted = validated.body.modelAllowlisted === true;
      let resultReason = null;
      if (!internallyMatched) resultReason = 'model_mismatch';
      else if (!allowlisted) resultReason = 'unknown_model';
      const modelMatch = resultReason == null;
      if (resultReason) lastReason = resultReason;
      for (const item of validated.body.results) {
        combined.push({
          ok: true,
          index: combined.length,
          label: item.label,
          confidence: item.confidence,
          scoresPresent: item.scoresPresent,
          model: item.model || validated.body.model,
          escalated: item.escalated,
          unscored: item.unscored,
          ms: item.ms,
          reason: resultReason,
          modelMatch
        });
      }
    }

    if (apiVersion && looksLikeSecret(apiVersion)) apiVersion = API_MAJOR;
    assertNoSecretLeak(model || '', 'model');

    return {
      ok: anyOk && combined.every((item) => item.ok),
      results: combined,
      meta: redactedCallMeta({
        apiVersion: apiVersion || (anyOk ? API_MAJOR : null),
        model,
        modelsUsed,
        tier: built.body.tier,
        latencyMs,
        status: anyOk ? status : lastReason || status,
        classifications,
        retries,
        circuitOpen,
        reason: lastReason
      }),
      networkCalls
    };
  }

  return {
    enabled,
    path: CLASSIFY_PATH,
    classify,
    resolvedBase: resolved
  };
}

export { CLASSIFY_PATH, DEFAULT_BASE_URL };
