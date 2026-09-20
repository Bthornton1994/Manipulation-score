// Adversarial SSRF / DNS-rebinding / pin tests for Issue #118 live URL fetch.
// Local DNS mocks and loopback HTTP fixtures only. No public metadata probes.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import {
  fetchArticleSafely,
  assertHostIsPublic,
  classifyIp,
  parseArticleUrl,
  pinHost
} from '../media-lens/worker/safe-fetch.js';
import { makePinnedLookup } from '../media-lens/worker/pinned-http.js';

function hasCode(code) {
  return (err) => err.code === code;
}

function htmlResponse(pin, html = '<!doctype html><html><body><p>Public article fixture.</p></body></html>', extraHeaders = {}) {
  const headers = { 'content-type': 'text/html', ...extraHeaders };
  const rawHeaders = [];
  for (const [key, value] of Object.entries(headers)) {
    rawHeaders.push(key, value);
  }
  return {
    status: 200,
    headers,
    rawHeaders,
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

const PUBLIC_LOOKUP = async () => [{ address: '8.8.8.8', family: 4 }];

test('URL parse / exotic IPv4: WHATWG canonicalizes then IPv4 policy applies', async () => {
  const blocked = [
    ['http://0177.0.0.1/', 'BLOCKED_HOST'],
    ['http://0x7f.0.0.1/', 'BLOCKED_HOST'],
    ['http://2130706433/', 'BLOCKED_HOST'],
    ['http://127.1/', 'BLOCKED_HOST'],
    ['http://0x7f000001/', 'BLOCKED_HOST'],
    ['http://foo@127.0.0.1/', 'BAD_URL'],
    ['http://127.0.0.1#@8.8.8.8/', 'BLOCKED_HOST'],
    ['file:///etc/passwd', 'BAD_SCHEME'],
    ['gopher://8.8.8.8/', 'BAD_SCHEME'],
    ['javascript:alert(1)', 'BAD_SCHEME'],
    ['http://', 'BAD_URL'],
    ['\x00http://8.8.8.8/', 'BAD_URL'],
    ['http://exämple.com/', 'BAD_URL'],
    ['http://0xcb.0.113.7/', 'BLOCKED_HOST'],
    ['http://0xc0.0.2.7/', 'BLOCKED_HOST'],
    ['http://0xc6.0x33.0x64.7/', 'BLOCKED_HOST']
  ];
  for (const [input, code] of blocked) {
    let called = false;
    await assert.rejects(
      () =>
        fetchArticleSafely(input, {
          timeoutMs: 200,
          maxBytes: 1000,
          requestImpl: async () => {
            called = true;
            throw new Error('must not connect');
          }
        }),
      hasCode(code),
      input
    );
    assert.equal(called, false, `${input} must not connect`);
  }

  const exoticPublic = parseArticleUrl('http://0x8.0x8.0x8.0x8/path');
  assert.equal(exoticPublic.kind, 'ipv4');
  assert.equal(exoticPublic.parsed.hostname, '8.8.8.8');
  assert.equal(exoticPublic.classified.disposition, 'allow_public');

  const fetched = await fetchArticleSafely('http://0x8.0x8.0x8.0x8/article', {
    timeoutMs: 500,
    maxBytes: 4000,
    requestImpl: async ({ parsed, pin }) => {
      assert.equal(parsed.hostname, '8.8.8.8');
      return htmlResponse(pin);
    }
  });
  assert.match(fetched.html, /Public article fixture/);
});

test('IPv4 policy table', async () => {
  const blocked = [
    ['127.0.0.1', 'block_loopback'],
    ['10.0.0.5', 'block_rfc1918'],
    ['172.16.1.1', 'block_rfc1918'],
    ['192.168.1.1', 'block_rfc1918'],
    ['169.254.169.254', 'block_link_local'],
    ['169.254.170.2', 'block_link_local'],
    ['100.64.0.1', 'block_cgnat'],
    ['198.18.0.1', 'block_benchmark'],
    ['192.88.99.1', 'block_6to4_anycast'],
    ['224.0.0.1', 'block_multicast'],
    ['240.0.0.1', 'block_reserved'],
    ['0.0.0.0', 'block_this_network'],
    ['192.0.2.7', 'block_documentation'],
    ['198.51.100.7', 'block_documentation'],
    ['203.0.113.7', 'block_documentation']
  ];
  for (const [ip, reason] of blocked) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'block', ip);
    assert.equal(result.reason, reason, ip);
    await assert.rejects(() => assertHostIsPublic(ip), hasCode('BLOCKED_HOST'));
  }
  const allowed = classifyIp('8.8.8.8');
  assert.equal(allowed.disposition, 'allow_public');
  await assert.doesNotReject(() => assertHostIsPublic('8.8.8.8'));
});

