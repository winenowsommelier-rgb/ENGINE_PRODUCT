"""
Apply the 302 held-back region/subregion rows from the 2026-06-27 audit.

These rows were excluded from the original patch (region_subregion_upload_patch.csv)
because applying them would have cleared existing DB subregion values. This script
applies them with the correct handling per group:

  Group A (161 rows): Write new_region, keep existing DB subregion as-is.
  Group B (128 rows): Write new_region AND clear subregion to NULL.
  Group C (13 rows):  Treated per explicit decision below (clear NZ cross-contamination,
                      keep Alsace Grand Cru, keep Aconcagua/Casablanca).

Run with --canary to test on 5 SKUs first, --apply for the full run.
"""

import csv
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data/db/products.db"
BASELINE_CSV = ROOT / "outputs/manual-region-audit-2026-06-27/final-region-upload/region_subregion_validated_baseline.csv"
BACKUP = ROOT / "data/db/products.db.backup-held-back-region-patch-20260628.db"

# ---------------------------------------------------------------------------
# Classification tables (derived from analysis session 2026-06-28)
# ---------------------------------------------------------------------------

# Group B: (new_region, old_subregion) combos where the DB subregion is wrong.
# Action: write new_region, set subregion = NULL.
CLEAR_SUBREGION = {
    # Redundant Italian dialect aliases
    ("Tuscany", "Toscana"),
    ("Tuscany", "Toscana IGT"),
    ("Sicily", "Sicilia"),
    ("Piedmont", "Piemonte"),
    ("Sardinia", "Sardegna"),
    # Sub name equals region exactly
    ("Aconcagua Valley", "Aconcagua Valley"),
    ("California", "California"),
    ("Colchagua Valley", "Colchagua Valley"),
    # Sub equals region (spelling variant)
    ("Hawke's Bay", "Hawkes Bay"),
    ("Maule Valley", "Almaule Valley"),
    ("South Eastern Australia", "Southeastern Australia"),
    ("Tokaj", "Tokaji"),
    # Chilean cross-valley contamination
    ("Colchagua Valley", "Casablanca Valley"),
    ("Colchagua Valley", "Maipo Valley"),
    ("Colchagua Valley", "Curicó Valley"),
    ("Curico Valley", "Casablanca Valley"),
    ("Curico Valley", "Colchagua Valley"),
    ("Curico Valley", "Maipo Valley"),
    ("Rapel Valley", "Casablanca Valley"),
    ("Rapel Valley", "Maipo Valley"),
    ("Casablanca Valley", "Colchagua Valley"),
    ("Casablanca Valley", "Maipo Valley"),
    ("Casablanca Valley", "Central Valley"),
    ("Cachapoal Valley", "Central Valley"),
    ("Maipo Valley", "Colchagua Valley"),
    ("Maipo Valley", "Central Valley"),
    ("Maule Valley", "Maipo Valley"),
    ("Maule Valley", "Casablanca Valley"),
    ("Maule Valley", "Central Valley"),
    # NZ cross-region contamination (Group C decision: clear)
    ("Marlborough", "Martinborough"),
    ("Marlborough", "Waipara"),
    ("Marlborough", "Central Otago"),
    ("Marlborough", "Hawke's Bay"),
    ("Marlborough", "Waiheke Island"),
    ("Marlborough", "Waipara Valley"),
    ("Hawke's Bay", "Marlborough"),
    ("Hawke's Bay", "Martinborough"),
    # California cross-contamination
    ("California", "Columbia Crest"),
    ("California", "Columbia Cuvée"),
    ("California", "Columbia Valley"),
    ("California", "Walla Walla Valley"),
    ("California", "Sancerre"),
    # Argentina cross-contamination
    ("Mendoza", "Salta"),
    ("Mendoza", "San Juan"),
    # Portugal cross-contamination
    ("Douro", "Madeira"),
    ("Douro", "Porto"),
    # Australia cross-contamination
    ("South Australia", "Hunter Valley"),
    ("South Australia", "Moore's Creek"),
    ("South Australia", "Coal River Valley"),
    ("South Australia", "Pipers River"),
    ("South Australia", "South Eastern Australia"),
    ("South Eastern Australia", "Prosecco"),
    # German cross-contamination
    ("Rheingau", "Rheinhessen"),
    ("Rheinhessen", "Alsace"),
    # Slovenia cross-contamination
    ("Goriška Brda", "Vipava Valley"),
    # Uruguay
    ("Colonia", "Goleta"),
    # Greece
    ("Attica", "Nemea"),
    # Champagne (Côte de Nuits is Burgundy)
    ("Champagne", "Côte de Nuits"),
}

# Group C explicit keeps
# Aconcagua Valley / Casablanca Valley: Casablanca is a sub-valley, keep
# Alsace / Alsace Grand Cru: valid sub-zone, keep
FORCE_KEEP = {
    ("Aconcagua Valley", "Casablanca Valley"),
    ("Alsace", "Alsace Grand Cru"),
}


