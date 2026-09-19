#!/usr/bin/env node
// Media Lens worker HTTP server: node:http, zero dependencies, listens on
// 127.0.0.1 only by default. GET /health, POST /analyze. Owns all network,
// keys, and limits; the browser page talks only to this process. See
// docs/media-lens-influence-graph-plan.md section 1.

import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, publicConfig, assertLiveModeIsReady } from './config.js';
import { prepareFromHtml, prepareFromPastedText, emptyPreparedArtifactStub } from './prepare.js';
import { createJevAdapter } from './adapters/jev.js';
import { createNewsjackAdapter } from './adapters/newsjack.js';
import { analyze, buildAbstentionOnlyGraph } from './analyze.js';
import { fetchArticleSafely } from './safe-fetch.js';
import { validate } from '../schema/validate.js';

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

function createRateLimiter(maxPerMinute) {
  let windowStart = Date.now();
  let count = 0;
  return function checkAndIncrement() {
    const now = Date.now();
    if (now - windowStart >= 60000) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= maxPerMinute;
  };
}

async function buildAdapters({ config, payload }) {
  const jevMode = config.mode === 'live' ? 'live' : 'fixture';
  const jevAdapter = createJevAdapter({
    mode: jevMode,
    fixtureId: payload.fixture_id || null,
    fixtureDir: join(FIXTURES_DIR, 'jev'),
    baseUrl: config.jev.baseUrl,
    apiKey: config.secrets.typesafeApiKey,
    // H2: without this, the adapter silently falls back to its own
    // hardcoded default and the advertised /health limit is dead.
    timeoutMs: config.limits.jevCallTimeoutMs
  });

  let newsjackMode = 'fixture';
  if (config.mode === 'live') newsjackMode = config.newsjack.artifactsDir ? 'artifacts' : 'disabled';
  const newsjackAdapter = createNewsjackAdapter({
    mode: newsjackMode,
    fixtureId: payload.fixture_id || null,
    fixtureDir: join(FIXTURES_DIR, 'newsjack'),
    artifactsDir: config.newsjack.artifactsDir
  });

  return { jevAdapter, newsjackAdapter };
}

async function preparePayload({ payload, config }) {
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
      inputMode: 'fixture'
    });
  }
  if (payload.mode === 'url') {
    if (config.mode !== 'live') {
      throw Object.assign(new Error('URL mode requires the worker to be running in live mode'), { code: 'URL_MODE_REQUIRES_LIVE' });
    }
    // Issue #118: live Jev (MEDIA_LENS_ENABLE_LIVE) must not open article
    // fetch. URL retrieval requires the separate exact flag.
    if (config.liveUrlEnabled !== true) {
      throw Object.assign(
        new Error('Live URL fetch is disabled until MEDIA_LENS_ENABLE_LIVE_URL=true is set. This is not a production-ready mode.'),
        { code: 'live_url_disabled' }
      );
    }
    // Connect-time pin: never call global fetch on a user-supplied URL.
    const { html } = await fetchArticleSafely(payload.url, {
      timeoutMs: config.limits.urlFetchTimeoutMs,
      connectTimeoutMs: config.limits.urlFetchConnectTimeoutMs,
      maxBytes: config.limits.urlFetchMaxBytes,
      maxRedirects: config.limits.urlFetchMaxRedirects,
      maxHeaderBytes: config.limits.urlFetchMaxHeaderBytes,
      parseTimeoutMs: config.limits.urlFetchParseTimeoutMs
    });
    return prepareFromHtml({ html, kind: payload.kind || 'article', sourceUrl: payload.url, inputMode: 'url' });
  }
  throw Object.assign(new Error(`Unknown analyze mode: ${payload.mode}`), { code: 'UNKNOWN_MODE' });
}

// Failures that mean "we could not safely/successfully fetch this right
// now" become an abstention graph (HTTP 200) rather than a raw error,
// matching how every other engine-unavailable condition is reported.
// Failures that mean "this input is not allowed" are rejected outright.
const PREPARE_FAILURE_AS_ABSTENTION = new Set(['TIMEOUT', 'FETCH_ERROR', 'TOO_MANY_REDIRECTS', 'TLS_ERROR']);
const PREPARE_FAILURE_STATUS = { TOO_LARGE: 413 };

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

/**
 * Create (but do not start) the Media Lens worker HTTP server.
 * Live mode is refused here, not only in startServer(), so a direct
 * createServer(config).listen() cannot skip the opt-in + API-key gate.
 */
export function createServer(config = loadConfig()) {
  requireLiveModeReady(config);
  const checkRateLimit = createRateLimiter(config.limits.maxAnalysesPerMinute);

  return http.createServer(async (req, res) => {
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
          sendJson(res, 429, { error: 'rate_limited', message: 'Too many analyses requested. Wait a minute and try again.' });
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

        const { consentAt } = resolveConsentAt(payload.consent_at);

        let prepared;
        try {
          prepared = await preparePayload({ payload, config });
        } catch (err) {
          if (PREPARE_FAILURE_AS_ABSTENTION.has(err.code)) {
            const stub = emptyPreparedArtifactStub({ inputMode: payload.mode === 'url' ? 'url' : 'pasted_text', url: payload.url || null });
            const fallback = await buildAbstentionOnlyGraph({
              prepared: stub,
              reason: 'engine_unavailable',
              message: 'The article could not be fetched in time, so no analysis was performed.',
              config,
              userAssertedPublic: true,
              consentAt
            });
            sendJson(res, 200, fallback);
            return;
          }
          sendJson(res, PREPARE_FAILURE_STATUS[err.code] || 400, { error: err.code || 'prepare_failed', message: err.message });
          return;
        }

        const { jevAdapter, newsjackAdapter } = await buildAdapters({ config, payload });

        const rawGraph = await analyze({
          prepared,
          config,
          jevAdapter,
          newsjackAdapter,
          userAssertedPublic: true,
          consentAt,
          disclosureShown: true
        });

        // H1: never serve a document that fails its own schema.
        const graph = await validateOrAbstain({ graph: rawGraph, prepared, config, consentAt });

        sendJson(res, 200, graph);
        return;
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
