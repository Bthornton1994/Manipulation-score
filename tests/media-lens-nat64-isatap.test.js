// Issue #118 remediation B: NAT64 / ISATAP address-policy fail-closed.
// Table-driven regressions for embeddings that previously classified as
// public native unicast. Assert BLOCKED_HOST before connect.
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

// Forms that classified as allow_public before remediation B, plus the
// well-known NAT64 public exception from architecture §6.
const NAT64_ISATAP_TABLE = [
  {
    id: 'nat64-wk-public',
    ip: '64:ff9b::cb00:7107',
    disposition: 'allow_public',
    reason: 'allow_public_via_nat64',
    embeddedIPv4: '203.0.113.7'
  },
  {
    id: 'nat64-wk-public-dotted',
    ip: '64:ff9b::203.0.113.7',
    disposition: 'allow_public',
    reason: 'allow_public_via_nat64',
    embeddedIPv4: '203.0.113.7'
  },
  {
    id: 'nat64-wk-loopback',
    ip: '64:ff9b::7f00:1',
    disposition: 'block',
    reason: 'block_loopback_via_nat64',
    embeddedIPv4: '127.0.0.1'
  },
  {
    id: 'nat64-local-public',
    ip: '64:ff9b:1:cb00:71:700::',
    disposition: 'block',
    reason: 'block_nat64_local',
    embeddedIPv4: '203.0.113.7'
  },
  {
    id: 'nat64-local-loopback',
    ip: '64:ff9b:1:7f00:0:100::',
    disposition: 'block',
    reason: 'block_loopback_via_nat64_local',
    embeddedIPv4: '127.0.0.1'
  },
  {
    id: 'nat64-unknown-ff9b-32',
    ip: '64:ff9b:2::1',
    disposition: 'block',
    reason: 'block_nat64_unknown',
    embeddedIPv4: null
  },
  {
    id: 'nat64-extra-sparse-loopback',
    ip: '2001:470:1::7f00:1',
    disposition: 'block',
    reason: 'block_loopback_via_nat64_extra',
    embeddedIPv4: '127.0.0.1'
  },
  {
    id: 'nat64-extra-sparse-imds',
    ip: '2001:470:1::a9fe:a9fe',
    disposition: 'block',
    reason: 'block_link_local_via_nat64_extra',
    embeddedIPv4: '169.254.169.254'
  },
  {
    id: 'nat64-extra-sparse-rfc1918',
    ip: '2001:67c:27e4::a00:1',
    disposition: 'block',
    reason: 'block_rfc1918_via_nat64_extra',
    embeddedIPv4: '10.0.0.1'
  },
  {
    id: 'nat64-extra-sparse-public',
    ip: '2001:470:1::cb00:7107',
    disposition: 'block',
    reason: 'block_nat64_extra',
    embeddedIPv4: '203.0.113.7'
  },
  {
    id: 'nat64-extra-nonzero-64-95-loopback',
    ip: '2001:67c:27e4:64:ff:9b:7f00:1',
    disposition: 'block',
    reason: 'block_loopback_via_nat64_extra',
    embeddedIPv4: '127.0.0.1'
  },
  {
    id: 'nat64-extra-nonzero-64-95-imds',
    ip: '2606:4700:4700:1:2:3:a9fe:a9fe',
    disposition: 'block',
    reason: 'block_link_local_via_nat64_extra',
    embeddedIPv4: '169.254.169.254'
  },
  {
    id: 'nat64-extra-nonzero-64-95-rfc1918-10',
    ip: '2001:470:1:2:3:4:a00:1',
    disposition: 'block',
    reason: 'block_rfc1918_via_nat64_extra',
    embeddedIPv4: '10.0.0.1'
  },
  {
    id: 'nat64-extra-nonzero-64-95-rfc1918-192',
    ip: '2a00:1450:4001:80e:1:2:c0a8:101',
    disposition: 'block',
    reason: 'block_rfc1918_via_nat64_extra',
    embeddedIPv4: '192.168.1.1'
  },
  {
    id: 'nat64-extra-nonzero-64-95-public',
    ip: '2001:67c:27e4:64:ff:9b:cb00:7107',
    disposition: 'block',
    reason: 'block_nat64_extra',
    embeddedIPv4: '203.0.113.7'
  },
  {
    id: 'isatap-loopback',
    ip: '2001:470:1:2:0:5efe:7f00:1',
    disposition: 'block',
    reason: 'block_loopback_via_isatap',
    embeddedIPv4: '127.0.0.1'
  },
  {
    id: 'isatap-loopback-dotted',
    ip: '2001:470:1:2:0:5efe:127.0.0.1',
    disposition: 'block',
    reason: 'block_loopback_via_isatap',
    embeddedIPv4: '127.0.0.1'
  },
  {
    id: 'isatap-rfc1918',
    ip: '2001:470:1:2:0:5efe:a00:1',
    disposition: 'block',
    reason: 'block_rfc1918_via_isatap',
    embeddedIPv4: '10.0.0.1'
  },
  {
    id: 'isatap-rfc1918-dotted',
    ip: '2001:470:1:2:0:5efe:10.0.0.1',
    disposition: 'block',
    reason: 'block_rfc1918_via_isatap',
    embeddedIPv4: '10.0.0.1'
  },
  {
    id: 'isatap-imds-ulbit',
    ip: '2001:470:1:2:200:5efe:a9fe:a9fe',
    disposition: 'block',
    reason: 'block_link_local_via_isatap',
    embeddedIPv4: '169.254.169.254'
  },
  {
    id: 'isatap-public',
    ip: '2001:470:1:2:0:5efe:cb00:7107',
    disposition: 'block',
    reason: 'block_isatap',
    embeddedIPv4: '203.0.113.7'
  }
];

