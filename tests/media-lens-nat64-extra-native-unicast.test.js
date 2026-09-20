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

const PUBLIC_ISATAP = '2001:470:1:2:0:5efe:808:808';
const PUBLIC_ISATAP_ULBIT = '2001:470:1:2:200:5efe:808:808';
const PUBLIC_ISATAP_GBIT = '2001:470:1:2:100:5efe:808:808';
const PUBLIC_ISATAP_UGBIT = '2001:470:1:2:300:5efe:808:808';
const PUBLIC_ISATAP_EMBEDDED = '8.8.8.8';
const CLASSIC_ISATAP_IID = 'return words[5] === 0x5efe && (words[4] === 0 || words[4] === 0x0200);';
const RFC5214_ISATAP_IID =
  'return words[5] === 0x5efe && (words[4] === 0 || words[4] === 0x0100 || words[4] === 0x0200 || words[4] === 0x0300);';

const RFC5214_PUBLIC_ISATAP = [
  ['isatap-public', PUBLIC_ISATAP],
  ['isatap-public-ulbit', PUBLIC_ISATAP_ULBIT],
  ['isatap-public-gbit', PUBLIC_ISATAP_GBIT],
  ['isatap-public-ugbit', PUBLIC_ISATAP_UGBIT]
];

const DEDICATED_ISATAP_DETECTOR = `if (isIsatapIid(words)) {
    return classifyFailClosedEmbedding(hextetToIPv4(words[6], words[7]), 6, canonical, 'isatap');
  }`;

const DROPPED_ISATAP_DETECTOR = `if (false && isIsatapIid(words)) {
    return classifyFailClosedEmbedding(hextetToIPv4(words[6], words[7]), 6, canonical, 'isatap');
  }`;

const RESIDUAL_ISATAP_FAIL_CLOSED = `if (isIsatapIid(words)) {
      return classifyFailClosedEmbedding(ipv4, 6, canonical, 'isatap');
    }`;

