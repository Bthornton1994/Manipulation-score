import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const PAD =
  ' right now immediately today please answer stop ignoring messages completely forever always';

const mustCatch = [
  'gun at your head',
  'put a gun to your head',
  'point the gun at your head',
  'I will shoot your head',
  'shoot your head',
  'knife to your throat',
  'knife at your neck',
  'machete at your throat'
];

const mustRemainBenign = [
  'The actor rehearsed gun at your head before the director replaced the violent line.',
  'Training covers how to respond when a patient describes a gun at your head in a safety drill script.',
  'I will not shoot your head because that is not how we resolve disagreements in this workshop.'
];

for (const text of mustCatch) {
  test(`possessive weapon threat must trigger safety: ${text}`, () => {
    assert.ok(detectSafetyNotice(text), `expected safety notice for "${text}"`);
    const padded = text + PAD;
    const analysis = analyzeMessage(padded);
    assert.ok(analysis.safetyNotice, `expected safety notice after scoring for "${text}"`);
    assert.equal(analysis.level, null, 'safety path should suppress manipulation band');
  });
}

for (const text of mustRemainBenign) {
  test(`possessive weapon phrasing stays benign in context: ${text.slice(0, 48)}…`, () => {
    assert.equal(detectSafetyNotice(text), null);
  });
}
