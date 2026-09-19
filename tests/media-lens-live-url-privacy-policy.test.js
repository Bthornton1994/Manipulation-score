import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createServer } from '../media-lens/worker/server.js';
import { loadConfig } from '../media-lens/worker/config.js';

const CLARITY_PRIVACY_SUMMARY =
  'We do not operate accounts, servers that receive your pasted text, or analytics that track what you analyze.';
const CLARITY_ON_DEVICE =
  'When you analyze a message, processing happens entirely in your browser using local JavaScript. Nothing is uploaded to Clarity or any third-party service for analysis.';
const MEDIA_LENS_PRIVACY_DISCLOSURE =
  'Media Lens is an unreleased, separate preview for public articles, advertisements, speeches, and campaign material. It is not deployed on this site. Its default fixture mode uses local example material and makes no network calls. Do not enter private messages or material you are not authorized to review. Any future live mode that sends prepared public text to an external service will require separate informed consent, an updated privacy notice, and additional security review before enablement. Clarity’s private analyzer remains governed by the on-device behavior described above.';

const PRODUCTION_READY_CLAIM =
  /live URL is production-ready|production-ready live URL|ready for production|live URL is currently available|live URL analysis is currently available|live URL is available on (this|the public) site/i;

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

test('privacy.html preserves Clarity on-device sentences and the Media Lens preview disclosure', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, new RegExp(escapeRe(CLARITY_PRIVACY_SUMMARY)));
  assert.match(html, new RegExp(escapeRe(CLARITY_ON_DEVICE)));
  assert.match(html, new RegExp(escapeRe(MEDIA_LENS_PRIVACY_DISCLOSURE)));
  assert.match(html, /Clarity is designed so your messages stay on your device\./);
});

test('privacy.html separates future live URL as disabled, not deployed, and not available today', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, /<h2>Future Media Lens live URL \(not available\)<\/h2>/);
  assert.match(html, /Live URL analysis is not available on this site today\./);
  assert.match(html, /disabled by default, not deployed, and not production-ready/);
  assert.match(html, /This notice does not enable live URL or change any defaults\./);
  assert.doesNotMatch(html, PRODUCTION_READY_CLAIM);
  assert.doesNotMatch(html, /live Media Lens processing is currently available/i);
  assert.doesNotMatch(html, /Media Lens is deployed on this site/i);
  assert.doesNotMatch(html, /MEDIA_LENS_ENABLE_LIVE_URL=true/);
  assert.doesNotMatch(html, /TYPESAFE_API_KEY/);
  assert.doesNotMatch(html, /api\.typesafe\.ai/);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9]{16,}/);
});

test('privacy.html states local worker topology and does not claim a hosted worker', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, /computer you or an operator control/);
  assert.match(html, /This site does not host that worker/);
  assert.match(html, /hosted or multi-tenant worker is not the current design/);
  assert.match(html, /separate privacy, tenant, and abuse review/);
});

test('privacy.html discloses consent, two network events, retention none, deletion, and sensitive-content limits', async () => {
  const html = await readFile('privacy.html', 'utf8');
  assert.match(html, /two separate network events/);
  assert.match(html, /request the public page at the URL you submitted/);
  assert.match(html, /Prepared public span text from that page could be sent to TypeSafe's Jev typed classifier/);
  assert.match(html, /TypeSafe would not fetch the URL/);
  assert.match(html, /confirm that the material is public and that you are allowed to review it/);
  assert.match(html, /Retention would be none unless you export a result yourself/);
  assert.match(html, /would not keep full article text/);
  assert.match(html, /Shutting down the worker and deleting any files you exported would remove local copies/);
  assert.match(html, /does not claim that TypeSafe retains nothing, deletes on request, or offers zero data retention/);
  assert.match(html, /Do not submit private messages, passwords, medical or financial records, information about children/);
  assert.match(html, /Paywalled pages would be left unanalyzed rather than bypassed/);
});

test('privacy.html and limitations.html keep live pasted-text prohibited', async () => {
  const privacy = await readFile('privacy.html', 'utf8');
  const limitations = await readFile('limitations.html', 'utf8');
  assert.match(privacy, /Live pasted-text analysis would stay disabled/);
  assert.match(limitations, /Live pasted-text analysis remains prohibited/);
  const serverSrc = await readFile('media-lens/worker/server.js', 'utf8');
  assert.match(serverSrc, /live_pasted_text_disabled/);
  assert.match(serverSrc, /Live pasted-text analysis is disabled/);
});

test('limitations.html and acceptable-use.html stay additive and do not claim live URL is available', async () => {
  const limitations = await readFile('limitations.html', 'utf8');
  const acceptableUse = await readFile('acceptable-use.html', 'utf8');

  assert.match(limitations, /always "not checked" in this preview/);
  assert.match(limitations, /Live URL analysis is not available on the public site/);
  assert.match(limitations, /disabled, not deployed, and not production-ready/);
  assert.match(limitations, /TypeSafe's Jev classifier/);
  assert.doesNotMatch(limitations, PRODUCTION_READY_CLAIM);

  assert.match(acceptableUse, /Submit private messages, passwords, or other non-public material to Media Lens/);
  assert.match(acceptableUse, /Use a Media Lens URL fetch, if later enabled/);
  assert.match(acceptableUse, /paywalled, private, internal-network, or otherwise unauthorized content/);
  assert.doesNotMatch(acceptableUse, PRODUCTION_READY_CLAIM);
  assert.doesNotMatch(acceptableUse, /live URL is currently available/i);
});

test('MEDIA_LENS_ENABLE_LIVE_URL is not true by default', () => {
  const unset = loadConfig({});
  assert.equal(unset.mode, 'fixture');
  assert.equal(unset.liveEnabled, false);
  assert.equal(unset.liveUrlEnabled, false);

  const liveWithoutUrlFlag = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'not-a-real-key'
  });
  assert.equal(liveWithoutUrlFlag.liveEnabled, true);
  assert.equal(liveWithoutUrlFlag.liveUrlEnabled, false);

  const truthyButNotExact = loadConfig({ MEDIA_LENS_ENABLE_LIVE_URL: 'TRUE' });
  assert.equal(truthyButNotExact.liveUrlEnabled, false);
});

test('live pasted-text remains rejected even when an operator sets MEDIA_LENS_ENABLE_LIVE_URL=true', async () => {
  const publicPastedText = Array.from(
    { length: 6 },
    (_, i) => `Sentence number ${i + 1} in this article about a policy debate.`
  ).join('\n\n');

  const config = loadConfig({
    MEDIA_LENS_MODE: 'live',
    MEDIA_LENS_ENABLE_LIVE: 'true',
    MEDIA_LENS_ENABLE_LIVE_URL: 'true',
    MEDIA_LENS_TYPESAFE_API_KEY: 'test-key-not-used',
    MEDIA_LENS_PORT: '0'
  });
  assert.equal(config.liveUrlEnabled, true);

  const server = createServer(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const res = await requestJson(server, {
      method: 'POST',
      path: '/analyze',
      body: { user_asserted_public: true, mode: 'pasted_text', text: publicPastedText }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'live_pasted_text_disabled');
  } finally {
    server.close();
  }
});
