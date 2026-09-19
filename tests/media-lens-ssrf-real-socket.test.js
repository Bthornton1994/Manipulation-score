// Real net.connect / tls.connect coverage for Issue #118 pin/SNI/cert/re-pin.
//
// These cases must NOT pass createConnectionImpl or requestImpl. Independent
// QA mutants that survived the injected-client suite are killed here:
//   M1  — remove pin from createConnection (system DNS for .invalid)
//   M6  — omit SNI (servername) when connecting to a pinned IP
//   M7  — rejectUnauthorized: false / accept any cert
//   M10 — reuse first-hop pin on redirect (DNS-name Location, not IP literal)
//
// Loopback 127.0.0.1 / ::1 and a process-local CA only. LIVE_URL stays off.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetchArticleSafely,
  pinHost
} from '../media-lens/worker/safe-fetch.js';
import { classifyIp } from '../media-lens/worker/address-policy.js';
import { loadConfig } from '../media-lens/worker/config.js';
import {
  FIXTURE_HTML,
  SECRET_HTML,
  PIN_HOST,
  PRIVATE_REDIRECT_HOST,
  WRONG_CERT_HOST,
  classifyLoopbackFixture,
  lookupMap,
  makeLocalCa,
  makeHostCert,
  startHttpFixture,
  startHttpsFixture,
  articleUrl,
  realSocketFetchOptions
} from './helpers/media-lens-real-socket-fixtures.js';

function hasCode(code) {
  return (err) => err.code === code;
}

function loopbackLookup(address, family) {
  return lookupMap({
    [PIN_HOST]: [{ address, family }]
  });
}

test('LIVE_URL remains disabled by default (real-socket suite does not enable it)', () => {
  const config = loadConfig({});
  assert.equal(config.liveUrlEnabled, false);
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE_URL, 'true');
});

test('production classifyIp still blocks loopback; classifyImpl is a test seam only', async () => {
  assert.equal(classifyIp('127.0.0.1').disposition, 'block');
  assert.equal(classifyIp('::1').disposition, 'block');
  await assert.rejects(
    () =>
      fetchArticleSafely(articleUrl({ hostname: PIN_HOST, port: 9 }), {
        timeoutMs: 200,
        maxBytes: 1000,
        lookupImpl: loopbackLookup('127.0.0.1', 4)
      }),
    hasCode('BLOCKED_HOST')
  );
  await assert.rejects(
    () =>
      pinHost(PIN_HOST, {
        lookupImpl: loopbackLookup('127.0.0.1', 4)
      }),
    hasCode('BLOCKED_HOST')
  );
});

test('M1: hostname fetch uses the connect-time pin, not system DNS (127.0.0.1)', async () => {
  const fixture = await startHttpFixture({ host: '127.0.0.1' });
  try {
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port });
    const result = await fetchArticleSafely(
      url,
      realSocketFetchOptions({
        lookupImpl: loopbackLookup('127.0.0.1', 4)
      })
    );
    assert.equal(result.html, FIXTURE_HTML);
    assert.equal(result.pin.address, '127.0.0.1');
    assert.equal(fixture.seen.connections, 1);
    assert.ok(fixture.seen.hosts[0].startsWith(PIN_HOST));
    assert.equal(fixture.seen.urls[0], '/article');
  } finally {
    await fixture.close();
  }
});

test('M1: hostname fetch uses the connect-time pin, not system DNS (::1)', async () => {
  const fixture = await startHttpFixture({ host: '::1' });
  try {
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port });
    const result = await fetchArticleSafely(
      url,
      realSocketFetchOptions({
        lookupImpl: loopbackLookup('::1', 6)
      })
    );
    assert.equal(result.html, FIXTURE_HTML);
    assert.equal(result.pin.address, '::1');
    assert.equal(fixture.seen.connections, 1);
    assert.ok(fixture.seen.hosts[0].startsWith(PIN_HOST));
  } finally {
    await fixture.close();
  }
});

test('M6: TLS to a pinned IP presents SNI for the original hostname', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-sni-'));
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
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port, https: true });
    const result = await fetchArticleSafely(
      url,
      realSocketFetchOptions({
        lookupImpl: loopbackLookup('127.0.0.1', 4),
        tlsCa: ca.pem
      })
    );
    assert.equal(result.html, FIXTURE_HTML);
    assert.deepEqual(fixture.seen.sni, [PIN_HOST]);
    assert.ok(fixture.seen.hosts[0].startsWith(PIN_HOST));
  } finally {
    await fixture.close();
  }
});

test('M7: wrong-hostname certificate fails closed as TLS_ERROR', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-lens-cert-'));
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
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port, https: true });
    await assert.rejects(
      () =>
        fetchArticleSafely(
          url,
          realSocketFetchOptions({
            lookupImpl: loopbackLookup('127.0.0.1', 4),
            tlsCa: ca.pem
          })
        ),
      hasCode('TLS_ERROR')
    );
    assert.equal(fixture.seen.urls.length, 0, 'HTTP request must not proceed after TLS identity failure');
  } finally {
    await fixture.close();
  }
});

test('M10: redirect to a DNS name that resolves private is BLOCKED_HOST after re-pin', async () => {
  let secretHits = 0;
  const fixture = await startHttpFixture({
    host: '127.0.0.1',
    onRequest(req, res) {
      if (req.url === '/start') {
        const location = articleUrl({
          hostname: PRIVATE_REDIRECT_HOST,
          port: fixture.addr.port,
          path: '/secret'
        });
        res.writeHead(302, { Location: location });
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
    const start = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port, path: '/start' });
    await assert.rejects(
      () =>
        fetchArticleSafely(
          start,
          realSocketFetchOptions({
            lookupImpl: lookupMap({
              [PIN_HOST]: [{ address: '127.0.0.1', family: 4 }],
              [PRIVATE_REDIRECT_HOST]: [{ address: '169.254.169.254', family: 4 }]
            })
          })
        ),
      hasCode('BLOCKED_HOST')
    );
    assert.equal(secretHits, 0);
    assert.deepEqual(fixture.seen.urls, ['/start']);
    assert.equal(classifyLoopbackFixture('169.254.169.254').disposition, 'block');
  } finally {
    await fixture.close();
  }
});
