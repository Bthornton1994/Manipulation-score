import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const pad = (text) => `${text} ${'word '.repeat(14)}`.trim();

const MUST_CATCH = [
  'I will bash your head in if you try to leave tonight.',
  "I'm going to punch you until you bleed everywhere.",
  'I will kick you if you open that door again.',
  'I will snap your neck if you scream at me.',
  'I will throw you down the stairs when you walk out.',
  'I will beat your face in because you embarrassed me.',
  'Give me the phone or I will bash your skull in.'
];

const MUST_REMAIN_BENIGN = [
  'The coach said a bad fall can bash your head if you skip the helmet during practice.',
  'The safety video shows how a punch you throw without control can injure your wrist.',
  'The trainer explained that a kick you deliver with poor form can strain your hip.',
  'The actor rehearsed I will snap your neck before the director replaced the violent line.',
  'In the script the villain says I will throw you down, then the hero immediately escapes.',
  'The makeup artist can beat your face in with contour, which is why the tutorial uses a lighter hand.',
  'I will not punch you, and I want you to feel safe making your own choice.'
];

test('body-part violence: must-catch threats trigger safety notice', () => {
  for (const text of MUST_CATCH) {
    const sample = pad(text);
    assert.ok(detectSafetyNotice(sample), `expected safety notice: ${text}`);
    const analysis = analyzeMessage(sample);
    assert.ok(analysis.safetyNotice, `expected safety result: ${text}`);
    assert.equal(analysis.level, null, `expected no score band: ${text}`);
  }
});

test('body-part violence: benign and negated controls stay clear', () => {
  for (const text of MUST_REMAIN_BENIGN) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
