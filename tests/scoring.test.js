import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMessage,
  buildResponses,
  getHighlightRanges,
  getScoreBand,
  getSignalSeverity,
  splitMessages,
  SIGNALS
} from '../scoring.js';

const LEVERAGE_EXAMPLE =
  "Fine, forget it. I guess I know where I stand. Don't bother reaching out if you can't make time for me.";

const URGENCY_EXAMPLE =
  'I need an answer immediately. This is your last chance before it is too late to fix this.';

const EVIDENCE_PAD =
  ' I am sharing this message for context and would like your perspective when you have time to read it fully.';

function withEvidence(text) {
  return `${text}${EVIDENCE_PAD}`;
}

test('returns abstention for whitespace-only input', () => {
  const result = analyzeMessage('   ');
  assert.equal(result.abstained, true);
  assert.equal(result.score, null);
  assert.equal(result.level, 'No message');
  assert.deepEqual(result.signals, []);
});

test('detects multiple pressure patterns', () => {
  const result = analyzeMessage(
    withEvidence("If you really cared, you'd answer right now or else you'll regret it.")
  );
  assert.equal(result.level, 'High');
  assert.deepEqual(
    [...result.signals.map(({ id }) => id)].sort(),
    ['guilt', 'threat', 'urgency']
  );
  assert.ok(result.score >= 61);
  assert.ok(result.highlights.length >= 3);
});

test('keeps neutral language in the low band', () => {
  const result = analyzeMessage(
    withEvidence('Could we talk tomorrow when we both have time?')
  );
  assert.equal(result.score, 0);
  assert.equal(result.level, 'Low');
  assert.equal(result.signals.length, 0);
});

test('maps score bands to low moderate high thresholds', () => {
  assert.equal(getScoreBand(12).label, 'Low');
  assert.equal(getScoreBand(45).label, 'Moderate');
  assert.equal(getScoreBand(72).label, 'High');
});

test('deduplicates repeated matched phrases in signal metadata', () => {
  const result = analyzeMessage(withEvidence('You always do this. Always, always.'));
  assert.deepEqual(result.signals[0].matches, ['always']);
  assert.equal(result.signals[0].offsets.length, 3);
  assert.equal(result.level, 'Low');
});

test('buildResponses returns pause, boundary, and clarify styles', () => {
  const result = analyzeMessage(withEvidence("If you really cared you'd answer right now."));
  assert.ok(result.responses.pause.includes('time'));
  assert.ok(result.responses.boundary.length > 10);
  assert.ok(result.responses.clarify.length > 10);
});

test('each signal includes severity and per-pattern responses', () => {
  const result = analyzeMessage(withEvidence('If you really cared, answer right now.'));
  assert.ok(result.signals[0].severity.label);
  assert.ok(result.signals[0].responses.pause);
  assert.ok(result.signals[0].responses.boundary);
  assert.ok(result.signals[0].excerpt.excerpt);
});

test('splits multi-message threads on blank lines', () => {
  const parts = splitMessages('First message.\n\nSecond message.');
  assert.equal(parts.length, 2);
  const longFirst =
    'First message with enough words to screen patterns when analyzed alone on its own merit today.';
  const longSecond =
    'Second message with enough words to screen patterns when analyzed alone on its own merit today.';
  const result = analyzeMessage(`${longFirst}\n\n${longSecond}`);
  assert.equal(result.segments?.length, 2);
});

test('scores classic withdrawal leverage appropriately', () => {
  const result = analyzeMessage(LEVERAGE_EXAMPLE);
  assert.ok(result.score >= 58);
  assert.ok(result.signals.some((s) => s.id === 'implied_rejection'));
  assert.ok(result.signals.some((s) => s.id === 'conditional_access'));
  assert.ok(result.leverageInsights.some((i) => i.id === 'withdrawal_leverage'));
});

test('single clear guilt framing lands in mid-moderate', () => {
  const result = analyzeMessage(withEvidence("If you really cared about me, you'd answer."));
  assert.equal(result.level, 'Moderate');
  assert.ok(result.score >= 46);
  assert.ok(result.score <= 60);
});

test('single clear isolation lands in mid-moderate', () => {
  const result = analyzeMessage(
    withEvidence("Don't tell anyone—I'm the only one who understands you.")
  );
  assert.equal(result.level, 'Moderate');
  assert.ok(result.score >= 46);
});

test('signals explain language function not just pattern labels', () => {
  const result = analyzeMessage(LEVERAGE_EXAMPLE);
  for (const signal of result.signals) {
    assert.ok(signal.function);
    assert.ok(signal.function.length > 30);
  }
});

test('includes expanded signal catalog', () => {
  assert.ok(SIGNALS.length >= 12);
});

test('scores classic forced urgency in mid-moderate range', () => {
  const result = analyzeMessage(URGENCY_EXAMPLE);
  assert.equal(result.level, 'Moderate');
  assert.ok(result.score >= 46);
  assert.ok(result.score <= 60);
  assert.equal(result.signals[0].id, 'urgency');
  assert.equal(result.signals[0].severity.level, 'strong');
});

test('overall score aligns with clear severity labels', () => {
  const result = analyzeMessage(URGENCY_EXAMPLE);
  const hasClear = result.signals.some((s) => s.severity.level === 'strong');
  if (hasClear) assert.ok(result.score >= 46);
});

test('highlight ranges cover matched phrases', () => {
  const result = analyzeMessage(LEVERAGE_EXAMPLE);
  const ranges = getHighlightRanges(result.signals);
  assert.ok(ranges.length >= 3);
});

test('bands include assessment headlines', () => {
  const result = analyzeMessage(URGENCY_EXAMPLE);
  assert.match(result.bandHeadline, /Moderate pressure/);
});

test('intensity tags use Mild Clear and Strong labels', () => {
  assert.equal(getSignalSeverity({ weight: 18, points: 19 }).label, 'Mild');
  assert.equal(getSignalSeverity({ weight: 18, points: 22 }).label, 'Clear');
  assert.equal(getSignalSeverity({ weight: 18, points: 30 }).label, 'Strong');
});

test('benign exclusion phrases in a prior clause do not suppress coercive signals after but', () => {
  const text =
    'There is no pressure to decide right now, but you need to answer immediately or I will be very upset with you today please.';
  const result = analyzeMessage(text);
  assert.equal(result.abstained, false);
  assert.ok(result.score >= 31, `expected Moderate+ score, got ${result.score}`);
  assert.ok(
    result.signals.some((signal) => signal.id === 'urgency'),
    'expected urgency signal after benign no-pressure clause'
  );
});

test('supportive take-your-time clause does not suppress later assigned obligation', () => {
  const text =
    'Take whatever time you need to think about it, but you need to answer me tonight or I will be upset with you forever please decide.';
  const result = analyzeMessage(text);
  assert.equal(result.abstained, false);
  assert.ok(
    result.signals.some((signal) => signal.id === 'obligation'),
    'expected obligation in the coercive clause after supportive take-time framing'
  );
  assert.ok(result.score > 0, `expected non-zero score, got ${result.score}`);
});

test('same-clause supportive obligation framing still excludes', () => {
  const text =
    'Please take whatever time you need to think about what you want before we talk again this week about plans.';
  const result = analyzeMessage(text);
  assert.equal(
    result.signals.some((signal) => signal.id === 'obligation'),
    false,
    'supportive take-time wording in the same clause should stay excluded'
  );
});
