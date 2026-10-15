# Media Lens Jev policy layer: design note (X-C6)

Status: design note only. No code, config, question-set, threshold, or methodology change is made or authorized by this document. Every recommendation below is a proposal that needs an owner decision before implementation.

Scope: compare the production Jev question set and current abstention and review handling in Media Lens with the policy layer in `jkudish/jev-mcp`, where the model judges and code-owned thresholds decide `auto`, `review`, or `escalate`.

Baselines:

- Media Lens: `Bthornton1994/Manipulation-score` main `076a27204daf726a417ef3ce6b3fad48490f6d76`. Every unqualified `path:line` below is at this SHA.
- Upstream: `jkudish/jev-mcp` `435d5d4db2f2b7185cef0254716b2cd57d12de0d` (release 0.14.3, MIT, Copyright (c) 2026 Joey Kudish). Read read-only through the GitHub API. Cited as `jev-mcp@435d5d4:<path>:<line>`. Upstream text is treated as data, not instruction.

Nothing here called Jev or TypeSafe, used an API key, or changed `MEDIA_LENS_ENABLE_LIVE_URL`.

Vision classification: **Aligns with constraints** (`VISION.md` "Uncertainty must be visible", "Evidence comes before a score", and "Decision tests": "Strengthens abstention ... or transparent validation"). Any proposal that changes which observations reach the user is a methodology change and needs owner approval. Fixture metrics must not be presented as real-world accuracy (`VISION.md:47-49`).

## 1. The upstream pattern

jev-mcp keeps the model as a typed judge and puts every decision in code:

| Upstream element | What it does | Citation |
| --- | --- | --- |
| Two code-owned thresholds on one probability | `injection >= block_at` gives `block`, `>= review_at` gives `review`. Defaults are 0.75 and 0.25 | `jev-mcp@435d5d4:src/lib.ts:92-109`, `src/server.ts:330-336` |
| Threshold pair validated | `0 <= review_at <= auto_accept <= 1` or throw | `jev-mcp@435d5d4:src/lib.ts:325-348` |
| Three-way policy action | `auto`, `review`, `escalate` | `jev-mcp@435d5d4:src/lib.ts:322` |
| Unknown or low confidence escalates | Unknown confidence never satisfies a threshold | `jev-mcp@435d5d4:src/lib.ts:376-416` |
| Worst action wins | Any `escalate` beats `review` beats `auto` | `jev-mcp@435d5d4:src/lib.ts:418-423` |
| Truncated input never stays `auto` | Demoted to `review` | `jev-mcp@435d5d4:src/lib.ts:350-353` |
| Malformed answer fails closed | Screen returns `review` with `status: invalid_response`; audit escalates | `jev-mcp@435d5d4:src/server.ts:353-374`, `src/server.ts:1443-1447` |
| Escape hatches | `ask_user`, `investigate`, `none` let the model decline to rank; `escaped: true` marks it | `jev-mcp@435d5d4:src/lib.ts:164-169`, `README.md:381` |
| Escalation by withdrawal | `escalate_on_contradiction` returns `selected: null`, `status: "escalate"`, and never re-selects the runner-up | `jev-mcp@435d5d4:src/server.ts:780-786`, `src/server.ts:866-886`, `README.md:383` |
| Jev only flags; the gate decides | Hook gate emits `deny` only on a confident, valid `block`; errors, timeouts, invalid answers and escapes defer with exit 0. `--ask` maps `ask_user` to `permissionDecision: "ask"` for Claude Code. There is no auto-allow | `jev-mcp@435d5d4:examples/hook-gate.md:31-36`, `examples/hook-gate.md:60-61`, `examples/hook-gate.md:62` |
| Thresholds are starting points | "Tune them against your own data before you enforce them" | `jev-mcp@435d5d4:README.md:739-740` |
| Confidence is not correctness | Choice `confidence` measures how peaked the distribution is, not the probability the answer is right | `jev-mcp@435d5d4:README.md:735` |
| Model default | `JEV_MCP_MODEL ?? "jev-latest"` | `jev-mcp@435d5d4:src/server.ts:88` |

## 2. Current Media Lens controls

