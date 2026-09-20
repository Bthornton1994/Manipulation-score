// Mutation evidence for Issue #118 critical live-URL controls.
// Each case patches a copy of the module, imports it, and shows the
// mutated control would fail closed policy. The live modules keep the control.
//
// Pin/SNI/cert/re-pin mutants (M1, M6, M7, M10) are also run against the
// real net.connect/tls.connect fixtures in tests/media-lens-ssrf-real-socket.test.js.
// Those live tests fail if the pin, SNI, certificate identity, or redirect
// re-pin is removed. The mutation cases below document the surviving-wrong
// behavior those tests are designed to kill.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyIp } from '../media-lens/worker/address-policy.js';
import {
  FIXTURE_HTML,
  SECRET_HTML,
  PIN_HOST,
  PRIVATE_REDIRECT_HOST,
  WRONG_CERT_HOST,
  lookupMap,
  makeLocalCa,
  makeHostCert,
  startHttpFixture,
  startHttpsFixture,
  articleUrl,
  realSocketFetchOptions
} from './helpers/media-lens-real-socket-fixtures.js';

async function loadMutatedAddressPolicy(mutate) {
  const original = await readFile('media-lens/worker/address-policy.js', 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, 'mutator must change the source');
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-ssrf-mutation-'));
  const dest = join(dir, 'address-policy.js');
  await writeFile(dest, mutated);
  return import(pathToFileURL(dest).href);
}

async function loadMutatedFetchStack({ mutatePinned = (src) => src, mutateFetch = (src) => src } = {}) {
  const policy = await readFile('media-lens/worker/address-policy.js', 'utf8');
  const pinnedOriginal = await readFile('media-lens/worker/pinned-http.js', 'utf8');
  const fetchOriginal = await readFile('media-lens/worker/safe-fetch.js', 'utf8');
  const hostKey = await readFile('media-lens/worker/host-key.js', 'utf8');
  const pinned = mutatePinned(pinnedOriginal);
  const fetchSrc = mutateFetch(fetchOriginal);
  assert.ok(pinned !== pinnedOriginal || fetchSrc !== fetchOriginal, 'mutator must change the fetch stack');
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-ssrf-fetch-mutation-'));
  await writeFile(join(dir, 'address-policy.js'), policy);
  await writeFile(join(dir, 'pinned-http.js'), pinned);
  await writeFile(join(dir, 'safe-fetch.js'), fetchSrc);
  await writeFile(join(dir, 'host-key.js'), hostKey);
  return import(pathToFileURL(join(dir, 'safe-fetch.js')).href);
}

test('mutation: dropping well-known NAT64 extraction still blocks via unknown-NAT64 catch-all', async () => {
  assert.equal(classifyIp('64:ff9b::7f00:1').reason, 'block_loopback_via_nat64');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0)',
      'if (false && words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0)'
    )
  );
  const loopback = mutant.classifyIp('64:ff9b::7f00:1');
  assert.equal(loopback.disposition, 'block');
  assert.equal(loopback.reason, 'block_nat64_unknown');
  assert.equal(mutant.classifyIp('64:ff9b::cb00:7107').disposition, 'block');
});

test('mutation: dropping local-use NAT64 extraction still blocks via unknown-NAT64 catch-all', async () => {
  assert.equal(classifyIp('64:ff9b:1:7f00:0:100::').reason, 'block_loopback_via_nat64_local');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0x0001)',
      'if (false && words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0x0001)'
    )
  );
  const loopback = mutant.classifyIp('64:ff9b:1:7f00:0:100::');
  assert.equal(loopback.disposition, 'block');
  assert.equal(loopback.reason, 'block_nat64_unknown');
  assert.equal(mutant.classifyIp('64:ff9b:1:cb00:71:700::').disposition, 'block');
});