const NATIVE_UNICAST_STILL_PUBLIC = [
  '2001:4860:4860::8888',
  '2606:4700:4700::1111',
  '2001:470:8:f00::1',
  '2a00:1450:4001:80e::200e'
];

test('NAT64/ISATAP disposition table matches architecture §6', () => {
  for (const row of NAT64_ISATAP_TABLE) {
    const result = classifyIp(row.ip);
    assert.equal(result.disposition, row.disposition, `${row.id} ${row.ip} disposition`);
    assert.equal(result.reason, row.reason, `${row.id} ${row.ip} reason`);
    assert.equal(result.embeddedIPv4, row.embeddedIPv4, `${row.id} ${row.ip} embedded IPv4`);
  }
});

test('custom NAT64 /96 with non-zero bits 64–95 fail closed with lookups=0 and connects=0', async () => {
  const residual = NAT64_ISATAP_TABLE.filter((row) => row.id.startsWith('nat64-extra-nonzero-64-95-'));
  assert.equal(residual.length, 5);
  for (const row of residual) {
    const words = row.ip.split(':');
    assert.ok(words.length === 8, row.ip);
    assert.notEqual(Number.parseInt(words[4], 16), 0, `${row.ip} bits 64–79`);
    assert.notEqual(Number.parseInt(words[5], 16), 0, `${row.ip} bits 80–95`);

    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely(`http://[${row.ip}]/article`, {
          timeoutMs: 200,
          maxBytes: 1000,
          lookupImpl: async () => {
            lookups += 1;
            throw new Error(`must not lookup residual ${row.id}`);
          },
          requestImpl: async () => {
            connects += 1;
            throw new Error(`must not connect residual ${row.id}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      row.id
    );
    assert.equal(lookups, 0, `${row.id} lookups`);
    assert.equal(connects, 0, `${row.id} connects`);
  }
});

test('DNS answers that include custom NAT64 /96 with non-zero bits 64–95 fail closed with connects=0', async () => {
  const residual = NAT64_ISATAP_TABLE.filter((row) => row.id.startsWith('nat64-extra-nonzero-64-95-'));
  for (const row of residual) {
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
            throw new Error(`must not connect mixed residual ${row.id}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      row.id
    );
    assert.equal(lookups, 1, `${row.id} mixed DNS lookups`);
    assert.equal(connects, 0, `${row.id} mixed DNS connects`);
  }
});

test('native IPv6 unicast with a last-hextet form is not treated as extra NAT64', () => {
  for (const ip of NATIVE_UNICAST_STILL_PUBLIC) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'allow_public', ip);
    assert.equal(result.reason, 'allow_public', ip);
    assert.equal(result.embeddedIPv4, null, ip);
  }
});

test('well-known mapped/SIIT/6to4/compat public embeddings remain allow_public', () => {
  const allowed = [
    ['::ffff:203.0.113.7', 'allow_public_via_mapped', '203.0.113.7'],
    ['::ffff:0:cb00:7107', 'allow_public_via_siit', '203.0.113.7'],
    ['::cb00:7107', 'allow_public_via_compat96', '203.0.113.7'],
    ['2002:cb00:7107::', 'allow_public_via_6to4', '203.0.113.7']
  ];
  for (const [ip, reason, v4] of allowed) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'allow_public', ip);
    assert.equal(result.reason, reason, ip);
    assert.equal(result.embeddedIPv4, v4, ip);
  }
});

