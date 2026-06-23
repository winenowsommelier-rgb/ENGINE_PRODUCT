# tests/test_special_price_export_invariant.py
"""Production-data invariant: SQLite special_price ⇔ export special_price.

Guards the silent-drop class for SALE prices: special_price is populated in the
canonical DB for ~1,028 SKUs and is rendered as the storefront sale price (with
strikethrough + −% badge) on the shop grid, quick view, and product page. A
stale refresh that regenerates data/live_products_export.json WITHOUT the column
would silently remove every sale price from the live catalog — exactly the
"paid/source data never reaches the UI" failure CLAUDE.md Rule 1/6 exist for.
This actually happened during development: a parallel process regenerated the
export with 0 special_price rows.

Read-only against the live DB + export. Mirrors test_popularity_export_invariant.py.
DO NOT skip without a replacement.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "data" / "db" / "products.db"
EXPORT = REPO / "data" / "live_products_export.json"


def _is_genuine_sale(price, special) -> bool:
    """A real sale: a positive special strictly below the regular price. Matches
    the storefront's resolveSale() so the invariant counts the SAME rows the UI
    would actually render a discount for (not every non-null special_price)."""
    try:
        price = float(price)
        special = float(special)
    except (TypeError, ValueError):
        return False
    return special > 0 and special < price


# Floor for the CI export-only check below. The committed export currently carries
# 1,028 sale rows; we require well above zero (but tolerant of normal promo churn)
# so a refresh that DROPS the column entirely is caught even where the 84 MB DB is
# absent (it is gitignored, so CI cannot run the DB⇔export checks above). Tune up
# only if real promotions ever fall near this number.
MIN_EXPORT_SALE_ROWS = 100


def test_committed_export_has_sale_prices():
    """CI-effective guard (DB-independent): the committed live export must still
    contain sale prices. This is the check that actually runs in GitHub Actions,
    where data/db/products.db is gitignored and absent — so the DB⇔export tests
    below SKIP. A PR that regenerates the export without special_price (the exact
    silent-drop that happened in dev) drops this count to ~0 and FAILS here."""
    if not EXPORT.exists():
        pytest.skip("export not present")
    exp = json.load(open(EXPORT))
    n = sum(1 for p in exp if _is_genuine_sale(p.get("price"), p.get("special_price")))
    assert n >= MIN_EXPORT_SALE_ROWS, (
        f"Committed export has only {n} genuine sale prices (expected >= "
        f"{MIN_EXPORT_SALE_ROWS}). A refresh likely dropped special_price — sale "
        f"prices would vanish from the storefront. Re-run scripts/refresh_live_export.py "
        f"against data/db/products.db and re-commit the export.")


@pytest.fixture(scope="module")
def stores():
    if not DB.exists() or not EXPORT.exists():
        pytest.skip("live DB or export not present (DB is gitignored — expected in CI)")
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    sqlite_sale = {
        r["sku"]
        for r in conn.execute("SELECT sku, price, special_price FROM products")
        if _is_genuine_sale(r["price"], r["special_price"])
    }
    conn.close()
    exp = json.load(open(EXPORT))
    export_sale = {
        p["sku"] for p in exp if _is_genuine_sale(p.get("price"), p.get("special_price"))
    }
    return sqlite_sale, export_sale


def test_db_has_sales(stores):
    """Sanity: the canonical DB actually carries sale prices. If this is 0 the
    fixtures below are vacuously true and would hide a real regression."""
    sqlite_sale, _ = stores
    assert len(sqlite_sale) > 0, (
        "No genuine special_price rows in the DB — either the DB is wrong or the "
        "sale-price feature regressed at the source.")


def test_sqlite_special_price_present_in_export(stores):
    """Forward (silent-drop guard): every SKU on sale in SQLite is on sale in the
    export. This is the check that fails a stale refresh that dropped the column."""
    sqlite_sale, export_sale = stores
    missing = sqlite_sale - export_sale
    assert not missing, (
        f"{len(missing)} SKUs have a special_price in SQLite but NOT in the export "
        f"(sale prices would vanish from the storefront) — run "
        f"scripts/refresh_live_export.py. Sample: {sorted(missing)[:10]}")


def test_export_special_price_backed_by_sqlite(stores):
    """Reverse (stale-export guard): the export has no on-sale SKU that SQLite
    doesn't — i.e. a removed/ended promotion in SQLite propagated, not just adds."""
    sqlite_sale, export_sale = stores
    orphan = export_sale - sqlite_sale
    assert not orphan, (
        f"{len(orphan)} SKUs are on sale in the export but NOT in SQLite "
        f"(stale export showing an ended promo) — re-refresh. "
        f"Sample: {sorted(orphan)[:10]}")
