// Budget and ops alert delivery. Credentials come from systemd LoadCredential
// (or MEDIA_LENS_ALERT_CREDENTIAL_FILE); never from git, worker.env, or logs.
//
// Supported credential shapes (file contents, never logged):
// - {"type":"smtp","url":"smtp://user:pass@host:587"} or smtps://...
// - {"type":"webhook","url":"https://..."}
// - raw smtp:// / smtps:// / https:// URL
//
// Real delivery integration tests run only when
// MEDIA_LENS_ALERT_DELIVERY_TEST=true and a credential is present. CI uses
// mock transport only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import tls from 'node:tls';

export const BLOCKED_ALERT_TRANSPORT = 'BLOCKED_ALERT_TRANSPORT';
export const ALERT_RECIPIENT = 'bthornton9415@gmail.com';
export const DEFAULT_LOAD_CREDENTIAL_NAME = 'media-lens-alert';

export function resolveAlertCredentialPath(env) {
  if (!env || typeof env !== 'object') return null;
  if (typeof env.MEDIA_LENS_ALERT_CREDENTIAL_FILE === 'string' && env.MEDIA_LENS_ALERT_CREDENTIAL_FILE) {
    return env.MEDIA_LENS_ALERT_CREDENTIAL_FILE;
  }
  if (typeof env.CREDENTIALS_DIRECTORY === 'string' && env.CREDENTIALS_DIRECTORY) {
    return join(env.CREDENTIALS_DIRECTORY, DEFAULT_LOAD_CREDENTIAL_NAME);
  }
  return null;
}

export function readAlertCredential(env, io = {}) {
  const path = resolveAlertCredentialPath(env);
  if (!path) return null;
  const read = typeof io.readFileSync === 'function' ? io.readFileSync : readFileSync;
  try {
    const raw = read(path, 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function parseCredential(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.type === 'webhook' && typeof parsed.url === 'string' && /^https?:\/\//i.test(parsed.url)) {
        return parsed;
      }
      if (parsed.type === 'smtp' && typeof parsed.url === 'string' && /^smtps?:\/\//i.test(parsed.url)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(raw)) {
    return { type: 'webhook', url: raw };
  }
  if (/^smtps?:\/\//i.test(raw)) {
    return { type: 'smtp', url: raw };
  }
  return null;
}

export function parseSmtpCredentialUrl(urlString) {
  if (typeof urlString !== 'string' || !/^smtps?:\/\//i.test(urlString)) return null;
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') return null;
  if (!url.hostname) return null;
  const secure = url.protocol === 'smtps:';
  const port = url.port ? Number.parseInt(url.port, 10) : secure ? 465 : 587;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return {
    host: url.hostname,
    port,
    secure,
    user: decodeURIComponent(url.username || ''),
    pass: decodeURIComponent(url.password || '')
  };
}

export function redactedSmtpEndpoint(smtp) {
  return { host: smtp.host, port: smtp.port, secure: smtp.secure };
}

function createBlockedTransport() {
  return {
    status: BLOCKED_ALERT_TRANSPORT,
    async send() {
      return { ok: false, reason: BLOCKED_ALERT_TRANSPORT };
    }
  };
}

function smtpBase64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function formatEmailBody({ from, to, subject, text }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text
  ];
  return (
    lines
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n') + '\r\n.'
  );
}

function readSocketChunk(socket) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      cleanup();
      resolve(chunk.toString('utf8'));
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
    };
    socket.once('data', onData);
    socket.once('end', onEnd);
    socket.once('error', onError);
  });
}

async function readSmtpLine(session) {
  while (!session.buffer.includes('\r\n')) {
    const chunk = await readSocketChunk(session.socket);
    if (chunk === null) throw Object.assign(new Error('smtp connection closed'), { code: 'smtp_connection_closed' });
    session.buffer += chunk;
  }
  const idx = session.buffer.indexOf('\r\n');
  const line = session.buffer.slice(0, idx);
  session.buffer = session.buffer.slice(idx + 2);
  return line;
}

async function readSmtpResponse(session) {
  const lines = [];
  while (true) {
    const line = await readSmtpLine(session);
    lines.push(line);
    if (/^\d{3} /.test(line)) break;
  }
  const last = lines[lines.length - 1];
  return { code: Number.parseInt(last.slice(0, 3), 10), lines };
}

async function writeCommand(session, command) {
  session.socket.write(`${command}\r\n`);
  return readSmtpResponse(session);
}

async function upgradeStartTls(session, smtp) {
  const resp = await writeCommand(session, 'STARTTLS');
  if (resp.code !== 220) {
    return { ok: false, reason: `smtp_starttls_${resp.code}` };
  }
  const secureSocket = await new Promise((resolve, reject) => {
    const upgraded = tls.connect({ socket: session.socket, servername: smtp.host }, () => resolve(upgraded));
    upgraded.once('error', reject);
  });
  session.socket = secureSocket;
  session.buffer = '';
  return { ok: true };
}

function connectSmtpSocket(smtp, connectImpl) {
  if (typeof connectImpl === 'function') {
    return connectImpl(smtp);
  }
  if (smtp.secure) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host }, () => resolve(socket));
      socket.once('error', reject);
    });
  }
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: smtp.host, port: smtp.port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

