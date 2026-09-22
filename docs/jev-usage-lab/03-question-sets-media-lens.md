# 03 — Media Lens narrow question set

File: `media-lens/worker/jev-usage-lab/question-sets/media-lens-narrow.v1.json`.

Id: `media-lens-narrow.v1`. Version: `1`. Status: shadow proposal.

This set is not loaded by `adapters/jev.js`. Production still sends `influence-questions.v1` (`media-lens/worker/jev/questions.v1.json`): the 12-way `influence_signal` Choice plus the `is_quoted_or_attributed` Noul.

Jev does not generate final prose, an overall manipulation score, outlet or person ranks, or a claim verdict the app will apply. The app maps a typed option to a state id. The UI phrase, if one is shown later, has to be one of `ALLOWED_UI_PHRASES`.

Instructions are static. They refer to `` `span.text` `` in state. They do not contain article text.

## Questions Jev may be asked

| Id | Options | How it lines up with the current graph | App rule |
| --- | --- | --- | --- |
| `authorial_vs_quotation` | `authorial`, `quotation`, `attributed_paraphrase`, `uncertain` | Same distinction as span role plus the noul. Fusion may move `authorial` to `uncertain` only | Record the recommendation. `role_write_authorized` stays false. Do not set role to `quoted` from this answer |
| `emotionally_loaded_language` | `loaded_moralized`, `not_loaded`, `abstain` | Subset of `influence_signal` / taxonomy id `loaded_moralized` | Map a passing answer to an influence state id. `not_loaded` is `no_signal` |
| `false_dilemma` | `present`, `absent`, `abstain` | Subset of taxonomy id `false_dilemma` | `absent` is `no_signal`. Does not decide which horn is true |
| `claim_support_status` | `supported`, `contradicted`, `mixed`, `unclear`, `not_checked`, `abstain` | `claims[].support` is `not_checked` in this preview | `supported`, `contradicted`, and `mixed` are `hold_for_human`. They are not written onto the claim. `unclear` maps to the existing “claim support unclear” state as a recommendation only |
| `source_independence` | `independent`, `repeating_or_syndicated`, `insufficient_source_context`, `abstain` | Coverage fields such as `independent_sources_estimate` come from Newsjack data today, not from Jev | Need two source ids or abstain. A passing answer is `coverage_candidate` at candidate strength. No outlet rank |
| `important_context_missing` | `missing`, `not_missing`, `insufficient_context`, `abstain` | Abstentions and “Insufficient context” | `missing` or `insufficient_context` blocks an observed influence signal |
| `should_abstain` | `abstain`, `answer` | Graph and span abstentions are first-class | `abstain` suppresses sibling questions on that span in the shadow log |

`selective_context_candidate` stays fusion-only, as in the build brief and `fusion.js`. It is not an option on this set.

The other production taxonomy ids (`fear_threat`, `urgency`, and the rest) stay on `influence_signal` until a later set versions them one by one. This proposal does not collapse them into a score.

## Derived in the app, not sent

`observed_vs_candidate` has `send_to_jev: false`.

| Derived value | Rule |
| --- | --- |
| `observed` | Top probability `>= 0.60`, margin `>= 0.15`, and no safety downgrade |
| `candidate` | Top probability `>= 0.45` and `< 0.60`, or a safety downgrade from observed |
| `below_threshold` | Top probability `< 0.45` |

Asking Jev to label its own evidence strength would hide the threshold inside the model. Fusion already owns that cutoff. The lab keeps it in code.

The batch planner drops this question with reason `derived_in_app` and does not put it in a request.

## What a record is allowed to change

Nothing in the active product. Shadow `final_action` is `shadow_record`, `shadow_abstain`, `hold_for_human`, or `no_ui_change`. `acted` is false.

If this set were ever promoted, promotion would still forbid:

- writing `supported` or `contradicted` from Jev
- setting a span role to `quoted` from Jev
- emitting `selective_context_candidate` from Jev
- computing a manipulation score or a rank

Those prohibitions are in the question-set `prohibitions` array and on every decision record.
