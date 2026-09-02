"""Regression guard for image_url / magento_item_url / websites reconciliation.

History: products kept showing ANOTHER product's bottle (e.g. 40+ wines all
rendering wrw6567gx.jpg = Riporta Nero D'Avola). Fixed repeatedly (commits
0f4b327, edcf1fd, e9e11c9, cfeb215) but resurrected each time because a re-seed
or DB revert reintroduced the borrowed URLs and NOTHING failed when it did.

data/data mastefile WNLQ9/winenow-base-images-20260831.csv is the curated
source of truth (see scripts/reconcile_image_urls.py). These tests assert
downstream sources agree with it, so a regression breaks the build (Rule 6)
instead of silently shipping the wrong bottle or a stale/missing item_url.

Run: python -m pytest tests/test_image_url_invariants.py -q
"""
import csv
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "products.db"
EXPORT = ROOT / "data" / "live_products_export.json"
IMGCSV = ROOT / "data" / "data mastefile WNLQ9" / "winenow-base-images-20260831.csv"

FIELDS = ("image_url", "magento_item_url", "websites")
CSV_COL_FOR_FIELD = {
    "image_url": "base_image_url",
    "magento_item_url": "item_url",
    "websites": "websites",
}


def _master():
    """sku(upper) -> {field: csv value lowercased}. Skips ragged rows the same
    way scripts/reconcile_image_urls.py's load_master() does — a row with too
    many OR too few fields must not be treated as a legitimate CSV value here
    either, or this test would flag reconcile_image_urls.py's correct exclusion
    of those 14 SKUs as a false "disagreement."""
    good = {}
    with open(IMGCSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip().upper()
            if not sku:
                continue
            # Mirror the real script's ragged-row detection exactly (see
            # scripts/reconcile_image_urls.py load_master()) — read that
            # function's current logic and replicate it here, don't
            # reinvent a slightly different check.
            if row.get(None) is not None or any(
                row.get(csv_col) is None for csv_col in CSV_COL_FOR_FIELD.values()
            ):
                continue  # ragged row — excluded from master, same as the real script
            good[sku] = {
                field: (row.get(csv_col) or "").strip().lower()
                for field, csv_col in CSV_COL_FOR_FIELD.items()
            }
    return good


def _disagreements(rows, master, field):
    """rows: iterable of (sku, value_for_field). Returns list of (sku, got, want)."""
    bad = []
    for sku, val in rows:
        su = (sku or "").strip().upper()
        if su not in master:
            continue  # SKU not in CSV, or ragged — out of scope (no_master rule)
        want = master[su][field]
        got = (val or "").strip().lower()
        if got != want:
            bad.append((sku, got, want))
    return bad


@pytest.fixture(scope="module")
def master():
    assert IMGCSV.exists(), f"source CSV missing: {IMGCSV}"
    return _master()


@pytest.mark.parametrize("field", FIELDS)
def test_db_fields_match_csv(master, field):
    con = sqlite3.connect(DB)
    rows = con.execute(f"SELECT sku, {field} FROM products").fetchall()
    con.close()
    bad = _disagreements(rows, master, field)
    assert not bad, (
        f"{len(bad)} products.db {field} value(s) disagree with source CSV. "
        f"First 10: {bad[:10]}. Fix: python scripts/reconcile_image_urls.py --apply"
    )


@pytest.mark.parametrize("field", FIELDS)
def test_export_fields_match_csv(master, field):
    raw = json.loads(EXPORT.read_text())
    items = raw if isinstance(raw, list) else raw.get("products", raw)
    rows = [(p.get("sku"), p.get(field)) for p in items if isinstance(p, dict)]
    bad = _disagreements(rows, master, field)
    assert not bad, (
        f"{len(bad)} live_products_export.json {field} value(s) disagree with "
        f"source CSV. First 10: {bad[:10]}. "
        f"Fix: reconcile DB then run scripts/refresh_live_export.py"
    )


def _load_reconcile_module():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "reconcile_image_urls", ROOT / "scripts" / "reconcile_image_urls.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_image_url_blank_out_behavior(tmp_path, monkeypatch):
    """Regression test for the legacy blank-out path, which is DORMANT on the
    real CSV (0/17,682 rows have a blank base_image_url as of 2026-07-24) but
    still load-bearing code (CLAUDE.md Rule 3 — don't delete an inherited
    behavior just because current data never exercises it). Runs the REAL
    reconcile_image_urls.main() against a throwaway copy of products.db and a
    synthetic CSV, so the path is provably still correct — this is not a
    tautology check against hand-built locals, it executes the actual UPDATE
    statement and reads back the result.
    """
    import shutil

    # sku WDW0001AA has a populated image_url in products.db today (per Task 1
    # verification). Work on a throwaway copy so this test cannot mutate the
    # real DB.
    tmp_db = tmp_path / "products.db"
    shutil.copy(DB, tmp_db)
    con = sqlite3.connect(tmp_db)
    before = con.execute(
        "SELECT image_url, magento_item_url, websites FROM products WHERE sku = 'WDW0001AA'"
    ).fetchone()
    con.close()
    assert before and before[0], (
        "fixture assumption broken: WDW0001AA has no image_url in products.db "
        "— pick a different fixture SKU with a populated image_url"
    )

    # Synthetic CSV: one row for WDW0001AA with all three fields blank —
    # exercises the blank-out path for image_url specifically.
    tmp_csv = tmp_path / "synthetic.csv"
    tmp_csv.write_text(
        "sku,item_name,websites,base_image_url,item_url\n"
        "WDW0001AA,Test Product,,,\n",
        encoding="utf-8",
    )

    mod = _load_reconcile_module()

    # Point the loaded module at our throwaway DB/CSV instead of the real ones.
    monkeypatch.setattr(mod, "DB", tmp_db)
    monkeypatch.setattr(mod, "IMGCSV", tmp_csv)
    monkeypatch.setattr("sys.argv", ["reconcile_image_urls.py", "--apply"])

    rc = mod.main()
    assert rc == 0, "reconcile script exited non-zero on synthetic fixture"

    con = sqlite3.connect(tmp_db)
    after = con.execute(
        "SELECT image_url, magento_item_url, websites FROM products WHERE sku = 'WDW0001AA'"
    ).fetchone()
    con.close()

    assert after == ("", "", ""), (
        f"expected all three fields blanked for WDW0001AA after reconciling "
        f"against an all-blank synthetic CSV row, got {after!r}"
    )


def test_sku_absent_from_csv_left_untouched():
    """A SKU in products.db but absent from the source CSV entirely must not
    be reported as a disagreement for any of the three fields — the no_master
    rule leaves it untouched rather than blanking it."""
    master = _master()
    con = sqlite3.connect(DB)
    all_skus = [r[0] for r in con.execute("SELECT sku FROM products").fetchall()]
    con.close()
    missing = [s for s in all_skus if (s or "").strip().upper() not in master]
    assert missing, (
        "expected some products.db SKUs to be absent from _master() — either "
        "genuinely absent from the CSV (141 known as of 2026-07-24) or "
        "excluded as a ragged/misaligned row (14 known as of 2026-07-24, "
        "155 combined) — if this is now 0, the CSV coverage gap disclosed "
        "in the design spec has closed; update this test's expectations "
        "accordingly rather than deleting it"
    )


def test_load_master_ragged_row_detection(tmp_path, monkeypatch):
    """Direct unit test of scripts/reconcile_image_urls.py's load_master(),
    isolated from the DB and from the real CSV.

    History: a code reviewer of Task 3 flagged that load_master()'s
    ragged-row detection had NO test coverage — this was the SECOND bug
    found in that function (an earlier version double-counted ragged SKUs
    into no_master). This test exercises the exact three cases that matter:

    1. A clean 5-field row reconciles normally.
    2. A too-many-fields row (unquoted comma in item_name, shifting later
       columns) is excluded — DictReader parks the overflow under the
       None key.
    3. A too-few-fields row (a trailing column dropped) is excluded via
       `is None` checks on the mapped columns — DictReader pads missing
       trailing values with None, which is NOT the same as a genuinely
       blank cell (empty string from an actual comma-comma). A row with a
       real blank cell must still appear in `good` with "" for that field,
       proving the None-check doesn't over-trigger on legitimate blanks.
    """
    csv_text = (
        "sku,item_name,websites,base_image_url,item_url\n"
        # 1. Clean row — maps correctly, five real fields.
        "SKU_CLEAN,Clean Product,Wine-now,http://img/clean.jpg,http://page/clean.html\n"
        # 2. Too-many-fields row — unquoted comma inside item_name shifts
        #    every later column right by one; DictReader stuffs the extra
        #    raw field into a list under the None key.
        "SKU_TOOMANY,Some, Name,Wine-now,http://img/toomany.jpg,http://page/toomany.html\n"
        # 3. Too-few-fields row — trailing column (item_url) dropped
        #    entirely, so DictReader pads item_url with None (not "").
        "SKU_TOOFEW,Short Product,Wine-now,http://img/toofew.jpg\n"
        # 4. Legitimately blank cell — real empty string between commas for
        #    websites, NOT a shifted/missing column. Must still appear in
        #    `good` with "" for websites, distinguishing genuine blanks
        #    from ragged-row None padding.
        "SKU_BLANKCELL,Blank Cell Product,,http://img/blankcell.jpg,http://page/blankcell.html\n"
    )
    tmp_csv = tmp_path / "ragged_fixture.csv"
    tmp_csv.write_text(csv_text, encoding="utf-8")

    mod = _load_reconcile_module()
    monkeypatch.setattr(mod, "IMGCSV", tmp_csv)

    good, ragged_skus = mod.load_master()

    # 1. Clean row appears with correct field values.
    assert "SKU_CLEAN" in good
    assert good["SKU_CLEAN"] == {
        "image_url": "http://img/clean.jpg",
        "magento_item_url": "http://page/clean.html",
        "websites": "Wine-now",
    }

    # 2. Too-many-fields row excluded as ragged.
    assert "SKU_TOOMANY" not in good
    assert "SKU_TOOMANY" in ragged_skus

    # 3. Too-few-fields row excluded as ragged (the specific gap the
    #    reviewer found — must use `is None`, not falsy, checks).
    assert "SKU_TOOFEW" not in good
    assert "SKU_TOOFEW" in ragged_skus

    # 4. Legitimately blank cell still appears in `good` — proves the
    #    ragged-row fix does not over-trigger on genuine blanks.
    assert "SKU_BLANKCELL" in good
    assert "SKU_BLANKCELL" not in ragged_skus
    assert good["SKU_BLANKCELL"]["websites"] == ""
