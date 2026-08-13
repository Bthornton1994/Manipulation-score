import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  "You're not going anywhere until I'm done with you.",
  'You are not going anywhere until I say you can leave.',
  "You won't go anywhere until I get what I want from you tonight."
];

const MUST_NOT = [
  'You are not going anywhere special until the movie ends and we can talk about dinner plans.',
  'The escape-room host said the doors are locked as part of the puzzle, but emergency exits remain available.',
  'I will find you a new apartment even if you decide to change neighborhoods before the lease ends.'
];

test('going-anywhere-until confinement threats trigger safety notice', () => {
  for (const text of MUST_CATCH) {
    assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
    const result = analyzeMessage(
      `${text} Please respond quickly about this situation today okay thanks please respond quickly about this situation today okay thanks`
    );
    assert.ok(result.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
    assert.equal(result.abstained, false, text);
  }
});

test('going-anywhere-until benign logistics avoid safety notice', () => {
  for (const text of MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
