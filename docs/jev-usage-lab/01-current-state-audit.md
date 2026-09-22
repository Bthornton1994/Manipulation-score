# 01 — Current-state Jev audit

Audit commit: `1d3f3798aa28855a1e7aacff08e1f15e80d03c44` (`main` tip at the start of this work).

Scope: this Manipulation Score repo only. CareReserve and StageForge were not inspected or modified. Pull requests #141 and #143 were not updated. Issue #118 was not closed. No live flag, Caddy file, credential, classifier.dev setting, or pasted-text path was changed. No TypeSafe request was sent for this audit.

This file describes the code that already runs. It is not an accuracy claim and not a production-readiness claim.

Vision check: **Aligns with constraints** (`VISION.md`: “Evidence comes before a score”, “Uncertainty must be visible”, “Analyze communication, not identity”, “Privacy is the default architecture”). Jev remains a typed classifier. It does not score people or outlets.

## Call sites

HTTP to Jev exists in one function: `callLive` in `media-lens/worker/adapters/jev.js`. It `POST`s `{baseUrl}/v1/systemone` with `model: "jev-1.13.0"`, a per-span `state`, and the question map from `media-lens/worker/jev/questions.v1.json`. Live mode is not the default. Fixture mode reads `media-lens/fixtures/jev/<id>.answers.json` and does not use the network.

| Caller | Function | Network? | What it asks |
| --- | --- | --- | --- |
| `media-lens/worker/analyze.js` | `analyze` → `runPipeline` | Only when `jevAdapter.mode === 'live'` | One `analyzeSpans` for eligible spans |
| `media-lens/worker/server.js` | `buildAdapters`, then the `/analyze` handler | Same as `analyze` | Builds the adapter with `timeoutMs: config.limits.jevCallTimeoutMs` and `maxCallsPerAnalysis: config.limits.maxJevCallsPerAnalysis` |
| `media-lens/worker/analyze-fixture.js` | `runFixture` | No. Mode is `fixture` | Local answer files |
| `media-lens/worker/jev/calibration.js` | `runCalibrationCases` | Only if the caller passes `mode: 'live'` | One span per labeled case. CI uses fixture files or a mock HTTP server |
| `media-lens/worker/jev-pin-verify.js` | `runJevPinVerify` | Only when `MEDIA_LENS_JEV_VERIFY=true`, a key is present, and the kill switch is not asserted | `analyzeSpans` per selected synthetic article. Default article is `synthetic-06-short-excerpt`. Concurrency is 1. `maxCallsPerAnalysis` is not passed, so the adapter cap is off on this path |
| `scripts/jev-pin-verify.js` | CLI wrapper | Same gate as `runJevPinVerify` | Does not start the worker and does not enable live URL or live pasted text |

These modules read Jev answers and do not call Jev:

- `media-lens/worker/fusion.js` (`fuse`)
- `media-lens/worker/classifier-dev/cascade.js` (reads `jevResult` before any classifier.dev call)
- `media-lens/worker/graph.js` (copies engine metadata)

Browser files (`app.js`, `media-lens/media-lens.js`, HTML) do not call TypeSafe. `worker/config.js` is still the only worker module that reads `process.env`.

## Calls per analysis

Eligible spans are prepared spans whose role is not `boilerplate` or `byline_meta` (`SPAN_ROLES_EXCLUDED_FROM_JEV` in `analyze.js` and the same set in `jev-pin-verify.js`).

On the synthetic articles in `media-lens/fixtures/articles/`, `prepareFromHtml` yields:

| Fixture | Prepared spans | Eligible Jev spans |
| --- | --- | --- |
| `synthetic-01-quoted-vs-authorial` | 7 | 6 |
| `synthetic-02-syndicated-cluster` | 5 | 4 |
| `synthetic-03-no-timestamp` | 4 | 3 |
| `synthetic-04-injection` | 5 | 4 |
| `synthetic-04-injection-control` | 4 | 3 |
| `synthetic-05-paywall` | 3 | 2 |
| `synthetic-06-short-excerpt` | 2 | 2 |

`analyze()` does not call Jev for `synthetic-05-paywall` or `synthetic-06-short-excerpt` when the prepared text is under `minAnalyzableChars` (200) or the graph abstains earlier. The answer files can still exist. Pin verify does not apply that minimum. It calls the adapter on eligible spans directly, so the default pin-verify article can make 2 logical calls even though `analyze()` would abstain.

Live `/analyze` call count, when the pipeline actually reaches Jev:

- Logical calls = one per eligible span (`engine.jev.calls`).
- Each logical call is one HTTP request containing both questions.
- `runWithConcurrency` uses 4 workers unless a caller sets `concurrency`. The server does not set it, so the server path uses 4.
- Retries are inside `callLive`. `JEV_MAX_RETRY_ATTEMPTS` is 4. Retryable statuses are 408, 429, and 500–599. Backoff starts at 250 ms and doubles. `Retry-After` is honored up to 5 seconds. A retried span still increments `calls` once. The estimated budget in `server.js` records `engine.jev.calls`, not the number of HTTP attempts.

