# 02 — Jev Decision Contract v1

Status: shadow contract. It does not replace `influence-questions.v1` and it does not change `fuse`.

Machine-readable record schema: `schemas/jev-decision-contract.v1.json`.

Builder: `buildDecisionRecord` in `media-lens/worker/jev-usage-lab/decision.js`.

Vision check: **Aligns with constraints**. The contract keeps evidence ids, probability, and abstention visible, and it refuses person/outlet ranks and unsupported claim writes.

## Identity

| Field | Value |
| --- | --- |
| Contract version | `1.0.0` (`contract_version`) |
| Production question set, unchanged | `influence-questions.v1` |
| Proposed Media Lens set | `media-lens-narrow.v1` version `1` |
| CoS stub set | `cos-routing.v1` version `1` |
| Model requested | `jev-1.13.0` |
| Deployment SHA | `audit.deployment_sha`, or null when no deploy is being described. This lab does not deploy |

Question-set id and version are stored on every record. The sha256 of the canonical question-set JSON is `audit.question_set_sha256`.

## Fixed options

Each question is a closed Choice. Option ids and definitions live in the question-set JSON (`criteria`). The model does not invent options. Unknown ids abstain with `unknown_option`.

`observed_vs_candidate` is not a Jev question. The app derives `observed`, `candidate`, or `below_threshold` from the top probability.

## Required evidence

`provenance` requires:

- `article_id`
- `span_id`
- `source_id` when a source is known, else null
- `source_ids` for any source-independence question
- `span_role` when the caller already knows the deterministic role

Ids match `^[A-Za-z0-9._:-]{1,128}$`. Span text, article text, titles, and explanations are not fields on the record. If a caller passes them, `cleanProvenance` does not copy them.

`source_independence` abstains with `insufficient_source_context` unless at least two source ids are present. A confident model answer does not override that gate.

## Probability and confidence

For proposed-set replays the lab uses the live rule: a complete distribution over every option, sum within `1e-6` of 1, choice is the unique argmax, confidence in `[0, 1]`.

`margin` is the top probability minus the second. If it is below `0.15`, the record abstains with `low_margin`. That margin is a shadow gate. It is not in `fusion.js`, and it was not fit on the holdout.

`review` is true when confidence is below `0.5`, matching `JEV_REVIEW_MIN_CONFIDENCE`. Review alone does not drop a valid class. It sets `escalation` to `human_review`.

Production answer files are partial on purpose. `compareProductionAnswerToObservation` turns off the complete-distribution rule and the margin gate so the comparison tracks current fusion rather than the new gate.

`evidence_strength` uses the frozen fusion cutoffs: `0.60` observed, `0.45` candidate. `certainty_beyond_evidence` and `vague_authority` cannot stay `observed` unless `deterministicMarker` is true. The shadow log does not store the text, so the marker is absent and those choices fail closed to `candidate`.

## Abstention

`abstained: true` and `selected_option: null` when the record withholds a class. `model_option` still holds a valid argmax when the parse succeeded and a later policy withheld it.

Reasons: `malformed`, `unknown_question`, `derived_in_app`, `wrong_type`, `unknown_option`, `invalid_probabilities`, `incomplete_distribution`, `choice_not_argmax`, `ambiguous_tie`, `low_margin`, `insufficient_source_context`, `explicit_abstain`, `span_abstain`.

`none` on the production question is a class, not an abstention.

`should_abstain` choosing `abstain`, or abstaining for any other reason, withholds other questions on the same article id and span id via `applySpanAbstainGate`. The gate runs only on records that already share one assigned split. A calibration row cannot suppress a holdout row.

Suppressed siblings stay in the log and become abstentions. The gate sets `suppressed_by_span_abstain: true`, `abstained: true`, `abstention_reason: span_abstain`, `selected_option: null`, `evidence_strength: null`, `mapped_ui_state: abstain`, `final_action: shadow_abstain`, and `policy_override: span_abstain`. `model_option` still shows the argmax. Disagreement is recomputed against the fixture label, so a suppressed class is not an exact match. Metrics count these rows as abstentions, not as scored decisions. The gate is not called from `analyze.js`, so the active graph does not change.

## Escalation, threshold, fallback

| Situation | `final_action` | `escalation` |
| --- | --- | --- |
| Valid class the app can show as a state id | `shadow_record` | `none`, or `human_review` if confidence `< 0.5` |
| `no_signal` or below the candidate threshold | `no_ui_change` | as above |
| Abstain | `shadow_abstain` | `human_review` for invalid or low-margin answers; `none` for an explicit abstain that is not in review |
| Sibling suppressed by span abstain | `shadow_abstain` | `human_review`. `selected_option` is cleared |
| `supported`, `contradicted`, or `mixed` on `claim_support_status` | `hold_for_human` | `hold` |

Fallback is abstain or hold. The record never writes `claims[].support`. `claim_support_applied` is always false. Current fusion still sets `not_checked` only.

`role_write_authorized` is always false. A high noul can recommend `role_effect: authorial_to_uncertain` and cannot set `quoted`.

`acted` is always false in this contract version.

## App mapping

`mapped_ui_state` is an id, not a sentence. The renderer remains responsible for `ALLOWED_UI_PHRASES` in `media-lens/schema/taxonomy.js`. Examples:

| State id | Existing product meaning |
| --- | --- |
| `quoted_not_authorial` | “Quoted language not attributed as authorial” |
| `insufficient_context` | “Insufficient context” |
| `claim_support_unclear` | “Claim support unclear” |
| `hold_unsupported_claim` | Do not show a support verdict |
| `coverage_candidate` | Coverage only, candidate, never a rank |
| `no_signal` | No influence observation |
| `abstain` | Withhold |

Source-independence answers that pass the two-source gate are forced to strength `candidate`. They are not observed facts about an outlet.

## Audit fields

`audit` stores `model_requested`, `model_reported` (null in fixture replay), `deployment_sha`, `question_set_sha256`, `recorded_at`, and `contract_version`.

`measurement.latency_ms` and `measurement.call_count` are copied only when the caller declares them. Basis is `fixture_declared` when the fixture replay supplies the numbers, `not_measured` when it does not, or `in_process` for the `/analyze` shadow schedule. `in_process` is a local timer around the shadow record. It is not an HTTP measurement and it is not model accuracy.

`cost.available` is false. Pricing and rate limits from outside this repo are not copied into the record.

`prohibited_outputs_present` is a fixed map of falses: final prose, overall manipulation score, outlet rank, person rank, applied unsupported claim, and authorizations for merge, deploy, spend, credentials, and live flags.

`dropped_fields` lists extra answer keys by name only. Values are not stored.

## Disagreement and outcome

When a fixture label is present:

- `disagreement` compares the post-policy decision to `label.option`. Abstaining matches a label of `abstain` or null.
- `model_disagreement` compares `model_option` to that label, so a policy hold is visible even when the decision agrees.
- `outcome` is the fixture’s `outcome_class` (`correct`, `incorrect`, `ambiguous`, `abstention`) or, for the historical replay, `historical_match` / `historical_mismatch`.
- `historical_action` is the fixture’s expected state id, not a new sentence.

Historical replay against `media-lens/fixtures/expected/` is defined in `docs/jev-usage-lab/06-evaluation-harness.md`.
