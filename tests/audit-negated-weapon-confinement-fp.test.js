import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_NOT_ALARM = [
  'I will never point a gun at you. Firearms stay locked away and I want you to feel safe when we talk about hard topics tonight.',
  'I will not lock you in the bedroom. The door stays open and you can leave whenever you need space from this argument tonight.',
  'I promise I will not lock you in anywhere and you can leave whenever you need space tonight after dinner.',
  'If you feel chest pain call 911 or you could die waiting. The nurse repeated this advice during discharge teaching today.',
  'The doctor said call 911 or you might die if the pain returns during the night after discharge.'
];

const MUST_CATCH = [
  'I will point a gun at you if you leave tonight after dinner.',
  'I will lock you in the bedroom if you try to leave tonight after dinner.',
  'Call 911 or I will kill you if you leave this house tonight after everyone leaves.',
  'Call 911 or die. I will not let you leave this house tonight after everyone is gone.',
  'Call 911 or you die tonight if you try to walk out that door after dinner.',
  'Call 911 unless you want me to kill you tonight after everyone leaves the house.'
];

test('negated weapon and confinement reassurance does not trigger safety', () => {
  for (const text of MUST_NOT_ALARM.slice(0, 3)) {
    assert.equal(detectSafetyNotice(text), null, text);
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
  }
});

test('clinical call-911 advice with modal die hedging does not trigger safety', () => {
  for (const text of MUST_NOT_ALARM.slice(3)) {
    assert.equal(detectSafetyNotice(text), null, text);
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
  }
});

test('asserted weapon, confinement, and emergency coercion still trigger safety', () => {
  for (const text of MUST_CATCH) {
    assert.ok(detectSafetyNotice(text), `expected safety for: ${text}`);
    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, text);
    assert.equal(result.score, null, text);
  }
});
