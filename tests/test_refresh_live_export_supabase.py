"""Regression guard for scripts/refresh_live_export_supabase.py.

History: this script never derived flavor_tags_canonical (unlike its SQLite
counterpart, refresh_live_export.py's P4 step), so every nightly Supabase
export since 2026-07-17 silently shipped the field empty on all rows,
breaking finder flavor-chip filtering in production for 3+ days undetected —
because, unlike category_group, there was no verification check to catch it.
"""
import importlib.util
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key")


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "refresh_live_export_supabase",
        REPO_ROOT / "scripts" / "refresh_live_export_supabase.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def mod():
    return _load_module()


@pytest.fixture
def sample_rows():
    return [
        {"sku": "WRW0001AA", "flavor_tags": ["Red fruit", "Cranberry", "Vanilla"]},
        {"sku": "WRW0002AA", "flavor_tags": ["Subtle spice", "Earthy undertones"]},
        {"sku": "WRW0003AA", "flavor_tags": []},
        {"sku": "WRW0004AA", "flavor_tags": None},
    ]


def test_add_flavor_canonical_derives_real_notes(mod, sample_rows):
    out = mod.add_flavor_canonical([dict(r) for r in sample_rows])
    by_sku = {r["sku"]: r for r in out}

    assert "Red Fruit" in by_sku["WRW0001AA"]["flavor_tags_canonical"]
    assert "Cranberry" in by_sku["WRW0001AA"]["flavor_tags_canonical"]
    assert by_sku["WRW0002AA"]["flavor_tags_canonical"]  # non-empty


def test_add_flavor_canonical_always_sets_field_even_when_empty(mod, sample_rows):
    out = mod.add_flavor_canonical([dict(r) for r in sample_rows])
    by_sku = {r["sku"]: r for r in out}

    # No tags / null tags -> present as [], never absent (drift-proof, same
    # contract as category_group).
    assert by_sku["WRW0003AA"]["flavor_tags_canonical"] == []
    assert by_sku["WRW0004AA"]["flavor_tags_canonical"] == []


def test_add_flavor_canonical_degrades_gracefully_when_vocab_unavailable(mod, sample_rows):
    mod._CANON_AVAILABLE = False
    out = mod.add_flavor_canonical([dict(r) for r in sample_rows])

    # Never raises, always sets the key -> [] rather than dropping it.
    assert all(r["flavor_tags_canonical"] == [] for r in out)


def test_main_verification_fails_loudly_if_canonicalization_silently_breaks(mod, sample_rows, monkeypatch, tmp_path, capsys):
    """Regression guard: this exact scenario shipped silently for 3+ days.
    If flavor_tags exist on rows but canonicalization produces nothing on
    all of them, main() must exit non-zero, not silently write the export."""
    monkeypatch.setattr(mod, "fetch_all_products", lambda: [dict(r) for r in sample_rows])
    monkeypatch.setattr(mod, "resolve_category", lambda r: {"group": "Wine", "type": "Red Wine"})
    mod._CANON_AVAILABLE = False  # simulates the exact prior failure mode

    out_path = tmp_path / "export.json"
    exit_code = mod.main(["--out", str(out_path)])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "flavor_tags_canonical" in captured.err


def test_main_succeeds_when_canonicalization_works(mod, sample_rows, monkeypatch, tmp_path):
    monkeypatch.setattr(mod, "fetch_all_products", lambda: [dict(r) for r in sample_rows])
    monkeypatch.setattr(mod, "resolve_category", lambda r: {"group": "Wine", "type": "Red Wine"})

    out_path = tmp_path / "export.json"
    exit_code = mod.main(["--out", str(out_path)])

    assert exit_code == 0
    import json
    written = json.loads(out_path.read_text())
    has_canon = sum(1 for r in written if r.get("flavor_tags_canonical"))
    assert has_canon > 0
