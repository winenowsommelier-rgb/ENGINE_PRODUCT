import json
import sys
from pathlib import Path

import pytest

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


def test_taxonomy_hash_changes_when_source_file_changes(taxonomy_dir):
    before = load_taxonomy(taxonomy_dir)
    path = taxonomy_dir / "countries.json"
    doc = json.loads(path.read_text())
    doc["data"][0]["iso"] = "FRA"
    path.write_text(json.dumps(doc))

    after = load_taxonomy(taxonomy_dir)

    assert (
        before.file_hashes["countries.json"]
        != after.file_hashes["countries.json"]
    )
    assert before.batch_hash != after.batch_hash


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


def test_duplicate_country_id_keeps_first_row_and_blocks_child_paths(
    taxonomy_dir,
):
    path = taxonomy_dir / "countries.json"
    doc = json.loads(path.read_text())
    doc["data"].append({"id": 1, "name": "Italy", "iso": "IT"})
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "duplicate_country_id:1" in taxonomy.failures
    assert taxonomy.countries[1]["name"] == "France"
    assert {"france", "italy", "cognac", "bordeaux"} <= (
        taxonomy.quarantined_names
    )


def test_duplicate_region_id_keeps_first_row_and_blocks_child_paths(
    taxonomy_dir,
):
    path = taxonomy_dir / "regions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 10, "country_id": 1, "name": "Armagnac"}
    )
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "duplicate_region_id:10" in taxonomy.failures
    assert taxonomy.regions[10]["name"] == "Cognac"
    assert {"cognac", "armagnac", "grande champagne"} <= (
        taxonomy.quarantined_names
    )


def test_duplicate_subregion_id_keeps_first_row_and_quarantines_all_names(
    taxonomy_dir,
):
    path = taxonomy_dir / "subregions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 100, "region_id": 11, "name": "Saint-Estephe"}
    )
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "duplicate_subregion_id:100" in taxonomy.failures
    assert taxonomy.subregions[100]["name"] == "Grande Champagne"
    assert {"grande champagne", "saint-estephe"} <= (
        taxonomy.quarantined_names
    )


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


@pytest.mark.parametrize(
    "country_aliases",
    [
        [
            {"alias": "French Republic", "canonical": "France"},
            {"alias": "French Republic", "canonical": "Missing"},
        ],
        [
            {"alias": "French Republic", "canonical": "Missing"},
            {"alias": "French Republic", "canonical": "France"},
        ],
    ],
)
def test_ambiguous_alias_is_a_failure(taxonomy_dir, country_aliases):
    path = taxonomy_dir / "geography-aliases.json"
    doc = json.loads(path.read_text())
    doc["country"] = country_aliases
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert (
        "ambiguous_alias:country:french republic" in taxonomy.failures
    )
    assert "french republic" in taxonomy.quarantined_names
    assert "french republic" not in taxonomy.aliases["country"]


def test_country_alias_cannot_shadow_a_canonical_name(taxonomy_dir):
    countries_path = taxonomy_dir / "countries.json"
    countries = json.loads(countries_path.read_text())
    countries["data"].append({"id": 2, "name": "USA", "iso": "US"})
    countries_path.write_text(json.dumps(countries))

    aliases_path = taxonomy_dir / "geography-aliases.json"
    aliases = json.loads(aliases_path.read_text())
    aliases["country"] = [
        {"alias": "France", "canonical": "USA"},
        {"alias": "USA", "canonical": "USA"},
    ]
    aliases_path.write_text(json.dumps(aliases))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "alias_shadows_canonical:country:france" in taxonomy.failures
    assert "france" in taxonomy.quarantined_names
    assert "france" not in taxonomy.aliases["country"]
    assert "usa" not in taxonomy.aliases["country"]


def test_redundant_country_alias_is_ignored(taxonomy_dir):
    path = taxonomy_dir / "geography-aliases.json"
    doc = json.loads(path.read_text())
    doc["country"] = [{"alias": "France", "canonical": "France"}]
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert taxonomy.failures == []
    assert "france" not in taxonomy.quarantined_names
    assert "france" not in taxonomy.aliases["country"]


