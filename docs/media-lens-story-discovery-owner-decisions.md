# Story discovery owner decisions

Date: 2026-09-25. This note records the decisions still required before Media Lens can show live cross-outlet coverage. It does not approve a source, enable a flag, or close Issue #118.

Vision check: **Aligns with constraints.** Relevant `VISION.md` sections: "Evidence comes before a score", "Uncertainty must be visible", "Privacy is the default architecture", "Analyze communication, not identity", and "Misuse resistance is a product requirement". The draft keeps discovery off, stores no article text, and does not score people or outlets. Live definition of done is not met.

## What shipped

`GET /stories` and `GET /stories/cluster/:id` return a `story-discovery.v1` document. Live retrieval runs only when `MEDIA_LENS_ENABLE_STORY_DISCOVERY` is the exact string `true` and the registry entry is `approved`. Neither is true in this repository. CI uses mocked feeds. Jev is not called. Article pages are not fetched. The operator Caddy site is unchanged, so ml-jev still does not proxy these routes.

## Candidate sources

All four entries are `candidate_pending_owner_approval`. None are approved. A public terms URL is listed so the owner can review it. Listing the URL is not a grant to index or display titles, URLs, and timestamps.

| source_id | Outlet | Feed | Terms page for review | Cost | Credentials |
| --- | --- | --- | --- | --- | --- |
| `npr-news` | NPR | `https://feeds.npr.org/1001/rss.xml` | `https://www.npr.org/about-npr/179876898/terms-of-use` | $0 if a later approval uses the public feed only | none |
| `bbc-news` | BBC News | `https://feeds.bbci.co.uk/news/rss.xml` | `https://www.bbc.com/usingthebbc/terms/` | $0 if a later approval uses the public feed only | none |
| `guardian-world` | The Guardian | `https://www.theguardian.com/world/rss` | `https://www.theguardian.com/info/about-guardian-content-licensing` | $0 if a later approval uses the public feed only | none |
| `nasa-news-releases` | NASA | `https://www.nasa.gov/news-release/feed/` | `https://www.nasa.gov/nasa-rss-feeds/` | $0 if a later approval uses the public feed only | none |

No candidate was fetched for this change. Bounded real-source verification was skipped because no terms page in this registry is treated as permission, and this task forbids new network discovery, credentials, and spend.

## Decisions needed before live coverage

1. Approve or reject each named feed. Approval has to cite the rights basis for storing and showing that outlet's titles, canonical URLs, and publication times in this non-commercial product.
2. Say whether any additional outlet is required before the comparison is broad enough to call the product goal met. Four candidates are not an approved set, and they may still be too narrow after approval.
3. Confirm retention: this worker keeps the discovery response in the HTTP response only (`privacy.retention` is `none`). Say if a longer retention period is wanted.
4. Confirm cost: $0 only if retrieval stays on free public feeds with no API key. A Newsjack, Medialyst, or other paid path is not approved and is not implemented here. No invoice was available to check.
5. Decide whether ml-jev should proxy `GET /stories` later. This change does not edit Caddy, `worker.env`, flags, or the host.

Until those decisions are recorded, story discovery stays not live. Article URL analysis does not substitute for it.

Related to #118. Issue #118 stays open.
