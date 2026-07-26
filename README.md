# Manipulation-score

A Python library and CLI for calculating the [Beneish M-Score](https://en.wikipedia.org/wiki/Beneish_model), a probabilistic model used to flag potential earnings manipulation from financial statement ratios.

## Installation

```bash
pip install -e ".[dev]"
```

## Usage

```python
from manipulation_score import BeneishInputs, calculate_m_score, interpret_m_score

inputs = BeneishInputs(
    dsri=1.2,
    gmi=1.1,
    aqi=1.0,
    sgi=1.3,
    depi=0.9,
    sgai=1.05,
    lvgi=1.0,
    tata=0.08,
)

score = calculate_m_score(inputs)
print(score, interpret_m_score(score))
```

CLI:

```bash
manipulation-score \
  --dsri 1.2 --gmi 1.1 --aqi 1.0 --sgi 1.3 \
  --depi 0.9 --sgai 1.05 --lvgi 1.0 --tata 0.08
```

## Interpretation

Scores above **-1.78** are commonly treated as a warning sign for potential earnings manipulation. The model is a screening tool, not proof of fraud.

## Development

```bash
pytest
```
