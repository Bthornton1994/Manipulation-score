import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const mustCatch = [
  'I have a gun. You better listen.',
  'I have a gun. You need to do what I say.',
  'I brought a knife. You cannot leave.',
  "I've got a weapon. Don't make me use it on you.",
  'I am holding a knife. Stay still or you will get hurt.'
];

const mustStayBenign = [
  'The safety guide says a knife can cut you before explaining how to use a cutting board correctly.',
  'Point the knife away from yourself and others while demonstrating the safe cutting technique.',
  'Never point the firearm at anyone, even when you believe the chamber is empty during training.',
  'I will shoot you the revised presentation after legal approves the final language this afternoon.'
];

test('cross-sentence weapon threats trigger a safety notice', () => {
  for (const text of mustCatch) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice: ${text}`);
    assert.equal(notice.category, 'weapon_threat', text);
    const analysis = analyzeMessage(text);
    assert.ok(analysis.safetyNotice, `expected analysis safety notice: ${text}`);
  }
});

test('cross-sentence weapon scan keeps known benign safety contexts clear', () => {
  for (const text of mustStayBenign) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