test('IPv6 / embeddings policy table', async () => {
  const blocked = [
    ['[::1]', 'block_loopback'],
    ['::', 'block_unspecified'],
    ['fe80::1', 'block_link_local'],
    ['fec0::1', 'block_site_local'],
    ['feff::1', 'block_site_local'],
    ['3ffe::1', 'block_6bone'],
    ['3ffe:ffff::1', 'block_6bone'],
    ['fd12:3456:789a::1', 'block_ula'],
    ['ff02::1', 'block_multicast'],
    ['2001:db8::1', 'block_documentation'],
    ['::ffff:127.0.0.1', 'block_loopback_via_mapped'],
    ['::ffff:7f00:1', 'block_loopback_via_mapped'],
    ['0:0:0:0:0:ffff:7f00:1', 'block_loopback_via_mapped'],
    ['::ffff:a9fe:a9fe', 'block_link_local_via_mapped'],
    ['::ffff:0:7f00:1', 'block_loopback_via_siit'],
    ['::ffff:0:a9fe:a9fe', 'block_link_local_via_siit'],
    ['64:ff9b::7f00:1', 'block_loopback_via_nat64'],
    ['64:ff9b::a9fe:a9fe', 'block_link_local_via_nat64'],
    ['64:ff9b:1:7f00:0:100::', 'block_loopback_via_nat64_local'],
    ['64:ff9b:1:a9fe:a9:fe00::', 'block_link_local_via_nat64_local'],
    ['64:ff9b:1:7f00:100:100::', 'block_nat64_local_invalid'],
    ['64:ff9b:1:808:8:800::', 'block_nat64_local'],
    ['64:ff9b:2::1', 'block_nat64_unknown'],
    ['2001:470:1::7f00:1', 'block_loopback_via_nat64_extra'],
    ['2001:67c:27e4:64:ff:9b:7f00:1', 'block_loopback_via_nat64_extra'],
    ['2606:4700:4700:1:2:3:a9fe:a9fe', 'block_link_local_via_nat64_extra'],
    ['2001:470:1:2:3:4:a00:1', 'block_rfc1918_via_nat64_extra'],
    ['2a00:1450:4001:80e:1:2:c0a8:101', 'block_rfc1918_via_nat64_extra'],
    ['2001:470:1:2:0:5efe:7f00:1', 'block_loopback_via_isatap'],
    ['2001:470:1:2:0:5efe:808:808', 'block_isatap'],
    ['2001:470:1:2:200:5efe:a9fe:a9fe', 'block_link_local_via_isatap'],
    ['2001:470:1:2:0:5efe:a00:1', 'block_rfc1918_via_isatap'],
    ['2001:470:1:2:100:5efe:808:808', 'block_isatap'],
    ['2001:470:1:2:300:5efe:808:808', 'block_isatap'],
    ['64:ff9b:0:0:0:1:7f00:1', 'block_nat64_unknown'],
    ['2001:2::1', 'block_benchmark'],
    ['2001:2:0:0:0:0:0:1', 'block_benchmark'],
    ['2001:10::1', 'block_orchid'],
    ['2001:1f::1', 'block_orchid'],
    ['2001:20::1', 'block_orchid'],
    ['2001:2f::1', 'block_orchid'],
    ['::ffff:192.88.99.1', 'block_6to4_anycast_via_mapped'],
    ['2002:c058:6301::', 'block_6to4_anycast_via_6to4'],
    ['::7f00:1', 'block_loopback_via_compat96'],
    ['::127.0.0.1', 'block_loopback_via_compat96'],
    ['2002:7f00:0001::', 'block_loopback_via_6to4'],
    ['2001:0:53aa:64c::', 'block_teredo'],
    ['fd00:ec2::254', 'block_ula'],
    ['::ffff:not-valid', 'block_unparsable'],
    ['::ffff:192.0.2.7', 'block_documentation_via_mapped'],
    ['::ffff:198.51.100.7', 'block_documentation_via_mapped'],
    ['::ffff:203.0.113.7', 'block_documentation_via_mapped'],
    ['::ffff:0:c000:207', 'block_documentation_via_siit'],
    ['::ffff:0:c633:6407', 'block_documentation_via_siit'],
    ['::ffff:0:cb00:7107', 'block_documentation_via_siit'],
    ['64:ff9b::c000:207', 'block_documentation_via_nat64'],
    ['64:ff9b::c633:6407', 'block_documentation_via_nat64'],
    ['64:ff9b::cb00:7107', 'block_documentation_via_nat64'],
    ['::c000:207', 'block_documentation_via_compat96'],
    ['::c633:6407', 'block_documentation_via_compat96'],
    ['::cb00:7107', 'block_documentation_via_compat96'],
    ['2002:c000:207::', 'block_documentation_via_6to4'],
    ['2002:c633:6407::', 'block_documentation_via_6to4'],
    ['2002:cb00:7107::', 'block_documentation_via_6to4'],
    ['2001:470:1::c000:207', 'block_documentation_via_nat64_extra'],
    ['2001:470:1::c633:6407', 'block_documentation_via_nat64_extra'],
    ['2001:470:1::cb00:7107', 'block_documentation_via_nat64_extra'],
    ['2001:470:1:2:0:5efe:cb00:7107', 'block_documentation_via_isatap']
  ];
  for (const [ip, reason] of blocked) {
    const result = classifyIp(ip);
    assert.equal(result.disposition, 'block', `${ip} expected ${reason}, got ${result.reason}`);
    assert.equal(result.reason, reason, ip);
  }

  const mappedPublic = classifyIp('::ffff:8.8.8.8');
  assert.equal(mappedPublic.disposition, 'allow_public');
  assert.equal(mappedPublic.embeddedIPv4, '8.8.8.8');
  const nat64Public = classifyIp('64:ff9b::808:808');
  assert.equal(nat64Public.disposition, 'allow_public');
  assert.equal(nat64Public.embeddedIPv4, '8.8.8.8');
  const localNat64Public = classifyIp('64:ff9b:1:808:8:800::');
  assert.equal(localNat64Public.disposition, 'block');
  assert.equal(localNat64Public.reason, 'block_nat64_local');
  assert.equal(localNat64Public.embeddedIPv4, '8.8.8.8');
  const extraPublicNative = classifyIp('2001:470:1::808:808');
  assert.equal(extraPublicNative.disposition, 'allow_public');
  assert.equal(extraPublicNative.reason, 'allow_public');
  assert.equal(extraPublicNative.embeddedIPv4, null);
  const extraPublicResidual = classifyIp('2001:67c:27e4:64:ff:9b:808:808');
  assert.equal(extraPublicResidual.disposition, 'allow_public');
  assert.equal(extraPublicResidual.reason, 'allow_public');
  assert.equal(extraPublicResidual.embeddedIPv4, null);
  await assert.doesNotReject(() => assertHostIsPublic('::ffff:808:808'));

  let benchmarkConnects = 0;
  await assert.rejects(
    () =>
      fetchArticleSafely('http://[2001:2::1]/', {
        timeoutMs: 200,
        maxBytes: 1000,
        requestImpl: async () => {
          benchmarkConnects += 1;
          throw new Error('must not connect');
        }
      }),
    hasCode('BLOCKED_HOST')
  );
  assert.equal(benchmarkConnects, 0);
});

