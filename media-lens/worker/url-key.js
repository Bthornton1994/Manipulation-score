// Ported from Newsjack (https://github.com/elvisun/newsjack) origin.go,
// commit bdb41b8, MIT License, Copyright (c) 2026 Elvis Sun.
// Adapted from Go to JavaScript; behavior (not code) is ported: lowercase
// scheme/host, drop fragment, trim trailing slash, strip tracking params.
//
// Used by worker/fusion.js to group cluster members into the same story by
// normalized URL and to detect syndicated/duplicate links.

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_NAMES = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);

function isTrackingParam(name) {
  const lower = name.toLowerCase();
  if (TRACKING_PARAM_NAMES.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
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

  const keptParams = [...parsed.searchParams.entries()].filter(([name]) => !isTrackingParam(name));
  keptParams.sort(([a], [b]) => a.localeCompare(b));
  const query = keptParams.length > 0 ? `?${keptParams.map(([k, v]) => `${k}=${v}`).join('&')}` : '';

  return `${scheme}//${host}${port}${pathname}${query}`;
}

export default { normalizedURLKey };
