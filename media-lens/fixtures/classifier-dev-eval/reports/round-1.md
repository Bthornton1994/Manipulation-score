# classifier.dev hillclimb round 1

Synthetic/public-safe fixtures for software consistency only. Not representative real-world accuracy. Thresholds are documented, not met, and not claimed.

Evaluation only. `claimed_thresholds_met` is false. Decision: **revert** (holdout_within_noise). Installed policy: `deterministic_policy`.

Candidate `deterministic_policy_round1_strong_markers_only` is not installed. One rule edit on the train case eval-personal-attack: treat only guaranteed, undeniably, and indisputably as certainty markers. Do not install this rule unless holdout macro F1 improves beyond repeat noise.

Train macro F1 0.5032 to 0.6377 (delta 0.1345). Holdout macro F1 1.0000 to 1.0000 on n=4 (delta 0.0000). A holdout score of 1 on this slice is software consistency. `claimed_thresholds_met` stays false. Repeat noise floor 0.0000. Stall count 1.

Candidate reverted because holdout movement is inside repeat noise. This pilot stops after one round. A later round needs a fresh attributable change and a holdout that has not been used to write that change.

Holdout span text is omitted. Cost USD: 0. Network calls: 0. Effort: N/A. Model: none.

## Train mismatches after the candidate

- eval-urgency-pressure: expected urgency, predicted none

## Holdout mismatches, baseline and candidate

Baseline: 0. Candidate: 0. Case ids only.

## Routing

For this bounded fixture, grader, and report task, the routing recommendation is Sonnet 5.5 (claude-sonnet-5-5). Keep the Opus-oriented workflow for methodology judgment, safety-claim wording, and unbounded product changes. This pilot does not change global model assignments.

Quality: not_measured_live. Safety: Model routing is not a safety control. Merge readiness for this pilot uses the deterministic grader and tests. An LLM is not the judge. Live URL, feeds, Medialyst, and classifier.dev stay off. Cost: Fixture path cost_usd is 0. Live comparison cost was not measured. Latency: Reported latency is fixture-declared or the local policy constant of 1 ms. Live latency was not measured. Uncertainty: No paired model repeats. Deterministic grader repeat delta is 0. Case counts are small, so a nonzero F1 move would still be software consistency, not population accuracy.

Model sweep: BLOCKED. ANTHROPIC_API_KEY is absent. No Messages API call is implemented in this pilot. Messages API migration applied: false.

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
