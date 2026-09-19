# Newsjack license and attribution

Media Lens's Newsjack substrate seam (`media-lens/worker/adapters/newsjack.js`, `media-lens/worker/url-key.js`, part of `media-lens/worker/adapters/jev.js`, and part of `media-lens/worker/fusion.js`) reuses a small amount of behavior and data-contract field names from Newsjack, an unrelated open-source project.

- Upstream: https://github.com/elvisun/newsjack
- Pinned reference commit: `bdb41b8d1f9a9e27221cc86102cbfe1a748fc123`
- License: MIT
- Copyright (c) 2026 Elvis Sun

No Go code, skills prose, fixtures, or branding from Newsjack is copied into this repository. Newsjack's `TRADEMARK.md` was not reviewed for this work, so the Newsjack name is used in code comments and this document only to describe provenance, not in end-user product copy beyond "provenance via Newsjack artifacts."

## What was ported (behavior only, reimplemented in JavaScript)

- **`media-lens/worker/url-key.js`** — `normalizedURLKey()` reimplements the URL-normalization behavior of Newsjack's `normalizedURLKey` in `apps/cli/cmd/newsjack/origin.go`: lowercase scheme/host, drop fragment, trim trailing slash, strip `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid` tracking parameters. The JavaScript implementation is independent; only the normalization rules are ported.
- **`media-lens/worker/adapters/jev.js`** — the retry/backoff attempt shape (bounded retries with exponential backoff on 429/5xx/transport errors) and the general layout of an `engine` disclosure block are adapted from the shape used in Newsjack's `coarse_filter.go`. The question set, request/response schema, and all code are Media Lens's own.
- **`media-lens/worker/fusion.js`** — the wire/advocacy URL path-marker list (`/press_release`, `/press-release`, `/applauds`, `/statement`, `advocacy.`, `prnewswire`, `globenewswire`, `businesswire`, `accesswire`, `einpresswire`, `markets.businessinsider`, `stocktitan`) is reused as a constant from Newsjack's `skills/story-origin-check/SKILL.md`.

## What is reused as a data contract only (field names, not code)

`media-lens/schema/influence-graph.v1.json` and `media-lens/worker/adapters/newsjack.js` reuse these Newsjack field names verbatim so that Newsjack run artifacts (`story_origin`, `freshness_gate`, cluster `members[]`) can be read by Media Lens without a translation layer:

- Story-origin handoff object fields: `same_story_assessment`, `surfaced_article_published_at`, `first_public_at`, `original_url`, `original_source`, `canonical_coverage_url`, `canonical_coverage_source`, `canonical_coverage_published_at`, `canonical_coverage_basis`, `same_story_basis`, `new_development`, `new_development_at`, `confidence`, `timestamp_evidence[]`, `evidence_urls[]`, `rationale`.
- Freshness status codes: `fresh`, `fresh_new_development`, `stale`, `unverified_boundary`, `unverified_no_timestamp`, `unverified_no_corroboration`.
- Cluster member relation values: `surfaced`, `same_story`, `syndicated`, `different_story`, `unclear`.

## What is explicitly not used

- The Newsjack CLI is never spawned by the Media Lens worker in v1. `media-lens/worker/adapters/newsjack.js`'s `cli` mode throws rather than shelling out.
- Medialyst news search is never called by the worker.
- Newsjack's coarse-filter question set (PR-relevance questions) is not reused; `media-lens/worker/jev/questions.v1.json` is an independent question set for the influence taxonomy in `docs/media-lens-build-brief.md`.

## MIT License text (Newsjack)

```
MIT License

Copyright (c) 2026 Elvis Sun

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
