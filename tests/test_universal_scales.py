import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.taste_taxonomy.universal_scales import (
    validate_body, validate_variety, schema_for_type, BODY_SCALE,
)

def test_body_scale_is_four_step_no_medium_light():
    assert BODY_SCALE == ["Light", "Medium", "Medium-Full", "Full"]
    assert validate_body("Full") == "Full"
    assert validate_body("Medium-Light") is None
    assert validate_body("bogus") is None
    assert validate_body(None) is None

def test_variety_validates_against_per_category_vocab():
    assert validate_variety("Whisky", "Single Malt") == "Single Malt"
    assert validate_variety("Whisky", "Chardonnay") is None
    assert validate_variety("Sake & Asian", "Junmai Ginjo") == "Junmai Ginjo"
    assert validate_variety("Accessories", "Single Malt") is None

def test_schema_for_type_is_rule12_clean():
    s = schema_for_type("Whisky")
    assert "variety" in s["fields"] and "body" in s["fields"]
    assert s["variety_vocab"]
    import inspect, data.lib.taste_taxonomy.universal_scales as m
    src = inspect.getsource(m)
    assert "classification" not in src.lower()