test('DNS rebinding fixture: lookup is called once per hop and the second answer is never used', async () => {
  let lookups = 0;
  const lookupImpl = async () => {
    lookups += 1;
    if (lookups === 1) return [{ address: '8.8.8.8', family: 4 }];
    return [{ address: '127.0.0.1', family: 4 }];
  };
  const pins = [];
  const result = await fetchArticleSafely('http://rebind.test/article', {
    timeoutMs: 1000,
    maxBytes: 4000,
    lookupImpl,
    requestImpl: async ({ pin }) => {
      pins.push(pin.address);
      return htmlResponse(pin);
    }
  });
  assert.equal(lookups, 1);
  assert.deepEqual(pins, ['8.8.8.8']);
  assert.match(result.html, /Public article fixture/);
});

test('mixed public+private DNS fails closed with no connect', async () => {
  const cases = [
    async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 }
    ],
    async () => [
      { address: '8.8.8.8', family: 4 },
      { address: 'fd00::1', family: 6 }
    ],
    async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:2::1', family: 6 }
    ],
    async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '64:ff9b:2::1', family: 6 }
    ],
    async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:470:1:2:0:5efe:7f00:1', family: 6 }
    ],
    async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:470:1::7f00:1', family: 6 }
    ],
    async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:67c:27e4:64:ff:9b:7f00:1', family: 6 }
    ]
  ];
  for (const lookupImpl of cases) {
    let called = false;
    await assert.rejects(
      () =>
        fetchArticleSafely('http://dual.example/x', {
          timeoutMs: 500,
          maxBytes: 1000,
          lookupImpl,
          requestImpl: async () => {
            called = true;
            throw new Error('must not connect');
          }
        }),
      hasCode('BLOCKED_HOST')
    );
    assert.equal(called, false);
  }
});

