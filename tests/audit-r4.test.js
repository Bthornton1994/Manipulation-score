import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MIXED_NEGATION_MUST_CATCH = [
  'I would never hurt you, but I am going to kill you tonight if you come back here.',
  'I do not want to harm you, but I will shoot you.',
  'I would never hurt you. I am going to kill you tonight.',
  'I would never hurt you, but I am going to kill you if you come back.'
];

const MIXED_NEGATION_MUST_NOT = [
  'I would never hurt you, and I want you to feel safe making your own choice.',
  'I do not want to harm you, so let us pause this conversation.'
];

const TRAINING_MUST_NOT = [
  'During safety training, the instructor used "I am going to kill you" as an example of threatening language.'
];

const TRAINING_THEN_THREAT =
  'During safety training, the instructor used "I am going to kill you" as an example. But I really will kill you tonight.';

function assertSafety(text) {
  const notice = detectSafetyNotice(text);
  assert.ok(notice, `expected safety for: ${text}`);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice);
  assert.equal(result.score, null);
  assert.equal(result.signals.length, 0);
}

test('round 4: adversative negation does not suppress later threat in same sentence', () => {
  for (const text of MIXED_NEGATION_MUST_CATCH) {
    assertSafety(text);
  }
});

test('round 4: negated reassurance without adversative threat stays safe', () => {
  for (const text of MIXED_NEGATION_MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, text);
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice);
    assert.ok(!result.signals.some((s) => s.id === 'absolutes'), text);
  }
});

test('round 4: instructor training quotation is not a safety notice', () => {
  for (const text of TRAINING_MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, text);
  }
});

test('round 4: training example followed by separate real threat triggers safety', () => {
  assertSafety(TRAINING_THEN_THREAT);
});

test('round 4: benign never hurt you reassurance has no absolutes signal', () => {
  const text = 'I would never hurt you, and I want you to feel safe making your own choice.';
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice);
  assert.equal(result.signals.length, 0);
  if (!result.abstained) {
    assert.equal(result.score, 0);
  }
});
