# 04 — CoS routing question set (stub)

File: `media-lens/worker/jev-usage-lab/question-sets/cos-routing.v1.json`.

Id: `cos-routing.v1`. Version: `1`. Status: docs and stub. The full chief-of-staff harness is not in this repo. Nothing here is imported by `server.js` or `analyze.js`.

The stub does not call Jev. `routeFromAnswers` in `media-lens/worker/jev-usage-lab/cos-routing.js` replays typed answers through the same decision builder and then applies gates.

Jev must not authorize a merge, deploy, spend, credential change, or live flag change. Bryant Thornton’s approval is not something the model can grant. The stub’s `authorizations` object is hard-coded false. `executed` and `acted` are false.

## Questions

| Id | Options |
| --- | --- |
| `task_category` | `code_change`, `docs`, `review`, `ops`, `research`, `unknown` |
| `repo_product` | `manipulation_score`, `media_lens`, `clarity`, `other`, `unknown` |
| `external_write_required` | `yes`, `no`, `unknown` |
| `reversible` | `reversible`, `irreversible`, `unknown` |
| `bryant_approval_required` | `required`, `not_required`, `unknown` |
| `enough_context` | `enough`, `missing`, `unknown` |
| `route_decision` | `route`, `clarify`, `hold`, `escalate` |

`repo_product` can say `other`. That does not open another repository. This change does not modify CareReserve or StageForge.

## Gates

`decideCosRoute` overwrites the model’s route:

1. Missing route, or an abstention on `route_decision`, becomes `hold`.
2. `enough_context` other than `enough` becomes `clarify` when the model said context is `missing`, otherwise `hold`.
3. If `external_write_required` is not `no`, or `reversible` is not `reversible`, or `bryant_approval_required` is not `not_required`, or any of those answers is missing or abstained, the recommendation becomes `escalate`.

Step 3 wins over step 2. An irreversible task with missing context escalates. It does not clarify its way into an action.

A recommendation of `route` is still not permission. The reason list includes `recommendation_only_not_authorization`. No code path in the stub performs the route.

## What the stub refuses

- Final prose for the task.
- A manipulation score or a rank, if someone smuggles those keys onto an answer. Extra keys are dropped by name.
- Any true value in `authorizations.merge`, `deploy`, `spend`, `credentials`, or `live_flags`.

This is routing discipline for a future harness. It is not evidence that a model routes well, and it is not an approval from Bryant.
