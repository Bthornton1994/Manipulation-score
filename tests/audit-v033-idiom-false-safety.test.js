import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

function pad(text) {
  return `${text} Please think carefully about what you are saying to me right now because this matters a lot for both of us.`;
}

function assertSafety(text, category = 'direct_violence') {
  const notice = detectSafetyNotice(pad(text));
  assert.ok(notice, `expected safety notice for: ${text}`);
  assert.equal(notice.category, category);
  const analysis = analyzeMessage(pad(text));
  assert.ok(analysis.safetyNotice, `expected analyzeMessage safety for: ${text}`);
  assert.equal(analysis.score, null);
  assert.equal(analysis.scoreSuppressed, true);
}

function assertNoSafety(text) {
  const notice = detectSafetyNotice(pad(text));
  assert.equal(notice, null, `unexpected safety for: ${text}`);
}

test('v0.3.3: bare menace idioms still trigger safety', () => {
  assertSafety('You better watch your back if you tell anyone about this tonight.');
  assertSafety('Watch your back when you leave the office tonight alone.');
  assertSafety('Watch your back because I am coming for you after work.');
  assertSafety("I'm coming for you tonight if you speak to anyone else.");
  assertSafety('I am coming for you.');
  assertSafety('You are dead when I see you near the office tomorrow.');
  assertSafety('You are dead when you get home tonight after work.');
});

test('v0.3.3: workplace and figurative idioms do not trigger safety', () => {
  assertNoSafety(
    'Watch your back when lifting heavy boxes at work tomorrow morning carefully.'
  );
  assertNoSafety(
    'Watch your back when carrying the couch upstairs so nobody strains a muscle.'
  );
  assertNoSafety(
    'I am coming for you after lunch so we can finish the report together today.'
  );
  assertNoSafety(
    'I am coming for you at 3pm for the meeting about the quarterly roadmap update.'
  );
  assertNoSafety(
    'You are dead when it comes to remembering birthdays, honestly, every single year.'
  );
  assertNoSafety(
    'You are dead when it comes to sports trivia night with the rest of the team.'
  );
});