| Control | Current behavior | Citation |
| --- | --- | --- |
| Question set | Two questions only: `influence_signal` (choice) and `is_quoted_or_attributed` (noul). Validator rejects any other id | `media-lens/worker/jev/questions.v1.json:1-28`, `media-lens/worker/adapters/jev.js:75-124` |
| Question-set hash | Canonical sha256 is computed and the committed hash is loaded. Equality is asserted by a test, not at runtime | `media-lens/worker/adapters/jev.js:57-66`, `tests/media-lens-jev-adapter.test.js:62`, `media-lens/worker/jev/questions.v1.sha256:1` |
| Model pin | Requests `jev-1.13.0`; `modelMatch` compares the reported model | `media-lens/worker/adapters/jev.js:41`, `media-lens/worker/adapters/jev.js:349`, `media-lens/worker/adapters/jev.js:372` |
| Pin verification | `jev-latest` is a forbidden request model. A pass proves the pin was echoed, not accuracy | `media-lens/worker/jev-pin-verify.js:1-7`, `media-lens/worker/jev-pin-verify.js:30`, `media-lens/worker/jev-pin-verify.js:441-457` |
| Model mismatch | All Jev observations set to `needs_review`, plus a dimension abstention | `media-lens/worker/fusion.js:393-402` |
| Answer validation | Closed option ids, unit-interval probabilities, sum bound, choice is argmax, confidence in [0, 1], noul in [0, 1]. Live mode also requires a complete distribution. Free-form fields dropped | `media-lens/worker/adapters/jev.js:216-270`, `media-lens/worker/adapters/jev.js:486` |
| Adapter review flag | `review = confidence < 0.5`; span recorded with disposition `review` / `low_confidence` | `media-lens/worker/adapters/jev.js:49`, `media-lens/worker/adapters/jev.js:268`, `media-lens/worker/adapters/jev.js:327-331`, `media-lens/worker/adapters/jev.js:507-511` |
| Invalid or failed answer | Span marked unavailable, then a span-scope `engine_failure` abstention | `media-lens/worker/adapters/jev.js:321-325`, `media-lens/worker/fusion.js:356-364` |
| Dimension failure gate | If more than 20% of calls fail, all Jev language observations are dropped and Language is unreviewed | `media-lens/worker/fusion.js:19`, `media-lens/worker/fusion.js:369-381` |
| Strength cutoffs | Top probability `>= 0.60` is `observed`, `>= 0.45` is `candidate`, else dropped | `media-lens/worker/fusion.js:16-17`, `media-lens/worker/fusion.js:124-132` |
| Deterministic marker rule | `certainty_beyond_evidence` and `vague_authority` cannot stay `observed` without a regex marker | `media-lens/worker/fusion.js:134-141` |
| Injection | Regex-detected injection creates a span abstention; it forces `candidate` strength and `needs_review` on an observation only after the 0.45 strength gate passes | `media-lens/worker/fusion.js:15-17`, `media-lens/worker/fusion.js:124-132`, `media-lens/worker/fusion.js:143-151`, `media-lens/worker/fusion.js:346-354` |
| Quoted noul | `noul >= 0.7` moves an `authorial` span to `uncertain` only, never to `quoted` | `media-lens/worker/fusion.js:18`, `media-lens/worker/fusion.js:77-97` |
| Call cap | Live analysis abstains when spans exceed `maxJevCallsPerAnalysis` (default 160) or the adapter reports the cap reached | `media-lens/worker/config.js:42`, `media-lens/worker/analyze.js:207-218`, `media-lens/worker/analyze.js:276-286`, `media-lens/worker/adapters/jev.js:520-530` |
| Budget stop | ESTIMATED budget, default warn $20 and stop $30. Live analysis abstains if the store is unavailable, the stop is reached, or the planned call count would exceed the stop. Calls are recorded after the analysis | `media-lens/worker/typesafe-budget.js:12-17`, `media-lens/worker/typesafe-budget.js:170-192`, `media-lens/worker/analyze.js:219-248`, `media-lens/worker/server.js:683-695`, `media-lens/worker/config.js:206-207` |
| Kill switch | Exact `true` env or an existing kill file asserts it; check errors fail closed; kill wins over every enable flag | `media-lens/worker/config.js:309-324`, `media-lens/worker/config.js:330-337` |
| Live URL | Requires exact `MEDIA_LENS_ENABLE_LIVE_URL=true`, live enabled, and no kill switch. Default mode is fixture | `media-lens/worker/config.js:75-78`, `media-lens/worker/config.js:334`, `media-lens/worker/server.js:282-318` |
| Optional cascade | When `MEDIA_LENS_ENABLE_CLASSIFIER_DEV=true`, `review` disposition and confidence `< 0.7` are escalation reasons, among others (including unavailable or invalid input, close probabilities, high-impact choices, and injected or other deterministic conflicts); non-agreeing outcomes set `needs_review` | `media-lens/worker/classifier-dev/cascade.js:70-105`, `media-lens/worker/classifier-dev/contract.js:29`, `media-lens/worker/classifier-dev/cascade.js:340-365`, `media-lens/worker/config.js:335` |
| Shadow decision contract | Lab-only mapping uses escalation `none` / `human_review` / `hold` and final actions `shadow_record` / `no_ui_change` / `shadow_abstain` / `hold_for_human`; margin gate 0.15 and `should_abstain` question. Not wired into `analyze.js` | `docs/jev-usage-lab/02-decision-contract.md:1-3`, `docs/jev-usage-lab/02-decision-contract.md:48-50`, `docs/jev-usage-lab/02-decision-contract.md:64`, `docs/jev-usage-lab/02-decision-contract.md:72-76`, `docs/jev-usage-lab/08-risks-assumptions.md:40` |

