// Worker configuration: env parsing, mode, limits, key presence flags.
//
// This is the only module that reads process.env for Media Lens. Key
// *values* are read here and passed to the live adapters in memory; they
// are never logged, never returned from /health, and never written to a
// file. Browser-served files under media-lens/*.js never import this
// module and never reference process.env (enforced by
// tests/media-lens-no-secrets.test.js). classifier.dev enablement is an
// evaluation-only exact-string flag and is off by default.

import { statSync } from 'node:fs';
import { parseHostnameAllowlist } from './host-key.js';
import {
  DEFAULT_BASE_URL as CLASSIFIER_DEV_DEFAULT_BASE_URL,
  DEFAULT_MAX_BATCH,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_DAILY_CLASSIFICATIONS,
  DEFAULT_MIN_CONFIDENCE_FOR_ESCALATION,
  readClassifierDevTier,
  resolveClassifierDevBaseUrl
} from './classifier-dev/contract.js';
import { DEFAULT_TYPESAFE_BUDGET } from './typesafe-budget.js';
import { DEFAULT_TYPESAFE_BUDGET_STORE_FILE } from './typesafe-budget-store.js';
import { BLOCKED_ALERT_TRANSPORT, readAlertCredential, resolveAlertCredentialPath } from './alert.js';
import { candidateSources, approvedSources } from './discovery/source-registry.js';

export const LIVE_URL_OVERSIZED_MESSAGE =
  'This public page is too long for Media Lens live analysis. No manipulation analysis or score was generated. Try a shorter public article.';

export const DEFAULT_LIMITS = Object.freeze({
  maxRequestBodyBytes: 512 * 1024,
  maxPreparedTextChars: 60000,
  minAnalyzableChars: 200,
  maxSpans: 200,
  maxAnalysesPerMinute: 5,
  maxLiveUrlPerMinute: 5,
  maxLiveUrlPerHostPerMinute: 2,
  maxConcurrentLiveUrl: 1,
  maxJevCallsPerAnalysis: 160,
  jevCallTimeoutMs: 8000,
  perAnalysisTimeoutMs: 15000,
  urlFetchTimeoutMs: 8000,
  urlFetchMaxBytes: 2 * 1024 * 1024,
  urlFetchMaxRedirects: 3,
  urlFetchConnectTimeoutMs: 3000,
  urlFetchMaxHeaderBytes: 8192,
  urlFetchParseTimeoutMs: 2000,
  maxStoryDiscoveryPerMinute: 6
});

// Owner approval 2026-09-22 PT for the four numeric limits, and a same-day
// owner authorization for a planning-only per-call estimate.
// ESTIMATED planning value only. loadConfig must not inject it and must not
// copy this object into the environment. Runtime still needs
// MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL set explicitly. An unset
// env keeps the parsed per-call estimate null, so real narrow calls stay at zero.
// Basis for 0.002: universal serialized request bound 9467 characters; planning
// token bound 3156 = ceil(9467 / 3); public TypeSafe reference $0.042 / MTok
// input (planning-only; account invoice unverified); 20% buffer makes the raw
// buffered figure about $0.000159 / call. 0.002 is a conservative planning
// estimate above that figure, not account-verified billing and not a
// production-ready claim. Five calls at 0.002 are $0.010.
export const NARROW_SHADOW_APPROVED_OPERATING_POINTS = Object.freeze({
  approvedOn: '2026-09-22',
  maxCallsPerAnalysis: 5,
  timeoutMs: 10000,
  rateLimitPerMinute: 6,
  monthlyCostCeilingUsd: 5,
  estimatedUsdPerCall: 0.002
});

function readMode(env) {
  const raw = (env.MEDIA_LENS_MODE || 'fixture').toLowerCase();
  return raw === 'live' ? 'live' : 'fixture';
}

function readExactTrue(env, name) {
  return env[name] === 'true';
}

