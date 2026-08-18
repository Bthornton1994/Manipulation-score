import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const mustCatch = [
  'At the workshop tomorrow I will hurt you if you talk to anyone else about us.',
  'During training I will kill you if you try to leave me tonight after everyone goes home.',
  'I will shoot you after the training ends if you tell anyone about what happened today.',
  'As we agreed about the schedule I will hurt you if you miss curfew again tonight.',
  'You asked me for the keys and I will kill you if you leave me tonight after work.',
  'You asked me to walk you home and I will hurt you if you refuse to stay with me.'
];

const mustRemainBenign = [
  'During safety training, the instructor used "I am going to kill you" as an example of threatening language.',
  'During rehearsal the actor said I will shoot you on the mark when the director nods.',
  'In the movie I will kill you said the actor.',
  'I took your keys to the mechanic because you asked me to replace the worn brake pads today.',
  'I know your work schedule because you asked me to arrange carpools for the entire team this month.',
  'I am outside your house with the groceries you requested, and I can leave them on the porch.'
];

test('training/workshop keywords alone do not suppress first-person threats', async (t) => {
  for (const text of mustCatch.slice(0, 3)) {
    await t.test(text, () => {
      assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
      const analysis = analyzeMessage(text);
      assert.ok(analysis.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
    });
  }
});

test('requested logistics alone do not suppress co-located first-person threats', async (t) => {
  for (const text of mustCatch.slice(3)) {
    await t.test(text, () => {
      assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
      const analysis = analyzeMessage(text);
      assert.ok(analysis.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
    });
  }
});

test('media/role attribution and logistics-only clauses stay quiet', async (t) => {
  for (const text of mustRemainBenign) {
    await t.test(text, () => {
      assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
    });
  }
});
