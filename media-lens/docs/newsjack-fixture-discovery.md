# Newsjack-shaped fixture discovery

Vision check: **Aligns with constraints.** Relevant `VISION.md` sections: "Evidence comes before a score", "Uncertainty must be visible", and "Privacy is the default architecture". This slice maps fixture evidence into `story-discovery.v1`. It does not score outlets, fetch live sources, or enable public display.

Related to #118. Issue #118 stays open.

## What this slice proves with fixtures

`media-lens/worker/discovery/search-provider.js` defines a provider-neutral hit (`title`, `url`, `outlet`, optional `author`, `published_at` or null). `createFixtureSearchProvider` returns those hits in-process. `createMedialystSearchProvider` throws `NOT_IMPLEMENTED` and refuses credential fields. It does not read environment variables or call a network.

`mapNewsjackEvidenceToStoryDiscovery` stamps `retrieved_at` from the caller. It copies `published_at` only when the value is a UTC ISO timestamp. Otherwise the member keeps `published_at: null`. `coverage_gap` stays `null`. `frames` stays `[]`. `privacy.jev_used` and `privacy.full_text_persisted` stay false.

Cluster basis for this path is `newsjack_cluster_same_public_event`. Newsjack `surfaced` becomes `same_story` with `labeling_basis` `newsjack_relation_surfaced` unless recorded origin evidence has two distinct dated non-wire URLs and the member is one of them. That case uses `independent_reporting` and `newsjack_origin_two_independent_urls`. Wire, press-release, and partner URLs use `syndicated` / `wire_press_release_or_partner_url`. A repeated canonical URL uses `syndicated` / `same_canonical_url`. An explicit Newsjack `syndicated` relation uses `newsjack_relation_syndicated`. `unclear` origin or relation stays `same_story` / `newsjack_origin_uncertain`.

`createNewsjackAdapter(...).discoverStoryDocument` reads fixture JSON or an operator artifact directory (`clustered_candidates.json` or `cluster.json`, plus `origin_findings.json` or `story_origin.json`). `cli` mode still throws. `getStoryContext` is unchanged. `GET /stories` is unchanged and stays default-off.

## Still unverified (needs a live provider and a rights decision)

- Host web search and RSS/Atom retrieval are not implemented on this provider. No feed was fetched.
- Medialyst account, terms, credentials, SDK, and credit spend are not implemented.
- Whether Media Lens may store or show third-party titles, canonical URLs, and publication times from host search or named feeds.
- Real Newsjack `published_at` recovery, cluster quality, and origin corroboration on live pages.
- `data_origin: "newsjack_artifacts"` is emitted for the artifact read path. The story-discovery validator allows it today because it does not enumerate `data_origin`. Treating it as a production source label still needs an owner note.
- Public `/stories` display, source approval, retention of `latestDiscovery`, and ml-jev proxying. Those remain the decisions in `docs/media-lens-story-discovery-owner-decisions.md`.

Do not describe fixture passes as live coverage or as Medialyst-grade freshness.
