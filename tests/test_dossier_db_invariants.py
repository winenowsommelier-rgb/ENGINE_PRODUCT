"""Invariant tests for the curation dossier tables (dossier.db) and their
interaction with products.db / the live export. Pattern:
tests/test_enrichment_db_invariants.py.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DOSSIER_DB = REPO_ROOT / "data" / "db" / "dossier.db"


@pytest.fixture(scope="module")
def dossier_conn():
    if not DEFAULT_DOSSIER_DB.exists():
        pytest.skip(f"dossier db not present: {DEFAULT_DOSSIER_DB}")
    c = sqlite3.connect(DEFAULT_DOSSIER_DB)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def test_invariant_7_wine_key_parity(dossier_conn):
    """INVARIANT: re-running the normalizer over every sku currently in
    sku_dossier_overlay reproduces its existing wine_key exactly. A mismatch
    means either the normalizer changed (and needs a migration script to
    re-key existing rows) or -- worse -- a rename silently re-minted a key,
    orphaning whatever dossier content pointed at the old one."""
    import sys
    sys.path.insert(0, str(REPO_ROOT))
    from data.lib.dossier.wine_key import wine_key_for

    rows = dossier_conn.execute(
        "SELECT sku, wine_key FROM sku_dossier_overlay"
    ).fetchall()
    if not rows:
        pytest.skip("no overlay rows yet -- nothing to check parity against")

    products_conn = sqlite3.connect(REPO_ROOT / "data" / "db" / "products.db")
    mismatches = []
    for r in rows:
        name = products_conn.execute(
            "SELECT name FROM products WHERE sku = ?", (r["sku"],)
        ).fetchone()
        if not name:
            continue
        fresh_key = wine_key_for(r["sku"], name[0] or "")
        if fresh_key != r["wine_key"]:
            mismatches.append((r["sku"], r["wine_key"], fresh_key))
    assert not mismatches, (
        f"{len(mismatches)} SKUs would get a DIFFERENT wine_key on re-mint -- "
        f"this would orphan existing dossier content. Sample: {mismatches[:10]}"
    )