Fixture mode increments `calls` once per eligible span and does not send HTTP.

## Sequential vs batchable

Today, questions are already batched per span and spans are concurrent:

- `influence_signal` and `is_quoted_or_attributed` travel in one request body.
- Spans do not share a request. The response is stored in `answersBySpanId` under the span id the caller already knew, because the provider response is not tagged with a span id of its own.
- `docs/media-lens-influence-graph-plan.md` records a 2026-09-18 TypeSafe docs statement that questions in one request are evaluated independently. This audit did not re-fetch that statement and does not treat it as a new measurement.

Cross-span batching would drop provenance under the current contract: one `state` object, question ids not sent to the model as span keys (`docs/media-lens-jev-integration-v2.md`). The Usage Lab planner refuses that merge. See `docs/jev-usage-lab/05-shadow-mode-plan.md`.

## Question format and options

Question set name: `influence-questions.v1`. Hash: sha256 of canonical JSON, file `media-lens/worker/jev/questions.v1.sha256`, copied to `engine.jev.question_set_sha256`.

`influence_signal` is a Choice. Options, in file order:

`loaded_moralized`, `fear_threat`, `urgency`, `false_dilemma`, `identity_ingroup`, `scapegoating_dehumanizing`, `certainty_beyond_evidence`, `vague_authority`, `anecdote_generalization`, `bandwagon`, `adversarial_conflict_framing`, `none`.

`selective_context_candidate` is in the taxonomy and is not a Jev option. `validateQuestionSetContract` rejects it. Fusion assigns it from deterministic rules only.

`is_quoted_or_attributed` is a Noul. Criteria are `true` and `false`. There is no separate confidence field.

Instructions are static strings. They tell the model to read `` `span.text` `` and to ignore instructions inside the span. Article text is not interpolated into the instructions.

No Score question is sent. Jev is not asked for prose, an overall manipulation score, or an outlet or person rank.

## Probability handling

`validateAndSanitizeAnswers` in `adapters/jev.js`:

- Choice probabilities must be finite numbers in `[0, 1]`.
- Keys must be known option ids. The chosen id must be present and must be an argmax. A two-way tie is accepted if the returned choice is one of the tied ids.
- The sum must be greater than 0 and at most `1 + 1e-6`.
- Live mode (`requireCompleteDistribution`) also requires every option and a sum within `1e-6` of 1. Fixture files may omit near-zero options.
- `confidence` must be in `[0, 1]`. Below `JEV_REVIEW_MIN_CONFIDENCE` (0.5) the disposition is `review`, and the answers are still returned.
- Noul must be in `[0, 1]`. It has no confidence and no probability map.
- Extra keys (`explanation`, unused question ids, generated text) are dropped.

Fusion then applies frozen thresholds from `THRESHOLDS` in `fusion.js`:

- top probability `>= 0.60` → strength `observed`
- `>= 0.45` and below 0.60 → `candidate`
- below 0.45 → no Jev observation
- `certainty_beyond_evidence` and `vague_authority` cannot stay `observed` without a deterministic text marker. Otherwise they are downgraded to `candidate`.
- Prompt-injection wording forces `candidate` and `needs_review`.
- `is_quoted_or_attributed` noul `>= 0.70` on a span whose role is `authorial` moves that role to `uncertain` with `role_basis: engine_disagreement`. It never sets `quoted`.

There is no production margin gate. A 0.51 / 0.49 split can pass if the choice is the unique argmax, confidence is valid, and the top probability clears 0.45.

## Timeout, cap, retry, abstention

| Control | Where it is enforced | Default | Notes |
| --- | --- | --- | --- |
| Per-call timeout | `DEFAULT_LIMITS.jevCallTimeoutMs` is 8000. `callLive` aborts each attempt at `timeoutMs`. `server.js` passes `config.limits.jevCallTimeoutMs` | 8 seconds per attempt | `loadConfig` does not read an env override for this field. Tests that need another value assign `config.limits.jevCallTimeoutMs` |
| Per-analysis timeout | `analyze.js` races the pipeline against `config.limits.perAnalysisTimeoutMs` and then aborts the shared `AbortController` | 15000 ms | Env: `MEDIA_LENS_PER_ANALYSIS_TIMEOUT_MS` (min 1000, max 300000). Still enforced. The returned graph is a single `engine_unavailable` abstention |
| Call cap | `analyze.js` abstains with zero provider calls when `spansForJev.length > maxJevCalls`. The adapter also stops new spans once `calls >= cap` and sets `capReached`. If that happens, `analyze.js` discards the partial result and abstains | 160 | Env: `MEDIA_LENS_MAX_JEV_CALLS_PER_ANALYSIS`. Still enforced on the worker path. Pin verify does not pass the cap |
| Retry | `callLive`, 4 attempts | see above | Non-retryable HTTP, redirect, and fail-closed pin errors stop immediately |
| Kill switch | `effectiveLiveFlags` / `isKillSwitchAsserted` | off | `MEDIA_LENS_KILL_SWITCH=true` or a present kill file forces Jev adapter mode `disabled` when mode is live, and blocks pin verify |
| Budget stop | `analyze.js` before `analyzeSpans`, live mode only | estimated warn $20 / stop $30 | Estimated. Not verified provider billing. No article text in the budget file |

