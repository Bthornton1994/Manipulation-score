import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH_SELF_HARM = [
  'If you break up with me I will kill myself tonight after you walk out that door.',
  'If you dump me I will kill myself tonight after everything we have been through.',
  'If you abandon me I will kill myself before morning comes for either of us.',
  'If you divorce me I will kill myself tonight after everything we built together.',
  "I'll end my life if you don't come back home right now this evening after work.",
  'I will end my life if you break up with me tonight after all of this fighting.',
  'I will commit suicide if you leave me tonight after everything we have shared.',
  'If you leave me I will commit suicide tonight and everyone will blame you forever.',
  'I will kill myself if you leave me tonight after everything we have shared.'
];

const MUST_CATCH_ANY_SAFETY = [
  // Still caught via the older if-you-leave + kill rule; keep as regression.
  'If you leave me I will kill myself tonight after everything we have been through.'
];

const MUST_NOT = [
  'The counselor quoted if you leave me I will kill myself while explaining coercive self-harm threats.',
  'Our workplace training covered de-escalation when someone threatens suicide.',
  'All the pills ready in the weekly organizer so you remember your evening dose.',
  'I will not hurt myself if you need space this weekend after a stressful week at work.'
];

function assertSafetyResult(text) {
  const padded = `${text} Please respond quickly about this situation today okay thanks please respond quickly about this situation today okay thanks`;
  const result = analyzeMessage(padded);
  assert.ok(result.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
  assert.equal(result.abstained, false, text);
  assert.equal(result.scoreSuppressed, true, text);
}

test('self-harm coercion: breakup and end-my-life variants trigger safety notice', () => {
  for (const text of MUST_CATCH_SELF_HARM) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice: ${text}`);
    assert.equal(notice.category, 'self_harm_coercion', text);
    assertSafetyResult(text);
  }
});

test('self-harm coercion: leave + kill myself still triggers safety notice', () => {
  for (const text of MUST_CATCH_ANY_SAFETY) {
    assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
    assertSafetyResult(text);
  }
});

test('self-harm coercion: training and reassurance contexts stay clear', () => {
  for (const text of MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
