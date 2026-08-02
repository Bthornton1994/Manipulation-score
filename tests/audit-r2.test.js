import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const SAFETY_FIXTURES = [
  "I'm going to kill you.",
  'If you leave, I will hurt you.',
  'I will kill myself if you leave me, and it will be entirely your fault.',
  'I know where you live, and I will come find you tonight if you refuse.',
  "I'm going to shoot you with this gun if you don't listen.",
  "I won't let you leave until you apologize."
];

const SAFETY_BENIGN = [
  'Our workplace training covered de-escalation when someone threatens suicide.',
  'In the news article, the character said violence is never acceptable.',
  'This fictional scene shows how a villain threatens someone in a movie script.'
];

test('round 2: every explicit safety fixture triggers before word-count abstention', () => {
  for (const text of SAFETY_FIXTURES) {
    assert.ok(detectSafetyNotice(text), `expected safety notice for: ${text}`);
    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice, `expected safety result for: ${text}`);
    assert.equal(result.score, null);
    assert.equal(result.scoreSuppressed, true);
    assert.equal(result.signals.length, 0);
  }
});

test('round 2: short direct violence is not blocked by word-count abstention', () => {
  const result = analyzeMessage("I'm going to kill you.");
  assert.ok(result.safetyNotice);
  assert.equal(result.abstained, false);
});

test('round 2: benign safety-training and fiction contexts do not alarm', () => {
  for (const text of SAFETY_BENIGN) {
    assert.equal(detectSafetyNotice(text), null, text);
  }
});

test('round 2: extended benign fixtures from first audit still pass', () => {
  const fixtures = [
    'You always have choices. Nothing needs to be decided right now. Take all the time you need and ask anyone you trust.',
    'You need to submit the tax form by the legal deadline. If you have questions, ask an accountant before you send it.',
    'Everyone is invited, and nobody is required to participate. Please choose what feels right for you, and there is no pressure.'
  ];
  for (const text of fixtures) {
    const result = analyzeMessage(text);
    assert.equal(result.signals.length, 0);
    assert.equal(result.safetyNotice, null);
    if (!result.abstained) {
      assert.equal(result.level, 'Low');
      assert.equal(result.score, 0);
    }
  }
});