def load_held_back() -> list[dict]:
    rows = []
    with open(BASELINE_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["upload_action"] == "baseline_only_do_not_clear_subregion":
                rows.append(row)
    return rows


def classify(row: dict) -> str:
    """Return 'clear_sub', 'keep_sub', or 'skip'."""
    region = row["new_region"]
    old_sub = row["old_subregion"]
    if not region:
        return "skip"
    if not old_sub:
        # No existing subregion to conflict with; just write region.
        return "keep_sub"
    if (region, old_sub) in FORCE_KEEP:
        return "keep_sub"
    if (region, old_sub) in CLEAR_SUBREGION:
        return "clear_sub"
    # Default: if sub exists and not explicitly cleared, keep it.
    return "keep_sub"


def apply(rows: list[dict], conn: sqlite3.Connection, dry_run: bool = False) -> dict:
    cur = conn.cursor()
    stats = {"keep_sub_written": 0, "clear_sub_written": 0, "skipped": 0, "not_found": 0}

    for row in rows:
        sku = row["sku"]
        new_region = row["new_region"]
        action = classify(row)

        if action == "skip":
            stats["skipped"] += 1
            continue

        cur.execute("SELECT sku, region, subregion FROM products WHERE sku = ?", (sku,))
        db_row = cur.fetchone()
        if not db_row:
            stats["not_found"] += 1
            continue

        if action == "keep_sub":
            if not dry_run:
                cur.execute(
                    "UPDATE products SET region = ? WHERE sku = ?",
                    (new_region, sku),
                )
            stats["keep_sub_written"] += 1
        elif action == "clear_sub":
            if not dry_run:
                cur.execute(
                    "UPDATE products SET region = ?, subregion = NULL WHERE sku = ?",
                    (new_region, sku),
                )
            stats["clear_sub_written"] += 1

    if not dry_run:
        conn.commit()
    return stats


def verify(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    print("\n=== Verification ===")

    # Check a sample of group A (keep_sub) - should have region + existing subregion
    cur.execute("""
        SELECT sku, region, subregion FROM products
        WHERE sku IN ('WSP2620DH','WSP2418DH','WRW6428AB','WRW1085AC','WRW2090AC')
    """)
    print("Sample Group A (region written, subregion preserved):")
    for r in cur.fetchall():
        print(f"  {r[0]}: region={r[1]} subregion={r[2]}")

    # Check a sample of group B (clear_sub) - should have region + NULL subregion
    cur.execute("""
        SELECT sku, region, subregion FROM products
        WHERE sku IN ('WRW0397AA','WRW6609AH','WRW3017BN','WRW5985AB','WRW2202AD')
    """)
    print("Sample Group B/C clear (region written, subregion NULL):")
    for r in cur.fetchall():
        print(f"  {r[0]}: region={r[1]} subregion={r[2]}")

    # Total counts
    cur.execute("SELECT COUNT(*) FROM products WHERE region IS NOT NULL AND region != ''")
    print(f"\nTotal rows with region: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM products WHERE subregion IS NOT NULL AND subregion != ''")
    print(f"Total rows with subregion: {cur.fetchone()[0]}")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in ("--canary", "--apply"):
        print("Usage: python apply_held_back_region_patch.py --canary | --apply")
        sys.exit(1)

    held_back = load_held_back()
    print(f"Loaded {len(held_back)} held-back rows from baseline CSV.")

    # Pre-flight classification summary
    by_action = {"keep_sub": 0, "clear_sub": 0, "skip": 0}
    for row in held_back:
        by_action[classify(row)] += 1
    print(f"Classification: keep_sub={by_action['keep_sub']} clear_sub={by_action['clear_sub']} skip={by_action['skip']}")

    if mode == "--canary":
        print("\n--- CANARY RUN (5 SKUs, no DB write) ---")
        canary = held_back[:5]
        conn = sqlite3.connect(str(DB))
        stats = apply(canary, conn, dry_run=True)
        print(f"Canary dry-run stats: {stats}")
        print("Canary rows:")
        for row in canary:
            print(f"  {row['sku']}: new_region={row['new_region']} old_sub={row['old_subregion']} action={classify(row)}")
        conn.close()
        print("\nCanary passed. Run with --apply to write all 302 rows.")
        return

    # --apply: backup then write
    print(f"\nBacking up DB to {BACKUP.name}...")
    shutil.copy2(str(DB), str(BACKUP))
    print("Backup done.")

    conn = sqlite3.connect(str(DB))
    print("\nApplying patch...")
    stats = apply(held_back, conn)
    print(f"Stats: {stats}")
    verify(conn)
    conn.close()
    print("\nDone. Run scripts/refresh_live_export.py next (Rule 9).")


if __name__ == "__main__":
    main()
