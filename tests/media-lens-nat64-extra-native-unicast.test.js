// Issue #118: residual nat64_extra must not treat native unicast AAAA whose
// last 32 bits decode to a public IPv4 as custom NAT64. Cloudflare dual-stack
// hosts such as 2606:4700:10::6814:179a (last 32 bits 104.20.23.154) were
// BLOCKED_HOST. Private/metadata last-32 embeddings stay fail-closed.
// Table-driven: FAIL without the fix, PASS with it.
// Local mocks only. Live URL flags stay off. No TypeSafe key.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fetchArticleSafely,
  classifyIp,
  pinHost
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

async function loadMutatedAddressPolicy(mutate) {
  const original = await readFile('media-lens/worker/address-policy.js', 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, 'mutator must change the source');
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-nat64-extra-mutation-'));
  const dest = join(dir, 'address-policy.js');
  await writeFile(dest, mutated);
  return import(pathToFileURL(dest).href);
}

const CLOUDFLARE_AAAA = '2606:4700:10::6814:179a';
const CLOUDFLARE_LAST32 = '104.20.23.154';
const EXAMPLE_A = '93.184.216.34';

const OLD_ALWAYS_FAIL_CLOSED_LAST32 = `if (ipv4FirstOctet(ipv4) !== 0) {
      return classifyFailClosedEmbedding(ipv4, 6, canonical, 'nat64_extra');
    }`;

const NARROW_BLOCKED_LAST32_ONLY = `if (ipv4FirstOctet(ipv4) !== 0) {
      const inner = classifyIPv4(ipv4);
      if (inner.disposition === 'block') {
        return classifyFailClosedEmbedding(ipv4, 6, canonical, 'nat64_extra');
      }
    }`;

const CLOUDFLARE_STYLE_PUBLIC_AAAA = [
  {
    id: 'cloudflare-aaaa-public-last32',
    ip: CLOUDFLARE_AAAA,
    last32: CLOUDFLARE_LAST32
  },
  {
    id: 'nat64-extra-sparse-public-now-native',
    ip: '2001:470:1::cb00:7107',
    last32: '203.0.113.7'
  },
  {
    id: 'nat64-extra-nonzero-64-95-public-now-native',
    ip: '2001:67c:27e4:64:ff:9b:cb00:7107',
    last32: '203.0.113.7'
  }
];

const BLOCKED_LAST32_EMBEDDINGS = [
  ['nat64-extra-sparse-loopback', '2001:470:1::7f00:1', 'block_loopback_via_nat64_extra', '127.0.0.1'],
  ['nat64-extra-sparse-imds', '2001:470:1::a9fe:a9fe', 'block_link_local_via_nat64_extra', '169.254.169.254'],
  ['nat64-extra-sparse-ecs', '2001:470:1::a9fe:aa02', 'block_link_local_via_nat64_extra', '169.254.170.2'],
  ['nat64-extra-sparse-rfc1918-10', '2001:67c:27e4::a00:1', 'block_rfc1918_via_nat64_extra', '10.0.0.1'],
  ['nat64-extra-sparse-rfc1918-172', '2001:470:1::ac10:1', 'block_rfc1918_via_nat64_extra', '172.16.0.1'],
  ['nat64-extra-sparse-rfc1918-192', '2001:470:1::c0a8:101', 'block_rfc1918_via_nat64_extra', '192.168.1.1'],
  ['nat64-extra-sparse-cgnat', '2001:470:1::6440:1', 'block_cgnat_via_nat64_extra', '100.64.0.1'],
  ['nat64-extra-sparse-ietf', '2001:470:1::c000:1', 'block_ietf_protocol_via_nat64_extra', '192.0.0.1'],
  ['nat64-extra-sparse-6to4-anycast', '2001:470:1::c058:6301', 'block_6to4_anycast_via_nat64_extra', '192.88.99.1'],
  ['nat64-extra-sparse-benchmark', '2001:470:1::c612:1', 'block_benchmark_via_nat64_extra', '198.18.0.1'],
  ['nat64-extra-sparse-multicast', '2001:470:1::e000:1', 'block_multicast_via_nat64_extra', '224.0.0.1'],
  ['nat64-extra-sparse-reserved', '2001:470:1::f000:1', 'block_reserved_via_nat64_extra', '240.0.0.1'],
  ['nat64-extra-nonzero-64-95-loopback', '2001:67c:27e4:64:ff:9b:7f00:1', 'block_loopback_via_nat64_extra', '127.0.0.1'],
  ['nat64-extra-nonzero-64-95-imds', '2606:4700:4700:1:2:3:a9fe:a9fe', 'block_link_local_via_nat64_extra', '169.254.169.254'],
  ['nat64-extra-nonzero-64-95-rfc1918-10', '2001:470:1:2:3:4:a00:1', 'block_rfc1918_via_nat64_extra', '10.0.0.1'],
  ['nat64-extra-nonzero-64-95-rfc1918-192', '2a00:1450:4001:80e:1:2:c0a8:101', 'block_rfc1918_via_nat64_extra', '192.168.1.1']
];

