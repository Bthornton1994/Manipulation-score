import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectSafetyNotice } from '../safety.js';
import { analyzeMessage } from '../scoring.js';

const MUST_CATCH = [
  'I will hit you if you talk to him again tonight after dinner with our friends nearby',
  'I am going to hit you if you leave me alone tonight after everything we have been through together',
  "I'll hit you if you keep ignoring what I asked you to do after dinner tonight",
  'I will slap you across the face if you say that again to me tonight after dinner',
  'I am going to slap you if you walk out that door tonight after everything I have done',
  'I will make you disappear if you tell anyone about what happened last night at home',
  'I am going to make you disappear if you talk to the police about me tonight after work',
  'I will end you if you leave me tonight after everything I have done for you always',
  "I'm going to end you if you walk out that door tonight my love forever more"
];

const MUST_REMAIN_CLEAR = [
  'I will hit you up later after the meeting so we can finish the packet together tonight.',
  'I am going to hit you up tomorrow morning once the documents are ready for review.',
  'I will not hit you; I just need you to listen to me tonight after dinner with friends.',
  'I will not slap you or raise my voice; we can pause and talk when you are ready tonight.',
  'In the movie the villain said "I will make you disappear" before the chase scene started.',
  'During training the instructor used "I will end you" as an example of game trash talk only.'
];

function assertSafety(text) {
  assert.ok(detectSafetyNotice(text), `expected safety for: ${text}`);
  const result = analyzeMessage(text);
  assert.ok(result.safetyNotice, text);
  assert.equal(result.score, null, text);
  assert.equal(result.signals.length, 0, text);
}

function assertNoSafety(text) {
  assert.equal(detectSafetyNotice(text), null, text);
  const result = analyzeMessage(text);
  assert.ok(!result.safetyNotice, text);
}

test('hit/slap/disappear/end-you threats trigger safety notices', () => {
  for (const text of MUST_CATCH) {
    assertSafety(text);
  }
});

test('hit-you-up, negated, and attributed forms stay clear', () => {
  for (const text of MUST_REMAIN_CLEAR) {
    assertNoSafety(text);
  }
});

test('service worker cache bumped for hit/slap safety update', async () => {
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /clarity-v36/);
});
