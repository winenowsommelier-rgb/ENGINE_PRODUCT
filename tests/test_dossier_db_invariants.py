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


def test_invariant_1_staging_success_has_dossier_row(dossier_conn):
    """Every staged 'applied' generation has a dossier row with >=1 non-NULL
    content field. Prevents the failure mode: paid for content that
    never landed in the user-facing table."""
    applied = dossier_conn.execute(
        "SELECT wine_key FROM dossier_staging WHERE validation_status = 'applied'"
    ).fetchall()
    if not applied:
        pytest.skip("no applied staging rows yet")
    missing = []
    for (wine_key,) in applied:
        row = dossier_conn.execute(
            "SELECT style_summary, expert_note, producer_history "
            "FROM wine_dossier WHERE wine_key = ?", (wine_key,)
        ).fetchone()
        if not row or not any(row):
            missing.append(wine_key)
    assert not missing, f"{len(missing)} 'applied' staging rows have no dossier content: {missing[:10]}"


def test_invariant_2_sourced_dossier_surfaces_in_export(dossier_conn):
    export_path = REPO_ROOT / "data" / "live_products_export.json"
    if not export_path.exists():
        pytest.skip("live export not present")
    sourced = dossier_conn.execute("""
        SELECT DISTINCT o.sku FROM sku_dossier_overlay o
        JOIN wine_dossier w ON w.wine_key = o.wine_key
        WHERE w.provenance_json LIKE '%"sourced"%'
    """).fetchall()
    if not sourced:
        pytest.skip("no sourced dossier content yet")
    export = json.loads(export_path.read_text())
    export_skus = {p["sku"] for p in export if p.get("curation_dossier")}
    missing = [sku for (sku,) in sourced if sku not in export_skus]
    assert not missing, f"{len(missing)} SKUs have sourced dossier content but nothing in the export: {missing[:10]}"


def _check_products_db_readable(products_db_path: Path):
    """Returns (products_conn, None) if products_db_path is a readable sqlite
    db with a 'products' table, else (None, reason_str)."""
    if not products_db_path.exists() or products_db_path.stat().st_size == 0:
        return None, f"products.db not present or empty: {products_db_path}"
    products_conn = sqlite3.connect(products_db_path)
    try:
        table_exists = products_conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='products'"
        ).fetchone()
    except sqlite3.DatabaseError:
        return None, f"products.db is not a valid sqlite database: {products_db_path}"
    if not table_exists:
        return None, f"products.db has no 'products' table: {products_db_path}"
    return products_conn, None


def _run_invariant_3_orphan_guard(dossier_conn, products_db_path: Path):
    """Core logic, factored out so the regression test below can point it at
    a deliberately-broken products.db path without touching the real file."""
    overlay_rows = dossier_conn.execute("SELECT sku FROM sku_dossier_overlay").fetchall()
    overlay_count = len(overlay_rows)

    products_conn, unreadable_reason = _check_products_db_readable(products_db_path)
    if products_conn is None:
        if overlay_count == 0:
            # Nothing to check against -- vacuously safe to skip regardless
            # of products.db's state.
            pytest.skip(unreadable_reason)
        else:
            # sku_dossier_overlay has real rows but we have no way to verify
            # them against products.db -- this must be loud, not silent,
            # since it is exactly the situation the orphan guard exists to
            # catch (see products.db.backup-* recovery-incident history).
            pytest.fail(
                f"sku_dossier_overlay has {overlay_count} rows but products.db "
                f"is unreadable/missing the products table -- cannot verify "
                f"orphan guard ({unreadable_reason})"
            )

    product_skus = {r[0] for r in products_conn.execute("SELECT sku FROM products")}
    overlay_skus = [r[0] for (r,) in overlay_rows]
    orphan_skus = [s for s in overlay_skus if s not in product_skus]
    assert not orphan_skus, f"{len(orphan_skus)} overlay SKUs absent from products: {orphan_skus[:10]}"

    orphan_overlays = dossier_conn.execute("""
        SELECT o.sku FROM sku_dossier_overlay o
        LEFT JOIN wine_dossier w ON w.wine_key = o.wine_key
        WHERE w.wine_key IS NULL
    """).fetchall()
    assert not orphan_overlays, f"overlays with no wine_dossier parent: {orphan_overlays}"


def test_invariant_3_orphan_guard(dossier_conn):
    """Zero overlay SKUs absent from products; zero overlays without a
    wine_dossier parent. Vacuously true on an empty overlay table -- but if
    the overlay has real rows and products.db can't be read, that must fail
    loud, not skip silently (see test_invariant_3_fails_loud_when_overlay_has_data_and_products_db_broken)."""
    products_db_path = REPO_ROOT / "data" / "db" / "products.db"
    _run_invariant_3_orphan_guard(dossier_conn, products_db_path)


