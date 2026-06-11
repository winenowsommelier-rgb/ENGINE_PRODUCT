import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.geography.core import (  # noqa: E402
    NON_BEVERAGE_CLASSIFICATIONS,
    NON_BEVERAGE_PREFIXES,
    is_beverage,
    load_taxonomy,
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


def test_taxonomy_hash_is_stable_and_integrity_passes(taxonomy_dir):
    first = load_taxonomy(taxonomy_dir)
    second = load_taxonomy(taxonomy_dir)

    assert len(first.batch_hash) == 64
    assert first.batch_hash == second.batch_hash
    assert first.failures == []
    assert first.quarantined_names == set()


def test_orphan_subregion_is_a_failure_and_quarantined(taxonomy_dir):
    path = taxonomy_dir / "subregions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 999, "region_id": 404, "name": "Lost Place"}
    )
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "orphan_subregion:999" in taxonomy.failures
    assert "lost place" in taxonomy.quarantined_names


def test_orphan_region_is_a_failure_and_quarantined(taxonomy_dir):
    path = taxonomy_dir / "regions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 998, "country_id": 404, "name": "Lost Region"}
    )
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "orphan_region:998" in taxonomy.failures
    assert "lost region" in taxonomy.quarantined_names


def test_cross_level_name_is_quarantined(taxonomy_dir):
    path = taxonomy_dir / "subregions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 102, "region_id": 11, "name": "Cognac"}
    )
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "cross_level:france:cognac" in taxonomy.failures
    assert "cognac" in taxonomy.quarantined_names


def test_duplicate_normalized_name_under_same_parent_is_quarantined(
    taxonomy_dir,
):
    path = taxonomy_dir / "regions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 12, "country_id": 1, "name": "  BORDEAUX  "}
    )
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "duplicate_region:(1, 'bordeaux')" in taxonomy.failures
    assert "bordeaux" in taxonomy.quarantined_names


def test_ambiguous_alias_is_a_failure(taxonomy_dir):
    path = taxonomy_dir / "geography-aliases.json"
    doc = json.loads(path.read_text())
    doc["country"].append(
        {"alias": "French Republic", "canonical": "Missing"}
    )
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert (
        "ambiguous_alias:country:french republic" in taxonomy.failures
    )
    assert "french republic" not in taxonomy.aliases["country"]
