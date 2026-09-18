// Safe outbound fetch for live-mode "url" analysis (H2). Live mode is not
// exercised by default or in CI, but when it is enabled the worker must
// not become an open SSRF proxy: this module enforces an http(s)-only
// scheme, a request timeout, a response-size cap, and rejects
// loopback/private/link-local targets — including after following a
// redirect, since a redirect is exactly how an allowed-looking URL can
// repoint at an internal or cloud-metadata host.
//
// This module has no knowledge of Media Lens's schema or fusion logic; it
// is a small, independently testable network guard.

import { lookup as dnsLookup } from 'node:dns/promises';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function taggedError(message, code) {
  return Object.assign(new Error(message), { code });
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(intIp, baseIp, prefix) {
  const base = ipv4ToInt(baseIp);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (intIp & mask) === (base & mask);
}

// Loopback, RFC 1918 private ranges, link-local (which also covers the
// 169.254.169.254 cloud metadata address), carrier-grade NAT, and
// "this network" — anything that is not routable public address space.
const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15]
];

function isBlockedIPv4(ip) {
  const intIp = ipv4ToInt(ip);
  if (intIp === null) return true; // fail closed on anything unparsable
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => inCidr(intIp, base, prefix));
}

function isBlockedIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // link-local (fe80::/10)
  }
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local (fc00::/7)
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    if (mapped.includes('.')) return isBlockedIPv4(mapped);
  }
  return false;
}

function isBlockedIp(ip) {
  return ip.includes(':') ? isBlockedIPv6(ip) : isBlockedIPv4(ip);
}

/**
 * Resolve a hostname (or IP literal) and throw if any resolved address is
 * loopback/private/link-local. This runs on every hop, including after a
 * redirect, so a public-looking hostname that redirects to an internal
 * address is still caught.
 */
export async function assertHostIsPublic(hostname, { lookupImpl = dnsLookup } = {}) {
  if (hostname.toLowerCase() === 'localhost') {
    throw taggedError(`Blocked host: ${hostname} resolves to a loopback address`, 'BLOCKED_HOST');
  }
  let results;
  try {
    results = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw taggedError(`Could not resolve host: ${hostname}`, 'DNS_ERROR');
  }
  const addresses = (Array.isArray(results) ? results : [results]).map((r) => r.address);
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw taggedError(`Blocked host: ${hostname} resolves to a non-public address`, 'BLOCKED_HOST');
  }
}

async function readBodyWithByteCap(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw taggedError('Response exceeded the size limit', 'TOO_LARGE');
    }
    return text;
  }

  const reader = response.body.getReader();
  let received = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) {
        throw taggedError('Response exceeded the size limit', 'TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // ignore
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Fetch an article URL safely: http(s) only, loopback/private/link-local
 * hosts rejected (re-checked at every redirect hop), bounded timeout,
 * bounded response size, redirects followed manually so each hop is
 * validated before it is trusted.
 */
export async function fetchArticleSafely(
  targetUrl,
  { timeoutMs, maxBytes, maxRedirects = 3, fetchImpl = globalThis.fetch, lookupImpl = dnsLookup } = {}
) {
  let currentUrl = targetUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw taggedError(`Not a valid URL: ${currentUrl}`, 'BAD_URL');
    }
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      throw taggedError(`Only http/https URLs are allowed, got ${parsed.protocol}`, 'BAD_SCHEME');
    }

    await assertHostIsPublic(parsed.hostname, { lookupImpl });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(currentUrl, { redirect: 'manual', signal: controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw taggedError(`Fetching ${currentUrl} timed out`, 'TIMEOUT');
      }
      throw taggedError(`Fetch failed: ${err.message}`, 'FETCH_ERROR');
    } finally {
      clearTimeout(timer);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw taggedError('Redirect response had no Location header', 'FETCH_ERROR');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw taggedError(`Fetch returned HTTP ${response.status}`, 'FETCH_ERROR');
    }

    const html = await readBodyWithByteCap(response, maxBytes);
    return { html, finalUrl: currentUrl };
  }

  throw taggedError('Too many redirects', 'TOO_MANY_REDIRECTS');
}
