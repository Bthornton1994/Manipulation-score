"""Offline DeepEval pilot for the Media Lens classifier-dev eval fixtures.

Development/test evaluation only. Scores recorded synthetic path outputs in
media-lens/fixtures/classifier-dev-eval/recorded-paths.json against the
fixture expected labels in cases.json with a deterministic, code-computed
DeepEval metric. No model is called and no network is used.

Expected labels come from the fixtures, never from Jev, so Jev is not used to
certify Jev. The deterministic_policy rows are checked against the JS policy
by tests/media-lens-deepeval-sidecar.test.js.

Results are software-consistency checks on synthetic fixtures. They are not
real-world accuracy and never meet or claim the documented thresholds.

Usage:
    python run_offline_eval.py [--out report.json]
    python run_offline_eval.py --llm-judge   # reports BLOCKED; see README
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Must be set before deepeval is imported.
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "media-lens" / "fixtures" / "classifier-dev-eval"
PATHS = ("direct_jev", "cdev_fast", "cdev_smart", "cascade", "deterministic_policy")
DISCLAIMER = (
    "Synthetic/public-safe fixtures for software consistency only. "
    "Not representative real-world accuracy. Thresholds are documented, not met, and not claimed."
)


def label_key(path):
    # Mirrors evaluateEvalHarness in worker/classifier-dev/eval-harness.js.
    return "jev" if path in ("direct_jev", "deterministic_policy") else "cdev"


def load_fixtures():
    cases = json.loads((FIXTURE_DIR / "cases.json").read_text(encoding="utf-8"))["cases"]
    recorded = json.loads((FIXTURE_DIR / "recorded-paths.json").read_text(encoding="utf-8"))
    return cases, recorded


def build_metric_class():
    try:
        from deepeval.metrics import BaseMetric
        from deepeval.test_case import LLMTestCase
    except ImportError as exc:
        sys.exit(
            "deepeval is not installed. Create a venv in this directory and "
            "`pip install -r requirements.txt` after the pin is filled in (see README). "
            f"Import error: {exc}"
        )

    class FixtureLabelMatch(BaseMetric):
        """Exact match of a recorded path label to the fixture expected label."""

        def __init__(self, threshold=1.0):
            self.threshold = threshold
            self.include_reason = True
            self.async_mode = False
            self.strict_mode = True
            self.evaluation_model = None

        def measure(self, test_case, *args, **kwargs):
            self.score = 1.0 if test_case.actual_output == test_case.expected_output else 0.0
            self.success = self.score >= self.threshold
            self.reason = f"expected={test_case.expected_output} actual={test_case.actual_output}"
            return self.score

        async def a_measure(self, test_case, *args, **kwargs):
            return self.measure(test_case)

        def is_successful(self):
            return bool(self.success)

        @property
        def __name__(self):
            return "Fixture Label Match"

    return FixtureLabelMatch, LLMTestCase


def evaluate(cases, recorded):
    metric_cls, test_case_cls = build_metric_class()
    report_paths = {}
    for path in PATHS:
        rows = {row["caseId"]: row for row in recorded[path]}
        key = label_key(path)
        per_case = []
        scored = matched = abstained = 0
        for case in cases:
            row = rows.get(case["id"])
            if row is None:
                sys.exit(f"missing recorded prediction for {path}/{case['id']}")
            expected = case["label"][key]
            if row.get("abstain"):
                abstained += 1
                per_case.append({"case_id": case["id"], "expected": expected, "actual": None, "abstain": True, "match": None})
                continue
            test_case = test_case_cls(
                input=case["span"]["text"],
                actual_output=str(row["label"]),
                expected_output=expected,
            )
            metric = metric_cls()
            score = metric.measure(test_case)
            scored += 1
            matched += int(score == 1.0)
            per_case.append({"case_id": case["id"], "expected": expected, "actual": row["label"], "abstain": False, "match": score == 1.0})
        report_paths[path] = {
            "label_key": key,
            "n": len(cases),
            "scored": scored,
            "abstention_rate": abstained / len(cases) if cases else 0,
            "exact_match_rate_on_scored": matched / scored if scored else 0,
            "cases": per_case,
        }
    return {
        "disclaimer": DISCLAIMER,
        "evaluation_only": True,
        "claimed_thresholds_met": False,
        "metric": "deepeval custom BaseMetric: Fixture Label Match (deterministic, no model)",
        "model_graded_metrics": "NOT RUN",
        "paths": report_paths,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", help="write the JSON report here instead of stdout")
    parser.add_argument(
        "--llm-judge",
        action="store_true",
        help="model-graded metrics; not implemented in this pilot and always reports BLOCKED",
    )
    args = parser.parse_args()

    if args.llm_judge:
        print(json.dumps({
            "model_graded_metrics": "BLOCKED",
            "reason": "Requires a judge-model API key and owner approval for billable calls. "
                      "Not configured in this pilot; no call was made.",
            "claimed_thresholds_met": False,
        }, indent=2))
        return 2

    cases, recorded = load_fixtures()
    report = json.dumps(evaluate(cases, recorded), indent=2)
    if args.out:
        Path(args.out).write_text(report + "\n", encoding="utf-8")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
