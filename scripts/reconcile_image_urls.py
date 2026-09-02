#!/usr/bin/env python3
"""Reconcile products.db image_url / magento_item_url / websites against
the winenow-base-images CSV.

WHY image_url RECONCILIATION EXISTS (recurring bug — see commits cfeb215,
e9e11c9, 0f4b327, edcf1fd):
Many distinct products had image_url pointing at ANOTHER SKU's bottle image
(e.g. 40+ wines all showing wrw6567gx.jpg = Riporta Nero D'Avola). A prior fix
reconciled the export + seed json + masterfile, but products.db got reverted/
re-seeded from a stale source afterward, resurrecting the wrong bottles.

SOURCE OF TRUTH: data/data mastefile WNLQ9/winenow-base-images-20260724.csv
(sku, item_name, websites, base_image_url, item_url). As of 2026-07-24 this
CSV has 0 blank base_image_url values, unlike the older masterfile image CSV
it replaces (which used blank='' to mean "intentionally no image"). The
blank-means-intentionally-blank / blank-the-DB behavior for image_url is kept
in this script (guarded, currently dormant) because a future refresh of this
same CSV could legitimately carry a blank for a delisted SKU — see CLAUDE.md
Rule 3 on not deleting behavior just because it's untriggered by today's data.

magento_item_url and websites are NEW fields with no prior "known-good" value
to protect, so they mirror the CSV exactly for any SKU present in it
(including blanking out on an empty CSV cell) rather than following
image_url's leave-alone-if-blank convention.

For ALL THREE fields: a SKU present in products.db but ABSENT from the CSV
entirely is left untouched (no_master rule) — this CSV does not cover every
existing SKU (141 known gaps as of 2026-07-24, 48 of which currently have a
populated image_url). Separately, a SKU whose CSV row is ragged/misaligned
(see load_master()'s ragged-row detection) is also left untouched — 14 such
SKUs as of 2026-07-24 — reported as its own count, distinct from no_master.

This script is idempotent. Run with --apply to write; default is dry-run.
After --apply you MUST run scripts/refresh_live_export.py (Rule 9).
"""
import argparse
import csv
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "products.db"
IMGCSV = ROOT / "data" / "data mastefile WNLQ9" / "winenow-base-images-20260831.csv"

SKU_RE = re.compile(r"/([a-z0-9_]+)\.jpg", re.I)

FIELDS = ("image_url", "magento_item_url", "websites")
CSV_COL_FOR_FIELD = {
    "image_url": "base_image_url",
    "magento_item_url": "item_url",
    "websites": "websites",
}


def img_token(url: str) -> str:
    """Filename stem of an image URL, lowercased (for comparison/logging)."""
    if not url:
        return ""
    m = SKU_RE.search(url)
    return m.group(1).lower() if m else url.lower()