const UNCHANGED_KNOWN_PREFIXES = [
  ['64:ff9b::cb00:7107', 'allow_public', 'allow_public_via_nat64', '203.0.113.7'],
  ['64:ff9b::7f00:1', 'block', 'block_loopback_via_nat64', '127.0.0.1'],
  ['64:ff9b:1:cb00:71:700::', 'block', 'block_nat64_local', '203.0.113.7'],
  ['64:ff9b:2::1', 'block', 'block_nat64_unknown', null],
  ['2001:470:1:2:0:5efe:cb00:7107', 'block', 'block_isatap', '203.0.113.7'],
  ['::ffff:203.0.113.7', 'allow_public', 'allow_public_via_mapped', '203.0.113.7'],
  ['::ffff:0:cb00:7107', 'allow_public', 'allow_public_via_siit', '203.0.113.7'],
  ['fec0::1', 'block', 'block_site_local', null],
  ['fec0::cb00:7107', 'block', 'block_site_local', null],
  ['3ffe::1', 'block', 'block_6bone', null],
  ['3ffe::cb00:7107', 'block', 'block_6bone', null],
  ['2001:4860:4860::8888', 'allow_public', 'allow_public', null]
];

test('Cloudflare-style AAAA with public last-32 is native unicast allow_public', () => {
  const inner = classifyIp(CLOUDFLARE_LAST32);
  assert.equal(inner.disposition, 'allow_public', CLOUDFLARE_LAST32);

  for (const row of CLOUDFLARE_STYLE_PUBLIC_AAAA) {
    const result = classifyIp(row.ip);
    assert.equal(result.disposition, 'allow_public', `${row.id} ${row.ip} disposition`);
    assert.equal(result.reason, 'allow_public', `${row.id} ${row.ip} reason`);
    assert.equal(result.family, 6, row.id);
    assert.equal(result.embeddedIPv4, null, `${row.id} is native unicast, not an embedding`);
    assert.notEqual(result.reason, 'block_nat64_extra', row.id);

    const decoded = classifyIp(row.last32);
    assert.equal(decoded.disposition, 'allow_public', `${row.id} last-32 ${row.last32}`);
  }
});

test('mixed public A + Cloudflare-style AAAA pins and is not BLOCKED_HOST', async () => {
  const lookupImpl = async () => [
    { address: EXAMPLE_A, family: 4 },
    { address: CLOUDFLARE_AAAA, family: 6 }
  ];

  const pin = await pinHost('example.com', { lookupImpl });
  const expectedV6 = classifyIp(CLOUDFLARE_AAAA).canonical;
  assert.equal(pin.family, 6);
  assert.equal(pin.address, expectedV6);
  assert.equal(pin.classified.every((entry) => entry.disposition === 'allow_public'), true);

  let lookups = 0;
  let connects = 0;
  const fetched = await fetchArticleSafely('http://example.com/article', {
    timeoutMs: 500,
    maxBytes: 4000,
    lookupImpl: async () => {
      lookups += 1;
      return lookupImpl();
    },
    requestImpl: async ({ pin: hopPin }) => {
      connects += 1;
      assert.equal(hopPin.address, expectedV6);
      return htmlResponse(hopPin);
    }
  });
  assert.equal(lookups, 1);
  assert.equal(connects, 1);
  assert.match(fetched.html, /Public article fixture/);
});

