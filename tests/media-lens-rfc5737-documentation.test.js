// RFC 5737 TEST-NET documentation ranges are blocked IPv4 space.
// Direct, mapped, SIIT, well-known NAT64, IPv4-compatible ::/96, 6to4,
// ISATAP, and residual last-32 / nat64_extra embeddings inherit the IPv4
// table. Mocked/no-connect only. Live URL flags stay off.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  classifyIp,
  parseArticleUrl,
  assertHostIsPublic,
  fetchArticleSafely
} from '../media-lens/worker/safe-fetch.js';

function hasCode(code) {
  return (err) => err.code === code;
}

async function loadMutatedAddressPolicy(mutate) {
  const original = await readFile('media-lens/worker/address-policy.js', 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, 'mutator must change the source');
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-rfc5737-mutation-'));
  const dest = join(dir, 'address-policy.js');
  await writeFile(dest, mutated);
  return import(pathToFileURL(dest).href);
}

function ipv4Hextets(ip) {
  const parts = ip.split('.').map(Number);
  assert.equal(parts.length, 4, ip);
  const hi = ((parts[0] << 8) | parts[1]) & 0xffff;
  const lo = ((parts[2] << 8) | parts[3]) & 0xffff;
  return { hi, lo, h: hi.toString(16), l: lo.toString(16) };
}

function rfc6052Slash48(ip) {
  const { h, lo } = ipv4Hextets(ip);
  const word4 = (lo >> 8) & 0xff;
  const word5 = (lo & 0xff) << 8;
  return `64:ff9b:1:${h}:${word4.toString(16)}:${word5.toString(16)}::`;
}

function embeddings(ip) {
  const { h, l } = ipv4Hextets(ip);
  return {
    mappedDotted: `::ffff:${ip}`,
    mappedHex: `::ffff:${h}:${l}`,
    siit: `::ffff:0:${h}:${l}`,
    nat64: `64:ff9b::${h}:${l}`,
    nat64Dotted: `64:ff9b::${ip}`,
    nat64Local: rfc6052Slash48(ip),
    compat96: `::${h}:${l}`,
    sixTo4: `2002:${h}:${l}::`,
    isatap: `2001:470:1:2:0:5efe:${h}:${l}`,
    isatapG: `2001:470:1:2:100:5efe:${h}:${l}`,
    isatapUl: `2001:470:1:2:200:5efe:${h}:${l}`,
    isatapUg: `2001:470:1:2:300:5efe:${h}:${l}`,
    residual: `2001:470:1::${h}:${l}`,
    residualNonzero: `2001:67c:27e4:64:ff:9b:${h}:${l}`
  };
}

const TEST_NET_RANGES = [
  {
    id: 'TEST-NET-1',
    cidr: '192.0.2.0/24',
    line: "['192.0.2.0', 24, 'block_documentation']",
    ip: '192.0.2.7'
  },
  {
    id: 'TEST-NET-2',
    cidr: '198.51.100.0/24',
    line: "['198.51.100.0', 24, 'block_documentation']",
    ip: '198.51.100.7'
  },
  {
    id: 'TEST-NET-3',
    cidr: '203.0.113.0/24',
    line: "['203.0.113.0', 24, 'block_documentation']",
    ip: '203.0.113.7'
  }
];

const PUBLIC_CONTROL = '8.8.8.8';
const PUBLIC_SECONDARY = '1.1.1.1';

