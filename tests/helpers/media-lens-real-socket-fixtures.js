// Local loopback + CA fixtures for Media Lens real-socket SSRF tests.
// Not a test file (tests/*.test.js). Production never imports this.

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { classifyIp, stripIPv6Brackets } from '../../media-lens/worker/address-policy.js';

const execFile = promisify(execFileCb);

export const FIXTURE_HTML =
  '<!doctype html><html><body><p>Real socket pin fixture.</p></body></html>';
export const SECRET_HTML =
  '<!doctype html><html><body><p>redirect secret must not be fetched.</p></body></html>';

export const PIN_HOST = 'pin.media-lens-pin-test.invalid';
export const PRIVATE_REDIRECT_HOST = 'private.media-lens-pin-test.invalid';
export const WRONG_CERT_HOST = 'other.media-lens-pin-test.invalid';

/**
 * Test-only classifier: treat 127.0.0.1 / ::1 as connectable public pins so
 * real net.connect / tls.connect can hit local fixtures. Production
 * classifyIp still blocks loopback; tests without this seam must keep failing
 * closed.
 */
export function classifyLoopbackFixture(ip) {
  const bare = stripIPv6Brackets(String(ip || '')).toLowerCase();
  if (bare === '127.0.0.1') {
    return {
      disposition: 'allow_public',
      reason: 'test_loopback_fixture',
      family: 4,
      canonical: '127.0.0.1',
      embeddedIPv4: null
    };
  }
  if (bare === '::1') {
    return {
      disposition: 'allow_public',
      reason: 'test_loopback_fixture',
      family: 6,
      canonical: '::1',
      embeddedIPv4: null
    };
  }
  return classifyIp(ip);
}

export function lookupMap(map) {
  return async (hostname) => {
    const key = String(hostname).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(map, key)) {
      const err = new Error(`unexpected lookup ${hostname}`);
      err.code = 'ENOTFOUND';
      throw err;
    }
    return map[key];
  };
}

export function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve(server.address()));
  });
}

export function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export async function makeLocalCa(dir) {
  const key = join(dir, 'ca.key');
  const cert = join(dir, 'ca.pem');
  await execFile('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-days',
    '1',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-subj',
    '/CN=Media Lens Test CA'
  ]);
  return { key, cert, pem: await readFile(cert) };
}

export async function makeHostCert(dir, ca, hostname) {
  const key = join(dir, `${hostname}.key`);
  const csr = join(dir, `${hostname}.csr`);
  const cert = join(dir, `${hostname}.pem`);
  const ext = join(dir, `${hostname}.ext`);
  await writeFile(ext, `subjectAltName=DNS:${hostname}\nbasicConstraints=CA:FALSE\n`);
  await execFile('openssl', [
    'req',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-keyout',
    key,
    '-out',
    csr,
    '-subj',
    `/CN=${hostname}`
  ]);
  await execFile('openssl', [
    'x509',
    '-req',
    '-in',
    csr,
    '-CA',
    ca.cert,
    '-CAkey',
    ca.key,
    '-CAcreateserial',
    '-out',
    cert,
    '-days',
    '1',
    '-extfile',
    ext
  ]);
  return {
    keyPem: await readFile(key),
    certPem: await readFile(cert)
  };
}

function attachRequestLog(server, seen, onRequest) {
  server.on('connection', () => {
    seen.connections += 1;
  });
  server.on('request', (req, res) => {
    seen.hosts.push(req.headers.host || '');
    seen.urls.push(req.url);
    onRequest(req, res, seen);
  });
}

function defaultHtmlHandler(req, res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FIXTURE_HTML);
}

export async function startHttpFixture({ host = '127.0.0.1', onRequest = defaultHtmlHandler } = {}) {
  const seen = { hosts: [], urls: [], connections: 0 };
  const server = http.createServer();
  attachRequestLog(server, seen, onRequest);
  const addr = await listen(server, host);
  return { server, addr, seen, close: () => closeServer(server) };
}

export async function startHttpsFixture({
  host = '127.0.0.1',
  contexts,
  defaultHost,
  onRequest = defaultHtmlHandler,
  missingSni = 'reject'
} = {}) {
  const seen = { hosts: [], urls: [], connections: 0, sni: [] };
  const fallback = contexts[defaultHost];
  const server = https.createServer({
    key: fallback.keyPem,
    cert: fallback.certPem,
    SNICallback(servername, cb) {
      const name = servername == null || servername === '' ? null : String(servername);
      seen.sni.push(name);
      if (!name) {
        if (missingSni === 'reject') {
          cb(new Error('missing SNI'), null);
          return;
        }
        const wrong = contexts[missingSni];
        cb(null, tls.createSecureContext({ key: wrong.keyPem, cert: wrong.certPem }));
        return;
      }
      const ctx = contexts[name];
      if (!ctx) {
        if (missingSni === 'reject') {
          cb(new Error(`no cert for SNI ${name}`), null);
          return;
        }
        const wrong = contexts[missingSni] || contexts[defaultHost];
        cb(null, tls.createSecureContext({ key: wrong.keyPem, cert: wrong.certPem }));
        return;
      }
      cb(null, tls.createSecureContext({ key: ctx.keyPem, cert: ctx.certPem }));
    }
  });
  attachRequestLog(server, seen, onRequest);
  const addr = await listen(server, host);
  return { server, addr, seen, close: () => closeServer(server) };
}

export function articleUrl({ hostname, port, path = '/article', https: useHttps = false }) {
  const scheme = useHttps ? 'https' : 'http';
  return `${scheme}://${hostname}:${port}${path}`;
}

export function realSocketFetchOptions(extra = {}) {
  if (extra.createConnectionImpl || extra.requestImpl) {
    throw new Error('real-socket cases must not inject createConnectionImpl/requestImpl');
  }
  return {
    timeoutMs: extra.timeoutMs ?? 2000,
    maxBytes: extra.maxBytes ?? 8000,
    classifyImpl: classifyLoopbackFixture,
    ...extra
  };
}
