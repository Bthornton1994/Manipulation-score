# Media Lens + influence-graph.v1: implementation plan (Phase 0 output)

Date: 2026-09-18 UTC. Branch: `cursor/media-lens-influence-graph`. Source of truth for product constraints: `docs/media-lens-build-brief.md`. This plan is written so an implementer can execute it without re-reading the whole repo. Where this plan and the brief disagree, the brief wins; where the brief and `VISION.md` disagree, stop and ask the owner.

Status of the conflict gate: one owner decision is required before Step 8 (privacy wording); nothing blocks Steps 2 to 7. See "Vision classification and conflict gate".

## 0. Repo facts the implementer needs

- Static site, no build step, no bundler. Plain ES modules served from the repo root. `python3 -m http.server 4173` for local preview. Node 20 in CI, Node 22 locally.
- Tests: `node --test tests/*.test.js` (320 passing on `main` at `ed0e8ad`). Tests are `node:test` files that mostly read source files and assert on text/structure; a few import `scoring.js` directly. New `tests/media-lens-*.test.js` files are picked up by the existing glob with no config change.
- Deploy: `.github/workflows/ci.yml` runs tests, then on `main` rsyncs the entire repo (minus `.git`, `.github`, `.venv`, `.cursor`, `tests`, `_site`) to GitHub Pages. Anything committed to the root ships to production on merge. This plan adds `media-lens/` to the rsync exclude list so nothing new is published (draft only, no deploy).
- Clarity private path: `analyze.html` + `app.js` + `scoring.js` + `safety.js` + `text-normalize.js` + `history-storage.js` + `ocr.js` + `ocr-clean.js`. Every inspected page (`analyze.html`, `methodology.html`, `privacy.html`, `limitations.html`, `acceptable-use.html`) ships `Content-Security-Policy` with `connect-src 'self'`. `tests/privacy-storage.test.js` already asserts no `fetch(` in `app.js`, `scoring.js`, `ocr.js`. `service-worker.js` ignores cross-origin requests and caches the Clarity app shell only.
- `tests/project.test.js` and `tests/trust-pages.test.js` constrain the trust pages: `terms/limitations/methodology/acceptable-use/accessibility/changelog.html` may not contain any `https://` host other than `manipulationscore.com`; `index.html` has a small external-host allowlist. Media Lens doc additions must therefore name TypeSafe/Jev and Newsjack in text without hyperlinks, or link to an in-repo page.
- Package deps are only `heic2any` and `tesseract.js` (vendored). Do not add a framework, database, or schema-validation dependency; nothing in this plan needs one.
- Newsjack (cloned at commit `bdb41b8d1f9a9e27221cc86102cbfe1a748fc123`, MIT, copyright 2026 Elvis Sun) is a Go CLI plus Markdown "skills" that run inside an LLM agent. Deterministic parts live in the CLI (`cluster`, `origin-apply`, `filter-apply`, `coarse-filter --engine jev`). Story-origin research and fact-check are agent skills that need an LLM with web retrieval; they cannot be called as a library. The CLI auto-updates from GitHub Releases before each run unless `NEWSJACK_AUTO_UPDATE=0`.
- TypeSafe/Jev (verified against `docs.typesafe.ai/primitives.md` on 2026-09-18): `POST {base}/v1/systemone` with `state` (any JSON) and `questions` (map of id to `{type, instructions, criteria}`), types `choice` (returns `choice`, `probabilities`, `confidence`), `score`, `noul` (returns `noul` 0 to 1, no confidence). All questions in one request see the same state and are evaluated independently and in parallel; batch every question for a span into one request. Request budget is roughly 32k tokens. Newsjack requests model `jev-latest` and the API reported `jev-1.13.0` on 2026-09-18. Bearer auth via `TYPESAFE_API_KEY` in Newsjack; we use our own env name so nothing shared leaks by accident.

## 1. Architecture decision

Decision: a local worker sidecar (`media-lens/worker/`, Node, `node:http`, no npm dependencies) owns all network, keys, limits, and fusion. Article HTML preparation calls pinned local Trafilatura 2.2.0 (Apache-2.0) on markup the worker already holds; that extractor does not fetch URLs and is not shipped in the browser bundle. The browser page `media-lens/index.html` is a thin renderer that talks only to that worker. The static PWA and every Clarity file stay byte-identical.

Why not the alternatives:

- Browser-direct calls to Jev/Newsjack: banned (keys in browser JS).
- Server-side function (Vercel/Cloudflare/etc.): needs new hosting, secrets management, and a deployment decision the owner has not made. The worker's `analyze()` function is written host-agnostic (pure function of `{input, adapters, config}`) so it can be mounted in a server function later without rewriting the pipeline. Out of scope for v1.
- Rewriting the PWA into an app framework: unnecessary; the UI is one page with four sections.

Where keys live: only in the worker process environment (`MEDIA_LENS_TYPESAFE_API_KEY`, `MEDIA_LENS_MEDIALYST_TOKEN` if ever used), read once in `worker/config.js`, never logged, never echoed by `/health`, never written to any file. `.env` is added to `.gitignore`. Browser files under `media-lens/*.js` never reference `process.env`, `api.typesafe.ai`, or `Authorization`.

