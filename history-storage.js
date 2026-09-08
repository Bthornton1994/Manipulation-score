export const LEGACY_STORAGE_KEY = 'clarity-history-v1';
export const STORAGE_KEY = 'clarity-history-v2';
export const OPT_IN_KEY = 'clarity-history-opt-in-v1';
export const MIGRATION_KEY = 'clarity-history-migration-v2';
export const HISTORY_LOCK_NAME = 'clarity-history-v2';

/**
 * Remove legacy auto-saved history from pre-opt-in releases.
 * @param {Storage} storage
 */
export function migrateHistoryStorage(storage) {
  try {
    if (storage.getItem(MIGRATION_KEY)) {
      return { migrated: false, deletedLegacy: false };
    }

    const hadLegacy = storage.getItem(LEGACY_STORAGE_KEY) != null;
    if (hadLegacy) {
      storage.removeItem(LEGACY_STORAGE_KEY);
    }

    storage.setItem(MIGRATION_KEY, '1');
    return { migrated: true, deletedLegacy: hadLegacy };
  } catch {
    return { migrated: false, deletedLegacy: false };
  }
}

export function isHistoryOptIn(storage) {
  try {
    return storage.getItem(OPT_IN_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Serialize cross-tab history mutations. Falls back to running immediately when
 * Web Locks are unavailable.
 * @param {() => void | Promise<void>} fn
 * @param {{ request?: Function } | null | undefined} locks
 */
export async function withHistoryLock(fn, locks = globalThis.navigator?.locks) {
  if (locks?.request) {
    return locks.request(HISTORY_LOCK_NAME, fn);
  }
  return fn();
}

/**
 * Read-modify-write helper for clarity-history-v2.
 * `mutate` receives the current array and returns the next array, or `undefined`
 * to abort without writing.
 * @param {Storage} storage
 * @param {(items: any[]) => any[] | undefined} mutate
 */
export function applyHistoryMutation(storage, mutate) {
  const raw = storage.getItem(STORAGE_KEY);
  let items;
  try {
    const parsed = JSON.parse(raw || '[]');
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }

  const next = mutate(items);
  if (next === undefined) return { written: false };

  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return { written: true };
}

/**
 * Remove all stored history entries under the shared lock name when available.
 * @param {Storage} storage
 * @param {{ request?: Function } | null | undefined} locks
 */
export async function clearHistoryStorage(storage, locks = globalThis.navigator?.locks) {
  await withHistoryLock(() => {
    storage.removeItem(STORAGE_KEY);
  }, locks);
}