test('RFC 5737 TEST-NET IPv4 literals are documentation-space block', async () => {
  for (const row of TEST_NET_RANGES) {
    const result = classifyIp(row.ip);
    assert.equal(result.disposition, 'block', row.id);
    assert.equal(result.reason, 'block_documentation', row.id);
    assert.equal(result.family, 4, row.id);
    assert.equal(result.canonical, row.ip, row.id);
    await assert.rejects(() => assertHostIsPublic(row.ip), hasCode('BLOCKED_HOST'), row.id);
    assert.throws(() => parseArticleUrl(`http://${row.ip}/a`), hasCode('BLOCKED_HOST'), row.id);
  }

  const publicPrimary = classifyIp(PUBLIC_CONTROL);
  assert.equal(publicPrimary.disposition, 'allow_public');
  assert.equal(publicPrimary.reason, 'allow_public');
  await assert.doesNotReject(() => assertHostIsPublic(PUBLIC_CONTROL));
  const parsed = parseArticleUrl(`http://${PUBLIC_CONTROL}/a`);
  assert.equal(parsed.kind, 'ipv4');
  assert.equal(parsed.classified.disposition, 'allow_public');

  const publicSecondary = classifyIp(PUBLIC_SECONDARY);
  assert.equal(publicSecondary.disposition, 'allow_public');
});

test('RFC 5737 TEST-NET embeddings inherit documentation block on every path', async () => {
  for (const row of TEST_NET_RANGES) {
    const forms = embeddings(row.ip);
    const blocked = [
      [forms.mappedDotted, 'block_documentation_via_mapped'],
      [forms.mappedHex, 'block_documentation_via_mapped'],
      [forms.siit, 'block_documentation_via_siit'],
      [forms.nat64, 'block_documentation_via_nat64'],
      [forms.nat64Dotted, 'block_documentation_via_nat64'],
      [forms.compat96, 'block_documentation_via_compat96'],
      [forms.sixTo4, 'block_documentation_via_6to4'],
      [forms.nat64Local, 'block_documentation_via_nat64_local'],
      [forms.isatap, 'block_documentation_via_isatap'],
      [forms.isatapG, 'block_documentation_via_isatap'],
      [forms.isatapUl, 'block_documentation_via_isatap'],
      [forms.isatapUg, 'block_documentation_via_isatap'],
      [forms.residual, 'block_documentation_via_nat64_extra'],
      [forms.residualNonzero, 'block_documentation_via_nat64_extra']
    ];
    for (const [ip, reason] of blocked) {
      const result = classifyIp(ip);
      assert.equal(result.disposition, 'block', `${row.id} ${ip}`);
      assert.equal(result.reason, reason, `${row.id} ${ip}`);
      assert.equal(result.embeddedIPv4, row.ip, `${row.id} ${ip}`);
    }
  }
});

test('globally routable mocked public controls stay allow_public on embedding paths', () => {
  const forms = embeddings(PUBLIC_CONTROL);
  const allowed = [
    [PUBLIC_CONTROL, 'allow_public', 4, null],
    [forms.mappedDotted, 'allow_public_via_mapped', 6, PUBLIC_CONTROL],
    [forms.mappedHex, 'allow_public_via_mapped', 6, PUBLIC_CONTROL],
    [forms.siit, 'allow_public_via_siit', 6, PUBLIC_CONTROL],
    [forms.nat64, 'allow_public_via_nat64', 6, PUBLIC_CONTROL],
    [forms.nat64Dotted, 'allow_public_via_nat64', 6, PUBLIC_CONTROL],
    [forms.compat96, 'allow_public_via_compat96', 6, PUBLIC_CONTROL],
    [forms.sixTo4, 'allow_public_via_6to4', 6, PUBLIC_CONTROL],
    [forms.residual, 'allow_public', 6, null],
    [forms.residualNonzero, 'allow_public', 6, null]
  ];
  for (const [ip, reason, family, embedded] of allowed) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'allow_public', ip);
    assert.equal(result.reason, reason, ip);
    assert.equal(result.family, family, ip);
    assert.equal(result.embeddedIPv4, embedded, ip);
  }

  const local = classifyIp(forms.nat64Local);
  assert.equal(local.disposition, 'block');
  assert.equal(local.reason, 'block_nat64_local');
  assert.equal(local.embeddedIPv4, PUBLIC_CONTROL);

  for (const ip of [forms.isatap, forms.isatapG, forms.isatapUl, forms.isatapUg]) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'block', ip);
    assert.equal(result.reason, 'block_isatap', ip);
    assert.equal(result.embeddedIPv4, PUBLIC_CONTROL, ip);
  }
});

