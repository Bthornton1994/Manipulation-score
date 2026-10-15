import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';

const PAD =
  ' After everything I have done for you, you should feel guilty for even thinking about leaving. Do not tell anyone about us.';

function midWordThreat(sep) {
  return `I will k${sep}ill you if you leave.${PAD}`;
}

const MID_WORD_SEPARATORS = [
  ['NUL U+0000', '\u0000'],
  ['BS U+0008', '\u0008'],
  ['DEL U+007F', '\u007F'],
  ['C1 U+0080', '\u0080'],
  ['C1 U+009F', '\u009F'],
  ['WJ U+2060', '\u2060'],
  ['invisible times U+2062', '\u2062'],
  ['LRM U+200E', '\u200E'],
  ['RLO U+202E', '\u202E'],
  ['CGJ U+034F', '\u034F'],
  ['TAG SPACE U+E0020', '\u{E0020}']
];

test('space-mode still splits mid-word Cc/Cf (strip mode is required)', () => {
  const spaced = normalizeAnalysisText('k\u0000ill you');
  assert.match(spaced, /k ill you/i);
  assert.doesNotMatch(spaced, /\bkill you\b/i);

  const stripped = normalizeAnalysisText('k\u0000ill you', { controlMode: 'strip' });
  assert.match(stripped, /\bkill you\b/i);
});

test('space-mode still keeps between-token Cc as whitespace', () => {
  const spaced = normalizeAnalysisText('kill\u0000you');
  assert.match(spaced, /\bkill you\b/i);
  const stripped = normalizeAnalysisText('kill\u0000you', { controlMode: 'strip' });
  assert.match(stripped, /killyou/i);
});

for (const [label, sep] of MID_WORD_SEPARATORS) {
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

test('between-token NUL still triggers safety after dual-path', () => {
  const text = `I will kill\u0000you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  const result = analyzeMessage(text);
  assert.equal(result.safetyNotice?.id, 'conditional_harm_language');
  assert.equal(result.level, null);
});

test('plain kill you threat still triggers safety', () => {
  const text = `I will kill you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});
