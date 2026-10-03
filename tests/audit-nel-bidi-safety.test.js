import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';

const PAD =
  ' after everything I have done for us tonight and before you walk away.';

const BETWEEN_WORD_SEPARATORS = [
  { label: 'next line U+0085', char: '\u0085' },
  { label: 'left-to-right mark U+200E', char: '\u200E' },
  { label: 'right-to-left mark U+200F', char: '\u200F' },
  { label: 'left-to-right embedding U+202A', char: '\u202A' },
  { label: 'right-to-left embedding U+202B', char: '\u202B' },
  { label: 'pop directional formatting U+202C', char: '\u202C' },
  { label: 'left-to-right override U+202D', char: '\u202D' },
  { label: 'right-to-left override U+202E', char: '\u202E' },
  { label: 'left-to-right isolate U+2066', char: '\u2066' },
  { label: 'right-to-left isolate U+2067', char: '\u2067' },
  { label: 'first strong isolate U+2068', char: '\u2068' },
  { label: 'pop directional isolate U+2069', char: '\u2069' }
];

for (const { label, char } of BETWEEN_WORD_SEPARATORS) {
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

test('NEL space-mapping does not break ordinary whitespace collapse', () => {
  const text = normalizeAnalysisText('kill\u0085\u0085you');
  assert.equal(text, 'kill you');
});
