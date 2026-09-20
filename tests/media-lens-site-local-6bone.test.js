// Issue #118 Independent QA Medium M1 / Low L1 at 8008054.
// Deprecated site-local fec0::/10 (RFC 3879) and retired 6bone 3ffe::/16
// must fail closed before connect. These classified as allow_public before
// this remediation. Table-driven: FAIL without the fix, PASS with it.
// Local mocks only. Live URL flags stay off. No TypeSafe key.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  fetchArticleSafely,
  classifyIp,
  parseArticleUrl
} from '../media-lens/worker/safe-fetch.js';
import { loadConfig, effectiveLiveFlags } from '../media-lens/worker/config.js';

function hasCode(code) {
  return (err) => err.code === code;
}

function htmlResponse(pin, html = '<!doctype html><html><body><p>Public article fixture.</p></body></html>') {
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    rawHeaders: ['Content-Type', 'text/html'],
    remoteAddress: pin.address,
    body: html
  };
}

function redirectResponse(pin, location, status = 302) {
  return {
    status,
    headers: { location },
    rawHeaders: ['Location', location],
    remoteAddress: pin.address,
    body: ''
  };
}

// Addresses that classified as allow_public before M1/L1, plus prefix
// boundaries. Last-32-bit public-looking forms stay site-local/6bone
// (not extra NAT64) because the special-use prefix is checked first.
const SITE_LOCAL_6BONE_TABLE = [
  {
    id: 'v6-site-local',
    ip: 'fec0::1',
    disposition: 'block',
    reason: 'block_site_local',
    embeddedIPv4: null
  },
  {
    id: 'v6-site-local-unspec-iid',
    ip: 'fec0::',
    disposition: 'block',
    reason: 'block_site_local',
    embeddedIPv4: null
  },
  {
    id: 'v6-site-local-end',
    ip: 'feff::1',
    disposition: 'block',
    reason: 'block_site_local',
    embeddedIPv4: null
  },
  {
    id: 'v6-site-local-uppercase',
    ip: 'FEC0::1',
    disposition: 'block',
    reason: 'block_site_local',
    embeddedIPv4: null
  },
  {
    id: 'v6-site-local-public-looking-tail',
    ip: 'fec0::cb00:7107',
    disposition: 'block',
    reason: 'block_site_local',
    embeddedIPv4: null
  },
  {
    id: 'v6-6bone',
    ip: '3ffe::1',
    disposition: 'block',
    reason: 'block_6bone',
    embeddedIPv4: null
  },
  {
    id: 'v6-6bone-end',
    ip: '3ffe:ffff::1',
    disposition: 'block',
    reason: 'block_6bone',
    embeddedIPv4: null
  },
  {
    id: 'v6-6bone-public-looking-tail',
    ip: '3ffe::cb00:7107',
    disposition: 'block',
    reason: 'block_6bone',
    embeddedIPv4: null
  }
];

const NAT64_ISATAP_MAPPED_UNCHANGED = [
  ['64:ff9b::cb00:7107', 'allow_public', 'allow_public_via_nat64', '203.0.113.7'],
  ['64:ff9b::7f00:1', 'block', 'block_loopback_via_nat64', '127.0.0.1'],
  ['64:ff9b:1:cb00:71:700::', 'block', 'block_nat64_local', '203.0.113.7'],
  ['2001:470:1::cb00:7107', 'block', 'block_nat64_extra', '203.0.113.7'],
  ['2001:470:1:2:0:5efe:cb00:7107', 'block', 'block_isatap', '203.0.113.7'],
  ['::ffff:203.0.113.7', 'allow_public', 'allow_public_via_mapped', '203.0.113.7'],
  ['::ffff:0:cb00:7107', 'allow_public', 'allow_public_via_siit', '203.0.113.7'],
  ['::cb00:7107', 'allow_public', 'allow_public_via_compat96', '203.0.113.7'],
  ['2001:4860:4860::8888', 'allow_public', 'allow_public', null]
];

test('site-local fec0::/10 and 6bone 3ffe::/16 disposition table', () => {
  for (const row of SITE_LOCAL_6BONE_TABLE) {
    const result = classifyIp(row.ip);
    assert.equal(result.disposition, row.disposition, `${row.id} ${row.ip} disposition`);
    assert.equal(result.reason, row.reason, `${row.id} ${row.ip} reason`);
    assert.equal(result.embeddedIPv4, row.embeddedIPv4, `${row.id} ${row.ip} embedded IPv4`);
    assert.equal(result.family, 6, row.id);
  }
});

test('adjacent prefixes stay distinct from site-local and 6bone', () => {
  const linkLocalEnd = classifyIp('febf::1');
  assert.equal(linkLocalEnd.disposition, 'block');
  assert.equal(linkLocalEnd.reason, 'block_link_local');

  const ula = classifyIp('fc00::1');
  assert.equal(ula.disposition, 'block');
  assert.equal(ula.reason, 'block_ula');

  const notSixbone = classifyIp('3fff::1');
  assert.equal(notSixbone.disposition, 'allow_public', '3fff::1 is outside 3ffe::/16');
  assert.equal(notSixbone.reason, 'allow_public');
  assert.equal(notSixbone.embeddedIPv4, null);
});

test('NAT64/ISATAP/mapped/SIIT/compat96 from #130 stay unchanged', () => {
  for (const [ip, disposition, reason, embeddedIPv4] of NAT64_ISATAP_MAPPED_UNCHANGED) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, disposition, ip);
    assert.equal(result.reason, reason, ip);
    assert.equal(result.embeddedIPv4, embeddedIPv4, ip);
  }
});

