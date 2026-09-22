# 10 — Narrow-question shadow execution

Status: default off. This is not model accuracy and it is not production-ready. The approved operating posture leaves the per-call estimate unset, so the network stays off.

Vision check: **Aligns with constraints**. Relevant sections: "Uncertainty must be visible", "Evidence comes before a score", and "Privacy is the default architecture". The production question set and the HTTP graph stay authoritative. Narrow answers are a comparison log. They do not change observations, thresholds, abstentions, claim support, or roles.

## Owner approval (2026-09-22 PT)

Written owner approval for draft PR #148 at `9531d5958beb6655874c30435241f11f1959726d` covers configuration, documentation, and tests. It does not merge, deploy, or mark that draft ready. It does not set `MEDIA_LENS_JEV_SHADOW` or `MEDIA_LENS_JEV_SHADOW_NARROW` on any host. It does not send TypeSafe traffic.

`NARROW_SHADOW_APPROVED_OPERATING_POINTS` in `media-lens/worker/config.js` records the four numeric points. `loadConfig` does not apply that object and does not write it into the environment. Unset variables still parse as null.

An unset `MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL` means the network stays off, including when the other four variables are set to the approved points and the flag is exact `true`. The block reason is `owner_limits_unset` and `network_calls` stays 0. A one-shot live shadow needs a separate owner authorization.

This record is not an accuracy claim, not a production-ready claim, and not an availability claim. The $5.00 ceiling does not enforce a fleet-wide budget. This approval makes no claim that TypeSafe provides zero data retention, deletion, a retention period, or a no-training guarantee. Production output remains authoritative.

### Span scope

Approved for any later live narrow request, and already the shape the code builds:

- Public-URL live path only, after the existing consent and public-material gate (`user_asserted_public` must be true). Live pasted text returns `live_pasted_text_disabled` before analysis, so the narrow schedule does not run. A request without that consent is rejected the same way.
- Pasted text, private material, paywalled material, and unauthorized material stay outside this approval. Paywall detection records an abstention and does not bypass a wall, send cookies, or send credentials. This approval does not add a new narrow-path filter, and it does not authorize a narrow request for those materials. The unset estimate keeps the live client off for every article.
- Eligible span text is at most 1200 characters (`NARROW_SHADOW_MAX_SPAN_CHARS`). Neighboring context is at most 400 characters before and 400 after (`NARROW_SHADOW_MAX_CONTEXT_CHARS`). The public article title is the title already on the artifact. Before serialization it is capped at 2000 characters (`NARROW_SHADOW_MAX_TITLE_CHARS`) with the same truncate helper as span text and context. A missing title stays null.
- The live body is one POST of `{ model, state, questions }` per span. `state` carries artifact kind and title, span id, role, and truncated text, context before and after, and provenance ids. It does not add raw HTML, the full article body, a dedicated URL field, cookies, credentials, or secrets.
- One request per span. No retries. Redirects are not followed.

While the estimate stays unset, that body is not sent.

### Local retention

`stderr_process_log_only_no_disk_store`

No database write, no disk write, and no write to `/var/lib/media-lens/typesafe-budget.json`. Local logs do not include raw span text. The stderr record is redacted. Labels on the record: `shadow_only`, `not_model_accuracy`, `not_production_ready`.

### Numeric limits

These points apply only when the matching environment variable is set. They are not process defaults.

| Limit | Approved point | Environment variable | If unset |
| --- | --- | --- | --- |
| Per-analysis call cap | 5 | `MEDIA_LENS_JEV_SHADOW_NARROW_MAX_CALLS_PER_ANALYSIS` | no call |
| Timeout | 10000 ms | `MEDIA_LENS_JEV_SHADOW_NARROW_TIMEOUT_MS` | no call |
| Rate limit | 6 per minute | `MEDIA_LENS_JEV_SHADOW_NARROW_RATE_LIMIT_PER_MINUTE` | no call |
| Monthly cost ceiling | 5.00 USD | `MEDIA_LENS_JEV_SHADOW_NARROW_MONTHLY_COST_CEILING_USD` | no call |
| Estimated USD per call | unset (required) | `MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL` | no call |

The $5.00 ceiling is process-local memory. It resets when the process restarts. It is not shared across workers. A shared ledger is required before this path runs on more than one worker. This document does not add that ledger. The ceiling does not enforce, replace, or coordinate the production TypeSafe stop (default $30) across workers or restarts. It does not write the production budget file. The log says `placeholder: true`, `available: false`, `not_a_production_budget: true`, and `production_budget_written: false`.

