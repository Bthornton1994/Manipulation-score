// Phase 2: narrow nat64_extra — legitimate global IPv6 with public last-32
// (Cloudflare-style dual-stack embed) must be allow_public. Private-looking
// last-32 residual remains fail-closed. Local mocks only; live flags off.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIp } from '../media-lens/worker/address-policy.js';
import { pinHost } from '../media-lens/worker/safe-fetch.js';

// Live example.com AAAA observed 2026-09-20 (Cloudflare dual-stack embed).
const CLOUDFLARE_EXAMPLE_AAAA = [
  {
    id: 'example-com-aaaa-6814',
    ip: '2606:4700:10::6814:179a',
    last32: '104.20.23.154'
  },
  {
    id: 'example-com-aaaa-ac42',
    ip: '2606:4700:10::ac42:93f3',
    last32: '172.66.147.243'
  }
];

const PUBLIC_LAST32_NATIVE = [
  ...CLOUDFLARE_EXAMPLE_AAAA.map((r) => r.ip),
  '2606:4700::6810:84e5', // cloudflare.com-style
  '2600:1f18:243e:2e00:1234:5678:9abc:def0', // public last-32 random IID
  '2001:470:1::cb00:7107', // was block_nat64_extra; public TEST-NET last-32
  '2001:67c:27e4:64:ff:9b:cb00:7107'
];

const BLOCKED_LAST32_RESIDUAL = [
  {
    id: 'sparse-loopback',
    ip: '2001:470:1::7f00:1',
    reason: 'block_loopback_via_nat64_extra',
    embeddedIPv4: '127.0.0.1'
  },
  {
    id: 'sparse-imds',
    ip: '2001:470:1::a9fe:a9fe',
    reason: 'block_link_local_via_nat64_extra',
    embeddedIPv4: '169.254.169.254'
  },
  {
    id: 'sparse-rfc1918',
    ip: '2001:67c:27e4::a00:1',
    reason: 'block_rfc1918_via_nat64_extra',
    embeddedIPv4: '10.0.0.1'
  },
  {
    id: 'nonzero-rfc1918-192',
    ip: '2a00:1450:4001:80e:1:2:c0a8:101',
    reason: 'block_rfc1918_via_nat64_extra',
    embeddedIPv4: '192.168.1.1'
  }
];

test('Cloudflare example.com AAAA (public last-32) is native allow_public', () => {
  for (const row of CLOUDFLARE_EXAMPLE_AAAA) {
    const result = classifyIp(row.ip);
    assert.equal(result.disposition, 'allow_public', row.id);
    assert.equal(result.reason, 'allow_public', row.id);
    assert.equal(result.embeddedIPv4, null, row.id);
    assert.equal(result.canonical, row.ip, row.id);
    // Sanity: last-32 equals the dual-stack A, but must not be treated as NAT64.
    assert.equal(classifyIp(row.last32).disposition, 'allow_public', row.last32);
  }
});

test('public last-32 under global prefixes is not block_nat64_extra', () => {
  for (const ip of PUBLIC_LAST32_NATIVE) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'allow_public', ip);
    assert.equal(result.reason, 'allow_public', ip);
    assert.equal(result.embeddedIPv4, null, ip);
  }
});

test('blocked last-32 residual still fail-closed as nat64_extra', () => {
  for (const row of BLOCKED_LAST32_RESIDUAL) {
    const result = classifyIp(row.ip);
    assert.equal(result.disposition, 'block', row.id);
    assert.equal(result.reason, row.reason, row.id);
    assert.equal(result.embeddedIPv4, row.embeddedIPv4, row.id);
  }
});

test('pinHost accepts example.com dual-stack mock (public A + CF AAAA)', async () => {
  const pin = await pinHost('example.com', {
    lookupImpl: async () => [
      { address: '172.66.147.243', family: 4 },
      { address: '104.20.23.154', family: 4 },
      { address: '2606:4700:10::6814:179a', family: 6 },
      { address: '2606:4700:10::ac42:93f3', family: 6 }
    ]
  });
  assert.ok(pin.address);
  assert.ok(pin.family === 4 || pin.family === 6);
});

test('known NAT64 / mapped / ISATAP protections unchanged', () => {
  assert.equal(classifyIp('64:ff9b::cb00:7107').reason, 'allow_public_via_nat64');
  assert.equal(classifyIp('64:ff9b::7f00:1').reason, 'block_loopback_via_nat64');
  assert.equal(classifyIp('64:ff9b:1:cb00:71:700::').reason, 'block_nat64_local');
  assert.equal(classifyIp('64:ff9b:2::1').reason, 'block_nat64_unknown');
  assert.equal(classifyIp('::ffff:127.0.0.1').reason, 'block_loopback_via_mapped');
  assert.equal(classifyIp('2001:470:1:2:0:5efe:7f00:1').reason, 'block_loopback_via_isatap');
  assert.equal(classifyIp('2001:470:1:2:0:5efe:cb00:7107').reason, 'block_isatap');
  assert.equal(classifyIp('fec0::1').reason, 'block_site_local');
  assert.equal(classifyIp('3ffe::1').reason, 'block_6bone');
});
