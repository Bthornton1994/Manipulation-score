import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const CONDITIONAL_HARM_THREATS = [
  "If you don't answer I will hurt you tonight when you get home please respond immediately now.",
  "If you don't respond I will hurt you badly tonight when you walk through the door after work ends.",
  "If you don't call me back I will hurt you and you will regret ignoring my messages today.",
  'If you do not reply I will hurt you when you get home from work tonight without warning.'
];

const NEGATED_REASSURANCE = [
  "If you don't answer I will not hurt you tonight.",
  'I would never hurt you, and I want you to feel safe when we talk about this.',
  'I do not want to hurt you, so let us stop this conversation and try again later.'
];

test('conditional compliance threats are not suppressed by earlier contractions', () => {
  for (const text of CONDITIONAL_HARM_THREATS) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice for: ${text}`);
    assert.equal(notice.category, 'direct_violence');

    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, `expected analyzeMessage safety for: ${text}`);
    assert.equal(result.safetyNotice.category, 'direct_violence');
  }
});

test('negated reassurance without reasserted harm stays safe', () => {
  for (const text of NEGATED_REASSURANCE) {
    assert.equal(detectSafetyNotice(text), null, text);
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
  }
});

test('negated reassurance followed by reasserted harm still triggers safety', () => {
  const text =
    "I will not hurt you but if you don't answer I will hurt you tonight when you get home from work please.";
  const notice = detectSafetyNotice(text);
  assert.ok(notice);
  assert.equal(notice.category, 'direct_violence');
});