function readInt(env, name, fallback, { min = 0, max = 100000 } = {}) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readNumber(env, name, fallback, { min = 0, max = 1 } = {}) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readUnsetOrWhole(env, name, { min, max }) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === '') return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function readUnsetOrPositiveDecimal(env, name, { max }) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === '') return null;
  const text = String(raw).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) return null;
  return parsed;
}

function ciDisablesNarrowNetwork(env) {
  const raw = env.CI;
  if (raw == null) return false;
  const text = String(raw).trim().toLowerCase();
  return text !== '' && text !== 'false' && text !== '0';
}

function getEnv(config) {
  return config && config._env ? config._env : {};
}

/**
 * Build a config object from an environment map (defaults to
 * process.env). Never returns key values directly under an obviously
 * loggable field; callers that need the key value must read
 * config.secrets.typesafeApiKey explicitly and must not serialize it.
 */
export function loadConfig(env = process.env) {
  const mode = readMode(env);
  const liveEnabled = readExactTrue(env, 'MEDIA_LENS_ENABLE_LIVE');
  const liveUrlEnabled = readExactTrue(env, 'MEDIA_LENS_ENABLE_LIVE_URL');
  const typesafeApiKey = env.MEDIA_LENS_TYPESAFE_API_KEY || null;
  const medialystToken = env.MEDIA_LENS_MEDIALYST_TOKEN || null;
  const killSwitchFile = typeof env.MEDIA_LENS_KILL_SWITCH_FILE === 'string' && env.MEDIA_LENS_KILL_SWITCH_FILE
    ? env.MEDIA_LENS_KILL_SWITCH_FILE
    : null;
  const urlAllowlist = Object.freeze(parseHostnameAllowlist(env.MEDIA_LENS_URL_ALLOWLIST || ''));

  const config = {
    mode,
    liveEnabled,
    liveUrlEnabled,
    killSwitch: readExactTrue(env, 'MEDIA_LENS_KILL_SWITCH'),
    killSwitchFile,
    urlAllowlist,
    host: env.MEDIA_LENS_HOST || '127.0.0.1',
    port: Number.parseInt(env.MEDIA_LENS_PORT || '8787', 10),
    limits: {
      ...DEFAULT_LIMITS,
      maxAnalysesPerMinute: readInt(env, 'MEDIA_LENS_MAX_ANALYSES_PER_MINUTE', DEFAULT_LIMITS.maxAnalysesPerMinute, {
        min: 0
      }),
      maxLiveUrlPerMinute: readInt(env, 'MEDIA_LENS_MAX_LIVE_URL_PER_MINUTE', DEFAULT_LIMITS.maxLiveUrlPerMinute, {
        min: 0
      }),
      maxLiveUrlPerHostPerMinute: readInt(
        env,
        'MEDIA_LENS_MAX_LIVE_URL_PER_HOST_PER_MINUTE',
        DEFAULT_LIMITS.maxLiveUrlPerHostPerMinute,
        { min: 0 }
      ),
      maxConcurrentLiveUrl: readInt(env, 'MEDIA_LENS_MAX_CONCURRENT_LIVE_URL', DEFAULT_LIMITS.maxConcurrentLiveUrl, {
        min: 0
      }),
      maxStoryDiscoveryPerMinute: readInt(
        env,
        'MEDIA_LENS_MAX_STORY_DISCOVERY_PER_MINUTE',
        DEFAULT_LIMITS.maxStoryDiscoveryPerMinute,
        { min: 0 }
      ),
      maxJevCallsPerAnalysis: readInt(
        env,
        'MEDIA_LENS_MAX_JEV_CALLS_PER_ANALYSIS',
        DEFAULT_LIMITS.maxJevCallsPerAnalysis,
        { min: 1, max: 10000 }
      ),
      perAnalysisTimeoutMs: readInt(
        env,
        'MEDIA_LENS_PER_ANALYSIS_TIMEOUT_MS',
        DEFAULT_LIMITS.perAnalysisTimeoutMs,
        { min: 1000, max: 300000 }
      )
    },
    typesafeBudget: {
      estimatedUsdPerCall: readNumber(
        env,
        'MEDIA_LENS_TYPESAFE_ESTIMATED_USD_PER_CALL',
        DEFAULT_TYPESAFE_BUDGET.estimatedUsdPerCall,
        { min: 0, max: 10 }
      ),
      estimatedTokensPerCall: readInt(
        env,
        'MEDIA_LENS_TYPESAFE_ESTIMATED_TOKENS_PER_CALL',
        DEFAULT_TYPESAFE_BUDGET.estimatedTokensPerCall,
        { min: 1, max: 1000000 }
      ),
      warnUsd: readNumber(env, 'MEDIA_LENS_TYPESAFE_BUDGET_WARN_USD', DEFAULT_TYPESAFE_BUDGET.warnUsd, { min: 0, max: 100000 }),
      stopUsd: readNumber(env, 'MEDIA_LENS_TYPESAFE_BUDGET_STOP_USD', DEFAULT_TYPESAFE_BUDGET.stopUsd, { min: 0, max: 100000 }),
      storeFile:
        typeof env.MEDIA_LENS_TYPESAFE_BUDGET_FILE === 'string' && env.MEDIA_LENS_TYPESAFE_BUDGET_FILE
          ? env.MEDIA_LENS_TYPESAFE_BUDGET_FILE
          : DEFAULT_TYPESAFE_BUDGET_STORE_FILE
    },
    alert: {
      credentialPath: resolveAlertCredentialPath(env),
      credentialPresent: Boolean(readAlertCredential(env)),
      deliveryTestEnabled: env.MEDIA_LENS_ALERT_DELIVERY_TEST === 'true'
    },
    jev: {
      baseUrl: env.MEDIA_LENS_TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
      modelRequested: 'jev-1.13.0',
      hasApiKey: Boolean(typesafeApiKey)
    },
    // Exact string only. Does not enable live Jev, live URL, pasted text,
    // classifier.dev, or pin verify. extraJevCallsEnabled stays false:
    // MEDIA_LENS_JEV_SHADOW only captures production answers. Narrow-question
    // calls use jevShadowNarrow. The parsers below stay null when unset.
    // They do not fall back to any planning value recorded above this function.
    // An unset per-call estimate env stays null, so real narrow calls stay at zero.
    jevShadow: {
      enabled: readExactTrue(env, 'MEDIA_LENS_JEV_SHADOW'),
      extraJevCallsEnabled: false
    },
    jevShadowNarrow: {
      enabled: readExactTrue(env, 'MEDIA_LENS_JEV_SHADOW_NARROW'),
      maxCallsPerAnalysis: readUnsetOrWhole(env, 'MEDIA_LENS_JEV_SHADOW_NARROW_MAX_CALLS_PER_ANALYSIS', {
        min: 1,
        max: 10000
      }),
      timeoutMs: readUnsetOrWhole(env, 'MEDIA_LENS_JEV_SHADOW_NARROW_TIMEOUT_MS', { min: 1, max: 120000 }),
      rateLimitPerMinute: readUnsetOrWhole(env, 'MEDIA_LENS_JEV_SHADOW_NARROW_RATE_LIMIT_PER_MINUTE', {
        min: 1,
        max: 100000
      }),
      monthlyCostCeilingUsd: readUnsetOrPositiveDecimal(env, 'MEDIA_LENS_JEV_SHADOW_NARROW_MONTHLY_COST_CEILING_USD', {
        max: 1000000
      }),
      estimatedUsdPerCall: readUnsetOrPositiveDecimal(env, 'MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL', {
        max: 10000
      }),
      ciDisablesNetwork: ciDisablesNarrowNetwork(env)
    },
    newsjack: {
      artifactsDir: env.MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR || null
    },
    // Exact string only. Does not enable Jev, live URL, or feed retrieval
    // until a registry entry is approved. The fixture flag is ignored in live mode.
    storyDiscoveryEnabled: readExactTrue(env, 'MEDIA_LENS_ENABLE_STORY_DISCOVERY'),
    storyDiscoveryFixtures: mode !== 'live' && readExactTrue(env, 'MEDIA_LENS_STORY_DISCOVERY_FIXTURES'),
    classifierDev: {
      enabled: readExactTrue(env, 'MEDIA_LENS_ENABLE_CLASSIFIER_DEV'),
      baseUrl: env.MEDIA_LENS_CLASSIFIER_DEV_BASE_URL || CLASSIFIER_DEV_DEFAULT_BASE_URL,
      // Unset/empty → fast. Smart requires exact MEDIA_LENS_CLASSIFIER_DEV_TIER=smart.
      tier: readClassifierDevTier(env.MEDIA_LENS_CLASSIFIER_DEV_TIER),
      timeoutMs: readInt(env, 'MEDIA_LENS_CLASSIFIER_DEV_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, {
        min: 1,
        max: 60000
      }),
      maxBatch: readInt(env, 'MEDIA_LENS_CLASSIFIER_DEV_MAX_BATCH', DEFAULT_MAX_BATCH, { min: 0, max: 200 }),
      maxDailyClassifications: readInt(
        env,
        'MEDIA_LENS_CLASSIFIER_DEV_MAX_DAILY_CLASSIFICATIONS',
        DEFAULT_MAX_DAILY_CLASSIFICATIONS,
        { min: 0, max: 20000 }
      ),
      minConfidenceForEscalation: readNumber(
        env,
        'MEDIA_LENS_CLASSIFIER_DEV_MIN_CONFIDENCE_FOR_ESCALATION',
        DEFAULT_MIN_CONFIDENCE_FOR_ESCALATION,
        { min: 0, max: 1 }
      )
    },
    secrets: {
      typesafeApiKey,
      medialystToken
    }
  };
  Object.defineProperty(config, '_env', { value: env, enumerable: false });
  return config;
}

