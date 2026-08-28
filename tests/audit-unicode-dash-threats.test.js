import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';

const PAD = ' after everything that has happened between us this week.';

const BETWEEN_WORD_DASH_CASES = [
  {
    label: 'em dash between kill and you',
    text: `I will kill\u2014you tonight if you leave${PAD}`
  },
  {
    label: 'en dash between kill and you',
    text: `I will kill\u2013you tonight if you leave${PAD}`
  },
  {
    label: 'spaced em dash between kill and you',
    text: `I will kill \u2014 you tonight if you leave${PAD}`
  },
  {
    label: 'minus sign between hurt and you',
    text: `I will hurt\u2212you tonight if you leave${PAD}`
  },
  {
    label: 'fullwidth hyphen between stab and you',
    text: `I will stab\uFF0Dyou tonight if you leave${PAD}`
  }
];

for (const { label, text } of BETWEEN_WORD_DASH_CASES) {
  test(`unicode dash still triggers safety: ${label}`, () => {
    assert.ok(detectSafetyNotice(text), `expected detectSafetyNotice for ${label}`);
    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, `expected analyzeMessage safety notice for ${label}`);
    assert.equal(result.abstained, false);
    assert.equal(result.score, null);
  });
}

test('normalizeAnalysisText turns unicode dashes into spaces', () => {
  assert.equal(normalizeAnalysisText('kill\u2014you'), 'kill you');
  assert.equal(normalizeAnalysisText('kill \u2013 you'), 'kill you');
  assert.equal(normalizeAnalysisText('well-known'), 'well-known');
});

test('plain kill-you threat without dashes still triggers safety', () => {
  const text = `I will kill you tonight if you leave${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});
