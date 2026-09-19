// Address and URL policy for Media Lens live URL fetch (Issue #118).
//
// Fail closed. Every A/AAAA or literal is classified as allow_public or
// block. Known IPv4-in-IPv6 embeddings extract an IPv4 and reuse the IPv4
// table. Unknown embeddings and mixed public+private DNS answers are block.
// This module does no I/O.

export function taggedError(message, code) {
  return Object.assign(new Error(message), { code });
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// Four decimal octets, 0-255, no leading zeros (`127.0.0.1` yes; `0177.0.0.1` no).
const STRICT_IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// IDNA ASCII DNS names with at least one dot. Single-label hosts are denied.
const DNS_NAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const DENIED_EXACT_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.internal',
  'instance-data'
]);

// Loopback, RFC 1918, CGNAT, link-local (incl. 169.254.169.254 / 169.254.170.2),
// IETF protocol assignments, deprecated 6to4 anycast, benchmarking,
// this-network, multicast, reserved.
const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8, 'block_this_network'],
  ['10.0.0.0', 8, 'block_rfc1918'],
  ['100.64.0.0', 10, 'block_cgnat'],
  ['127.0.0.0', 8, 'block_loopback'],
  ['169.254.0.0', 16, 'block_link_local'],
  ['172.16.0.0', 12, 'block_rfc1918'],
  ['192.168.0.0', 16, 'block_rfc1918'],
  ['192.0.0.0', 24, 'block_ietf_protocol'],
  ['192.88.99.0', 24, 'block_6to4_anycast'],
  ['198.18.0.0', 15, 'block_benchmark'],
  ['224.0.0.0', 4, 'block_multicast'],
  ['240.0.0.0', 4, 'block_reserved']
];

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

function blockResult(reason, extra = {}) {
  return { disposition: 'block', reason, family: extra.family || 0, canonical: extra.canonical || null, embeddedIPv4: extra.embeddedIPv4 || null };
}

function allowResult(family, canonical, extra = {}) {
  return { disposition: 'allow_public', reason: extra.reason || 'allow_public', family, canonical, embeddedIPv4: extra.embeddedIPv4 || null };
}

export function stripIPv6Brackets(hostname) {
  if (typeof hostname !== 'string') return hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function canonicalizeIPv6Literal(ip) {
  try {
    return stripIPv6Brackets(new URL(`http://[${stripIPv6Brackets(ip)}]/`).hostname).toLowerCase();
  } catch {
    return null;
  }
}

function hextetToIPv4(hi, lo) {
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function parseDottedIPv4Hextets(dotted) {
  if (!STRICT_IPV4.test(dotted)) return null;
  const intIp = ipv4ToInt(dotted);
  if (intIp === null) return null;
  return [(intIp >>> 16) & 0xffff, intIp & 0xffff];
}

/**
 * Expand a canonical (WHATWG) IPv6 string into 8 16-bit words.
 * Unparsable input returns null (fail closed).
 */
export function expandIPv6(canonical) {
  if (typeof canonical !== 'string' || canonical.length === 0) return null;
  const raw = stripIPv6Brackets(canonical).toLowerCase();
  if (raw.includes(':::')) return null;
  const parts = raw.split('::');
  if (parts.length > 2) return null;

  function splitHextets(side) {
    if (!side) return [];
    const tokens = side.split(':');
    const words = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.includes('.')) {
        if (i !== tokens.length - 1) return null;
        const pair = parseDottedIPv4Hextets(token);
        if (!pair) return null;
        words.push(pair[0], pair[1]);
        continue;
      }
      if (token === '' || !/^[0-9a-f]{1,4}$/.test(token)) return null;
      const value = Number.parseInt(token, 16);
      if (!Number.isFinite(value) || value < 0 || value > 0xffff) return null;
      words.push(value);
    }
    return words;
  }

  const left = splitHextets(parts[0]);
  const right = parts.length === 2 ? splitHextets(parts[1]) : [];
  if (!left || !right) return null;
  const fill = 8 - left.length - right.length;
  if (parts.length === 2) {
    if (fill < 0) return null;
  } else if (fill !== 0) {
    return null;
  }
  const words = [...left, ...Array(Math.max(fill, 0)).fill(0), ...right];
  if (words.length !== 8) return null;
  return words;
}

function classifyIPv4(ip) {
  if (!STRICT_IPV4.test(ip)) {
    return blockResult('block_unparsable', { family: 4, canonical: ip });
  }
  const intIp = ipv4ToInt(ip);
  if (intIp === null) return blockResult('block_unparsable', { family: 4, canonical: ip });
  for (const [base, prefix, reason] of BLOCKED_IPV4_RANGES) {
    if (inCidr(intIp, base, prefix)) {
      return blockResult(reason, { family: 4, canonical: ip });
    }
  }
  return allowResult(4, ip);
}

function classifyEmbeddedIPv4(ipv4, family, canonical, embedding) {
  const inner = classifyIPv4(ipv4);
  if (inner.disposition === 'block') {
    return blockResult(`${inner.reason}_via_${embedding}`, {
      family,
      canonical,
      embeddedIPv4: ipv4
    });
  }
  return allowResult(family, canonical, { reason: `allow_public_via_${embedding}`, embeddedIPv4: ipv4 });
}

