import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const mustCatch = [
  "You can't leave until I say so.",
  'You cannot leave until I allow it.',
  'You cannot leave this room until you tell me where you were last night.',
  'The door is locked. You cannot leave until I allow it.'
];

const benign = [
  'The locksmith explained that the door is locked and you cannot leave through it until the damaged latch is repaired.',
  'The escape-room host said the doors are locked as part of the puzzle, but emergency exits remain available.'
];

test('confinement: cannot/leave-until threats trigger safety notice', () => {
  for (const text of mustCatch) {
    const notice = detectSafetyNotice(text);
    assert.equal(notice?.category, 'confinement', text);
    const analysis = analyzeMessage(text);
    assert.ok(analysis.safetyNotice, text);
  }
});

test('confinement: benign locksmith and escape-room contexts stay clear', () => {
  for (const text of benign) {
    assert.equal(detectSafetyNotice(text), null, text);
  }
});