The parser still rejects blanks, zero, and non-numeric text. Whole-number fields must be integers. The ceiling and the estimate must be greater than 0. Values outside the parser window are treated as unset. Those windows are validation bounds, not the approved operating points: calls `1..10000`, timeout `1..120000` ms, rate `1..100000` per minute, ceiling `> 0..1000000`, estimate `> 0..10000`.

Before any real narrow call, a separate owner authorization must set `MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL` to a conservative per-call estimate. Compute it from the verified current TypeSafe input price multiplied by the planning token count below, then round up. This repository does not record that price as a dollar amount. Do not invent one. The production planning rate 0.002 is not this estimate.

A public list price of $0.042 per million tokens is a planning reference only. The account invoice is unverified. That rate is not `ESTIMATED_USD_PER_CALL`. The estimate stays unset pending a separate owner authorization. This change does not set it.

### Request-size packet

Packet: `docs/jev-usage-lab/narrow-shadow-request-bound.v1.json`.

The universal bound is the exact `JSON.stringify` length of one `{ model, state, questions }` body from `narrowLiveRequestBody`, with:

- title at 2000 characters, span text at 1200, context at 400 before and 400 after
- all 7 sendable questions from `media-lens-narrow.v1`
- article id, source id, and span id each at the safe-id maximum of 128 characters (`NARROW_SHADOW_MAX_SAFE_ID_CHARS`). Identifiers longer than that are rejected. They are not truncated.
- the longest permitted artifact kind (`other_public`) and span role (`attributed_paraphrase`). Any other kind or role is left null.

That length is **9467** characters. Planning `T_max` is `ceil(9467 / 3)` = **3156**. `T_max` is a conservative planning estimate from character length. It is not a provider-measured token count and not a dollar estimate.

The title-cap regression uses shorter identifiers. Its serialized length is **8896** characters, and its planning figure is **2966**. That is a test-shape fence only. It is not a universal hard ceiling. **3004** is not that test-shape size and is not a universal hard ceiling.

`ESTIMATED_USD_PER_CALL` stays unset. `NARROW_SHADOW_APPROVED_OPERATING_POINTS.estimatedUsdPerCall` stays null.

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

Live execution needs all of the following. Missing any one of them means zero TypeSafe calls. The 2026-09-22 PT approval leaves the estimate unset, so this list is not satisfied:

- `MEDIA_LENS_JEV_SHADOW_NARROW` is the exact string `true`
- every limit in the owner-approval table is set to a value the parser accepts, including a positive per-call estimate
- the estimated price is less than or equal to the monthly ceiling, so one call could fit
- `MEDIA_LENS_MODE=live`
- `CI` is unset, empty, `false`, or `0`
- the kill switch is not asserted
- `MEDIA_LENS_TYPESAFE_API_KEY` is present

Fixture mode never constructs the live client. CI never constructs it. Tests pass an injected provider with `ask`. That provider is not TypeSafe. The live client performs one POST to `/v1/systemone`, does not retry, and does not follow redirects. It is built with the pinned provider fetch only inside the post-response timer, and only when the gates above pass.

The rate limit and the cost ledger described above are the only counters this path keeps. There are no retries.

## Labels and authority

The log is `shadow_only`, `not_model_accuracy`, and `not_production_ready`. `acted` is false. `claim_support_applied` is false. `role_write_authorized` is false. The `authorizes` map is false for the HTTP response, observations, observed and candidate thresholds, abstentions, claim support, role writes, live flags, credentials, deployments, spending, and merge. The field is not named `authorization`, so the redaction list does not drop it.

Disagreement classes compare the shadow decision with the production graph. They do not change that graph. `held_not_applied` means a support class was held. `role_recommendation_withheld` means a role was not written.

Span text, titles, URLs, and secrets are not fields on the log. Extra answer keys are kept only when the name is a short id. Decision-contract rows use measurement basis `not_measured` so a provider timer is not stored as fixture latency or as model accuracy. Provider attempt counts are on the envelope as `network_calls`.

`/health` does not include the flag.

## Rollback

Unset `MEDIA_LENS_JEV_SHADOW_NARROW`. Leave `MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL` unset. That single omission keeps narrow calls at zero even if the other four approved points are present. `analyze()` does not read the flag.
