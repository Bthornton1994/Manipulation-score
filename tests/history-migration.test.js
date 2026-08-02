import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrateHistoryStorage,
  isHistoryOptIn,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  OPT_IN_KEY,
  MIGRATION_KEY
} from '../history-storage.js';

function mockStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    snapshot() {
      return { ...data };
    }
  };
}

test('migration deletes legacy history without opt-in', () => {
  const storage = mockStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify([{ id: 1, text: 'old secret message', score: 55 }])
  });

  const result = migrateHistoryStorage(storage);
  assert.equal(result.migrated, true);
  assert.equal(result.deletedLegacy, true);
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), null);
  assert.equal(storage.getItem(MIGRATION_KEY), '1');
});

test('migration runs only once', () => {
  const storage = mockStorage({
    [LEGACY_STORAGE_KEY]: '[]',
    [MIGRATION_KEY]: '1'
  });
  const result = migrateHistoryStorage(storage);
  assert.equal(result.migrated, false);
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), '[]');
});

test('new history uses v2 key', () => {
  assert.equal(STORAGE_KEY, 'clarity-history-v2');
});

test('opt-in flag is independent of storage key', () => {
  const storage = mockStorage({ [OPT_IN_KEY]: 'true' });
  assert.equal(isHistoryOptIn(storage), true);
});