Worker modes (`MEDIA_LENS_MODE`): `fixture` (default; no outbound network at all; Jev and Newsjack adapters read JSON fixtures), `live` (requires keys; refuses to start without them; v1 ships the client code but no test or default path exercises it). CI runs fixture mode only.

How the private Clarity path stays zero-network and never reaches Newsjack/Jev:

- No Clarity file imports anything from `media-lens/`; no `media-lens/` file imports `scoring.js`, `safety.js`, `app.js`, or `history-storage.js`. Enforced by `tests/media-lens-isolation.test.js`.
- `analyze.html` and `index.html` do not load Media Lens scripts. `analyze.html` CSP stays `connect-src 'self'`. Enforced by the same test.
- Media Lens has its own page with its own CSP: `connect-src 'self' http://127.0.0.1:8787 http://localhost:8787` and nothing else. The service worker ignores cross-origin requests, so worker traffic never touches the Clarity cache.
- The worker has no route that accepts Clarity output or reads `localStorage`; it is a separate process with a separate origin. The Media Lens page shows a persistent "public content only" notice and requires a per-session checkbox asserting the material is public before enabling analysis (see 7).

## 2. File and module layout

```
media-lens/
  README.md                          run instructions, modes, env names, disclosure text, limits
  index.html                         Media Lens UI page (own CSP; links back to ./)
  media-lens.js                      renderer: health check, submit, render four dimensions, export
  media-lens.css                     additions only; reuses ../styles.css tokens
  schema/influence-graph.v1.json     JSON Schema (documentation + fixture for tests)
  schema/validate.js                 hand-written validator incl. cross-field invariants (no deps)
  schema/taxonomy.js                 influence taxonomy ids, labels, plain-language explanations, allowed UI phrases
  worker/server.js                   node:http on 127.0.0.1:8787; GET /health, POST /analyze; size/timeout/rate limits
  worker/config.js                   env parsing, mode, limits, key presence (never values)
  worker/analyze.js                  pure pipeline: prepare -> newsjack -> jev -> fusion -> graph
  worker/prepare.js                  HTML to text, boilerplate strip, paragraph/sentence spans, span roles, claim candidates, paywall detection, injection hygiene
  worker/adapters/newsjack.js        seam: fixture | artifacts (import Newsjack run JSON) ; cli later
  worker/adapters/jev.js             seam: fixture | live; pinned model; retries; question-set hash
  worker/jev/questions.v1.json       our typed question set (same file format as Newsjack's coarse_filter_questions.json)
  worker/fusion.js                   typed answers -> observations, claims, coverage, abstentions (deterministic thresholds)
  worker/graph.js                    assemble influence-graph.v1; privacy/engine blocks; evidence-only span trimming for export
  worker/url-key.js                  URL normalization for duplicate detection (ported from Newsjack origin.go, attributed)
  worker/analyze-fixture.js          CLI: node media-lens/worker/analyze-fixture.js <fixture-id> -> prints graph JSON
  fixtures/articles/<id>.html        synthetic public-style articles (fictional outlets, people, events)
  fixtures/newsjack/<id>.json        story_origin + freshness_gate + cluster in Newsjack contract shapes
  fixtures/jev/<id>.answers.json     typed answers per span id, in TypeSafe answer shape
  fixtures/expected/<id>.graph.json  golden influence-graph.v1 output (engine.timestamps normalized)
tests/media-lens-*.test.js           see section 8
docs/NEWSJACK-LICENSE.md             MIT text + list of ported/derived files
```

Fixture ids for v1: `synthetic-01-quoted-vs-authorial`, `synthetic-02-syndicated-cluster`, `synthetic-03-no-timestamp`, `synthetic-04-injection`, `synthetic-05-paywall`, `synthetic-06-short-excerpt`. All fixture articles are invented; no real outlets, journalists, or politicians.

## 3. `influence-graph.v1` schema

Top-level object. Every field below is required unless marked optional; `null` is allowed only where stated.

