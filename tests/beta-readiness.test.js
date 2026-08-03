import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const BENIGN_SCORING_PROBES = [
  'You have to wear your seatbelt while the car is moving because it protects you during an accident.',
  'You should talk to a lawyer before signing the agreement so you understand your legal rights.',
  'I need an answer by Friday so I can make plans, but it is completely okay to say no.',
  'Please do not tell anyone about the surprise party until Maya arrives at the restaurant tonight.',
  'Do not tell anyone your password, and contact support immediately if you think the account was compromised.',
  'You need to evacuate immediately because smoke is entering the hallway from the kitchen downstairs.'
];

const SAFETY_MUST_CATCH = [
  'I will not let you leave this room until you give me the answer I want.',
  'I will beat you until you cannot stand up again.',
  'I will choke you if you try to walk away from me.',
  'I locked the door so you cannot leave until I say so.',
  'I will take all these pills if you end our relationship.'
];

const SAFETY_BENIGN_CONTEXT = [
  'In the movie, the villain said he would kill everyone in the room before the hero escaped.',
  'During rehearsal, the actor said I will shoot you on cue when the director gives the signal.',
  'I will shoot you the updated spreadsheet after the meeting ends today.',
  'Point the knife away from your body while you chop vegetables on the cutting board.',
  'Mario Kart is fun when you throw items at your friends during the race.'
];

function assertZeroScore(text) {
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice, text);
  if (!result.abstained) {
    assert.ok(result.score <= 30, `${text} scored ${result.score}`);
  }
}

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), text);
}

test('beta readiness: difficult benign controls stay Low', () => {
  for (const text of BENIGN_SCORING_PROBES) {
    assertZeroScore(text);
  }
});

test('beta readiness: expanded safety must-catch variants', () => {
  for (const text of SAFETY_MUST_CATCH) {
    assertSafety(text);
  }
});

test('beta readiness: benign safety contexts do not alarm', () => {
  for (const text of SAFETY_BENIGN_CONTEXT) {
    assert.equal(detectSafetyNotice(text), null, text);
  }
});

test('beta readiness: single low-specificity match does not reach Moderate', () => {
  const result = analyzeMessage(
    'You should talk to a lawyer before signing the agreement so you understand your legal rights.'
  );
  assert.ok(result.score <= 30);
  assert.notEqual(result.level, 'Moderate');
});

test('beta readiness: multi-function manipulation still scores High', () => {
  const result = analyzeMessage(
    "If you really cared about me, you'd answer right now. Don't tell anyone—I'm the only one who understands you. Fine, forget it."
  );
  assert.ok(result.score >= 61);
  assert.equal(result.level, 'High');
});
