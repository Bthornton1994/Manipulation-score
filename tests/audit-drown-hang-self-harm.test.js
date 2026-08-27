import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH_VIOLENCE = [
  "I'll drown you tonight after everything we have been through together here.",
  'I will drown you in the river if you try to leave me tonight after this fight.',
  "I'm going to drown you tonight when you get home from work after this fight.",
  "I'll hang you from the rafters if you try to leave me tonight after this.",
  'I will hang you tonight when you get home from work after our fight ends.',
  "I'm going to hang you if you keep ignoring me like this after everything."
];

const MUST_CATCH_SELF_HARM = [
  "I'll hang myself if you leave me alone like this again after everything.",
  'If you leave me I will hang myself tonight after everything we built together.',
  "I'm going to hang myself if you leave after everything we have shared here.",
  "I'll shoot myself if you leave me alone like this again after everything.",
  'If you leave me I will shoot myself tonight after everything we built together.',
  "I'll drown myself if you leave me alone like this again after everything.",
  'If you leave me I will drown myself tonight after everything we built together.',
  "I'll hang myself and it will be your fault if this keeps going the way it has."
];

const MUST_NOT = [
  'The counselor quoted if you leave me I will hang myself while explaining coercive self-harm threats.',
  'Our workplace training covered de-escalation when someone threatens to hang themselves after a breakup.',
  'I will not hang myself if you need space this weekend after a stressful week at work.',
  'I will not drown you if you need more time to finish the report this week after all.',
  "I'll hang you out to dry if you miss another deadline on this project after warnings.",
  'The novel includes a character who says I will drown you if you leave during rehearsal.',
  'I will not shoot myself if you need space this weekend after a stressful week at work.'
];

function pad(text) {
  return `${text} Please respond quickly about this situation today okay thanks please respond quickly about this situation today okay thanks`;
}

function assertSafetyResult(text, category) {
  const notice = detectSafetyNotice(text);
  assert.ok(notice, `expected safety notice: ${text}`);
  assert.equal(notice.category, category, text);
  const result = analyzeMessage(pad(text));
  assert.ok(result.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
  assert.equal(result.abstained, false, text);
  assert.equal(result.scoreSuppressed, true, text);
}

test('direct violence: I will/I\'ll drown you and hang you threats trigger safety notice', () => {
  for (const text of MUST_CATCH_VIOLENCE) {
    assertSafetyResult(text, 'direct_violence');
  }
});

test('self-harm coercion: hang/shoot/drown myself threats trigger safety notice', () => {
  for (const text of MUST_CATCH_SELF_HARM) {
    assertSafetyResult(text, 'self_harm_coercion');
  }
});

test('drown/hang controls stay clear of false safety notices', () => {
  for (const text of MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
