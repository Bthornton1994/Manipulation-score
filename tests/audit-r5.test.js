import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const STALKING_MUST_CATCH = [
  'I know where you work and I will be waiting outside. You cannot hide from me.',
  'I will follow you home from work and watch you through the window whether you want me to or not.',
  'I know where you work, I am watching you, and I will follow you home tonight whether you want me to or not.',
  'I will be outside your office when you leave. You cannot hide from me.',
  'I am following you home whether you want me to or not.',
  'I know where you live. I am watching you and I will come find you tonight.'
];

const STALKING_MUST_NOT = [
  'I can wait outside your office if you want a ride home.',
  'I will follow you home to make sure you arrive safely, if you want me to.',
  'I know where you work because we met there.',
  'The news reported that a suspect was following someone home from work last night.',
  'In the fictional scene, the villain said he would follow her home through the rain.',
  'During safety training, the instructor described following someone home as stalking behavior.'
];

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), `expected safety for: ${text}`);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice);
  assert.equal(result.score, null);
  assert.equal(result.scoreSuppressed, true);
  assert.equal(result.signals.length, 0);
}

test('round 5: expanded stalking fixtures trigger safety notice', () => {
  for (const text of STALKING_MUST_CATCH) {
    assertSafety(text);
  }
});

test('round 5: consensual and attributed stalking language does not alarm', () => {
  for (const text of STALKING_MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, text);
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
  }
});

test('round 5: round 4 mixed negation regression still passes', () => {
  const text =
    'I would never hurt you, but I am going to kill you tonight if you come back here.';
  assertSafety(text);
});
