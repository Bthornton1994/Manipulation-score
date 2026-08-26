import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'If you dump me I will jump off a bridge and it will be your fault forever after everything.',
  "I'll jump off a bridge if you leave me alone like this again after everything we shared.",
  "I'll jump in front of a train if you leave me tonight after everything we have been through.",
  "I'll cut my wrists if you leave me alone like this again tonight after our fight.",
  'If you leave me I will slash my wrists tonight after everything we built together here.',
  'If you break up with me I will overdose on the pills in the cabinet tonight after this.',
  "I'll OD if you dump me and you will have to live with that forever after tonight.",
  "I'm going to overdose if you abandon me tonight after everything we have shared together.",
  "I'll jump off a bridge and it will be your fault if this keeps going the way it has."
];

const MUST_NOT = [
  'The counselor quoted if you leave me I will kill myself while explaining coercive self-harm threats.',
  'Our workplace training covered de-escalation when someone threatens suicide after a breakup.',
  'All the pills ready in the weekly organizer so you remember your evening dose each night.',
  'I will not hurt myself if you need space this weekend after a stressful week at work.',
  'Doctors warn patients not to overdose if you combine these medicines without checking first.',
  'The novel includes a character who says I will jump off a bridge if you leave during rehearsal.'
];

function pad(text) {
  return `${text} Please respond quickly about this situation today okay thanks please respond quickly about this situation today okay thanks`;
}

function assertSafetyResult(text) {
  const result = analyzeMessage(pad(text));
  assert.ok(result.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
  assert.equal(result.abstained, false, text);
  assert.equal(result.scoreSuppressed, true, text);
}

test('self-harm coercion: jump, wrists, and OD method threats trigger safety notice', () => {
  for (const text of MUST_CATCH) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice: ${text}`);
    assert.equal(notice.category, 'self_harm_coercion', text);
    assertSafetyResult(text);
  }
});

test('self-harm coercion: method-form controls stay clear', () => {
  for (const text of MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
