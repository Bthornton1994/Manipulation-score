import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage, buildResponses, getHighlightRanges, SIGNALS } from '../scoring.js';

test('returns an empty result for whitespace', () => {
  const result = analyzeMessage('   ');
  assert.equal(result.score, 0);
  assert.equal(result.level, 'No message');
  assert.deepEqual(result.signals, []);
  assert.equal(result.response, buildResponses([]).pause);
});

test('detects multiple pressure patterns', () => {
  const result = analyzeMessage("If you really cared, you'd answer right now or else you'll regret it.");
  assert.equal(result.level, 'High pressure');
  assert.deepEqual(result.signals.map(({ id }) => id), ['guilt', 'urgency', 'threat']);
  assert.ok(result.score <= 100);
  assert.ok(result.highlights.length >= 3);
});

test('keeps neutral language in the low range', () => {
  const result = analyzeMessage('Could we talk tomorrow when we both have time?');
  assert.equal(result.score, 0);
  assert.equal(result.level, 'Low pressure');
  assert.equal(result.signals.length, 0);
  assert.equal(result.highlights.length, 0);
});

test('deduplicates repeated matched phrases in signal metadata', () => {
  const result = analyzeMessage('You always do this. Always, always.');
  assert.deepEqual(result.signals[0].matches, ['always']);
  assert.equal(result.signals[0].points, 17);
  assert.equal(result.signals[0].offsets.length, 3);
});

test('buildResponses returns pause, boundary, and clarify styles', () => {
  const result = analyzeMessage("If you really cared you'd answer right now.");
  assert.ok(result.responses.pause.includes('time'));
  assert.ok(result.responses.boundary.length > 10);
  assert.ok(result.responses.clarify.length > 10);
});

test('getHighlightRanges sorts offsets by position', () => {
  const result = analyzeMessage("If you really cared, answer right now.");
  const ranges = getHighlightRanges(result.signals);
  assert.ok(ranges.every((range, index) => index === 0 || ranges[index - 1].start <= range.start));
});

test('includes expanded signal catalog', () => {
  assert.ok(SIGNALS.length >= 8);
});