test('mutation: dropping ISATAP detection still blocks via residual ISATAP fail-closed', async () => {
  assert.equal(classifyIp('2001:470:1:2:0:5efe:7f00:1').reason, 'block_loopback_via_isatap');
  assert.equal(classifyIp('2001:470:1:2:0:5efe:cb00:7107').reason, 'block_isatap');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (isIsatapIid(words)) {\n    return classifyFailClosedEmbedding(hextetToIPv4(words[6], words[7]), 6, canonical, \'isatap\');\n  }',
      'if (false && isIsatapIid(words)) {\n    return classifyFailClosedEmbedding(hextetToIPv4(words[6], words[7]), 6, canonical, \'isatap\');\n  }'
    )
  );
  const loopback = mutant.classifyIp('2001:470:1:2:0:5efe:7f00:1');
  assert.equal(loopback.disposition, 'block');
  assert.equal(loopback.reason, 'block_loopback_via_isatap');
  const publicIsatap = mutant.classifyIp('2001:470:1:2:0:5efe:cb00:7107');
  assert.equal(publicIsatap.disposition, 'block');
  assert.equal(publicIsatap.reason, 'block_isatap');
  assert.equal(publicIsatap.embeddedIPv4, '203.0.113.7');
  assert.equal(mutant.classifyIp('2606:4700:10::6814:179a').disposition, 'allow_public');
});

test('mutation: dropping extra NAT64 would allow private last-32 embeddings as public IPv6', async () => {
  assert.equal(classifyIp('2001:470:1::7f00:1').reason, 'block_loopback_via_nat64_extra');
  assert.equal(classifyIp('2001:67c:27e4:64:ff:9b:7f00:1').reason, 'block_loopback_via_nat64_extra');
  assert.equal(classifyIp('2606:4700:10::6814:179a').disposition, 'allow_public');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (ipv4FirstOctet(ipv4) !== 0) {\n      const inner = classifyIPv4(ipv4);\n      if (inner.disposition === \'block\') {\n        return classifyFailClosedEmbedding(ipv4, 6, canonical, \'nat64_extra\');\n      }\n    }',
      'if (false && ipv4FirstOctet(ipv4) !== 0) {\n      const inner = classifyIPv4(ipv4);\n      if (inner.disposition === \'block\') {\n        return classifyFailClosedEmbedding(ipv4, 6, canonical, \'nat64_extra\');\n      }\n    }'
    )
  );
  assert.equal(mutant.classifyIp('2001:470:1::7f00:1').disposition, 'allow_public');
  assert.equal(mutant.classifyIp('2001:470:1::cb00:7107').disposition, 'allow_public');
  assert.equal(mutant.classifyIp('2001:67c:27e4:64:ff:9b:7f00:1').disposition, 'allow_public');
  assert.equal(mutant.classifyIp('2001:67c:27e4:64:ff:9b:cb00:7107').disposition, 'allow_public');
  assert.equal(mutant.classifyIp('2606:4700:4700:1:2:3:a9fe:a9fe').disposition, 'allow_public');
});

test('mutation: dropping unknown NAT64 catch-all would allow 64:ff9b:2::1 as public IPv6', async () => {
  assert.equal(classifyIp('64:ff9b:2::1').reason, 'block_nat64_unknown');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      "if (words[0] === 0x64 && words[1] === 0xff9b) {\n    return blockResult('block_nat64_unknown', { family: 6, canonical });\n  }",
      "if (false && words[0] === 0x64 && words[1] === 0xff9b) {\n    return blockResult('block_nat64_unknown', { family: 6, canonical });\n  }"
    )
  );
  assert.equal(mutant.classifyIp('64:ff9b:2::1').disposition, 'allow_public');
});

test('mutation: dropping IPv6 benchmarking 2001:2::/48 would allow it as public unicast', async () => {
  assert.equal(classifyIp('2001:2::1').reason, 'block_benchmark');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0x2001 && words[1] === 0x0002)',
      'if (false && words[0] === 0x2001 && words[1] === 0x0002)'
    )
  );
  assert.equal(mutant.classifyIp('2001:2::1').disposition, 'allow_public');
});

