# 05 — Shadow mode plan

Status: implemented as a local replay. Default off. It does not change `analyze()`, `adapters/jev.js`, or live flags.

Vision check: **Aligns with constraints**. Recommendations are recorded. The active graph is unchanged. Private Clarity text is not on this path.

## Behavior

When shadow mode is off, `runUsageLab` returns no records and zero network calls.

When `scripts/jev-usage-lab.js` sees `MEDIA_LENS_JEV_SHADOW=true` (exact string), it replays:

- `media-lens/fixtures/jev-usage-lab/manifest.json` through the narrow decision contract
- existing `media-lens/fixtures/jev/*.answers.json` against `media-lens/fixtures/expected/*.graph.json`

It does not call `createJevAdapter`, does not read the TypeSafe key, and rejects `--live` / `--network` with exit code 2.

`MEDIA_LENS_JEV_SHADOW` is not read in `worker/config.js`. Worker modules still do not read `process.env`. The CLI in `scripts/` is the env boundary, same pattern as pin verify.

## What is stored

Each decision record stores the question-set id and version, probabilities, `model_option`, post-policy `selected_option`, `final_action`, `disagreement`, `model_disagreement`, and `outcome` when a label exists.

Provenance stored: `article_id`, `source_id`, `span_id`, `source_ids`, `span_role`.

Not stored: secrets, span text, article text, explanation strings, scores, ranks. Extra answer keys are listed in `dropped_fields` by name.

`acted` is false. The active fusion output is not edited.

## Comparison

Fixture labels supply the human/historical class for the narrow set (`correct`, `incorrect`, `ambiguous`, `abstention`).

The production-shaped replay compares projected signal and strength with Jev observations already in the expected graphs. Span text from those graphs is not copied into the comparison rows. Pre-Jev role for an `engine_disagreement` span is treated as `authorial`, which is the fusion invariant, not a guess from prose.

## Batching

`planQuestionBatch` groups questions that share `article_id` + `source_id` + `span_id` into one planned request. It does not send that request.

| Plan | Provenance | Decision |
| --- | --- | --- |
| Several model questions, one span | The request carries that span’s ids. Each answer record copies them and adds `question_id` | Allowed. This matches today’s production body, which already sends two questions for one span |
| `observed_vs_candidate` | Derived in app | Refused with `derived_in_app` |
| Two spans in one proposed batch | One TypeSafe `state` cannot name two spans. Question ids are not span tags | Split. `cross_span_batched` is false |
| Missing article or span id | No key to attach the answer to | Refused with `missing_provenance` |

Tradeoff: one request per span costs more calls than stuffing an article into one state, and it keeps the span id on the caller side where the response can be stored. Cross-span batching would lower call count and drop the only reliable span binding this integration has. The lab does not do it.

Production call count is unchanged. The planner’s `http_calls` is 0.

## Fixtures

`media-lens/fixtures/jev-usage-lab/manifest.json` holds four kinds of replay:

| Kind | Example id | What the replay does |
| --- | --- | --- |
| Correct | `lab-cal-quotation-correct` | Selected option matches the label |
| Incorrect | `lab-cal-loaded-fp`, `lab-cal-dilemma-fn`, `lab-hold-loaded-fn` | Selected option does not match |
| Ambiguous | `lab-cal-ambiguous`, `lab-hold-ambiguous` | Margin below 0.15, so the lab abstains |
| Abstention | `lab-cal-should-abstain`, `lab-hold-malformed-abstain`, `lab-adv-unknown-option` | Explicit abstain or a rejected answer |
| Span siblings | `lab-cal-span-siblings-abstain`, `lab-cal-span-siblings-loaded`, `lab-cal-span-siblings-dilemma` | Same article id and span id. The abstain clears the other two selected options so they are not exact matches |

`lab-cal-claim-held` is an incorrect claim-support answer that is held, not applied.

`lab-adv-score-smuggle` is a correct `not_loaded` answer with extra score and rank fields. Those values are dropped.

`lab-adv-source-missing` is a confident `independent` answer with one source id. Policy abstains.

`lab-cal-candidate-strength` is a correct class at probability 0.55, so strength is `candidate`, not `observed`.

## Flag

| Control | Default | Effect |
| --- | --- | --- |
| `MEDIA_LENS_JEV_SHADOW` | unset / not `true` | CLI prints `shadow_enabled: false` and exits 0 |
| exact `true` | off in CI | Local fixture replay only |

Turning the flag on does not set `MEDIA_LENS_ENABLE_LIVE`, `MEDIA_LENS_ENABLE_LIVE_URL`, or `MEDIA_LENS_JEV_VERIFY`.
