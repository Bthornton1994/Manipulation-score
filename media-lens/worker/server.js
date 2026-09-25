#!/usr/bin/env node
// Media Lens worker HTTP server: node:http, no npm dependencies, listens on
// 127.0.0.1 only by default. GET /health, POST /analyze. Owns all network,
// keys, and limits; the browser page talks only to this process. Article
// HTML preparation shells out asynchronously to pinned local Trafilatura.
// The child refuses the Python socket methods named in
// media-lens/worker/trafilatura/DEPS.md. That is not a network namespace.
// See docs/media-lens-influence-graph-plan.md section 1.

import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadConfig,
  publicConfig,
  assertLiveModeIsReady,
  effectiveLiveFlags,
  jevAdapterMode,
  classifierDevAdapterEnabled
} from './config.js';
import { prepareFromHtml, prepareFromPastedText, emptyPreparedArtifactStub } from './prepare.js';
import { createJevAdapter } from './adapters/jev.js';
import { armAnalyzeShadow, createJevAnswerCapture } from './jev-usage-lab/analyze-shadow.js';
import {
  armNarrowShadow,
  createNarrowCostLedger,
  createNarrowLiveProvider,
  createNarrowRateLimiter,
  narrowNetworkBlockReason,
  narrowShadowLiveNetworkPermitted,
  selectNarrowProvider
} from './jev-usage-lab/narrow-shadow.js';
import { createProviderPinnedFetch } from './provider-pinned-fetch.js';
import { createNewsjackAdapter } from './adapters/newsjack.js';
import { createClassifierDevAdapter } from './adapters/classifier-dev.js';
import { analyze, buildAbstentionOnlyGraph } from './analyze.js';
import { fetchArticleSafely } from './safe-fetch.js';
import { parseArticleUrl } from './address-policy.js';
import { validate } from '../schema/validate.js';
import { createAuditLogger, AUDIT_EVENTS } from './audit.js';
import { createFixedWindowLimiter, createKeyedFixedWindowLimiter, createConcurrencyGate } from './rate-limit.js';
import { hostIsAllowlisted, rateLimitHostKeys, safeUrlAuditFields } from './host-key.js';
import { createTypesafeBudget } from './typesafe-budget.js';
import { buildBudgetWarnAlert, createAlertTransport, readAlertCredential } from './alert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

// The browser page is typically served from a different origin (e.g. a
// static file server on http://localhost:4173) than this worker
// (http://127.0.0.1:8787), so the browser's CORS check runs even though
// both are on loopback. This worker holds no cookies/session and accepts
// no credentialed requests, so it is safe to allow any loopback origin;
// it never allows a non-loopback origin.
const LOOPBACK_ORIGIN_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

// M1: fixture_id comes straight from the request body and is used to build
// file paths (fixtures/articles/<id>.html, fixtures/jev/<id>.answers.json,
// fixtures/newsjack/<id>.json). A permissive check here is a path-traversal
// vector (e.g. "../../../analyze"), so this is the single point every
// fixture-mode request must pass through before any adapter or file read
// ever sees the value.
const FIXTURE_ID_PATTERN = /^[a-z0-9-]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SSRF_ERROR_CODES = new Set(['BLOCKED_HOST', 'BAD_SCHEME', 'BAD_URL', 'REDIRECT_DOWNGRADE', 'PIN_MISMATCH']);

async function isKnownFixtureId(fixtureId) {
  if (typeof fixtureId !== 'string' || !FIXTURE_ID_PATTERN.test(fixtureId)) return false;
  let files;
  try {
    files = await readdir(join(FIXTURES_DIR, 'articles'));
  } catch {
    return false;
  }
  return files.includes(`${fixtureId}.html`);
}

/**
 * L3: the plan wants the browser's consent-checkbox timestamp recorded,
 * not just server time. Only accept a well-formed ISO-8601 UTC timestamp
 * (the exact shape `Date.prototype.toISOString()` produces) from the
 * client; anything else falls back to the server's own clock rather than
 * being trusted verbatim.
 */
