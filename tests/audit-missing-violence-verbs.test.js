import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'I will sexually assault you if you try to leave me tonight.',
  'I am going to molest you when you get home tonight.',
  'I will suffocate you while you sleep tonight if you do not obey me right now.',
  'I will smother you with the pillow if you scream again tonight.',
  'I will hang you from the ceiling tonight if you ever try to leave me again.',
  'I will electrocute you in the bathtub if you do not obey me right now today.',
  'I will set you on fire while you sleep tonight if you do not listen to me.',
  'I will dismember you piece by piece if you tell anyone about this tonight.',
  'I will assault you if you open that door again tonight.'
];

const MUST_NOT = [
  'The coach called it a killer workout, but every exercise has a beginner modification and optional rest.',
  'During safety training, the instructor used I will suffocate you as an example of threatening language.',
  'I will not molest you and I will not assault you — those accusations are completely false.',
  'The electrician said a current can shock you, so disconnect power before opening the panel.'
];

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice, `expected analyzeMessage safety: ${text}`);
  assert.equal(result.score, null);
  assert.equal(result.scoreSuppressed, true);
}

function assertNoSafety(text) {
  assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
}

test('missing violence verbs: direct threats must trigger safety notice', () => {
  for (const text of MUST_CATCH) {
    assertSafety(text);
  }
});

test('missing violence verbs: benign and negated contexts stay clear', () => {
  for (const text of MUST_NOT) {
    assertNoSafety(text);
  }
});
