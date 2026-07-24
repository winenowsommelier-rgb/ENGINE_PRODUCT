import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.grouping import file_for, ALL_FILE_STEMS


def test_unknown_group_falls_through():
    assert file_for({'category_group': None}) == 'unknown'
    assert file_for({'category_group': ''}) == 'unknown'
    assert file_for({}) == 'unknown'


def test_red_wine_country_split():
    base = {'category_group': 'Wine', 'category_type': 'Red Wine'}
    assert file_for({**base, 'country': 'France'}) == 'wine_red_france'
    assert file_for({**base, 'country': 'Italy'}) == 'wine_red_italy'
    assert file_for({**base, 'country': 'Australia'}) == 'wine_red_world'
    assert file_for({**base, 'country': None}) == 'wine_red_world'


def test_white_wine_country_split():
    base = {'category_group': 'Wine', 'category_type': 'White Wine'}
    assert file_for({**base, 'country': 'France'}) == 'wine_white_france'
    assert file_for({**base, 'country': 'Chile'}) == 'wine_white_world'


def test_sparkling_and_other_wine():
    # Canonical value is the SINGLE string 'Sparkling & Champagne' (verified).
    assert file_for({'category_group': 'Wine', 'category_type': 'Sparkling & Champagne'}) == 'wine_sparkling'
    # Anything else under Wine -> wine_other
    assert file_for({'category_group': 'Wine', 'category_type': 'Rosé Wine'}) == 'wine_other'
    assert file_for({'category_group': 'Wine', 'category_type': 'Sweet/Dessert'}) == 'wine_other'


def test_non_wine_groups_map_to_single_files():
    assert file_for({'category_group': 'Whisky'}) == 'whisky'
    assert file_for({'category_group': 'Spirits'}) == 'spirits'
    assert file_for({'category_group': 'Liqueur'}) == 'liqueur'
    assert file_for({'category_group': 'Cigars'}) == 'cigars'


def test_every_stem_is_registered():
    assert 'unknown' in ALL_FILE_STEMS
    assert 'wine_red_world' in ALL_FILE_STEMS
    assert file_for({'category_group': 'Whisky'}) in ALL_FILE_STEMS


def test_non_string_field_values_degrade_to_unknown_not_crash():
    # A malformed non-string field must NOT crash the batch; it degrades gracefully.
    assert file_for({'category_group': 123}) == 'unknown'
    assert file_for({'category_group': ['Wine']}) == 'unknown'
    # non-string category_type/country under a valid Wine group must not raise
    out = file_for({'category_group': 'Wine', 'category_type': 456, 'country': 789})
    assert out in ALL_FILE_STEMS  # lands somewhere valid, no crash
