import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const SUPPORTIVE_AUTONOMY_MUST_NOT = [
  'Thank you for explaining what happened. Please take whatever time you need to think, and let me know when you are comfortable talking again.',
  'Take whatever time you need to think before we talk again.',
  'Please take all the time you need to process this, and reach out when you are ready.',
  'You can take whatever time you need to think about it.',
  'I want you to take your time—no rush to respond.',
  'Take your time and let me know when you are comfortable continuing.',
  'Whenever you are ready to talk, I am here. There is no pressure to answer today.',
  'Please take the time you need to think, and contact me when you feel ready.',
  'There is no rush. Take whatever time you need to decide.',
  'I understand you need time to think. Reach out when you are comfortable.',
  'Feel free to take all the time you need before we discuss this further.',
  'Let me know when you are ready to talk—take whatever time you need.',
  'Please do not feel rushed. Take your time and think through what you need.',
  'When you are comfortable talking again, just let me know. Take whatever time you need.',
  "You have space to think. Message me when you're ready and comfortable talking again."
];

const COERCIVE_OBLIGATION_MUST_CATCH = [
  'You need to apologize and do what I asked. You need to prove that you care.',
  'After everything I have done for you, you need to make this right tonight and prove you still care.',
  'You need to call me tonight and explain yourself before I lose patience with this situation.'
];

const INSTRUCTIONAL_NOBODY_MUST_NOT = [
  'During safety training, the instructor explained that nobody is required to participate in the exercise if anyone feels uncomfortable.',
  'In the workshop, the trainer said nobody is required to share personal stories during the opening activity.',
  'The facilitator used nobody is required to participate as an example of inclusive classroom language during training.'
];

const COERCIVE_NOBODY_MUST_CATCH =
  'Nobody else will care about you if you leave me, and nobody else will understand you the way I do.';

const SMOKE_TESTS = {
  abstention: 'You never listen.',
  supportive: SUPPORTIVE_AUTONOMY_MUST_NOT[0],
  manipulation:
    "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you. Fine, forget it.",
  benignPickup:
    'I am actually waiting outside your home because you asked me to pick you up after the event tonight.',
  trainingHarm:
    'During safety training, the instructor used "I am going to kill you" as an example of threatening language, and nobody is required to participate.',
  mixedThreat:
    'During safety training, the instructor used "I will follow you home" as an example. But I really will follow you home tonight.',
  refusalStalking:
    'I am actually waiting outside your office now even though you asked me to leave.'
};

function assertZeroScore(text) {
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice, text);
  if (result.abstained) {
    assert.equal(result.score, null, text);
  } else {
    assert.equal(result.score, 0, text);
  }
  assert.ok(!result.signals.some((s) => s.id === 'obligation'), text);
}

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), text);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice);
  assert.equal(result.score, null);
}

test('round 11: supportive autonomy messages do not trigger obligation', () => {
  for (const text of SUPPORTIVE_AUTONOMY_MUST_NOT) {
    assertZeroScore(text);
  }
});

test('round 11: coercive obligation language still scores pressure', () => {
  for (const text of COERCIVE_OBLIGATION_MUST_CATCH) {
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
    assert.ok(result.signals.some((s) => s.id === 'obligation'), text);
    assert.ok(result.score >= 31, text);
  }
});

test('round 11: instructional nobody does not trigger absolutes', () => {
  for (const text of INSTRUCTIONAL_NOBODY_MUST_NOT) {
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
    assert.ok(!result.signals.some((s) => s.id === 'absolutes'), text);
    if (!result.abstained) {
      assert.equal(result.score, 0, text);
    }
  }
});

test('round 11: coercive nobody framing still can score', () => {
  const result = analyzeMessage(COERCIVE_NOBODY_MUST_CATCH);
  assert.ok(!result.safetyNotice);
  assert.ok(result.signals.some((s) => s.id === 'absolutes'));
});

test('round 11: live smoke tests from audit report', () => {
  const abstain = analyzeMessage(SMOKE_TESTS.abstention);
  assert.equal(abstain.abstained, true);
  assert.equal(abstain.score, null);

  assertZeroScore(SMOKE_TESTS.supportive);

  const manipulation = analyzeMessage(SMOKE_TESTS.manipulation);
  assert.ok(manipulation.score >= 61);
  assert.equal(manipulation.level, 'High');
  assert.ok(manipulation.signals.length >= 3);

  assertZeroScore(SMOKE_TESTS.benignPickup);

  const training = analyzeMessage(SMOKE_TESTS.trainingHarm);
  assert.ok(!training.safetyNotice);
  assert.ok(!training.signals.some((s) => s.id === 'absolutes'));

  assertSafety(SMOKE_TESTS.mixedThreat);
  assertSafety(SMOKE_TESTS.refusalStalking);
});
