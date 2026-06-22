# tests/test_attribute_map_parity.py
"""Guard: the Python ATTRIBUTE_MAP and the TS mirror must stay identical."""
import re
from pathlib import Path
from data.lib.taxonomy.attribute_map import ATTRIBUTE_MAP, NEW_COLUMNS, DROPPED_COLUMNS

TS = Path(__file__).resolve().parent.parent / "apps/catalog/lib/attribute-map.ts"

def _ts_object(name: str) -> str:
    src = TS.read_text()
    # Match ATTRIBUTE_MAP: Record<...> = { ... } (multiline OK)
    # or NEW_COLUMNS = [ ... ]
    m = re.search(name + r"\s*(?::\s*\w+(?:<[^>]*>)?)?\s*=\s*(\{[^}]*\}|\[[^\]]*\])", src, re.S)
    assert m, f"{name} not found in attribute-map.ts"
    return m.group(1)

def test_map_matches_ts():
    obj = _ts_object("ATTRIBUTE_MAP")
    for old, new in ATTRIBUTE_MAP.items():
        assert f'"{old}"' in obj or f"'{old}'" in obj or f"{old}:" in obj, f"{old} missing in TS map"
        assert f'"{new}"' in obj or f"'{new}'" in obj, f"{new} missing in TS map"

def test_new_and_dropped_present_in_ts():
    for col in NEW_COLUMNS:
        assert f'"{col}"' in _ts_object("NEW_COLUMNS"), f"{col} missing in TS NEW_COLUMNS"
    for col in DROPPED_COLUMNS:
        assert f'"{col}"' in _ts_object("DROPPED_COLUMNS"), f"{col} missing in TS DROPPED_COLUMNS"
