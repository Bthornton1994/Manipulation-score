# Newsjack license and attribution

Media Lens works with Newsjack, an unrelated open-source project. Its Newsjack seam (`media-lens/worker/adapters/newsjack.js`, `media-lens/worker/url-key.js`, part of `media-lens/worker/adapters/jev.js`, part of `media-lens/worker/fusion.js`, the capture contract in `media-lens/schema/newsjack-capture.js`, the converter in `media-lens/worker/discovery/newsjack-discovery.js`, and the operator tool in `media-lens/tools/`) reuses a small amount of behavior and output field names from Newsjack.

- Upstream: https://github.com/elvisun/newsjack
- Pinned release: `v0.1.19`, commit `bdb41b8d1f9a9e27221cc86102cbfe1a748fc123` (annotated tag object `8c20b879186363a939b1c4a7b626107d7df84c58`, not signed). The pin is recorded in `media-lens/worker/discovery/newsjack-pin.js`.
- License: MIT
- Copyright (c) 2026 Elvis Sun

No Go source files, skills prose, eval data, binaries, or branding from Newsjack are copied into this repository or redistributed with it. The files in `media-lens/fixtures/newsjack-capture/` are hand-written synthetic data in Newsjack's output shape, mostly on `.example` domains. Two exceptions are deliberate and covered by the MIT license and the attribution here: `raw-detector-mock-shape.json` and `raw-cluster-mock-shape.json` reproduce the strings and `https://example.com/news/<hash>` URLs that Newsjack's `--mock` mode emits (from `mockItems` in `detector_run.go`), and `tests/helpers/fake-newsjack.js` reimplements that mock URL and signal-id rule in JavaScript so the fake binary matches. Some fixtures also contain a `.internal` host or a `medialyst.ai` URL in error text, to test that they are refused or dropped.

Trademark: Newsjack's `TRADEMARK.md` at the pinned commit (blob `782ac8a6d87514281c8a4eca444ff3f84e61a206`) was reviewed on 2026-09-26. It reserves the name "newsjack", the newsjack.sh domain, and the logo, which the MIT license does not cover. It allows accurate references such as "works with newsjack" and developer documentation. It does not allow naming a fork or derivative product "newsjack" or "newsjack-*", using the logo, or implying endorsement. Media Lens uses the name only to refer to Newsjack accurately: in code, operator docs, data labels, the engine details panel (for example "Newsjack mode"), and public trust pages that say what the live preview does and does not read. It does not use the logo, name a product or fork after Newsjack, or imply endorsement.

Binaries: Media Lens never downloads, builds, bundles, or ships a Newsjack binary. The operator tool runs only a binary the operator supplies, and only when its sha256 matches a hash the owner has recorded in the pin (none is recorded yet). A statically linked Newsjack binary includes third-party Go modules (for example `modernc.org/sqlite` and `github.com/AlecAivazis/survey/v2`); anyone who redistributes such a binary must also carry those modules' license notices.

## What was ported (behavior only, reimplemented in JavaScript)

- **`media-lens/worker/url-key.js`** — `normalizedURLKey()` reimplements the URL-normalization behavior of Newsjack's `normalizedURLKey` in `apps/cli/cmd/newsjack/origin.go`: lowercase scheme/host, drop fragment, trim trailing slash, strip `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid` tracking parameters. The JavaScript implementation is independent; only the normalization rules are ported.
- **`media-lens/worker/adapters/jev.js`** — the retry/backoff attempt shape (bounded retries with exponential backoff on 429/5xx/transport errors) and the general layout of an `engine` disclosure block are adapted from the shape used in Newsjack's `coarse_filter.go`. The question set, request/response schema, and all code are Media Lens's own.
- **`media-lens/worker/fusion.js`** — the wire/advocacy URL path-marker list (`/press_release`, `/press-release`, `/applauds`, `/statement`, `advocacy.`, `prnewswire`, `globenewswire`, `businesswire`, `accesswire`, `einpresswire`, `markets.businessinsider`, `stocktitan`) is reused as a constant from Newsjack's `skills/story-origin-check/SKILL.md`.

## What is reused as a data contract only (field names, not code)

`media-lens/schema/influence-graph.v1.json` and the fixture reader in `media-lens/worker/adapters/newsjack.js` reuse these Newsjack field names verbatim. Real Newsjack v0.1.19 output is not read directly: `media-lens/tools/newsjack-raw.js` validates it against the pinned output shapes and projects it into `media-lens.newsjack-capture.v1`, and `media-lens/worker/discovery/newsjack-discovery.js` converts that into `story-discovery.v1`. The reused names:

- Story-origin handoff object fields: `same_story_assessment`, `surfaced_article_published_at`, `first_public_at`, `original_url`, `original_source`, `canonical_coverage_url`, `canonical_coverage_source`, `canonical_coverage_published_at`, `canonical_coverage_basis`, `same_story_basis`, `new_development`, `new_development_at`, `confidence`, `timestamp_evidence[]`, `evidence_urls[]`, `rationale`.
- Freshness status codes: `fresh`, `fresh_new_development`, `stale`, `unverified_boundary`, `unverified_no_timestamp`, `unverified_no_corroboration`.
- Newsjack emits no per-member relation. `newsjack cluster` records `role: "representative"`, `cluster_id`, and `member_ids`. The values `same_story`, `different_story`, `unclear`, and `fresh_new_development` belong to the agent-written `story_origin.same_story_assessment`. `syndicated` appears only as a news-search publication type that Newsjack filters out. Media Lens assigns its own member relations (`same_story` or `syndicated`) from its own rules.

## What is explicitly not used

- The Media Lens worker never spawns the Newsjack CLI. The adapter's old `cli` and `artifacts` modes were removed. Only the operator tool outside the worker (`scripts/newsjack-capture.js`) can run a pinned Newsjack binary, and it refuses to until a binary hash is recorded.
- Medialyst news search is never called by Media Lens, and no credential is ever passed to a Newsjack process.
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
