// Resource-limit gates for Issue #118 live URL fetch (architecture §7.2
// step 8 and §10.1 item 4; implementation plan Phase 3 `fetch-limits`).
//
// Each case proves a cap that used to fail open or multiply:
//   H1 — response-header cap reaches Node (`maxHeaderSize`), article and
//        provider paths alike
//   H2 — compressed wire bytes are capped at the same budget as decoded
//        bytes (empty gzip members decode to nothing)
//   H3 — one fetch budget covers the whole redirect chain, not each hop
//   H4 — omitted limits fall back to defaults, never to unbounded
//
// Loopback fixtures and mocked lookups only. LIVE_URL stays off.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fetchArticleSafely } from '../media-lens/worker/safe-fetch.js';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_HEADER_BYTES,
  DEFAULT_TIMEOUT_MS,
  finalizePinnedResponse,
  positiveLimit
} from '../media-lens/worker/pinned-http.js';
import { providerPinnedFetch } from '../media-lens/worker/provider-pinned-fetch.js';
import { loadConfig } from '../media-lens/worker/config.js';
import {
  FIXTURE_HTML,
  PIN_HOST,
  articleUrl,
  lookupMap,
  realSocketFetchOptions,
  startHttpFixture
} from './helpers/media-lens-real-socket-fixtures.js';

function hasCode(code) {
  return (err) => err.code === code;
}

const loopbackLookup = () => lookupMap({ [PIN_HOST]: [{ address: '127.0.0.1', family: 4 }] });

function paddedHtmlHandler(padBytes) {
  return (req, res) => {
    res.setHeader('x-pad', 'x'.repeat(padBytes));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FIXTURE_HTML);
  };
}

test('LIVE_URL remains disabled by default (fetch-limits suite does not enable it)', () => {
  const config = loadConfig({});
  assert.equal(config.liveUrlEnabled, false);
  assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE_URL, 'true');
  assert.equal(config.limits.urlFetchMaxHeaderBytes, DEFAULT_MAX_HEADER_BYTES);
  assert.equal(config.limits.urlFetchMaxBytes, DEFAULT_MAX_BYTES);
  assert.equal(config.limits.urlFetchTimeoutMs, DEFAULT_TIMEOUT_MS);
});

test('H1: a response header larger than maxHeaderBytes fails closed on the article path', async () => {
  const fixture = await startHttpFixture({ onRequest: paddedHtmlHandler(12000) });
  try {
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port });
    await assert.rejects(
      () => fetchArticleSafely(url, realSocketFetchOptions({ lookupImpl: loopbackLookup(), maxHeaderBytes: 8192 })),
      (err) => err.code === 'FETCH_ERROR' && /headers exceeded/.test(err.message)
    );
  } finally {
    await fixture.close();
  }
});

test('H1: a response header under maxHeaderBytes still succeeds (cap is not a blanket header ban)', async () => {
  const fixture = await startHttpFixture({ onRequest: paddedHtmlHandler(4000) });
  try {
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port });
    const result = await fetchArticleSafely(
      url,
      realSocketFetchOptions({ lookupImpl: loopbackLookup(), maxHeaderBytes: 8192 })
    );
    assert.equal(result.html, FIXTURE_HTML);
  } finally {
    await fixture.close();
  }
});

test('H1: the provider pin client enforces the same header cap (Jev / classifier.dev path)', async () => {
  const fixture = await startHttpFixture({ onRequest: paddedHtmlHandler(12000) });
  try {
    const url = `http://127.0.0.1:${fixture.addr.port}/v1/systemone`;
    await assert.rejects(
      () => providerPinnedFetch(url, { method: 'POST', body: '{}' }, { timeoutMs: 2000, maxHeaderBytes: 8192 }),
      (err) => err.code === 'FETCH_ERROR' && /headers exceeded/.test(err.message)
    );
  } finally {
    await fixture.close();
  }
});

test('H1: source lock — pinned-http.js passes the cap under the option name Node honors', async () => {
  const src = await readFile('media-lens/worker/pinned-http.js', 'utf8');
  assert.match(src, /maxHeaderSize: headerCap/);
  assert.doesNotMatch(src, /^\s*maxHeaderBytes,\s*$/m, 'bare maxHeaderBytes in request options is ignored by Node');
});

test('H2: a compressed body whose wire bytes exceed maxBytes is TOO_LARGE even when it decodes to nothing', async () => {
  const emptyMember = gzipSync(Buffer.alloc(0));
  const wire = Buffer.concat(Array(500).fill(emptyMember)); // 10 000 wire bytes, 0 decoded
  assert.ok(wire.length > 8000);
  let bodyRequested = 0;
  await assert.rejects(
    () =>
      fetchArticleSafely('http://8.8.8.8/gz-empty', {
        timeoutMs: 2000,
        maxBytes: 8000,
        requestImpl: async ({ pin }) => {
          bodyRequested += 1;
          return {
            status: 200,
            headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
            rawHeaders: ['Content-Type', 'text/html', 'Content-Encoding', 'gzip'],
            remoteAddress: pin.address,
            body: wire
          };
        }
      }),
    hasCode('TOO_LARGE')
  );
  assert.equal(bodyRequested, 1);
});

