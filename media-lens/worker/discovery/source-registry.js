// Candidate feed registry for Media Lens story discovery.
//
// Every entry is candidate_pending_owner_approval until an owner records a
// rights basis that clearly permits this product to index and display that
// source's titles, canonical URLs, and timestamps. Pending entries are never
// fetched. This module does no I/O.

export const APPROVAL_CANDIDATE = 'candidate_pending_owner_approval';
export const APPROVAL_APPROVED = 'approved';

const GRANT_NOT_ESTABLISHED =
  'Public terms page is listed for owner review. This registry does not treat that page as permission to index or display titles, URLs, and timestamps.';

export const SOURCE_REGISTRY = Object.freeze([
  Object.freeze({
    source_id: 'npr-news',
    outlet: 'NPR',
    feed_url: 'https://feeds.npr.org/1001/rss.xml',
    feed_host: 'feeds.npr.org',
    format: 'rss',
    approval_status: APPROVAL_CANDIDATE,
    permission_basis: GRANT_NOT_ESTABLISHED,
    terms_url: 'https://www.npr.org/about-npr/179876898/terms-of-use',
    cost_usd: 0,
    credentials: 'none'
  }),
  Object.freeze({
    source_id: 'bbc-news',
    outlet: 'BBC News',
    feed_url: 'https://feeds.bbci.co.uk/news/rss.xml',
    feed_host: 'feeds.bbci.co.uk',
    format: 'rss',
    approval_status: APPROVAL_CANDIDATE,
    permission_basis: GRANT_NOT_ESTABLISHED,
    terms_url: 'https://www.bbc.com/usingthebbc/terms/',
    cost_usd: 0,
    credentials: 'none'
  }),
  Object.freeze({
    source_id: 'guardian-world',
    outlet: 'The Guardian',
    feed_url: 'https://www.theguardian.com/world/rss',
    feed_host: 'www.theguardian.com',
    format: 'rss',
    approval_status: APPROVAL_CANDIDATE,
    permission_basis: GRANT_NOT_ESTABLISHED,
    terms_url: 'https://www.theguardian.com/info/about-guardian-content-licensing',
    cost_usd: 0,
    credentials: 'none'
  }),
  Object.freeze({
    source_id: 'nasa-news-releases',
    outlet: 'NASA',
    feed_url: 'https://www.nasa.gov/news-release/feed/',
    feed_host: 'www.nasa.gov',
    format: 'rss',
    approval_status: APPROVAL_CANDIDATE,
    permission_basis:
      'NASA news releases are U.S. government works and are generally not copyrighted, but this registry still requires an owner decision before Media Lens fetches or displays them. ' +
      GRANT_NOT_ESTABLISHED,
    terms_url: 'https://www.nasa.gov/nasa-rss-feeds/',
    cost_usd: 0,
    credentials: 'none'
  })
]);

export function approvedSources(registry = SOURCE_REGISTRY) {
  return registry.filter((source) => source.approval_status === APPROVAL_APPROVED);
}

export function candidateSources(registry = SOURCE_REGISTRY) {
  return registry.filter((source) => source.approval_status === APPROVAL_CANDIDATE);
}

export function registrySummary(registry = SOURCE_REGISTRY) {
  return {
    approvedSourceCount: approvedSources(registry).length,
    candidateSourceCount: candidateSources(registry).length,
    sourceIds: registry.map((source) => source.source_id)
  };
}
