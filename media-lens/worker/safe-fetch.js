// Safe outbound GET for live-mode "url" analysis (Issue #118).
//
// Connect-time destination pinning: classify every resolved address, fail
// closed if any is blocked or unclassifiable, then connect only to one
// pre-classified public IP. TLS SNI and certificate identity stay on the
// original hostname. The client never calls global fetch() on a user URL
// and never reads HTTP_PROXY. Redirects are followed manually with a full
// re-validate and re-pin on every hop. HTTPS→HTTP is denied. When a canary
// hostname allowlist is configured, every hop (including the first) is
// re-checked against it before DNS pin or connect.
//
// Live URL remains disabled unless MEDIA_LENS_ENABLE_LIVE_URL=true. This
// module is not a production-readiness claim.

import { lookup as dnsLookup } from 'node:dns/promises';
import {
  classifyIp,
  ipIdentitiesEqual,
  isDeniedSpecialHost,
  isStrictIPv4,
  parseArticleUrl,
  stripIPv6Brackets,
  taggedError
} from './address-policy.js';
import { hostIsAllowlisted } from './host-key.js';
import { feedRequestHeaders, finalizePinnedResponse, headerValue, performPinnedGet } from './pinned-http.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_HEADER_BYTES = 8192;
const DEFAULT_PARSE_TIMEOUT_MS = 2000;
const DEFAULT_MAX_REDIRECTS = 3;

export {
  classifyIp,
  ipIdentitiesEqual,
  parseArticleUrl,
  stripIPv6Brackets,
  taggedError
};

/**
 * Resolve a hostname (or IP literal) and throw if any resolved address is
 * not allow_public. Mixed public+private answers fail closed. Used by
 * tests and as the policy half of pinning.
 */
export async function pinHost(hostname, { lookupImpl = dnsLookup, classifyImpl = classifyIp } = {}) {
  const bareHostname = stripIPv6Brackets(hostname).toLowerCase();
  if (isDeniedSpecialHost(bareHostname)) {
    throw taggedError(`Blocked host: ${hostname} resolves to a loopback address`, 'BLOCKED_HOST');
  }

  if (bareHostname.includes(':') || isStrictIPv4(bareHostname)) {
    const classified = classifyImpl(bareHostname);
    if (classified.disposition !== 'allow_public') {
      throw taggedError(`Blocked host: ${hostname} resolves to a non-public address`, 'BLOCKED_HOST');
    }
    return { address: classified.canonical, family: classified.family, classified };
  }

  let results;
  try {
    results = await lookupImpl(bareHostname, { all: true, verbatim: true });
  } catch {
    throw taggedError(`Could not resolve host: ${hostname}`, 'DNS_ERROR');
  }
  const addresses = (Array.isArray(results) ? results : [results]).map((r) => r && r.address).filter(Boolean);
  if (addresses.length === 0) {
    throw taggedError(`Could not resolve host: ${hostname}`, 'DNS_ERROR');
  }
  const classified = addresses.map((address) => classifyImpl(address));
  if (classified.some((entry) => entry.disposition !== 'allow_public')) {
    throw taggedError(`Blocked host: ${hostname} resolves to a non-public address`, 'BLOCKED_HOST');
  }
  const preferred = classified.find((entry) => entry.family === 6) || classified[0];
  return { address: preferred.canonical, family: preferred.family, classified };
}

const OPERATOR_LOOPBACK_NAMES = new Set(['localhost', 'localhost.localdomain']);

function isLoopbackAddress(address, classified) {
  if (classified?.reason === 'block_loopback' || String(classified?.reason || '').includes('block_loopback')) {
    return true;
  }
  const bare = stripIPv6Brackets(String(address || '')).toLowerCase();
  return bare === '127.0.0.1' || bare === '::1';
}

