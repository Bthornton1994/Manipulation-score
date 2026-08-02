import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('history-off analysis does not write raw text to localStorage', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /if \(!isHistoryOptIn\(\)\) return/);
  assert.match(app, /saveHistory/);
  const saveBlock = app.slice(app.indexOf('function saveHistory'), app.indexOf('function loadHistory'));
  assert.match(saveBlock, /if \(!isHistoryOptIn\(\)\) return/);
});

test('app does not transmit messages or images over the network for analysis', async () => {
  const app = await readFile('app.js', 'utf8');
  const scoring = await readFile('scoring.js', 'utf8');
  const ocr = await readFile('ocr.js', 'utf8');
  assert.doesNotMatch(app, /fetch\s*\(/);
  assert.doesNotMatch(scoring, /fetch\s*\(/);
  assert.doesNotMatch(ocr, /fetch\s*\(/);
  assert.match(app, /analyzeMessage/);
});

test('service worker update banner requires prior controller at load', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.match(app, /hadControllerAtLoad/);
  assert.match(app, /if \(hadControllerAtLoad\) showUpdateBanner/);
});