test('mutation: dropping RFC 3879 site-local fec0::/10 would allow it as public unicast', async () => {
  assert.equal(classifyIp('fec0::1').reason, 'block_site_local');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if ((words[0] & 0xffc0) === 0xfec0)',
      'if (false && (words[0] & 0xffc0) === 0xfec0)'
    )
  );
  assert.equal(mutant.classifyIp('fec0::1').disposition, 'allow_public');
  assert.equal(mutant.classifyIp('feff::1').disposition, 'allow_public');
});

test('mutation: dropping 6bone 3ffe::/16 would allow it as public unicast', async () => {
  assert.equal(classifyIp('3ffe::1').reason, 'block_6bone');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0x3ffe)',
      'if (false && words[0] === 0x3ffe)'
    )
  );
  assert.equal(mutant.classifyIp('3ffe::1').disposition, 'allow_public');
  assert.equal(mutant.classifyIp('3ffe:ffff::1').disposition, 'allow_public');
});

test('mutation: dropping SIIT extraction still blocks via extra-NAT64 catch-all', async () => {
  assert.equal(classifyIp('::ffff:0:7f00:1').disposition, 'block');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0xffff && words[5] === 0)',
      'if (false && words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0xffff && words[5] === 0)'
    )
  );
  const loopback = mutant.classifyIp('::ffff:0:7f00:1');
  assert.equal(loopback.disposition, 'block');
  assert.equal(loopback.reason, 'block_loopback_via_nat64_extra');
});

test('mutation: dropping ::/96 compatible extraction still blocks via extra-NAT64 catch-all', async () => {
  assert.equal(classifyIp('::7f00:1').disposition, 'block');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) {\n    return classifyEmbeddedIPv4(hextetToIPv4(words[6], words[7]), 6, canonical, \'compat96\');\n  }',
      'if (false) {\n    return classifyEmbeddedIPv4(hextetToIPv4(words[6], words[7]), 6, canonical, \'compat96\');\n  }'
    )
  );
  const loopback = mutant.classifyIp('::7f00:1');
  assert.equal(loopback.disposition, 'block');
  assert.equal(loopback.reason, 'block_loopback_via_nat64_extra');
});

test('mutation: dropping mapped ::ffff:0:0/96 extraction still blocks via extra-NAT64 catch-all', async () => {
  assert.equal(classifyIp('::ffff:7f00:1').disposition, 'block');
  const mutant = await loadMutatedAddressPolicy((src) =>
    src.replace(
      'if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff)',
      'if (false && words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff)'
    )
  );
  const loopback = mutant.classifyIp('::ffff:7f00:1');
  assert.equal(loopback.disposition, 'block');
  assert.equal(loopback.reason, 'block_loopback_via_nat64_extra');
});

test('source: live URL gate, pin lookup, and no check-then-global-fetch', async () => {
  const serverSrc = await readFile('media-lens/worker/server.js', 'utf8');
  const urlBlock = serverSrc.slice(serverSrc.indexOf("if (payload.mode === 'url')"));
  assert.match(urlBlock, /liveUrlEnabled/);
  assert.match(urlBlock, /live_url_disabled/);
  assert.ok(
    urlBlock.indexOf('liveUrlEnabled') < urlBlock.indexOf('fetchArticleSafely'),
    'LIVE_URL gate must run before fetchArticleSafely'
  );

  const fetchSrc = await readFile('media-lens/worker/safe-fetch.js', 'utf8');
  assert.doesNotMatch(fetchSrc, /fetchImpl\s*=\s*globalThis\.fetch/);
  assert.match(fetchSrc, /pinHost/);
  assert.match(fetchSrc, /REDIRECT_DOWNGRADE/);

  const pinSrc = await readFile('media-lens/worker/pinned-http.js', 'utf8');
  assert.match(pinSrc, /makePinnedLookup/);
  assert.match(pinSrc, /remoteAddress/);
  assert.match(pinSrc, /PIN_MISMATCH/);
  assert.doesNotMatch(pinSrc, /process\.env/);

  const configSrc = await readFile('media-lens/worker/config.js', 'utf8');
  assert.match(configSrc, /MEDIA_LENS_ENABLE_LIVE_URL/);
  assert.match(configSrc, /liveUrlEnabled/);
});

