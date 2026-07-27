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


def test_collapsed_region_name_still_resolves_to_its_new_parent():
    """Products spell the region the OLD way — they must not fall off the map.

    REGRESSION-GUARD: the first cut of normalize_taxonomy_hierarchy only
    redirected orphaned SUBREGION names ("Napa Valley"). But the source data
    overwhelmingly carries region="Napa", so deleting the Napa region entry
    silently dropped 272 SKUs from the explore map — the counts simply
    vanished rather than moving to California. Both the collapsed region's own
    name AND its orphaned subregion names must redirect.
    """
    tax = _usa_napa_fixture()
    builder.normalize_taxonomy_hierarchy(tax)
    _, region_by_name, region_by_name_only, _, _ = builder.build_lookups(tax)

    # the OLD region name, as it appears in product rows
    by_old_name = builder.resolve_region("Napa", "USA", region_by_name, region_by_name_only)
    assert by_old_name is not None, "products with region='Napa' would be dropped"
    assert by_old_name["name"] == "California"

    # and the orphaned subregion name
    by_sub_name = builder.resolve_region(
        "Napa Valley", "USA", region_by_name, region_by_name_only)
    assert by_sub_name is not None
    assert by_sub_name["name"] == "California"


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
    """A subregion must only resolve under the region that actually contains it.

    REGRESSION-GUARD HISTORY: as originally committed (2026-07-21, never green)
    this test asserted that resolving "Rutherford" under "California" returns
    None. That contradicted its own fixture: normalize_taxonomy_hierarchy
    collapses the fake "Napa" region into California, so Rutherford IS a
    California subregion afterwards and resolving it there is correct, not a
    wrong-parent fallback. Asserting None would have locked in the pre-collapse
    behaviour the sibling test explicitly removes.

    The real guarantee — the one the name describes and the one resolve_subregion
    previously violated by returning matches[0] — is that a subregion parented
    elsewhere must NOT be returned just because the name matched.
    """
    tax = _usa_napa_fixture()
    builder.normalize_taxonomy_hierarchy(tax)
    _, _, _, sub_by_name, sub_by_name_only = builder.build_lookups(tax)

    # Rutherford genuinely belongs to California after the collapse.
    resolved = builder.resolve_subregion(
        "Rutherford", "California", sub_by_name, sub_by_name_only)
    assert resolved is not None
    assert resolved["parent_name"] == "California"

    # ...but it must NOT be handed back under an unrelated region. Before the
    # fix, the name-only branch returned matches[0] regardless of parent.
    assert builder.resolve_subregion(
        "Rutherford", "Bordeaux", sub_by_name, sub_by_name_only) is None