test('TEST-NET article literals fail closed before connect', async () => {
  for (const row of TEST_NET_RANGES) {
    let lookups = 0;
    let connects = 0;
    await assert.rejects(
      () =>
        fetchArticleSafely(`http://${row.ip}/`, {
          timeoutMs: 200,
          maxBytes: 1000,
          lookupImpl: async () => {
            lookups += 1;
            throw new Error(`must not lookup ${row.id}`);
          },
          requestImpl: async () => {
            connects += 1;
            throw new Error(`must not connect ${row.id}`);
          }
        }),
      hasCode('BLOCKED_HOST'),
      row.id
    );
    assert.equal(lookups, 0, row.id);
    assert.equal(connects, 0, row.id);
  }
});

test('mutation: dropping each RFC 5737 TEST-NET range allows that range as public', async () => {
  const src = await readFile('media-lens/worker/address-policy.js', 'utf8');
  for (const row of TEST_NET_RANGES) {
    assert.ok(src.includes(row.line), `${row.id} must remain in BLOCKED_IPV4_RANGES`);
    assert.equal(classifyIp(row.ip).reason, 'block_documentation', row.id);

    const mutant = await loadMutatedAddressPolicy((original) => {
      const next = original.replace(`  ${row.line},\n`, '');
      assert.notEqual(next, original, `${row.id} mutator must remove the CIDR line`);
      assert.equal(next.includes(row.line), false, `${row.id} line must be gone`);
      return next;
    });

    const allowed = mutant.classifyIp(row.ip);
    assert.equal(allowed.disposition, 'allow_public', `${row.id} direct IPv4 after range drop`);
    assert.equal(allowed.reason, 'allow_public', row.id);

    const forms = embeddings(row.ip);
    assert.equal(mutant.classifyIp(forms.mappedDotted).disposition, 'allow_public', `${row.id} mapped`);
    assert.equal(mutant.classifyIp(forms.mappedHex).reason, 'allow_public_via_mapped', `${row.id} mapped hex`);
    assert.equal(mutant.classifyIp(forms.siit).reason, 'allow_public_via_siit', `${row.id} siit`);
    assert.equal(mutant.classifyIp(forms.nat64).reason, 'allow_public_via_nat64', `${row.id} nat64`);
    assert.equal(mutant.classifyIp(forms.nat64Dotted).reason, 'allow_public_via_nat64', `${row.id} nat64 dotted`);
    assert.equal(mutant.classifyIp(forms.compat96).reason, 'allow_public_via_compat96', `${row.id} compat96`);
    assert.equal(mutant.classifyIp(forms.sixTo4).reason, 'allow_public_via_6to4', `${row.id} 6to4`);
    assert.equal(mutant.classifyIp(forms.residual).disposition, 'allow_public', `${row.id} residual`);
    assert.equal(mutant.classifyIp(forms.residualNonzero).reason, 'allow_public', `${row.id} residual nonzero`);
    assert.equal(mutant.classifyIp(forms.nat64Local).reason, 'block_nat64_local', `${row.id} local NAT64 still extra-prefix`);
    assert.equal(mutant.classifyIp(forms.isatap).reason, 'block_isatap', `${row.id} ISATAP still fail-closed`);

    for (const other of TEST_NET_RANGES.filter((entry) => entry.id !== row.id)) {
      const stillBlocked = mutant.classifyIp(other.ip);
      assert.equal(stillBlocked.disposition, 'block', `${other.id} must stay blocked after dropping ${row.id}`);
      assert.equal(stillBlocked.reason, 'block_documentation', other.id);
    }
  }
});