test('blocked NAT64/ISATAP literals fail closed before connect', async () => {
  const blocked = NAT64_ISATAP_TABLE.filter((row) => row.disposition === 'block');
  for (const row of blocked) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely(`http://[${row.ip}]/`, {
          timeoutMs: 200,
          maxBytes: 1000,
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

test('well-known public NAT64 may connect; extra/ISATAP public embeddings must not', async () => {
  const fetched = await fetchArticleSafely('http://[64:ff9b::cb00:7107]/article', {
    timeoutMs: 500,
    maxBytes: 4000,
    requestImpl: async ({ pin }) => {
      assert.equal(pin.address, '64:ff9b::cb00:7107');
      return htmlResponse(pin);
    }
  });
  assert.match(fetched.html, /Public article fixture/);

  for (const ip of [
    '64:ff9b:1:cb00:71:700::',
    '2001:470:1::cb00:7107',
    '2001:470:1:2:0:5efe:cb00:7107',
    '2001:67c:27e4:64:ff:9b:cb00:7107'
  ]) {
    let called = false;
    await assert.rejects(
      () =>
        fetchArticleSafely(`http://[${ip}]/`, {
          timeoutMs: 200,
          maxBytes: 1000,
          requestImpl: async () => {
            called = true;
            throw new Error('must not connect');
          }
        }),
      hasCode('BLOCKED_HOST'),
      ip
    );
    assert.equal(called, false, ip);
  }
});

test('redirects to NAT64 extra / ISATAP are BLOCKED_HOST before the second connect', async () => {
  const start = 'http://203.0.113.7/start';
  const locations = [
    'http://[2001:470:1:2:0:5efe:7f00:1]/',
    'http://[2001:470:1:2:0:5efe:10.0.0.1]/',
    'http://[2001:470:1:2:200:5efe:a9fe:a9fe]/',
    'http://[2001:470:1::7f00:1]/',
    'http://[2001:470:1::cb00:7107]/',
    'http://[64:ff9b:1:cb00:71:700::]/',
    'http://[2001:67c:27e4:64:ff:9b:7f00:1]/',
    'http://[2606:4700:4700:1:2:3:a9fe:a9fe]/',
    'http://[2001:470:1:2:3:4:a00:1]/',
    'http://[2a00:1450:4001:80e:1:2:c0a8:101]/',
    'http://[2001:67c:27e4:64:ff:9b:cb00:7107]/'
  ];
  for (const location of locations) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely(start, {
          timeoutMs: 1000,
          maxBytes: 4000,
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

  let downgradeConnects = 0;
  await assert.rejects(
    () =>
      fetchArticleSafely('https://203.0.113.7/start', {
        timeoutMs: 1000,
        maxBytes: 1000,
        requestImpl: async ({ pin }) => {
          downgradeConnects += 1;
          return redirectResponse(pin, 'http://203.0.113.8/');
        }
      }),
    hasCode('REDIRECT_DOWNGRADE')
  );
  assert.equal(downgradeConnects, 1);
});

test('hop-scoped allowlist, pin lookup, and classifier.dev redirect:manual remain in source', async () => {
  const fetchSrc = await readFile('media-lens/worker/safe-fetch.js', 'utf8');
  assert.match(fetchSrc, /hostIsAllowlisted/);
  assert.match(fetchSrc, /REDIRECT_DOWNGRADE/);
  assert.match(fetchSrc, /pinHost/);
  assert.match(fetchSrc, /makePinnedLookup|performPinnedGet/);

  const pinSrc = await readFile('media-lens/worker/pinned-http.js', 'utf8');
  assert.match(pinSrc, /makePinnedLookup/);
  assert.match(pinSrc, /PIN_MISMATCH/);

  const adapterSrc = await readFile('media-lens/worker/adapters/classifier-dev.js', 'utf8');
  assert.match(adapterSrc, /redirect:\s*FETCH_REDIRECT_MODE|redirect:\s*'manual'/);
  assert.match(adapterSrc, /redirect_rejected/);

  const contractSrc = await readFile('media-lens/worker/classifier-dev/contract.js', 'utf8');
  assert.match(contractSrc, /FETCH_REDIRECT_MODE\s*=\s*'manual'/);
});

test('live flags remain disabled by default', () => {
  const config = loadConfig({});
  assert.equal(config.liveEnabled, false);
  assert.equal(config.liveUrlEnabled, false);
  assert.equal(config.classifierDev.enabled, false);
  const flags = effectiveLiveFlags(config);
  assert.equal(flags.liveEnabled, false);
  assert.equal(flags.liveUrlEnabled, false);
});
