import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

import scripts  # noqa: E402

scripts.__path__ = [str(REPO_ROOT / "scripts"), *scripts.__path__]

from scripts.geography.core import (  # noqa: E402
    NON_BEVERAGE_CLASSIFICATIONS,
    NON_BEVERAGE_PREFIXES,
    is_beverage,
)

FIXTURE_PATH = (
    REPO_ROOT / "tests" / "fixtures" / "geography" / "beverage-selection.json"
)


def test_is_beverage_matches_shared_selection_fixture():
    products = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    for product in products:
        expected = product["expected"]
        assert is_beverage(product) is expected, product["sku"]


def test_is_beverage_covers_all_non_beverage_rules():
    for classification in NON_BEVERAGE_CLASSIFICATIONS:
        assert not is_beverage(
            {"sku": "WRW0001AA", "classification": classification}
        ), classification

    for prefix in NON_BEVERAGE_PREFIXES:
        assert not is_beverage(
            {"sku": f"{prefix}0001AA", "classification": "Red Wine"}
        ), prefix

    assert not is_beverage(
        {"sku": "ABC0001AA", "classification": "Wine product"}
    )