```
schema: "influence-graph.v1"
graph_id: string (uuid)
generated_at: ISO-8601

artifact:
  kind: "article" | "headline" | "excerpt" | "speech" | "ad" | "campaign" | "other_public"
  input_mode: "url" | "pasted_text" | "fixture"
  url: string | null                 canonical_url: string | null
  title: string | null               byline: string | null      (metadata only; never a label target)
  publisher: { name: string | null, domain: string | null }
  published_at: ISO | "YYYY-MM-DD" | null      modified_at: same | null
  timestamp_precision: "time" | "date" | "none"
  language: "en" | "und"
  text_sha256: string                text_length_chars: integer
  paywall_detected: boolean          (true -> graph-level abstention "paywall"; never bypass)
  authorization: { user_asserted_public: boolean, consent_at: ISO | null }

spans[]:
  id, start, end (char offsets into prepared text), text, paragraph_index
  role: "headline" | "subhead" | "authorial" | "quoted" | "attributed_paraphrase" | "caption" | "byline_meta" | "boilerplate" | "uncertain"
  attribution: { speaker: string | null, cue: string | null }     (e.g. "said", "according to")
  role_basis: "quote_marks" | "blockquote" | "attribution_cue" | "html_structure" | "default" | "engine_disagreement"

observations[]:                      dimension Language (and selective-context candidates from Coverage)
  id, dimension: "language" | "coverage"
  signal: one of taxonomy ids (section 4)
  strength: "observed" | "candidate"
  localization: "span" | "unlocalized"        span_ids: string[]   (non-empty iff localization == "span")
  authorial_attribution: "authorial" | "quoted" | "mixed" | "unknown"   (derived from span roles; "quoted" is never presented as the author's own language)
  evidence: { engine: "jev" | "rule", question_id: string | null, top_probability: number | null, answers_ref: string | null }
  review_status: "auto" | "needs_review" | "unreviewed"
  ui_phrase: one of the allowed phrases in section 4

claims[]:
  id, span_ids (non-empty), text, kind: "statistic" | "event" | "attribution" | "prediction" | "evaluation" | "other"
  attribution: same enum as observations.authorial_attribution
  support: "supported" | "contradicted" | "mixed" | "unclear" | "not_checked"
  support_evidence[]: { url, source, published_at | null, note }      (must be non-empty unless support == "not_checked")
  review_status

coverage:
  status: "available" | "insufficient" | "not_requested"
  provenance: "fixture" | "newsjack_artifacts" | "newsjack_cli" | "none"
  story_origin: Newsjack story-origin-check handoff object, field names verbatim (same_story_assessment, surfaced_article_published_at, first_public_at, original_url, original_source, canonical_coverage_url, canonical_coverage_source, canonical_coverage_published_at, canonical_coverage_basis, same_story_basis, new_development, new_development_at, confidence, timestamp_evidence[], evidence_urls[], rationale) | null
  freshness_gate: { computed_status: "fresh" | "fresh_new_development" | "stale" | "unverified_boundary" | "unverified_no_timestamp" | "unverified_no_corroboration", basis_field, basis_value, rationale } | null
  cluster: { member_count, independent_sources_estimate, duplicate_or_syndicated_count,
             members[]: { url, url_key, source, published_at | null, relation: "surfaced" | "same_story" | "syndicated" | "different_story" | "unclear" } } | null
  frames[]: { label, member_urls[], basis: "headline_wording" | "lede_wording" | "fixture" }   (may be empty; never a bias label)
  confidence: "high" | "medium" | "low"

source_context:
  shown_separately: true (literal)
  publisher: same as artifact.publisher       canonical_domain: string | null
  metadata: { has_byline, has_published_time, has_canonical, syndication_markers: string[] }
  third_party_ratings: []   (empty in v1; see open question 2)
  note: "Source context is metadata, not a manipulation judgment."

abstentions[]:
  id, scope: "graph" | "dimension" | "span" | "claim", target: string | null   (dimension name or id)
  reason: "insufficient_text" | "paywall" | "unsupported_language" | "oversized_input" | "engine_disabled" | "engine_unavailable" | "engine_failure" | "model_mismatch" | "low_confidence" | "no_timestamp" | "no_provenance" | "prompt_injection_suspected"
  message: plain-language user-facing text

engine:
  pipeline_version: "media-lens-0.1.0"
  preparation: { version, extractor: "trafilatura" | "pasted" | "fixture", extractor_version, extraction_status, body_sha256, content_type, fetch_status, fetched_at }
  jev: { mode: "fixture" | "live" | "disabled", model_requested: "jev-1.13.0", model_reported: string | null, model_match: boolean | null,
         question_set: "influence-questions.v1", question_set_sha256, calls, failures, elapsed_ms }
  newsjack: { mode: "fixture" | "artifacts" | "cli" | "disabled", version: string | null, artifacts: string[] }
  fusion: { version, thresholds: { observed_min_probability: 0.60, candidate_min_probability: 0.45, quoted_agreement_min: 0.70, failure_rate_abstain: 0.20 } }
  timestamps: { started_at, completed_at }

privacy:
  external_processing[]: { recipient: "typesafe.ai (Jev)" | "newsjack CLI (local)" | "Medialyst news search", data_sent: string, occurred: boolean }
  clarity_isolation: "no_private_message_path" (literal)
  full_text_persisted: false (literal in v1)      spans_included: "all" | "evidence_only"
  retention: "none" (literal in v1)               disclosure_shown: boolean
```

Validator invariants (all enforced in `schema/validate.js`, all covered by `tests/media-lens-schema.test.js`):

1. Every observation has `localization == "span"` with at least one existing span id, or `localization == "unlocalized"` with empty `span_ids`. Unlocalized observations must be `strength: "candidate"`.
2. An observation whose spans are all `quoted` or `attributed_paraphrase` has `authorial_attribution: "quoted"` and `ui_phrase` "quoted language not attributed as authorial". Never `"authorial"` for a quoted-only span set.
3. Every claim has `support` in the enum; any value other than `not_checked` requires non-empty `support_evidence`.
4. `coverage.freshness_gate.computed_status` in `{fresh, fresh_new_development}` requires `coverage.provenance != "none"` and `story_origin.timestamp_evidence.length >= 2` with at least two distinct `url_key`s; otherwise the validator rewrites nothing but fails, and fusion must have emitted `unverified_no_corroboration`.
5. `artifact.timestamp_precision == "none"` requires an abstention with reason `no_timestamp` and `coverage.confidence == "low"`.
6. `engine.jev.model_match === false` requires every Jev-sourced observation to be `review_status: "needs_review"` and a `model_mismatch` abstention.
7. Forbidden keys anywhere in the document (recursive): any key matching `/score|rank|leaderboard|manipulat|trust|credib|reliab/i`. Forbidden strings in any `message` or `ui_phrase`: "manipulative", "proves", "misinformation", "unsafe", "propaganda".
8. `privacy.full_text_persisted === false` and `privacy.retention === "none"` in v1.
9. `source_context.third_party_ratings` is an empty array in v1.
10. No aggregate numeric field at graph, dimension, or artifact level.

