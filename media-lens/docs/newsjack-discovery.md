# Newsjack discovery integration

Related to #118. Issue #118 stays open.

Vision check: **Aligns with constraints.** Relevant `VISION.md` sections: "Evidence comes before a score", "Uncertainty must be visible", "Privacy is the default architecture", "Analyze communication, not identity", and "Misuse resistance is a product requirement". Nothing here scores an outlet or a person, runs a live search, or shows coverage publicly. The vision is silent on third-party news vendors and discovery tooling; `.cursor/rules/agent-tooling.mdc` governs the tooling side (pinned revision, sandboxed test, repository-owned contract, removable adapter) and authorizes no installs.

Media Lens works with Newsjack (https://github.com/elvisun/newsjack, MIT, Copyright (c) 2026 Elvis Sun). License, trademark, and attribution: `docs/NEWSJACK-LICENSE.md`.

## Decision

Newsjack is integrated as an **operator-run component that emits a versioned artifact Media Lens owns**. The operator tool reuses the mechanics of an isolated sibling process, but it lives outside the worker and the worker never imports it.

| Model | Verdict | Why |
| --- | --- | --- |
| Pinned package or dependency | Rejected | Newsjack is a Go CLI, not a library. The npm package is a wrapper around a native binary, so it would be the worker's first dependency and would put an executable beside the public worker. Go import is not possible: the module lives in `apps/cli`, needs Go 1.26, and has no `apps/cli/vX` tags. |
| Pinned git submodule | Rejected | It would pull about 4,300 files (about 4,000 of them eval data, including third-party headlines) and trademarked brand assets, and building needs Go 1.26, which CI does not have. A submodule gives source, not isolation. The commit is pinned in code instead. |
| Isolated sibling process spawned by the worker | Rejected for the worker | Technically feasible (one static binary; `cluster` and `origin-apply` run headless). But auto-update runs before those commands by default, the CLI reads `.env` files and credentials, it has no process-level timeout, and it needs OS-level isolation. Spawning it from the worker stays a non-goal. |
| Operator-run Newsjack emitting versioned artifacts | **Chosen** | Only a file boundary reaches Media Lens. The operator tool runs a pinned binary with strict process limits, validates every output against the pinned shapes, and writes `media-lens.newsjack-capture.v1`. Media Lens converts only a valid capture into `story-discovery.v1`. |

The worker is unchanged except for removals: live `/analyze` reads no Newsjack output (the adapter is `disabled` in live mode), the adapter keeps only `fixture` and `disabled`, and the removed `artifacts` mode's environment variable and `/health` field are gone. On `main` before this change, a live worker with `MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR` set ran an unguarded reader after Jev on `/analyze`; a malformed file returned `500` and the Jev calls already made were not counted in the budget. `tests/media-lens-newsjack-boundary.test.js` covers the fixed behavior.

## What upstream Newsjack can do without Medialyst

Reviewed from source at v0.1.19 (`bdb41b8d1f9a9e27221cc86102cbfe1a748fc123`) and at `main` `092d882fc69912622f620c50eb493afe625f99dc`, which differs only in Medialyst OAuth scope handling. Nothing here is from documentation alone.

- **News search is Medialyst only.** The CLI's only article search is `POST {MEDIALYST_API_BASE or https://medialyst.ai/api}/v1/news/search` with a Medialyst bearer token (an OAuth grant or an `mlst_` API key). Without a credential, `news_search` is dropped before collection and recorded as `unavailable`, and a query run whose requested sources are all unavailable exits with "No requested sources are available".
- **What still works without Medialyst is not news search.** Fixed RSS/Atom feeds the operator lists (no query filter; RSS 2.0 `pubDate` is never read at the pinned commit), Reddit and Hacker News query search (forums, not outlets), and X with a paid token (synthetic search URLs and fetch-time dates).
- **"Host web search" is not code.** It exists only as prose in Newsjack's agent skills, for an LLM agent to perform with its own tools.
- **Origin evidence is written by an LLM agent** following the story-origin-check skill, which tells the agent to fetch article pages. `origin-apply` only checks structure and computes freshness from the agent's timestamps; its corroboration gate is weaker than the skill describes.
- **Clustering is a deterministic heuristic**: a shared normalized URL, or title overlap of at least 0.6 with at least two shared significant tokens.
- **Provenance is thin**: no per-item retrieval time, no search-window object, no tool version, and no per-member relation in any output. The client profile is copied into every artifact.

**Missing transport:** a query-based news-article search provider with an owner-approved account, terms, credential storage, spend, and rights to store and show titles, URLs, and times. This change does not fake one. `host_web_search`, `rss_atom`, and `medialyst` stay `planned_not_implemented` in `media-lens/worker/discovery/search-provider.js`, and `SEARCH_PROVIDER_MODE_STATUS.medialyst` is the single approval point the runner and converter consult. A later approved provider plugs in there, or as its own `SearchProvider` whose normalizer reuses `classifySourceUrl`, `outletText`, and `parseProviderTimestamp`.

## Pin and supply chain

`media-lens/worker/discovery/newsjack-pin.js` is the single source of truth: v0.1.19, commit `bdb41b8d1f9a9e27221cc86102cbfe1a748fc123`, tag object `8c20b879186363a939b1c4a7b626107d7df84c58` (annotated, unsigned), the LICENSE and TRADEMARK blobs, the blob of every upstream file whose output shape or process behavior the Media Lens rules encode, and a per-platform binary sha256.

Tags are unsigned and can be moved, release assets can be re-cut, `checksums.txt` comes from the same origin as the binaries, tarballs are not byte-reproducible, and the version string does not identify the commit. So only the executed file's own sha256 identifies what ran. **Both binary hashes are null**, so no real binary can run through the tool until the owner records one in a reviewed change. Acceptable ways to obtain a binary to hash:

- **Source build** from the pinned commit with an exact Go 1.26 patch release: `CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags "-s -w -X main.version=v0.1.19" ./cmd/newsjack` in `apps/cli`. Record the sha256 and the Go version.
- **Release asset or npm platform package** at exact version 0.1.19, recorded only if it matches `checksums.txt` and a second, independent source (for example verified npm provenance, or a source build).

Install it outside `$NEWSJACK_HOME/bin`. Upgrades are one reviewed change: diff the reviewed files and `go.mod`/`go.sum` between the old and new commit, recheck auto-update, dotenv, and proxy behavior, update the pin and reset the binary hashes to null, update the raw rules and fixtures together (`tests/media-lens-newsjack-discovery.test.js` fails if the committed capture example drifts), and run the suite on Node 20 and 22. Captures made under an old pin are refused (`pin_mismatch`).

## The operator tool

`node scripts/newsjack-capture.js run --binary <abs path> --query "<public topic>" --out-dir <abs dir>` calls `runNewsjackCapture` in `media-lens/tools/newsjack-runner.js`. It is not a route, is not deployed with the worker, and is not run in CI with a real binary. In order, failing closed:

1. **Request policy.** One query of 3 to 120 characters and at most 12 words, refusing control characters, a leading `-`, `@`, URLs, `www.`, and runs of six or more digits. `--max-age-hours` 1 to 48 (default 24), `--lookback-days` 1 to 7, `--depth quick|default`, `--limit` 1 to 50. The output directory must be an existing absolute directory, not a symlink, and outside the repository.
2. **Mode gate.** `--live` is refused with `no_approved_transport` while Medialyst is not implemented, and with `live_credentials_not_supported` after that, because no credential is ever passed to the child.
3. **Host gates.** Refused when running as root (`running_as_root`) or when the worker's secrets file is readable (`worker_secrets_readable`).
4. **Binary gate.** The operator's file is copied into a private `0700` directory and executed only if the copy's sha256 equals the pinned hash (`binary_hash_unrecorded` today). `PATH` is never searched.
5. **Execution.** Only `version`, `detector run --mock --sources=news_search --no-x-news --no-x-trends --no-profile-feeds ... --topic=<query>`, `cluster`, and (with `--origin-findings`) `origin-apply --allow-missing`. Never `--save`, `--profile`, feed flags, `--run-time`, `update`, `login`, `setup`, `monitor`, `news`, or `coarse-filter`. Each child gets exactly this environment and nothing inherited: private `HOME`, `NEWSJACK_HOME`, `NEWSJACK_ROOT`, `NEWSJACK_WORKDIR`, and `NEWSJACK_STORE`; `NEWSJACK_IGNORE_DOTENV=1`; auto-update locked five ways (`NEWSJACK_AUTO_UPDATE=0`, `NEWSJACK_NO_AUTO_UPDATE=1`, the recursion guard, the npm distribution marker, and a binary outside `$NEWSJACK_HOME/bin`); an empty `PATH`; and all proxy variables set to a closed local port. Each step has a wall-clock limit that kills the whole process group and a 10 MiB stdout cap. stderr is counted, never read or kept.
6. **Validation and output.** Every output is checked against the pinned shapes (`media-lens/tools/newsjack-raw.js`), including cross-file binding. A capture is projected, validated, converted, and checked with `validateStoryDiscovery`, then both files are written atomically with mode `0600`. The temporary directory is removed on every path. Output is a code-only summary; queries, titles, stderr, and paths are never printed.

`node scripts/newsjack-capture.js convert <capture.json>` converts a capture file offline. Exit codes: 0 ok, 1 convert abstained, 2 usage, 3 refused, 4 process failure, 5 validation failure, 6 write failure.

This is not a sandbox. Before any live use the owner still needs a dedicated user, egress rules, and preferably a container, on a host that is not `ml-jev`.

## The capture contract

`media-lens/schema/newsjack-capture.js` defines `media-lens.newsjack-capture.v1`. It is strict at every level (unknown keys are refused), and `capture_id` is the sha256 of the canonical JSON of everything else. It records the pinned tool identity and binary hash, the runner mode (`fixture`, `mock`, or `live`), the request, the runner's own start and exit time for each step, Newsjack's detector clock, selection counts (scored, emitted, hygiene rejects, truncated evidence), per-source status with a reduced error class, signals with only `source`, `title`, `url`, `container`, `published_at`, and a copied-snippet flag, the clustering groups, and optional origin claims. Client profile data, excerpts, authors, engagement, raw error text, stores, and agent rationale are never written.

## Conversion into story-discovery.v1

`captureToStoryDiscovery(capture, { now })` in `media-lens/worker/discovery/newsjack-discovery.js` is pure. Nothing is invented:

| story-discovery.v1 | Source | Basis |
| --- | --- | --- |
| `retrieved_at`, every member's `retrieved_at`, `window.end` | runner's clock when the detector process exited | `runner_observed_detector_exit_upper_bound`; Newsjack has no per-item time |
| `window` | `max_age_hours` before `retrieved_at` | `media_lens_published_at_filter_from_max_age_hours`; undated and older items are excluded |
| `provenance.retrieval_interval` | Newsjack's detector start clock to the detector exit | lower and upper bound |
| `clusters[].cluster_id` | Newsjack's representative signal id | `newsjack_cluster_shared_url_or_title_overlap` |
| member `outlet` | evidence `container` | provider-reported publication name; URL-like, path-like, or empty names drop the item |
| member `canonical_url` | evidence `url` | public `https` only, never fetched, repeated URLs dropped |
| member `published_at` | evidence `published_at` | provider-reported, unverified; must have a time, Z or an offset, and at most millisecond precision |
| member `relation` | Media Lens rule | wire, press-release, or partner host: `syndicated`; otherwise `same_story` |
| `independent_reporting` | none | always empty: title overlap is not evidence of independence |
| `clusters[].origin_claims` | agent `story_origin` via `origin-apply` | labeled `authored_by: ai_agent_via_story_origin_skill`, `verification: unverified`; URLs with a query string are withheld; origin never changes membership |

Only `news_search` evidence can become a member. Every dropped item is counted on its source row by reason (`incomplete`, `non_https_url`, `non_public_url`, `duplicate_url`, `title_from_excerpt`, `source_kind_excluded`, `published_at_missing`, `published_at_date_only`, `published_at_precision`, `published_at_unparseable`, `published_at_rolled`, `published_at_after_retrieval`, `outside_window`) and listed without its URL. A group with no kept members produces no cluster and is counted in `provenance.clusters_without_members`. Mock and fixture captures are labeled `data_origin: fixture`. A live capture abstains (`newsjack_live_capture_not_supported`), a mock capture older than 48 hours abstains (`newsjack_capture_stale`), and an invalid capture abstains with the first error code. A real `--mock` run converts to `empty`, because Newsjack's mock dates carry no time.

Only public `https` URLs become links. `classifySourceUrl` applies the worker's `parseArticleUrl` policy and refuses names under `NON_PUBLIC_HOST_SUFFIXES` (special-use and private namespaces, wildcard loopback DNS services, and a cloud metadata host). This is a name check, not DNS resolution, which is safe here only because nothing is fetched.

## What is not verified

- The fixtures in `media-lens/fixtures/newsjack-capture/` are hand-written from the pinned source. They were not produced by a Newsjack binary, and no Newsjack binary was built, downloaded, or run for this change.
- No live Newsjack run, Medialyst call, feed fetch, or search was made.
- Whether Media Lens may store or show third-party titles, URLs, and times from Medialyst or any other provider.

## Owner decisions needed

Listed in `docs/media-lens-story-discovery-owner-decisions.md`: a binary acquisition channel and recorded hash, whether and where the operator tool may run, Medialyst approval (account, terms, credentials, spend, data rights), whether agent origin findings may be supplied, capture retention, serving captures or `/stories` on `ml-jev`, confirmation of the removed environment variable and `/health` field, and confirmation that the non-goal now reads "the worker never spawns the Newsjack CLI".
