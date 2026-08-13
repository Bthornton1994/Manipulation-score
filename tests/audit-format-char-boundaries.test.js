import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';

const BETWEEN_WORD_CASES = [
  {
    label: 'zero-width space between kill and you',
    text: 'I will kill\u200Byou tonight if you leave after everything I have done for us.'
  },
  {
    label: 'zero-width non-joiner between kill and you',
    text: 'I will kill\u200Cyou tonight if you leave after everything I have done for us.'
  },
  {
    label: 'BOM between hurt and you',
    text: 'I will hurt\uFEFFyou tonight if you tell anyone what happened between us.'
  },
  {
    label: 'soft hyphen between kill and you',
    text: 'I will kill\u00ADyou tonight if you leave after everything I have done for us.'
  }
];

for (const { label, text } of BETWEEN_WORD_CASES) {
  test(`between-word format/soft-hyphen still triggers safety: ${label}`, () => {
    assert.ok(detectSafetyNotice(text), `expected detectSafetyNotice for ${label}`);
    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, `expected analyzeMessage safety notice for ${label}`);
    assert.equal(result.abstained, false);
  });
}

test('mid-word zero-width insertion still triggers safety', () => {
  const text = 'I will k\u200Bill you tonight after everyone leaves the house tonight.';
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});

test('strip mode still glues between-word format chars (space mode is required)', () => {
  const glued = normalizeAnalysisText('I will kill\u200Byou tonight');
  assert.match(glued, /killyou/i);
  const spaced = normalizeAnalysisText('I will kill\u200Byou tonight', { formatMode: 'space' });
  assert.match(spaced, /kill you/i);
});

test('plain threat without format chars still triggers safety', () => {
  const text = 'I will kill you tonight if you leave after everything I have done for us.';
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});
