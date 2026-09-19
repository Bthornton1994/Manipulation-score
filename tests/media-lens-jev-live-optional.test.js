import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevAdapter, JEV_MODEL_REQUESTED } from '../media-lens/worker/adapters/jev.js';

const liveKey = process.env.MEDIA_LENS_TYPESAFE_API_KEY;
const liveEnabled = process.env.MEDIA_LENS_ENABLE_LIVE === 'true';
const canCallLive = Boolean(liveKey) && liveEnabled;

test(
  'optional live TypeSafe call is skipped unless MEDIA_LENS_TYPESAFE_API_KEY is set and MEDIA_LENS_ENABLE_LIVE=true',
  { skip: canCallLive ? false : 'no production key in CI; live probe skipped rather than failed' },
  async () => {
    const adapter = createJevAdapter({
      mode: 'live',
      baseUrl: process.env.MEDIA_LENS_TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
      apiKey: liveKey,
      timeoutMs: 15000,
      concurrency: 1
    });
    const result = await adapter.analyzeSpans(
      [{ id: 'span-1', role: 'authorial', text: 'The committee met on Tuesday and approved the budget amendment.' }],
      { kind: 'article', title: 'Optional live contract probe' }
    );
    assert.equal(typeof result.modelReported, 'string');
    assert.equal(result.modelReported, JEV_MODEL_REQUESTED);
    assert.equal(result.calls, 1);
    if (result.failures === 0) {
      const answers = result.answersBySpanId.get('span-1');
      assert.equal(answers.influence_signal.type, 'choice');
      assert.equal(typeof answers.influence_signal.choice, 'string');
      assert.equal(answers.is_quoted_or_attributed.type, 'noul');
      assert.equal(typeof answers.is_quoted_or_attributed.noul, 'number');
    } else {
      assert.ok(result.unavailableSpanIds.has('span-1'));
    }
  }
);

test('CI default environment does not enable a live TypeSafe call', () => {
  if (!canCallLive) {
    assert.notEqual(process.env.MEDIA_LENS_ENABLE_LIVE, 'true');
  }
});