/**
 * Per-request kill-switch check. MEDIA_LENS_KILL_SWITCH must be the exact
 * string `true` (same rule as ENABLE_LIVE / ENABLE_LIVE_URL). `TRUE`, `1`,
 * and `yes` do not assert it. An existing MEDIA_LENS_KILL_SWITCH_FILE is
 * equivalent. File existence is re-read each call so ops can `touch`
 * without a restart.
 *
 * Kill-file checks use `statSync`, not `existsSync`. A missing path
 * (`ENOENT`) is not a kill. Permission, IO, and any other check error
 * fail-closed (treat as asserted) so an unreadable kill-file path cannot
 * leave live paths enabled. `MEDIA_LENS_KILL_SWITCH=true` is checked first
 * and does not consult the file.
 *
 * `io.statSync` is a test seam for stubbing check errors; production callers
 * omit it.
 */
export function isKillSwitchAsserted(config, io = {}) {
  const env = getEnv(config);
  if (env.MEDIA_LENS_KILL_SWITCH === 'true') return true;
  const file = env.MEDIA_LENS_KILL_SWITCH_FILE || config.killSwitchFile;
  if (typeof file === 'string' && file.length > 0) {
    const stat = typeof io.statSync === 'function' ? io.statSync : statSync;
    try {
      stat(file);
      return true;
    } catch (err) {
      return err?.code !== 'ENOENT';
    }
  }
  return false;
}

