from copy import deepcopy

from scripts import build_explore_taxonomy as builder


def _usa_napa_fixture():
    return {
        "countries": [
            {"id": 1, "name": "USA", "slug": "usa", "latitude": 39.8, "longitude": -98.6},
        ],
        "regions": [
            {
                "id": 66,
                "name": "California",
                "slug": "california",
                "latitude": 37.3,
                "longitude": -119.5,
                "parent_id": 1,
                "parent_name": "USA",
            },
            {
                "id": 67,
                "name": "Napa",
                "slug": "napa",
                "latitude": 38.5,
                "longitude": -122.3,
                "parent_id": 1,
                "parent_name": "USA",
            },
        ],
        "subregions": [
            {
                "id": 144,
                "name": "Napa Valley",
                "slug": "napa-valley",
                "latitude": 38.5,
                "longitude": -122.3,
                "parent_id": 67,
                "parent_name": "Napa",
                "grandparent_name": "USA",
            },
            {
                "id": 204,
                "name": "Rutherford",
                "slug": "rutherford",
                "latitude": 38.5,
                "longitude": -122.4,
                "parent_id": 67,
                "parent_name": "Napa",
                "grandparent_name": "USA",
            },
        ],
        "appellations": [],
    }


def test_napa_valley_is_subregion_of_california_not_fake_napa_region():
    tax = _usa_napa_fixture()

    builder.normalize_taxonomy_hierarchy(tax)
    lookups = builder.build_lookups(tax)
    _, region_by_name, region_by_name_only, sub_by_name, _ = lookups

    region = builder.resolve_region("Napa Valley", "USA", region_by_name, region_by_name_only)
    subregion = builder.resolve_subregion("Napa Valley", region["name"], sub_by_name, {})

    assert region["name"] == "California"
    assert subregion["name"] == "Napa Valley"
    assert subregion["parent_name"] == "California"
    assert subregion["parent_id"] == 66


def test_redundant_region_subregion_uses_single_region_pin_only():
    tax = _usa_napa_fixture()
    builder.normalize_taxonomy_hierarchy(tax)

    product = {"country": "USA", "region": "Napa Valley", "subregion": "Napa Valley"}
    region_name, sub_name = builder.normalize_product_geography(product)

    assert region_name == "Napa Valley"
    assert sub_name == ""


def test_zero_count_regions_are_not_emitted_unless_they_are_needed_parents():
    tax = _usa_napa_fixture()
    builder.normalize_taxonomy_hierarchy(tax)

    region_counts = {66: {"wine": 1, "spirits": 0, "beer": 0, "sake": 0, "total": 1}}
    sub_counts = {144: {"wine": 1, "spirits": 0, "beer": 0, "sake": 0, "total": 1}}

    included = builder.included_region_ids(tax, region_counts, sub_counts)

    assert 66 in included
    assert 67 not in included


def test_subregion_resolution_does_not_fallback_to_wrong_parent():
    tax = _usa_napa_fixture()
    builder.normalize_taxonomy_hierarchy(tax)
    _, _, _, sub_by_name, sub_by_name_only = builder.build_lookups(tax)

    assert builder.resolve_subregion("Rutherford", "California", sub_by_name, sub_by_name_only) is None
