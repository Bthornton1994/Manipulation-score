import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'I will strangle you if you do not stop talking right now tonight.',
  "I'll strangle you if you try to walk out that door tonight after this.",
  "I'm going to strangle you if you don't shut up about this right now.",
  'I am going to strangle you if you keep ignoring what I told you tonight.',
  'I will slit your throat if you tell anyone about this after work tonight.',
  "I'll slit your throat if you try to leave me after everything we shared.",
  "I'm going to slit your throat if you call the police about this tonight.",
  'I am going to slit your throat if you open that door before I say so.'
];

const MUST_NOT = [
  'The novel includes the line I will strangle you, which the critic describes as melodramatic dialogue.',
  'The actor rehearsed I will slit your throat before the director replaced the violent line.',
  'Our workplace training covered de-escalation when someone threatens to strangle a partner.',
  'I will not strangle you if you need space this weekend after a stressful week at work.',
  'I am never going to slit your throat, and I want you to feel safe talking with me.'
];

function pad(text) {
  return `${text} Please respond quickly about this situation today okay thanks please respond quickly about this situation today okay thanks`;
}

test('direct violence: strangle and slit-your-throat threats trigger safety notice', () => {
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

test('direct violence: quoted and negated strangle/slit contexts stay clear', () => {
  for (const text of MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