test('empty DNS and special-use hostnames fail closed without a second lookup', async () => {
  await assert.rejects(
    () => pinHost('empty.example', { lookupImpl: async () => [] }),
    hasCode('DNS_ERROR')
  );
  let lookups = 0;
  const counting = async () => {
    lookups += 1;
    throw new Error('dns should not run');
  };
  await assert.rejects(() => pinHost('localhost', { lookupImpl: counting }), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => fetchArticleSafely('http://printer.local/', { timeoutMs: 200, maxBytes: 100, lookupImpl: counting }), hasCode('BLOCKED_HOST'));
  await assert.rejects(
    () => fetchArticleSafely('http://metadata.google.internal/', { timeoutMs: 200, maxBytes: 100, lookupImpl: counting }),
    hasCode('BLOCKED_HOST')
  );
  assert.equal(lookups, 0);
});

test('redirects: private, loopback, mapped, NAT64, downgrade, relative, protocol-relative, missing, loop, multi-location', async () => {
  const start = 'http://8.8.8.8/start';

  async function follow(location, extra = {}) {
    return fetchArticleSafely(start, {
      timeoutMs: 1000,
      maxBytes: 4000,
      requestImpl: async ({ parsed, pin }) => {
        if (parsed.pathname === '/start') return redirectResponse(pin, location);
        throw new Error(`unexpected hop ${parsed.href}`);
      },
      ...extra
    });
  }

  await assert.rejects(() => follow('http://169.254.169.254/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[::1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[64:ff9b::7f00:1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[::ffff:7f00:1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[2001:2::1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[64:ff9b:1:7f00:0:100::]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[64:ff9b:2::1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[64:ff9b:1:808:8:800::]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[2001:470:1:2:0:5efe:7f00:1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[2001:470:1:2:0:5efe:10.0.0.1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[2001:470:1::7f00:1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[2001:67c:27e4:64:ff:9b:7f00:1]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://[2606:4700:4700:1:2:3:a9fe:a9fe]/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(() => follow('http://0177.0.0.1/'), hasCode('BLOCKED_HOST'));
  await assert.rejects(
    () =>
      fetchArticleSafely('https://8.8.8.8/start', {
        timeoutMs: 1000,
        maxBytes: 1000,
        requestImpl: async ({ pin }) => redirectResponse(pin, 'http://1.1.1.1/')
      }),
    hasCode('REDIRECT_DOWNGRADE')
  );

  const relative = await fetchArticleSafely(start, {
    timeoutMs: 1000,
    maxBytes: 4000,
    requestImpl: async ({ parsed, pin }) => {
      if (parsed.pathname === '/start') return redirectResponse(pin, '/next');
      assert.equal(parsed.hostname, '8.8.8.8');
      assert.equal(parsed.pathname, '/next');
      return htmlResponse(pin);
    }
  });
  assert.match(relative.html, /Public article fixture/);

  await assert.rejects(() => follow('//127.0.0.1/x'), hasCode('BLOCKED_HOST'));
  await assert.rejects(
    () =>
      fetchArticleSafely(start, {
        timeoutMs: 500,
        maxBytes: 1000,
        requestImpl: async ({ pin }) => ({
          status: 302,
          headers: {},
          rawHeaders: [],
          remoteAddress: pin.address,
          body: ''
        })
      }),
    hasCode('FETCH_ERROR')
  );

  await assert.rejects(
    () =>
      fetchArticleSafely(start, {
        timeoutMs: 500,
        maxBytes: 1000,
        maxRedirects: 3,
        requestImpl: async ({ pin, parsed }) => redirectResponse(pin, `${parsed.origin}${parsed.pathname}/n`)
      }),
    hasCode('TOO_MANY_REDIRECTS')
  );

  await assert.rejects(
    () =>
      fetchArticleSafely(start, {
        timeoutMs: 500,
        maxBytes: 1000,
        requestImpl: async ({ pin }) => ({
          status: 302,
          headers: { location: ['http://1.1.1.1/a', 'http://1.1.1.1/b'] },
          rawHeaders: ['Location', 'http://1.1.1.1/a', 'Location', 'http://1.1.1.1/b'],
          remoteAddress: pin.address,
          body: ''
        })
      }),
    hasCode('FETCH_ERROR')
  );
});

test('HTTP_PROXY env is ignored: loopback sink receives no connections', async () => {
  const hits = [];
  const sink = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200);
    res.end('proxy-hit');
  });
  await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
  const proxyUrl = `http://127.0.0.1:${sink.address().port}`;
  const prev = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    http_proxy: process.env.http_proxy,
    ALL_PROXY: process.env.ALL_PROXY
  };
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.http_proxy = proxyUrl;
  process.env.ALL_PROXY = proxyUrl;

  const connects = [];
  try {
    await assert.rejects(
      () =>
        fetchArticleSafely('http://pin.example/article', {
          timeoutMs: 400,
          maxBytes: 1000,
          lookupImpl: PUBLIC_LOOKUP,
          createConnectionImpl() {
            connects.push({ host: 'pin.example' });
            const socket = new net.Socket();
            process.nextTick(() => {
              socket.destroy(Object.assign(new Error('fixture: do not reach the public pin'), { code: 'ECONNREFUSED' }));
            });
            return socket;
          }
        }),
      (err) => err.code === 'FETCH_ERROR' || err.code === 'TIMEOUT'
    );
    assert.equal(hits.length, 0, 'proxy sink must not see the article request');
    assert.ok(connects.length >= 1);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    sink.close();
  }
});

