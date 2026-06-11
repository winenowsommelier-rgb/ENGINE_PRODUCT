import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.geography.core import (  # noqa: E402
    NON_BEVERAGE_CLASSIFICATIONS,
    NON_BEVERAGE_PREFIXES,
    classify_product,
    geography_basis,
    is_beverage,
    load_taxonomy,
    source_fingerprint,
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


def product(**overrides):
    row = {
        "id": "product-1",
        "sku": "LBD0006CN",
        "name": "St-Rémy Brandy",
        "classification": "Brandy",
        "country": "France",
        "region": "Cognac",
        "subregion": "Grande Champagne",
        "updated_at": "2026-06-11T00:00:00Z",
    }
    row.update(overrides)
    return row


def test_source_fingerprint_is_canonical_and_changes_with_geography():
    first = product(country=" France ", region="Cognac")
    equivalent = dict(reversed(list(first.items())))
    changed = product(country="France", region="Bordeaux")

    assert source_fingerprint(first) == source_fingerprint(equivalent)
    assert source_fingerprint(first) != source_fingerprint(changed)
    assert len(source_fingerprint(first)) == 64


@pytest.mark.parametrize(
    ("classification", "name", "expected"),
    [
        ("Brandy", "St-Rémy Brandy", "protected_origin"),
        ("Red Wine", "Château Test", "protected_origin"),
        ("Gin", "London Dry Gin", "production_location"),
        ("Beer", "Lager", "production_location"),
        ("Spirit", "A Mystery", "unknown"),
        ("Red Wine", "Holiday Mixed Pack", "multi_region_blend"),
        ("Cognac", "Assorted Cognac Selection", "multi_region_blend"),
    ],
)
def test_geography_basis(classification, name, expected):
    assert geography_basis(
        product(classification=classification, name=name)
    ) == expected


def test_classify_valid_exact_path(taxonomy_dir):
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(product(), taxonomy)

    assert result == {
        "sku": "LBD0006CN",
        "name": "St-Rémy Brandy",
        "classification": "Brandy",
        "old_geography": {
            "country": "France",
            "region": "Cognac",
            "subregion": "Grande Champagne",
        },
        "new_geography": {
            "country": "France",
            "region": "Cognac",
            "subregion": "Grande Champagne",
        },
        "taxonomy_ids": {
            "country_id": 1,
            "region_id": 10,
            "subregion_id": 100,
        },
        "geography_basis": "protected_origin",
        "taxonomy_hash": taxonomy.batch_hash,
        "source_fingerprint": source_fingerprint(product()),
        "status": "valid_exact",
        "reason_codes": [],
    }


def test_case_unicode_and_repeated_spaces_are_mechanical_corrections(
    taxonomy_dir,
):
    taxonomy = load_taxonomy(taxonomy_dir)
    row = product(
        country="ＦＲＡＮＣＥ",
        region="  COGNAC  ",
        subregion="Grande   Champagne",
    )

    result = classify_product(row, taxonomy)

    assert result["status"] == "exact_mechanical_correction"
    assert result["new_geography"] == {
        "country": "France",
        "region": "Cognac",
        "subregion": "Grande Champagne",
    }
    assert result["reason_codes"] == ["canonical_format_correction"]


def test_two_part_compound_is_restructure_review(taxonomy_dir):
    taxonomy = load_taxonomy(taxonomy_dir)
    row = product(region="Cognac | Grande Champagne", subregion="")

    result = classify_product(row, taxonomy)

    assert result["status"] == "exact_restructure_review"
    assert result["new_geography"] == {
        "country": "France",
        "region": "Cognac",
        "subregion": "Grande Champagne",
    }
    assert result["reason_codes"] == ["compound_region_restructure"]


def test_compound_conflicting_with_current_subregion_is_evidence_review(
    taxonomy_dir,
):
    taxonomy = load_taxonomy(taxonomy_dir)
    row = product(
        region="Cognac | Grande Champagne", subregion="Pauillac"
    )

    result = classify_product(row, taxonomy)

    assert result["status"] == "evidence_review"
    assert result["reason_codes"] == ["compound_subregion_conflict"]


def test_wrong_parent_subregion_is_evidence_review(taxonomy_dir):
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(
        product(region="Bordeaux", subregion="Grande Champagne"),
        taxonomy,
    )

    assert result["status"] == "evidence_review"
    assert result["reason_codes"] == ["subregion_parent_mismatch"]


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"country": ""}, "missing_country"),
        ({"region": ""}, "missing_region"),
        ({"country": "Atlantis"}, "unknown_country"),
        ({"region": "Champagne"}, "unknown_region"),
        ({"subregion": "Borderies"}, "unknown_subregion"),
        ({"region": "Cognac | Grande | Champagne"}, "malformed_compound"),
    ],
)
def test_missing_and_unknown_geography_requires_evidence_review(
    taxonomy_dir, overrides, reason
):
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(product(**overrides), taxonomy)

    assert result["status"] == "evidence_review"
    assert result["reason_codes"] == [reason]


