// Hostname helpers for live-URL rate limits and redacted audit lines.
// Never returns credentials, query strings, or paths. IP literals are not
// used as audit host_key values (avoids logging operator LAN layout).

const STRICT_IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// Small multi-part public-suffix list. This is not the Public Suffix List.
// Rate limits still also key on the full hostname.
const MULTI_PART_SUFFIXES = new Set([
  'ac.uk',
  'co.in',
  'co.jp',
  'co.kr',
  'co.nz',
  'co.uk',
  'co.za',
  'com.ar',
  'com.au',
  'com.br',
  'com.mx',
  'com.tr',
  'gov.uk',
  'net.au',
  'org.au',
  'org.uk'
]);

export function stripIPv6Brackets(hostname) {
  if (typeof hostname !== 'string') return '';
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1);
  return hostname;
}

export function isIpLiteralHost(hostname) {
  const host = stripIPv6Brackets(hostname).toLowerCase();
  if (!host) return false;
  if (STRICT_IPV4.test(host)) return true;
  return host.includes(':');
}

/**
 * Rate-limit key for a hostname: exact lowercase host, plus a registrable
 * approximation for DNS names so a.example.com and b.example.com share a
 * budget. IP literals use the literal (not logged).
 */
export function rateLimitHostKeys(hostname) {
  const host = stripIPv6Brackets(hostname).toLowerCase();
  if (!host) return ['unknown'];
  const keys = [`host:${host}`];
  if (!isIpLiteralHost(host)) {
    const registrable = registrableHostKey(host);
    if (registrable && registrable !== host) keys.push(`apex:${registrable}`);
  }
  return keys;
}

export function registrableHostKey(hostname) {
  const host = stripIPv6Brackets(hostname).toLowerCase();
  if (!host || isIpLiteralHost(host)) return null;
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Fields safe to put on an audit event for a user-supplied URL.
 * Never includes userinfo, path, query, fragment, or IP literals.
 */
export function safeUrlAuditFields(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl === '') {
    return { host_kind: 'missing' };
  }
  try {
    const parsed = new URL(rawUrl);
    const scheme = (parsed.protocol || '').replace(/:$/, '');
    const host = stripIPv6Brackets(parsed.hostname).toLowerCase();
    if (!host) return { scheme, host_kind: 'unparseable' };
    if (isIpLiteralHost(host)) return { scheme, host_kind: 'ip_literal' };
    const host_key = registrableHostKey(host);
    if (!host_key) return { scheme, host_kind: 'dns' };
    return { scheme, host_kind: 'dns', host_key };
  } catch {
    return { host_kind: 'unparseable' };
  }
}

export function parseHostnameAllowlist(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((part) => stripIPv6Brackets(part.trim()).toLowerCase())
    .filter(Boolean);
}

export function hostIsAllowlisted(hostname, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  const host = stripIPv6Brackets(hostname).toLowerCase();
  return allowlist.includes(host);
}
