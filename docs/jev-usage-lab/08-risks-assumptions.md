# 08 — Risks, assumptions, and unverified hypotheses

Vision check: **Aligns with constraints**. The risks below are reasons not to promote shadow output into active fusion.

No external accuracy percentage, price, or rate limit is treated as a measurement of this integration.

## Assumptions in this repo

| Assumption | Where it is checked | If it is wrong |
| --- | --- | --- |
| One HTTP request per span keeps span provenance because the caller stores `answersBySpanId` | `adapters/jev.js`, this audit | Cross-span batching would attach answers to the wrong span. The lab refuses that plan |
| 160 is a pre-check on eligible span count, and 15 s aborts the pipeline | `analyze.js`, `tests/media-lens-jev-production-controls.test.js` | Pin verify does not use those two limits. A long pin-verify run is not bounded by the analysis timeout |
| 8 s is per attempt, up to 4 attempts | `callLive` | The 15 s race is what stops a retry loop. Logical `calls` still count the span once, so the estimated budget under-counts HTTP attempts |
| Fixture answer files may omit near-zero probabilities | `validateAndSanitizeAnswers` | Live mode rejects incomplete distributions. Do not train a shadow rule on fixture leniency and then assume live responses look the same |
| Marker-gated signals need span text to stay `observed` | `fusion.js` | Shadow logs without text fail closed to `candidate`. That can disagree with a graph that kept `observed` because the marker was present |
| `synthetic-05-paywall` answer file is not the graph outcome | Expected graph abstains | Replaying the answer file alone overstates what the product showed |
| Estimated budget figures are planning numbers | `typesafe-budget.js` comments and `/health` `basis: ESTIMATED` | They are not invoices |
| Narrow question set is a proposal | Not loaded by the adapter | Shipping it as the production body would change call payload and is out of scope |

## Unverified hypotheses from the public X post

Source, not evidence: https://x.com/razeden0/status/2101981166500815075

Numbers, prices, and rate limits in that post are unverified. They are not copied into code or into `09-accuracy-abstention-report.md`.

| Hypothesis | Check against this integration | Result |
| --- | --- | --- |
| Jev is a decision model (Choice / Score / yes-no), not a writer. The app should keep typed answers and render the UI | Production questions are Choice and Noul. Fusion maps them to state ids and allowed phrases. Extra prose is dropped | Matches how this repo already works. The lab keeps that rule and does not add a Score question |
| Prefer many narrow questions over one broad judgment, and combine them in code | Production uses one 12-way Choice plus one Noul. The narrow set splits quotation, loaded language, false dilemma, claim support, source independence, missing context, and abstain | The broad Choice is still what production sends. The narrow set is shadow-only until a later reviewed swap |
| Several questions in one request may run in parallel, if provenance survives | This client already puts both production questions in one body per span. Question ids are application keys. The response is not span-tagged | In-span batching stays. Cross-span batching is refused. Provider-side parallelism was not re-measured here |
| Shadow mode first: the model decides, nothing acts, then a human gate for irreversible actions | Lab records recommendations, `acted` is false, CoS stub escalates external or irreversible work | Implemented as replay. Not wired into `/analyze`. Jev still cannot approve the gate |
| A usage lab should route, dry-run, and log before expensive steps | CLI default off, fixture replay, no network, CoS stub with hard-coded denials | The lab does not call the model, so it does not spend. A future live shadow would still need the existing cap, timeout, and kill switch |
| Calibrate on a labeled set and keep an untouched holdout. Do not cite external accuracy percents | Frozen fusion thresholds. Holdout is scored and not used to set the margin. Report says fixture replay only | The 0.15 margin is an explicit shadow choice, not a fitted weight and not a claim about the post’s percentages |
| Do not hardcode the post’s pricing or rate limits | `cost.available` is false. Existing estimated budget constants stay labeled estimated | No new price or rate-limit constant was added from the post |

## Residual risks

- The in-adapter 160 counter is racy at concurrency 4. The `analyze()` pre-check is the guard that matters. Direct adapter callers, including pin verify, do not get that pre-check.
- Shadow disagreement can look like model error when it is a missing text marker or an upstream abstention.
- A later patch could import the lab from `analyze.js` and accidentally act on `final_action`. Tests currently assert `analyze.js`, `server.js`, `config.js`, and `adapters/jev.js` do not reference `jev-usage-lab`.
- Claim-support options include `supported` and `contradicted` so the log can show a bad answer. The policy hold is the control. If a future mapper trusts `model_option` instead of `final_action`, it would violate the contract.
- CoS `route` can still be the recommendation when every gate passes. It is not execution, but a caller that treats the string `route` as permission would be wrong. `executed` is the field to check, and it is false.
- Fixture F1 on nine calibration rows is a unit-test number. Publishing it as accuracy would violate `VISION.md`.

## Independent QA

Seat Independent QA before any active promotion. This change is default-off and does not alter production calls, but the contract is the spec a later change would implement. QA should read the provenance tests, the claim-support hold, and the CoS denials, not the fixture F1.
