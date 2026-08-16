import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const mustCatch = [
  'You made me do this. I will kill myself.',
  'It is your fault. I will end my life tonight.',
  'Because of you. I will hurt myself.',
  'If you leave me. I will kill myself.',
  'If you break up with me. I will end my life.',
  'End things with me. I will take all these pills.',
  'If you block me. I will hurt myself.'
];

const mustStayBenign = [
  'I have all the pills ready in the weekly organizer so the nurse can verify the prescribed schedule.',
  'The counselor quoted if you leave me I will kill myself while explaining coercive self-harm threats.',
  'If you leave the theater early, I will end the recording and send everyone the edited file tomorrow.',
  'I would never hurt myself, and I want you to feel safe making your own choice.'
];

test('cross-sentence self-harm coercion triggers a safety notice', () => {
  for (const text of mustCatch) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice: ${text}`);
    assert.equal(notice.category, 'self_harm_coercion', text);
    const analysis = analyzeMessage(text);
    assert.ok(analysis.safetyNotice, `expected analysis safety notice: ${text}`);
  }
});

test('cross-sentence self-harm scan keeps known benign safety contexts clear', () => {
  for (const text of mustStayBenign) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
