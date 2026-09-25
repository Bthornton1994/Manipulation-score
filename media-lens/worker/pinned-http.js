// Pinned HTTP(S) for Media Lens (Issue #118).
//
// Connects only to a pre-classified IP. The stack must not perform a
// second DNS lookup for the hop: `lookup` returns the pin and never
// calls `dns`. TLS SNI / certificate identity stay on the original
// hostname. HTTP_PROXY / HTTPS_PROXY are not read (this module does
// not inspect the process environment; Node http.request does not honor
// those vars).
//
// Zero new dependencies. HTTP/1.1 only. No keep-alive reuse.
// Article fetch: GET. Provider clients (Jev / classifier.dev): POST.
// Does not follow redirects.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import {
  createBrotliDecompress,
  createGunzip,
  createInflate
} from 'node:zlib';
import {
  ipIdentitiesEqual,
  stripIPv6Brackets,
  taggedError
} from './address-policy.js';

const ALLOWED_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml']);
// Feed retrieval only. Article reads stay on ALLOWED_CONTENT_TYPES.
export const FEED_CONTENT_TYPES = new Set([
  'application/rss+xml',
  'application/atom+xml',
  'text/xml',
  'application/xml'
]);
const ALLOWED_ENCODINGS = new Set(['identity', 'gzip', 'x-gzip', 'deflate', 'br']);
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_HEADER_BYTES = 8192;

export function makePinnedLookup(pin) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options && options.all) {
      callback(null, [{ address: pin.address, family: pin.family }]);
      return;
    }
    callback(null, pin.address, pin.family);
  };
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const value = headers.get(name) ?? headers.get(name.toLowerCase());
    return value == null ? null : String(value);
  }
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct.length ? String(direct[0]) : null;
  return direct == null ? null : String(direct);
}

function countRawHeader(rawHeaders, name) {
  if (!Array.isArray(rawHeaders)) return 0;
  const needle = name.toLowerCase();
  let count = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (String(rawHeaders[i]).toLowerCase() === needle) count += 1;
  }
  return count;
}

function locationHeaderCount(response) {
  if (Array.isArray(response.rawHeaders) && response.rawHeaders.length > 0) {
    return countRawHeader(response.rawHeaders, 'location');
  }
  const headers = response.headers;
  if (!headers) return 0;
  if (typeof headers.get === 'function') {
    return headers.get('location') ? 1 : 0;
  }
  const value = headers.location ?? headers.Location;
  if (Array.isArray(value)) return value.length;
  return value ? 1 : 0;
}

function asReadable(body) {
  if (!body) return Readable.from([]);
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return Readable.from([Buffer.from(body)]);
  }
  if (typeof body.getReader === 'function' && typeof Readable.fromWeb === 'function') {
    return Readable.fromWeb(body);
  }
  return body;
}

function contentTypeAllowed(value) {
  if (!value) return 'missing';
  const mime = value.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(mime) ? 'ok' : 'blocked';
}

export function feedContentTypeAllowed(value) {
  if (!value) return 'missing';
  const mime = value.split(';')[0].trim().toLowerCase();
  return FEED_CONTENT_TYPES.has(mime) ? 'ok' : 'blocked';
}

function looksLikeHtml(buffer) {
  const prefix = buffer.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  return prefix.startsWith('<!doctype html') || prefix.startsWith('<html');
}

function createDecoder(encoding, maxBytes) {
  const opts = { maxOutputLength: maxBytes };
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip(opts);
  if (encoding === 'deflate') return createInflate(opts);
  if (encoding === 'br') return createBrotliDecompress(opts);
  return null;
}