## 4. Taxonomy, span roles, allowed UI language

Taxonomy ids (from the brief; `schema/taxonomy.js` carries label + one-sentence plain explanation each): `loaded_moralized`, `fear_threat`, `urgency`, `false_dilemma`, `identity_ingroup`, `scapegoating_dehumanizing`, `certainty_beyond_evidence`, `vague_authority`, `anecdote_generalization`, `selective_context_candidate`, `bandwagon`, `adversarial_conflict_framing`.

Rules: `selective_context_candidate` is only ever `strength: "candidate"`, only produced by fusion from Coverage evidence (two or more independent same-story members whose headline/lede spans differ on an entity or number) or from a quoted span whose attribution cue and speaker are both missing; never from a Jev answer alone. Jev answers about `certainty_beyond_evidence` and `vague_authority` produce `candidate` at most unless the span also contains a deterministic marker (absolute quantifier or unnamed-source cue).

Span roles are assigned deterministically in `prepare.js` (quote marks, `<blockquote>`, attribution cues within the sentence, `<h1>/<h2>/<figcaption>`). Jev answers a secondary `is_quoted_or_attributed` noul; if the deterministic role is `authorial` but `noul >= 0.70`, the role becomes `uncertain` with `role_basis: "engine_disagreement"`, and any observation on it gets `authorial_attribution: "unknown"` and `needs_review`. Jev is never the authority for authorship.

Allowed UI phrases (exact strings, the only ones the renderer may use for observation headers): "Observed influence signal", "Possible selective-context candidate", "Claim support unclear", "Quoted language not attributed as authorial", "Insufficient context". Banned phrases are asserted absent from `media-lens.js`, `index.html`, `taxonomy.js`, and every fixture message by `tests/media-lens-ui.test.js`.

## 5. Jev adapter: pinning, fixtures, mock, failure handling

- `worker/jev/questions.v1.json` uses the same on-disk format as Newsjack's `coarse_filter_questions.json` (`{ id: { type, instructions, criteria } }`) so a reviewer familiar with Newsjack can audit it. Content is ours; Newsjack's PR-relevance questions are not reusable.
- Per-span request state: `{ artifact: { kind, title }, span: { id, role, text }, context: { before: text | null, after: text | null } }` with `text` capped at 1,200 chars and neighbors at 400. Questions batched in one request: `influence_signal` (choice over 12 ids + `none`), `is_quoted_or_attributed` (noul), `is_checkable_claim` (noul), `claim_kind` (choice, speculative; ignored unless `is_checkable_claim >= 0.60`). Instructions reference `span.text` by path per TypeSafe guidance and must never include article text.
- Question-set hash: `sha256(JSON.stringify(questions, sortedKeys))` computed at startup; recorded in `engine.jev.question_set_sha256`; `tests/media-lens-jev-adapter.test.js` asserts the recorded value equals a constant committed in `questions.v1.json`'s sibling `questions.v1.sha256` and fails if the file changes without updating the constant.
- Pinning: request `model: "jev-1.13.0"`. If the API reports a different model, set `model_match: false`, mark all Jev observations `needs_review`, add abstention `model_mismatch`. See open question 4 on whether the API accepts a pinned id.
- Fixture mode: `fixtures/jev/<id>.answers.json` maps span id to a TypeSafe-shaped answers object (`{ influence_signal: { choice, probabilities, confidence }, is_quoted_or_attributed: { noul }, ... }`) plus `model_reported: "jev-1.13.0"`. Missing span id in the fixture is treated as an engine failure for that span (exercises the failure path without a network).
- Live client (shipped, not exercised by default): `POST /v1/systemone`, `Authorization: Bearer`, 8 s timeout, 4 attempts with exponential backoff on 429/5xx/transport errors, concurrency 4, per-analysis cap 200 spans. Ported from the retry shape in Newsjack `coarse_filter.go` (attributed).
- Failure policy: a failed span produces no observation and one abstention `engine_failure` scoped to that span. If failures exceed 20% of calls, the Language dimension is marked `unreviewed`: remove all Jev observations, add a dimension-scoped `engine_failure` abstention. Never invent a label. With `engine.jev.mode == "disabled"`, the Language dimension carries an `engine_disabled` abstention and deterministic-only candidates (quote roles, absolute quantifiers) may still appear as `candidate`.
- Live mode is only reachable when `MEDIA_LENS_MODE=live` and the key is present; `tests/media-lens-jev-adapter.test.js` exercises the HTTP client against a local `node:http` mock server via `MEDIA_LENS_TYPESAFE_BASE_URL`, never the real endpoint.

## 6. Newsjack substrate seam

Adapter interface (`worker/adapters/newsjack.js`): `getStoryContext({ url, canonical_url, title, published_at }) -> { story_origin, freshness_gate, cluster, provenance }` using Newsjack's contract shapes verbatim (section 3). Implementations:

