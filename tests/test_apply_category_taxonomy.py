from scripts.apply_category_taxonomy import add_category_fields


def test_adds_group_and_type():
    p = {"sku": "LWH0001", "name": "Lagavulin", "classification": "Wine product"}
    out = add_category_fields(p)
    assert out["category_group"] == "Whisky"
    assert out["category_type"] == "Whisky"


def test_classification_left_untouched():
    p = {"sku": "ABA0001", "name": "Shelf", "classification": "Wine product"}
    out = add_category_fields(p)
    assert out["category_group"] == "Accessories"
    assert out["classification"] == "Wine product"  # advisory, preserved


def test_does_not_mutate_input():
    p = {"sku": "WRW0001"}
    add_category_fields(p)
    assert "category_group" not in p
