// Durable ESTIMATED TypeSafe budget counter store. Persists month, call
// counts, token estimates, and warn flag only. Never stores article text,
// span text, URLs, or credentials. Separate from systemd LoadCredential.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_TYPESAFE_BUDGET_STORE_FILE = '/var/lib/media-lens/typesafe-budget.json';
export const TYPESAFE_BUDGET_STORE_VERSION = 1;

const ALLOWED_KEYS = new Set(['version', 'month', 'calls', 'estimatedTokens', 'warnEmitted']);

function defaultIo() {
  return {
    readFileSync,
    writeFileSync,
    mkdirSync,
    renameSync
  };
}

function resolveIo(io = {}) {
  const defaults = defaultIo();
  return {
    readFileSync: typeof io.readFileSync === 'function' ? io.readFileSync : defaults.readFileSync,
    writeFileSync: typeof io.writeFileSync === 'function' ? io.writeFileSync : defaults.writeFileSync,
    mkdirSync: typeof io.mkdirSync === 'function' ? io.mkdirSync : defaults.mkdirSync,
    renameSync: typeof io.renameSync === 'function' ? io.renameSync : defaults.renameSync
  };
}

export function sanitizeBudgetStoreRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) return null;
  }
  if (raw.version !== TYPESAFE_BUDGET_STORE_VERSION) return null;
  if (typeof raw.month !== 'string' || !/^\d{4}-\d{2}$/.test(raw.month)) return null;
  if (!Number.isInteger(raw.calls) || raw.calls < 0) return null;
  if (!Number.isInteger(raw.estimatedTokens) || raw.estimatedTokens < 0) return null;
  if (typeof raw.warnEmitted !== 'boolean') return null;
  return {
    version: TYPESAFE_BUDGET_STORE_VERSION,
    month: raw.month,
    calls: raw.calls,
    estimatedTokens: raw.estimatedTokens,
    warnEmitted: raw.warnEmitted
  };
}

export function readBudgetStore(storePath, io = {}) {
  if (typeof storePath !== 'string' || storePath.length === 0) return null;
  const resolvedIo = resolveIo(io);
  try {
    const raw = JSON.parse(resolvedIo.readFileSync(storePath, 'utf8'));
    return sanitizeBudgetStoreRecord(raw);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    return null;
  }
}

export function writeBudgetStore(storePath, record, io = {}) {
  if (typeof storePath !== 'string' || storePath.length === 0) return;
  const resolvedIo = resolveIo(io);
  const payload = sanitizeBudgetStoreRecord(record);
  if (!payload) {
    throw new Error('refusing to write invalid typesafe budget store record');
  }
  resolvedIo.mkdirSync(dirname(storePath), { recursive: true });
  const tmpPath = `${storePath}.tmp`;
  resolvedIo.writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  resolvedIo.renameSync(tmpPath, storePath);
}
