from manipulation_score import BeneishInputs, calculate_m_score, interpret_m_score


def test_calculate_m_score_matches_beneish_formula() -> None:
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

    expected = (
        -4.84
        + 0.92 * 1.2
        + 0.528 * 1.1
        + 0.404 * 1.0
        + 0.892 * 1.3
        + 0.115 * 0.9
        - 0.172 * 1.05
        + 4.679 * 0.08
        - 0.327 * 1.0
    )
    assert score == expected


def test_interpret_m_score_uses_default_threshold() -> None:
    assert interpret_m_score(-1.0) == "likely_manipulator"
    assert interpret_m_score(-2.0) == "unlikely_manipulator"
