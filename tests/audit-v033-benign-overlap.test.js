import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSafetyNotice } from '../safety.js';

const mustCatch = [
  'You are dead wrong and I will kill you tonight.',
  'I will kill you and you are dead wrong about everything.',
  'My friend texted a terrible joke and I will kill you tonight.',
  'My friend texted a terrible joke: I will kill you tonight.',
  'I installed a tracker in my own luggage and I will kill you.',
  'I know your work schedule because you asked me to arrange carpools and I will kill you.',
  'I am outside your house with the groceries you requested and I will hurt you tonight.'
];

const mustRemainBenign = [
  'You are dead wrong about the movie ending, but the friendly debate has been entertaining all evening.',
  'My friend texted I will hurt you as a terrible joke, and I told him never to use that language.',
  'This extra spicy chili will kill you, so start with a tiny serving and keep water nearby.',
  'I installed a tracker in my own luggage so I can find the suitcase if the airline loses it.',
  'I know your work schedule because you asked me to arrange carpools for the entire team this month.',
  'I am outside your house with the groceries you requested, and I can leave them on the porch.'
];

test('benign full-clause context does not suppress co-occurring first-person threats', async (t) => {
  for (const text of mustCatch) {
    await t.test(text, () => {
      assert.ok(detectSafetyNotice(text), `expected safety notice: ${text}`);
    });
  }
});

test('benign full-clause framing still suppresses quoted or metaphorical language', async (t) => {
  for (const text of mustRemainBenign) {
    await t.test(text, () => {
      assert.equal(detectSafetyNotice(text), null, `unexpected safety notice: ${text}`);
    });
  }
});
