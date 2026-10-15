import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage, normalizeAnalysisText } from '../scoring.js';
import { repairMidwordReservedDiCn } from '../text-normalize.js';

const PAD =
  ' After everything I have done for you, you should feel guilty for even thinking about leaving. Do not tell anyone about us.';

function midWordThreat(sep) {
  return `I will ki${sep}ll you if you leave.${PAD}`;
}

function betweenTokenThreat(sep) {
  return `I will kill${sep}you if you leave.${PAD}`;
}

const RESERVED_DI_CN = [
  ['reserved Cf-gap U+2065', '\u2065'],
  ['reserved U+FFF0', '\uFFF0'],
  ['reserved U+FFF8', '\uFFF8'],
  ['tag-plane reserved U+E0000', '\u{E0000}'],
  ['tag-plane reserved U+E0002', '\u{E0002}'],
  ['tag-plane reserved U+E001F', '\u{E001F}'],
  ['tag-plane reserved U+E0080', '\u{E0080}'],
  ['tag-plane reserved U+E00FF', '\u{E00FF}'],
  ['post-VS-supplement reserved U+E01F0', '\u{E01F0}'],
  ['tag-plane reserved U+E0FFF', '\u{E0FFF}']
];

test('default normalize space-maps between-token reserved DI Cn', () => {
  for (const [label, sep] of RESERVED_DI_CN) {
    const normalized = normalizeAnalysisText(`kill${sep}you`);
    assert.match(normalized, /\bkill you\b/i, `${label} should become whitespace`);
    assert.doesNotMatch(normalized, /killyou/i, `${label} must not glue tokens`);
  }
});

test('default normalize splits mid-word reserved DI Cn (repair path required)', () => {
  for (const [, sep] of RESERVED_DI_CN) {
    const normalized = normalizeAnalysisText(`ki${sep}ll you`);
    assert.doesNotMatch(normalized, /\bkill you\b/i);
    assert.match(repairMidwordReservedDiCn(`ki${sep}ll you`), /\bkill you\b/i);
  }
});

for (const [label, sep] of RESERVED_DI_CN) {
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

test('multi mid-word reserved DI Cn insertions still trigger safety', () => {
  const text = `I will k\u2065i\uFFF0ll you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});

test('mid-word reserved DI Cn still triggers safety on hurt', () => {
  const text = `I will hu\u{E0FFF}rt you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.equal(analyzeMessage(text).safetyNotice?.id, 'conditional_harm_language');
  assert.equal(analyzeMessage(text).level, null);
});

test('plain kill you threat still triggers safety', () => {
  const text = `I will kill you if you leave.${PAD}`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});
