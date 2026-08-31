import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getBrowserLocalStorage } from '../history-storage.js';

test('analyze query prefills only accept built-in examples, never raw URL text', async () => {
  const app = await readFile('app.js', 'utf8');
  const fn = app.slice(app.indexOf('function applyAnalyzeQuery'), app.indexOf('applyAnalyzeQuery();'));
  assert.match(fn, /byIndex\?\.text \|\| byLabel\?\.text/);
  assert.doesNotMatch(fn, /\|\|\s*raw\b/);
  assert.match(fn, /\/\^\\d\+\$\//);
});

test('history delete remains available after opt-out when items exist', async () => {
  const app = await readFile('app.js', 'utf8');
  const update = app.slice(
    app.indexOf('function updateHistoryControls'),
    app.indexOf('function renderHistory')
  );
  assert.match(update, /loadHistory\(\)\.length === 0/);
  assert.doesNotMatch(update, /!optedIn\s*\|\|/);

  const render = app.slice(app.indexOf('function renderHistory'), app.indexOf('function populateExamples'));
  assert.match(render, /Saving is off\. Existing analyses remain/);
  assert.match(render, /!isHistoryOptIn\(\) && items\.length/);
});

test('getBrowserLocalStorage returns null when localStorage access throws', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
    }
  });
  try {
    assert.equal(getBrowserLocalStorage(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('app boots through getBrowserLocalStorage instead of bare localStorage at import', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /getBrowserLocalStorage/);
  assert.match(app, /const browserStorage = getBrowserLocalStorage\(\)/);
  assert.doesNotMatch(app, /migrateHistoryStorage\(\s*localStorage\s*\)/);
  assert.doesNotMatch(app, /readHistoryOptIn\(\s*localStorage\s*\)/);
});

test('privacy policy still documents delete controls after disabling save', async () => {
  const privacy = await readFile('privacy.html', 'utf8');
  assert.match(
    privacy,
    /Disabling the save toggle stops new writes; delete controls remove what is already stored/
  );
});
