import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage } from '../scoring.js';

test('returns an empty result for whitespace', () => {
  assert.deepEqual(analyzeMessage('   '), { score: 0, level: 'No message', signals: [], evidence: [], response: '', responses: {}, signalCount: 0, context: 'personal' });
});

test('detects multiple pressure patterns', () => {
  const result = analyzeMessage("If you really cared, you'd answer right now or else you'll regret it.");
  assert.equal(result.level, 'High pressure');
  assert.deepEqual(result.signals.map(({ id }) => id), ['guilt', 'urgency', 'threat']);
  assert.ok(result.score <= 100);
  assert.equal(result.signalCount, 3);
  assert.deepEqual(result.signals[0].evidence[0], { text: 'If you really cared', start: 0, end: 19 });
});

test('returns exact evidence offsets for safe UI rendering', () => {
  const result = analyzeMessage('Please do not say I am too sensitive.');
  assert.deepEqual(result.signals[0].evidence, [{ text: 'too sensitive', start: 23, end: 36 }]);
});

test('evidence offsets refer to the original text including leading whitespace', () => {
  const result = analyzeMessage('   You are too sensitive.');
  assert.deepEqual(result.signals[0].evidence[0], { text: 'too sensitive', start: 11, end: 24 });
});

test('tailors boundary responses to the strongest relevant pattern', () => {
  const threat = analyzeMessage("Do this or else you'll regret it.");
  assert.match(threat.responses.boundary, /under a threat/);

  const isolation = analyzeMessage("Don't tell anyone. This is just between us.");
  assert.match(isolation.responses.boundary, /keeping this conversation secret/);
  assert.equal(isolation.response, isolation.responses.pause);
});

test('accepts nullish input without throwing', () => {
  assert.equal(analyzeMessage(null).level, 'No message');
});

test('uses validated conversation context for response coaching', () => {
  const work = analyzeMessage('You always ignore my request.', { context: 'work' });
  assert.match(work.responses.boundary, /professional/);
  assert.equal(work.context, 'work');
  assert.equal(analyzeMessage('Hello', { context: 'unknown' }).context, 'personal');
});

test('keeps neutral language in the low range', () => {
  const result = analyzeMessage('Could we talk tomorrow when we both have time?');
  assert.equal(result.score, 0);
  assert.equal(result.level, 'Low pressure');
  assert.equal(result.signals.length, 0);
});

test('provides sorted evidence across signal types', () => {
  const result = analyzeMessage("Right now, don't tell anyone.");
  assert.deepEqual(result.evidence.map(({ signalId }) => signalId), ['urgency', 'isolation']);
  assert.equal(result.evidence[0].start, 0);
});

test('caps scores at 100 and remains deterministic', () => {
  const text = "If you really cared, answer right now or else. Don't tell anyone. You're crazy and you always lie.";
  assert.equal(analyzeMessage(text).score, 100);
  assert.deepEqual(analyzeMessage(text), analyzeMessage(text));
});

test('deduplicates repeated matched phrases', () => {
  const result = analyzeMessage('You always do this. Always, always.');
  assert.deepEqual(result.signals[0].matches, ['always']);
  assert.equal(result.signals[0].points, 17);
});
