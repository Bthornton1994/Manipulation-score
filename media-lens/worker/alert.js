// Budget and ops alert delivery. Credentials come from systemd LoadCredential
// (or MEDIA_LENS_ALERT_CREDENTIAL_FILE); never from git, worker.env, or logs.
//
// Real delivery integration tests run only when
// MEDIA_LENS_ALERT_DELIVERY_TEST=true and a credential is present. CI uses
// mock transport only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function parseCredential(raw) {
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(raw)) {
    return { type: 'webhook', url: raw };
  }
  return { type: 'webhook', url: raw };
}

export function createAlertTransport({ credential = null, sendImpl = null } = {}) {
  if (typeof sendImpl === 'function') {
    return {
      status: 'mock',
      async send(message) {
        return sendImpl(message);
      }
    };
  }

  const parsed = parseCredential(credential);
  if (!parsed || parsed.type !== 'webhook' || typeof parsed.url !== 'string' || !/^https?:\/\//i.test(parsed.url)) {
    return {
      status: BLOCKED_ALERT_TRANSPORT,
      async send() {
        return { ok: false, reason: BLOCKED_ALERT_TRANSPORT };
      }
    };
  }

  return {
    status: 'webhook',
    async send(message) {
      const response = await fetch(parsed.url, {
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