/**
 * Pin a configured provider host (TypeSafe Jev / classifier.dev).
 *
 * DNS names use the same public-only policy as article fetch (`pinHost`):
 * mixed or private answers are BLOCKED_HOST. Operator-configured loopback
 * HTTP mocks may pin 127.0.0.1 / ::1 / localhost because those destinations
 * are not user URLs and cannot rebind a public hostname.
 */
export async function pinProviderHost(
  hostname,
  { lookupImpl = dnsLookup, classifyImpl = classifyIp, allowLoopbackLiteral = true } = {}
) {
  const bareHostname = stripIPv6Brackets(hostname).toLowerCase();

  if (allowLoopbackLiteral && (isStrictIPv4(bareHostname) || bareHostname.includes(':'))) {
    const classified = classifyImpl(bareHostname);
    if (isLoopbackAddress(bareHostname, classified) || classifyIp(bareHostname).reason === 'block_loopback') {
      const family = classified.family || (bareHostname.includes(':') ? 6 : 4);
      const address = classified.canonical || bareHostname;
      return { address, family, classified };
    }
  }

  if (allowLoopbackLiteral && OPERATOR_LOOPBACK_NAMES.has(bareHostname)) {
    let results;
    try {
      results = await lookupImpl(bareHostname, { all: true, verbatim: true });
    } catch {
      throw taggedError(`Could not resolve host: ${hostname}`, 'DNS_ERROR');
    }
    const addresses = (Array.isArray(results) ? results : [results]).map((r) => r && r.address).filter(Boolean);
    if (addresses.length === 0) {
      throw taggedError(`Could not resolve host: ${hostname}`, 'DNS_ERROR');
    }
    const classified = addresses.map((address) => classifyImpl(address));
    if (!classified.every((entry, index) => isLoopbackAddress(addresses[index], entry))) {
      throw taggedError(`Blocked host: ${hostname} resolves to a non-loopback address`, 'BLOCKED_HOST');
    }
    const preferred = classified.find((entry) => entry.family === 6) || classified[0];
    return {
      address: preferred.canonical || addresses[classified.indexOf(preferred)],
      family: preferred.family || 4,
      classified
    };
  }

  return pinHost(hostname, { lookupImpl, classifyImpl });
}

export async function assertHostIsPublic(hostname, { lookupImpl = dnsLookup, classifyImpl = classifyIp } = {}) {
  await pinHost(hostname, { lookupImpl, classifyImpl });
}

function withTimeoutSignal(timeoutMs, outer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuter = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onOuter);
    }
  };
}

async function defaultRequestImpl(ctx) {
  return performPinnedGet(ctx);
}

let fetchGate = Promise.resolve();

/**
 * Fetch an article URL safely: http(s) GET only, no cookies, no userinfo,
 * loopback/private/link-local/multicast/metadata/embedding policy applied
 * at every hop, canary hostname allowlist re-checked at every hop,
 * connect-time pin, bounded time/bytes/headers/parse, no global
 * fetch(userUrl). Concurrent fetches are serialized per process.
 */
export function fetchArticleSafely(targetUrl, options) {
  return enqueuePinnedGet(targetUrl, { ...options, profile: 'article' });
}

/**
 * Fetch an approved https feed. Same pin, redirect, allowlist, and userinfo
 * rules as article fetch. Allows RSS/Atom XML types only and returns `body`.
 * Does not accept HTML article types.
 */
export function fetchFeedSafely(targetUrl, options) {
  return enqueuePinnedGet(targetUrl, { ...options, profile: 'feed' });
}