function resolveConsentAt(payloadConsentAt) {
  if (typeof payloadConsentAt === 'string' && ISO_TIMESTAMP_PATTERN.test(payloadConsentAt) && !Number.isNaN(Date.parse(payloadConsentAt))) {
    return { consentAt: payloadConsentAt, clientSupplied: true };
  }
  return { consentAt: new Date().toISOString(), clientSupplied: false };
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && LOOPBACK_ORIGIN_PATTERN.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBodyWithLimit(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        // Keep draining so the client's request completes normally (and
        // the connection is not abruptly reset) instead of accumulating an
        // unbounded string; the 413 response is sent once 'end' fires.
        tooLarge = true;
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) reject(Object.assign(new Error('request body too large'), { code: 'BODY_TOO_LARGE' }));
      else resolve(body);
    });
    req.on('error', reject);
  });
}

async function buildAdapters({ config, payload, classifierDevFetch }) {
  const jevMode = jevAdapterMode(config);
  const jevAdapter = createJevAdapter({
    mode: jevMode,
    fixtureId: payload.fixture_id || null,
    fixtureDir: join(FIXTURES_DIR, 'jev'),
    baseUrl: config.jev.baseUrl,
    apiKey: config.secrets.typesafeApiKey,
    // H2: without this, the adapter silently falls back to its own
    // hardcoded default and the advertised /health limit is dead.
    timeoutMs: config.limits.jevCallTimeoutMs,
    maxCallsPerAnalysis: config.limits.maxJevCallsPerAnalysis
  });

  let newsjackMode = 'fixture';
  if (config.mode === 'live') newsjackMode = config.newsjack.artifactsDir ? 'artifacts' : 'disabled';
  const newsjackAdapter = createNewsjackAdapter({
    mode: newsjackMode,
    fixtureId: payload.fixture_id || null,
    fixtureDir: join(FIXTURES_DIR, 'newsjack'),
    artifactsDir: config.newsjack.artifactsDir
  });

  const classifierDevAdapter = createClassifierDevAdapter({
    enabled: classifierDevAdapterEnabled(config),
    isKillSwitchAsserted: () => effectiveLiveFlags(config).killSwitch,
    baseUrl: config.classifierDev.baseUrl,
    timeoutMs: config.classifierDev.timeoutMs,
    maxBatch: config.classifierDev.maxBatch,
    maxDailyClassifications: config.classifierDev.maxDailyClassifications,
    fetchImpl: classifierDevFetch || undefined
  });

  return { jevAdapter, newsjackAdapter, classifierDevAdapter };
}

async function preparePayload({ payload, config, fetchArticle, extractImpl }) {
  if (config.mode === 'live' && payload.mode === 'pasted_text') {
    throw Object.assign(
      new Error('Live pasted-text analysis is disabled until a later privacy and security review.'),
      { code: 'live_pasted_text_disabled' }
    );
  }
  if (payload.mode === 'pasted_text') {
    return prepareFromPastedText({ text: String(payload.text || ''), kind: payload.kind || 'other_public' });
  }
  if (payload.mode === 'fixture') {
    if (!(await isKnownFixtureId(payload.fixture_id))) {
      throw Object.assign(new Error('fixture_id must match ^[a-z0-9-]+$ and name an existing fixture article'), {
        code: 'invalid_fixture_id'
      });
    }
    const articlePath = join(FIXTURES_DIR, 'articles', `${payload.fixture_id}.html`);
    const html = await readFile(articlePath, 'utf8');
    return prepareFromHtml({
      html,
      kind: payload.kind || 'article',
      sourceUrl: payload.url || `https://fictional-daily.example/articles/${payload.fixture_id}`,
      inputMode: 'fixture',
      extractImpl
    });
  }
  if (payload.mode === 'url') {
    if (config.mode !== 'live') {
      throw Object.assign(new Error('URL mode requires the worker to be running in live mode'), { code: 'URL_MODE_REQUIRES_LIVE' });
    }
    const flags = effectiveLiveFlags(config);
    if (flags.killSwitch) {
      throw Object.assign(new Error('Live URL and live Jev are disabled by the operator kill switch.'), {
        code: 'live_killed'
      });
    }
    // Issue #118: live Jev (MEDIA_LENS_ENABLE_LIVE) must not open article
    // fetch. URL retrieval requires the separate exact flag. Re-check per
    // request so a flipped env stops the next fetch without a new binary.
    if (flags.liveUrlEnabled !== true) {
      throw Object.assign(
        new Error('Live URL fetch is disabled until MEDIA_LENS_ENABLE_LIVE_URL=true is set. This is not a production-ready mode.'),
        { code: 'live_url_disabled' }
      );
    }
    // Connect-time pin: never call global fetch on a user-supplied URL.
    const fetched = await (fetchArticle || fetchArticleSafely)(payload.url, {
      timeoutMs: config.limits.urlFetchTimeoutMs,
      connectTimeoutMs: config.limits.urlFetchConnectTimeoutMs,
      maxBytes: config.limits.urlFetchMaxBytes,
      maxRedirects: config.limits.urlFetchMaxRedirects,
      maxHeaderBytes: config.limits.urlFetchMaxHeaderBytes,
      parseTimeoutMs: config.limits.urlFetchParseTimeoutMs,
      urlAllowlist: config.urlAllowlist
    });
    return prepareFromHtml({
      html: fetched.html,
      kind: payload.kind || 'article',
      sourceUrl: payload.url,
      inputMode: 'url',
      acquisition: {
        contentType: fetched.contentType ?? null,
        fetchStatus: fetched.fetchStatus ?? '200',
        fetchedAt: fetched.fetchedAt ?? null
      },
      extractImpl
    });
  }
  throw Object.assign(new Error(`Unknown analyze mode: ${payload.mode}`), { code: 'UNKNOWN_MODE' });
}