test('H2: a compressed body under both caps still decodes normally', async () => {
  const html = '<!doctype html><html><body><p>gzip ok</p></body></html>';
  const result = await fetchArticleSafely('http://8.8.8.8/gz-ok', {
    timeoutMs: 2000,
    maxBytes: 8000,
    requestImpl: async ({ pin }) => ({
      status: 200,
      headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
      rawHeaders: ['Content-Type', 'text/html', 'Content-Encoding', 'gzip'],
      remoteAddress: pin.address,
      body: gzipSync(Buffer.from(html))
    })
  });
  assert.equal(result.html, html);
});

function slowRedirectChain({ delayMs, hops }) {
  return (req, res) => {
    const match = /^\/hop(\d+)$/.exec(req.url);
    const n = match ? Number(match[1]) : 0;
    setTimeout(() => {
      if (res.destroyed || req.socket.destroyed) return;
      if (n < hops) {
        res.writeHead(302, { location: `/hop${n + 1}` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(FIXTURE_HTML);
    }, delayMs);
  };
}

test('H3: timeoutMs is one budget for the whole redirect chain, not per hop', async () => {
  const fixture = await startHttpFixture({ onRequest: slowRedirectChain({ delayMs: 300, hops: 3 }) });
  try {
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port, path: '/hop0' });
    const started = Date.now();
    await assert.rejects(
      () =>
        fetchArticleSafely(
          url,
          realSocketFetchOptions({ lookupImpl: loopbackLookup(), timeoutMs: 700, maxRedirects: 3 })
        ),
      hasCode('TIMEOUT')
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1100, `chain aborted at ${elapsed}ms; per-hop budgets would allow 1200ms+`);
    // Give the fixture a moment to observe any hop the client should not have started.
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(fixture.seen.urls.length <= 3, `hops seen: ${fixture.seen.urls.join(',')}`);
    assert.ok(!fixture.seen.urls.includes('/hop3'), 'final hop must not be requested after the deadline');
  } finally {
    await fixture.close();
  }
});

test('H3: the same chain completes when the whole-chain budget covers it', async () => {
  const fixture = await startHttpFixture({ onRequest: slowRedirectChain({ delayMs: 50, hops: 3 }) });
  try {
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port, path: '/hop0' });
    const result = await fetchArticleSafely(
      url,
      realSocketFetchOptions({ lookupImpl: loopbackLookup(), timeoutMs: 3000, maxRedirects: 3 })
    );
    assert.equal(result.html, FIXTURE_HTML);
    assert.deepEqual(fixture.seen.urls, ['/hop0', '/hop1', '/hop2', '/hop3']);
    assert.equal(fixture.seen.connections, 4, 'each hop is a new pinned connection');
  } finally {
    await fixture.close();
  }
});

test('H3: an already-aborted caller signal is TIMEOUT before any hop connects', async () => {
  const fixture = await startHttpFixture();
  try {
    const controller = new AbortController();
    controller.abort();
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port });
    await assert.rejects(
      () => fetchArticleSafely(url, realSocketFetchOptions({ lookupImpl: loopbackLookup(), signal: controller.signal })),
      hasCode('TIMEOUT')
    );
    assert.equal(fixture.seen.connections, 0);
  } finally {
    await fixture.close();
  }
});

test('H4: omitting maxBytes applies the 2 MiB default byte cap, not an unbounded read', async () => {
  const chunk = Buffer.from(`<p>${'a'.repeat(65536 - 7)}</p>`);
  const fixture = await startHttpFixture({
    onRequest: (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.write('<!doctype html><html><body>');
      let sent = 0;
      const pump = () => {
        while (sent < DEFAULT_MAX_BYTES + 4 * chunk.length) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        res.end('</body></html>');
      };
      pump();
    }
  });
  try {
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port });
    await assert.rejects(
      () =>
        fetchArticleSafely(url, {
          lookupImpl: loopbackLookup(),
          classifyImpl: realSocketFetchOptions().classifyImpl,
          parseTimeoutMs: 20000
        }),
      (err) => err.code === 'TOO_LARGE' && /exceeded the size limit/.test(err.message)
    );
  } finally {
    await fixture.close();
  }
});

test('H4: omitting timeoutMs applies the 8 s default and does not abort a normal fetch', async () => {
  const fixture = await startHttpFixture();
  try {
    const url = articleUrl({ hostname: PIN_HOST, port: fixture.addr.port });
    const result = await fetchArticleSafely(url, {
      lookupImpl: loopbackLookup(),
      classifyImpl: realSocketFetchOptions().classifyImpl
    });
    assert.equal(result.html, FIXTURE_HTML);
  } finally {
    await fixture.close();
  }
});

test('H4: positiveLimit and finalizePinnedResponse never treat a missing cap as unbounded', async () => {
  assert.equal(positiveLimit(undefined, 7), 7);
  assert.equal(positiveLimit(null, 7), 7);
  assert.equal(positiveLimit(0, 7), 7);
  assert.equal(positiveLimit(-1, 7), 7);
  assert.equal(positiveLimit(Number.NaN, 7), 7);
  assert.equal(positiveLimit('8192', 7), 7);
  assert.equal(positiveLimit(8192, 7), 8192);

  const pin = { address: '8.8.8.8', family: 4 };
  const oversized = Buffer.alloc(DEFAULT_MAX_BYTES + 1, 65);
  const finalized = await finalizePinnedResponse(
    {
      status: 200,
      headers: { 'content-type': 'text/html' },
      rawHeaders: ['Content-Type', 'text/html'],
      remoteAddress: pin.address,
      body: oversized
    },
    { pin }
  );
  await assert.rejects(() => finalized.readHtml(), hasCode('TOO_LARGE'));
});
