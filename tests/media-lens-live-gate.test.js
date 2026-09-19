import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer, startServer } from '../media-lens/worker/server.js';
import { loadConfig } from '../media-lens/worker/config.js';
import { validate } from '../media-lens/schema/validate.js';

const PUBLIC_PASTED_TEXT = Array.from(
  { length: 6 },
  (_, i) => `Sentence number ${i + 1} in this article about a policy debate.`
).join('\n\n');

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
        res.on('data', (chunk) => (raw += chunk));
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

test('live mode is disabled by default', () => {
  const config = loadConfig({});
  assert.equal(config.mode, 'fixture');
  assert.equal(config.liveEnabled, false);

  const liveRequested = loadConfig({ MEDIA_LENS_MODE: 'live' });
  assert.equal(liveRequested.mode, 'live');
  assert.equal(liveRequested.liveEnabled, false);

  const truthyButNotExact = loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_ENABLE_LIVE: 'TRUE' });
  assert.equal(truthyButNotExact.liveEnabled, false);
});

test('live mode cannot start with only an API key', async () => {
  await assert.rejects(
    () =>
      startServer(
        loadConfig({
          MEDIA_LENS_MODE: 'live',
          MEDIA_LENS_TYPESAFE_API_KEY: 'test-key-not-used',
          MEDIA_LENS_PORT: '0'
        })
      ),
    /MEDIA_LENS_ENABLE_LIVE=true/
  );
});

test('live mode cannot start with only MEDIA_LENS_ENABLE_LIVE=true', async () => {
  await assert.rejects(
    () =>
      startServer(
        loadConfig({
          MEDIA_LENS_MODE: 'live',
          MEDIA_LENS_ENABLE_LIVE: 'true',
          MEDIA_LENS_PORT: '0'
        })
      ),
    /MEDIA_LENS_TYPESAFE_API_KEY/
  );
});

test('createServer rejects live mode with only an API key', () => {
  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key-not-used',
    MEDIA_LENS_PORT: '0'
  });
  assert.throws(
    () => createServer(config).listen(0, '127.0.0.1'),
    /MEDIA_LENS_ENABLE_LIVE=true/
  );
});

test('createServer rejects live mode with only MEDIA_LENS_ENABLE_LIVE=true', () => {
  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_PORT: '0'
  });
  assert.throws(
    () => createServer(config).listen(0, '127.0.0.1'),
    /MEDIA_LENS_TYPESAFE_API_KEY/
  );
});

test('createServer accepts live configuration only when ENABLE_LIVE and API key are both present', async () => {
  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key-not-used',
    MEDIA_LENS_PORT: '0'
  });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'live');
    assert.equal(res.body.liveEnabled, true);
    assert.equal(res.body.jev.hasApiKey, true);
    assert.doesNotMatch(JSON.stringify(res.body), /test-key-not-used/);
  } finally {
    server.close();
  }
});

test('createServer fixture mode remains unchanged without live opt-in or API key', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  assert.equal(config.liveEnabled, false);
  assert.equal(config.jev.hasApiKey, false);
  const server = await listen(createServer(config));
  try {
    const health = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(health.body.mode, 'fixture');
    assert.equal(health.body.liveEnabled, false);

    const fixtureRes = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial' }
    });
    assert.equal(fixtureRes.status, 200);
    assert.equal(fixtureRes.body.schema, 'influence-graph.v1');
    assert.equal(validate(fixtureRes.body).valid, true);
    assert.equal(fixtureRes.body.artifact.input_mode, 'fixture');
  } finally {
    server.close();
  }
});

test('live pasted text is rejected before any external request', async () => {
  let jevHits = 0;
  const mockJev = http.createServer((req, res) => {
    jevHits += 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { influence_signal: { choice: 'none' }, is_quoted_or_attributed: { noul: 0.1 } } }));
  });
  await new Promise((resolve) => mockJev.listen(0, '127.0.0.1', resolve));

  let fetchHits = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetchHits += 1;
    return originalFetch(...args);
  };

  const mockAddress = mockJev.address();
  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key',
    MEDIA_LENS_TYPESAFE_BASE_URL: `http://127.0.0.1:${mockAddress.port}`
  });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'pasted_text', text: PUBLIC_PASTED_TEXT }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'live_pasted_text_disabled');
    assert.match(res.body.message, /Live pasted-text analysis is disabled/i);
    assert.equal(jevHits, 0, 'live pasted_text must not call the Jev endpoint');
    assert.equal(fetchHits, 0, 'live pasted_text must not call fetch');
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    mockJev.close();
  }
});

test('fixture mode still analyzes pasted_text without outbound network', async () => {
  let fetchHits = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetchHits += 1;
    return originalFetch(...args);
  };

  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'pasted_text', text: PUBLIC_PASTED_TEXT }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.schema, 'influence-graph.v1');
    assert.equal(validate(res.body).valid, true);
    assert.equal(res.body.artifact.input_mode, 'pasted_text');
    assert.equal(fetchHits, 0, 'fixture pasted_text must not call fetch');
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
  }
});

test('fixture mode fixture_id analysis is unchanged', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.schema, 'influence-graph.v1');
    assert.equal(validate(res.body).valid, true);
    assert.equal(res.body.artifact.input_mode, 'fixture');
  } finally {
    server.close();
  }
});

test('URL mode is marked experimental and not production-ready', async () => {
  const readme = await readFile('media-lens/README.md', 'utf8');
  assert.match(readme, /Live URL mode is still not production-ready/);
  assert.match(readme, /experimental/i);

  const html = await readFile('media-lens/index.html', 'utf8');
  assert.match(html, /experimental/i);
  assert.match(html, /not production-ready/i);

  const js = await readFile('media-lens/media-lens.js', 'utf8');
  assert.match(js, /not production-ready/);
});