- `fixture` (v1 default): reads `fixtures/newsjack/<id>.json`.
- `artifacts` (v1, thin): reads a Newsjack run directory produced out-of-band by an operator running the Newsjack detector/skills in their own agent (`candidates.json` with `story_origin` and `freshness_gate` attached by `newsjack origin-apply`, and `newsjack cluster` output). Matches the artifact's URL by `url-key.js`. This is how live provenance reaches Media Lens in v1 without the worker ever calling Medialyst or spawning anything.
- `cli` (later, not v1): spawn a pinned `newsjack` release with `NEWSJACK_AUTO_UPDATE=0`. Requires a Medialyst login for `news-search`; the story-origin skill still needs an agent runtime. Listed so the seam is not designed away.

Deterministic derivations in `fusion.js`, not in the adapter: `independent_sources_estimate` = number of distinct `url_key` groups after removing members with `relation: "syndicated"` and members whose URL matches the wire/advocacy path list from `story-origin-check/SKILL.md` (`/press_release`, `/press-release`, `/applauds`, `/statement`, `advocacy.`, `prnewswire`, `globenewswire`, `businesswire`, `accesswire`, `einpresswire`, `markets.businessinsider`, `stocktitan`) or a `partner_republication` host (AOL, Yahoo, MSN, Apple News) when a canonical/original points elsewhere. Freshness statuses are consumed as computed by Newsjack; Media Lens never computes its own cutoff.

Newsjack code intended to be copied or ported, and attribution:

- Port to JS: `normalizedURLKey` from `apps/cli/cmd/newsjack/origin.go` (lowercase scheme/host, drop fragment, trim trailing slash, strip `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`). File header in `worker/url-key.js`: "Ported from Newsjack (https://github.com/elvisun/newsjack) origin.go, commit bdb41b8, MIT License, Copyright (c) 2026 Elvis Sun."
- Port to JS: retry/backoff shape and `engine` disclosure block layout from `coarse_filter.go`. Same header in `worker/adapters/jev.js`.
- Reuse as data contracts (field names only): story-origin handoff object, freshness status codes, `engine` block fields. Documented in `docs/NEWSJACK-LICENSE.md`.
- Reuse the wire/advocacy path list from `story-origin-check/SKILL.md` as a constant in `fusion.js` with the same header.
- `docs/NEWSJACK-LICENSE.md` contains the full MIT text, the commit hash, and the list above. No Go code, skills prose, fixtures, or branding are copied. Newsjack's `TRADEMARK.md` was not reviewed for this plan; do not use the Newsjack name in UI copy beyond "provenance via Newsjack artifacts" until it is.

## 7. Preparation layer, limits, untrusted text

`prepare.js` accepts `{ mode: "url" | "pasted_text" | "fixture", url?, html?, text?, kind }`. In v1 the worker fetches a URL only in live mode; fixture mode reads `fixtures/articles/`. Steps: strip `<script>`, `<style>`, `<template>`, comments, and elements with `hidden`, `aria-hidden="true"`, or inline `display:none`; take `<article>` or the largest text-bearing block; collect `<meta property="article:published_time">`, `og:title`, `<link rel=canonical>`, `author` meta and JSON-LD `datePublished`/`dateModified` (parse only, never execute); detect paywall markers (`isAccessibleForFree: false`, truncated body under 400 chars with a subscription CTA) and abstain instead of retrying, using cookies, or AMP/cached mirrors; segment into paragraphs then sentences (reuse patterns similar to `text-normalize.js` but do not import it); assign roles; propose claim candidates (numerals, percentages, dates, "according to", "found that", "announced"); compute `text_sha256`.

Limits (config, enforced in `server.js` and `prepare.js`): request body 512 KB; prepared text 60,000 chars; 200 spans; 10 analyses per minute per worker; 8 s per Jev call; 30 s per analysis. Exceeding a limit yields HTTP 413/429 and a graph with a single `oversized_input` or `engine_unavailable` abstention rather than a partial result.

Prompt injection: article text is data only. It never enters `questions.*.instructions`, headers, URLs to fetch, file paths, or log lines. Jev returns typed answers only, so injected text cannot produce instructions; the residual risk is biased answers, so `fusion.js` flags spans matching an imperative-to-model pattern (`ignore (all|previous) instructions`, `you are an? (ai|assistant|model)`, `mark .* as (supported|true)`, `system prompt`) with a span-scoped `prompt_injection_suspected` abstention and drops any observation on that span to `candidate` + `needs_review`. Claim support is never set by any engine in v1, so injection cannot flip it.

Consent and disclosure in the UI: a non-dismissable notice states that Media Lens analyzes public material, may send prepared public text to an external typed classifier (TypeSafe Jev) when the worker runs in live mode, never stores full text by default, and is not the place for private messages (link to `../analyze.html`). A per-session checkbox "This is public material I am allowed to analyze" gates the submit button; its timestamp becomes `artifact.authorization.consent_at`. The worker rejects `/analyze` without `user_asserted_public: true`.

## 8. Required tests mapped to files

