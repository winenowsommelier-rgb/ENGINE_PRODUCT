"""Production-data invariants for the enrichment pipeline.

These tests run against the live data/db/products.db (read-only).
They catch the class of bug where AI responses are paid for but never
surfaced in the products table — the failure mode that cost us ~$56 of
wasted Anthropic credit in Phase 5 (2026-05-27).

If you re-introduce a "silently skip the descriptive write" bug, these
tests fail immediately. DO NOT delete or skip them without writing a
replacement test that covers the same invariant.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"


@pytest.fixture(scope="module")
def conn():
    if not DEFAULT_DB.exists():
        pytest.skip(f"live db not present: {DEFAULT_DB}")
    c = sqlite3.connect(DEFAULT_DB)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def test_every_cached_enrichment_landed_in_products(conn):
    """INVARIANT: if enrichment_cache has a passed/repaired/failed_then_retried
    row for SKU X, then products row for SKU X must have desc_en_short
    populated. Anything else means we paid Anthropic for data that never
    surfaced in the user-facing table.

    History: this was false for 3,807 SKUs on 2026-05-27 because
    LocalRouter silently dropped sub-threshold writes. The recovery
    backfill (scripts/backfill_from_cache.py) brought us back to the
    invariant. This test prevents the regression.
    """
    missing = conn.execute("""
        SELECT ec.sku
        FROM enrichment_cache ec
        JOIN products p ON p.sku = ec.sku
        WHERE ec.validation_status IN ('passed','repaired','failed_then_retried')
          AND (p.desc_en_short IS NULL OR p.desc_en_short = '')
        LIMIT 25
    """).fetchall()
    assert not missing, (
        f"{len(missing)}+ SKUs have a successful enrichment in cache but "
        f"NULL desc_en_short in products. Sample: {[r['sku'] for r in missing]}. "
        f"Run scripts/backfill_from_cache.py."
    )


def test_taste_profile_consistency(conn):
    """INVARIANT: every taste_profile JSON in products is shaped correctly —
    structure='tiered' has at least one of primary/secondary/tertiary, and
    structure='flat' has flat_tags. Otherwise the UI components crash."""
    bad_rows = []
    rows = conn.execute(
        "SELECT sku, taste_profile FROM products WHERE taste_profile IS NOT NULL"
    ).fetchall()
    for r in rows:
        try:
            tp = json.loads(r["taste_profile"])
        except (ValueError, TypeError):
            bad_rows.append((r["sku"], "invalid JSON"))
            continue
        structure = tp.get("structure")
        if structure == "tiered":
            tiers = tp.get("tiers", {})
            if not any(tiers.get(t) for t in ("primary", "secondary", "tertiary")):
                bad_rows.append((r["sku"], "tiered with all tiers empty"))
        elif structure == "flat":
            if not tp.get("flat_tags"):
                bad_rows.append((r["sku"], "flat with no flat_tags"))
        else:
            bad_rows.append((r["sku"], f"unknown structure {structure!r}"))
    assert not bad_rows, (
        f"{len(bad_rows)} taste_profile rows are malformed. "
        f"Sample: {bad_rows[:10]}"
    )


def test_live_export_matches_db_for_enriched_skus(conn):
    """INVARIANT: data/live_products_export.json (what /api/explore reads) is
    not stale relative to products.db for any SKU that has been enriched.
    If desc_en_short is in the DB but missing from the export, the UI
    doesn't show enrichment, just like 2026-05-27.

    Run scripts/refresh_live_export.py after any bulk write.
    """
    export_path = REPO_ROOT / "data" / "live_products_export.json"
    if not export_path.exists():
        pytest.skip("live_products_export.json not present")

    db_enriched = {
        r["sku"]: r["desc_en_short"]
        for r in conn.execute(
            "SELECT sku, desc_en_short FROM products "
            "WHERE desc_en_short IS NOT NULL AND desc_en_short != ''"
        )
    }
    export = json.loads(export_path.read_text())
    export_by_sku = {p["sku"]: p for p in export if p.get("sku")}

    stale: list[str] = []
    for sku, db_desc in db_enriched.items():
        ex = export_by_sku.get(sku)
        if not ex:
            continue  # SKU missing from export entirely — separate concern
        if not (ex.get("desc_en_short") or "").strip():
            stale.append(sku)
    # Allow small drift (last 50 enrichments may post-date the export rebuild),
    # but a wholesale gap means the export is stale.
    assert len(stale) <= 50, (
        f"{len(stale)} SKUs have desc_en_short in DB but NULL in live export. "
        f"Run scripts/refresh_live_export.py. Sample: {stale[:10]}"
    )
