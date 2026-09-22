# 10 — Narrow-question shadow execution

Status: default off. This is not model accuracy and it is not production-ready.

Vision check: **Aligns with constraints**. Relevant sections: "Uncertainty must be visible", "Evidence comes before a score", and "Privacy is the default architecture". The production question set and the HTTP graph stay authoritative. Narrow answers are a comparison log. They do not change observations, thresholds, abstentions, claim support, or roles. Turning the path on later would send span text to TypeSafe, so activation still needs an owner decision about consent, retention, and the numeric limits. This document does not make that decision.

## Two flags

| Flag | What it does |
| --- | --- |
| `MEDIA_LENS_JEV_SHADOW` | Projects answers the production adapter already returned. Does not ask `media-lens-narrow.v1`. Network calls for that schedule stay 0 |
| `MEDIA_LENS_JEV_SHADOW_NARROW` | Separate exact-`true` flag. After the production JSON is sent, it may ask `media-lens-narrow.v1` as a non-authoritative comparison |

`TRUE`, `1`, and `true ` do not enable either flag. `config.jevShadow.extraJevCallsEnabled` stays false. The capture path does not grow a second call.

## When a narrow request is made

`/analyze` finishes the production graph and sends it. A timer then runs the narrow schedule. The timer is not awaited. A throw, timeout, or provider error does not change the status or the body.

The schedule asks one request per eligible span. Eligible spans are the ones production would send to Jev: a safe span id, non-empty text, and a role other than `boilerplate` or `byline_meta`. Questions that share that span go in one state. `observed_vs_candidate` is not sent. The planner refuses it as `derived_in_app`. Two spans never share a request.

Each request carries `article_id`, `source_id`, `span_id`, `analysis_run_id`, the question-set id, version, and sha256, `model_requested`, and `deployment_sha` (null until a deploy is being described). The pre-Jev role is the role on the request. `engine_disagreement` stays `authorial` for that provenance, which is the fusion invariant from the harness, not a write back onto the graph.

Records go through `buildDecisionRecord` and `prepareLabCases` with split `runtime_shadow`. Holdout is not scored. The span-abstain gate runs only inside that split.

## What can reach the network

Live execution needs all of the following. Missing any one of them means zero TypeSafe calls:

- `MEDIA_LENS_JEV_SHADOW_NARROW` is the exact string `true`
- every limit below is set to a value the parser accepts
- the estimated price is less than or equal to the monthly ceiling, so one call could fit
- `MEDIA_LENS_MODE=live`
- `CI` is unset, empty, `false`, or `0`
- the kill switch is not asserted
- `MEDIA_LENS_TYPESAFE_API_KEY` is present

Fixture mode never constructs the live client. CI never constructs it. Tests pass an injected provider with `ask`. That provider is not TypeSafe. The live client performs one POST to `/v1/systemone`, does not retry, and does not follow redirects. It is built with the pinned provider fetch only inside the post-response timer, and only when the gates above pass.

## Owner-approval placeholders

No production number is chosen here. Unset means the network stays off.

| Limit | Environment variable | If unset |
| --- | --- | --- |
| Per-analysis call cap | `MEDIA_LENS_JEV_SHADOW_NARROW_MAX_CALLS_PER_ANALYSIS` | no call |
| Timeout | `MEDIA_LENS_JEV_SHADOW_NARROW_TIMEOUT_MS` | no call |
| Rate limit | `MEDIA_LENS_JEV_SHADOW_NARROW_RATE_LIMIT_PER_MINUTE` | no call |
| Monthly cost ceiling | `MEDIA_LENS_JEV_SHADOW_NARROW_MONTHLY_COST_CEILING_USD` | no call |
| Estimated USD per call | `MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL` | no call |

The parser rejects blanks, zero, and non-numeric text. Whole-number fields must be integers. The ceiling and the estimate must be greater than 0. Values outside the parser window are treated as unset. Those windows are validation bounds, not approved operating points: calls `1..10000`, timeout `1..120000` ms, rate `1..100000` per minute, ceiling `> 0..1000000`, estimate `> 0..10000`.

The rate limit and the cost ledger are process-local. They reset when the process restarts. They are not shared across workers. They do not write `/var/lib/media-lens/typesafe-budget.json` and they do not change the production stop threshold. The log says `placeholder: true`, `available: false`, and `not_a_production_budget: true`.

There are no retries. A retry would be another call, and that policy is not approved.

## Labels and authority

The log is `shadow_only`, `not_model_accuracy`, and `not_production_ready`. `acted` is false. `claim_support_applied` is false. `role_write_authorized` is false. The `authorizes` map is false for the HTTP response, observations, observed and candidate thresholds, abstentions, claim support, role writes, live flags, credentials, deployments, spending, and merge. The field is not named `authorization`, so the redaction list does not drop it.

Disagreement classes compare the shadow decision with the production graph. They do not change that graph. `held_not_applied` means a support class was held. `role_recommendation_withheld` means a role was not written.

Span text, titles, URLs, and secrets are not fields on the log. Extra answer keys are kept only when the name is a short id. Decision-contract rows use measurement basis `not_measured` so a provider timer is not stored as fixture latency or as model accuracy. Provider attempt counts are on the envelope as `network_calls`.

`/health` does not include the flag.

## Rollback

Unset `MEDIA_LENS_JEV_SHADOW_NARROW`. Unset the five limit variables. `analyze()` does not read the flag.
