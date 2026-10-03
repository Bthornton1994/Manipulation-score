import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'I will smother you in your sleep tonight after everything we have been through together here.',
  "I'm going to smother you if you try to leave me tonight after this fight ends badly.",
  'I will gas you in your sleep tonight after everything we have shared in this house.',
  "I'm going to gas you if you keep ignoring what I asked after dinner tonight at home.",
  'I will hold your head underwater until you stop fighting me about leaving tonight forever.',
  "I'm going to hold your head underwater if you keep talking back to me after dinner tonight.",
  'I will blow up your car if you leave me alone after this fight we are having tonight here.',
  "I'm going to blow up your house if you talk to the police about me after work tonight.",
  'I will plant a bomb in your car today after everything we argued about last night together.',
  "I'm going to plant a bomb under your car if you walk away from me after tonight's fight.",
  'I will burn your house down tonight after everything we have been through together here.',
  "I'm going to burn your car down if you keep ignoring me after dinner with our friends.",
  'I will throw you off a building if you leave me alone after this fight tonight forever.',
  "I'm going to throw you out the window if you keep talking about leaving after dinner.",
  'I will push you in front of a train if you leave me alone after tonight ends badly here.',
  "I'm going to push you into traffic if you walk away from me after dinner tonight forever.",
  'I will starve you to death if you leave me alone after everything we built together here.',
  "I'm going to starve you to death if you keep refusing what I asked after dinner tonight.",
  'I will run over you if you tell anyone about what happened last night at our house here.',
  "I'm going to run over you if you try walking away from me after tonight's argument ends.",
  'I will make sure you die tonight after everything we have been through together in this house.',
  "I'm going to make sure you die if you keep talking about leaving after dinner tonight."
];

const MUST_REMAIN_CLEAR = [
  'I will not smother you; I just need space to finish this report after a long week at work.',
  'I will not gas you up with false hope about the promotion before the review finishes this week.',
  'During rehearsal the actor said I will smother you on cue while the director adjusted lighting.',
  'In the movie the villain said I will blow up your car before the chase scene started on screen.',
  'Our workplace training covered de-escalation when someone threatens to burn a house down after conflict.',
  'I will not plant a bomb in your lunch; that was a joke about spicy peppers after the meeting.',
  'The novel includes a character who says I will throw you off a building during the rehearsal scene.',
  'I will not push you into traffic decisions before you have time to review the packet carefully today.',
  'I will not starve you of information; here is the full agenda for Monday after the planning call.',
  'I will not run over you with details; take your time reading the proposal before Friday review.',
  'I will not make sure you die of boredom during this optional workshop after lunch with the team.'
];

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), `expected safety for: ${text}`);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice, text);
  assert.equal(result.score, null, text);
  assert.equal(result.signals.length, 0, text);
}

function assertClear(text) {
  assert.equal(detectSafetyNotice(text), null, `unexpected safety for: ${text}`);
  const result = analyzeMessage(text);
  assert.equal(result.safetyNotice, null, text);
}

test('lethal method threats: smother/gas/underwater/bomb/arson/throw/push/starve trigger safety', () => {
  for (const text of MUST_CATCH) assertSafety(text);
});

test('lethal method controls stay clear of false safety notices', () => {
  for (const text of MUST_REMAIN_CLEAR) assertClear(text);
});

test('short smother threat is not blocked by word-count abstention', () => {
  const result = analyzeMessage('I will smother you.');
  assert.ok(result.safetyNotice);
  assert.equal(result.abstained, false);
  assert.equal(result.score, null);
});
