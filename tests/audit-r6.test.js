import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const BENIGN_LOCATION = [
  'I will not come to your home unless you invite me, because I respect your privacy and boundaries.',
  'I am going to your house for the dinner you invited me to, and I will arrive around seven.',
  'Would you like me to come to your house to help you move, or would another day be better?',
  'I know where you live because you sent me your address for the invitation, and I will keep it private.',
  'I am going to your apartment to drop off the package you requested, but I can leave it outside.'
];

const STALKING_MUST_CATCH = [
  'I am coming to your house tonight whether you want me there or not. You cannot stop me.',
  'I will be outside your office after you said no. You cannot hide from me.',
  'I am following you home even though you told me to stop.',
  'I know where you work and I will be waiting outside. You cannot hide from me.',
  'I will follow you home from work and watch you through the window whether you want me to or not.'
];

const CONDITIONAL_BENIGN = [
  'I know where you work because we met there, but I will not visit unless you invite me.',
  'I will not share your message unless you give me permission, and you can change your mind at any time.',
  'I will not call you unless you ask me to, and I will respect whatever amount of space you need.',
  'I am not coming to your house unless you invite me, and I will respect your decision either way.'
];

const CONDITIONAL_PRESSURE = [
  'I will not speak to you unless you apologize and do what I asked. You need to prove that you care.',
  'You do not get to see me unless you prove you love me and agree to stop talking to your friends.'
];

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), `expected safety for: ${text}`);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice);
  assert.equal(result.score, null);
  assert.equal(result.signals.length, 0);
}

test('round 6: benign location and invitation language does not alarm', () => {
  for (const text of BENIGN_LOCATION) {
    assert.equal(detectSafetyNotice(text), null, text);
  }
});

test('round 6: nonconsensual arrival and stalking combinations trigger safety', () => {
  for (const text of STALKING_MUST_CATCH) {
    assertSafety(text);
  }
});

test('round 6: healthy consent boundaries score 0 without conditional access', () => {
  for (const text of CONDITIONAL_BENIGN) {
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
    assert.equal(result.score, 0, text);
    assert.ok(!result.signals.some((s) => s.id === 'conditional_access'), text);
  }
});

test('round 6: coercive conditional access patterns still detect pressure', () => {
  const speak = analyzeMessage(CONDITIONAL_PRESSURE[0]);
  assert.ok(speak.score >= 50);
  assert.ok(speak.signals.some((s) => s.id === 'conditional_access' || s.id === 'obligation'));

  const see = analyzeMessage(CONDITIONAL_PRESSURE[1]);
  assert.ok(see.score >= 40);
  assert.ok(see.signals.some((s) => s.id === 'conditional_access'));
});

test('round 6: round 5 stalking regression still passes', () => {
  assertSafety('I am following you home whether you want me to or not.');
});
