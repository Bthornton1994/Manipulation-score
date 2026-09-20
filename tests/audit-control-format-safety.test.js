import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';
import { detectSafetyNotice } from '../safety.js';

const PAD =
  ' After everything I have done for you, you should feel guilty for even thinking about leaving. Do not tell anyone about us. You need to answer me right now or it will be too late. You belong to me and nobody else will ever want you.';

function threatWithSeparator(sep) {
  return `I will kill${sep}you if you leave.${PAD}`;
}

const BETWEEN_TOKEN_SEPARATORS = [
  ['NUL U+0000', '\u0000'],
  ['BS U+0008', '\u0008'],
  ['NEL U+0085', '\u0085'],
  ['DEL U+007F', '\u007F'],
  ['C1 U+009F', '\u009F'],
  ['ALM U+061C', '\u061C'],
  ['MVS U+180E', '\u180E'],
  ['WJ U+2060', '\u2060'],
  ['invisible times U+2062', '\u2062'],
  ['inhibit swap U+206A', '\u206A'],
  ['LRM U+200E', '\u200E'],
  ['RLO U+202E', '\u202E'],
  ['LRI U+2066', '\u2066'],
  ['CGJ U+034F', '\u034F'],
  ['IAFS U+FFF9', '\uFFF9'],
  ['TAG SPACE U+E0020', '\u{E0020}'],
  ['musical begin U+1D173', '\u{1D173}']
];

test('Cc/Cf between-token separators space-map to keep kill you intact', () => {
  for (const [label, sep] of BETWEEN_TOKEN_SEPARATORS) {
    const normalized = normalizeAnalysisText(threatWithSeparator(sep));
    assert.match(normalized, /\bkill you\b/i, `${label} should become whitespace, not glue or stay intact`);
    assert.doesNotMatch(normalized, /killyou/i, `${label} must not glue tokens`);
  }
});

test('Cc/Cf between-token separators still trigger safety notices', () => {
  for (const [label, sep] of BETWEEN_TOKEN_SEPARATORS) {
    const text = threatWithSeparator(sep);
    assert.ok(detectSafetyNotice(text), `expected safety notice for ${label}`);
    const result = analyzeMessage(text);
    assert.equal(
      result.safetyNotice?.id,
      'conditional_harm_language',
      `analyzeMessage should surface safety for ${label}, not score pressure`
    );
    assert.equal(result.level, null, `${label} must not fall through to a pressure band`);
  }
});

test('paragraph newlines survive Cc mapping', () => {
  const text = 'First paragraph about ordinary plans for the weekend.\n\nSecond paragraph continues the same calm conversation without pressure.';
  const normalized = normalizeAnalysisText(text);
  assert.match(normalized, /\n\n/);
  assert.equal(normalized.includes('\u0000'), false);
});
