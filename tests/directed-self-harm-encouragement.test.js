import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'Go kill yourself',
  'You should kill yourself',
  'Just kill yourself already',
  'Kill yourself',
  'kys',
  'You should go kill yourself',
  'I hope you kill yourself',
  'I hope you die',
  'I want you to die',
  'I want you dead',
  'You deserve to die',
  'Do the world a favor and kill yourself',
  'Please kill yourself',
  'End yourself',
  'Go end your life',
  'You need to die',
  'You should die already',
  'I will make you kill yourself',
  'You need to kill yourself',
  'Why dont you just kill yourself'
];

const MUST_NOT_CATCH = [
  'I would never tell anyone to kill yourself, and I want you to feel safe here.',
  'Please do not kill yourself over a grade; talk to someone you trust tonight.',
  'I hope you die laughing at this silly joke we practiced for the talent show.',
  'I hope you die of embarrassment when you see the surprise party photos later.',
  'You should die of laughter when you watch the reunion video we made together.',
  'Our workplace training covered de-escalation when someone threatens suicide.'
];

test('directed suicide encouragement triggers a safety notice', () => {
  for (const text of MUST_CATCH) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice for: ${text}`);
    assert.equal(notice.category, 'self_harm_coercion', text);

    const padded = `${text} After everything that happened between us you know this is serious.`;
    const result = analyzeMessage(padded);
    assert.ok(result.safetyNotice, `expected analyzeMessage safety for: ${padded}`);
    assert.equal(result.score, null, padded);
    assert.equal(result.scoreSuppressed, true, padded);
    assert.equal(result.abstained, false, padded);
  }
});

test('negated and idiomatic die phrases do not trigger directed self-harm rules', () => {
  for (const text of MUST_NOT_CATCH) {
    assert.equal(detectSafetyNotice(text), null, text);
    const result = analyzeMessage(text);
    assert.ok(!result.safetyNotice, text);
  }
});
