import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectSafetyNotice } from '../safety.js';
import {
  analyzeMessage,
  normalizeAnalysisText,
  excerptForOffsets,
  METHODOLOGY_VERSION
} from '../scoring.js';

test('v0.3.1 methodology version', () => {
  assert.equal(METHODOLOGY_VERSION, '0.3.3');
});

test('clear handler does not reset history opt-in via form.reset', async () => {
  const app = await readFile('app.js', 'utf8');
  assert.doesNotMatch(app, /clearButton\.addEventListener[\s\S]*?form\.reset\(\)/);
  assert.match(app, /historyWasOptedIn/);
});

test('smart apostrophe pairs preserve scoring band for guilt pressure', () => {
  const straight =
    "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you.";
  const smart =
    'If you really cared about me, you’d answer right now. Don’t tell anyone—I’m the only one who understands you.';
  const straightResult = analyzeMessage(straight);
  const smartResult = analyzeMessage(smart);
  assert.equal(smartResult.level, straightResult.level);
  assert.ok(smartResult.score >= 31);
});

test('internal whitespace does not erase threat match', () => {
  const regular =
    "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you.";
  const spaced =
    'If you really cared about me, you’d answer right now. Don’t tell anyone—I’m the only one who understands you.';
  const regularResult = analyzeMessage(regular);
  const spacedResult = analyzeMessage(spaced.replace(/ /g, '  '));
  assert.equal(spacedResult.level, regularResult.level);
  assert.ok(spacedResult.score >= 31);
});

test('direct threat after comma-and is not suppressed by he said', () => {
  const text =
    'He said hello, and I will kill you tonight if you return to this house.';
  const notice = detectSafetyNotice(text);
  assert.ok(notice, 'expected safety notice for first-person threat after attribution');
});

test('negated benign safety context does not suppress direct threat', () => {
  const text =
    'This is not a safety instruction, and I will stab you if you come near me.';
  const notice = detectSafetyNotice(text);
  assert.ok(notice, 'expected safety notice when benign phrase is negated');
});

test('movie context does not suppress first-person threat after and', () => {
  const text =
    'We are not in the movie, and I will kill you tonight when you return home.';
  const notice = detectSafetyNotice(text);
  assert.ok(notice);
});

test('thread with all abstaining segments does not return numeric High overall', () => {
  const thread = [
    'You owe me twenty dollars for lunch.',
    'I will leave the office at six.',
    'Fine, forget it, I found the missing receipt.'
  ].join('\n\n');
  const result = analyzeMessage(thread);
  assert.ok(result.abstained || result.scoreSuppressed || result.score == null);
  assert.notEqual(result.level, 'High');
  assert.ok(result.segments?.length === 3);
  result.segments.forEach((segment) => {
    assert.ok(segment.analysis.abstained || segment.analysis.scoreSuppressed);
  });
});

test('truncated excerpt highlights exact matched phrase', () => {
  const padding = 36;
  const prefix = 'x'.repeat(50);
  const text = `${prefix}You owe me twenty dollars for the concert ticket.`;
  const offsets = [{ start: prefix.length, end: prefix.length + 11, text: 'You owe me', id: 'guilt', label: 'Guilt' }];
  const { excerpt, ranges } = excerptForOffsets(text, offsets, padding);
  const highlight = excerpt.slice(ranges[0].start, ranges[0].end);
  assert.equal(highlight.trim(), 'You owe me');
});

test('normalizeAnalysisText collapses smart punctuation and whitespace', () => {
  assert.equal(normalizeAnalysisText('You’ll   regret'), "You'll regret");
});

test('will your does not produce false kill-you safety evidence span', () => {
  const text = 'This puzzle will kill your boredom if you keep staring at the screen.';
  const notice = detectSafetyNotice(text);
  if (notice?.evidenceSpan) {
    assert.doesNotMatch(notice.evidenceSpan.text, /\byou\b$/);
    assert.match(notice.evidenceSpan.text, /your/i);
  }
});