test('source: createConnection pins host, sends SNI, and rejects unauthorized certs', async () => {
  const pinSrc = await readFile('media-lens/worker/pinned-http.js', 'utf8');
  assert.match(pinSrc, /host: pin\.address/);
  assert.match(pinSrc, /hostname: pin\.address/);
  assert.match(pinSrc, /servername: isIpHostname\(requestHostname\) \? undefined : requestHostname/);
  assert.match(pinSrc, /rejectUnauthorized: true/);
  assert.match(pinSrc, /tls\.connect/);
  assert.match(pinSrc, /net\.connect/);

  const fetchSrc = await readFile('media-lens/worker/safe-fetch.js', 'utf8');
  const pinCalls = fetchSrc.split('await pinHost(').length - 1;
  assert.equal(pinCalls, 2, 'assertHostIsPublic plus one pinHost per redirect hop');
  assert.match(fetchSrc, /const pin = await pinHost\(parsed\.hostname/);
});

test('mutation M1: removing the createConnection pin uses system DNS and fails the real-socket fetch', async () => {
  const mutant = await loadMutatedFetchStack({
    mutatePinned: (src) =>
      src.replace(
        `      const pinnedOptions = {
        ...options,
        host: pin.address,
        hostname: pin.address,
        family: pin.family,
        lookup
      };`,
        `      const pinnedOptions = {
        ...options
      };
      delete pinnedOptions.lookup;
      delete pinnedOptions.servername;`
      )
  });
  const fixture = await startHttpFixture({ host: '127.0.0.1' });
  try {
    await assert.rejects(
      () =>
        mutant.fetchArticleSafely(
          articleUrl({ hostname: PIN_HOST, port: fixture.addr.port }),
          realSocketFetchOptions({
            lookupImpl: lookupMap({ [PIN_HOST]: [{ address: '127.0.0.1', family: 4 }] })
          })
        ),
      (err) => err.code === 'FETCH_ERROR' || err.code === 'DNS_ERROR' || err.code === 'TIMEOUT'
    );
    assert.equal(fixture.seen.connections, 0, 'unpinned connect must not hit the loopback fixture via system DNS');
  } finally {
    await fixture.close();
  }
});

test('mutation M6: omitting SNI fails the real TLS fixture that requires the original hostname', async () => {
  const mutant = await loadMutatedFetchStack({
    mutatePinned: (src) =>
      src
        .replaceAll(
          'servername: isIpHostname(requestHostname) ? undefined : requestHostname',
          'servername: undefined'
        )
        .replace(
          'options.servername = isIpHostname(requestHostname) ? undefined : requestHostname;',
          'options.servername = undefined;'
        )
  });
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-mut-sni-'));
  const ca = await makeLocalCa(dir);
  const matching = await makeHostCert(dir, ca, PIN_HOST);
  const wrong = await makeHostCert(dir, ca, WRONG_CERT_HOST);
  const fixture = await startHttpsFixture({
    host: '127.0.0.1',
    defaultHost: WRONG_CERT_HOST,
    contexts: { [PIN_HOST]: matching, [WRONG_CERT_HOST]: wrong },
    missingSni: 'reject'
  });
  try {
    await assert.rejects(
      () =>
        mutant.fetchArticleSafely(
          articleUrl({ hostname: PIN_HOST, port: fixture.addr.port, https: true }),
          realSocketFetchOptions({
            lookupImpl: lookupMap({ [PIN_HOST]: [{ address: '127.0.0.1', family: 4 }] }),
            tlsCa: ca.pem
          })
        ),
      (err) => err.code === 'TLS_ERROR' || err.code === 'FETCH_ERROR'
    );
    assert.ok(fixture.seen.sni.every((name) => name == null), 'M6 mutant must not present the hostname as SNI');
    assert.equal(fixture.seen.urls.length, 0);
  } finally {
    await fixture.close();
  }
});

test('mutation M7: accept-any-cert would allow a wrong-hostname certificate', async () => {
  const mutant = await loadMutatedFetchStack({
    mutatePinned: (src) =>
      src
        .replaceAll('rejectUnauthorized: true', 'rejectUnauthorized: false')
        .replace(
          'checkServerIdentity: (name, cert) => tls.checkServerIdentity(isIpHostname(requestHostname) ? requestHostname : requestHostname, cert)',
          'checkServerIdentity: () => undefined'
        )
        .replace(
          `options.checkServerIdentity = (name, cert) => {
        const identity = isIpHostname(requestHostname) ? requestHostname : requestHostname;
        return tls.checkServerIdentity(identity, cert);
      };`,
          'options.checkServerIdentity = () => undefined;'
        )
  });
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-mut-cert-'));
  const ca = await makeLocalCa(dir);
  const matching = await makeHostCert(dir, ca, PIN_HOST);
  const wrong = await makeHostCert(dir, ca, WRONG_CERT_HOST);
  const fixture = await startHttpsFixture({
    host: '127.0.0.1',
    defaultHost: WRONG_CERT_HOST,
    contexts: { [PIN_HOST]: wrong, [WRONG_CERT_HOST]: wrong, _: matching },
    missingSni: WRONG_CERT_HOST
  });
  try {
    const result = await mutant.fetchArticleSafely(
      articleUrl({ hostname: PIN_HOST, port: fixture.addr.port, https: true }),
      realSocketFetchOptions({
        lookupImpl: lookupMap({ [PIN_HOST]: [{ address: '127.0.0.1', family: 4 }] }),
        tlsCa: ca.pem
      })
    );
    assert.equal(result.html, FIXTURE_HTML);
  } finally {
    await fixture.close();
  }
});

test('mutation M10: reusing the first-hop pin follows a DNS redirect to a private name', async () => {
  const mutant = await loadMutatedFetchStack({
    mutateFetch: (src) =>
      src
        .replace(
          'let currentUrl = targetUrl;\n  let previousScheme = null;\n  const request = requestImpl || defaultRequestImpl;',
          'let currentUrl = targetUrl;\n  let previousScheme = null;\n  let firstPin = null;\n  const request = requestImpl || defaultRequestImpl;'
        )
        .replace(
          'const pin = await pinHost(parsed.hostname, { lookupImpl, classifyImpl });',
          'const pin = hop === 0 ? (firstPin = await pinHost(parsed.hostname, { lookupImpl, classifyImpl })) : firstPin;'
        )
  });
  let secretHits = 0;
  const fixture = await startHttpFixture({
    host: '127.0.0.1',
    onRequest(req, res) {
      if (req.url === '/start') {
        res.writeHead(302, {
          Location: articleUrl({
            hostname: PRIVATE_REDIRECT_HOST,
            port: fixture.addr.port,
            path: '/secret'
          })
        });
        res.end();
        return;
      }
      if (req.url === '/secret') {
        secretHits += 1;
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(SECRET_HTML);
        return;
      }
      res.writeHead(404);
      res.end();
    }
  });
  try {
    const result = await mutant.fetchArticleSafely(
      articleUrl({ hostname: PIN_HOST, port: fixture.addr.port, path: '/start' }),
      realSocketFetchOptions({
        lookupImpl: lookupMap({
          [PIN_HOST]: [{ address: '127.0.0.1', family: 4 }],
          [PRIVATE_REDIRECT_HOST]: [{ address: '169.254.169.254', family: 4 }]
        })
      })
    );
    assert.equal(result.html, SECRET_HTML);
    assert.equal(secretHits, 1);
  } finally {
    await fixture.close();
  }
});
