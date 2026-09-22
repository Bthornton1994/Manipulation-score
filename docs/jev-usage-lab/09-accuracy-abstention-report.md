# Jev accuracy and abstention report (fixture only)

Generated for review from the Usage Lab replay. Timestamp: 2026-09-22T00:00:00.000Z.

Fixture replay only. Not real-world accuracy, not a production-readiness claim, and not a measurement of an external model.

This report does not cite external accuracy, price, or rate-limit figures. Cost: unavailable (Provider cost is not recorded. External pricing and rate limits are unverified and are not hardcoded.). Network calls performed by this replay: 0.

Thresholds are frozen from `media-lens/worker/fusion.js` plus shadow margin 0.15. `thresholds_fit_on_holdout` is false. Holdout cases were not used to choose thresholds.

Article and span identity is grouped before split assignment. A shared article id and span id stays in one split. Cross-split collisions reassigned: 0. Cases moved off their declared split: 0. The span-abstain gate runs only inside an assigned split, so a calibration record cannot change a holdout score. Suppressed sibling questions are abstentions (`abstained: true`, `selected_option: null`) and are not scored as ordinary decisions.

Question set: `media-lens-narrow.v1` version `1`. `observed_vs_candidate` is derived in the app and is not a Jev question.

## Calibration split

Cases: 12. Abstained: 5. Abstention rate: 0.417. Scored (not abstained): 7. Exact selected-option matches among non-abstentions: 4. Disagreements with the fixture label: 5. Binary false positives: 1. Binary false negatives: 1.

Fixture-declared latency sum (ms): 120. Mean: 10. Fixture-declared call count sum: 12. Basis: `fixture_declared`. These are labels in the fixture file, not measured HTTP.

### authorial_vs_quotation

| actual \\ predicted | authorial | quotation | attributed_paraphrase | uncertain | abstain |
| --- | --- | --- | --- | --- | --- |
| authorial | 1 | 0 | 0 | 0 | 0 |
| quotation | 0 | 1 | 0 | 0 | 0 |
| attributed_paraphrase | 0 | 0 | 0 | 0 | 0 |
| uncertain | 0 | 0 | 0 | 0 | 0 |
| abstain | 0 | 0 | 0 | 0 | 0 |

Calibration bins (non-abstained cases with a class label; rate is exact option match):

| bin | n | correct | rate |
| --- | --- | --- | --- |
| [0,0.5) | 0 | 0 | n/a |
| [0.5,0.7) | 0 | 0 | n/a |
| [0.7,1] | 2 | 2 | 1 |

### emotionally_loaded_language

| actual \\ predicted | loaded_moralized | not_loaded | abstain |
| --- | --- | --- | --- |
| loaded_moralized | 1 | 0 | 1 |
| not_loaded | 1 | 0 | 0 |
| abstain | 0 | 0 | 0 |

Binary positive `loaded_moralized` (abstentions excluded): tp 1, fp 1, fn 0, tn 0, precision 0.5, recall 1, f1 0.667.

Calibration bins (non-abstained cases with a class label; rate is exact option match):

| bin | n | correct | rate |
| --- | --- | --- | --- |
| [0,0.5) | 0 | 0 | n/a |
| [0.5,0.7) | 1 | 1 | 1 |
| [0.7,1] | 1 | 0 | 0 |

### false_dilemma

| actual \\ predicted | present | absent | abstain |
| --- | --- | --- | --- |
| present | 0 | 1 | 1 |
| absent | 0 | 0 | 0 |
| abstain | 0 | 0 | 1 |

Binary positive `present` (abstentions excluded): tp 0, fp 0, fn 1, tn 0, precision n/a, recall 0, f1 n/a.

Calibration bins (non-abstained cases with a class label; rate is exact option match):

| bin | n | correct | rate |
| --- | --- | --- | --- |
| [0,0.5) | 0 | 0 | n/a |
| [0.5,0.7) | 0 | 0 | n/a |
| [0.7,1] | 1 | 0 | 0 |

### claim_support_status

| actual \\ predicted | supported | contradicted | mixed | unclear | not_checked | abstain |
| --- | --- | --- | --- | --- | --- | --- |
| supported | 0 | 0 | 0 | 0 | 0 | 0 |
| contradicted | 0 | 0 | 0 | 0 | 0 | 0 |
| mixed | 0 | 0 | 0 | 0 | 0 | 0 |
| unclear | 0 | 0 | 0 | 0 | 0 | 0 |
| not_checked | 1 | 0 | 0 | 0 | 0 | 0 |
| abstain | 0 | 0 | 0 | 0 | 0 | 0 |

Calibration bins (non-abstained cases with a class label; rate is exact option match):