| Requirement | File | What it checks |
| --- | --- | --- |
| Clarity suite still passes | existing `tests/*.test.js` | unchanged; run the whole glob |
| Private path zero network | `tests/media-lens-isolation.test.js` | Clarity modules contain no `fetch(`/`XMLHttpRequest`/`sendBeacon`/`WebSocket`; no Clarity file imports `media-lens/`; no `media-lens/` file imports Clarity modules; `analyze.html` and `index.html` do not reference `media-lens/`; `analyze.html` CSP `connect-src 'self'` unchanged; runtime: import `scoring.js` with `globalThis.fetch` replaced by a throwing stub and run `analyzeMessage` on three inputs |
| No API key in browser bundle | `tests/media-lens-no-secrets.test.js` | walk every file the deploy job would publish; assert no `MEDIA_LENS_TYPESAFE_API_KEY`, `TYPESAFE_API_KEY`, `Authorization`, `api.typesafe.ai`, `medialyst` outside `media-lens/worker/`; `media-lens/*.js` and `index.html` have no `process.env`; `.gitignore` has `.env`; `ci.yml` excludes `media-lens/` from the Pages rsync |
| Quote vs authorial | `tests/media-lens-prepare.test.js`, `tests/media-lens-fusion.test.js` | fixture 01: quoted span role `quoted` with speaker/cue; observation on it has `authorial_attribution: "quoted"` and the quoted UI phrase; identical sentence outside quotes yields `authorial`; engine disagreement yields `uncertain` + `needs_review` |
| Observation to span or abstention | `tests/media-lens-schema.test.js`, `tests/media-lens-fusion.test.js` | invariant 1; a Jev answer with no resolvable span becomes `unlocalized` candidate or abstention, never a located `observed` |
| Claim support | `tests/media-lens-schema.test.js`, `tests/media-lens-fusion.test.js` | invariant 3; v1 fusion emits `not_checked` for every claim; a fixture with `unclear` + evidence validates; `supported` without evidence fails |
| Duplicates are not independent | `tests/media-lens-coverage.test.js` | fixture 02: 5 members, 2 syndicated + 1 wire => `independent_sources_estimate: 2`, `duplicate_or_syndicated_count: 3`; UI shows both numbers |
| Fresh story needs provenance | `tests/media-lens-coverage.test.js` | `fresh` with one `timestamp_evidence` URL => `unverified_no_corroboration`; `provenance: "none"` never yields `fresh`; UI text "Origin not yet corroborated" |
| Prompt injection inert | `tests/media-lens-injection.test.js` | fixture 04 vs the same article without the injected sentence: identical claims and `support`; only difference is a `prompt_injection_suspected` abstention and at most one `candidate` on that span; no question instructions contain article text (assert on the built request) |
| Missing timestamps => uncertainty | `tests/media-lens-coverage.test.js` | fixture 03: `timestamp_precision: "none"`, `no_timestamp` abstention, `coverage.confidence: "low"`, UI "Publication time not verified" |
| No full-text persist by default | `tests/media-lens-privacy.test.js` | run `analyze()` in a temp cwd and assert no files written; `privacy.full_text_persisted === false`; `media-lens.js` has no `localStorage`/`indexedDB`/`sessionStorage` writes; export path uses `spans_included: "evidence_only"` and omits non-evidence span text; `/health` response contains no env values |
| Worker contract | `tests/media-lens-worker.test.js` | start server on an ephemeral port in fixture mode; `/health` reports modes; `/analyze` returns a graph that validates; 413 on oversize; 400 without `user_asserted_public`; live mode without key refuses to start |
| Jev adapter | `tests/media-lens-jev-adapter.test.js` | fixture answers path; hash constant; mock HTTP: 429 then 200, malformed answer => failure, model mismatch => flagged; 21% failures => dimension `unreviewed` |
| Golden output | `tests/media-lens-golden.test.js` | each fixture id produces `fixtures/expected/<id>.graph.json` after normalizing `graph_id` and timestamps |
| A11y basics (static) | `tests/media-lens-ui.test.js` | skip link, single `<h1>`, four labelled `<section aria-labelledby>` for Language/Claims/Coverage/Source context, form controls with `<label for>`, `prefers-reduced-motion` rule present in `media-lens.css`, `@media (max-width: 768px)` rule present, no banned phrases, CSP present with only the two loopback origins in `connect-src` |
| A11y basics (manual, Step 7) | recorded in the PR body | keyboard-only run through consent, submit, expand evidence, export; focus visible; contrast check on the new status chips; reduced-motion OS setting honored |

## 9. Documentation updates (additive only; exact placement)

Constraint from `tests/project.test.js`: no external hyperlinks on these pages, and `media-lens/` is not a served page in v1, so name TypeSafe/Jev and Newsjack in plain text and describe the behavior inline. Note: `docs/*.md` is currently published to Pages by the rsync job; this plan does not change that, so the brief and this plan become public on merge unless the owner wants `docs/` excluded too.