// Failures that mean "we could not safely/successfully fetch this right
// now" become an abstention graph (HTTP 200) rather than a raw error,
// matching how every other engine-unavailable condition is reported.
// Failures that mean "this input is not allowed" are rejected outright.
const PREPARE_FAILURE_AS_ABSTENTION = new Set(['TIMEOUT', 'FETCH_ERROR', 'TOO_MANY_REDIRECTS', 'TLS_ERROR']);
const PREPARE_FAILURE_STATUS = { TOO_LARGE: 413, live_killed: 503 };

/**
 * H1: the last-resort safety net before any graph reaches a client. If the
 * pipeline ever produces a document that fails its own schema (e.g. a
 * typed classifier answering outside our taxonomy despite the adapter and
 * fusion checks, or any other pipeline bug), this discards it and returns
 * a valid abstention-only graph instead. Exported so this behavior is
 * directly unit-testable without needing a live Jev bug to reproduce it.
 */
export async function validateOrAbstain({ graph, prepared, config, consentAt }) {
  const { valid, errors } = validate(graph);
  if (valid) return graph;
  console.error('Media Lens: discarding an invalid influence-graph.v1 document before sending it.', errors);
  return buildAbstentionOnlyGraph({
    prepared,
    reason: 'engine_failure',
    message: 'The analysis pipeline produced an invalid result and it was discarded rather than served.',
    config,
    userAssertedPublic: true,
    consentAt
  });
}

function requireLiveModeReady(config) {
  const readiness = assertLiveModeIsReady(config);
  if (!readiness.ok) {
    throw new Error(readiness.reason);
  }
}

