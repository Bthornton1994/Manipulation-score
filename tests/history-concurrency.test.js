import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  STORAGE_KEY,
  HISTORY_LOCK_NAME,
  withHistoryLock,
  applyHistoryMutation,
  clearHistoryStorage
} from '../history-storage.js';

function mockStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
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

function createSerialLock() {
  let chain = Promise.resolve();
  let active = 0;
  let maxActive = 0;

  return {
    get maxActive() {
      return maxActive;
    },
    request(_name, fn) {
      const run = chain.then(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          return await fn();
        } finally {
          active -= 1;
        }
      });
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };
}

test('HISTORY_LOCK_NAME matches storage key namespace', () => {
  assert.equal(HISTORY_LOCK_NAME, 'clarity-history-v2');
  assert.equal(STORAGE_KEY, 'clarity-history-v2');
});

test('applyHistoryMutation read-modify-writes current items', () => {
  const storage = mockStorage({
    [STORAGE_KEY]: JSON.stringify([{ id: 1, text: 'first' }])
  });

  const result = applyHistoryMutation(storage, (items) => {
    items.unshift({ id: 2, text: 'second' });
    return items;
  });

  assert.equal(result.written, true);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), [
    { id: 2, text: 'second' },
    { id: 1, text: 'first' }
  ]);
});

test('applyHistoryMutation recovers from corrupt JSON', () => {
  const storage = mockStorage({ [STORAGE_KEY]: '{not-json' });
  applyHistoryMutation(storage, () => [{ id: 1, text: 'recovered' }]);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), [{ id: 1, text: 'recovered' }]);
});

test('withHistoryLock serializes concurrent writers so both saves survive', async () => {
  const storage = mockStorage();
  const locks = createSerialLock();

  async function save(text) {
    await withHistoryLock(() => {
      applyHistoryMutation(storage, (items) => {
        const without = items.filter((item) => item.text !== text);
        without.unshift({ id: Date.now() + Math.random(), text });
        return without.slice(0, 8);
      });
    }, locks);
  }

  await Promise.all([
    save('Message from tab A about urgency and pressure patterns'),
    save('Message from tab B about guilt and isolation patterns')
  ]);

  const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '[]').map((item) => item.text);
  assert.equal(locks.maxActive, 1);
  assert.equal(saved.length, 2);
  assert.ok(saved.includes('Message from tab A about urgency and pressure patterns'));
  assert.ok(saved.includes('Message from tab B about guilt and isolation patterns'));
});

test('unlocked concurrent writers lose the first save (documents the bug class)', () => {
  const storage = mockStorage();

  // Both tabs read the same empty snapshot before either writes.
  const snapshotA = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
  const snapshotB = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
  snapshotA.unshift({ id: 1, text: 'only-A' });
  snapshotB.unshift({ id: 2, text: 'only-B' });
  storage.setItem(STORAGE_KEY, JSON.stringify(snapshotA.slice(0, 8)));
  storage.setItem(STORAGE_KEY, JSON.stringify(snapshotB.slice(0, 8)));

  const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '[]').map((item) => item.text);
  assert.deepEqual(saved, ['only-B']);
});

test('clearHistoryStorage removes entries under the lock', async () => {
  const storage = mockStorage({
    [STORAGE_KEY]: JSON.stringify([{ id: 1, text: 'secret' }])
  });
  const locks = createSerialLock();
  await clearHistoryStorage(storage, locks);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('app.js routes history writes through withHistoryLock', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /withHistoryLock/);
  assert.match(app, /applyHistoryMutation/);
  assert.match(app, /clearHistoryStorage/);

  const saveBlock = app.slice(app.indexOf('async function saveHistory'), app.indexOf('function loadHistory'));
  assert.match(saveBlock, /await withHistoryLock/);
  assert.match(saveBlock, /applyHistoryMutation\(localStorage/);
});
