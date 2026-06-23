# tests/test_popularity_export_invariant.py
"""Production-data invariant: SQLite popularity ⇔ export popularity.

Runs read-only against the live data/db/products.db and the live export. Guards
the silent-drop class (paid/computed data that never reaches the UI source) and
the stale-rank class (a reset in SQLite that doesn't propagate). Mirrors
tests/test_enrichment_db_invariants.py. DO NOT skip without a replacement.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "data" / "db" / "products.db"
EXPORT = REPO / "data" / "live_products_export.json"


@pytest.fixture(scope="module")
def stores():
    if not DB.exists() or not EXPORT.exists():
        pytest.skip("live DB or export not present")
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    # Column was renamed popularity_orders_90d -> popularity_orders_window (the
    # popularity window is configurable, not fixed at 90 days). The old name no
    # longer exists; querying it raised OperationalError and made this test ERROR.
    sqlite_pop = {
        r["sku"] for r in conn.execute(
            "SELECT sku FROM products WHERE popularity_orders_window IS NOT NULL")
    }
    conn.close()
    exp = json.load(open(EXPORT))
    export_pop = {
        p["sku"] for p in exp
        if p.get("popularity_orders_window") not in (None, 0, "0")
    }
    return sqlite_pop, export_pop


def test_sqlite_popularity_present_in_export(stores):
    """Forward: every SKU populated in SQLite is populated in the export."""
    sqlite_pop, export_pop = stores
    missing = sqlite_pop - export_pop
    assert not missing, (
        f"{len(missing)} SKUs have popularity in SQLite but NOT in the export — "
        f"run scripts/refresh_live_export.py. Sample: {sorted(missing)[:10]}")


def test_export_popularity_backed_by_sqlite(stores):
    """Reverse (stale-rank guard): the export has no popularity SKU that SQLite
    doesn't — i.e. a SQLite reset propagated, not just additions."""
    sqlite_pop, export_pop = stores
    orphan = export_pop - sqlite_pop
    assert not orphan, (
        f"{len(orphan)} SKUs have popularity in the export but NULL in SQLite — "
        f"stale export; re-refresh. Sample: {sorted(orphan)[:10]}")
