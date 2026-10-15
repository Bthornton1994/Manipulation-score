import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';

const PAD =
  ' after everything I have done for us tonight and before you walk away.';

const BETWEEN_WORD_JOINERS = [
  { label: 'word joiner U+2060', char: '\u2060' },
  { label: 'function application U+2061', char: '\u2061' },
  { label: 'invisible times U+2062', char: '\u2062' },
  { label: 'invisible separator U+2063', char: '\u2063' },
  { label: 'invisible plus U+2064', char: '\u2064' },
  { label: 'combining grapheme joiner U+034F', char: '\u034F' }
];

for (const { label, char } of BETWEEN_WORD_JOINERS) {
  test(`between-word ${label} still triggers safety on kill+you`, () => {
    const text = `I will kill${char}you if you leave${PAD}`;
    const normalized = normalizeAnalysisText(text);
    assert.match(normalized, /\bkill\s+you\b/i, `expected space-mapped tokens for ${label}`);
    assert.ok(detectSafetyNotice(text), `expected detectSafetyNotice for ${label}`);
    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, `expected analyzeMessage safety notice for ${label}`);
    assert.equal(result.level, null);
    assert.equal(result.abstained, false);
  });
}

test('plain kill you threat still triggers safety', () => {
  const text = `I will kill you if you leave${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});

test('space-mapping joiners does not glue mid-word soft-hyphen repair', () => {
  // Soft hyphen remains strip-mode (existing behavior); joiners become spaces.
  const soft = normalizeAnalysisText('k\u00ADill');
  assert.equal(soft, 'kill');
  const joiner = normalizeAnalysisText('kill\u2060you');
  assert.equal(joiner, 'kill you');
});