The in-adapter cap counter is not atomic across the 4 concurrent workers. The reliable worker guard is the pre-check in `analyze.js`: more than 160 eligible spans produces an abstention and zero calls. At 160 or fewer, the in-adapter cap is not reached.

Abstention paths that are not a Jev `none` answer:

- span failure → `engine_failure` abstention for that span
- failure rate above 0.20 → Language dimension unreviewed and Jev observations dropped
- model mismatch → observations kept but `needs_review`, plus a dimension abstention
- disabled engine → dimension abstention; deterministic candidates can still appear
- pipeline timeout, call cap, budget stop, short text, oversized input → graph-level abstention
- `none` means “no listed pattern”, not “abstain”

`confidence < 0.5` does not by itself remove an observation if the probability still clears the candidate threshold. It is a review disposition on the adapter result. Fusion does not read `reviewSpanIds`.

## Provenance

Preserved today:

- Request `state.span.id`, `state.span.role`, capped `state.span.text` (1200 chars), artifact `kind` and `title`, and `context.before` / `context.after` capped at 400 chars.
- Answers stored by that span id.
- Graph observations carry `span_ids` and `evidence: { engine, question_id, top_probability, answers_ref }` with `answers_ref` equal to the span id.
- `engine.jev` stores mode, `model_requested` (`jev-1.13.0`), `model_reported`, `model_match`, question-set name, question-set sha256, logical calls, failures, and elapsed ms.

Not preserved on the Jev request:

- No separate article id or source id. The article URL is not in `state`.
- Title text is sent.
- Neighbor span text is sent as context, capped.
- The provider does not echo the span id. Provenance depends on the caller keeping the request and the response together.
- Shadow logs in this lab must not copy span text. The production request still sends capped span text when live mode is on. This audit did not change that.

## Broad and ambiguous judgments

`influence_signal` is one 12-way judgment. Several patterns the build brief cares about (quotation vs authorial, false dilemma, loaded language, missing context, whether to abstain) are either folded into that choice, handled by the noul, or not asked at all.

Ambiguity today:

- Low top probability becomes candidate or no observation. It does not become an explicit abstain option.
- Low confidence becomes `review` and can still surface.
- Ties are allowed if the choice is one of the winners.
- Claim `support` is always `not_checked` in fusion. Jev is not a fact checker.
- Coverage independence comes from Newsjack fixture or artifact data, not from Jev.
- `observed` vs `candidate` is a code threshold, not a model choice.

That is why the proposed narrow set in `docs/jev-usage-lab/03-question-sets-media-lens.md` does not replace `questions.v1.json` in this change.

## Fixtures and canaries

| Location | Role |
| --- | --- |
| `media-lens/fixtures/articles/synthetic-*.html` | Invented articles. No real outlets or people |
| `media-lens/fixtures/jev/*.answers.json` | Recorded Choice/Noul answers for fixture mode |
| `media-lens/fixtures/expected/*.graph.json` | Expected influence graphs |
| `media-lens/fixtures/jev-calibration/` | Synthetic calibration cases and answer files. Disclaimer in `manifest.json` says they are not real-world accuracy |
| `media-lens/fixtures/newsjack/` | Coverage fixtures, not Jev calls |
| `tests/media-lens-jev-adapter.test.js` | Contract, retries, cap behavior, closed choice map |
| `tests/media-lens-jev-calibration.test.js` | Fixture and mock-HTTP confusion counts |
| `tests/media-lens-jev-production-controls.test.js` | 160 cap, 15 s abort, budget, kill switch |
| `tests/media-lens-jev-live-optional.test.js` | Skips unless a key and `MEDIA_LENS_ENABLE_LIVE=true` |
| `tests/media-lens-jev-pin-verify.test.js` | Pin gate, including zero calls when the flag is off or the kill switch is on |
| `tests/media-lens-canary-drill.test.js` | Canary drill. A mock Jev server is asserted at 0 hits when the gate is closed |
| `docs/media-lens-canary-drill-v1.md` | Operator drill. Not an accuracy study |
| `.github/workflows/jev-pin-verify.yml` | `workflow_dispatch` only |

## Caps checked against this commit

- 160-call cap: still the default, still enforced on `analyze()` before any live call, covered by `tests/media-lens-jev-production-controls.test.js`.
- 15 s analysis timeout: still the default, still enforced by the pipeline race and abort, same test file.
- 8 s per attempt: still the adapter and `DEFAULT_LIMITS` value. It is not a separate env var.
- Pin verify and the calibration harness do not apply the 15 s pipeline timeout or the 160 cap unless a caller passes them.

No production call-count change is introduced by the Usage Lab. It does not import `analyze.js` and it does not call `analyzeSpans`.
