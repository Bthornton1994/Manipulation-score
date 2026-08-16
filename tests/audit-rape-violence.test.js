import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'I will rape you if you try to leave me tonight after this fight ends badly.',
  "I'll rape you if you tell anyone about what happened between us tonight.",
  "I'm going to rape you if you keep refusing to stay with me tonight.",
  'I am going to rape you if you walk out that door after everything tonight.',
  'He will rape you if you try to leave him after this argument ends badly.'
];

const MUST_NOT = [
  'I will not rape you, and I want you to feel safe talking with me about this.',
  "I'll never rape you, and I want us both to calm down before we continue talking.",
  'The counselor explained that threatening to rape a partner is coercive sexual violence.',
  'The novel includes the line I will rape you, which the critic describes as melodramatic dialogue.'
];

function pad(text) {
  return `${text} Please respond quickly about this situation today okay thanks please respond quickly about this situation today okay thanks`;
}

test('direct violence: first-person rape threats trigger safety notice', () => {
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

test('direct violence: negated and quoted rape contexts stay clear', () => {
  for (const text of MUST_NOT) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
