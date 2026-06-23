"""Regression guard for the recurring cross-SKU image bug.

History: products kept showing ANOTHER product's bottle (e.g. 40+ wines all
rendering wrw6567gx.jpg = Riporta Nero D'Avola). Fixed repeatedly (commits
0f4b327, edcf1fd, e9e11c9, cfeb215) but resurrected each time because a re-seed
or DB revert reintroduced the borrowed URLs and NOTHING failed when it did.

The masterfile "image url" CSV is the curated source of truth. These tests assert
every downstream source agrees with it, so a regression breaks the build (Rule 6)
instead of silently shipping the wrong bottle.

Run: python -m pytest tests/test_image_url_invariants.py -q
"""
import csv
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "products.db"
SEED = ROOT / "data" / "db" / "products.json"
EXPORT = ROOT / "data" / "live_products_export.json"
IMGCSV = ROOT / "data" / "data mastefile WNLQ9" / \
    "DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv"


def _master():
    good = {}
    with open(IMGCSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip().upper()
            if sku:
                good[sku] = (row.get("image") or "").strip().lower()
    return good


def _disagreements(pairs, master):
    """pairs: iterable of (sku, image_url). Returns list of (sku, got, want)."""
    bad = []
    for sku, url in pairs:
        su = (sku or "").strip().upper()
        if su not in master:
            continue  # SKU not curated in masterfile — out of scope
        want = master[su]
        got = (url or "").strip().lower()
        if got != want:
            bad.append((sku, got, want))
    return bad


@pytest.fixture(scope="module")
def master():
    assert IMGCSV.exists(), f"masterfile missing: {IMGCSV}"
    return _master()


def test_db_image_urls_match_masterfile(master):
    con = sqlite3.connect(DB)
    rows = con.execute("SELECT sku, image_url FROM products").fetchall()
    con.close()
    bad = _disagreements(rows, master)
    assert not bad, (
        f"{len(bad)} products.db image_url(s) disagree with masterfile "
        f"(cross-SKU image bug). First 10: {bad[:10]}. "
        f"Fix: python scripts/reconcile_image_urls.py --apply"
    )


def test_seed_json_image_urls_match_masterfile(master):
    raw = json.loads(SEED.read_text())
    items = raw if isinstance(raw, list) else raw.get("products", raw)
    pairs = [(p.get("sku"), p.get("image_url")) for p in items if isinstance(p, dict)]
    bad = _disagreements(pairs, master)
    assert not bad, (
        f"{len(bad)} seed products.json image_url(s) disagree with masterfile "
        f"(a re-seed would resurrect the cross-SKU bug). First 10: {bad[:10]}. "
        f"Fix: python scripts/reconcile_seed_image_urls.py --apply"
    )


def test_export_image_urls_match_masterfile(master):
    raw = json.loads(EXPORT.read_text())
    items = raw if isinstance(raw, list) else raw.get("products", raw)
    pairs = [(p.get("sku"), p.get("image_url")) for p in items if isinstance(p, dict)]
    bad = _disagreements(pairs, master)
    assert not bad, (
        f"{len(bad)} live_products_export.json image_url(s) disagree with masterfile. "
        f"First 10: {bad[:10]}. Fix: reconcile DB then refresh_live_export.py"
    )
