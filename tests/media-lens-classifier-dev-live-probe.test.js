import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_PROBE_INPUT,
  LIVE_PROBE_LABELS,
  evaluateClassifierDevLiveProbeGate
} from '../media-lens/worker/classifier-dev/live-probe.js';
import { CLASSIFY_PATH, buildClassifyRequest } from '../media-lens/worker/classifier-dev/contract.js';
import { createClassifierDevAdapter } from '../media-lens/worker/adapters/classifier-dev.js';

const probeOn = process.env.MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE === 'true';
const killed = process.env.MEDIA_LENS_KILL_SWITCH === 'true';
const canProbe = probeOn && !killed;

test('live probe gate is off unless MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE=true', () => {
  assert.deepEqual(evaluateClassifierDevLiveProbeGate({}), { allowed: false, reason: 'flag_off' });
  assert.deepEqual(evaluateClassifierDevLiveProbeGate({ MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE: 'TRUE' }), {
    allowed: false,
    reason: 'flag_off'
  });
  assert.deepEqual(
    evaluateClassifierDevLiveProbeGate({ MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE: 'true', MEDIA_LENS_KILL_SWITCH: 'true' }),
    { allowed: false, reason: 'killed' }
  );
  assert.equal(LIVE_PROBE_LABELS.length, 2);
  assert.doesNotMatch(LIVE_PROBE_INPUT, /breaking news|reuters|election/i);
  const built = buildClassifyRequest({ inputs: [LIVE_PROBE_INPUT], labels: [...LIVE_PROBE_LABELS], tier: 'fast' });
  assert.equal(built.ok, true);
});

test(
  'optional live classifier.dev probe is skipped unless MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE=true',
  { skip: canProbe ? false : 'live probe skipped; default CI is fixture-only' },
  async () => {
    const adapter = createClassifierDevAdapter({
      enabled: true,
      baseUrl: process.env.MEDIA_LENS_CLASSIFIER_DEV_BASE_URL || 'https://classifier.dev',
      timeoutMs: 15000
    });
    const result = await adapter.classify({
      inputs: [LIVE_PROBE_INPUT],
      labels: [...LIVE_PROBE_LABELS],
      tier: 'fast'
    });
    assert.equal(adapter.path, CLASSIFY_PATH);
    assert.equal(typeof result.networkCalls, 'number');
    if (result.ok) {
      assert.ok(LIVE_PROBE_LABELS.includes(result.results[0].label) || result.results[0].label == null);
    } else {
      assert.ok(result.results[0].reason);
    }
  }
);
