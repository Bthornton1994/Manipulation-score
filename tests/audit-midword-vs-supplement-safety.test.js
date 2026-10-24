import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';
import { repairMidwordVsSupplement } from '../text-normalize.js';

const PAD =
  ' After everything I have done for you, you should feel guilty for even thinking about leaving. Do not tell anyone about us.';

function midWordThreat(sep) {
  return `I will ki${sep}ll you if you leave.${PAD}`;
}

function betweenTokenThreat(sep) {
  return `I will kill${sep}you if you leave.${PAD}`;
}

const VS_SUPPLEMENT = [
  ['Variation selector-17 U+E0100', '\u{E0100}'],
  ['Variation selector-18 U+E0101', '\u{E0101}'],
  ['Variation selector-144 U+E017F', '\u{E017F}'],
  ['Variation selector-256 U+E01EF', '\u{E01EF}']
];

test('default normalize space-maps between-token VS Supplement', () => {
  for (const [label, sep] of VS_SUPPLEMENT) {
    const normalized = normalizeAnalysisText(`kill${sep}you`);
    assert.match(normalized, /\bkill you\b/i, `${label} should become whitespace`);
    assert.doesNotMatch(normalized, /killyou/i, `${label} must not glue tokens`);
  }
});

test('default normalize splits mid-word VS Supplement (repair path required)', () => {
  for (const [, sep] of VS_SUPPLEMENT) {
    const normalized = normalizeAnalysisText(`ki${sep}ll you`);
    assert.doesNotMatch(normalized, /\bkill you\b/i);
    assert.match(repairMidwordVsSupplement(`ki${sep}ll you`), /\bkill you\b/i);
  }
});

for (const [label, sep] of VS_SUPPLEMENT) {
  test(`between-token ${label} still triggers safety on kill`, () => {
    const text = betweenTokenThreat(sep);
    assert.ok(detectSafetyNotice(text), `expected detectSafetyNotice for ${label}`);
    const result = analyzeMessage(text);
    assert.equal(
      result.safetyNotice?.id,
      'conditional_harm_language',
      `analyzeMessage should surface safety for ${label}, not score pressure`
    );
    assert.equal(result.level, null, `${label} must not fall through to a pressure band`);
  });

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

test('multi mid-word VS Supplement insertions still trigger safety', () => {
  const text = `I will k\u{E0100}i\u{E0100}ll you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});

test('mid-word VS Supplement still triggers safety on hurt', () => {
  const text = `I will hu\u{E01EF}rt you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.equal(analyzeMessage(text).safetyNotice?.id, 'conditional_harm_language');
  assert.equal(analyzeMessage(text).level, null);
});

test('plain kill you threat still triggers safety', () => {
  const text = `I will kill you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});
