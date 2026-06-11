import json
from pathlib import Path

from scripts.geography.core import is_beverage


FIXTURE_PATH = (
    Path(__file__).parents[1] / "fixtures" / "geography" / "beverage-selection.json"
)


def test_is_beverage_matches_shared_selection_fixture():
    products = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    for product in products:
        expected = product["expected"]
        assert is_beverage(product) is expected, product["sku"]