def load_master() -> tuple[dict, list]:
    """sku(upper) -> {field: csv value string} for all three FIELDS.

    Returns (good, ragged_skus). ragged_skus is a distinct list from
    "absent from CSV" so a maintainer investigating why a SKU didn't
    reconcile can tell "not in this CSV at all" apart from "was in the
    CSV but its row was corrupted."
    """
    good = {}
    ragged_skus = []
    with open(IMGCSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip().upper()
            if not sku:
                continue
            # Ragged-row guard (symmetric — catches both directions of a
            # shifted row): as of 2026-07-24, 14 rows have an unquoted
            # comma inside item_name (e.g. "Monemvasia, Laloudi"), which
            # shifts websites/base_image_url/item_url one column to the
            # right for those rows. DictReader surfaces EXTRA fields
            # (more raw columns than headers) as an unmapped list under
            # the None key. The mirror case — FEWER raw columns than
            # headers, e.g. a dropped trailing comma — makes DictReader
            # pad the missing trailing mapped values with None (not ""),
            # which is otherwise indistinguishable from a legitimately
            # blank cell once naively coerced via `.strip()`. Checking
            # `is None` on the raw mapped values (before any .strip())
            # catches that case: a genuinely blank CSV cell parses as ""
            # from an actual comma-comma, never None. Skip both cases
            # entirely (fold into no_master) rather than guess at
            # realignment — writing shifted values would silently
            # corrupt the wrong fields for these SKUs.
            too_few = any(
                row.get(csv_col) is None for csv_col in CSV_COL_FOR_FIELD.values()
            )
            if row.get(None) is not None or too_few:
                ragged_skus.append(sku)
                print(f"SKIPPED (ragged/misaligned CSV row): {sku}")
                continue
            good[sku] = {
                field: (row.get(csv_col) or "").strip()
                for field, csv_col in CSV_COL_FOR_FIELD.items()
            }
    return good, ragged_skus


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default dry-run)")
    args = ap.parse_args()

    good, ragged_skus = load_master()
    ragged_set = set(ragged_skus)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    rows = cur.execute(
        "SELECT sku, image_url, magento_item_url, websites FROM products"
    ).fetchall()

    # fixes[field] = list of (sku, old, new)
    fixes = {field: [] for field in FIELDS}
    no_master = []  # SKUs absent from CSV entirely — left untouched, all fields

    for r in rows:
        sku = (r["sku"] or "").strip()
        if not sku:
            continue
        # Ragged-CSV-row SKUs were deliberately excluded from `good` by
        # load_master() and are reported in their own bucket — don't also
        # fold them into no_master, or they'd be double-counted across
        # both buckets and no_master would no longer equal the disclosed
        # 141-SKU coverage gap.
        if sku.upper() in ragged_set:
            continue
        master = good.get(sku.upper())
        if master is None:
            # Every SKU absent from the CSV counts here, regardless of
            # whether any field is currently populated in the DB — this
            # must equal the disclosed 141-SKU coverage gap on every run,
            # not just the subset that happens to have a populated
            # image_url today (magento_item_url/websites are NULL for
            # every row before the first reconcile, so gating on "any
            # field truthy" would undercount to 48 pre-reconcile and
            # change again after — always count the SKU itself).
            no_master.append(sku)
            continue
        for field in FIELDS:
            db_val = (r[field] or "").strip()
            csv_val = master[field]
            if db_val.lower() != csv_val.lower():
                fixes[field].append((sku, db_val, csv_val))

    print(f"DB rows: {len(rows)}  CSV SKUs: {len(good)}")
    for field in FIELDS:
        print(f"{field}: {len(fixes[field])} SKUs need reconcile")
    print(f"(SKU absent from CSV entirely, left untouched across all fields: {len(no_master)})")
    print(f"(SKU excluded due to ragged/misaligned CSV row, left untouched across all fields: {len(ragged_skus)})")
    print()

    for field in FIELDS:
        print(f"--- {field} changes (first 40) ---")
        for sku, old, new in fixes[field][:40]:
            if field == "image_url":
                old_disp, new_disp = img_token(old), (img_token(new) or "(BLANK)")
            else:
                old_disp, new_disp = (old or "(BLANK)"), (new or "(BLANK)")
            print(f"  {sku:12s} {old_disp!s:40.40s} -> {new_disp}")
        if len(fixes[field]) > 40:
            print(f"  ... and {len(fixes[field]) - 40} more")
        print()

    if fixes["image_url"]:
        blanked = sum(1 for _s, _o, new in fixes["image_url"] if not new)
        print(f"image_url blank-out count this run: {blanked} "
              f"({'dormant, as expected' if blanked == 0 else 'ACTIVE — review before applying'})")

    if not args.apply:
        print("\nDRY RUN — re-run with --apply to write, then run "
              "refresh_live_export.py and sync_to_supabase.py --products-only "
              "(--full-sync only needed if updated_at wasn't bumped by this run)")
        con.close()
        return 0

    # Bump updated_at for every row this run touches (any field), so
    # scripts/sync_to_supabase.py's incremental (non --full-sync) delta
    # query picks these rows up on the next normal run instead of silently
    # requiring --full-sync forever. Without this, reconcile writes to
    # products.db but the Supabase push never sees them via the normal
    # path (same failure shape as bug_dossier_sync_never_bumped_updated_at).
    touched_skus = sorted({sku for field in FIELDS for sku, _old, _new in fixes[field]})
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for field in FIELDS:
        if not fixes[field]:
            continue
        cur.executemany(
            f"UPDATE products SET {field} = ? WHERE sku = ?",
            [(new, sku) for sku, _old, new in fixes[field]],
        )
    if touched_skus:
        cur.executemany(
            "UPDATE products SET updated_at = ? WHERE sku = ?",
            [(now, sku) for sku in touched_skus],
        )
    con.commit()

    # Verify the write landed (Rule 1): re-query and assert invariant, per field.
    bad = 0
    for field in FIELDS:
        for sku, _old, new in fixes[field]:
            got = cur.execute(
                f"SELECT {field} FROM products WHERE sku = ?", (sku,)
            ).fetchone()[0]
            if (got or "").lower() != new.lower():
                bad += 1
                print(f"  !! STILL WRONG: {field} {sku} -> {got!r}")
    con.close()

    if bad:
        print(f"\nFAILED: {bad} rows did not take the update")
        return 1

    total = sum(len(fixes[f]) for f in FIELDS)
    print(f"\nApplied {total} corrections across {len(FIELDS)} fields. "
          f"Now run: .venv/bin/python scripts/refresh_live_export.py "
          f"&& .venv/bin/python scripts/sync_to_supabase.py --products-only")
    return 0


if __name__ == "__main__":
    sys.exit(main())
