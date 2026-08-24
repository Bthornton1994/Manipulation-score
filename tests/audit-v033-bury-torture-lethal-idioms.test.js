import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

/**
 * Lethal first-person idioms adjacent to covered kill/hurt/drown patterns
 * were omitted, so realistic threats returned a Low band instead of safety.
 */
const MUST_CATCH = [
  'I will bury you if you ever try to leave me alone tonight after this fight ends badly between us.',
  "I'll bury you if you tell anyone about what happened between us after tonight.",
  "I'm going to bury you if you walk away from me after tonight's argument ends.",
  'I am going to bury you alive if you tell anyone what happened between us tonight.',
  'I will torture you if you ever try leaving me alone after everything we have been through tonight.',
  "I'll torture you if you keep ignoring me after everything that happened tonight between us.",
  "I'm going to torture you if you leave me alone after this fight we are having tonight.",
  "I'll crush your skull if you try walking out of this house after tonight's argument ends.",
  "I'm going to crush your head if you leave me alone after this fight tonight ends badly.",
  'I will blow your brains out if you leave me alone after this fight we are having tonight.',
  "I'll blow your brains out if you try walking away from me after tonight's argument.",
  "I'm going to put a bullet in your head if you walk away from me after tonight's fight.",
  'I will put a bullet in you if you try to leave me alone after this fight tonight ends.',
  'I will put you in the ground if you try leaving me alone after this fight tonight ends.',
  "I'll put you six feet under if you walk away from me after tonight's argument ends.",
  "I'll gut you if you keep talking about leaving me after everything that happened tonight.",
  "I'm going to gut you if you walk out on me after tonight's fight ends between us.",
  'I will skin you alive if you ever try to leave me alone after this fight tonight ends.'
];

const MUST_NOT_CATCH = [
  'I will bury you in paperwork tomorrow when we finish the quarterly reports together at the office.',
  'I will not torture you, and I want you to feel safe when we talk about what happened tonight.',
  "I'll never gut you, and I want us both to calm down before we continue talking tonight about this.",
  'The documentary said they will bury you in archival footage if the interview runs long tomorrow.',
  'During training the instructor said someone might crush your skull in a movie fight scene example.'
];

test('v0.3.3: bury, torture, and lethal idioms trigger safety notices', () => {
  for (const text of MUST_CATCH) {
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice: ${text}`);
    assert.equal(notice.category, 'direct_violence');

    const analysis = analyzeMessage(text);
    assert.ok(analysis.safetyNotice, `expected analyzeMessage safety: ${text}`);
    assert.equal(analysis.score, null);
  }
});

test('v0.3.3: bury/torture lethal-idiom controls stay clear of safety', () => {
  for (const text of MUST_NOT_CATCH) {
    const notice = detectSafetyNotice(text);
    assert.equal(notice, null, `unexpected safety notice: ${text}`);
  }
});