test('PIN_MISMATCH: real loopback fixture socket does not satisfy a public pin', async () => {
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body>loopback fixture</body></html>');
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixture.address().port;
  try {
    await assert.rejects(
      () =>
        fetchArticleSafely('http://pin.example/article', {
          timeoutMs: 1000,
          maxBytes: 4000,
          lookupImpl: PUBLIC_LOOKUP,
          createConnectionImpl() {
            return net.connect({ host: '127.0.0.1', port: fixturePort });
          }
        }),
      hasCode('PIN_MISMATCH')
    );
  } finally {
    fixture.close();
  }
});

test('requestImpl returning a private remoteAddress is PIN_MISMATCH before the body is trusted', async () => {
  let bodyRead = false;
  await assert.rejects(
    () =>
      fetchArticleSafely('http://8.8.8.8/', {
        timeoutMs: 500,
        maxBytes: 4000,
        requestImpl: async () => ({
          status: 200,
          headers: { 'content-type': 'text/html' },
          rawHeaders: ['Content-Type', 'text/html'],
          remoteAddress: '127.0.0.1',
          body: new Readable({
            read() {
              bodyRead = true;
              this.push('<!doctype html><html></html>');
              this.push(null);
            }
          })
        })
      }),
    hasCode('PIN_MISMATCH')
  );
  assert.equal(bodyRead, false);
});