export async function sendSmtpEmail({ smtp, message, connectImpl }) {
  const from = smtp.user.includes('@') ? smtp.user : `media-lens-alerts@${smtp.host}`;
  const body = formatEmailBody({
    from,
    to: ALERT_RECIPIENT,
    subject: message.subject,
    text: message.text
  });

  const socket = await connectSmtpSocket(smtp, connectImpl);
  const session = { socket, buffer: '' };

  try {
    const greeting = await readSmtpResponse(session);
    if (greeting.code !== 220) {
      return { ok: false, reason: `smtp_greeting_${greeting.code}` };
    }

    let ehlo = await writeCommand(session, 'EHLO media-lens.local');
    if (ehlo.code !== 250) {
      return { ok: false, reason: `smtp_ehlo_${ehlo.code}` };
    }

    if (!smtp.secure) {
      const supportsStartTls = ehlo.lines.some((line) => /STARTTLS/i.test(line));
      if (supportsStartTls) {
        const upgraded = await upgradeStartTls(session, smtp);
        if (!upgraded.ok) return upgraded;
        ehlo = await writeCommand(session, 'EHLO media-lens.local');
        if (ehlo.code !== 250) {
          return { ok: false, reason: `smtp_ehlo_after_tls_${ehlo.code}` };
        }
      }
    }

    if (smtp.user) {
      let auth = await writeCommand(session, 'AUTH LOGIN');
      if (auth.code !== 334) {
        return { ok: false, reason: `smtp_auth_${auth.code}` };
      }
      auth = await writeCommand(session, smtpBase64(smtp.user));
      if (auth.code !== 334) {
        return { ok: false, reason: `smtp_auth_user_${auth.code}` };
      }
      auth = await writeCommand(session, smtpBase64(smtp.pass));
      if (auth.code !== 235) {
        return { ok: false, reason: `smtp_auth_pass_${auth.code}` };
      }
    }

    let resp = await writeCommand(session, `MAIL FROM:<${from}>`);
    if (resp.code !== 250) {
      return { ok: false, reason: `smtp_mail_from_${resp.code}` };
    }
    resp = await writeCommand(session, `RCPT TO:<${ALERT_RECIPIENT}>`);
    if (![250, 251].includes(resp.code)) {
      return { ok: false, reason: `smtp_rcpt_to_${resp.code}` };
    }
    resp = await writeCommand(session, 'DATA');
    if (resp.code !== 354) {
      return { ok: false, reason: `smtp_data_${resp.code}` };
    }

    session.socket.write(`${body}\r\n`);
    resp = await readSmtpResponse(session);
    if (resp.code !== 250) {
      return { ok: false, reason: `smtp_body_${resp.code}` };
    }

    await writeCommand(session, 'QUIT');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.code || 'smtp_error' };
  } finally {
    socket.end();
  }
}

export function createAlertTransport({ credential = null, sendImpl = null, smtpSendImpl = null, fetchImpl = null, connectImpl = null } = {}) {
  if (typeof sendImpl === 'function') {
    return {
      status: 'mock',
      async send(message) {
        return sendImpl(message);
      }
    };
  }

  const parsed = parseCredential(credential);
  if (!parsed) {
    return createBlockedTransport();
  }

  if (parsed.type === 'webhook') {
    const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : fetch;
    return {
      status: 'webhook',
      async send(message) {
        const response = await fetchFn(parsed.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            to: ALERT_RECIPIENT,
            subject: message.subject,
            text: message.text
          }),
          redirect: 'manual'
        });
        if (!response.ok) {
          return { ok: false, reason: `alert_http_${response.status}` };
        }
        return { ok: true };
      }
    };
  }

  if (parsed.type === 'smtp') {
    const smtp = parseSmtpCredentialUrl(parsed.url);
    if (!smtp) {
      return createBlockedTransport();
    }
    return {
      status: 'smtp',
      async send(message) {
        if (typeof smtpSendImpl === 'function') {
          return smtpSendImpl({ smtp: redactedSmtpEndpoint(smtp), message });
        }
        return sendSmtpEmail({ smtp, message, connectImpl });
      }
    };
  }

  return createBlockedTransport();
}

export function buildBudgetWarnAlert({ estimatedUsd, warnUsd, stopUsd, basis, calculationInputs }) {
  return {
    subject: 'Media Lens TypeSafe budget warning (ESTIMATED)',
    text: [
      'Media Lens TypeSafe spend crossed the configured ESTIMATED warn threshold.',
      `Recipient: ${ALERT_RECIPIENT}`,
      `Estimated spend (USD): ${estimatedUsd.toFixed(4)} (${basis}; not verified provider billing unless separately confirmed).`,
      `Warn threshold (USD): ${warnUsd}`,
      `Stop threshold (USD): ${stopUsd}`,
      `Calculation inputs: estimatedUsdPerCall=${calculationInputs.estimatedUsdPerCall}, recordedCalls=${calculationInputs.recordedCalls ?? 'n/a'}`
    ].join('\n')
  };
}

export function shouldRunAlertDeliveryTest(env) {
  if (!env || typeof env !== 'object') return false;
  return env.MEDIA_LENS_ALERT_DELIVERY_TEST === 'true' && Boolean(readAlertCredential(env));
}
