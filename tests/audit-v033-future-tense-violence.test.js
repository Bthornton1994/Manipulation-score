import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

/**
 * v0.3.2 added concrete violence idioms but only one future-tense form each.
 * Real threats commonly use the other form (I will vs I'm going to).
 */
const MUST_CATCH = [
  'I will drown you if you ever try leaving me again tonight after this.',
  "I'll drown you if you ever try leaving me again tonight after this fight.",
  "I'm going to drown you if you ever try leaving me again tonight.",
  'I am going to drown you if you ever try leaving me again tonight.',
  'I will put you in the hospital if you keep talking back to me tonight.',
  "I'll put you in the hospital if you keep talking back to me tonight.",
  "I'm going to put you in the hospital if you keep talking back tonight.",
  'I am going to put you in the hospital if you keep talking back tonight.',
  "I'm going to burn you alive if you leave me alone tonight after this.",
  'I am going to burn you alive if you leave me alone tonight after this.',
  "I'm going to break your neck if you tell anyone about what happened.",
  "I'm going to cut you if you try to call for help from this room.",
  "I'm going to poison your drink if you leave me alone after tonight.",
  "I'm going to run you over if you leave work without talking to me.",
  "I'm going to smash your face if you keep talking back after tonight.",
  "I'm going to make sure you never wake up after what you did tonight.",
  'I will burn you alive if you leave me alone tonight after this fight.',
  "I'll smash your face if you keep talking back after everything tonight."
];

const MUST_REMAIN_BENIGN = [
  'A strong river can drown you even near shore, which is why everyone should wear a life jacket.',
  'The midday sun can burn you quickly without sunscreen, a hat, and protective clothing.',
  'The doctor said the medicine might hurt you if combined with alcohol or another sedating drug.',
  'I will not drown you, and I want you to feel safe when we talk about what happened tonight.',
  "I'll never put you in the hospital, and I want us both to calm down before we continue."
];

test('first-person violence idioms catch both I will and I am going to forms', async (t) => {
  for (const text of MUST_CATCH) {
    await t.test(text, () => {
      const notice = detectSafetyNotice(text);
      assert.ok(notice, `expected safety notice for: ${text}`);
      assert.equal(notice.category, 'direct_violence');

      const result = analyzeMessage(text);
      assert.ok(result.safetyNotice, `expected analyzeMessage safety for: ${text}`);
      assert.equal(result.safetyNotice.category, 'direct_violence');
    });
  }
});

test('benign drown/burn/medical framing and negated reassurance stay non-safety', async (t) => {
  for (const text of MUST_REMAIN_BENIGN) {
    await t.test(text, () => {
      assert.equal(detectSafetyNotice(text), null, text);
      const result = analyzeMessage(text);
      assert.ok(!result.safetyNotice, text);
    });
  }
});
