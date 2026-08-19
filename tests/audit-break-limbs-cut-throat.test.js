import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'I will break your legs if you walk out that door tonight after arguing.',
  "I'll break your arms if you touch that phone tonight after this fight.",
  "I'm going to break your fingers if you try to text anyone for help tonight.",
  'I am going to break your knees if you try to run away from me tonight.',
  'He will break your bones if you keep lying about where you were last night.',
  'I will cut your throat if you scream or try to call for help tonight.',
  "I'll cut your throat if you tell anyone what happened between us tonight.",
  "I'm going to cut your throat if you open that door before I say you can.",
  'I am going to cut your throat if you try to leave me after this argument.',
  'She will cut your throat if you keep ignoring every warning she gave you.'
];

const MUST_NOT = [
  'I will not break your legs if you need space this weekend after a stressful week at work.',
  'I am never going to cut your throat, and I want you to feel safe talking with me.',
  'The novel includes the line I will break your legs, which the critic describes as melodramatic dialogue.',
  'The actor rehearsed I will cut your throat before the director replaced the violent line.',
  'Our workplace training covered de-escalation when someone threatens to break a partner’s bones.',
  'The mountain climb will murder your legs, but the route has several safe turnaround points.'
];

function pad(text) {
  return `${text} Please respond quickly about this situation today okay thanks please respond quickly about this situation today okay thanks`;
}

test('direct violence: break-limbs and cut-throat threats trigger safety notice', () => {
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

test('direct violence: break-limbs and cut-throat benign contexts stay clear', () => {
  for (const text of MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
