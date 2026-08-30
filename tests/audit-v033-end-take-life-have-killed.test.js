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

test('v0.3.3: end/take your life first-person threats trigger safety', () => {
  assertSafety("I'll end your life if you leave me alone tonight forever now");
  assertSafety('I will take your life if you leave me alone tonight forever now');
  assertSafety("I'm going to end your life if you leave me alone tonight forever");
  assertSafety('I am going to take your life if you walk away from me tonight');
  assertSafety("I'm gonna end your life if you leave me alone tonight forever now");
});

test('v0.3.3: have you killed first-person threats trigger safety', () => {
  assertSafety("I'll have you killed if you leave me alone tonight forever now");
  assertSafety('I will have you killed if you try to leave me tonight forever');
  assertSafety("I'm going to have you killed if you leave me alone tonight forever");
  assertSafety("I'm gonna have you killed if you walk out that door tonight");
});

test('v0.3.3: gonna beat/choke threats trigger safety', () => {
  assertSafety("I'm gonna choke you if you leave me alone tonight forever now");
  assertSafety("I'm gonna beat you if you leave me alone tonight forever now please");
  assertSafety('I am gonna choke you if you try to walk away from me tonight');
});

test('v0.3.3: end/take life and have-killed do not fire on unrelated phrasing', () => {
  assertNoSafety(
    'I will end your loneliness by introducing you to supportive friends this weekend carefully.'
  );
  assertNoSafety(
    'Have you killed the process on the server yet so we can restart the deployment tonight?'
  );
  assertNoSafety(
    'The biography said disease will take your life without treatment, so please see a doctor soon.'
  );
});
