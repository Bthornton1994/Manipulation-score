// Worker configuration: env parsing, mode, limits, key presence flags.
//
// This is the only module that reads process.env for Media Lens. Key
// *values* are read here and passed to the live adapters in memory; they
// are never logged, never returned from /health, and never written to a
// file. Browser-served files under media-lens/*.js never import this
// module and never reference process.env (enforced by
// tests/media-lens-no-secrets.test.js).

export const DEFAULT_LIMITS = Object.freeze({
  maxRequestBodyBytes: 512 * 1024,
  maxPreparedTextChars: 60000,
  minAnalyzableChars: 200,
  maxSpans: 200,
  maxAnalysesPerMinute: 10,
  jevCallTimeoutMs: 8000,
  perAnalysisTimeoutMs: 30000,
  urlFetchTimeoutMs: 8000,
  urlFetchMaxBytes: 2 * 1024 * 1024,
  urlFetchMaxRedirects: 3,
  urlFetchConnectTimeoutMs: 3000,
  urlFetchMaxHeaderBytes: 8192,
  urlFetchParseTimeoutMs: 2000
});

function readMode(env) {
  const raw = (env.MEDIA_LENS_MODE || 'fixture').toLowerCase();
  return raw === 'live' ? 'live' : 'fixture';
}

function readLiveEnabled(env) {
  return env.MEDIA_LENS_ENABLE_LIVE === 'true';
}

function readLiveUrlEnabled(env) {
  return env.MEDIA_LENS_ENABLE_LIVE_URL === 'true';
}

/**
 * Build a config object from an environment map (defaults to
 * process.env). Never returns key values directly under an obviously
 * loggable field; callers that need the key value must read
 * config.secrets.typesafeApiKey explicitly and must not serialize it.
 */
export function loadConfig(env = process.env) {
  const mode = readMode(env);
  const liveEnabled = readLiveEnabled(env);
  const liveUrlEnabled = readLiveUrlEnabled(env);
  const typesafeApiKey = env.MEDIA_LENS_TYPESAFE_API_KEY || null;
  const medialystToken = env.MEDIA_LENS_MEDIALYST_TOKEN || null;

  return {
    mode,
    liveEnabled,
    liveUrlEnabled,
    host: env.MEDIA_LENS_HOST || '127.0.0.1',
    port: Number.parseInt(env.MEDIA_LENS_PORT || '8787', 10),
    limits: { ...DEFAULT_LIMITS },
    jev: {
      baseUrl: env.MEDIA_LENS_TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
      modelRequested: 'jev-1.13.0',
      hasApiKey: Boolean(typesafeApiKey)
    },
    newsjack: {
      artifactsDir: env.MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR || null
    },
    secrets: {
      typesafeApiKey,
      medialystToken
    }
  };
}

/**
 * A version of the config that is safe to serialize (e.g. for /health).
 * Never includes secret values, only presence booleans.
 */
export function publicConfig(config) {
  return {
    mode: config.mode,
    liveEnabled: Boolean(config.liveEnabled),
    liveUrlEnabled: Boolean(config.liveUrlEnabled),
    limits: config.limits,
    jev: { mode: config.mode === 'live' ? 'live' : 'fixture', modelRequested: config.jev.modelRequested, hasApiKey: config.jev.hasApiKey },
    newsjack: { artifactsConfigured: Boolean(config.newsjack.artifactsDir) }
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