- `privacy.html`: new `<h2>Media Lens (preview mode, separate from Clarity)</h2>` after "How analysis works": what it analyzes (public URLs and public text you are allowed to analyze), that a local worker or server adapter you run performs any external processing, which recipients can receive prepared public text in live mode (TypeSafe Jev typed classifier; Newsjack artifacts stay local), that full article text is not stored by default and retention is none, that private messages must not be entered, and that the Clarity analyzer path is unchanged. Owner decision required first: see conflict C1 about the existing universal sentences in "Summary" and "How analysis works".
- `methodology.html`: new `<h2>Media Lens influence graph (experimental, no score)</h2>` before "Current version and evaluation status": four dimensions, taxonomy list, span-tied evidence, quoted vs authorial rule, abstention-first, that Jev is a typed classifier and not an authority on intent, truth, outlet quality, or people; that results are regression-tested fixtures and no accuracy, bias-detection, or fact-checking claim is made. Must keep the existing "regression count, not a representative validation study" language applicable to Media Lens.
- `limitations.html`: new `<h2>Media Lens</h2>`: no score, does not fact-check in v1 (claims are `not_checked`), coverage depends on provenance artifacts, quoted-speech detection is heuristic, English only, not evidence of an outlet's or person's intent or reliability.
- `acceptable-use.html`: add a permitted-use bullet "Media literacy analysis of public articles, advertisements, speeches, and campaign materials through Media Lens, without paywall circumvention" and prohibited bullets "Publish rankings, leaderboards, or scores of outlets, journalists, or politicians derived from Media Lens output" and "Present Media Lens output as proof that content is misinformation or that a source is unsafe". Existing sentences are not edited; `tests/trust-pages.test.js` assertions stay valid.
- `changelog.html`: one entry under an "Unreleased" heading.
- `README.md`: "Media Lens (preview)" section with the two commands below and the statement that it is not deployed.
- `VISION.md`: not edited. Not authorized.

## 10. Smallest end-to-end vertical slice (build this first)

Goal: `node media-lens/worker/analyze-fixture.js synthetic-01-quoted-vs-authorial` prints a valid `influence-graph.v1` document, and `node --test tests/*.test.js` is green including the new schema, isolation, no-secrets, fusion (quote vs authorial), privacy, and golden tests.

Order inside the slice:

1. `schema/influence-graph.v1.json`, `schema/taxonomy.js`, `schema/validate.js`, `tests/media-lens-schema.test.js` with hand-written valid and invalid documents for every invariant.
2. `fixtures/articles/synthetic-01-quoted-vs-authorial.html`, `fixtures/jev/synthetic-01...answers.json`, `fixtures/newsjack/synthetic-01...json`.
3. `worker/prepare.js` (fixture path only), `worker/adapters/jev.js` (fixture mode only), `worker/adapters/newsjack.js` (fixture mode only), `worker/fusion.js`, `worker/graph.js`, `worker/analyze.js`, `worker/analyze-fixture.js`.
4. `tests/media-lens-isolation.test.js`, `tests/media-lens-no-secrets.test.js`, `tests/media-lens-privacy.test.js`, `tests/media-lens-fusion.test.js`, `tests/media-lens-golden.test.js`; `.gitignore` `.env`; `ci.yml` rsync exclude for `media-lens/`.
5. Commit. Then Steps 4 to 7 of the brief: remaining fixtures and coverage/injection/timestamp tests; `server.js` + worker test; live Jev client behind mock; `index.html` + `media-lens.js` + UI test; then Step 8 docs after the owner answers C1.

Commands for the implementer and reviewer:

```bash
node --test tests/*.test.js
node media-lens/worker/analyze-fixture.js synthetic-01-quoted-vs-authorial | node media-lens/schema/validate.js
MEDIA_LENS_MODE=fixture node media-lens/worker/server.js      # http://127.0.0.1:8787/health
python3 -m http.server 4173                                    # open http://localhost:4173/media-lens/
```

## 11. Explicitly out of scope for v1

- Any aggregate, per-article, per-outlet, or per-person numeric score, band, ranking, leaderboard, or share card.
- Live Jev or Medialyst/Newsjack calls in CI or by default; production keys anywhere in this repo.
- Server-side deployment of the worker; publishing `media-lens/` to GitHub Pages; any change to the Pages deploy other than excludes.
- Fact-checking: `claims[].support` is `not_checked` unless a fixture or imported artifact supplies evidence. Newsjack `fact-check` is an agent skill and is not integrated.
- Third-party outlet ratings, ownership databases, or bias labels in Source context.
- Spawning the Newsjack CLI; running Newsjack skills; Medialyst login.
- Media Lens history, accounts, sharing, or any persistence beyond the in-memory response.
- Non-English input, PDFs, video, audio, images/OCR for Media Lens.
- Any edit to Clarity files, `scoring.js`, `safety.js`, or Clarity methodology text.
- Browser extension, bookmarklet, or paywall/AMP/cache workarounds.

## 12. Vision classification and conflict gate

Per-item classification. Section names refer to `VISION.md` headings.

