import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const BEAT_CHOKE_THREATS = [
  "I'll beat you if you try to leave me tonight after this argument ends badly.",
  'I am going to beat you if you try to walk away from me again tonight.',
  "I'm going to beat you if you keep ignoring me and refuse to come home.",
  "I'll choke you if you try to leave me tonight after this fight between us.",
  'I am going to choke you if you try to walk away from me again tonight.',
  "I'm going to choke you if you keep pushing me after everything I have done."
];

const NEGATED_BEAT_CHOKE = [
  'I will not beat you, and I want you to feel safe when we talk about what happened.',
  "I'll never choke you, and I want us both to calm down before we continue talking tonight."
];

test('first-person beat and choke contractions trigger safety notices', () => {
  for (const text of BEAT_CHOKE_THREATS) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice for: ${text}`);
    assert.equal(notice.category, 'direct_violence');

    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, `expected analyzeMessage safety for: ${text}`);
    assert.equal(result.safetyNotice.category, 'direct_violence');
  }
});

test('existing I will beat/choke cases still trigger safety', () => {
  assert.ok(detectSafetyNotice('I will beat you until you cannot stand up again.'));
  assert.ok(detectSafetyNotice('I will choke you if you try to walk away from me.'));
});

test('negated beat/choke reassurance does not trigger safety', () => {
  for (const text of NEGATED_BEAT_CHOKE) {
    assert.equal(detectSafetyNotice(text), null, text);
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
  }
});
