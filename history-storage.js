export const LEGACY_STORAGE_KEY = 'clarity-history-v1';
export const STORAGE_KEY = 'clarity-history-v2';
export const OPT_IN_KEY = 'clarity-history-opt-in-v1';
export const MIGRATION_KEY = 'clarity-history-migration-v2';

/**
 * Return browser localStorage, or null when access throws (e.g. blocked cookies).
 * Evaluating `localStorage` itself can throw before any Storage method runs.
 * @returns {Storage | null}
 */
export function getBrowserLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    void storage.length;
    return storage;
  } catch {
    return null;
  }
}

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