| Item | Classification | VISION.md section and constraint |
| --- | --- | --- |
| Separate Media Lens mode for public artifacts | Aligns with constraints | "Scope and non-goals" ("Manipulation Score may eventually support other artifacts ... every product must preserve evidence linkage, uncertainty, consent, privacy, and human decision authority"); "Analyze communication, not identity" lists article, advertisement, speech, campaign artifact as units of analysis. Constraint: artifact-level output only, no person field. |
| No 0 to 100 score in v1 | Aligns | "Evidence comes before a score"; "Decision tests" (resist making a number more authoritative than its evidence). |
| Span-tied observations, abstention first-class | Aligns | "Uncertainty must be visible" ("the responsible output is abstention"). |
| Quoted is not authorial | Aligns | "Uncertainty must be visible" names quotation as meaning-changing context. |
| Claims dimension with `not_checked` default | Aligns with constraints | "The responsibility we own" (does not determine truth). Constraint: never present `unclear`/`not_checked` as a falsity finding. |
| Coverage dimension (origin, duplication, frames) | Vision is silent | No section addresses provenance or clustering. Constraint adopted: frames are wording differences, never bias labels. |
| Source context shown separately, metadata only | Aligns with constraints | "Analyze communication, not identity"; "Misuse resistance". Constraint: no ratings in v1 (open question 2). |
| Local worker holding keys; external processing of public text in live mode | Aligns with constraints | "Privacy is the default architecture" ("Any future feature that transmits or stores ... content requires a clear user benefit, explicit informed consent, data minimization, a defined retention policy, and a safer alternative"). Constraints: consent checkbox, disclosure notice, evidence-only export, retention none, fixture/local mode as the safer alternative. Note the section's sentence is about message content; Media Lens sends public artifact text, never messages. |
| Clarity path unchanged and isolated by tests | Aligns | "Privacy is the default architecture" (core experience stays on-device). |
| Analyzing speeches/ads of public figures | Aligns with constraints | "Who we serve" ("not built for spectators scoring public figures ... or profiling named people"). Constraint: no per-person output, byline is metadata only, banned phrases enforced, no ranking. Residual tension noted in conflict report as T1. |
| Jev as typed classifier only | Aligns with constraints | "The responsibility we own" (no intent, diagnosis, truth). Constraint: deterministic post-rules, `needs_review` on failure, model pinned and recorded. |
| Prompt-injection hygiene, limits, no paywall bypass | Aligns | "Misuse resistance is a product requirement". |
| Additive privacy/methodology/limitations/acceptable-use text | Aligns with constraints | "Uncertainty must be visible" (limits shown where the result is encountered) and AGENTS.md ("Keep methodology claims synchronized with tested behavior"). Constraint: C1 below. |
| Excluding `media-lens/` from Pages deploy | Aligns | Draft-only posture; no vision section conflicts. |
| Newsjack MIT port with attribution | Vision is silent | Governed by `.cursor/rules/agent-tooling.mdc` (pin revision, keep adapters removable, tool output is not product truth). |

Conflicts requiring owner approval (quoted text is verbatim from the current file):

- C1 (`privacy.html`, "Summary" and "How analysis works"): "We do not operate accounts, servers that receive your pasted text, or analytics that track what you analyze." and "When you analyze a message, processing happens entirely in your browser using local JavaScript. Nothing is uploaded to Clarity or any third-party service for analysis." Proposed feature: Media Lens live mode sends prepared public article text (including text a user pasted into Media Lens) from a user- or operator-run worker to TypeSafe (Jev). An additive Media Lens section alone leaves these two universal sentences literally false for the Media Lens page of the same site. Resolution needs an owner decision: (a) approve scoping both sentences to Clarity (for example prefix "In Clarity, ..." and change "any third-party service" to "any third-party service by Clarity"), plus the additive section; or (b) restrict v1 Media Lens to fixture/local mode only, in which case the sentences remain true and only the additive section is needed. Steps 2 to 7 do not depend on this answer; Step 8 does.

No other exact conflicts were found with `VISION.md`, `acceptable-use.html`, or `methodology.html`. Tensions to record (not conflicts):

- T1 `VISION.md` "Who we serve": "The product is not built for spectators scoring public figures". Media Lens will be used on speeches and campaign material by public figures. Mitigated by no score, no person field, banned phrases, artifact-only framing; the owner should confirm this reading.
- T2 `acceptable-use.html` "Prohibited uses": "Upload or analyze content you do not have permission to review." Public articles are readable by design; paywalled content is abstained, not bypassed. The consent checkbox records the user's assertion.

## 13. Open questions that would materially change implementation

1. C1 above: scope the two privacy sentences to Clarity, or ship v1 Media Lens as fixture/local-only with no live external processing?
2. Source context: metadata only in v1 (recommended), or include third-party outlet ratings? Ratings would need a licensed source, a display that cannot be read as "source unsafe", and a vision decision; the schema keeps `third_party_ratings: []` either way.
3. Deploy posture: exclude all of `media-lens/` from GitHub Pages in v1 (recommended, matches "no deploy"), or publish the UI in a "worker required" state?
4. Model pinning: does the TypeSafe API accept `model: "jev-1.13.0"`? Newsjack sends `jev-latest` and reads the reported version. If pinned ids are rejected, the pin becomes "request `jev-latest`, assert reported == `jev-1.13.0`, else `needs_review` + `model_mismatch`". Either way the recorded fields are the same.
5. Live provenance path: import Newsjack run artifacts produced by an operator's agent (recommended for v1) versus spawning the Newsjack CLI (needs Go or a pinned release binary, Medialyst login, `NEWSJACK_AUTO_UPDATE=0`, and a separate supply-chain review per `agent-tooling.mdc`).
6. Pasted text in live mode: allow with the per-analysis consent checkbox (planned), or URL-only when external processing is on, to reduce the chance of private text reaching Jev?