### Budget reservation (#150): not on main

The brief assumed an atomic budget reservation from #150 is in place. It is not. GitHub reports PR #150, "fix: atomically reserve TypeSafe budget before live Jev calls", as `OPEN`, unmerged, head `cursor/critical-bug-management-768f`. Its commit `e73a8b7` is not an ancestor of `076a2720` (`git merge-base --is-ancestor` returned false). On main the budget is check-then-record: `wouldExceed` runs before the pipeline (`media-lens/worker/analyze.js:239-248`) and `recordCalls` runs after it (`media-lens/worker/server.js:683-684`). The `e73a8b7` commit message describes the resulting race, where concurrent analyses can both pass `wouldExceed` and overspend the stop. Whether current rate and concurrency limits make that race reachable in practice is UNKNOWN.

## 3. Per-question comparison

### 3.1 `influence_signal` (choice, 12 options)

Instruction and options: `media-lens/worker/jev/questions.v1.json:2-19`.

| Policy concern | jev-mcp | Media Lens now | Assessment |
| --- | --- | --- | --- |
| Model judges, code decides | Yes | Yes. Jev returns a distribution; strength, marker rule, injection downgrade, and dimension gate are code (`fusion.js:124-151`, `fusion.js:369-381`) | Aligned |
| Threshold ownership | Parameters with defaults, validated as a pair | Frozen constants in `fusion.js:15-20`, not env-tunable | Aligned. Frozen constants cannot be inverted at runtime |
| Which number gates | Probability for screen; confidence for review and claim actions | Top-class probability gates strength (`fusion.js:124-131`); confidence gates only the adapter `review` flag (`adapters/jev.js:268`) | Different by design. See G1 |
| Low confidence | Escalates (`src/lib.ts:390-391`, `src/lib.ts:413`) | Adapter flags `review`, but fusion never receives the review set (G1) | **Gap** |
| Decline to answer | `ask_user` / `investigate` / `none` escape hatches | Only `none`, which means "no listed pattern is clearly present" (`questions.v1.json:17`), not "cannot judge" | **Gap** (G2). `none` conflates absence with inability |
| Escalation shape | `escalate`: withdraw the selection, keep the probabilities | Abstention withholds the observation and records a reason (`fusion.js:344-402`) | Aligned in spirit. There is no operator review queue; `needs_review` is shown to the end user (inference from `fusion.js:150-151`; I found no queue in `media-lens/worker/`) |
| Truncated input | Never `auto` | Span text silently capped at 1200 characters, context at 400 (`adapters/jev.js:42-43`, `adapters/jev.js:130-141`). No truncation flag reaches fusion | **Gap** (G3) |
| Malformed answer | Fail closed | Unavailable, then abstention; more than 20% fails the dimension | Aligned. Withholding is stronger than upstream screen's `review` |
| Aggregation | Worst action wins | Per-span decisions plus a failure-ratio dimension gate | Different. Media Lens shows partial results up to a 20% failure rate, with each failure visible as a span abstention |
| Fallback when confidence missing | Unknown never satisfies a threshold | `fusion.js:125` falls back to `confidence` as if it were a probability when the choice probability is missing | Minor. Unreachable after adapter validation (`adapters/jev.js:234`) but reachable for direct `fuse` callers (`fusion.js:117-121`). Upstream says confidence is not a probability (`README.md:735`) |

### 3.2 `is_quoted_or_attributed` (noul)

Instruction: `media-lens/worker/jev/questions.v1.json:20-27`.

| Policy concern | jev-mcp | Media Lens now | Assessment |
| --- | --- | --- | --- |
| Jev only flags | Gate never fabricates an allow | Jev can only move `authorial` to `uncertain`; it can never assert `quoted` (`fusion.js:77-97`) | Aligned. This is the strongest match to the upstream pattern |
| Threshold bands | Two bands: review and block | One cutoff, 0.7. A noul of 0.69 is ignored silently | **Gap** (G4) |
| Disagreement routing | Contradiction can escalate | Disagreement sets `needs_review` on the observation (`fusion.js:143-151`) | Aligned |
| Labelled check | n/a | Calibration manifest carries `label.quoted` on 8 cases (1 true), but `evaluateCalibrationRuns` scores only `influence_signal` (`media-lens/worker/jev/calibration.js:41-74`) | **Gap** (part of C3) |