/**
 * Effective live flags for this request. Kill switch wins over every
 * enable flag. ENABLE_* still require the exact string `true`.
 */
export function effectiveLiveFlags(config) {
  const env = getEnv(config);
  const killSwitch = isKillSwitchAsserted(config);
  const liveEnabled = !killSwitch && env.MEDIA_LENS_ENABLE_LIVE === 'true';
  const liveUrlEnabled = !killSwitch && liveEnabled && env.MEDIA_LENS_ENABLE_LIVE_URL === 'true';
  const classifierDevEnabled = !killSwitch && env.MEDIA_LENS_ENABLE_CLASSIFIER_DEV === 'true';
  return { killSwitch, liveEnabled, liveUrlEnabled, classifierDevEnabled };
}

export function classifierDevAdapterEnabled(config) {
  return effectiveLiveFlags(config).classifierDevEnabled;
}

export function jevAdapterMode(config) {
  if (config.mode !== 'live') return 'fixture';
  const flags = effectiveLiveFlags(config);
  return flags.liveEnabled ? 'live' : 'disabled';
}

/**
 * A version of the config that is safe to serialize (e.g. for /health).
 * Never includes secret values, only presence booleans. jevShadow and
 * jevShadowNarrow are omitted so /health stays the same whether those
 * flags are set or not.
 */
