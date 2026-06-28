"""
Apply product refiner attributes patch to products.db.

Steps:
1. Add origin_system and accessory_type columns (only these two — not category_group/type which
   are re-derived at export time, not material/compatible_use which have no clean source yet,
   and not attribute_confidence/source/review_status which duplicate existing enrichment fields).
2. Migrate regulatory codes from designation → origin_system, then NULL those designation rows.
3. NULL marketing terms (Limited/Vintage/Reserve) from designation field.
4. Populate appellation from patch, excluding region-level values.
5. Populate accessory_type from patch (accessories only).
6. Fix body casing drift (lowercase light/full → Title Case).
7. Fix tannin scale drift (Light/Full → Low/High to match the 4-step Low/Medium/High scale).
"""

import csv
import sqlite3
import sys
from pathlib import Path

DB = Path("data/db/products.db")
PATCH = Path("outputs/product-refiner-attributes-2026-06-27/product_refiner_upload_patch.csv")

# Appellation values that duplicate browse region/subregion — exclude from appellation field
REGION_LEVEL_APPELLATIONS = {
    "Champagne", "Barossa Valley", "Rioja", "Marlborough", "Margaret River",
    "Alsace", "Mosel",
}

# Regulatory certification system codes that belong in origin_system, NOT designation
REG_CODES = {"DOC", "DOCG", "IGT", "AOC", "DOP/IGP", "IGP", "AOP", "GG", "DO", "DOP", "DOCa", "AVA"}

# Marketing copy terms that are not qualitative tiers
MARKETING_TERMS = {"Limited", "Vintage", "Reserve"}

conn = sqlite3.connect(str(DB))
cur = conn.cursor()

# --- Step 1: Add new columns ---
print("Step 1: Adding origin_system and accessory_type columns...")
existing_cols = {r[1] for r in cur.execute("PRAGMA table_info(products)")}
for col, typ in [("origin_system", "TEXT"), ("accessory_type", "TEXT")]:
    if col not in existing_cols:
        cur.execute(f"ALTER TABLE products ADD COLUMN {col} {typ}")
        print(f"  Added {col}")
    else:
        print(f"  {col} already exists")
conn.commit()

# --- Step 2: Migrate regulatory codes designation → origin_system ---
print("\nStep 2: Migrating regulatory codes from designation → origin_system...")

