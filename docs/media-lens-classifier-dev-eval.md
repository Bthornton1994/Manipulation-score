# classifier.dev evaluation harness (scaffold)

Status: **evaluation-only**. Not production-ready. Not a second independent model. Direct Jev remains the Media Lens primary typed classifier. classifier.dev is a selective low-confidence escalation behind a default-off flag. The default requested tier is `fast` when `MEDIA_LENS_CLASSIFIER_DEV_TIER` is unset or empty. Smart requires the exact value `MEDIA_LENS_CLASSIFIER_DEV_TIER=smart`.

Related to [Issue #118](https://github.com/Bthornton1994/Manipulation-score/issues/118). This document does **not** close that issue. AG News / emotion-benchmark figures from provider pages are **not** Media Lens accuracy and must not be cited as such.

## What the harness compares

Fixture-only paths in `media-lens/worker/classifier-dev/eval-harness.js`, seeded by `media-lens/fixtures/classifier-dev-eval/`:

| Path | Meaning |
| --- | --- |
| `direct_jev` | Typed TypeSafe Jev answers (recorded / fixture) |
| `cdev_fast` | classifier.dev `tier=fast` recorded outputs |
| `cdev_smart` | classifier.dev `tier=smart` recorded outputs |
| `cascade` | Jev primary + selective escalation policy (default requested tier `fast`) |
| `deterministic_policy` | Local rules only (for example absolute-quantifier candidates) |

Default CI never calls classifier.dev. Live URL and live pasted-text stay disabled.

Production HTTPS calls, when the evaluation flag is on, use only `POST https://classifier.dev/v1/classify` with connect-time IP pinning. Other `MEDIA_LENS_CLASSIFIER_DEV_BASE_URL` hosts fail closed before connect. Redirects are not followed. `agree_calibrated` requires reported model `jev-1.13.0`; unknown or mixed models are review, not calibrated agreement.

## Placeholder metrics

The harness reports software-consistency numbers on synthetic/public-safe fixtures:

- macro precision / recall / F1
- confusion matrix
- binary false positives / false negatives (signal vs none)
- calibration bands (`low` / `mid` / `high`)
- abstention rate
- mean latency of the recorded path (not a production SLO)

`claimed_thresholds_met` is always `false` in this scaffold.

## Documented acceptance thresholds (not met, not claimed)

These numbers exist so a later owner-approved evaluation has named gates. They are **not** current results.

| Gate | Documented value | Claimed met? |
| --- | --- | --- |
| Macro F1 | 0.80 | no |
| Abstention rate max | 0.35 | no |
| Calibration ECE max | 0.15 | no |
| Disagreement must become review, never a silent winner | policy requirement | harness checks software behavior only |

Do not publish these as sensitivity, specificity, fairness, or real-world accuracy.