@pytest.mark.parametrize(
    ("classification", "name", "expected_status", "expected_reason"),
    [
        (
            "Brandy",
            "St-Rémy Brandy",
            "valid_region_only",
            "subregion_not_proven",
        ),
        (
            "Spirit",
            "Unknown Spirit",
            "valid_region_only",
            "subregion_not_proven",
        ),
        (
            "Gin",
            "London Dry Gin",
            "legitimately_blank",
            "subregion_not_applicable",
        ),
        (
            "Red Wine",
            "Holiday Mixed Pack",
            "legitimately_blank",
            "multi_region_blend",
        ),
    ],
)
def test_blank_subregion_status_depends_on_basis(
    taxonomy_dir,
    classification,
    name,
    expected_status,
    expected_reason,
):
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(
        product(
            classification=classification,
            name=name,
            subregion="",
        ),
        taxonomy,
    )

    assert result["status"] == expected_status
    assert result["reason_codes"] == [expected_reason]
    assert result["taxonomy_ids"]["subregion_id"] is None


def test_quarantined_path_is_taxonomy_blocked(taxonomy_dir):
    path = taxonomy_dir / "subregions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 102, "region_id": 11, "name": "Cognac"}
    )
    path.write_text(json.dumps(doc))
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(
        product(region="cognac", subregion=""), taxonomy
    )

    assert result["status"] == "taxonomy_blocked"
    assert result["reason_codes"] == ["quarantined_region"]


@pytest.mark.parametrize(
    ("filename", "duplicate", "reason"),
    [
        (
            "countries.json",
            {"id": 2, "name": " FRANCE ", "iso": "FX"},
            "quarantined_country",
        ),
        (
            "regions.json",
            {"id": 12, "country_id": 1, "name": " COGNAC "},
            "quarantined_region",
        ),
        (
            "subregions.json",
            {
                "id": 102,
                "region_id": 10,
                "name": " GRANDE CHAMPAGNE ",
            },
            "quarantined_subregion",
        ),
    ],
)
def test_ambiguous_match_lists_are_taxonomy_blocked(
    taxonomy_dir, filename, duplicate, reason
):
    path = taxonomy_dir / filename
    doc = json.loads(path.read_text())
    doc["data"].append(duplicate)
    path.write_text(json.dumps(doc))
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(product(), taxonomy)

    assert result["status"] == "taxonomy_blocked"
    assert result["reason_codes"] == [reason]


def test_duplicate_id_conflict_is_taxonomy_blocked(taxonomy_dir):
    path = taxonomy_dir / "regions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 10, "country_id": 1, "name": "Armagnac"}
    )
    path.write_text(json.dumps(doc))
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(product(), taxonomy)

    assert result["status"] == "taxonomy_blocked"
    assert result["reason_codes"] == ["quarantined_region"]


def test_redundant_subregion_is_cleared_when_safe(taxonomy_dir):
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(
        product(region="Bordeaux", subregion="Bordeaux"), taxonomy
    )

    assert result["status"] == "exact_mechanical_correction"
    assert result["new_geography"]["subregion"] == ""
    assert result["taxonomy_ids"]["subregion_id"] is None
    assert result["reason_codes"] == ["redundant_subregion_cleared"]


def test_redundant_subregion_is_blocked_when_same_name_is_canonical(
    taxonomy_dir,
):
    path = taxonomy_dir / "subregions.json"
    doc = json.loads(path.read_text())
    doc["data"].append(
        {"id": 102, "region_id": 10, "name": "Cognac"}
    )
    path.write_text(json.dumps(doc))
    taxonomy = load_taxonomy(taxonomy_dir)

    result = classify_product(
        product(region="Cognac", subregion="Cognac"), taxonomy
    )

    assert result["status"] == "taxonomy_blocked"
    assert result["reason_codes"] == ["quarantined_region"]


def test_approved_parent_scoped_aliases_are_mechanical(taxonomy_dir):
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

    result = classify_product(
        product(
            country="French Republic",
            region="Charente",
            subregion="Grande Fine Champagne",
        ),
        taxonomy,
    )

    assert result["status"] == "exact_mechanical_correction"
    assert result["new_geography"] == {
        "country": "France",
        "region": "Cognac",
        "subregion": "Grande Champagne",
    }
    assert result["reason_codes"] == ["approved_alias_correction"]
