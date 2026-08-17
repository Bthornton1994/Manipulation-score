import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'I will set you on fire if you try to leave me tonight after this fight.',
  "I'll set you on fire if you tell anyone about what I did to you last week.",
  "I'm going to set you on fire if you walk out on me after dinner tonight.",
  'I am going to set you on fire if you keep refusing to stay here with me.',
  'I will light you on fire if you try to run away from me after this argument.',
  "I'll light you on fire if you call anyone for help while I am still here.",
  "I'm going to light you on fire if you betray me again after everything tonight.",
  'He will set you on fire if you try to leave him after this argument ends badly.'
];

const MUST_NOT = [
  'I will not set you on fire, and I want you to feel safe talking with me about this.',
  "I'll never light you on fire, and I want us both to calm down before we continue.",
  'The novel includes the line I will set you on fire, which the critic describes as melodramatic dialogue.',
  'The actor rehearsed I will light you on fire before the director replaced the violent line.',
  'Our workplace training covered de-escalation when someone threatens to set a partner on fire.'
];

function pad(text) {
  return `${text} Please respond quickly about this situation today okay thanks please respond quickly about this situation today okay thanks`;
}

test('direct violence: set/light-on-fire threats trigger safety notice', () => {
  for (const text of MUST_CATCH) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice: ${text}`);
    assert.equal(notice.category, 'direct_violence', text);

    const result = analyzeMessage(pad(text));
    assert.ok(result.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
    assert.equal(result.abstained, false, text);
    assert.equal(result.scoreSuppressed, true, text);
  }
});

test('direct violence: quoted and negated set-on-fire contexts stay clear', () => {
  for (const text of MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