| bin | n | correct | rate |
| --- | --- | --- | --- |
| [0,0.5) | 0 | 0 | n/a |
| [0.5,0.7) | 0 | 0 | n/a |
| [0.7,1] | 1 | 0 | 0 |

### important_context_missing

| actual \\ predicted | missing | not_missing | insufficient_context | abstain |
| --- | --- | --- | --- | --- |
| missing | 1 | 0 | 0 | 0 |
| not_missing | 0 | 0 | 0 | 0 |
| insufficient_context | 0 | 0 | 0 | 0 |
| abstain | 0 | 0 | 0 | 0 |

Calibration bins (non-abstained cases with a class label; rate is exact option match):

| bin | n | correct | rate |
| --- | --- | --- | --- |
| [0,0.5) | 0 | 0 | n/a |
| [0.5,0.7) | 0 | 0 | n/a |
| [0.7,1] | 1 | 1 | 1 |

### should_abstain

| actual \\ predicted | abstain | answer |
| --- | --- | --- |
| abstain | 2 | 0 |
| answer | 0 | 0 |

Calibration bins (non-abstained cases with a class label; rate is exact option match):

| bin | n | correct | rate |
| --- | --- | --- | --- |
| [0,0.5) | 0 | 0 | n/a |
| [0.5,0.7) | 0 | 0 | n/a |
| [0.7,1] | 0 | 0 | n/a |


## Untouched holdout

Cases: 4. Abstained: 2. Abstention rate: 0.5. Scored (not abstained): 2. Exact selected-option matches among non-abstentions: 1. Disagreements with the fixture label: 1. Binary false positives: 0. Binary false negatives: 1.

Fixture-declared latency sum (ms): 80. Mean: 20. Fixture-declared call count sum: 4. Basis: `fixture_declared`. These are labels in the fixture file, not measured HTTP.

### authorial_vs_quotation

| actual \\ predicted | authorial | quotation | attributed_paraphrase | uncertain | abstain |
| --- | --- | --- | --- | --- | --- |
| authorial | 1 | 0 | 0 | 0 | 0 |
| quotation | 0 | 0 | 0 | 0 | 0 |
| attributed_paraphrase | 0 | 0 | 0 | 0 | 0 |
| uncertain | 0 | 0 | 0 | 0 | 0 |
| abstain | 0 | 0 | 0 | 0 | 1 |

Calibration bins (non-abstained cases with a class label; rate is exact option match):

| bin | n | correct | rate |
| --- | --- | --- | --- |
| [0,0.5) | 0 | 0 | n/a |
| [0.5,0.7) | 0 | 0 | n/a |
| [0.7,1] | 1 | 1 | 1 |

### emotionally_loaded_language

| actual \\ predicted | loaded_moralized | not_loaded | abstain |
| --- | --- | --- | --- |
| loaded_moralized | 0 | 1 | 0 |
| not_loaded | 0 | 0 | 0 |
| abstain | 0 | 0 | 1 |

Binary positive `loaded_moralized` (abstentions excluded): tp 0, fp 0, fn 1, tn 0, precision n/a, recall 0, f1 n/a.

Calibration bins (non-abstained cases with a class label; rate is exact option match):

| bin | n | correct | rate |
| --- | --- | --- | --- |
| [0,0.5) | 0 | 0 | n/a |
| [0.5,0.7) | 0 | 0 | n/a |
| [0.7,1] | 1 | 0 | 0 |


The holdout split is scored with the same frozen thresholds. It is not a representative sample of articles, outlets, or people.

## Adversarial and distribution-shift stubs

Cases: 3. Invariants pass: true. Failures: none.

These stubs check that unknown options abstain, that smuggled score or rank fields are dropped, and that source independence abstains when fewer than two source ids are present. They are not an adversarial-robustness claim.

## Historical fixture comparison

Production-shaped answers under `media-lens/fixtures/jev/` were replayed locally and compared with Jev observations in `media-lens/fixtures/expected/`. No span text is stored in the comparison rows.

Rows: 18. Matches: 17. Disagreements: 1.

- `synthetic-05-paywall` / `span-3`: expected vague_authority/candidate vs graph none/n/a

The synthetic-05-paywall span-3 row is the pipeline-versus-answer-file case: the stored graph abstains for insufficient text and paywall, so it has no Jev observation, while the recorded answer file still has vague_authority. The shadow projection of that answer is candidate because no deterministic marker flag is stored. This is not a tuned accuracy result.

A disagreement here means the shadow projection (frozen probability thresholds, and candidate downgrade when a marker-gated choice has no marker flag) did not match the stored graph observation. It is not an accuracy score.

## What this file is not

It is not evidence that Jev is correct on live articles. It is not permission to enable live mode, change a flag, merge, deploy, or close Issue #118.
