import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';
import { normalizeAnalysisText } from '../text-normalize.js';

const HOMOGLYPH_THREATS = [
  {
    label: 'cyrillic u in you',
    text: 'I will kill yo\u0443 tonight when you get home from work and nobody can help.'
  },
  {
    label: 'cyrillic o and u in you',
    text: 'I will kill y\u043Eu tonight when you get home from work and nobody can help.'
  },
  {
    label: 'cyrillic k in kill',
    text: 'I will \u043Aill you tonight when you get home from work and nobody can help.'
  },
  {
    label: 'combining acute in kill',
    text: 'I will k\u0069\u0301ll you tonight when you get home from work and nobody can help.'
  }
];

test('normalizeAnalysisText maps Latin confusables and strips combining marks', () => {
  assert.equal(
    normalizeAnalysisText('I will kill yo\u0443 tonight'),
    'I will kill you tonight'
  );
  assert.equal(
    normalizeAnalysisText('I will k\u0069\u0301ll you tonight'),
    'I will kill you tonight'
  );
});

for (const { label, text } of HOMOGLYPH_THREATS) {
  test(`homoglyph safety catch: ${label}`, () => {
    assert.ok(detectSafetyNotice(text), `expected safety notice for ${label}`);
    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, `expected analysis safety notice for ${label}`);
    assert.equal(result.level, null);
  });
}
