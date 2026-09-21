// Durable ESTIMATED TypeSafe budget counter store. Persists month, call
// counts, token estimates, and warn flag only. Never stores article text,
// span text, URLs, or credentials. Separate from systemd LoadCredential.
//
// Concurrency: exclusive lock file (O_EXCL create) + atomic tmp/rename write.

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_TYPESAFE_BUDGET_STORE_FILE = '/var/lib/media-lens/typesafe-budget.json';
export const TYPESAFE_BUDGET_STORE_VERSION = 1;
export const BUDGET_STORE_LOCK_SUFFIX = '.lock';

const ALLOWED_KEYS = new Set(['version', 'month', 'calls', 'estimatedTokens', 'warnEmitted']);

function defaultIo() {
  return {
    readFileSync,
    writeFileSync,
    mkdirSync,
    renameSync,
    openSync,
    closeSync,
    unlinkSync
  };
}

function resolveIo(io = {}) {
  const defaults = defaultIo();
  return {
    readFileSync: typeof io.readFileSync === 'function' ? io.readFileSync : defaults.readFileSync,
    writeFileSync: typeof io.writeFileSync === 'function' ? io.writeFileSync : defaults.writeFileSync,
    mkdirSync: typeof io.mkdirSync === 'function' ? io.mkdirSync : defaults.mkdirSync,
    renameSync: typeof io.renameSync === 'function' ? io.renameSync : defaults.renameSync,
    openSync: typeof io.openSync === 'function' ? io.openSync : defaults.openSync,
    closeSync: typeof io.closeSync === 'function' ? io.closeSync : defaults.closeSync,
    unlinkSync: typeof io.unlinkSync === 'function' ? io.unlinkSync : defaults.unlinkSync
  };
}

function lockPathFor(storePath) {
  return `${storePath}${BUDGET_STORE_LOCK_SUFFIX}`;
}

function sleepMs(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

export function acquireBudgetStoreLock(storePath, io = {}, { maxAttempts = 200, baseDelayMs = 2 } = {}) {
  const resolvedIo = resolveIo(io);
  const lockPath = lockPathFor(storePath);
  resolvedIo.mkdirSync(dirname(storePath), { recursive: true });
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const fd = resolvedIo.openSync(lockPath, 'wx', 0o600);
      return {
        fd,
        release() {
          try {
            resolvedIo.closeSync(fd);
          } finally {
            try {
              resolvedIo.unlinkSync(lockPath);
            } catch {
              // Best-effort unlock.
            }
          }
        }
      };
    } catch (err) {
      if (err?.code === 'EEXIST') {
        sleepMs(baseDelayMs + Math.min(attempt, 40));
        continue;
      }
      throw err;
    }
  }
  throw new Error('typesafe budget store lock timeout');
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

/**
 * Read-modify-write under an exclusive lock. When mutator returns null, the
 * current record is returned and no write occurs.
 */
export function mutateBudgetStore(storePath, mutator, io = {}) {
  if (typeof storePath !== 'string' || storePath.length === 0) {
    throw new Error('mutateBudgetStore requires a store path');
  }
  const resolvedIo = resolveIo(io);
  const lock = acquireBudgetStoreLock(storePath, resolvedIo);
  try {
    const current = readBudgetStore(storePath, resolvedIo);
    const next = mutator(current);
    if (next == null) return current;
    writeBudgetStore(storePath, next, resolvedIo);
    return next;
  } finally {
    lock.release();
  }
}
