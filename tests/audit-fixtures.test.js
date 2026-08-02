import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage, countMeaningfulWords } from '../scoring.js';
import { detectSafetyNotice } from '../safety.js';

const GUILT_URGENCY_EXAMPLE =
  "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you.";

test('audit: built-in guilt urgency isolation example scores high', () => {
  const result = analyzeMessage(GUILT_URGENCY_EXAMPLE);
  assert.equal(result.level, 'High');
  assert.ok(result.score >= 61);
  assert.ok(result.signals.some((s) => s.id === 'guilt'));
  assert.ok(result.signals.some((s) => s.id === 'urgency'));
  assert.ok(result.signals.some((s) => s.id === 'isolation'));
});

test('audit: benign deadline messages stay low without false signals', () => {
  const messages = [
    'Can you please send the report by Friday? If that timeline does not work, let me know.',
    'I care about you and understand that you need time. There is no pressure to answer today.',
    'I need your answer today because registration closes at 5 PM. If you are not ready, we can skip it.'
  ];
  for (const text of messages) {
    const result = analyzeMessage(text);
    assert.equal(result.level, 'Low');
    assert.equal(result.score, 0);
    assert.equal(result.signals.length, 0);
  }
});

test('audit: Okay abstains without numeric score', () => {
  const result = analyzeMessage('Okay.');
  assert.equal(result.abstained, true);
  assert.equal(result.scoreSuppressed, true);
  assert.equal(result.score, null);
  assert.equal(result.level, null);
  assert.match(result.bandHeadline, /Not enough text/i);
});

test('audit: reassuring choices message has no manipulation findings', () => {
  const result = analyzeMessage('You always have choices. Nothing needs to be decided right now.');
  assert.equal(result.signals.length, 0);
  if (!result.abstained) {
    assert.equal(result.level, 'Low');
    assert.equal(result.score, 0);
  }
});

test('audit: legal tax deadline has no assigned-obligation finding', () => {
  const result = analyzeMessage('You need to submit the tax form by the legal deadline.');
  assert.equal(result.signals.length, 0);
  if (!result.abstained) {
    assert.equal(result.level, 'Low');
  }
});

test('audit: inclusive absolutes message has no misleading absolutes finding', () => {
  const result = analyzeMessage('Everyone is invited, and nobody is required to participate.');
  assert.equal(result.signals.length, 0);
  if (!result.abstained) {
    assert.equal(result.level, 'Low');
  }
});

test('audit: do not tell anyone matches isolation like don\'t tell anyone', () => {
  const pad = ' I am sharing this message for context and would like your perspective when you have time to read it fully.';
  const paraphrase = analyzeMessage(`Please do not tell anyone about this conversation.${pad}`);
  const canonical = analyzeMessage(`Don't tell anyone about this conversation.${pad}`);
  assert.ok(paraphrase.signals.some((s) => s.id === 'isolation'));
  assert.ok(canonical.signals.some((s) => s.id === 'isolation'));
});

test('audit: abstention requires fifteen meaningful words', () => {
  const short = 'Hello there friend.';
  assert.ok(countMeaningfulWords(short) < 15);
  const abstained = analyzeMessage(short);
  assert.equal(abstained.abstained, true);

  const long =
    'Can we talk tomorrow when we both have time to think about this and decide what feels right for everyone involved in the conversation.';
  assert.ok(countMeaningfulWords(long) >= 15);
  const screened = analyzeMessage(long);
  assert.equal(screened.abstained, false);
});
