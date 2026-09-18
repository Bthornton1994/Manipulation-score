#!/usr/bin/env node
// Media Lens worker HTTP server: node:http, zero dependencies, listens on
// 127.0.0.1 only by default. GET /health, POST /analyze. Owns all network,
// keys, and limits; the browser page talks only to this process. See
// docs/media-lens-influence-graph-plan.md section 1.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, publicConfig, assertLiveModeIsReady } from './config.js';
import { prepareFromHtml, prepareFromPastedText } from './prepare.js';
import { createJevAdapter } from './adapters/jev.js';
import { createNewsjackAdapter } from './adapters/newsjack.js';
import { analyze } from './analyze.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

// The browser page is typically served from a different origin (e.g. a
// static file server on http://localhost:4173) than this worker
// (http://127.0.0.1:8787), so the browser's CORS check runs even though
// both are on loopback. This worker holds no cookies/session and accepts
// no credentialed requests, so it is safe to allow any loopback origin;
// it never allows a non-loopback origin.
const LOOPBACK_ORIGIN_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

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
    apiKey: config.secrets.typesafeApiKey
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
  if (payload.mode === 'pasted_text') {
    return prepareFromPastedText({ text: String(payload.text || ''), kind: payload.kind || 'other_public' });
  }
  if (payload.mode === 'fixture') {
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
    const response = await fetch(payload.url);
    const html = await response.text();
    return prepareFromHtml({ html, kind: payload.kind || 'article', sourceUrl: payload.url, inputMode: 'url' });
  }
  throw Object.assign(new Error(`Unknown analyze mode: ${payload.mode}`), { code: 'UNKNOWN_MODE' });
}

/**
 * Create (but do not start) the Media Lens worker HTTP server.
 */
export function createServer(config = loadConfig()) {
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

        if (!checkRateLimit()) {
          sendJson(res, 429, { error: 'rate_limited', message: 'Too many analyses requested. Wait a minute and try again.' });
          return;
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

        let prepared;
        try {
          prepared = await preparePayload({ payload, config });
        } catch (err) {
          sendJson(res, 400, { error: err.code || 'prepare_failed', message: err.message });
          return;
        }

        const { jevAdapter, newsjackAdapter } = await buildAdapters({ config, payload });

        const graph = await analyze({
          prepared,
          config,
          jevAdapter,
          newsjackAdapter,
          userAssertedPublic: true,
          consentAt: new Date().toISOString(),
          disclosureShown: true
        });

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
 * Start the worker. Refuses to start in live mode without a configured key.
 */
export async function startServer(config = loadConfig()) {
  const readiness = assertLiveModeIsReady(config);
  if (!readiness.ok) {
    throw new Error(readiness.reason);
  }
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
