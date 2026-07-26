import argparse
import json
import sys

from manipulation_score import BeneishInputs, calculate_m_score, interpret_m_score


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calculate the Beneish M-Score from financial ratios."
    )
    for field in BeneishInputs.__dataclass_fields__:
        parser.add_argument(f"--{field.replace('_', '-')}", type=float, required=True)
    args = parser.parse_args()

    inputs = BeneishInputs(
        dsri=args.dsri,
        gmi=args.gmi,
        aqi=args.aqi,
        sgi=args.sgi,
        depi=args.depi,
        sgai=args.sgai,
        lvgi=args.lvgi,
        tata=args.tata,
    )
    score = calculate_m_score(inputs)
    result = {
        "m_score": round(score, 4),
        "classification": interpret_m_score(score),
    }
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
