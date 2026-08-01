import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage } from '../scoring.js';

test('returns an empty result for whitespace', () => {
  assert.deepEqual(analyzeMessage('   '), { score: 0, level: 'No message', signals: [], response: '' });
});

test('detects multiple pressure patterns', () => {
  const result = analyzeMessage("If you really cared, you'd answer right now or else you'll regret it.");
  assert.equal(result.level, 'High pressure');
  assert.deepEqual(result.signals.map(({ id }) => id), ['guilt', 'urgency', 'threat']);
  assert.ok(result.score <= 100);
});

test('keeps neutral language in the low range', () => {
  const result = analyzeMessage('Could we talk tomorrow when we both have time?');
  assert.equal(result.score, 4);
  assert.equal(result.level, 'Low pressure');
  assert.equal(result.signals.length, 0);
});

test('deduplicates repeated matched phrases', () => {
  const result = analyzeMessage('You always do this. Always, always.');
  assert.deepEqual(result.signals[0].matches, ['always']);
  assert.equal(result.signals[0].points, 17);
});
