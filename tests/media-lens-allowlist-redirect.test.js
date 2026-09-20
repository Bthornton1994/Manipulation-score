// Issue #118 remediation A: canary hostname allowlist is hop-scoped.
// Local DNS/request mocks only. Live URL flags stay off except in these
// opt-in worker fixtures. No TypeSafe key is used for a live network call.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchArticleSafely } from '../media-lens/worker/safe-fetch.js';
import { createServer } from '../media-lens/worker/server.js';
import { loadConfig, effectiveLiveFlags } from '../media-lens/worker/config.js';
import { createAuditLogger } from '../media-lens/worker/audit.js';
import http from 'node:http';

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

const PUBLIC_LOOKUP = async () => [{ address: '8.8.8.8', family: 4 }];

function requestJson(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: address.address,
        port: address.port,
        method,
        path,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function liveUrlConfig(extra = {}) {
  return loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_ENABLE_LIVE_URL: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'sk-test-key-not-for-logs',
    MEDIA_LENS_PORT: '0',
    ...extra
  });
}

test('same-host relative redirect is allowed when the host remains allowlisted', async () => {
  const hops = [];
  const result = await fetchArticleSafely('http://allowed.example/start', {
    timeoutMs: 1000,
    maxBytes: 4000,
    urlAllowlist: ['allowed.example'],
    lookupImpl: PUBLIC_LOOKUP,
    requestImpl: async ({ parsed, pin }) => {
      hops.push(`${parsed.hostname}${parsed.pathname}`);
      if (parsed.pathname === '/start') return redirectResponse(pin, '/next');
      assert.equal(parsed.hostname, 'allowed.example');
      assert.equal(parsed.pathname, '/next');
      return htmlResponse(pin);
    }
  });
  assert.deepEqual(hops, ['allowed.example/start', 'allowed.example/next']);
  assert.match(result.html, /Public article fixture/);
  assert.equal(result.finalUrl, 'http://allowed.example/next');
});

test('off-allowlist redirect hop is fail-closed and does not return 200 from the hop', async () => {
  const hops = [];
  let lookups = 0;
  const lookupImpl = async (hostname) => {
    lookups += 1;
    assert.notEqual(String(hostname).toLowerCase(), 'other.example', 'must not pin/lookup an off-allowlist hop');
    return [{ address: '8.8.8.8', family: 4 }];
  };

  await assert.rejects(
    () =>
      fetchArticleSafely('http://allowed.example/start', {
        timeoutMs: 1000,
        maxBytes: 4000,
        urlAllowlist: ['allowed.example'],
        lookupImpl,
        requestImpl: async ({ parsed, pin }) => {
          hops.push(`${parsed.hostname}${parsed.pathname}`);
          if (parsed.hostname === 'other.example') {
            return htmlResponse(pin, '<!doctype html><html><body><p>leaked hop must not be fetched</p></body></html>');
          }
          return redirectResponse(pin, 'http://other.example/secret');
        }
      }),
    hasCode('live_url_not_allowlisted')
  );
  assert.deepEqual(hops, ['allowed.example/start']);
  assert.equal(lookups, 1);
});

test('protocol-relative redirect to an off-allowlist host is fail-closed', async () => {
  const hops = [];
  await assert.rejects(
    () =>
      fetchArticleSafely('http://allowed.example/start', {
        timeoutMs: 1000,
        maxBytes: 4000,
        urlAllowlist: ['allowed.example'],
        lookupImpl: PUBLIC_LOOKUP,
        requestImpl: async ({ parsed, pin }) => {
          hops.push(parsed.hostname);
          return redirectResponse(pin, '//other.example/x');
        }
      }),
    hasCode('live_url_not_allowlisted')
  );
  assert.deepEqual(hops, ['allowed.example']);
});

test('empty canary allowlist still follows a public cross-host redirect (policy only)', async () => {
  const hops = [];
  const result = await fetchArticleSafely('http://allowed.example/start', {
    timeoutMs: 1000,
    maxBytes: 4000,
    lookupImpl: PUBLIC_LOOKUP,
    requestImpl: async ({ parsed, pin }) => {
      hops.push(`${parsed.hostname}${parsed.pathname}`);
      if (parsed.hostname === 'allowed.example') return redirectResponse(pin, 'http://other.example/next');
      return htmlResponse(pin);
    }
  });
  assert.deepEqual(hops, ['allowed.example/start', 'other.example/next']);
  assert.match(result.html, /Public article fixture/);
});

test('HTTPS to HTTP still fails as REDIRECT_DOWNGRADE even when both hosts are allowlisted', async () => {
  await assert.rejects(
    () =>
      fetchArticleSafely('https://allowed.example/start', {
        timeoutMs: 1000,
        maxBytes: 1000,
        urlAllowlist: ['allowed.example', 'also.example'],
        lookupImpl: PUBLIC_LOOKUP,
        requestImpl: async ({ pin }) => redirectResponse(pin, 'http://also.example/')
      }),
    hasCode('REDIRECT_DOWNGRADE')
  );
});

