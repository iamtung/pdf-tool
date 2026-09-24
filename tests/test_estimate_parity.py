"""Parity: the Python estimator reference and the TS estimator share `estimate.vectors.json`."""
import json
from pathlib import Path

import pytest

from pdftool.core import profile

VECTORS_PATH = Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "estimate.vectors.json"
VECTORS = json.loads(VECTORS_PATH.read_text())


@pytest.mark.parametrize("case", VECTORS, ids=lambda case: case["name"])
def test_estimate_outcome_matches_shared_vectors(case):
    got = profile.estimate_outcome(case["input"])
    expected = case["expected"]
    assert got["kind"] == expected["kind"]
    if expected["kind"] == "unsupported":
        assert got == expected
        return
    assert got["originalBytes"] == expected["originalBytes"]
    assert abs(got["estimatedBytes"] - expected["estimatedBytes"]) <= 1
    assert got.get("level") == expected.get("level")
    assert got.get("targetMet") == expected.get("targetMet")
