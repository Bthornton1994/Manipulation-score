import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage, SIGNALS } from '../scoring.js';

const EVIDENCE_PAD =
  ' I am sharing this message for context and would like your perspective when you have time to read it fully.';

function withEvidence(text) {
  return `${text}${EVIDENCE_PAD}`;
}

test('workplace logistics with bare if-you-dont / leave / or-else is not High threat', () => {
  const text =
    "If you don't mind answering right now I will leave the packet on your desk or else wait until Monday after everything is sorted for the team.";
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice);
  assert.ok(!result.signals.some((s) => s.id === 'threat'), 'should not match conditional threat');
  assert.notEqual(result.level, 'High');
  assert.ok(result.score == null || result.score <= 60);
});

test('meeting logistics or-else someone-else is not conditional threat', () => {
  const text =
    "You should always answer right now if you don't want to miss the meeting or else someone else will take notes for you.";
  const result = analyzeMessage(text);
  assert.ok(!result.signals.some((s) => s.id === 'threat'));
  assert.notEqual(result.level, 'High');
});

test('responsibility-shift if-you-dont-have-time is not inflated to High by bare threat', () => {
  const text = "If you don't have time for me you obviously don't care. Too busy for me again.";
  const result = analyzeMessage(text);
  assert.ok(result.signals.some((s) => s.id === 'responsibility_shift'));
  assert.ok(!result.signals.some((s) => s.id === 'threat'));
  assert.notEqual(result.level, 'High');
});

test('or else followed by I will leave the keys does not count as threat', () => {
  const text = withEvidence(
    "Please reply right now or else I'll leave the keys with reception after the meeting."
  );
  const result = analyzeMessage(text);
  assert.ok(!result.signals.some((s) => s.id === 'threat'));
});

test('real coercive threat patterns still fire', () => {
  const cases = [
    withEvidence("If you don't do this I will leave and never speak to you. You will regret it."),
    withEvidence("Answer right now or else you will be sorry."),
    withEvidence("If you don't, you'll regret it. Never speak to you. Last chance."),
    withEvidence("This is your last chance. Answer now. If you don't I will leave.")
  ];
  for (const text of cases) {
    const result = analyzeMessage(text);
    assert.ok(
      result.signals.some((s) => s.id === 'threat'),
      `expected threat for: ${text.slice(0, 48)}`
    );
  }
});

test('threat pattern no longer matches bare if-you-dont alone', () => {
  const threat = SIGNALS.find((s) => s.id === 'threat');
  const re = new RegExp(threat.pattern.source, threat.pattern.flags);
  assert.equal([...("If you don't mind answering").matchAll(re)].length, 0);
  assert.equal([...("If you don't have time").matchAll(re)].length, 0);
  assert.ok([...("If you don't do this").matchAll(re)].length >= 1);
  assert.ok([...("If you don't I will leave").matchAll(re)].length >= 1);
});
