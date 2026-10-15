import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';
import { repairMidwordBlankIgnorables } from '../text-normalize.js';

const PAD =
  ' After everything I have done for you, you should feel guilty for even thinking about leaving. Do not tell anyone about us.';

function midWordThreat(sep) {
  return `I will ki${sep}ll you if you leave.${PAD}`;
}

function betweenTokenThreat(sep) {
  return `I will kill${sep}you if you leave.${PAD}`;
}

const BLANK_IGNORABLES = [
  ['Hangul choseong filler U+115F', '\u115F'],
  ['Hangul jungseong filler U+1160', '\u1160'],
  ['Hangul filler U+3164', '\u3164'],
  ['Halfwidth Hangul filler U+FFA0', '\uFFA0'],
  ['Braille blank U+2800', '\u2800'],
  ['Variation selector-1 U+FE00', '\uFE00'],
  ['Variation selector-16 U+FE0F', '\uFE0F']
];

test('default normalize space-maps between-token blank ignorables', () => {
  for (const [label, sep] of BLANK_IGNORABLES) {
    const normalized = normalizeAnalysisText(`kill${sep}you`);
    assert.match(normalized, /\bkill you\b/i, `${label} should become whitespace`);
    assert.doesNotMatch(normalized, /killyou/i, `${label} must not glue tokens`);
  }
});

test('default normalize splits mid-word blank ignorables (repair path required)', () => {
  for (const [, sep] of BLANK_IGNORABLES) {
    const normalized = normalizeAnalysisText(`ki${sep}ll you`);
    assert.doesNotMatch(normalized, /\bkill you\b/i);
    assert.match(repairMidwordBlankIgnorables(`ki${sep}ll you`), /\bkill you\b/i);
  }
});

for (const [label, sep] of BLANK_IGNORABLES) {
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

test('multi mid-word Hangul filler insertions still trigger safety', () => {
  const text = `I will k\u115Fi\u115Fll you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});

test('mid-word Braille blank still triggers safety on hurt', () => {
  const text = `I will hu\u2800rt you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.equal(analyzeMessage(text).safetyNotice?.id, 'conditional_harm_language');
  assert.equal(analyzeMessage(text).level, null);
});

test('plain kill you threat still triggers safety', () => {
  const text = `I will kill you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});
