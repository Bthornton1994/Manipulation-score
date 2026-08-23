import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

/**
 * First-person kidnap / abduct / hold-hostage threats were missing from
 * IMMEDIATE_RULES. Abduction language could return a High manipulation band
 * instead of a safety notice.
 */
const MUST_CATCH = [
  'I will kidnap you if you try to leave me tonight after everything we have been through together.',
  "I'll kidnap you if you keep talking to him about what happened last night after dinner.",
  "I'm going to kidnap you if you ever try to walk away from me again after this fight tonight.",
  'I am going to kidnap you if you go to the police about what I did to you last night.',
  'I will abduct you if you try to leave me tonight after everything I have done for you.',
  "I'm going to abduct you if you keep ignoring me about staying home after everything tonight.",
  'I am going to abduct you if you talk to her about our relationship after this argument ends.',
  "I'll hold you hostage until you agree to stay with me and stop seeing your friends tonight.",
  "I'm going to hold you hostage until you apologize for what you said to me after dinner.",
  'I am going to hold you hostage until you stop trying to leave me alone after this fight.'
];

const MUST_REMAIN_BENIGN = [
  'Do not let anxiety hold you hostage; take a walk and call a friend if the evening feels heavy.',
  'The novel will kidnap you with its plot twists, but every chapter ends on a hopeful note for readers.',
  'Historians described how raiders would abduct villagers centuries ago during the border conflicts.'
];

test('first-person kidnap, abduct, and hostage threats trigger safety notices', () => {
  for (const text of MUST_CATCH) {
    assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
    const analysis = analyzeMessage(text);
    assert.ok(analysis.safetyNotice, `expected analyzeMessage safety notice: ${text}`);
    assert.equal(analysis.score, null);
    assert.equal(analysis.level, null);
  }
});

test('metaphorical or historical kidnap/hostage phrasing stays non-safety', () => {
  for (const text of MUST_REMAIN_BENIGN) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
  }
});
