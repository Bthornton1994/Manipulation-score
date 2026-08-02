import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const ATTRIBUTED_STALKING_MUST_NOT = [
  'During safety training, the instructor used "I will follow you home and watch you through the window" as an example of stalking language.',
  'In the novel, the villain said, "I will follow you home and watch you through the window," before the hero escaped.',
  'The news reported that a suspect said he would follow her home and watch through the window during the incident.',
  'During training, the facilitator described following someone home, waiting outside their office, and watching through a window as stalking behaviors.'
];

const MIXED_ATTRIBUTION_MUST_CATCH = [
  'During safety training, the instructor used "I will follow you home" as an example. But I really will follow you home tonight.',
  'In the novel, the villain said he would watch through the window. I am going to follow you home tonight whether you want me to or not.'
];

function assertNoSafety(text) {
  assert.equal(detectSafetyNotice(text), null, text);
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice, text);
}

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), `expected safety for: ${text}`);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice);
  assert.equal(result.score, null);
  assert.equal(result.signals.length, 0);
}

test('round 7: attributed stalking quotations with multiple behaviors do not alarm', () => {
  for (const text of ATTRIBUTED_STALKING_MUST_NOT) {
    assertNoSafety(text);
  }
});

test('round 7: real threat after attributed stalking example still triggers safety', () => {
  for (const text of MIXED_ATTRIBUTION_MUST_CATCH) {
    assertSafety(text);
  }
});

test('round 7: round 6 coercive arrival regression still passes', () => {
  assertSafety(
    'I am coming to your house tonight whether you want me there or not. You cannot stop me.'
  );
});

test('round 7: round 6 benign invitation regression still passes', () => {
  assertNoSafety(
    'I am going to your house for the dinner you invited me to, and I will arrive around seven.'
  );
});
