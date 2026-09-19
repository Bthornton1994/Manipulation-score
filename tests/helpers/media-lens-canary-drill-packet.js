// Issue #118 remediation E: machine-readable inventory of the canary /
// kill-switch drill packet. Test helper only. Does not enable live flags,
// does not call the network, and does not authorize a canary.

export const CANARY_DRILL_DOC = 'docs/media-lens-canary-drill-v1.md';
export const CANARY_DRILL_RUNBOOK = 'docs/media-lens-ops-runbook-v2.md';
export const CANARY_DRILL_STATUS = 'DRILL_PACKET_ONLY';

export const DEFAULT_OFF_FLAG_NAMES = Object.freeze([
  'MEDIA_LENS_ENABLE_LIVE',
  'MEDIA_LENS_ENABLE_LIVE_URL',
  'MEDIA_LENS_ENABLE_CLASSIFIER_DEV',
  'MEDIA_LENS_JEV_VERIFY',
  'MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE'
]);

export const REQUIRED_DOC_MARKERS = Object.freeze([
  'DRILL_PACKET_ONLY',
  'not production-ready',
  'does not authorize live enablement',
  'does **not** grant `READY_FOR_CANARY`',
  'Issue #118',
  'operator-run',
  'defaults remain OFF',
  'MEDIA_LENS_ENABLE_LIVE',
  'MEDIA_LENS_ENABLE_LIVE_URL',
  'MEDIA_LENS_ENABLE_CLASSIFIER_DEV',
  'MEDIA_LENS_URL_ALLOWLIST',
  'hop-scoped',
  'live_url_not_allowlisted',
  'MEDIA_LENS_KILL_SWITCH_FILE',
  'touch',
  '503',
  'live_killed',
  'verify_kill_switch',
  'zero provider calls',
  'Rollback',
  'commit SHA',
  'HTTP statuses',
  'timestamps',
  'no secrets'
]);

export const FORBIDDEN_PRODUCTION_CLAIMS = Object.freeze([
  /live URL is production-ready/i,
  /production-ready live URL/i,
  /ready for production/i,
  /this packet authorizes live enablement/i,
  /READY_FOR_CANARY is granted/i,
  /status:\s*READY_FOR_CANARY/i
]);

export const EVIDENCE_TEMPLATE_FIELDS = Object.freeze([
  'commit_sha',
  'started_at',
  'ended_at',
  'flags_used',
  'allowlist',
  'kill_file_configured',
  'http_statuses',
  'pin_verify_reason',
  'provider_calls'
]);

/**
 * True when repository / CI defaults have not opted into live or eval
 * network paths. Misspellings and truthy-but-not-exact values are treated
 * as off, matching worker config.
 */
export function liveFlagsAreDefaultOff(env = process.env) {
  return DEFAULT_OFF_FLAG_NAMES.every((name) => env[name] !== 'true');
}
