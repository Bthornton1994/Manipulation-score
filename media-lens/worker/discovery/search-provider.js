// Provider-neutral search boundary for story discovery.
// Implementations return hits. They do not fetch article pages, score
// coverage, or decide independence. Medialyst is a deferred seam only:
// this module does not load an SDK, read credentials, or open a network.

export const SEARCH_PROVIDER_NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';
export const MEDIALYST_NOT_IMPLEMENTED = SEARCH_PROVIDER_NOT_IMPLEMENTED;

// Only fixture search is implemented. The other modes are named so the hit
// shape and labels can be reviewed before any provider exists; using them
// fails with NOT_IMPLEMENTED. The separate default-off approved-feed client
// in discover.js is not a search provider and is not covered by rss_atom.
export const SEARCH_PROVIDER_MODE_STATUS = Object.freeze({
  fixture: 'implemented',
  host_web_search: 'planned_not_implemented',
  rss_atom: 'planned_not_implemented',
  medialyst: 'planned_not_implemented'
});
export const IMPLEMENTED_SEARCH_PROVIDER_MODES = Object.freeze(
  Object.keys(SEARCH_PROVIDER_MODE_STATUS).filter((mode) => SEARCH_PROVIDER_MODE_STATUS[mode] === 'implemented')
);
export const PLANNED_SEARCH_PROVIDER_MODES = Object.freeze(
  Object.keys(SEARCH_PROVIDER_MODE_STATUS).filter((mode) => SEARCH_PROVIDER_MODE_STATUS[mode] !== 'implemented')
);

function notImplemented(mode) {
  return Object.assign(
    new Error(`Search provider mode "${mode}" is planned and not implemented. No request was made.`),
    { code: SEARCH_PROVIDER_NOT_IMPLEMENTED, mode }
  );
}

export function assertSearchProviderModeImplemented(mode) {
  if (typeof mode !== 'string') {
    throw Object.assign(new Error(`Unknown search provider mode: ${String(mode)}`), { code: 'UNKNOWN_SEARCH_PROVIDER_MODE' });
  }
  if (SEARCH_PROVIDER_MODE_STATUS[mode] === 'implemented') return;
  if (Object.prototype.hasOwnProperty.call(SEARCH_PROVIDER_MODE_STATUS, mode)) throw notImplemented(mode);
  throw Object.assign(new Error(`Unknown search provider mode: ${String(mode)}`), { code: 'UNKNOWN_SEARCH_PROVIDER_MODE' });
}

/**
 * Hit shape shared by later Newsjack host-search and Medialyst results.
 * `published_at` stays null when the provider did not supply a parseable
 * time. `retrieved_at` is stamped by the caller at ingest.
 *
 * @typedef {object} SearchHit
 * @property {string} title
 * @property {string} url
 * @property {string} outlet
 * @property {string|null} [author]
 * @property {string|null} [published_at]
 * @property {string} [source_id]
 * @property {string} [relation] Newsjack cluster relation, when the hit came from a cluster artifact.
 */

/**
 * @typedef {object} SearchProvider
 * @property {string} provider_id
 * @property {'fixture'|'host_web_search'|'rss_atom'|'medialyst'} provider_mode
 * @property {(query: { text?: string, window?: object|null }) => Promise<SearchProviderResult>} search
 */

function assertNoLiveMedialystConfig(options) {
  const forbidden = ['apiKey', 'api_key', 'token', 'credentials', 'env'];
  for (const key of forbidden) {
    if (options && Object.prototype.hasOwnProperty.call(options, key)) {
      throw Object.assign(new Error('Medialyst credentials are not accepted'), { code: MEDIALYST_NOT_IMPLEMENTED });
    }
  }
}

export function createFixtureSearchProvider({ providerId = 'fixture:newsjack_shaped', hits = [], freshnessGrade = 'fixture' } = {}) {
  return {
    provider_id: providerId,
    provider_mode: 'fixture',
    freshness_grade: freshnessGrade,
    async search(query = {}) {
      return {
        provider_id: providerId,
        provider_mode: 'fixture',
        freshness_grade: freshnessGrade,
        query: query.text || null,
        window: query.window || null,
        hits: hits.map((hit) => ({ ...hit })),
        live: false
      };
    }
  };
}

export function createHostWebSearchProvider() {
  throw notImplemented('host_web_search');
}

export function createRssAtomSearchProvider() {
  throw notImplemented('rss_atom');
}

export function createSearchProvider({ mode, ...options } = {}) {
  if (mode === 'fixture') return createFixtureSearchProvider(options);
  if (mode === 'medialyst') return createMedialystSearchProvider(options);
  assertSearchProviderModeImplemented(mode);
  throw notImplemented(mode);
}

export function createMedialystSearchProvider(options = {}) {
  assertNoLiveMedialystConfig(options);
  return {
    provider_id: 'medialyst:news_search',
    provider_mode: 'medialyst',
    freshness_grade: 'deferred',
    deferred: true,
    async search() {
      throw Object.assign(
        new Error('Medialyst search is not implemented. Account, terms, credentials, and credit spend are deferred.'),
        { code: MEDIALYST_NOT_IMPLEMENTED, mode: 'medialyst' }
      );
    }
  };
}
