import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';
import { repairMidwordLineBreaks } from '../text-normalize.js';

const PAD =
  ' After everything I have done for you, you should feel guilty for even thinking about leaving. Do not tell anyone about us.';

function midWordThreat(sep) {
  return `I will ki${sep}ll you if you leave.${PAD}`;
}

const MID_WORD_LINE_SEPS = [
  ['LINE SEPARATOR U+2028', '\u2028'],
  ['PARAGRAPH SEPARATOR U+2029', '\u2029'],
  ['CR', '\r'],
  ['LF', '\n']
];

test('default normalize preserves mid-word LS/PS/CR/LF (repair path required)', () => {
  for (const [, sep] of MID_WORD_LINE_SEPS) {
    const normalized = normalizeAnalysisText(`ki${sep}ll you`);
    assert.doesNotMatch(normalized, /\bkill you\b/i);
    assert.match(repairMidwordLineBreaks(normalized), /\bkill you\b/i);
  }
});

test('between-token LS/CR still match before mid-word repair', () => {
  for (const sep of ['\u2028', '\u2029', '\r', '\n']) {
    const normalized = normalizeAnalysisText(`kill${sep}you`);
    assert.match(normalized, /\bkill\s+you\b/i);
    assert.ok(detectSafetyNotice(`I will kill${sep}you if you leave.${PAD}`));
  }
});

for (const [label, sep] of MID_WORD_LINE_SEPS) {
  test(`mid-word ${label} still triggers safety on kill`, () => {
    const text = midWordThreat(sep);
    assert.ok(detectSafetyNotice(text), `expected detectSafetyNotice for ${label}`);
    const result = analyzeMessage(text);
    assert.equal(
      result.safetyNotice?.id,
      'conditional_harm_language',
      `analyzeMessage should surface safety for ${label}, not score pressure`
    );
    assert.equal(result.level, null, `${label} must not fall through to a pressure band`);
  });
}

test('multi mid-word LS insertions still trigger safety', () => {
  const text = `I will k\u2028i\u2028ll you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});

test('plain kill you threat still triggers safety', () => {
  const text = `I will kill you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});
