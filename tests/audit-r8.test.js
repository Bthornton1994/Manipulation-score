import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const GUILT_URGENCY_ISOLATION =
  "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you.";

const ATTRIBUTED_STALKING_MUST_NOT = [
  'During safety training, the instructor used "I will follow you home and watch you through the window" as an example of stalking language.',
  'In the novel, the villain said, "I will follow you home and watch you through the window," before the hero escaped.',
  'The news reported that a suspect said he would follow her home and watch through the window during the incident.',
  'The trainer said, "I will follow you home, watch you through the window, and wait outside your office," to demonstrate stalking language.'
];

const MIXED_STALKING_MUST_CATCH = [
  'During safety training, the instructor used "I will follow you home" as an example. But I really will follow you home tonight.',
  'In the novel, the villain said he would watch through the window. I am going to follow you home tonight whether you want me to or not.',
  'The news report quoted, "I will follow you home." I am actually waiting outside your office now even though you told me to leave.'
];

const STALKING_MUST_CATCH = [
  'I am coming to your house tonight whether you want me there or not. You cannot stop me.',
  'I will be outside your office after you said no. You cannot hide from me.',
  'I am following you home even though you told me to stop.'
];

const BENIGN_INVITATION_MUST_NOT = [
  'I am going to your house for the dinner you invited me to, and I will arrive around seven.',
  'Would you like me to come to your house to help you move, or would another day be better?',
  'I am going to your apartment to drop off the package you requested, but I can leave it outside.',
  'I know where you live because you sent me your address for the invitation, and I will keep it private.',
  'Could you give me a ride to your office tomorrow morning if that works for you?',
  'Would you like me to walk with you to your car tonight so you feel safer on the way home?'
];

const HEALTHY_BOUNDARY_MUST_NOT = [
  'I will not share your message unless you give me permission, and you can change your mind at any time.',
  'I will not call you unless you ask me to, and I will respect whatever amount of space you need.',
  'I know where you work because we met there, but I will not visit unless you invite me.'
];

const VIOLENCE_MUST_CATCH = [
  'I am going to kill you tonight.',
  'I would never hurt you, but I am going to kill you tonight if you come back here.'
];

const ATTRIBUTED_VIOLENCE_MUST_NOT = [
  'During safety training, the instructor used "I am going to kill you" as an example of threatening language.',
  'In the novel, the villain said, "I am going to kill you," before the hero escaped.',
  'The news reported that the suspect said "I will kill you" in court yesterday.'
];

const MIXED_VIOLENCE_MUST_CATCH = [
  'During safety training, the instructor used "I am going to kill you" as an example. But I really will kill you tonight.'
];

const CONDITIONAL_PRESSURE = [
  'I will not speak to you unless you apologize and do what I asked. You need to prove that you care.',
  'You do not get to see me unless you prove you love me and agree to stop talking to your friends.'
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

function assertZeroScore(text) {
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice, text);
  if (result.abstained) {
    assert.equal(result.score, null, text);
    assert.equal(result.signals.length, 0, text);
  } else {
    assert.equal(result.score, 0, text);
  }
}

test('round 8 gate: attributed stalking quotations do not alarm', () => {
  for (const text of ATTRIBUTED_STALKING_MUST_NOT) {
    assertNoSafety(text);
  }
});

test('round 8 gate: mixed stalking attribution plus real conduct triggers safety', () => {
  for (const text of MIXED_STALKING_MUST_CATCH) {
    assertSafety(text);
  }
});

test('round 8 gate: coercive arrival and refusal-violating stalking triggers safety', () => {
  for (const text of STALKING_MUST_CATCH) {
    assertSafety(text);
  }
});

test('round 8 gate: invitation delivery ride and escort controls do not alarm', () => {
  for (const text of BENIGN_INVITATION_MUST_NOT) {
    assertNoSafety(text);
  }
});

test('round 8 gate: healthy permission contact and invitation boundaries score zero', () => {
  for (const text of HEALTHY_BOUNDARY_MUST_NOT) {
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
    assert.equal(result.score, 0, text);
    assert.ok(!result.signals.some((s) => s.id === 'conditional_access'), text);
  }
});

test('round 8 gate: direct violence and mixed quotation plus real violence', () => {
  for (const text of VIOLENCE_MUST_CATCH) {
    assertSafety(text);
  }
  for (const text of ATTRIBUTED_VIOLENCE_MUST_NOT) {
    assertZeroScore(text);
  }
  for (const text of MIXED_VIOLENCE_MUST_CATCH) {
    assertSafety(text);
  }
});

test('round 8 gate: positive manipulation control scores high with three functions', () => {
  const result = analyzeMessage(GUILT_URGENCY_ISOLATION);
  assert.equal(result.level, 'High');
  assert.ok(result.score >= 61);
  assert.equal(result.signals.length, 3);
  assert.ok(result.signals.some((s) => s.id === 'guilt'));
  assert.ok(result.signals.some((s) => s.id === 'urgency'));
  assert.ok(result.signals.some((s) => s.id === 'isolation'));
});

test('round 8 gate: coercive conditional-access controls retain pressure scores', () => {
  const speak = analyzeMessage(CONDITIONAL_PRESSURE[0]);
  assert.ok(speak.score >= 50);
  assert.ok(speak.signals.some((s) => s.id === 'conditional_access' || s.id === 'obligation'));

  const see = analyzeMessage(CONDITIONAL_PRESSURE[1]);
  assert.ok(see.score >= 40);
  assert.ok(see.signals.some((s) => s.id === 'conditional_access'));
});

test('round 8 gate: Okay abstains without numeric score', () => {
  const result = analyzeMessage('Okay.');
  assert.equal(result.abstained, true);
  assert.equal(result.scoreSuppressed, true);
  assert.equal(result.score, null);
  assert.equal(result.level, null);
  assert.match(result.bandHeadline, /Not enough text/i);
});
