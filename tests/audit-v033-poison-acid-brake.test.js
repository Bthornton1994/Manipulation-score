import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

/**
 * Sibling of poison-your-drink: bare "poison you", acid-throw, and brake
 * sabotage threats were missing from IMMEDIATE_RULES and could return Low.
 */
const MUST_CATCH = [
  'I will poison you if you keep ignoring me about us tonight after everything.',
  "I'll poison you if you keep talking to him about what happened last night.",
  "I'm going to poison you if you ever try to leave me alone after tonight.",
  'I am going to poison you if you go to the police about what I did tonight.',
  'I will throw acid on you if you cheat on me again after everything tonight.',
  "I'm going to throw acid in your face if you leave me tonight after this fight.",
  'I am going to throw acid in your eyes if you talk to him again after tonight.',
  'I will cut the brakes on your car if you try to leave me tonight after this.',
  "I'm going to cut your brake lines if you go see him again after tonight.",
  "I'll cut your brake line if you keep ignoring me about staying home tonight."
];

const MUST_REMAIN_BENIGN = [
  'Some wild mushrooms can poison you if foraged incorrectly, so stick to known markets.',
  'Household cleaners with acid on your skin need immediate rinsing and medical advice.',
  'Ask a mechanic to cut the brakes on your car only when replacing worn pads safely.',
  'I will not poison you, and I want you to feel safe when we talk about this tonight.',
  "I'll never throw acid on you, and I want us both to calm down before we continue."
];

test('poison you, acid-throw, and brake-sabotage threats trigger safety notices', async (t) => {
  for (const text of MUST_CATCH) {
    await t.test(text, () => {
      const notice = detectSafetyNotice(text);
      assert.ok(notice, `expected safety notice for: ${text}`);
      assert.equal(notice.category, 'direct_violence');

      const result = analyzeMessage(text);
      assert.ok(result.safetyNotice, `expected analyzeMessage safety for: ${text}`);
      assert.equal(result.safetyNotice.category, 'direct_violence');
      assert.equal(result.scoreSuppressed, true);
    });
  }
});

test('benign poison/acid/brake framing and negated reassurance stay non-safety', async (t) => {
  for (const text of MUST_REMAIN_BENIGN) {
    await t.test(text, () => {
      assert.equal(detectSafetyNotice(text), null, text);
      const result = analyzeMessage(text);
      assert.ok(!result.safetyNotice, text);
    });
  }
});
