// Opt-in classifier.dev live probe helpers. Never called from default CI.
// Synthetic labels only. No scraped news. No API keys.

export const LIVE_PROBE_INPUT = 'The sky is blue on a clear day.';
export const LIVE_PROBE_LABELS = Object.freeze(['alpha', 'beta']);

export function evaluateClassifierDevLiveProbeGate(env = {}) {
  if (env.MEDIA_LENS_KILL_SWITCH === 'true') {
    return { allowed: false, reason: 'killed' };
  }
  if (env.MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE !== 'true') {
    return { allowed: false, reason: 'flag_off' };
  }
  return { allowed: true, reason: null };
}
