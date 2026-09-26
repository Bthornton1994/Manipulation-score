# Story discovery owner decisions

Date: 2026-09-25. This note records the decisions still required before Media Lens can show live cross-outlet coverage. It does not approve a source, enable a flag, or close Issue #118.

Vision check: **Aligns with constraints.** Relevant `VISION.md` sections: "Evidence comes before a score", "Uncertainty must be visible", "Privacy is the default architecture", "Analyze communication, not identity", and "Misuse resistance is a product requirement". The draft keeps discovery off, stores no article text, and does not score people or outlets. Live definition of done is not met.

## What shipped

`GET /stories` and `GET /stories/cluster/:id` return a `story-discovery.v1` document. Live retrieval runs only when `MEDIA_LENS_ENABLE_STORY_DISCOVERY` is the exact string `true` and the registry entry is `approved`. Neither is true in this repository. CI uses mocked feeds. Jev is not called. Article pages are not fetched. The operator Caddy site is unchanged, so ml-jev still does not proxy these routes.

`independent_reporting` is set only when the feed itself includes `mediaLens:originEvidence` with the value `first_independent_report`. That is a feed-supplied tag. In this repository it appears only in fixture XML. It is not an external evidence store, and this change does not add one.

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
3. Confirm retention. `privacy.retention` is `none` and full article text is not written to disk. The worker also keeps the latest discovery document in process memory (`latestDiscovery`) so a cluster open does not harvest again. That cache holds titles, canonical URLs, outlet names, and publication times for the latest response, for as long as the process runs. It is not full text and not a disk store. Confirm that in-process cache, or say it should be dropped.
4. Confirm cost: $0 only if retrieval stays on free public feeds with no API key. A Newsjack live run, Medialyst, or any other paid path is not approved and is not implemented. No invoice was available to check.
5. Decide whether ml-jev should proxy `GET /stories` later. This change does not edit Caddy, `worker.env`, flags, or the host.

Until those decisions are recorded, story discovery stays not live. Article URL analysis does not substitute for it.

## Newsjack decisions needed before any live Newsjack run

Newsjack is integrated as an operator tool outside the worker that runs a pinned binary and writes a versioned capture (`media-lens/docs/newsjack-discovery.md`). Newsjack's only news-search transport is Medialyst, so none of this yields live coverage until these are decided:

1. **Binary.** Choose how a v0.1.19 binary is obtained (source build at commit `bdb41b8d1f9a9e27221cc86102cbfe1a748fc123` with an exact Go 1.26 patch release, or a release asset or npm package checked against a second source), and record its sha256 in `media-lens/worker/discovery/newsjack-pin.js` in a reviewed change. Until then the tool refuses to run anything.
2. **Where it may run.** Whether the operator tool may run at all, on which host, and under which isolation (dedicated user, egress rules, container). It must not run on `ml-jev` beside the worker's secrets.
3. **Medialyst.** Account, terms, credential storage, spend limit, and the rights to store and show third-party titles, URLs, and times. No account, credential, or vendor acceptance exists, and the tool passes no credential to Newsjack.
4. **Origin findings.** Whether operator-supplied agent origin findings may be converted. They are shown only as unverified claims, and producing them involves an LLM agent fetching article pages.
5. **Retention.** How long capture files may be kept, and where.
6. **Display.** Whether captures may ever be served, including through `GET /stories` on `ml-jev`.
7. **Removed configuration.** Confirm removing `MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR` and the `/health` `newsjack.artifactsConfigured` field (the recorded `ml-jev` value was false, so host behavior does not change). If declined, both can return as unused values.
8. **Non-goal wording.** Confirm the narrowed non-goal "the worker never spawns the Newsjack CLI" in `docs/media-lens-influence-graph-plan.md` and `media-lens/README.md`. If declined, remove `media-lens/tools/newsjack-runner.js`, the `run` command in `scripts/newsjack-capture.js`, `tests/helpers/fake-newsjack.js`, and the runner tests; the capture contract and converter can stay.
9. **Upstream reports.** Whether to tell the Newsjack maintainer about the RSS `pubDate` key bug and the auto-update installer inheriting the full environment. That would be an external message and was not sent.

Related to #118. Issue #118 stays open.