function enqueuePinnedGet(targetUrl, options) {
  const run = fetchGate.then(
    () => fetchPinnedGetUnlocked(targetUrl, options),
    () => fetchPinnedGetUnlocked(targetUrl, options)
  );
  fetchGate = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function fetchPinnedGetUnlocked(
  targetUrl,
  {
    timeoutMs,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    maxBytes,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    maxHeaderBytes = DEFAULT_MAX_HEADER_BYTES,
    parseTimeoutMs = DEFAULT_PARSE_TIMEOUT_MS,
    lookupImpl = dnsLookup,
    // Test seams. Production callers omit these: classifyImpl stays
    // classifyIp (loopback remains BLOCKED_HOST), tlsCa is unset so the
    // default CA store applies, and createConnectionImpl/requestImpl are
    // unset so net.connect / tls.connect run.
    classifyImpl = classifyIp,
    requestImpl = null,
    createConnectionImpl = null,
    tlsCa = null,
    urlAllowlist = null,
    signal: outerSignal = null,
    profile = 'article'
  } = {}
) {
  let currentUrl = targetUrl;
  let previousScheme = null;
  const request = requestImpl || defaultRequestImpl;
  if (profile === 'feed') {
    const { parsed } = parseArticleUrl(targetUrl);
    if (parsed.protocol !== 'https:') {
      throw taggedError('Feed URL must be https', 'BAD_SCHEME');
    }
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { parsed } = parseArticleUrl(currentUrl);

    if (previousScheme === 'https:' && parsed.protocol === 'http:') {
      throw taggedError('HTTPS to HTTP redirects are not allowed', 'REDIRECT_DOWNGRADE');
    }

    // Canary allowlist is hop-scoped. Empty/unset means public-address
    // policy only (hostIsAllowlisted returns true). Off-list hops fail
    // closed before pin/connect so the hop cannot return 200.
    if (!hostIsAllowlisted(parsed.hostname, urlAllowlist)) {
      throw taggedError('This host is not on the operator URL allowlist.', 'live_url_not_allowlisted');
    }

    const pin = await pinHost(parsed.hostname, { lookupImpl, classifyImpl });
    const timeout = withTimeoutSignal(timeoutMs, outerSignal);
    try {
      let response;
      try {
        response = await request({
          url: parsed.toString(),
          parsed,
          pin,
          method: 'GET',
          headers: profile === 'feed' ? feedRequestHeaders(parsed) : undefined,
          signal: timeout.signal,
          timeoutMs,
          connectTimeoutMs,
          maxHeaderBytes,
          maxBytes,
          createConnectionImpl,
          tlsCa
        });
      } catch (err) {
        if (err?.code) throw err;
        if (err?.name === 'AbortError' || timeout.signal.aborted) {
          throw taggedError(`Fetching ${currentUrl} timed out`, 'TIMEOUT');
        }
        throw taggedError(`Fetch failed: ${err.message}`, 'FETCH_ERROR');
      }

      const finalized = await finalizePinnedResponse(response, {
        pin,
        maxBytes,
        signal: timeout.signal,
        parseTimeoutMs
      });

      if (REDIRECT_STATUSES.has(finalized.status)) {
        if (typeof response.body?.resume === 'function') response.body.resume();
        else if (typeof response.body?.destroy === 'function') response.body.destroy();
        if (finalized.locationCount !== 1 || !finalized.location) {
          throw taggedError('Redirect response had no single Location header', 'FETCH_ERROR');
        }
        currentUrl = new URL(finalized.location, parsed).toString();
        previousScheme = parsed.protocol;
        continue;
      }

      if (finalized.status !== 200) {
        if (typeof response.body?.resume === 'function') response.body.resume();
        throw taggedError(`Fetch returned HTTP ${finalized.status}`, 'FETCH_ERROR');
      }

      if (profile === 'feed') {
        const body = await finalized.readFeed();
        return {
          body,
          finalUrl: currentUrl,
          pin,
          contentType: headerValue(finalized.headers, 'content-type') || null,
          fetchedAt: new Date().toISOString(),
          fetchStatus: '200'
        };
      }
      const html = await finalized.readHtml();
      return {
        html,
        finalUrl: currentUrl,
        pin,
        contentType: headerValue(finalized.headers, 'content-type') || null,
        fetchedAt: new Date().toISOString(),
        fetchStatus: '200'
      };
    } finally {
      timeout.cleanup();
    }
  }

  throw taggedError('Too many redirects', 'TOO_MANY_REDIRECTS');
}