function liveUrlGate({ payload, config, audit, consumeLiveUrl, consumeLiveUrlHost }) {
  const flags = effectiveLiveFlags(config);
  const urlFields = safeUrlAuditFields(payload.url);
  // Fixture workers reject URL mode as URL_MODE_REQUIRES_LIVE before the
  // kill switch, matching preparePayload. Kill switch 503 is live-mode only.
  if (config.mode !== 'live') {
    audit.emit(AUDIT_EVENTS.LIVE_URL_BLOCKED, {
      mode: config.mode,
      input_mode: 'url',
      error: 'URL_MODE_REQUIRES_LIVE',
      live_url_enabled: false,
      ...urlFields
    });
    return { error: 'URL_MODE_REQUIRES_LIVE', status: 400, message: 'URL mode requires the worker to be running in live mode' };
  }
  if (flags.killSwitch) {
    audit.emit(AUDIT_EVENTS.KILL_SWITCH, {
      mode: config.mode,
      input_mode: payload.mode,
      error: 'live_killed',
      kill_switch: true
    });
    return { error: 'live_killed', status: 503, message: 'Live URL and live Jev are disabled by the operator kill switch.' };
  }
  if (flags.liveUrlEnabled !== true) {
    audit.emit(AUDIT_EVENTS.LIVE_URL_BLOCKED, {
      mode: config.mode,
      input_mode: 'url',
      error: 'live_url_disabled',
      live_enabled: flags.liveEnabled,
      live_url_enabled: false,
      ...urlFields
    });
    return {
      error: 'live_url_disabled',
      status: 400,
      message: 'Live URL fetch is disabled until MEDIA_LENS_ENABLE_LIVE_URL=true is set. This is not a production-ready mode.'
    };
  }

  if (!consumeLiveUrl()) {
    audit.emit(AUDIT_EVENTS.RATE_LIMIT, {
      mode: config.mode,
      input_mode: 'url',
      error: 'rate_limited',
      limiter: 'live_url',
      ...urlFields
    });
    return { error: 'rate_limited', status: 429, message: 'Too many live URL attempts. Wait a minute and try again.' };
  }

  let parsedHost = null;
  try {
    parsedHost = parseArticleUrl(payload.url).bareHost;
  } catch (err) {
    if (SSRF_ERROR_CODES.has(err.code)) {
      audit.emit(AUDIT_EVENTS.SSRF_BLOCK, {
        mode: config.mode,
        input_mode: 'url',
        error: err.code,
        ...urlFields
      });
      return { error: err.code, status: 400, message: err.message };
    }
    throw err;
  }

  if (!hostIsAllowlisted(parsedHost, config.urlAllowlist)) {
    audit.emit(AUDIT_EVENTS.LIVE_URL_BLOCKED, {
      mode: config.mode,
      input_mode: 'url',
      error: 'live_url_not_allowlisted',
      allowlist_configured: true,
      ...urlFields
    });
    return { error: 'live_url_not_allowlisted', status: 400, message: 'This host is not on the operator URL allowlist.' };
  }

  const hostKeys = rateLimitHostKeys(parsedHost);
  for (const key of hostKeys) {
    if (!consumeLiveUrlHost(key)) {
      audit.emit(AUDIT_EVENTS.RATE_LIMIT, {
        mode: config.mode,
        input_mode: 'url',
        error: 'rate_limited',
        limiter: 'live_url_host',
        ...urlFields
      });
      return { error: 'rate_limited', status: 429, message: 'Too many live URL attempts for this host. Wait a minute and try again.' };
    }
  }

  return { ok: true };
}

/**
 * Create (but do not start) the Media Lens worker HTTP server.
 * Live mode is refused here, not only in startServer(), so a direct
 * createServer(config).listen() cannot skip the opt-in + API-key gate.
 *
 * options.fetchArticle is a test/programmatic seam only. startServer()
 * does not pass it; the CLI and operator path always use fetchArticleSafely.
 */