export function publicConfig(config) {
  const flags = effectiveLiveFlags(config);
  const resolvedBase = resolveClassifierDevBaseUrl(config.classifierDev.baseUrl);
  return {
    mode: config.mode,
    liveEnabled: Boolean(config.liveEnabled),
    liveUrlEnabled: Boolean(config.liveUrlEnabled),
    killSwitch: flags.killSwitch,
    killSwitchFileConfigured: Boolean(config.killSwitchFile),
    urlAllowlistConfigured: Array.isArray(config.urlAllowlist) && config.urlAllowlist.length > 0,
    limits: config.limits,
    jev: { mode: config.mode === 'live' ? 'live' : 'fixture', modelRequested: config.jev.modelRequested, hasApiKey: config.jev.hasApiKey },
    newsjack: { artifactsConfigured: Boolean(config.newsjack.artifactsDir) },
    storyDiscovery: {
      enabled: config.storyDiscoveryEnabled === true,
      approvedSourceCount: approvedSources().length,
      candidateSourceCount: candidateSources().length
    },
    classifierDev: {
      enabled: Boolean(config.classifierDev.enabled),
      effectiveEnabled: flags.classifierDevEnabled,
      evaluationOnly: true,
      host: resolvedBase.ok ? resolvedBase.host : null,
      tier: config.classifierDev.tier,
      timeoutMs: config.classifierDev.timeoutMs,
      maxBatch: config.classifierDev.maxBatch,
      maxDailyClassifications: config.classifierDev.maxDailyClassifications,
      minConfidenceForEscalation: config.classifierDev.minConfidenceForEscalation
    },
    typesafeBudget: {
      estimatedUsdPerCall: config.typesafeBudget.estimatedUsdPerCall,
      estimatedTokensPerCall: config.typesafeBudget.estimatedTokensPerCall,
      warnUsd: config.typesafeBudget.warnUsd,
      stopUsd: config.typesafeBudget.stopUsd,
      storeFile: config.typesafeBudget.storeFile,
      basis: 'ESTIMATED'
    },
    alert: {
      recipient: 'bthornton9415@gmail.com',
      credentialConfigured: Boolean(config.alert.credentialPresent),
      transport: config.alert.credentialPresent ? 'webhook_or_smtp_via_loadcredential' : BLOCKED_ALERT_TRANSPORT,
      deliveryTestEnabled: Boolean(config.alert.deliveryTestEnabled)
    }
  };
}

/**
 * Live mode must refuse to start unless the operator has opted in with
 * MEDIA_LENS_ENABLE_LIVE=true *and* the required TypeSafe key is present.
 * Called by createServer() before the HTTP server is constructed, so a
 * direct createServer(config).listen() cannot bypass startServer().
 */
export function assertLiveModeIsReady(config) {
  if (config.mode !== 'live') return { ok: true };
  if (!config.liveEnabled) {
    return { ok: false, reason: 'MEDIA_LENS_MODE=live requires MEDIA_LENS_ENABLE_LIVE=true' };
  }
  if (!config.secrets.typesafeApiKey) {
    return { ok: false, reason: 'MEDIA_LENS_MODE=live requires MEDIA_LENS_TYPESAFE_API_KEY to be set' };
  }
  return { ok: true };
}