def test_invariant_3_fails_loud_when_overlay_has_data_and_products_db_broken(dossier_conn, tmp_path):
    """Regression guard for the gap flagged in code review: a corrupt/missing
    products.db must not silently swallow a real orphan-guard violation just
    because it happens to also be unreadable. Seeds a synthetic overlay row
    (cleaned up in a finally block, same pattern as invariant 4) and points
    the orphan-guard logic at a tmp_path sqlite file with no 'products'
    table -- simulating the broken-products.db condition without touching
    the real file."""
    broken_products_db = tmp_path / "products_missing_table.db"
    # Create a valid-but-wrong sqlite file (no 'products' table) so we
    # exercise the "table missing" branch, not the "file absent" branch.
    sqlite3.connect(broken_products_db).execute("CREATE TABLE not_products (x INTEGER)").connection.commit()

    dossier_conn.execute("""
        INSERT OR IGNORE INTO wine_dossier (wine_key, style_summary, review_status)
        VALUES ('__test_orphan_guard_key__', 'synthetic parent row', 'unreviewed')
    """)
    dossier_conn.execute("""
        INSERT OR IGNORE INTO sku_dossier_overlay (sku, wine_key)
        VALUES ('__TEST_ORPHAN_SKU__', '__test_orphan_guard_key__')
    """)
    dossier_conn.commit()
    try:
        with pytest.raises(pytest.fail.Exception, match="sku_dossier_overlay has .* rows but products.db"):
            _run_invariant_3_orphan_guard(dossier_conn, broken_products_db)
    finally:
        dossier_conn.execute("DELETE FROM sku_dossier_overlay WHERE sku = '__TEST_ORPHAN_SKU__'")
        dossier_conn.execute("DELETE FROM wine_dossier WHERE wine_key = '__test_orphan_guard_key__'")
        dossier_conn.commit()


def test_invariant_4_human_approved_survives_regeneration(dossier_conn):
    """Regenerating over review_status='human-approved' must be a no-op
    (clobber guard). This test exercises the guard directly rather than
    waiting for real human-approved content to exist."""
    try:
        dossier_conn.execute("""
            INSERT OR IGNORE INTO wine_dossier (wine_key, style_summary, review_status)
            VALUES ('__test_guard_key__', 'original approved text', 'human-approved')
        """)
        dossier_conn.commit()
        dossier_conn.execute("""
            INSERT INTO wine_dossier (wine_key, style_summary, review_status)
            VALUES ('__test_guard_key__', 'REGENERATED TEXT', 'unreviewed')
            ON CONFLICT(wine_key) DO UPDATE SET
                style_summary = excluded.style_summary
            WHERE wine_dossier.review_status != 'human-approved'
        """)
        dossier_conn.commit()
        row = dossier_conn.execute(
            "SELECT style_summary FROM wine_dossier WHERE wine_key = '__test_guard_key__'"
        ).fetchone()
        assert row[0] == "original approved text"
    finally:
        # cleanup -- always remove the synthetic row, even on assertion failure
        dossier_conn.execute("DELETE FROM wine_dossier WHERE wine_key = '__test_guard_key__'")
        dossier_conn.commit()


def test_invariant_5_provenance_guard(dossier_conn):
    """Any field marked 'sourced' has >=1 source_url; converse: a 'sourced'
    field whose column is NULL fails; provenance keys are a subset of the
    known field list (a typo'd key otherwise passes json_each tests silently)."""
    import sys
    sys.path.insert(0, str(REPO_ROOT))
    from data.lib.dossier.validators import (
        provenance_has_source_for_sourced_fields,
        unknown_provenance_keys,
    )
    rows = dossier_conn.execute(
        "SELECT wine_key, style_summary, expert_note, producer_history, provenance_json "
        "FROM wine_dossier WHERE provenance_json IS NOT NULL"
    ).fetchall()
    if not rows:
        pytest.skip("no provenance data yet")
    bad_source = []
    bad_keys = []
    for wine_key, style, note, history, prov_json in rows:
        provenance = json.loads(prov_json)
        missing_urls = provenance_has_source_for_sourced_fields(provenance)
        if missing_urls:
            bad_source.append((wine_key, missing_urls))
        unknown = unknown_provenance_keys(provenance)
        if unknown:
            bad_keys.append((wine_key, unknown))
    assert not bad_source, f"'sourced' fields with no source_urls: {bad_source[:10]}"
    assert not bad_keys, f"unknown provenance keys (typo risk): {bad_keys[:10]}"


def test_invariant_6_vintage_guard(dossier_conn):
    """Any honor with applies_to_stock=false must never render 'this bottle'
    phrasing -- validator-level check, exercised here against staged content."""
    rows = dossier_conn.execute(
        "SELECT sku, honors_json FROM sku_dossier_overlay WHERE honors_json IS NOT NULL"
    ).fetchall()
    if not rows:
        pytest.skip("no honors data yet")
    violations = []
    for sku, honors_json in rows:
        honors = json.loads(honors_json)
        for h in honors:
            if h.get("applies_to_stock") is False and "this bottle" in (h.get("supporting_text") or "").lower():
                violations.append(sku)
    assert not violations, f"SKUs with mismatched-vintage honors using 'this bottle' phrasing: {violations[:10]}"