export function createServer(config = loadConfig(), options = {}) {
  requireLiveModeReady(config);
  const audit = options.auditLogger || createAuditLogger();
  // Test/programmatic only. Unused by startServer() / the CLI.
  const fetchArticle = options.fetchArticle || null;
  const extractImpl = options.extractImpl || undefined;
  const classifierDevFetch = options.classifierDevFetch || null;
  const typesafeBudget =
    options.typesafeBudget ||
    createTypesafeBudget({
      estimatedUsdPerCall: config.typesafeBudget.estimatedUsdPerCall,
      estimatedTokensPerCall: config.typesafeBudget.estimatedTokensPerCall,
      warnUsd: config.typesafeBudget.warnUsd,
      stopUsd: config.typesafeBudget.stopUsd,
      storePath: config.typesafeBudget.storeFile,
      io: options.budgetIo || {}
    });
  const alertTransport =
    options.alertTransport ||
    createAlertTransport({
      credential: readAlertCredential(config._env, options.alertIo || {})
    });
  const checkRateLimit = createFixedWindowLimiter(config.limits.maxAnalysesPerMinute);
  const consumeLiveUrl = createFixedWindowLimiter(config.limits.maxLiveUrlPerMinute);
  const consumeLiveUrlHost = createKeyedFixedWindowLimiter(config.limits.maxLiveUrlPerHostPerMinute);
  const liveUrlConcurrency = createConcurrencyGate(config.limits.maxConcurrentLiveUrl);
  const narrowRateLimiter =
    options.narrowShadowRateLimiter ||
    createNarrowRateLimiter({ perMinute: config.jevShadowNarrow?.rateLimitPerMinute ?? null });
  const narrowCostLedger =
    options.narrowShadowCostLedger ||
    createNarrowCostLedger({
      ceilingUsd: config.jevShadowNarrow?.monthlyCostCeilingUsd ?? null,
      estimatedUsdPerCall: config.jevShadowNarrow?.estimatedUsdPerCall ?? null
    });

  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    try {
      applyCors(req, res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { status: 'ok', ...publicConfig(config) });
        return;
      }

      if (req.method === 'POST' && req.url === '/analyze') {
        // L6: check the rate limit before spending any time/memory
        // reading the request body, so an over-limit client is rejected
        // immediately rather than after paying for a full body read.
        if (!checkRateLimit()) {
          audit.emit(AUDIT_EVENTS.RATE_LIMIT, {
            mode: config.mode,
            error: 'rate_limited',
            limiter: 'analyze'
          });
          sendJson(res, 429, { error: 'rate_limited', message: 'Too many analyses requested. Wait a minute and try again.' });
          return;
        }

        const flagsBeforeBody = effectiveLiveFlags(config);
        if (config.mode === 'live' && flagsBeforeBody.killSwitch) {
          audit.emit(AUDIT_EVENTS.KILL_SWITCH, {
            mode: config.mode,
            error: 'live_killed',
            kill_switch: true
          });
          sendJson(res, 503, {
            error: 'live_killed',
            message: 'Live URL and live Jev are disabled by the operator kill switch.'
          });
          return;
        }

        let rawBody;
        try {
          rawBody = await readBodyWithLimit(req, config.limits.maxRequestBodyBytes);
        } catch (err) {
          if (err.code === 'BODY_TOO_LARGE') {
            sendJson(res, 413, { error: 'oversized_input', message: 'Request body exceeds the size limit.' });
            return;
          }
          throw err;
        }

        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          sendJson(res, 400, { error: 'invalid_json' });
          return;
        }

        if (payload.user_asserted_public !== true) {
          sendJson(res, 400, {
            error: 'consent_required',
            message: 'user_asserted_public must be true. Media Lens only analyzes public material the user has confirmed they may examine.'
          });
          return;
        }

        if (config.mode === 'live' && payload.mode === 'pasted_text') {
          sendJson(res, 400, {
            error: 'live_pasted_text_disabled',
            message: 'Live pasted-text analysis is disabled until a later privacy and security review.'
          });
          return;
        }

        const flags = effectiveLiveFlags(config);
        if (config.mode === 'live' && flags.killSwitch) {
          audit.emit(AUDIT_EVENTS.KILL_SWITCH, {
            mode: config.mode,
            input_mode: payload.mode,
            error: 'live_killed',
            kill_switch: true
          });
          sendJson(res, 503, {
            error: 'live_killed',
            message: 'Live URL and live Jev are disabled by the operator kill switch.'
          });
          return;
        }

        if (payload.mode === 'url') {
          const gate = liveUrlGate({ payload, config, audit, consumeLiveUrl, consumeLiveUrlHost });
          if (!gate.ok) {
            sendJson(res, gate.status, { error: gate.error, message: gate.message });
            return;
          }
        }

        const { consentAt } = resolveConsentAt(payload.consent_at);

        let heldLiveUrlSlot = false;
        if (payload.mode === 'url') {
          if (!liveUrlConcurrency.tryEnter()) {
            audit.emit(AUDIT_EVENTS.RATE_LIMIT, {
              mode: config.mode,
              input_mode: 'url',
              error: 'rate_limited',
              limiter: 'live_url_concurrent',
              ...safeUrlAuditFields(payload.url)
            });
            sendJson(res, 429, { error: 'rate_limited', message: 'A live URL fetch is already in progress on this worker.' });
            return;
          }
          heldLiveUrlSlot = true;
        }

        let prepared;
        try {
          prepared = await preparePayload({ payload, config, fetchArticle, extractImpl });
        } catch (err) {
          if (heldLiveUrlSlot) liveUrlConcurrency.exit();
          if (SSRF_ERROR_CODES.has(err.code)) {
            audit.emit(AUDIT_EVENTS.SSRF_BLOCK, {
              mode: config.mode,
              input_mode: payload.mode,
              error: err.code,
              ...safeUrlAuditFields(payload.url)
            });
          }
          if (
            err.code === 'live_url_disabled' ||
            err.code === 'URL_MODE_REQUIRES_LIVE' ||
            err.code === 'live_url_not_allowlisted'
          ) {
            audit.emit(AUDIT_EVENTS.LIVE_URL_BLOCKED, {
              mode: config.mode,
              input_mode: payload.mode,
              error: err.code,
              live_url_enabled: err.code === 'live_url_not_allowlisted' ? flags.liveUrlEnabled : false,
              allowlist_configured: err.code === 'live_url_not_allowlisted' ? true : undefined,
              ...safeUrlAuditFields(payload.url)
            });
          }
          if (err.code === 'live_killed') {
            audit.emit(AUDIT_EVENTS.KILL_SWITCH, {
              mode: config.mode,
              input_mode: payload.mode,
              error: 'live_killed',
              kill_switch: true
            });
          }
          if (PREPARE_FAILURE_AS_ABSTENTION.has(err.code)) {
            const stub = emptyPreparedArtifactStub({
              inputMode: payload.mode === 'url' ? 'url' : 'pasted_text',
              url: payload.url || null,
              fetchStatus: err.code || 'fetch_failed'
            });
            const fallback = await buildAbstentionOnlyGraph({
              prepared: stub,
              reason: 'engine_unavailable',
              message: 'The article could not be fetched in time, so no analysis was performed.',
              config,
              userAssertedPublic: true,
              consentAt
            });
            audit.emit(AUDIT_EVENTS.ANALYZE_COMPLETE, {
              mode: config.mode,
              input_mode: payload.mode,
              status: 200,
              duration_ms: Date.now() - startedAt,
              abstention_reason: 'engine_unavailable',
              abstention_count: 1
            });
            sendJson(res, 200, fallback);
            return;
          }
          sendJson(res, PREPARE_FAILURE_STATUS[err.code] || 400, { error: err.code || 'prepare_failed', message: err.message });
          return;
        }

        try {
          const { jevAdapter, newsjackAdapter, classifierDevAdapter } = await buildAdapters({
            config,
            payload,
            classifierDevFetch
          });

          const shadowEnabled = config.jevShadow?.enabled === true;
          const shadowCapture = shadowEnabled ? createJevAnswerCapture() : null;
          const jevForAnalyze = shadowCapture ? shadowCapture.wrap(jevAdapter) : jevAdapter;

          const rawGraph = await analyze({
            prepared,
            config,
            jevAdapter: jevForAnalyze,
            newsjackAdapter,
            classifierDevAdapter,
            typesafeBudget,
            userAssertedPublic: true,
            consentAt,
            disclosureShown: true
          });

          if (jevAdapter.mode === 'live' && (rawGraph.engine?.jev?.calls || 0) > 0) {
            const budgetRecord = typesafeBudget.recordCalls(rawGraph.engine.jev.calls);
            if (budgetRecord.shouldWarn) {
              const alertMessage = buildBudgetWarnAlert({
                estimatedUsd: budgetRecord.estimatedUsd,
                warnUsd: config.typesafeBudget.warnUsd,
                stopUsd: config.typesafeBudget.stopUsd,
                basis: budgetRecord.basis,
                calculationInputs: budgetRecord.calculationInputs
              });
              alertTransport.send(alertMessage).catch(() => {});
            }
          }

          // H1: never serve a document that fails its own schema.
          const graph = await validateOrAbstain({ graph: rawGraph, prepared, config, consentAt });

          audit.emit(AUDIT_EVENTS.ANALYZE_COMPLETE, {
            mode: config.mode,
            input_mode: payload.mode,
            status: 200,
            duration_ms: Date.now() - startedAt,
            jev_calls: graph.engine?.jev?.calls ?? 0,
            jev_failures: graph.engine?.jev?.failures ?? 0,
            model_match: graph.engine?.jev?.model_match ?? null,
            abstention_count: Array.isArray(graph.abstentions) ? graph.abstentions.length : 0,
            classifier_dev_enabled: Boolean(graph.engine?.classifier_dev),
            cdev_calls: graph.engine?.classifier_dev?.calls ?? 0,
            cdev_classifications: graph.engine?.classifier_dev?.classifications ?? 0,
            escalated_span_count: graph.engine?.classifier_dev?.escalated_span_count ?? 0,
            circuit_open: graph.engine?.classifier_dev?.circuit_open ?? false
          });

          if (graph.engine?.classifier_dev) {
            audit.emit(AUDIT_EVENTS.CLASSIFIER_DEV_CASCADE, {
              mode: config.mode,
              input_mode: payload.mode,
              classifier_dev_enabled: true,
              cdev_calls: graph.engine.classifier_dev.calls ?? 0,
              cdev_classifications: graph.engine.classifier_dev.classifications ?? 0,
              cdev_model: graph.engine.classifier_dev.model_reported,
              cdev_status: graph.engine.classifier_dev.mode,
              escalated_span_count: graph.engine.classifier_dev.escalated_span_count ?? 0,
              circuit_open: graph.engine.classifier_dev.circuit_open ?? false,
              taxonomy_version: graph.engine.classifier_dev.taxonomy_version,
              policy_version: graph.engine.classifier_dev.policy_version
            });
          }

          sendJson(res, 200, graph);
          if (shadowEnabled) {
            try {
              armAnalyzeShadow({
                enabled: true,
                graph,
                capture: shadowCapture,
                articleHint: {
                  mode: payload.mode,
                  fixtureId: typeof payload.fixture_id === 'string' ? payload.fixture_id : null
                },
                jevMode: jevAdapter.mode,
                sink: options.shadowSink
              });
            } catch {
              // Shadow scheduling must not change the response already sent.
            }
          }
          if (config.jevShadowNarrow?.enabled === true) {
            try {
              const killSwitchAsserted = effectiveLiveFlags(config).killSwitch === true;
              const livePermitted = narrowShadowLiveNetworkPermitted(config, { killSwitchAsserted });
              const selected = selectNarrowProvider({
                injected: options.narrowShadowProvider || null,
                livePermitted,
                createLive: () =>
                  createNarrowLiveProvider({
                    fetchImpl: createProviderPinnedFetch({ timeoutMs: config.jevShadowNarrow.timeoutMs }),
                    baseUrl: config.jev.baseUrl,
                    apiKey: config.secrets.typesafeApiKey,
                    model: config.jev.modelRequested
                  })
              });
              armNarrowShadow({
                enabled: true,
                graph,
                articleHint: {
                  mode: payload.mode,
                  fixtureId: typeof payload.fixture_id === 'string' ? payload.fixture_id : null
                },
                limits: config.jevShadowNarrow,
                provider: selected.provider,
                providerKind: selected.kind,
                liveNetworkPermitted: livePermitted,
                liveNetworkBlockReason: narrowNetworkBlockReason(config, { killSwitchAsserted }),
                rateLimiter: narrowRateLimiter,
                costLedger: narrowCostLedger,
                sink: options.narrowShadowSink,
                deploymentSha: null
              });
            } catch {
              // Narrow shadow scheduling must not change the response already sent.
            }
          }
          return;
        } finally {
          if (heldLiveUrlSlot) liveUrlConcurrency.exit();
        }
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      sendJson(res, 500, { error: 'internal_error', message: 'The worker failed to complete the analysis.' });
    }
  });
}

/**
 * Start the worker. Refuses to start in live mode unless
 * MEDIA_LENS_ENABLE_LIVE=true and the TypeSafe key are both present.
 * Does not accept a fetchArticle override; that seam exists only on
 * createServer() for tests.
 */
export async function startServer(config = loadConfig()) {
  requireLiveModeReady(config);
  const server = createServer(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  return server;
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
  startServer()
    .then((server) => {
      const addr = server.address();
      // eslint-disable-next-line no-console
      console.log(`Media Lens worker listening on http://${addr.address}:${addr.port} (mode: ${loadConfig().mode})`);
    })
    .catch((err) => {
      console.error(`Media Lens worker failed to start: ${err.message}`);
      process.exitCode = 1;
    });
}