test('private redirect still fails as BLOCKED_HOST before allowlist when Location is loopback', async () => {
  let secondHop = false;
  await assert.rejects(
    () =>
      fetchArticleSafely('http://allowed.example/start', {
        timeoutMs: 1000,
        maxBytes: 1000,
        urlAllowlist: ['allowed.example'],
        lookupImpl: PUBLIC_LOOKUP,
        requestImpl: async ({ parsed, pin }) => {
          if (parsed.hostname !== 'allowed.example') secondHop = true;
          return redirectResponse(pin, 'http://127.0.0.1/secret');
        }
      }),
    hasCode('BLOCKED_HOST')
  );
  assert.equal(secondHop, false);
});

test('fetchArticleSafely rejects an initial off-allowlist host before pin or connect', async () => {
  let lookups = 0;
  let connects = 0;
  await assert.rejects(
    () =>
      fetchArticleSafely('http://denied.example/article', {
        timeoutMs: 200,
        maxBytes: 1000,
        urlAllowlist: ['allowed.example'],
        lookupImpl: async () => {
          lookups += 1;
          throw new Error('must not lookup an off-allowlist host');
        },
        requestImpl: async () => {
          connects += 1;
          throw new Error('must not connect');
        }
      }),
    hasCode('live_url_not_allowlisted')
  );
  assert.equal(lookups, 0);
  assert.equal(connects, 0);
});

test('live flags remain disabled by default and classifier.dev stays off', () => {
  const unset = loadConfig({});
  assert.equal(unset.mode, 'fixture');
  assert.equal(unset.liveEnabled, false);
  assert.equal(unset.liveUrlEnabled, false);
  assert.equal(unset.classifierDev.enabled, false);
  assert.equal(effectiveLiveFlags(unset).liveEnabled, false);
  assert.equal(effectiveLiveFlags(unset).liveUrlEnabled, false);
  assert.equal(effectiveLiveFlags(unset).classifierDevEnabled, false);
  assert.equal(unset.urlAllowlist.length, 0);
});

test('/analyze blocks an off-allowlist redirect hop with 400, not a 200 hop body', async () => {
  const hops = [];
  const lines = [];
  const config = liveUrlConfig({ MEDIA_LENS_URL_ALLOWLIST: 'allowed.example' });
  const server = await listen(
    createServer(config, {
      auditLogger: createAuditLogger({ write: (line) => lines.push(line) }),
      fetchArticle: (url, options) =>
        fetchArticleSafely(url, {
          ...options,
          timeoutMs: 1000,
          maxBytes: 4000,
          lookupImpl: PUBLIC_LOOKUP,
          requestImpl: async ({ parsed, pin }) => {
            hops.push(`${parsed.hostname}${parsed.pathname}`);
            if (parsed.hostname === 'other.example') {
              throw new Error('must not connect to an off-allowlist hop');
            }
            return redirectResponse(pin, 'http://other.example/secret');
          }
        })
    })
  );
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'url', url: 'http://allowed.example/start' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'live_url_not_allowlisted');
    assert.notEqual(res.status, 200);
    assert.deepEqual(hops, ['allowed.example/start']);
    const events = lines.map((line) => JSON.parse(line));
    assert.ok(
      events.some(
        (event) => event.event === 'live_url_blocked' && event.error === 'live_url_not_allowlisted' && event.allowlist_configured === true
      )
    );
    assert.doesNotMatch(lines.join('\n'), /sk-test-key-not-for-logs/);
  } finally {
    server.close();
  }
});

test('/analyze still fetches a same-host relative redirect on an allowlisted host', async () => {
  const hops = [];
  const config = liveUrlConfig({ MEDIA_LENS_URL_ALLOWLIST: 'allowed.example' });
  const server = await listen(
    createServer(config, {
      fetchArticle: async (url, options) => {
        assert.deepEqual(options.urlAllowlist, ['allowed.example']);
        const result = await fetchArticleSafely(url, {
          ...options,
          timeoutMs: 1000,
          maxBytes: 4000,
          lookupImpl: PUBLIC_LOOKUP,
          requestImpl: async ({ parsed, pin }) => {
            hops.push(`${parsed.hostname}${parsed.pathname}`);
            if (parsed.pathname === '/start') return redirectResponse(pin, '/next');
            return htmlResponse(pin);
          }
        });
        assert.match(result.html, /Public article fixture/);
        throw Object.assign(new Error('stop after hop-allowed fetch'), { code: 'FETCH_ERROR' });
      }
    })
  );
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'url', url: 'http://allowed.example/start' }
    });
    assert.deepEqual(hops, ['allowed.example/start', 'allowed.example/next']);
    assert.equal(res.status, 200);
    assert.equal(res.body.schema, 'influence-graph.v1');
    assert.equal(res.body.abstentions[0].reason, 'engine_unavailable');
  } finally {
    server.close();
  }
});