test('content-type restrict, gzip bomb, oversized HTML, no global fetch, no cookies, GET only', async () => {
  await assert.rejects(
    () =>
      fetchArticleSafely('http://8.8.8.8/json', {
        timeoutMs: 500,
        maxBytes: 4000,
        requestImpl: async ({ pin }) => ({
          status: 200,
          headers: { 'content-type': 'application/json' },
          rawHeaders: ['Content-Type', 'application/json'],
          remoteAddress: pin.address,
          body: '{"ok":true}'
        })
      }),
    hasCode('BAD_CONTENT_TYPE')
  );

  const bomb = gzipSync(Buffer.alloc(3 * 1024 * 1024, 65));
  await assert.rejects(
    () =>
      fetchArticleSafely('http://8.8.8.8/gz', {
        timeoutMs: 2000,
        maxBytes: 2 * 1024 * 1024,
        requestImpl: async ({ pin }) => ({
          status: 200,
          headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
          rawHeaders: ['Content-Type', 'text/html', 'Content-Encoding', 'gzip'],
          remoteAddress: pin.address,
          body: bomb
        })
      }),
    hasCode('TOO_LARGE')
  );

  const nested = `${'<div>'.repeat(80)}x${'</div>'.repeat(80)}`;
  await assert.rejects(
    () =>
      fetchArticleSafely('http://8.8.8.8/nest', {
        timeoutMs: 1000,
        maxBytes: 4000,
        requestImpl: async ({ pin }) => htmlResponse(pin, `<!doctype html><html><body>${nested}</body></html>`)
      }),
    hasCode('TOO_LARGE')
  );

  let fetchHits = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetchHits += 1;
    return originalFetch(...args);
  };
  try {
    await fetchArticleSafely('http://pin.example/ok', {
      timeoutMs: 500,
      maxBytes: 4000,
      lookupImpl: PUBLIC_LOOKUP,
      requestImpl: async ({ pin, method }) => {
        assert.equal(method, 'GET');
        return htmlResponse(pin);
      }
    });
    assert.equal(fetchHits, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const pinnedSrc = await readFile('media-lens/worker/pinned-http.js', 'utf8');
  assert.match(pinnedSrc, /method: 'GET'/);
  assert.doesNotMatch(pinnedSrc, /Cookie/);
  assert.match(pinnedSrc, /Connection: 'close'/);
  assert.doesNotMatch(pinnedSrc, /globalThis\.fetch/);
});

test('slow body and caller abort cancel the fetch and do not retry', async () => {
  let requests = 0;
  const hangingBody = () =>
    new Readable({
      read() {
        // never pushes
      }
    });

  const startedAt = Date.now();
  await assert.rejects(
    () =>
      fetchArticleSafely('http://8.8.8.8/slow', {
        timeoutMs: 80,
        maxBytes: 4000,
        requestImpl: async ({ pin }) => {
          requests += 1;
          return {
            status: 200,
            headers: { 'content-type': 'text/html' },
            rawHeaders: ['Content-Type', 'text/html'],
            remoteAddress: pin.address,
            body: hangingBody()
          };
        }
      }),
    hasCode('TIMEOUT')
  );
  assert.ok(Date.now() - startedAt < 2000);
  const countAtTimeout = requests;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(requests, countAtTimeout);
  assert.equal(requests, 1);

  requests = 0;
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(
    () =>
      fetchArticleSafely('http://8.8.8.8/cancel', {
        timeoutMs: 5000,
        maxBytes: 4000,
        signal: ac.signal,
        requestImpl: async ({ pin, signal }) =>
          new Promise((resolve, reject) => {
            requests += 1;
            signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      }),
    hasCode('TIMEOUT')
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(requests, 1);
});

test('pinned lookup helper never calls dns and makePinnedLookup returns only the pin', async () => {
  const lookup = makePinnedLookup({ address: '8.8.8.8', family: 4 });
  const once = await new Promise((resolve, reject) => {
    lookup('rebind.test', {}, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(once, { address: '8.8.8.8', family: 4 });
  const all = await new Promise((resolve, reject) => {
    lookup('rebind.test', { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
  assert.deepEqual(all, [{ address: '8.8.8.8', family: 4 }]);
});

test('parseArticleUrl rejects userinfo, allows public IPv4 literals, and blocks TEST-NET', () => {
  assert.throws(() => parseArticleUrl('http://user:pass@8.8.8.8/'), hasCode('BAD_URL'));
  const parsed = parseArticleUrl('http://8.8.8.8/a');
  assert.equal(parsed.kind, 'ipv4');
  assert.equal(parsed.classified.disposition, 'allow_public');
  assert.throws(() => parseArticleUrl('http://192.0.2.7/a'), hasCode('BLOCKED_HOST'));
  assert.throws(() => parseArticleUrl('http://198.51.100.7/a'), hasCode('BLOCKED_HOST'));
  assert.throws(() => parseArticleUrl('http://203.0.113.7/a'), hasCode('BLOCKED_HOST'));
});

test('script tags in fetched HTML are data, and worker fetch modules do not eval', async () => {
  const html = '<!doctype html><html><body><script>throw new Error("executed")</script><p>ok</p></body></html>';
  const result = await fetchArticleSafely('http://8.8.8.8/script', {
    timeoutMs: 500,
    maxBytes: 4000,
    requestImpl: async ({ pin }) => htmlResponse(pin, html)
  });
  assert.match(result.html, /throw new Error\("executed"\)/);
  for (const file of ['media-lens/worker/safe-fetch.js', 'media-lens/worker/pinned-http.js', 'media-lens/worker/address-policy.js']) {
    const src = await readFile(file, 'utf8');
    assert.doesNotMatch(src, /\beval\s*\(/);
    assert.doesNotMatch(src, /new Function\s*\(/);
    assert.doesNotMatch(src, /vm\.runIn/);
  }
});
