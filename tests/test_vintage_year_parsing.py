"""Guards the derived vintage_year / vintage_is_provisional fields.

The free-text `vintage` column mixes "2015", "2015 [**VINTAGE MAY CHANGE]",
"Current vintage", "NV", "2020/2021" and typos. A 2026-07-27 producer-note
canary reported a false 0/10 because it matched page text against the RAW
string instead of the parsed year — a silent measurement failure. These tests
pin the parser so that class of bug cannot come back.

Rule 6: also asserts the derived columns are actually populated in the live DB.
"""
from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "data" / "db" / "products.db"

_spec = importlib.util.spec_from_file_location(
    "migrate_add_vintage_year", REPO / "scripts" / "migrate_add_vintage_year.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
parse_vintage = _mod.parse_vintage


@pytest.mark.parametrize("raw,expected", [
    # firm years
    ("2015", (2015, 0)),
    ("1998", (1998, 0)),
    # provisional: the year is real and sellable, the caveat must survive
    ("2015 [**VINTAGE MAY CHANGE]", (2015, 1)),
    ("2021[**VINTAGE MAY CHANGE]", (2021, 1)),      # no space
    ("2010  [**VINTAGE MAY CHANGE]", (2010, 1)),    # double space
    # ambiguous ranges assert two different bottles — never pick one
    ("2015/2016", (None, 0)),
    ("2020/2021 [**VINTAGE MAY CHANGE]", (None, 1)),
    # no year asserted
    ("NV", (None, 0)),
    ("N/V", (None, 0)),
    ("NV [**VINTAGE MAY CHANGE]", (None, 1)),
    ("Current vintage", (None, 0)),
    ("CURRENT VINATGE", (None, 0)),                 # real typo in the data
    ("Currrent vintage", (None, 0)),                # real typo in the data
    ("ํNV", (None, 0)),                        # stray Thai char, real row
    ("", (None, 0)),
    (None, (None, 0)),
    # out-of-range is a typo, not a vintage
    ("1898", (None, 0)),
])
def test_parse_vintage(raw, expected):
    assert parse_vintage(raw) == expected


def test_provisional_flag_survives_without_a_year():
    """NV + MAY CHANGE must keep the caveat even though no year is claimed."""
    year, prov = parse_vintage("NV [**VINTAGE MAY CHANGE]")
    assert year is None and prov == 1


def test_never_invents_a_year():
    """No input without a single unambiguous year may produce one."""
    for raw in ("Current vintage", "NV", "", "2020/2021", "TBC", "vintage varies"):
        assert parse_vintage(raw)[0] is None


@pytest.fixture(scope="module")
def conn():
    if not (DB.exists() and DB.stat().st_size > 0):
        pytest.skip(f"live db not present: {DB}")
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    yield c
    c.close()


def test_derived_columns_exist_and_are_populated(conn):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    assert {"vintage_year", "vintage_is_provisional"} <= cols, (
        "run scripts/migrate_add_vintage_year.py --apply")
    n = conn.execute("SELECT COUNT(*) FROM products WHERE vintage_year IS NOT NULL").fetchone()[0]
    assert n >= 3000, f"only {n} rows carry a parsed vintage_year — expected >= 3000"


def test_no_out_of_range_years(conn):
    bad = conn.execute(
        f"SELECT COUNT(*) FROM products WHERE vintage_year IS NOT NULL "
        f"AND (vintage_year < {_mod.MIN_YEAR} OR vintage_year > {_mod.MAX_YEAR})"
    ).fetchone()[0]
    assert bad == 0, f"{bad} rows have an implausible vintage_year"


def test_stored_values_match_the_parser(conn):
    """INVARIANT: the stored column always equals a fresh parse of the source
    text. Catches a stale derived column after any vintage edit."""
    drift = []
    for sku, raw, year, prov in conn.execute(
        "SELECT sku, COALESCE(vintage,''), vintage_year, vintage_is_provisional FROM products"
    ):
        exp_year, exp_prov = parse_vintage(raw)
        if (year, prov or 0) != (exp_year, exp_prov):
            drift.append((sku, raw, year, exp_year))
        if len(drift) > 5:
            break
    assert not drift, f"vintage_year drifted from source text, e.g. {drift[:5]}"
