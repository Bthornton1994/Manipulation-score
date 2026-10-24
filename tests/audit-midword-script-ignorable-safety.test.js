import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';
import { repairMidwordScriptIgnorables } from '../text-normalize.js';

const PAD =
  ' After everything I have done for you, you should feel guilty for even thinking about leaving. Do not tell anyone about us.';

function midWordThreat(sep) {
  return `I will ki${sep}ll you if you leave.${PAD}`;
}

function betweenTokenThreat(sep) {
  return `I will kill${sep}you if you leave.${PAD}`;
}

const SCRIPT_IGNORABLES = [
  ['Khmer inherent AQ U+17B4', '\u17B4'],
  ['Khmer inherent AA U+17B5', '\u17B5'],
  ['Mongolian FVS1 U+180B', '\u180B'],
  ['Mongolian FVS2 U+180C', '\u180C'],
  ['Mongolian FVS3 U+180D', '\u180D'],
  ['Mongolian FVS4 U+180F', '\u180F']
];

test('default normalize space-maps between-token script ignorables', () => {
  for (const [label, sep] of SCRIPT_IGNORABLES) {
    const normalized = normalizeAnalysisText(`kill${sep}you`);
    assert.match(normalized, /\bkill you\b/i, `${label} should become whitespace`);
    assert.doesNotMatch(normalized, /killyou/i, `${label} must not glue tokens`);
  }
});

test('default normalize splits mid-word script ignorables (repair path required)', () => {
  for (const [, sep] of SCRIPT_IGNORABLES) {
    const normalized = normalizeAnalysisText(`ki${sep}ll you`);
    assert.doesNotMatch(normalized, /\bkill you\b/i);
    assert.match(repairMidwordScriptIgnorables(`ki${sep}ll you`), /\bkill you\b/i);
  }
});

for (const [label, sep] of SCRIPT_IGNORABLES) {
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

test('multi mid-word Khmer inherent insertions still trigger safety', () => {
  const text = `I will k\u17B4i\u17B4ll you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});

test('mid-word Mongolian FVS still triggers safety on hurt', () => {
  const text = `I will hu\u180Brt you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.equal(analyzeMessage(text).safetyNotice?.id, 'conditional_harm_language');
  assert.equal(analyzeMessage(text).level, null);
});

test('plain kill you threat still triggers safety', () => {
  const text = `I will kill you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});
