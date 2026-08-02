import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMessage,
  buildResponses,
  getHighlightRanges,
  getScoreBand,
  splitMessages,
  SIGNALS
} from '../scoring.js';

const LEVERAGE_EXAMPLE =
  "Fine, forget it. I guess I know where I stand. Don't bother reaching out if you can't make time for me.";

test('returns an empty result for whitespace', () => {
  const result = analyzeMessage('   ');
  assert.equal(result.score, 0);
  assert.equal(result.level, 'No message');
  assert.deepEqual(result.signals, []);
});

test('detects multiple pressure patterns', () => {
  const result = analyzeMessage("If you really cared, you'd answer right now or else you'll regret it.");
  assert.equal(result.level, 'Moderate');
  assert.deepEqual(
    [...result.signals.map(({ id }) => id)].sort(),
    ['guilt', 'threat', 'urgency']
  );
  assert.ok(result.score <= 100);
  assert.ok(result.highlights.length >= 3);
});

test('keeps neutral language in the low band', () => {
  const result = analyzeMessage('Could we talk tomorrow when we both have time?');
  assert.equal(result.score, 0);
  assert.equal(result.level, 'Low');
  assert.equal(result.signals.length, 0);
});

test('maps score bands to low moderate high thresholds', () => {
  assert.equal(getScoreBand(12).label, 'Low');
  assert.equal(getScoreBand(45).label, 'Moderate');
  assert.equal(getScoreBand(72).label, 'High');
});

test('deduplicates repeated matched phrases in signal metadata', () => {
  const result = analyzeMessage('You always do this. Always, always.');
  assert.deepEqual(result.signals[0].matches, ['always']);
  assert.equal(result.signals[0].offsets.length, 3);
});

test('buildResponses returns pause, boundary, and clarify styles', () => {
  const result = analyzeMessage("If you really cared you'd answer right now.");
  assert.ok(result.responses.pause.includes('time'));
  assert.ok(result.responses.boundary.length > 10);
  assert.ok(result.responses.clarify.length > 10);
});

test('each signal includes severity and per-pattern responses', () => {
  const result = analyzeMessage("If you really cared, answer right now.");
  assert.ok(result.signals[0].severity.label);
  assert.ok(result.signals[0].responses.pause);
  assert.ok(result.signals[0].responses.boundary);
  assert.ok(result.signals[0].excerpt.excerpt);
});

test('splits multi-message threads on blank lines', () => {
  const parts = splitMessages('First message.\n\nSecond message.');
  assert.equal(parts.length, 2);
  const result = analyzeMessage('First message.\n\nSecond message.');
  assert.equal(result.segments?.length, 2);
});

test('scores classic withdrawal leverage in the moderate band', () => {
  const result = analyzeMessage(LEVERAGE_EXAMPLE);
  assert.equal(result.level, 'Moderate');
  assert.ok(result.score >= 31);
  assert.ok(result.score <= 60);
  assert.ok(result.signals.some((s) => s.id === 'implied_rejection'));
  assert.ok(result.signals.some((s) => s.id === 'conditional_access'));
  assert.ok(result.leverageInsights.some((i) => i.id === 'withdrawal_leverage'));
});

test('does not show low overall score with strong withdrawal leverage alone', () => {
  const result = analyzeMessage(LEVERAGE_EXAMPLE);
  const hasStrong = result.signals.some((s) => s.severity.level === 'strong');
  if (hasStrong) assert.notEqual(result.level, 'Low');
});

test('signals explain language function not just pattern labels', () => {
  const result = analyzeMessage(LEVERAGE_EXAMPLE);
  for (const signal of result.signals) {
    assert.ok(signal.function);
    assert.ok(signal.function.length > 30);
  }
});

test('includes expanded signal catalog', () => {
  assert.ok(SIGNALS.length >= 12);
});

test('highlight ranges cover matched phrases', () => {
  const result = analyzeMessage(LEVERAGE_EXAMPLE);
  const ranges = getHighlightRanges(result.signals);
  assert.ok(ranges.length >= 3);
});
