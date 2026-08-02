import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  { text: "I'm going to kill you.", category: 'direct_violence' },
  { text: 'I\u2019m going to kill you.', category: 'direct_violence' },
  { text: 'If you leave, I will hurt you.', category: 'direct_violence' },
  {
    text: 'I will kill myself if you leave me, and it will be entirely your fault.',
    category: 'self_harm_coercion'
  },
  {
    text: 'I know where you live, and I will come find you tonight if you refuse.',
    category: 'stalking'
  },
  {
    text: "I'm going to shoot you with this gun if you don't listen.",
    category: ['weapon_threat', 'direct_violence']
  },
  { text: "I won't let you leave until you apologize.", category: 'confinement' },
  {
    text: 'This is not safety training. I am going to kill you if you come near me again tonight.',
    category: 'direct_violence'
  },
  {
    text: 'I saw you in the news, and now I am going to kill you when I find you tonight.',
    category: 'direct_violence'
  },
  {
    text: 'The character said "I will kill you" in the movie. I am going to kill you when I see you tonight.',
    category: 'direct_violence'
  }
];

const MUST_NOT_CATCH = [
  'I would never hurt you, and I want you to feel safe when we talk about this.',
  'I do not want to hurt you, so let us stop this conversation and try again later.',
  'The doctor explained that this treatment should not harm you during recovery.',
  'In the news article, the character said violence is never acceptable in relationships.',
  'Our workplace training covered de-escalation when someone threatens suicide.',
  'This fictional scene shows how a villain threatens someone in a movie script.',
  'The news reported that the suspect said "I will kill you" in court yesterday.'
];

function assertSafetyResult(text, { category } = {}) {
  const notice = detectSafetyNotice(text);
  assert.ok(notice, `expected safety notice for: ${text}`);
  if (category) {
    const allowed = Array.isArray(category) ? category : [category];
    assert.ok(allowed.includes(notice.category), `expected ${allowed.join('|')}, got ${notice.category}`);
  }
  assert.ok(notice.evidenceSpan?.text);
  assert.ok(notice.evidenceSpan.end > notice.evidenceSpan.start);

  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice);
  assert.equal(result.score, null);
  assert.equal(result.scoreSuppressed, true);
  assert.equal(result.signals.length, 0);
  assert.equal(result.abstained, false);
}

test('round 3: must-catch safety fixtures with local context', () => {
  for (const fixture of MUST_CATCH) {
    assertSafetyResult(fixture.text, { category: fixture.category });
  }
});

test('round 3: negated reassurance and attributed quotes do not alarm', () => {
  for (const text of MUST_NOT_CATCH) {
    assert.equal(detectSafetyNotice(text), null, text);
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
  }
});

test('round 3: short direct violence beats word-count abstention', () => {
  const result = analyzeMessage("I'm going to kill you.");
  assert.ok(result.safetyNotice);
  assert.equal(result.abstained, false);
});

test('round 3: benign phrase in one sentence does not suppress threat in another', () => {
  const text =
    'This is not safety training. I am going to kill you if you come near me again tonight.';
  assert.equal(detectSafetyNotice(text)?.category, 'direct_violence');
});
