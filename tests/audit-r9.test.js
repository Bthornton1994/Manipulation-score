import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const CONSENSUAL_CONTINUOUS_MUST_NOT = [
  'I am actually waiting outside your home because you asked me to pick you up after the event tonight.',
  'I am currently following you home because you asked me to walk with you and help carry your bags.',
  'I am still waiting outside your office because our agreed meeting is running late and the doors remain locked.',
  'I am actually waiting outside your office to give you the ride you requested.',
  'I am actually waiting outside your office to give you the ride you requested after your evening shift ends.',
  'I am currently following you home because you asked me to make sure you arrive safely after dark.'
];

const CONTINUOUS_REFUSAL_MUST_CATCH = [
  'I am actually waiting outside your office now even though you asked me to leave.',
  'I am still waiting outside your home even though you told me to go away.',
  'I am actually waiting outside your office right now even though you asked me to leave and said you did not want me there.',
  'I am still waiting outside your home tonight even though you told me to go away and asked me not to come back.',
  'The news report quoted, "I will follow you home." I am actually waiting outside your office now even though you told me to leave.',
  'I am currently following you home even though you asked me to stop.'
];

function assertNoSafety(text) {
  assert.equal(detectSafetyNotice(text), null, text);
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice, text);
}

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), `expected safety for: ${text}`);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice);
  assert.equal(result.score, null);
  assert.equal(result.signals.length, 0);
}

test('round 9: consensual continuous-adverb location messages do not alarm', () => {
  for (const text of CONSENSUAL_CONTINUOUS_MUST_NOT) {
    assertNoSafety(text);
  }
});

test('round 9: continuous-adverb conduct with refusal still triggers safety', () => {
  for (const text of CONTINUOUS_REFUSAL_MUST_CATCH) {
    assertSafety(text);
  }
});

test('round 9: explicit-future stalking without consent still triggers safety', () => {
  assertSafety('But I really will follow you home tonight.');
  assertSafety(
    'During safety training, the instructor used "I will follow you home" as an example. But I really will follow you home tonight.'
  );
});
