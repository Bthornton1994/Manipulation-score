// Ported from Newsjack (https://github.com/elvisun/newsjack) origin.go,
// commit bdb41b8, MIT License, Copyright (c) 2026 Elvis Sun.
// Adapted from Go to JavaScript; behavior (not code) is ported: lowercase
// scheme/host, drop fragment, trim trailing slash, strip tracking params.
// The query follows Go's url.ParseQuery + Values.Encode byte for byte, so a
// recorded Newsjack url_key and a key computed here agree on query-bearing
// URLs. Scheme, host, port and path still follow WHATWG URL parsing.
//
// Used by worker/fusion.js to group cluster members into the same story by
// normalized URL and to detect syndicated/duplicate links.

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_NAMES = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);
const QUERY_UNRESERVED = /^[A-Za-z0-9\-_.~]$/;
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

function isTrackingParam(name) {
  const lower = name.toLowerCase();
  if (TRACKING_PARAM_NAMES.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Query strings here are byte strings: one char per byte (code 0-255).
// WHATWG URL percent-encodes every non-ASCII character in `search`, so
// decoding its escapes yields the same bytes Go sees in RawQuery.

// Go url.QueryUnescape: "+" is a space; an invalid escape returns null.
function queryUnescape(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '+') {
      out += ' ';
    } else if (raw[i] === '%') {
      const hex = raw.slice(i + 1, i + 3);
      if (!HEX_PAIR.test(hex)) return null;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 2;
    } else {
      out += raw[i];
    }
  }
  return out;
}

// Go url.QueryEscape: keep A-Z a-z 0-9 - _ . ~, space becomes "+", every
// other byte becomes uppercase %XX.
function queryEscape(bytes) {
  let out = '';
  for (const ch of bytes) {
    if (ch === ' ') out += '+';
    else if (QUERY_UNRESERVED.test(ch)) out += ch;
    else out += `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

// Go url.ParseQuery, tracking-param deletion, then Values.Encode: pairs that
// contain ";" or an invalid escape are dropped, names sort bytewise, and
// repeated names keep their values in input order.
function encodeQuery(search) {
  const values = new Map();
  for (const pair of search.slice(1).split('&')) {
    if (pair === '' || pair.includes(';')) continue;
    const eq = pair.indexOf('=');
    const name = queryUnescape(eq === -1 ? pair : pair.slice(0, eq));
    const value = queryUnescape(eq === -1 ? '' : pair.slice(eq + 1));
    if (name === null || value === null || isTrackingParam(name)) continue;
    if (!values.has(name)) values.set(name, []);
    values.get(name).push(value);
  }
  return [...values.keys()]
    .sort()
    .flatMap((name) => values.get(name).map((value) => `${queryEscape(name)}=${queryEscape(value)}`))
    .join('&');
}

/**
 * Normalize a URL into a stable comparison key: lowercase scheme and host,
 * no fragment, no trailing slash, no tracking query parameters. Returns
 * null for inputs that cannot be parsed as a URL (never throws).
 */
export function normalizedURLKey(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port ? `:${parsed.port}` : '';

  let pathname = parsed.pathname || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Go keeps a lone trailing "?" (ForceQuery) when it is the only "?" before
  // the fragment; WHATWG reports that as an empty search.
  const head = rawUrl.trim().split('#', 1)[0];
  const forceQuery = head.indexOf('?') === head.length - 1;
  const encoded = encodeQuery(parsed.search);
  const query = encoded || forceQuery ? `?${encoded}` : '';

  return `${scheme}//${host}${port}${pathname}${query}`;
}

export default { normalizedURLKey };
