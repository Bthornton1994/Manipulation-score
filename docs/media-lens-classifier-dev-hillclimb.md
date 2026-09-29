# classifier.dev hillclimb pilot

Status: **evaluation-only**. Not production-ready. Not a second metric system. This workflow calls `evaluatePath` in `media-lens/worker/classifier-dev/eval-harness.js`. It does not enable `MEDIA_LENS_ENABLE_LIVE_URL`, feeds, Medialyst, or classifier.dev. `claimed_thresholds_met` stays false.

Vision check: **Aligns with constraints**. Relevant sections: "Evidence comes before a score" and "Uncertainty must be visible". A regression count on synthetic fixtures is software consistency, the same limit `methodology.html` states for Media Lens. This pilot does not change a user-facing score.

Related, not inputs: `media-lens/fixtures/jev-calibration/` and the Usage Lab holdout in `docs/jev-usage-lab/06-evaluation-harness.md`. This pilot does not score those fixtures and does not fit thresholds from them.

Base SHA for this pilot: `1398d17d69b1ad2f93a80823d7a68b1b6e6baf93`.

## Principles

The scaffold follows the usual eval hillclimb controls for a constrained label set:

- Cases are synthetic public-safe stand-ins for the decision the product actually makes: signal versus none, with hard context, negative controls, and abstain or insufficient text. They are not a population sample.
- The grader is deterministic. The same outputs are graded twice, then graded again with prediction order reversed. Agreement has to hold before a round is meaningful.
- Train and holdout are separate files. The tune command cannot open the holdout case file.
- A round has one attributable change. Round 1's change is the strong-marker rule aimed at train case `eval-personal-attack`.
- Keep the change only when holdout macro F1 improves by more than repeat noise and false positives and false negatives do not increase. Repeat noise on this grader is 0, so a flat holdout reverts.
- Stop a candidate when it is inside that noise. Stop the search after 2–3 consecutive stalls. This pilot runs one round, records stall count 1, and does not open round 2.

An LLM is not the judge for this label set. Merge readiness here is the deterministic grader plus tests. Model routing is not a safety control.

## Seal

| File | Who may read it |
| --- | --- |
| `media-lens/fixtures/classifier-dev-eval/cases.train.json` | Tune command |
| `media-lens/fixtures/classifier-dev-eval/holdout-ids.json` | Tune command. Identifiers only, no span text or labels |
| `media-lens/fixtures/classifier-dev-eval/cases.holdout.json` | Report command, and only when `MEDIA_LENS_EVAL_UNSEAL_HOLDOUT=report` |
| `media-lens/fixtures/classifier-dev-eval/cases.json` | Report command under the same unseal. The original harness test also loads it |
| `media-lens/fixtures/classifier-dev-eval/recorded-paths.json` | Report command under the same unseal |

`node scripts/classifier-dev-hillclimb.js tune` throws if the unseal variable is set, so one process cannot tune and unseal together. Default `npm run eval:cdev-hillclimb` is the tune command.

If a later change is written from holdout failures, that holdout is burned. Replace the holdout file before any keep decision. The committed reports omit holdout span text so the report is a score sheet, not a second copy of the sealed cases.

CI boundary: `node --test tests/*.test.js` is the sealed check. It may load the holdout inside the test process. It does not install the candidate, and it does not call a provider.

## Case authoring

Cases added for this pilot are human-authored concept coverage. The catalog disclaimer records that they were not selected by searching for current-policy errors. The round's motivating case, `eval-personal-attack`, was already in the fixture.

## Reproduce

```bash
npm run eval:cdev-hillclimb
node scripts/classifier-dev-hillclimb.js model-sweep
MEDIA_LENS_EVAL_UNSEAL_HOLDOUT=report node scripts/classifier-dev-hillclimb.js baseline --write
MEDIA_LENS_EVAL_UNSEAL_HOLDOUT=report node scripts/classifier-dev-hillclimb.js round --write
node --test tests/media-lens-classifier-dev-eval.test.js tests/media-lens-classifier-dev-hillclimb.test.js
```

`--write` refreshes:

- `media-lens/fixtures/classifier-dev-eval/reports/baseline.json`
- `media-lens/fixtures/classifier-dev-eval/reports/baseline.md`
- `media-lens/fixtures/classifier-dev-eval/reports/round-1.json`
- `media-lens/fixtures/classifier-dev-eval/reports/round-1.md`

The CLI refuses to write under `docs/`. Do not point it at private traces. These reports are synthetic fixture scores. Cost is 0. Effort is N/A. No model id is recorded because the deterministic path does not call one.

## Round 1

Candidate id: `deterministic_policy_round1_strong_markers_only`.

The installed function `deterministicPolicyPredict` still treats `always`, `never`, `everyone`, `no one`, `guaranteed`, `undeniably`, and `indisputably` as certainty markers. The candidate keeps only the last three. That is the one edit, attributed to the existing train case `eval-personal-attack`.

Train macro F1 moves from 0.5032 to 0.6377. Holdout macro F1 stays 1.0000 on four cases, so the delta is 0, inside the repeat-noise floor. A score of 1 on that slice is software consistency. It is not a met threshold. Decision: **revert**. Stall count: 1. The search is not exhausted at the 2–3 stall stop, and this pilot does not start another round. `cascade.js` is unchanged.

## Sonnet 5.5 routing

For **bounded eval and hillclimb tooling** (fixture files, a deterministic grader, one attributable rule, tests that can reject the rule), the routing recommendation is Sonnet 5.5, model id `claude-sonnet-5-5`.

Use an Opus-oriented workflow when the work is methodology judgment, safety-claim wording, or an unbounded product change. This note does not pin an Opus API model id and does not change global model assignments.

| Check | What this pilot can say |
| --- | --- |
| Quality | Not measured live. The policy round is accepted or rejected by the deterministic grader. |
| Safety | Flags stay off. An LLM is not the merge judge. |
| Cost | Fixture path is 0. A live sweep was not run. |
| Latency | Fixture-declared, or 1 ms for the local policy constant. Live latency was not measured. |
| Uncertainty | No paired model repeats. Grader repeat delta is 0. Small-N uncertainty remains. |

Effort levels `low`, `medium`, `high`, `xhigh`, and `max` appear in the Sonnet 5.5 provider docs, so an effort sweep is a supported API feature. Running it would be new spend. The API key was absent in this run, and this repo path has **no Messages API client**. Migration guidance for `claude-sonnet-5-5` was not copied into the harness. `messages_api_migration_applied` is false. `model-sweep` prints `BLOCKED` and does not open a network call.

Command, still blocked without a client:

```bash
MEDIA_LENS_EVAL_LIVE_MODEL_SWEEP=report node scripts/classifier-dev-hillclimb.js model-sweep
```

## What the evidence supports

- Grader repeat agreement and order agreement on these fixtures.
- The tune file boundary described above.
- Round 1 train movement with a flat holdout, and a revert.
- Fixture cost 0 and zero network calls.

## What the evidence does not support

- Real-world accuracy, sensitivity, specificity, or fairness.
- Documented thresholds being met.
- Production readiness or live classifier.dev quality.
- Keeping the round-1 rule.
- A measured Sonnet versus Opus quality, cost, or latency result.
