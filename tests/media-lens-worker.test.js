import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, startServer } from '../media-lens/worker/server.js';
import { loadConfig } from '../media-lens/worker/config.js';

function requestJson(server, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: address.address, port: address.port, method, path, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} },
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

test('GET /health reports the configured mode with no secret values', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'fixture');
    assert.equal(res.body.jev.hasApiKey, false);
  } finally {
    server.close();
  }
});

test('POST /analyze with a fixture id returns a valid graph', async () => {
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

    const { validate } = await import('../media-lens/schema/validate.js');
    const { valid, errors } = validate(res.body);
    assert.deepEqual(errors, []);
    assert.equal(valid, true);
  } finally {
    server.close();
  }
});

test('POST /analyze without user_asserted_public returns 400', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { mode: 'fixture', fixture_id: 'synthetic-01-quoted-vs-authorial' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'consent_required');
  } finally {
    server.close();
  }
});

test('POST /analyze with an oversized body returns 413', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  config.limits.maxRequestBodyBytes = 100;
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'pasted_text', text: 'x'.repeat(5000) }
    });
    assert.equal(res.status, 413);
    assert.equal(res.body.error, 'oversized_input');
  } finally {
    server.close();
  }
});

test('CORS: a loopback Origin (e.g. the static file server on a different port) is allowed', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const address = server.address();
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: address.address, port: address.port, method: 'GET', path: '/health', headers: { origin: 'http://localhost:4173' } },
        (r) => {
          r.resume();
          r.on('end', () => resolve(r));
        }
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:4173');
  } finally {
    server.close();
  }
});

test('CORS: a non-loopback Origin is never granted access', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const address = server.address();
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: address.address, port: address.port, method: 'GET', path: '/health', headers: { origin: 'https://evil.example' } },
        (r) => {
          r.resume();
          r.on('end', () => resolve(r));
        }
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  } finally {
    server.close();
  }
});

test('unknown routes return 404', async () => {
  const config = loadConfig({ MEDIA_LENS_MODE: 'fixture' });
  const server = await listen(createServer(config));
  try {
    const res = await requestJson(server, { method: 'GET', path: '/nope' });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('live mode without a configured key refuses to start', async () => {
  await assert.rejects(
    () => startServer(loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_PORT: '0' })),
    /MEDIA_LENS_TYPESAFE_API_KEY/
  );
});

test('live mode with a configured key is allowed to start (still never called in this test)', async () => {
  const server = await startServer(loadConfig({ MEDIA_LENS_MODE: 'live', MEDIA_LENS_TYPESAFE_API_KEY: 'test-key-not-used', MEDIA_LENS_PORT: '0' }));
  try {
    const res = await requestJson(server, { method: 'GET', path: '/health' });
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'live');
  } finally {
    server.close();
  }
});
