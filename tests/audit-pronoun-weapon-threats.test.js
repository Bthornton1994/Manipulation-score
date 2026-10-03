import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage } from '../scoring.js';
import { detectSafetyNotice } from '../safety.js';

const MUST_CATCH = [
  'There is a loaded gun on the table right here in front of us both and I am going to point it at you and pull the trigger if you move even slightly',
  'There is a loaded gun on the table right here in front of us both\n\npoint it at you and pull the trigger if you move even slightly now please stop'
];

const MUST_NOT_CATCH = [
  'Point the knife away from yourself and others while demonstrating the safe cutting technique.',
  'During safety training, the instructor explained that nobody is required to participate if they feel uncomfortable.'
];

test('pronoun weapon threats trigger safety notices', () => {
  for (const text of MUST_CATCH) {
    assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
    assert.equal(result.level, null, text);
  }
});

test('benign knife training and logistics stay clean', () => {
  for (const text of MUST_NOT_CATCH) {
    assert.equal(detectSafetyNotice(text), null, text);
  }
});