test('site-local and 6bone literals fail closed before connect with empty allowlist', async () => {
  const blocked = SITE_LOCAL_6BONE_TABLE.filter((row) => row.disposition === 'block');
  for (const row of blocked) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely(`http://[${row.ip}]/`, {
          timeoutMs: 200,
          maxBytes: 1000,
          urlAllowlist: [],
          lookupImpl: async () => {
            lookups += 1;
            throw new Error(`must not lookup for ${row.id}`);
          },
          requestImpl: async () => {
            connects += 1;
            throw new Error(`must not connect for ${row.id}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      row.id
    );
    assert.equal(lookups, 0, `${row.id} lookups`);
    assert.equal(connects, 0, `${row.id} connects`);
    assert.throws(() => parseArticleUrl(`http://[${row.ip}]/article`), hasCode('BLOCKED_HOST'), row.id);
  }
});

test('non-empty DNS allowlist still fail-closes site-local and 6bone IP literals', async () => {
  for (const ip of ['fec0::1', '3ffe::1']) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely(`http://[${ip}]/`, {
          timeoutMs: 200,
          maxBytes: 1000,
          urlAllowlist: ['allowed.example'],
          lookupImpl: async () => {
            lookups += 1;
            throw new Error(`must not lookup for ${ip}`);
          },
          requestImpl: async () => {
            connects += 1;
            throw new Error(`must not connect for ${ip}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      ip
    );
    assert.equal(lookups, 0, `${ip} lookups`);
    assert.equal(connects, 0, `${ip} connects`);
  }
});

test('DNS AAAA site-local or 6bone fails closed even when mixed with public A', async () => {
  for (const row of [
    { id: 'mixed-aaaa-site-local', ip: 'fec0::1' },
    { id: 'mixed-aaaa-6bone', ip: '3ffe::1' }
  ]) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely('http://dual.example/x', {
          timeoutMs: 500,
          maxBytes: 1000,
          lookupImpl: async () => {
            lookups += 1;
            return [
              { address: '203.0.113.7', family: 4 },
              { address: row.ip, family: 6 }
            ];
          },
          requestImpl: async () => {
            connects += 1;
            throw new Error(`must not connect mixed ${row.id}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      row.id
    );
    assert.equal(lookups, 1, `${row.id} mixed DNS lookups`);
    assert.equal(connects, 0, `${row.id} mixed DNS connects`);
  }
});

test('allowlisted DNS name that resolves only to site-local or 6bone is BLOCKED_HOST', async () => {
  for (const ip of ['fec0::1', '3ffe::1']) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely('http://allowed.example/article', {
          timeoutMs: 500,
          maxBytes: 1000,
          urlAllowlist: ['allowed.example'],
          lookupImpl: async () => {
            lookups += 1;
            return [{ address: ip, family: 6 }];
          },
          requestImpl: async () => {
            connects += 1;
            throw new Error(`must not connect allowlisted ${ip}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      ip
    );
    assert.equal(lookups, 1, `${ip} lookups`);
    assert.equal(connects, 0, `${ip} connects`);
  }
});

test('redirects to site-local or 6bone are BLOCKED_HOST before the second connect', async () => {
  const start = 'http://203.0.113.7/start';
  const locations = ['http://[fec0::1]/', 'http://[feff::1]/', 'http://[3ffe::1]/', 'http://[3ffe:ffff::1]/'];
  for (const location of locations) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely(start, {
          timeoutMs: 1000,
          maxBytes: 4000,
          urlAllowlist: [],
          lookupImpl: async () => {
            lookups += 1;
            throw new Error(`must not lookup for ${location}`);
          },
          requestImpl: async ({ parsed, pin }) => {
            connects += 1;
            if (parsed.pathname === '/start') return redirectResponse(pin, location);
            throw new Error(`second connect must not run for ${location}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      location
    );
    assert.equal(lookups, 0, `${location} lookups`);
    assert.equal(connects, 1, `${location} must stop after hop 1`);
  }
});

test('well-known public NAT64 may still connect after site-local/6bone remediation', async () => {
  const fetched = await fetchArticleSafely('http://[64:ff9b::cb00:7107]/article', {
    timeoutMs: 500,
    maxBytes: 4000,
    requestImpl: async ({ pin }) => {
      assert.equal(pin.address, '64:ff9b::cb00:7107');
      return htmlResponse(pin);
    }
  });
  assert.match(fetched.html, /Public article fixture/);
});

test('architecture and README name fec0::/10 and 3ffe::/16 as fail-closed', async () => {
  const architecture = await readFile('docs/media-lens-live-url-v2-architecture.md', 'utf8');
  const readme = await readFile('media-lens/README.md', 'utf8');
  const plan = await readFile('docs/media-lens-live-url-v2-implementation-plan.md', 'utf8');
  for (const [path, content] of [
    ['architecture', architecture],
    ['readme', readme],
    ['plan', plan]
  ]) {
    assert.match(content, /fec0::\/10/, path);
    assert.match(content, /3ffe::\/16/, path);
  }
  assert.match(architecture, /RFC 3879/);
  assert.match(plan, /v6-site-local/);
  assert.match(plan, /v6-6bone/);
});

test('live flags remain disabled by default', () => {
  const config = loadConfig({});
  assert.equal(config.liveEnabled, false);
  assert.equal(config.liveUrlEnabled, false);
  assert.equal(config.classifierDev.enabled, false);
  const flags = effectiveLiveFlags(config);
  assert.equal(flags.liveEnabled, false);
  assert.equal(flags.liveUrlEnabled, false);
  assert.equal(flags.classifierDevEnabled, false);
});
