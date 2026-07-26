from dataclasses import dataclass
from typing import Literal

MANIPULATION_THRESHOLD = -1.78


@dataclass(frozen=True)
class BeneishInputs:
    """Financial ratios for the 8-variable Beneish M-Score model."""

    dsri: float  # Days Sales in Receivables Index
    gmi: float  # Gross Margin Index
    aqi: float  # Asset Quality Index
    sgi: float  # Sales Growth Index
    depi: float  # Depreciation Index
    sgai: float  # SG&A Index
    lvgi: float  # Leverage Index
    tata: float  # Total Accruals to Total Assets


def calculate_m_score(inputs: BeneishInputs) -> float:
    """Return the Beneish M-Score for the provided financial ratios."""
    return (
        -4.84
        + 0.92 * inputs.dsri
        + 0.528 * inputs.gmi
        + 0.404 * inputs.aqi
        + 0.892 * inputs.sgi
        + 0.115 * inputs.depi
        - 0.172 * inputs.sgai
        + 4.679 * inputs.tata
        - 0.327 * inputs.lvgi
    )


def interpret_m_score(
    score: float, threshold: float = MANIPULATION_THRESHOLD
) -> Literal["likely_manipulator", "unlikely_manipulator"]:
    """Classify a score using the standard Beneish threshold."""
    if score > threshold:
        return "likely_manipulator"
    return "unlikely_manipulator"
