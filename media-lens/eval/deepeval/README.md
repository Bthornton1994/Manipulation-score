# DeepEval sidecar (development evaluation only)

An optional Python layer that scores the Media Lens classifier-dev eval fixtures
with DeepEval. It is not part of the product. `package.json`, the worker, the
browser, the Pages bundle, and CI never install or run it.

## What it measures

- Input: `media-lens/fixtures/classifier-dev-eval/cases.json` (synthetic spans
  and expected labels) and `recorded-paths.json` (recorded synthetic outputs for
  `direct_jev`, `cdev_fast`, `cdev_smart`, `cascade`, `deterministic_policy`).
- Metric: a custom DeepEval `BaseMetric`, "Fixture Label Match". It does an
  exact label comparison in code, with no model and no network access.
- Expected labels come from the fixtures. Jev output is never used as ground
  truth for Jev. The `deterministic_policy` rows are checked against the JS
  policy (`deterministicPolicyPredict`) by
  `tests/media-lens-deepeval-sidecar.test.js`.
- Abstentions are counted separately and are not scored, matching
  `worker/classifier-dev/eval-harness.js`.

The results check software consistency on six synthetic cases. They do not
measure real-world accuracy, they do not replace the `node --test` gates or
Independent QA, and they never support a merge or production-readiness claim.
Every report sets `claimed_thresholds_met: false`.

## Run

The exact `deepeval` pin is still pending. See `requirements.txt`. Until a
verified pin is filled in, the runner stops at its import check.

```sh
cd media-lens/eval/deepeval
python -m venv .venv
.venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip
.venv/bin/python run_offline_eval.py --out report.json
```

DeepEval telemetry is disabled by setting `DEEPEVAL_TELEMETRY_OPT_OUT=YES`
before import. The runner never calls `deepeval.evaluate()` or logs in to
Confident AI. It calls `metric.measure()` locally.

## Model-graded metrics

These are not part of this pilot. `--llm-judge` always reports `BLOCKED` and
makes no call. Adding model-graded metrics (for example G-Eval) needs a judge
API key and owner approval for billable calls. They must stay opt-in, stay out
of ordinary CI, and be reported separately from deterministic checks.

## JevEval

No JevEval integration exists in this repository (`JEV_EVAL: NOT_FOUND`, based
on a repository search at base `cd16a2f`).
