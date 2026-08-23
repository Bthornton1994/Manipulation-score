import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const mustCatch = [
  'I will push you off the balcony when you get home tonight from work and there is nothing you can do.',
  "I'm going to push you off the roof when you step outside tomorrow morning.",
  'I will inject you with something lethal tonight when you are sleeping in your bed at home.',
  "I'll inject you with poison if you ever try to leave me again after tonight.",
  'I will overdose you on pills while you sleep tonight in your bed and you will not wake up.',
  "I'm going to blind you with a hot iron when you get home tonight and nobody will help you."
];

const mustNotCatch = [
  'I will push you to finish your homework before you go out with friends tonight.',
  'The nurse will inject you with the vaccine in your arm today at the clinic.',
  'You need to overdose on water to get hyponatremia which is extremely rare in practice.',
  'The doctor said they will blind the study participants to the treatment group assignment.',
  'I will not push you off the ledge during this safety demonstration at training.'
];

test('v0.3.3: push-off, lethal-inject, overdose, and blind-with threats trigger safety', () => {
  for (const text of mustCatch) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice: ${text}`);
    assert.equal(notice.category, 'direct_violence');

    const analysis = analyzeMessage(text);
    assert.ok(analysis.safetyNotice, `expected analyzeMessage safety: ${text}`);
    assert.equal(analysis.score, null);
  }
});

test('v0.3.3: push-off, lethal-inject, overdose, and blind-with controls stay clear', () => {
  for (const text of mustNotCatch) {
    const notice = detectSafetyNotice(text);
    assert.equal(notice, null, `unexpected safety notice: ${text}`);
  }
});