# Load patch to get origin_system values for each SKU
patch_by_sku = {}
with open(PATCH, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        patch_by_sku[row["sku"]] = row

# For rows where current designation IS a reg code, set origin_system = that value (if not already set),
# then NULL designation. Use patch's origin_system if present (it may be more specific e.g. DOCa vs DOC).
migrated = 0
cleared_designation_reg = 0
for sku, prow in patch_by_sku.items():
    proposed_origin = prow.get("origin_system", "").strip()
    proposed_desig = prow.get("designation", "").strip()

    # Only act if proposed designation is a regulatory code
    if proposed_desig not in REG_CODES:
        continue

    # Write origin_system = proposed (patch may have a more specific variant like DOCa)
    origin_val = proposed_origin if proposed_origin else proposed_desig
    cur.execute(
        "UPDATE products SET origin_system = ? WHERE sku = ? AND (origin_system IS NULL OR origin_system = '')",
        (origin_val, sku),
    )
    # NULL the designation so regex in designation.ts takes over from product name
    cur.execute(
        "UPDATE products SET designation = NULL WHERE sku = ? AND designation IN ({})".format(
            ",".join("?" * len(REG_CODES))
        ),
        [sku] + list(REG_CODES),
    )
    if cur.rowcount:
        cleared_designation_reg += 1

# Also handle cases where existing DB designation is a reg code but SKU not in patch
cur.execute(
    "UPDATE products SET origin_system = designation WHERE designation IN ({}) AND (origin_system IS NULL OR origin_system = '')".format(
        ",".join("?" * len(REG_CODES))
    ),
    list(REG_CODES),
)
migrated = cur.rowcount

cur.execute(
    "UPDATE products SET designation = NULL WHERE designation IN ({})".format(
        ",".join("?" * len(REG_CODES))
    ),
    list(REG_CODES),
)
cleared_all = cur.rowcount
conn.commit()
print(f"  origin_system populated for {migrated} rows (from existing designation)")
print(f"  designation NULLed for {cleared_all} rows")

# Also set origin_system from patch for rows where origin_system is still empty
# (rows where patch has origin_system but designation was NOT a reg code)
os_from_patch = 0
for sku, prow in patch_by_sku.items():
    proposed_origin = prow.get("origin_system", "").strip()
    if not proposed_origin:
        continue
    cur.execute(
        "UPDATE products SET origin_system = ? WHERE sku = ? AND (origin_system IS NULL OR origin_system = '')",
        (proposed_origin, sku),
    )
    if cur.rowcount:
        os_from_patch += 1
conn.commit()
print(f"  origin_system set from patch for additional {os_from_patch} rows")

# --- Step 3: NULL marketing terms from designation ---
print("\nStep 3: Clearing marketing copy from designation field...")
cur.execute(
    "UPDATE products SET designation = NULL WHERE designation IN ({})".format(
        ",".join("?" * len(MARKETING_TERMS))
    ),
    list(MARKETING_TERMS),
)
cleared_mkt = cur.rowcount
conn.commit()
print(f"  Cleared {cleared_mkt} rows (Limited/Vintage/Reserve)")

# --- Step 4: Populate appellation from patch (exclude region-level values) ---
print("\nStep 4: Populating appellation from patch...")
appellation_written = 0
appellation_skipped_region = 0
for sku, prow in patch_by_sku.items():
    app_val = prow.get("appellation", "").strip()
    if not app_val:
        continue
    if app_val in REGION_LEVEL_APPELLATIONS:
        appellation_skipped_region += 1
        continue
    cur.execute(
        "UPDATE products SET appellation = ? WHERE sku = ? AND (appellation IS NULL OR appellation = '')",
        (app_val, sku),
    )
    if cur.rowcount:
        appellation_written += 1
conn.commit()
print(f"  Written: {appellation_written}")
print(f"  Skipped (region-level values): {appellation_skipped_region}")

# --- Step 5: Populate accessory_type from patch ---
print("\nStep 5: Populating accessory_type from patch...")
at_written = 0
for sku, prow in patch_by_sku.items():
    at_val = prow.get("accessory_type", "").strip()
    if not at_val:
        continue
    cur.execute(
        "UPDATE products SET accessory_type = ? WHERE sku = ?",
        (at_val, sku),
    )
    if cur.rowcount:
        at_written += 1
conn.commit()
print(f"  Written: {at_written}")

# --- Step 6: Fix body casing drift ---
print("\nStep 6: Fixing body casing drift...")
fixes = [("light", "Light"), ("full", "Full"), ("medium", "Medium")]
body_fixed = 0
for wrong, right in fixes:
    cur.execute("UPDATE products SET body = ? WHERE body = ?", (right, wrong))
    body_fixed += cur.rowcount
conn.commit()
print(f"  Fixed {body_fixed} rows")

# --- Step 7: Fix tannin scale drift ---
# The project uses Low/Medium/High as the 4-step tannin scale.
# Non-standard Light/Full found in DB get mapped to the canonical scale.
print("\nStep 7: Fixing tannin scale drift...")
tannin_fixes = [("Light", "Low"), ("Full", "High")]
tannin_fixed = 0
for wrong, right in tannin_fixes:
    cur.execute("UPDATE products SET tannin = ? WHERE tannin = ?", (right, wrong))
    tannin_fixed += cur.rowcount
conn.commit()
print(f"  Fixed {tannin_fixed} rows")

# --- Verification ---
print("\n=== Verification ===")
cur.execute("SELECT COUNT(*) FROM products WHERE designation IN ({})".format(
    ",".join("?" * len(REG_CODES))), list(REG_CODES))
print(f"Regulatory codes remaining in designation: {cur.fetchone()[0]} (should be 0)")

cur.execute("SELECT COUNT(*) FROM products WHERE designation IN ({})".format(
    ",".join("?" * len(MARKETING_TERMS))), list(MARKETING_TERMS))
print(f"Marketing terms remaining in designation: {cur.fetchone()[0]} (should be 0)")

cur.execute("SELECT COUNT(*) FROM products WHERE origin_system IS NOT NULL AND origin_system != ''")
print(f"origin_system populated: {cur.fetchone()[0]}")

cur.execute("SELECT COUNT(*) FROM products WHERE appellation IS NOT NULL AND appellation != ''")
print(f"appellation populated: {cur.fetchone()[0]}")

cur.execute("SELECT COUNT(*) FROM products WHERE accessory_type IS NOT NULL AND accessory_type != ''")
print(f"accessory_type populated: {cur.fetchone()[0]}")

cur.execute("SELECT designation, COUNT(*) FROM products WHERE designation IS NOT NULL AND designation != '' GROUP BY designation ORDER BY COUNT(*) DESC LIMIT 15")
print("\nTop designation values after fix:")
for row in cur.fetchall(): print(f"  {row[0]}: {row[1]}")

cur.execute("SELECT origin_system, COUNT(*) FROM products WHERE origin_system IS NOT NULL AND origin_system != '' GROUP BY origin_system ORDER BY COUNT(*) DESC LIMIT 10")
print("\nTop origin_system values:")
for row in cur.fetchall(): print(f"  {row[0]}: {row[1]}")

cur.execute("SELECT appellation, COUNT(*) FROM products WHERE appellation IS NOT NULL AND appellation != '' GROUP BY appellation ORDER BY COUNT(*) DESC LIMIT 15")
print("\nTop appellation values:")
for row in cur.fetchall(): print(f"  {row[0]}: {row[1]}")

conn.close()
print("\nDone. Run scripts/refresh_live_export.py next.")