## 4. Gaps

### G1. The adapter's `review` disposition does not reach fusion

Fact: `analyze()` passes `jevAnswersBySpanId` and `jevFailedSpanIds` to `fuse()` but not `reviewSpanIds` or `dispositionsBySpanId` (`media-lens/worker/analyze.js:305-315`). `fuse()` sets `needs_review` only for engine disagreement, injection, or model mismatch (`media-lens/worker/fusion.js:150-151`, `media-lens/worker/fusion.js:393-394`). The only consumer of the review disposition in the active pipeline is the optional classifier.dev cascade (`media-lens/worker/classifier-dev/cascade.js:89-91`), which is off unless `MEDIA_LENS_ENABLE_CLASSIFIER_DEV=true` (`media-lens/worker/config.js:257`, `media-lens/worker/config.js:335`).

Local offline reproduction at `076a2720` (no network, no file change): an answer with `urgency` probability 0.62 and confidence 0.30 passes `validateAndSanitizeAnswers` with `review: true`, and `fuse()` then emits an `urgency` observation with `strength: observed` and `review_status: auto`.

The shadow decision contract already says confidence below 0.5 should route to `human_review` (`docs/jev-usage-lab/02-decision-contract.md:50`, `docs/jev-usage-lab/02-decision-contract.md:72`), but it is not wired into `analyze.js` (`docs/jev-usage-lab/08-risks-assumptions.md:40`).

UNKNOWN: whether a live `jev-1.13.0` answer can have top probability at or above 0.45 and confidence below 0.5 at the same time. That depends on TypeSafe's confidence formula, which upstream describes only as peakedness scaled from 0 to 1 (`jev-mcp@435d5d4:README.md:735`). Fixture mode does not constrain confidence against the probabilities (`media-lens/worker/adapters/jev.js:500`).

### G2. No way for Jev to decline

`influence_signal` has no option meaning "cannot judge from this span". A span the model cannot judge must be forced into a pattern or into `none`. The validator would also reject any extra question id (`media-lens/worker/adapters/jev.js:117-122`). The narrow shadow set prototypes a `should_abstain` question and a span-abstain gate (`docs/jev-usage-lab/02-decision-contract.md:64-66`), but only in the lab.

### G3. Truncation is silent

`truncate()` caps span text at 1200 characters and context at 400 (`media-lens/worker/adapters/jev.js:130-141`). Nothing records that a span was truncated, so a truncated span can still produce an `auto` observation. Upstream demotes truncated input from `auto` to `review` (`jev-mcp@435d5d4:src/lib.ts:350-353`). UNKNOWN: how often prepared spans exceed 1200 characters. I did not measure it.

### G4. The quoted noul has one cutoff and no review band

A noul just under 0.7 has no effect and leaves no trace. Upstream screening uses a lower review threshold below the action threshold (`jev-mcp@435d5d4:src/lib.ts:100-103`). Picking a band would itself need labelled data (see C3).

### G5. Budget reservation is not atomic on main

See section 2. The fix exists as open PR #150 and is outside this note's scope.

### C3. No calibration against labelled anchors

Upstream says its thresholds are starting points to tune against your own data (`jev-mcp@435d5d4:README.md:739`). In Media Lens:

- The production cutoffs 0.60, 0.45, 0.7, 0.2 (`media-lens/worker/fusion.js:15-20`) and the review cutoff 0.5 (`media-lens/worker/adapters/jev.js:49`) have no recorded fitting data in the repo. The lab says they are frozen copies, not fitted (`docs/jev-usage-lab/06-evaluation-harness.md:9`, `docs/jev-usage-lab/06-evaluation-harness.md:19`), and the 0.15 margin is "an explicit shadow choice, not a fitted weight" (`docs/jev-usage-lab/08-risks-assumptions.md:33`).
- The production calibration harness has 8 synthetic cases. Labels cover 4 of the 11 non-`none` options (`urgency`, `fear_threat`, `bandwagon`, `vague_authority`) plus `none` (`media-lens/fixtures/jev-calibration/manifest.json`). It reports exact match, FP/FN, abstention, and review counts, and is explicitly software consistency only (`media-lens/worker/jev/calibration.js:1-12`, `media-lens/worker/jev/calibration.js:76-88`). It has no confidence bins and does not score the quoted noul.
- The lab manifest has 19 cases (12 calibration, 4 holdout, 3 adversarial) with confidence bins `[0,0.5)`, `[0.5,0.7)`, `[0.7,1]` (`docs/jev-usage-lab/06-evaluation-harness.md:39`). Those labels are for the proposed narrow question set (`authorial_vs_quotation`, `emotionally_loaded_language`, `false_dilemma`, and others), not for production `influence_signal` (`media-lens/fixtures/jev-usage-lab/manifest.json`).
- No fixture comes from a labelled real-article anchor. Every answer file is recorded or synthetic. That means no current number, here or in the lab report, can support an accuracy, sensitivity, or specificity claim (`VISION.md:47-49`, `docs/jev-usage-lab/09-accuracy-abstention-report.md:5`).