test('private and metadata last-32 embeddings remain fail-closed extra NAT64', () => {
  for (const [id, ip, reason, embeddedIPv4] of BLOCKED_LAST32_EMBEDDINGS) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'block', `${id} ${ip} disposition`);
    assert.equal(result.reason, reason, `${id} ${ip} reason`);
    assert.equal(result.embeddedIPv4, embeddedIPv4, `${id} ${ip} embedded IPv4`);
    assert.equal(classifyIp(embeddedIPv4).disposition, 'block', `${id} inner IPv4 ${embeddedIPv4}`);
  }
});

test('well-known NAT64, mapped/SIIT, ISATAP, fec0::/10, 3ffe::/16, and first-octet-0 stay unchanged', () => {
  for (const [ip, disposition, reason, embeddedIPv4] of UNCHANGED_KNOWN_PREFIXES) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, disposition, ip);
    assert.equal(result.reason, reason, ip);
    assert.equal(result.embeddedIPv4, embeddedIPv4, ip);
  }
});

test('private last-32 embeddings still fail closed before connect; public last-32 may pin', async () => {
  for (const [id, ip] of BLOCKED_LAST32_EMBEDDINGS) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely(`http://[${ip}]/`, {
          timeoutMs: 200,
          maxBytes: 1000,
          lookupImpl: async () => {
            lookups += 1;
            throw new Error(`must not lookup for ${id}`);
          },
          requestImpl: async () => {
            connects += 1;
            throw new Error(`must not connect for ${id}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      id
    );
    assert.equal(lookups, 0, `${id} lookups`);
    assert.equal(connects, 0, `${id} connects`);
  }

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
            { address: '2001:470:1::7f00:1', family: 6 }
          ];
        },
        requestImpl: async () => {
          connects += 1;
          throw new Error('must not connect mixed private last-32');
        }
      }),
    hasCode('BLOCKED_HOST')
  );
  assert.equal(lookups, 1);
  assert.equal(connects, 0);
});

test('mutation: restoring always-fail-closed last-32 nonzero blocks Cloudflare-style AAAA', async () => {
  const src = await readFile('media-lens/worker/address-policy.js', 'utf8');
  assert.match(src, /const inner = classifyIPv4\(ipv4\);/);
  assert.ok(src.includes(NARROW_BLOCKED_LAST32_ONLY), 'residual path must classify inner IPv4 before extra NAT64');

  const current = classifyIp(CLOUDFLARE_AAAA);
  assert.equal(current.disposition, 'allow_public');
  assert.equal(current.reason, 'allow_public');

  const mutant = await loadMutatedAddressPolicy((original) =>
    original.replace(NARROW_BLOCKED_LAST32_ONLY, OLD_ALWAYS_FAIL_CLOSED_LAST32)
  );

  for (const row of CLOUDFLARE_STYLE_PUBLIC_AAAA) {
    const blocked = mutant.classifyIp(row.ip);
    assert.equal(blocked.disposition, 'block', `${row.id} must fail under old catch-all`);
    assert.equal(blocked.reason, 'block_nat64_extra', row.id);
    assert.equal(blocked.embeddedIPv4, row.last32, row.id);
  }

  assert.equal(mutant.classifyIp('2001:470:1::7f00:1').reason, 'block_loopback_via_nat64_extra');
  assert.equal(mutant.classifyIp('64:ff9b::cb00:7107').reason, 'allow_public_via_nat64');
  assert.equal(mutant.classifyIp('2001:470:1:2:0:5efe:cb00:7107').reason, 'block_isatap');
  assert.equal(mutant.classifyIp('fec0::1').reason, 'block_site_local');
  assert.equal(mutant.classifyIp('3ffe::1').reason, 'block_6bone');
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