def test_parent_scoped_region_and_subregion_aliases(taxonomy_dir):
    path = taxonomy_dir / "geography-aliases.json"
    doc = json.loads(path.read_text())
    doc["region"] = [
        {
            "country": "France",
            "alias": "Charente",
            "canonical": "Cognac",
        }
    ]
    doc["subregion"] = [
        {
            "country": "France",
            "region": "Cognac",
            "alias": "Grande Fine Champagne",
            "canonical": "Grande Champagne",
        }
    ]
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert taxonomy.aliases["region"][(1, "charente")] == "cognac"
    assert (
        taxonomy.aliases["subregion"][(10, "grande fine champagne")]
        == "grande champagne"
    )


@pytest.mark.parametrize(
    ("level", "entry"),
    [
        (
            "region",
            {"alias": "Charente", "canonical": "Cognac"},
        ),
        (
            "region",
            {
                "country": "Missing",
                "alias": "Charente",
                "canonical": "Cognac",
            },
        ),
        (
            "subregion",
            {
                "country": "France",
                "alias": "Grande Fine Champagne",
                "canonical": "Grande Champagne",
            },
        ),
        (
            "subregion",
            {
                "country": "France",
                "region": "Missing",
                "alias": "Grande Fine Champagne",
                "canonical": "Grande Champagne",
            },
        ),
    ],
)
def test_parent_scoped_alias_rejects_missing_or_unknown_parent(
    taxonomy_dir, level, entry
):
    path = taxonomy_dir / "geography-aliases.json"
    doc = json.loads(path.read_text())
    doc[level] = [entry]
    path.write_text(json.dumps(doc))

    taxonomy = load_taxonomy(taxonomy_dir)
    alias = entry["alias"].casefold()

    assert f"invalid_alias_parent:{level}:{alias}" in taxonomy.failures
    assert alias in taxonomy.quarantined_names
    assert not taxonomy.aliases[level]


def test_region_alias_rejects_ambiguous_country_parent(taxonomy_dir):
    countries_path = taxonomy_dir / "countries.json"
    countries = json.loads(countries_path.read_text())
    countries["data"].append({"id": 2, "name": " FRANCE ", "iso": "FX"})
    countries_path.write_text(json.dumps(countries))

    aliases_path = taxonomy_dir / "geography-aliases.json"
    aliases = json.loads(aliases_path.read_text())
    aliases["region"] = [
        {
            "country": "France",
            "alias": "Charente",
            "canonical": "Cognac",
        }
    ]
    aliases_path.write_text(json.dumps(aliases))

    taxonomy = load_taxonomy(taxonomy_dir)

    assert "invalid_alias_parent:region:charente" in taxonomy.failures
    assert "charente" in taxonomy.quarantined_names
    assert not taxonomy.aliases["region"]


def test_subregion_alias_rejects_ambiguous_region_parent(taxonomy_dir):
    regions_path = taxonomy_dir / "regions.json"
    regions = json.loads(regions_path.read_text())
    regions["data"].append(
        {"id": 12, "country_id": 1, "name": " COGNAC "}
    )
    regions_path.write_text(json.dumps(regions))

    aliases_path = taxonomy_dir / "geography-aliases.json"
    aliases = json.loads(aliases_path.read_text())
    aliases["subregion"] = [
        {
            "country": "France",
            "region": "Cognac",
            "alias": "Grande Fine Champagne",
            "canonical": "Grande Champagne",
        }
    ]
    aliases_path.write_text(json.dumps(aliases))

    taxonomy = load_taxonomy(taxonomy_dir)

    failure = (
        "invalid_alias_parent:subregion:grande fine champagne"
    )
    assert failure in taxonomy.failures
    assert "grande fine champagne" in taxonomy.quarantined_names
    assert not taxonomy.aliases["subregion"]