/**
 * RFC 6052 /48 IPv4 embed: bits 48–63 and 72–87, u-octet (bits 64–71) must be 0.
 * Returns null when u is nonzero (fail closed). Trailing suffix bits are ignored;
 * IPv4 policy then applies, matching well-known NAT64 /96.
 */
function ipv4FromRfc6052Slash48(words) {
  const u = (words[4] >> 8) & 0xff;
  if (u !== 0) return null;
  const hi = words[3];
  const lo = ((words[4] & 0xff) << 8) | ((words[5] >> 8) & 0xff);
  return hextetToIPv4(hi, lo);
}

function classifyIPv6(ip) {
  const canonical = canonicalizeIPv6Literal(ip);
  if (canonical === null) return blockResult('block_unparsable', { family: 6 });
  const words = expandIPv6(canonical);
  if (!words) return blockResult('block_unparsable', { family: 6, canonical });

  const allZero = words.every((w) => w === 0);
  if (allZero) return blockResult('block_unspecified', { family: 6, canonical });
  if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0 && words[6] === 0 && words[7] === 1) {
    return blockResult('block_loopback', { family: 6, canonical });
  }
  if ((words[0] & 0xffc0) === 0xfe80) return blockResult('block_link_local', { family: 6, canonical });
  if ((words[0] & 0xfe00) === 0xfc00) return blockResult('block_ula', { family: 6, canonical });
  if ((words[0] & 0xff00) === 0xff00) return blockResult('block_multicast', { family: 6, canonical });
  if (words[0] === 0x2001 && words[1] === 0xdb8) return blockResult('block_documentation', { family: 6, canonical });
  // IPv6 BMWG benchmarking 2001:2::/48 (RFC 5180). Not native unicast.
  if (words[0] === 0x2001 && words[1] === 0x0002) {
    return blockResult('block_benchmark', { family: 6, canonical });
  }
  // ORCHID 2001:10::/28 (RFC 4843) and ORCHIDv2 2001:20::/28 (RFC 7343).
  if (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0010) {
    return blockResult('block_orchid', { family: 6, canonical });
  }
  if (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0020) {
    return blockResult('block_orchid', { family: 6, canonical });
  }
  if (words[0] === 0x100 && words[1] === 0 && words[2] === 0 && words[3] === 0) {
    return blockResult('block_discard', { family: 6, canonical });
  }
  // Teredo (RFC 4380): 2001:0::/32. Do not decode the client IPv4.
  if (words[0] === 0x2001 && words[1] === 0) {
    return blockResult('block_teredo', { family: 6, canonical });
  }
  // 6to4: 2002::/16 → IPv4 from bits 16–47.
  if (words[0] === 0x2002) {
    return classifyEmbeddedIPv4(hextetToIPv4(words[1], words[2]), 6, canonical, '6to4');
  }
  // IPv4-mapped: ::ffff:0:0/96 → words[5] = 0xffff, words[0..4] = 0.
  if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff) {
    return classifyEmbeddedIPv4(hextetToIPv4(words[6], words[7]), 6, canonical, 'mapped');
  }
  // SIIT IPv4-translated: ::ffff:0:0:0/96 → words[4] = 0xffff, words[5] = 0.
  if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0xffff && words[5] === 0) {
    return classifyEmbeddedIPv4(hextetToIPv4(words[6], words[7]), 6, canonical, 'siit');
  }
  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052).
  if (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) {
    return classifyEmbeddedIPv4(hextetToIPv4(words[6], words[7]), 6, canonical, 'nat64');
  }
  // Local-use NAT64 64:ff9b:1::/48 (RFC 8215). IPv4 embed is RFC 6052 /48.
  if (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0x0001) {
    const ipv4 = ipv4FromRfc6052Slash48(words);
    if (!ipv4) {
      return blockResult('block_nat64_local_invalid', { family: 6, canonical });
    }
    return classifyEmbeddedIPv4(ipv4, 6, canonical, 'nat64_local');
  }
  // Remainder of 64:ff9b::/32: unknown NAT64 prefix. Not native unicast.
  // Classifier limit: network-specific NAT64 prefixes outside 64:ff9b::/32 are
  // not detected and may classify as native unicast.
  if (words[0] === 0x64 && words[1] === 0xff9b) {
    return blockResult('block_nat64_unknown', { family: 6, canonical });
  }
  // Deprecated IPv4-compatible ::/96 excluding :: and ::1 (already handled).
  if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) {
    return classifyEmbeddedIPv4(hextetToIPv4(words[6], words[7]), 6, canonical, 'compat96');
  }

  return allowResult(6, canonical);
}

/**
 * Classify a single address string. Unparsable → block.
 */
export function classifyIp(ip) {
  if (typeof ip !== 'string' || ip.trim() === '') {
    return blockResult('block_unparsable');
  }
  const bare = stripIPv6Brackets(ip.trim());
  if (bare.includes(':')) return classifyIPv6(bare);
  return classifyIPv4(bare);
}

