# classifier.dev hillclimb baseline

Synthetic/public-safe fixtures for software consistency only. Not representative real-world accuracy. Thresholds are documented, not met, and not claimed.

Evaluation only. `claimed_thresholds_met` is false. Base SHA `1398d17d69b1ad2f93a80823d7a68b1b6e6baf93`. Harness `cdev-hillclimb-0.1.0`. Model: none. Effort: N/A. Cost USD: 0. Network calls: 0. Repeats: 2. Latency source: fixture_declared_or_policy_constant.

Holdout span text is omitted from this report. Recorded deterministic_policy matches the local function: true.

## Scores

| path | split | n | macro_f1 | fp | fn | abstention_rate | latency_ms_mean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| direct_jev | train | 7 | 1.0000 | 0 | 0 | 0.2857 | 4.0000 |
| cdev_fast | train | 7 | 1.0000 | 0 | 0 | 0.2857 | 10.8571 |
| cdev_smart | train | 7 | 1.0000 | 0 | 0 | 0.2857 | 34.7143 |
| cascade | train | 7 | 1.0000 | 0 | 0 | 0.4286 | 17.5714 |
| deterministic_policy | train | 7 | 0.5032 | 1 | 1 | 0.0000 | 1.0000 |
| deterministic_policy_function | train | 7 | 0.5032 | 1 | 1 | 0.0000 | 1.0000 |
| direct_jev | holdout | 4 | 1.0000 | 0 | 0 | 0.2500 | 4.2500 |
| cdev_fast | holdout | 4 | 0.5714 | 0 | 1 | 0.2500 | 10.5000 |
| cdev_smart | holdout | 4 | 0.5714 | 1 | 0 | 0.2500 | 35.7500 |
| cascade | holdout | 4 | 0.5714 | 0 | 1 | 0.2500 | 6.2500 |
| deterministic_policy | holdout | 4 | 1.0000 | 0 | 0 | 0.0000 | 1.0000 |
| deterministic_policy_function | holdout | 4 | 1.0000 | 0 | 0 | 0.0000 | 1.0000 |

## Uncertainty

Repeat noise on this deterministic grader is 0. The case count is too small to support a population accuracy claim. Population interval: none.

## Routing

For this bounded fixture, grader, and report task, the routing recommendation is Sonnet 5.5 (claude-sonnet-5-5). Keep the Opus-oriented workflow for methodology judgment, safety-claim wording, and unbounded product changes. This pilot does not change global model assignments.

Quality: not_measured_live. Safety: Model routing is not a safety control. Merge readiness for this pilot uses the deterministic grader and tests. An LLM is not the judge. Live URL, feeds, Medialyst, and classifier.dev stay off. Cost: Fixture path cost_usd is 0. Live comparison cost was not measured. Latency: Reported latency is fixture-declared or the local policy constant of 1 ms. Live latency was not measured. Uncertainty: No paired model repeats. Deterministic grader repeat delta is 0. Case counts are small, so a nonzero F1 move would still be software consistency, not population accuracy.

Model sweep: BLOCKED. ANTHROPIC_API_KEY is absent. No Messages API call is implemented in this pilot.

## Evidence

Supports:

- The deterministic grader agrees with itself on a repeated grade of the same outputs and on a reversed prediction order.
- The tune command reads cases.train.json and holdout-ids.json. It does not open cases.holdout.json or the full catalog.
- Round 1 moves train macro F1 and leaves holdout macro F1 unchanged, so the candidate is reverted.
- The fixture path records cost_usd 0 and network_calls 0.

Does not support:

- Real-world accuracy, sensitivity, specificity, or fairness.
- Meeting documented acceptance thresholds. claimed_thresholds_met is false.
- Production readiness, live URL quality, feed quality, or classifier.dev quality.
- A kept edit to deterministic_policy. The installed rule remains the baseline.
- A measured quality, cost, or latency difference between an Opus-oriented workflow and Sonnet 5.5. The live sweep is BLOCKED.
