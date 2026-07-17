#!/usr/bin/env python3
"""Derive products.curation_dossier from dossier.db. Pattern:
lib/critic_reviews/refresh_products_summary.py. dossier.db is ATTACHed at
run time (own file -- kept separate from products.db because parallel
processes in this repo are known to replace products.db wholesale).

Consumer gate: only 'sourced' fields (+ 'pairing-theory' for pairings) reach
this public JSON. 'partial'/'model'/NULL never leave internal tooling.
stock_snapshot_json and provenance URLs are excluded entirely (price leak
risk / no reason to expose raw source URLs publicly).

FIELD COVERAGE (deliberately partial, not comprehensive): this deriver only
gates style_summary, expert_note, producer_history, and signature_pairings_json
today. wine_dossier has other content columns -- content_hooks_json,
occasion_tags_json, cuisine_tags_json, course_placement, serve_guidance_json --
that are NOT yet wired here, even though data/lib/dossier/validators.py's
KNOWN_PROVENANCE_FIELDS already treats them as legitimate gate-able fields.
This is safe today (Phase 0 has generated no content for any field), but
before Phase 1 populates any of these other columns with 'sourced' confidence,
extend derive_curation_dossier() to cover them -- otherwise that content will
silently never reach the public export, which is exactly the failure mode
Rule 1 (verify paid work lands in the user-facing destination) exists to catch.

Phase 0 note: this script is NOT yet wired into scripts/refresh_live_export.py
EXPORT_COLS or apps/catalog/lib/catalog-data.ts PUBLIC_FIELDS. That hookup is
deliberately deferred to right before real dossier content generation starts
(no point exposing a column that would sit permanently empty). Tests in
tests/test_refresh_products_dossier.py exercise this module entirely against
synthetic tmp_path fixture DBs, never the real products.db/dossier.db.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PRODUCTS_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_DOSSIER_DB = REPO_ROOT / "data" / "db" / "dossier.db"

_PUBLIC_CONFIDENCE = {"sourced", "pairing-theory"}


def _gate_field(value, field_name: str, provenance: dict):
    """Return value only if its provenance confidence clears the public bar."""
    if value is None:
        return None
    entry = (provenance or {}).get(field_name) or {}
    if entry.get("confidence") in _PUBLIC_CONFIDENCE:
        return value
    return None


def derive_curation_dossier(conn: sqlite3.Connection, sku: str, wine_key: str):
    """Build the public-facing curation_dossier JSON for one SKU/wine_key pair.
    Returns None when there's no dossier row, it's suppressed, or every field
    is gated out (never fabricate an empty-but-present JSON blob).

    Raises on malformed JSON in provenance_json/signature_pairings_json rather
    than swallowing it -- batch callers (refresh_all) are responsible for
    catching per-row failures so one bad row can't take down the whole run;
    this function stays strict so a single-SKU caller finds out immediately."""
    wd = conn.execute(
        "SELECT style_summary, expert_note, producer_history, "
        "signature_pairings_json, provenance_json, suppressed "
        "FROM dossier.wine_dossier WHERE wine_key = ?",
        (wine_key,),
    ).fetchone()
    if not wd or wd[5]:  # missing or suppressed
        return None
    style_summary, expert_note, producer_history, pairings_json, provenance_json, _ = wd
    provenance = json.loads(provenance_json) if provenance_json else {}

    out = {}
    gated_style = _gate_field(style_summary, "style_summary", provenance)
    if gated_style:
        out["style_summary"] = gated_style
    gated_note = _gate_field(expert_note, "expert_note", provenance)
    if gated_note:
        out["expert_note"] = gated_note
    gated_history = _gate_field(producer_history, "producer_history", provenance)
    if gated_history:
        out["producer_history"] = gated_history

    if pairings_json:
        pairings = json.loads(pairings_json)
        public_pairings = [p for p in pairings if p.get("confidence") in _PUBLIC_CONFIDENCE]
        if public_pairings:
            out["signature_pairings"] = public_pairings

    if not out:
        return None
    return json.dumps(out, ensure_ascii=False)


def refresh_all(conn: sqlite3.Connection) -> int:
    """Re-derive products.curation_dossier for every SKU with an overlay row.
    Self-healing: SKUs that lose their overlay/dossier get reset to NULL.

    Per-row isolation: a single SKU with malformed dossier content (bad JSON,
    missing keys, etc.) must not crash the whole batch, and must not corrupt
    OTHER, unrelated SKUs' already-correct values. Each row's derive+write is
    wrapped in its own try/except; on failure we log a warning identifying
    the SKU and skip writing for that SKU (its existing curation_dossier
    value is left untouched -- NOT forced to NULL, since that would itself
    be a data-loss action based on a failure that has nothing to do with
    that SKU's actual data)."""
    rows = conn.execute(
        "SELECT sku, wine_key FROM dossier.sku_dossier_overlay"
    ).fetchall()

    conn.execute("""
        UPDATE products SET curation_dossier = NULL
        WHERE curation_dossier IS NOT NULL
          AND sku NOT IN (SELECT sku FROM dossier.sku_dossier_overlay)
    """)

    written = 0
    for sku, wine_key in rows:
        try:
            dossier_json = derive_curation_dossier(conn, sku, wine_key)
        except Exception as exc:
            print(f"WARNING: skipping curation_dossier for sku={sku} "
                  f"wine_key={wine_key}: {exc}", file=sys.stderr)
            continue
        cur = conn.execute(
            "UPDATE products SET curation_dossier = ? WHERE sku = ?",
            (dossier_json, sku),
        )
        if dossier_json is not None and cur.rowcount > 0:
            written += 1
    conn.commit()
    return written


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--products-db", type=Path, default=DEFAULT_PRODUCTS_DB)
    ap.add_argument("--dossier-db", type=Path, default=DEFAULT_DOSSIER_DB)
    args = ap.parse_args(argv)

    if not args.products_db.exists():
        print(f"ERROR: products db not found: {args.products_db}", file=sys.stderr)
        return 1
    if not args.dossier_db.exists():
        print(f"ERROR: dossier db not found: {args.dossier_db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.products_db)
    # ATTACH doesn't support parameter binding for the path; this f-string is
    # intentionally not parameterized. Not a user-facing injection vector --
    # args.dossier_db only ever comes from an argparse CLI flag controlled by
    # whoever runs this script, never from request/user input.
    conn.execute(f"ATTACH DATABASE '{args.dossier_db}' AS dossier")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    if "curation_dossier" not in cols:
        print("ERROR: products.curation_dossier column missing -- add it first "
              "(ALTER TABLE products ADD COLUMN curation_dossier TEXT).", file=sys.stderr)
        return 1

    n = refresh_all(conn)
    print(f"Re-derived curation_dossier for {n} products.")
    print("Rule 9: now run  .venv/bin/python scripts/refresh_live_export.py")
    print("(EXPORT_COLS/JSON_COLS + PUBLIC_FIELDS hookup happens right before real content generation starts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
