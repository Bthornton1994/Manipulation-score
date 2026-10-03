import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const THREATS = [
  "I'm gonna choke you if you walk out that door tonight after everything we discussed.",
  "I will put a bullet in you if you ever tell anyone what happened at the warehouse.",
  "I will drive into you the next time I see you walking down that street alone."
];

for (const text of THREATS) {
  test(`safety notice for: ${text.slice(0, 40)}…`, () => {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, 'expected safety notice');
    const analysis = analyzeMessage(text);
    assert.ok(analysis.safetyNotice, 'expected analyzeMessage safety gate');
    assert.equal(analysis.scoreSuppressed, true);
  });
}

test('negated gonna choke reassurance does not trigger safety', () => {
  const text = 'I am not gonna choke you ever and I do not want to hurt you at all.';
  assert.equal(detectSafetyNotice(text), null);
});
