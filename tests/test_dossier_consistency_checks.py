from data.lib.dossier.consistency_checks import name_vintage_mismatch


def test_matching_year_is_not_a_mismatch():
    assert name_vintage_mismatch("Chateau X 2017", "2017") is False


def test_name_year_disagrees_with_vintage_field():
    assert name_vintage_mismatch("Chateau X 2017", "2004") is True


def test_non_vintage_field_is_not_a_mismatch():
    assert name_vintage_mismatch("Some NV Champagne", "N/V") is False


def test_no_year_in_name_is_not_a_mismatch():
    assert name_vintage_mismatch("Chateau X Reserve", "2015") is False


def test_bracketed_may_change_suffix_still_compares_base_year():
    assert name_vintage_mismatch("Chateau X 2019", "2004 [MAY CHANGE]") is True
    assert name_vintage_mismatch("Chateau X 2004", "2004 [MAY CHANGE]") is False
