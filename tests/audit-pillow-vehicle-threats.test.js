import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage } from '../scoring.js';
import { detectSafetyNotice } from '../safety.js';

const pad = (threat) =>
  `Please read this carefully before you answer me tonight. ${threat} I am serious about every word I am saying right now.`;

const THREATS = [
  'I will put a pillow over your face until you stop breathing.',
  "I'm going to put a pillow over your face if you scream again tonight.",
  'Hold still with a pillow over your face until you stop breathing tonight.',
  'I will run you down with my car if you leave the house tonight.',
  "I'm going to run you down if you try walking away from me after this.",
  'I will hit you with my car if you walk away from me tonight.',
  "I'm going to hit you with the truck if you keep ignoring me after work."
];

const CONTROLS = [
  'I will not put a pillow over your face; that was only a nightmare description from the novel we discussed.',
  'During rehearsal the actor said I will run you down while the director adjusted the chase choreography.',
  'I will hit you with my car keys when I find them on the kitchen counter after dinner tonight.',
  'The safety instructor used I will put a pillow over your face as an example of threatening language.'
];

test('pillow smothering and vehicle-strike threats trigger safety notices', () => {
  for (const threat of THREATS) {
    const text = pad(threat);
    const notice = detectSafetyNotice(text);
    assert.ok(notice, `expected safety notice for: ${threat}`);
    assert.equal(notice.category, 'direct_violence');

    const result = analyzeMessage(text);
    assert.equal(result.abstained, false);
    assert.ok(result.safetyNotice, `analyzeMessage should surface safety for: ${threat}`);
    assert.equal(result.band, null);
    assert.equal(result.level, null);
  }
});

test('pillow and vehicle controls stay clear of safety notices', () => {
  for (const text of CONTROLS) {
    assert.equal(detectSafetyNotice(text), null, `unexpected safety for: ${text}`);
  }
});

test('short pillow threat is not blocked by word-count abstention', () => {
  const result = analyzeMessage('I will put a pillow over your face.');
  assert.ok(result.safetyNotice);
  assert.equal(result.abstained, false);
});