async function readDecodedBody(stream, { encoding, maxBytes, signal }) {
  const decoder = createDecoder(encoding, maxBytes);
  const source = decoder ? stream.pipe(decoder) : stream;
  const onAbort = () => {
    try {
      stream.destroy?.();
    } catch {
      // ignore
    }
    try {
      decoder?.destroy?.();
    } catch {
      // ignore
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  let received = 0;
  const chunks = [];
  try {
    for await (const chunk of source) {
      if (signal?.aborted) {
        throw taggedError('Fetching timed out', 'TIMEOUT');
      }
      received += chunk.length;
      if (received > maxBytes) {
        stream.destroy?.();
        decoder?.destroy?.();
        throw taggedError('Response exceeded the size limit', 'TOO_LARGE');
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (err) {
    if (err?.code === 'TOO_LARGE' || err?.code === 'TIMEOUT') throw err;
    if (signal?.aborted || err?.name === 'AbortError') {
      throw taggedError('Fetching timed out', 'TIMEOUT');
    }
    if (err?.code === 'ERR_BUFFER_TOO_LARGE' || /exceed/i.test(String(err?.message || ''))) {
      throw taggedError('Response exceeded the size limit', 'TOO_LARGE');
    }
    throw taggedError(`Fetch failed: ${err.message}`, 'FETCH_ERROR');
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  return Buffer.concat(chunks);
}

function htmlTokenBudgetExceeded(html, { maxTokens, maxNesting, deadlineMs }) {
  let depth = 0;
  let tokens = 0;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*\/?>/g;
  let match;
  while ((match = re.exec(html))) {
    if (deadlineMs && Date.now() > deadlineMs) {
      return 'parse_timeout';
    }
    if (match[0].startsWith('<!--')) continue;
    tokens += 1;
    if (tokens > maxTokens) return 'tokens';
    if (match[1]) {
      depth = Math.max(0, depth - 1);
    } else if (match[2] && !match[0].endsWith('/>')) {
      const name = match[2].toLowerCase();
      if (name !== 'br' && name !== 'img' && name !== 'hr' && name !== 'meta' && name !== 'link' && name !== 'input') {
        depth += 1;
        if (depth > maxNesting) return 'nesting';
      }
    }
  }
  return null;
}

function requestHeaders(parsed) {
  return {
    Host: parsed.host,
    Accept: 'text/html, application/xhtml+xml;q=0.9',
    'Accept-Language': 'en',
    Connection: 'close',
    'User-Agent': 'ManipulationScore-MediaLens/0.1 (local worker; fail-closed GET)'
  };
}

export function feedRequestHeaders(parsed) {
  return {
    Host: parsed.host,
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9',
    'Accept-Language': 'en',
    Connection: 'close',
    'User-Agent': 'ManipulationScore-MediaLens/0.1 (local worker; fail-closed feed GET)'
  };
}

function isIpHostname(hostname) {
  const bare = stripIPv6Brackets(hostname);
  return bare.includes(':') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(bare);
}

function pinnedRequestHeaders(parsed, extraHeaders) {
  const out = {};
  const src = extraHeaders && typeof extraHeaders === 'object' && !Array.isArray(extraHeaders) ? extraHeaders : {};
  for (const [key, value] of Object.entries(src)) {
    if (value == null) continue;
    const lower = String(key).toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length' || lower === 'transfer-encoding') {
      continue;
    }
    out[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  out.Host = parsed.host;
  out.Connection = 'close';
  return out;
}

function encodePinnedBody(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(String(body));
}

/**
 * Perform one request to the pinned IP. Callers must already have classified
 * the pin. Does not follow redirects. GET (article fetch) or POST (provider
 * clients). The custom lookup never calls DNS again.
 */
export function performPinnedRequest({
  parsed,
  pin,
  method = 'GET',
  headers: extraHeaders = null,
  body = null,
  signal,
  timeoutMs,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  maxHeaderBytes = DEFAULT_MAX_HEADER_BYTES,
  createConnectionImpl = null,
  tlsCa = null
}) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb !== 'GET' && verb !== 'POST') {
    return Promise.reject(taggedError(`Unsupported method ${verb}`, 'FETCH_ERROR'));
  }
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const requestHostname = stripIPv6Brackets(parsed.hostname);
  const path = `${parsed.pathname || '/'}${parsed.search || ''}`;
  const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;
  const lookup = makePinnedLookup(pin);
  const headers = pinnedRequestHeaders(parsed, extraHeaders);
  const payload = encodePinnedBody(body);
  if (payload) headers['Content-Length'] = String(payload.length);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    const agent = new transport.Agent({
      keepAlive: false,
      maxSockets: 1,
      lookup
    });
    // Bind createConnection on the instance. Passing it only in Agent
    // options does not override Agent.prototype.createConnection.
    agent.createConnection = (options) => {
      const pinnedOptions = {
        ...options,
        host: pin.address,
        hostname: pin.address,
        family: pin.family,
        lookup
      };
      if (typeof createConnectionImpl === 'function') {
        return createConnectionImpl(pinnedOptions);
      }
      if (isHttps) {
        return tls.connect({
          ...pinnedOptions,
          servername: isIpHostname(requestHostname) ? undefined : requestHostname,
          checkServerIdentity: (name, cert) => tls.checkServerIdentity(isIpHostname(requestHostname) ? requestHostname : requestHostname, cert),
          rejectUnauthorized: true,
          // tlsCa is a test-only local-CA trust store. Production omits it
          // so Node's default CAs apply. Never set rejectUnauthorized: false.
          ...(tlsCa ? { ca: tlsCa } : {})
        });
      }
      return net.connect(pinnedOptions);
    };

    const options = {
      protocol: parsed.protocol,
      hostname: requestHostname,
      port,
      path,
      method: verb,
      headers,
      agent,
      lookup,
      timeout: timeoutMs,
      maxHeaderBytes,
      insecureHTTPParser: false,
      signal
    };

    if (isHttps) {
      options.servername = isIpHostname(requestHostname) ? undefined : requestHostname;
      options.checkServerIdentity = (name, cert) => {
        const identity = isIpHostname(requestHostname) ? requestHostname : requestHostname;
        return tls.checkServerIdentity(identity, cert);
      };
      options.rejectUnauthorized = true;
      if (tlsCa) options.ca = tlsCa;
    }

    let req;
    try {
      req = transport.request(options, (res) => {
        const remote = res.socket?.remoteAddress;
        if (!remote || !ipIdentitiesEqual(remote, pin.address)) {
          res.resume();
          req.destroy();
          finish(taggedError('Pinned destination did not match the connected peer', 'PIN_MISMATCH'));
          return;
        }
        finish(null, {
          status: res.statusCode,
          headers: res.headers,
          rawHeaders: res.rawHeaders,
          remoteAddress: remote,
          body: res
        });
      });
    } catch (err) {
      agent.destroy();
      finish(taggedError(`Fetch failed: ${err.message}`, 'FETCH_ERROR'));
      return;
    }

    const destroyAgent = () => {
      try {
        agent.destroy();
      } catch {
        // ignore
      }
    };
    req.on('close', destroyAgent);

    req.on('socket', (socket) => {
      const connectTimer = setTimeout(() => {
        req.destroy();
        finish(taggedError('Fetching timed out', 'TIMEOUT'));
      }, connectTimeoutMs);

      const onConnect = () => {
        clearTimeout(connectTimer);
        const remote = socket.remoteAddress;
        if (!remote || !ipIdentitiesEqual(remote, pin.address)) {
          req.destroy();
          finish(taggedError('Pinned destination did not match the connected peer', 'PIN_MISMATCH'));
        }
      };

      if (socket.connecting === false && socket.remoteAddress) {
        onConnect();
      } else {
        socket.once('connect', onConnect);
      }
      socket.once('error', () => clearTimeout(connectTimer));
      socket.once('close', () => clearTimeout(connectTimer));
    });

    req.on('timeout', () => {
      req.destroy();
      finish(taggedError('Fetching timed out', 'TIMEOUT'));
    });
    req.on('error', (err) => {
      if (err?.name === 'AbortError' || signal?.aborted) {
        finish(taggedError('Fetching timed out', 'TIMEOUT'));
        return;
      }
      if (String(err?.code || '').includes('CERT') || /certificate/i.test(err?.message || '')) {
        finish(taggedError(`TLS error: ${err.message}`, 'TLS_ERROR'));
        return;
      }
      finish(taggedError(`Fetch failed: ${err.message}`, 'FETCH_ERROR'));
    });

    if (payload && payload.length) req.write(payload);
    req.end();
  });
}

/**
 * Perform one GET to the pinned IP. Callers must already have classified
 * the pin as allow_public. Does not follow redirects.
 */
export function performPinnedGet(ctx) {
  return performPinnedRequest({
    ...ctx,
    method: 'GET',
    headers: ctx.headers || requestHeaders(ctx.parsed),
    body: null
  });
}

export async function finalizePinnedResponse(response, { pin, maxBytes, signal, parseTimeoutMs, maxTokens = 50000, maxNesting = 64 }) {
  if (!response || !response.remoteAddress || !ipIdentitiesEqual(response.remoteAddress, pin.address)) {
    throw taggedError('Pinned destination did not match the connected peer', 'PIN_MISMATCH');
  }

  const locations = locationHeaderCount(response);
  const location = headerValue(response.headers, 'location');

  return {
    status: response.status,
    location,
    locationCount: locations,
    headers: response.headers,
    rawHeaders: response.rawHeaders,
    async readHtml() {
      const contentLength = headerValue(response.headers, 'content-length');
      if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
        throw taggedError('Response exceeded the size limit', 'TOO_LARGE');
      }

      const encodingRaw = (headerValue(response.headers, 'content-encoding') || 'identity').trim().toLowerCase();
      const encoding = encodingRaw === '' ? 'identity' : encodingRaw;
      if (!ALLOWED_ENCODINGS.has(encoding)) {
        throw taggedError(`Unsupported Content-Encoding: ${encoding}`, 'FETCH_ERROR');
      }

      const typeCheck = contentTypeAllowed(headerValue(response.headers, 'content-type'));
      const buffer = await readDecodedBody(asReadable(response.body), {
        encoding: encoding === 'identity' ? 'identity' : encoding,
        maxBytes,
        signal
      });

      if (typeCheck === 'blocked') {
        throw taggedError('Response Content-Type is not an allowed HTML type', 'BAD_CONTENT_TYPE');
      }
      if (typeCheck === 'missing' && !looksLikeHtml(buffer)) {
        throw taggedError('Response Content-Type is missing and the body is not HTML', 'BAD_CONTENT_TYPE');
      }

      const html = buffer.toString('utf8');
      const deadlineMs = parseTimeoutMs ? Date.now() + parseTimeoutMs : 0;
      const over = htmlTokenBudgetExceeded(html, { maxTokens, maxNesting, deadlineMs });
      if (over === 'parse_timeout') {
        throw taggedError('HTML parse exceeded the time limit', 'TIMEOUT');
      }
      if (over) {
        throw taggedError('Response HTML exceeded parser limits', 'TOO_LARGE');
      }
      return html;
    },
    async readFeed() {
      const contentLength = headerValue(response.headers, 'content-length');
      if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
        throw taggedError('Response exceeded the size limit', 'TOO_LARGE');
      }
      const encodingRaw = (headerValue(response.headers, 'content-encoding') || 'identity').trim().toLowerCase();
      const encoding = encodingRaw === '' ? 'identity' : encodingRaw;
      if (!ALLOWED_ENCODINGS.has(encoding)) {
        throw taggedError(`Unsupported Content-Encoding: ${encoding}`, 'FETCH_ERROR');
      }
      const typeCheck = feedContentTypeAllowed(headerValue(response.headers, 'content-type'));
      const buffer = await readDecodedBody(asReadable(response.body), {
        encoding: encoding === 'identity' ? 'identity' : encoding,
        maxBytes,
        signal
      });
      if (typeCheck !== 'ok') {
        throw taggedError('Response Content-Type is not an allowed feed type', 'BAD_CONTENT_TYPE');
      }
      const xml = buffer.toString('utf8');
      const deadlineMs = parseTimeoutMs ? Date.now() + parseTimeoutMs : 0;
      const over = htmlTokenBudgetExceeded(xml, { maxTokens, maxNesting, deadlineMs });
      if (over === 'parse_timeout') {
        throw taggedError('Feed parse exceeded the time limit', 'TIMEOUT');
      }
      if (over) {
        throw taggedError('Response feed exceeded parser limits', 'TOO_LARGE');
      }
      return xml;
    }
  };
}

export { headerValue, countRawHeader, contentTypeAllowed, looksLikeHtml };
