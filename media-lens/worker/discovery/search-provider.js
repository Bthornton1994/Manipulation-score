// Provider-neutral search boundary for story discovery.
// Implementations return hits. They do not fetch article pages, score
// coverage, or decide independence. Medialyst is a deferred seam only:
// this module does not load an SDK, read credentials, or open a network.

export const MEDIALYST_NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';

export const SEARCH_PROVIDER_MODES = Object.freeze([
  'fixture',
  'host_web_search',
  'rss_atom',
  'medialyst'
]);

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
        { code: MEDIALYST_NOT_IMPLEMENTED }
      );
    }
  };
}