const CLOUDFLARE_STYLE_PUBLIC_AAAA = [
  {
    id: 'cloudflare-aaaa-public-last32',
    ip: CLOUDFLARE_AAAA,
    last32: CLOUDFLARE_LAST32
  },
  {
    id: 'nat64-extra-sparse-public-now-native',
    ip: '2001:470:1::808:808',
    last32: '8.8.8.8'
  },
  {
    id: 'nat64-extra-nonzero-64-95-public-now-native',
    ip: '2001:67c:27e4:64:ff:9b:808:808',
    last32: '8.8.8.8'
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
  ['nat64-extra-sparse-test-net-1', '2001:470:1::c000:207', 'block_documentation_via_nat64_extra', '192.0.2.7'],
  ['nat64-extra-sparse-test-net-2', '2001:470:1::c633:6407', 'block_documentation_via_nat64_extra', '198.51.100.7'],
  ['nat64-extra-sparse-test-net-3', '2001:470:1::cb00:7107', 'block_documentation_via_nat64_extra', '203.0.113.7'],
  ['nat64-extra-nonzero-64-95-loopback', '2001:67c:27e4:64:ff:9b:7f00:1', 'block_loopback_via_nat64_extra', '127.0.0.1'],
  ['nat64-extra-nonzero-64-95-imds', '2606:4700:4700:1:2:3:a9fe:a9fe', 'block_link_local_via_nat64_extra', '169.254.169.254'],
  ['nat64-extra-nonzero-64-95-rfc1918-10', '2001:470:1:2:3:4:a00:1', 'block_rfc1918_via_nat64_extra', '10.0.0.1'],
  ['nat64-extra-nonzero-64-95-rfc1918-192', '2a00:1450:4001:80e:1:2:c0a8:101', 'block_rfc1918_via_nat64_extra', '192.168.1.1']
];

const UNCHANGED_KNOWN_PREFIXES = [
  ['64:ff9b::808:808', 'allow_public', 'allow_public_via_nat64', '8.8.8.8'],
  ['64:ff9b::cb00:7107', 'block', 'block_documentation_via_nat64', '203.0.113.7'],
  ['64:ff9b::7f00:1', 'block', 'block_loopback_via_nat64', '127.0.0.1'],
  ['64:ff9b:1:808:8:800::', 'block', 'block_nat64_local', '8.8.8.8'],
  ['64:ff9b:2::1', 'block', 'block_nat64_unknown', null],
  ['2001:470:1:2:0:5efe:808:808', 'block', 'block_isatap', '8.8.8.8'],
  ['::ffff:8.8.8.8', 'allow_public', 'allow_public_via_mapped', '8.8.8.8'],
  ['::ffff:203.0.113.7', 'block', 'block_documentation_via_mapped', '203.0.113.7'],
  ['::ffff:0:808:808', 'allow_public', 'allow_public_via_siit', '8.8.8.8'],
  ['fec0::1', 'block', 'block_site_local', null],
  ['fec0::808:808', 'block', 'block_site_local', null],
  ['3ffe::1', 'block', 'block_6bone', null],
  ['3ffe::808:808', 'block', 'block_6bone', null],
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

test('RFC 5214 u/g ISATAP 0100:5efe and 0300:5efe with public last-32 are block_isatap', async () => {
  assert.equal(classifyIp(CLOUDFLARE_AAAA).disposition, 'allow_public');
  assert.equal(classifyIp('2001:470:1::808:808').disposition, 'allow_public');
  assert.equal(classifyIp('2001:470:1:2:400:5efe:808:808').disposition, 'allow_public');

  for (const [id, ip] of RFC5214_PUBLIC_ISATAP) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'block', `${id} ${ip} disposition`);
    assert.notEqual(result.disposition, 'allow_public', `${id} must not classify as native unicast`);
    assert.equal(result.reason, 'block_isatap', `${id} ${ip} reason`);
    assert.equal(result.embeddedIPv4, PUBLIC_ISATAP_EMBEDDED, `${id} ${ip} embedded IPv4`);

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

  assert.equal(classifyIp('2001:470:1:2:100:5efe:7f00:1').reason, 'block_loopback_via_isatap');
  assert.equal(classifyIp('2001:470:1:2:300:5efe:a9fe:a9fe').reason, 'block_link_local_via_isatap');
  assert.equal(classifyIp('2001:470:1:2:100:5efe:a00:1').reason, 'block_rfc1918_via_isatap');
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
            { address: '8.8.8.8', family: 4 },
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

test('mutation: dropping ISATAP detector still fail-closes public-IPv4 ISATAP on residual last-32', async () => {
  for (const [id, ip] of RFC5214_PUBLIC_ISATAP) {
    const current = classifyIp(ip);
    assert.equal(current.disposition, 'block', id);
    assert.equal(current.reason, 'block_isatap', id);
    assert.equal(current.embeddedIPv4, PUBLIC_ISATAP_EMBEDDED, id);
  }
  assert.equal(classifyIp(CLOUDFLARE_AAAA).disposition, 'allow_public');

  const src = await readFile('media-lens/worker/address-policy.js', 'utf8');
  assert.ok(src.includes(DEDICATED_ISATAP_DETECTOR), 'dedicated ISATAP detector must remain');
  assert.ok(src.includes(RFC5214_ISATAP_IID), 'isIsatapIid must match RFC 5214 u/g variants');

  const mutant = await loadMutatedAddressPolicy((original) =>
    original.replace(DEDICATED_ISATAP_DETECTOR, DROPPED_ISATAP_DETECTOR)
  );

  for (const [id, ip] of RFC5214_PUBLIC_ISATAP) {
    const blocked = mutant.classifyIp(ip);
    assert.equal(blocked.disposition, 'block', `${id} must not become allow_public after detector drop`);
    assert.notEqual(blocked.disposition, 'allow_public', id);
    assert.equal(blocked.reason, 'block_isatap', `${id} residual path must still classify as ISATAP`);
    assert.equal(blocked.embeddedIPv4, PUBLIC_ISATAP_EMBEDDED, id);
  }

  const cloudflare = mutant.classifyIp(CLOUDFLARE_AAAA);
  assert.equal(cloudflare.disposition, 'allow_public');
  assert.equal(cloudflare.reason, 'allow_public');
  assert.equal(mutant.classifyIp('2001:470:1::808:808').disposition, 'allow_public');
  assert.equal(mutant.classifyIp('2001:470:1::7f00:1').reason, 'block_loopback_via_nat64_extra');
  assert.equal(mutant.classifyIp('2001:470:1:2:0:5efe:7f00:1').reason, 'block_loopback_via_isatap');
  assert.equal(mutant.classifyIp('2001:470:1:2:100:5efe:7f00:1').reason, 'block_loopback_via_isatap');
  assert.equal(mutant.classifyIp('2001:470:1:2:300:5efe:a9fe:a9fe').reason, 'block_link_local_via_isatap');

  assert.ok(
    src.includes(RESIDUAL_ISATAP_FAIL_CLOSED),
    'residual last-32 must fail-close ISATAP-shaped IIDs before public allow'
  );
});

test('mutation: classic-only 0000/0200:5efe matcher allows RFC 5214 0100/0300 public last-32', async () => {
  const src = await readFile('media-lens/worker/address-policy.js', 'utf8');
  assert.ok(src.includes(RFC5214_ISATAP_IID), 'production matcher must include 0100:5efe and 0300:5efe');
  assert.equal(src.includes(CLASSIC_ISATAP_IID), false, 'classic-only matcher must not remain');

  const mutant = await loadMutatedAddressPolicy((original) =>
    original.replace(RFC5214_ISATAP_IID, CLASSIC_ISATAP_IID)
  );

  assert.equal(mutant.classifyIp(PUBLIC_ISATAP).reason, 'block_isatap');
  assert.equal(mutant.classifyIp(PUBLIC_ISATAP_ULBIT).reason, 'block_isatap');
  assert.equal(mutant.classifyIp(PUBLIC_ISATAP_GBIT).disposition, 'allow_public');
  assert.equal(mutant.classifyIp(PUBLIC_ISATAP_UGBIT).disposition, 'allow_public');
  assert.equal(mutant.classifyIp(CLOUDFLARE_AAAA).disposition, 'allow_public');
  assert.equal(mutant.classifyIp('2001:470:1:2:100:5efe:7f00:1').reason, 'block_loopback_via_nat64_extra');
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
  assert.equal(mutant.classifyIp('64:ff9b::808:808').reason, 'allow_public_via_nat64');
  assert.equal(mutant.classifyIp('2001:470:1:2:0:5efe:808:808').reason, 'block_isatap');
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