export function isBlockedIp(ip) {
  return classifyIp(ip).disposition !== 'allow_public';
}

/**
 * True when two address strings name the same destination for pin checks.
 * IPv4 and its IPv4-mapped/SIIT/NAT64/compat/6to4 embeddings of that IPv4 match.
 */
export function ipIdentitiesEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ca = classifyIp(a);
  const cb = classifyIp(b);
  if (!ca.canonical || !cb.canonical) return false;
  const a4 = ca.embeddedIPv4 || (ca.family === 4 ? ca.canonical : null);
  const b4 = cb.embeddedIPv4 || (cb.family === 4 ? cb.canonical : null);
  if (a4 && b4) return a4 === b4;
  if (ca.family === 6 && cb.family === 6) return ca.canonical === cb.canonical;
  return false;
}

export function isDeniedSpecialHost(hostname) {
  const host = stripIPv6Brackets(String(hostname || '')).toLowerCase();
  if (DENIED_EXACT_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;
  return false;
}

export function isStrictIPv4(hostname) {
  return STRICT_IPV4.test(hostname);
}

function hasC0Controls(value) {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 32) return true;
  }
  return false;
}

function authorityHostAsWritten(urlString) {
  const schemeIdx = urlString.indexOf('://');
  if (schemeIdx === -1) return null;
  let rest = urlString.slice(schemeIdx + 3);
  const end = rest.search(/[/?#]/);
  if (end !== -1) rest = rest.slice(0, end);
  const at = rest.lastIndexOf('@');
  if (at !== -1) rest = rest.slice(at + 1);
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close === -1) return null;
    return rest.slice(0, close + 1);
  }
  const colon = rest.lastIndexOf(':');
  if (colon !== -1 && /^\d+$/.test(rest.slice(colon + 1))) {
    return rest.slice(0, colon);
  }
  return rest;
}

function hostsMatchWritten(written, parsedHostname) {
  if (!written) return false;
  const w = written.toLowerCase();
  const p = String(parsedHostname).toLowerCase();
  if (w === p) return true;
  if (w.startsWith('[') || p.startsWith('[') || w.includes(':') || p.includes(':')) {
    const cw = canonicalizeIPv6Literal(w);
    const cp = canonicalizeIPv6Literal(p);
    return cw !== null && cw === cp;
  }
  return false;
}

/**
 * Parse and reject unsafe article URLs before DNS. Does not classify the
 * destination address (callers pin after this).
 */
export function parseArticleUrl(targetUrl) {
  if (typeof targetUrl !== 'string' || targetUrl === '') {
    throw taggedError('Not a valid URL', 'BAD_URL');
  }
  if (hasC0Controls(targetUrl) || targetUrl !== targetUrl.trim()) {
    throw taggedError('Not a valid URL', 'BAD_URL');
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw taggedError(`Not a valid URL: ${targetUrl}`, 'BAD_URL');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw taggedError('URLs with userinfo are not allowed', 'BAD_URL');
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw taggedError(`Only http/https URLs are allowed, got ${parsed.protocol}`, 'BAD_SCHEME');
  }
  if (!parsed.hostname) {
    throw taggedError(`Not a valid URL: ${targetUrl}`, 'BAD_URL');
  }

  const writtenHost = authorityHostAsWritten(targetUrl);
  if (!hostsMatchWritten(writtenHost, parsed.hostname)) {
    // WHATWG canonicalizes exotic IPv4 (octal, hex, decimal, short) to
    // dotted-decimal. Accept that rewrite only; IPv4 policy applies below.
    if (!isStrictIPv4(parsed.hostname)) {
      throw taggedError('URL host was rewritten from an exotic form and is rejected', 'BAD_URL');
    }
  }

  const bareHost = stripIPv6Brackets(parsed.hostname).toLowerCase();
  if (isDeniedSpecialHost(bareHost)) {
    throw taggedError(`Blocked host: ${parsed.hostname}`, 'BLOCKED_HOST');
  }

  const isIpv6Literal = parsed.hostname.startsWith('[');
  if (isIpv6Literal) {
    const classified = classifyIp(bareHost);
    if (classified.disposition !== 'allow_public') {
      throw taggedError(`Blocked host: ${parsed.hostname}`, 'BLOCKED_HOST');
    }
    return { parsed, bareHost, kind: 'ipv6', classified };
  }
  if (isStrictIPv4(bareHost)) {
    const classified = classifyIp(bareHost);
    if (classified.disposition !== 'allow_public') {
      throw taggedError(`Blocked host: ${parsed.hostname}`, 'BLOCKED_HOST');
    }
    return { parsed, bareHost, kind: 'ipv4', classified };
  }
  if (!DNS_NAME.test(bareHost)) {
    throw taggedError(`Not a valid URL host: ${parsed.hostname}`, 'BAD_URL');
  }

  return { parsed, bareHost, kind: 'dns', classified: null };
}

export const ALLOWED_SCHEMES_SET = ALLOWED_SCHEMES;
