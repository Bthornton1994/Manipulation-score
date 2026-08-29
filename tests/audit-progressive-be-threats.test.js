import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const ENOUGH =
  'after everything I have done for you this year together and all the support I gave';

test('progressive I will be killing you triggers safety, not High score', () => {
  const text = `I will be killing you tonight if you leave me ${ENOUGH}.`;
  const notice = detectSafetyNotice(text);
  assert.ok(notice, 'expected safety notice for progressive killing threat');
  assert.equal(notice.category, 'direct_violence');
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice, 'analyzeMessage must surface safety notice');
  assert.equal(result.score, null);
  assert.ok(result.scoreSuppressed);
});

test('progressive I will be hurting/shooting you triggers safety', () => {
  for (const verb of ['hurting', 'shooting', 'stabbing', 'murdering']) {
    const text = `I will be ${verb} you tonight if you leave me ${ENOUGH}.`;
    assert.ok(detectSafetyNotice(text), `expected safety for be ${verb} you`);
  }
});

test("progressive I'm going to be killing you triggers safety", () => {
  const text = `I'm going to be killing you tonight if you leave me ${ENOUGH}.`;
  assert.ok(detectSafetyNotice(text));
  assert.ok(analyzeMessage(text).safetyNotice);
});

test('progressive I will be beating/choking you triggers safety', () => {
  assert.ok(
    detectSafetyNotice(`I will be beating you tonight if you leave me ${ENOUGH}.`)
  );
  assert.ok(
    detectSafetyNotice(`I'll be choking you tonight if you leave me ${ENOUGH}.`)
  );
});

test('progressive self-harm coercion triggers safety, not High score', () => {
  const cases = [
    `I will be killing myself if you leave me ${ENOUGH}.`,
    `I'll be hurting myself if you leave me ${ENOUGH}.`,
    `I'm going to be killing myself if you walk away ${ENOUGH}.`
  ];
  for (const text of cases) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety for: ${text.slice(0, 40)}`);
    assert.equal(notice.category, 'self_harm_coercion');
    const result = analyzeMessage(text);
    assert.ok(result.safetyNotice);
    assert.equal(result.score, null);
  }
});

test('simple non-progressive I will kill you still triggers safety', () => {
  const text = `I will kill you tonight if you leave me ${ENOUGH}.`;
  assert.ok(detectSafetyNotice(text));
});

test('benign figurative killing does not trigger progressive violence rule alone', () => {
  const text =
    'This deadline will kill me figuratively after everything I scheduled for the release week ahead of us.';
  assert.equal(detectSafetyNotice(text), null);
});
