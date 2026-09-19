// Fetch-shaped client for configured provider HTTPS (TypeSafe Jev and
// classifier.dev). Resolve DNS once, classify every address, pin one
// allowed IP, connect only to that pin, and never follow redirects.
//
// Article URL fetch stays in safe-fetch.js. This module is for operator-
// configured origins, not user URLs. Zero new dependencies. Live flags
// stay default-off; callers must not invoke this when disabled.

import { lookup as dnsLookup } from 'node:dns/promises';
import {
  classifyIp,
  ipIdentitiesEqual,
  stripIPv6Brackets,
  taggedError
} from './address-policy.js';
import { pinProviderHost } from './safe-fetch.js';
import { performPinnedRequest } from './pinned-http.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_HEADER_BYTES = 8192;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isProviderRedirectResponse(response) {
  if (!response || typeof response !== 'object') return false;
  if (response.redirected === true) return true;
  if (response.type === 'opaqueredirect') return true;
  const status = response.status;
  return Number.isInteger(status) && status >= 300 && status < 400;
}

export function mapProviderTransportError(err, timedOut = false) {
  const code = err?.code;
  if (code === 'TIMEOUT' || timedOut || err?.name === 'AbortError') return 'timeout';
  if (
    code === 'PIN_MISMATCH' ||
    code === 'BLOCKED_HOST' ||
    code === 'BAD_SCHEME' ||
    code === 'BAD_URL' ||
    code === 'DNS_ERROR' ||
    code === 'TLS_ERROR'
  ) {
    return code;
  }
  if (/redirect/i.test(String(err?.message || ''))) return 'redirect_rejected';
  return `transport_error:${err?.message || 'unknown'}`;
}

const PROVIDER_FAIL_CLOSED = new Set([
  'PIN_MISMATCH',
  'BLOCKED_HOST',
  'BAD_SCHEME',
  'BAD_URL',
  'DNS_ERROR',
  'TLS_ERROR',
  'redirect_rejected'
]);

export function isProviderFailClosedError(reason) {
  return PROVIDER_FAIL_CLOSED.has(reason);
}

function headersFromInit(initHeaders) {
  const out = {};
  if (!initHeaders) return out;
  if (typeof initHeaders.forEach === 'function') {
    initHeaders.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(initHeaders)) {
    for (const pair of initHeaders) {
      if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = pair[1];
    }
    return out;
  }
  return { ...initHeaders };
}

function toFetchHeaders(nodeHeaders) {
  const headers = new Headers();
  if (!nodeHeaders) return headers;
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, String(item));
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

function toFetchResponse(pinned, url) {
  const headers = toFetchHeaders(pinned.headers);
  let bodyBuffer = null;
  async function buffer() {
    if (bodyBuffer) return bodyBuffer;
    const source = pinned.body;
    if (!source) {
      bodyBuffer = Buffer.alloc(0);
      return bodyBuffer;
    }
    if (typeof source === 'string' || Buffer.isBuffer(source)) {
      bodyBuffer = Buffer.from(source);
      return bodyBuffer;
    }
    const chunks = [];
    for await (const chunk of source) chunks.push(Buffer.from(chunk));
    bodyBuffer = Buffer.concat(chunks);
    return bodyBuffer;
  }
  const status = pinned.status;
  return {
    status,
    statusText: '',
    ok: status >= 200 && status < 300,
    redirected: false,
    type: 'default',
    headers,
    url: String(url),
    remoteAddress: pinned.remoteAddress,
    async text() {
      return (await buffer()).toString('utf8');
    },
    async json() {
      return JSON.parse(await this.text());
    }
  };
}

function parseProviderUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw taggedError('Provider URL is not valid', 'BAD_URL');
  }
  if (parsed.username || parsed.password) {
    throw taggedError('Provider URL must not include credentials', 'BAD_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw taggedError(`Unsupported URL scheme: ${parsed.protocol}`, 'BAD_SCHEME');
  }
  return parsed;
}

/**
 * Fetch-like POST/GET that pins the destination. Never follows redirects
 * (`redirect: 'follow'` is ignored). TLS SNI stays on the original hostname.
 */
export async function providerPinnedFetch(url, init = {}, options = {}) {
  const parsed = parseProviderUrl(url);
  if (init?.signal?.aborted) {
    throw taggedError('Fetching timed out', 'TIMEOUT');
  }

  const pin = await pinProviderHost(parsed.hostname, {
    lookupImpl: options.lookupImpl || dnsLookup,
    classifyImpl: options.classifyImpl || classifyIp,
    allowLoopbackLiteral: options.allowLoopbackLiteral !== false
  });

  const method = String(init.method || 'GET').toUpperCase();
  const extraHeaders = headersFromInit(init.headers);
  const pinned = await performPinnedRequest({
    parsed,
    pin,
    method,
    headers: extraHeaders,
    body: init.body == null ? null : init.body,
    signal: init.signal || null,
    timeoutMs: options.timeoutMs,
    connectTimeoutMs: options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS,
    maxHeaderBytes: options.maxHeaderBytes || DEFAULT_MAX_HEADER_BYTES,
    createConnectionImpl: options.createConnectionImpl || null,
    tlsCa: options.tlsCa || null
  });

  if (!pinned.remoteAddress || !ipIdentitiesEqual(pinned.remoteAddress, pin.address)) {
    if (typeof pinned.body?.resume === 'function') pinned.body.resume();
    throw taggedError('Pinned destination did not match the connected peer', 'PIN_MISMATCH');
  }

  if (REDIRECT_STATUSES.has(pinned.status) || (pinned.status >= 300 && pinned.status < 400)) {
    if (typeof pinned.body?.resume === 'function') pinned.body.resume();
    return toFetchResponse({ ...pinned, body: '' }, parsed.toString());
  }

  return toFetchResponse(pinned, parsed.toString());
}

export function createProviderPinnedFetch(options = {}) {
  return function pinnedFetch(url, init) {
    return providerPinnedFetch(url, init, options);
  };
}

export { pinProviderHost, stripIPv6Brackets };