The gap: there is no set of human-labelled anchor spans for each production option, with recorded `jev-1.13.0` answers and a held-out split, against which the four fusion cutoffs and the 0.5 review flag could be checked or fitted.

## 5. Proposals (not authorized)

Each proposal needs an owner decision. P1, P2, P4 and P5 change what users see and are methodology changes.

| ID | Proposal | Closes | Vision | Notes |
| --- | --- | --- | --- | --- |
| P1 | Pass the adapter review set into `fuse()` and set `review_status: needs_review` on Jev observations from `review` spans. Do not drop them | G1 | Aligns with constraints ("Uncertainty must be visible") | Small change in `analyze.js` and `fusion.js` plus a regression test using the reproduction above. Changes graph output for fixtures with confidence below 0.5. Golden files may move |
| P2 | Add an explicit decline option to `influence_signal` (for example `cannot_judge`) that code maps to a span abstention, never to an observation | G2 | Aligns with constraints ("When the input is insufficient, the responsible output is abstention") | Changes `questions.v1.json`, its sha256, the validator, fusion, the taxonomy check (`fusion.js:122`), and every recorded answer file. Needs a new pin-verify run, which is a live call and outside this lane. Consider promoting the lab's `should_abstain` design instead of inventing a new one |
| P3 | Record a per-span `truncated` flag in the adapter and demote affected Jev observations from `auto` to `needs_review` | G3 | Aligns with constraints | Measure first how often spans exceed 1200 characters in fixtures. If never, record that and defer |
| P4 | Add a lower noul review band (value to be fitted, not guessed) that sets `needs_review` without changing the role | G4 | Aligns with constraints | Blocked on C3. Do not pick a number without labelled data |
| P5 | Build a labelled-anchor set for the production question set: human-labelled spans for every option including `none` and quoted/authorial, recorded answers, a held-out split kept apart from threshold selection, and the lab's confidence bins added to `calibration.js` | C3 | Aligns with constraints ("transparent validation") | Recording answers needs live Jev calls, which need owner authorization and spend. Labelled real-article text has privacy and licensing implications (`docs/media-lens-classifier-dev-privacy.md`). Results remain software-consistency evidence until a representative validation exists |
| P6 | Merge or close PR #150 deliberately so the budget stop is enforced atomically | G5 | Vision is silent (operational control) | Separate review lane. Not part of this note |
| P7 | Add a runtime check that the computed question-set hash equals the committed hash, failing closed to `engine_unavailable` | Hash pinning currently test-only | Vision is silent | Low priority. The test already guards CI (`tests/media-lens-jev-adapter.test.js:62`) |

Not proposed: adopting jev-mcp, its MCP server, or `jev-latest`. Media Lens's pinned `jev-1.13.0` and forbidden `jev-latest` (`media-lens/worker/jev-pin-verify.js:30`) are stricter than the upstream default (`jev-mcp@435d5d4:src/server.ts:88`). Adding jev-mcp as a dependency remains an owner gate.

## 6. UNKNOWN

- U1. TypeSafe's exact Choice confidence formula, and so whether G1 is reachable with live `jev-1.13.0` answers.
- U2. How often prepared spans exceed 1200 characters (G3).
- U3. Whether the non-atomic budget race (G5) is reachable under current rate and concurrency limits.
- U4. Where the production cutoffs 0.60, 0.45, 0.7, 0.2 and 0.5 originally came from. No fitting record exists in the repo.
- U5. What "C3" names outside this brief. The repo does not define it. This note uses it for "calibration against labelled anchors".
- U6. Whether jev-mcp behavior after `435d5d4` differs. Only that SHA was read.
- U7. Whether any operator-side review queue exists outside `media-lens/worker/`. None was found inside it.
