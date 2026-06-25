"""
Import masterfile price/stock data + image URLs into products.db.

Sources:
  - Masterfile CSV: cost, price, special_price, b2b_price, is_in_stock,
                    custom_stock_status, wn_stock, consign_stock
  - Image CSV:      image_url (base_image_url column)

Rules (per CLAUDE.md):
  - DB is source of truth for enriched fields; masterfile wins for price INPUTS
  - Margins are always RECOMPUTED from cost + price, never trusted from file
  - custom_stock_status='CATALOG' → internal-only; front-end shows 'Archive'
  - Never overwrite enriched fields (description, taste, country, etc.)
  - consign is internal only — stored in DB but NOT exported to live JSON
"""
from __future__ import annotations

import csv
import sqlite3
import argparse
from pathlib import Path

DB_PATH = Path("data/db/products.db")
IMAGE_CSV = Path("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/export_path_images_all_media_no_null_base_images.csv")
MASTER_CSV = Path("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile UPDATED.csv")


def parse_float(val: str) -> float | None:
    v = val.strip().replace(",", "") if val else ""
    if not v or v in ("N/A", "-", "None"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_int(val: str) -> int | None:
    v = val.strip() if val else ""
    if not v or v in ("N/A", "-", "None"):
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def compute_margin_pct(price: float | None, cost: float | None) -> float | None:
    if price and cost and price > 0:
        return round((price - cost) / price * 100, 2)
    return None


def compute_b2b_margin_pct(b2b: float | None, cost: float | None) -> float | None:
    if b2b and cost and b2b > 0:
        return round((b2b - cost) / b2b * 100, 2)
    return None


def compute_sp_discount_pct(price: float | None, sp: float | None) -> float | None:
    if price and sp and price > 0 and sp < price:
        return round((price - sp) / price * 100, 1)
    return None


def load_images(path: Path) -> dict[str, str]:
    mapping = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = row["sku"].strip()
            url = row["base_image_url"].strip()
            if sku and url:
                mapping[sku] = url
    return mapping


def load_masterfile(path: Path) -> dict[str, dict]:
    rows = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = row["sku"].strip()
            if sku:
                rows[sku] = row
    return rows


def run(dry_run: bool = False):
    print(f"{'[DRY RUN] ' if dry_run else ''}Loading source files...")

    images = load_images(IMAGE_CSV)
    masterfile = load_masterfile(MASTER_CSV)
    print(f"  Image CSV: {len(images)} SKUs with image URLs")
    print(f"  Masterfile: {len(masterfile)} SKUs")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT sku FROM products")
    db_skus = {r[0] for r in cur.fetchall()}
    print(f"  DB: {len(db_skus)} SKUs")

    # --- Image updates ---
    img_updated = img_skipped = img_new_value = 0
    image_updates = []

    for sku, url in images.items():
        if sku not in db_skus:
            img_skipped += 1
            continue
        cur.execute("SELECT image_url FROM products WHERE sku=?", (sku,))
        row = cur.fetchone()
        if row and row["image_url"] == url:
            img_skipped += 1
            continue
        image_updates.append((url, sku))
        img_updated += 1
        if not row or not row["image_url"]:
            img_new_value += 1

    print(f"\nImages: {img_updated} will update ({img_new_value} filling blank), {img_skipped} already correct / not in DB")

    # --- Price / stock updates ---
    matched = set(masterfile.keys()) & db_skus
    not_in_db = set(masterfile.keys()) - db_skus
    print(f"\nMasterfile: {len(matched)} matched to DB, {len(not_in_db)} not in DB (skipped)")

    price_rows = []
    stock_rows = []
    counters = {
        "price": 0, "cost": 0, "special_price": 0, "b2b": 0,
        "is_in_stock": 0, "custom_stock_status": 0, "wn_stock": 0, "consign": 0,
    }

    for sku in matched:
        mf = masterfile[sku]

        cost = parse_float(mf.get("cost", ""))
        price = parse_float(mf.get("price", ""))
        sp = parse_float(mf.get("special_price", ""))
        b2b = parse_float(mf.get("B2B", ""))
        wn_stock = parse_int(mf.get("WN Stock", ""))
        consign = parse_int(mf.get("Consign Stock", ""))
        is_in_stock = mf.get("is_in_stock", "").strip() or None
        custom_stock_status = mf.get("custom_stock_status", "").strip() or None

        # Recompute margins — never trust file cells
        margin_pct = compute_margin_pct(price, cost)
        margin_thb = round(price - cost, 2) if price and cost else None
        b2b_margin_pct = compute_b2b_margin_pct(b2b, cost)
        b2b_margin_thb = round(b2b - cost, 2) if b2b and cost else None
        b2b_discount_pct = round((price - b2b) / price * 100, 1) if b2b and price and price > 0 else None
        sp_discount_pct = compute_sp_discount_pct(price, sp)

        price_rows.append((
            price, cost, sp, sp_discount_pct,
            b2b, b2b_margin_thb, b2b_margin_pct, b2b_discount_pct,
            margin_thb, margin_pct,
            sku,
        ))
        stock_rows.append((is_in_stock, custom_stock_status, wn_stock, consign, sku))

        if price: counters["price"] += 1
        if cost: counters["cost"] += 1
        if sp: counters["special_price"] += 1
        if b2b: counters["b2b"] += 1
        if is_in_stock: counters["is_in_stock"] += 1
        if custom_stock_status: counters["custom_stock_status"] += 1
        if wn_stock: counters["wn_stock"] += 1
        if consign: counters["consign"] += 1

    print(f"\nPrice rows to write: {len(price_rows)}")
    print(f"  price={counters['price']} | cost={counters['cost']} | special_price={counters['special_price']} | b2b={counters['b2b']}")
    print(f"Stock rows to write: {len(stock_rows)}")
    print(f"  is_in_stock={counters['is_in_stock']} | custom_stock_status={counters['custom_stock_status']} | wn_stock={counters['wn_stock']} | consign={counters['consign']}")

    if dry_run:
        print("\n[DRY RUN] No writes performed.")
        conn.close()
        return

    print("\nWriting to DB...")

    # Write images
    cur.executemany(
        "UPDATE products SET image_url=?, updated_at=datetime('now') WHERE sku=?",
        image_updates,
    )
    print(f"  ✓ {cur.rowcount} image URLs written")

    # Write prices (recomputed margins)
    cur.executemany(
        """UPDATE products SET
            price=?, cost=?, special_price=?, sp_discount_pct=?,
            b2b_price=?, b2b_margin_thb=?, b2b_margin_pct=?, b2b_discount_pct=?,
            margin_thb=?, margin_pct=?,
            updated_at=datetime('now')
           WHERE sku=?""",
        price_rows,
    )
    print(f"  ✓ {cur.rowcount} price rows written")

    # Write stock
    cur.executemany(
        """UPDATE products SET
            is_in_stock=?, custom_stock_status=?, wn_stock=?, consign=?,
            updated_at=datetime('now')
           WHERE sku=?""",
        stock_rows,
    )
    print(f"  ✓ {cur.rowcount} stock rows written")

    conn.commit()
    conn.close()
    print("\nDB write complete.")


def verify():
    print("\n--- Verification ---")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) as n FROM products WHERE price IS NOT NULL AND price > 0")
    print(f"Products with price > 0: {cur.fetchone()['n']}")

    cur.execute("SELECT COUNT(*) as n FROM products WHERE image_url IS NOT NULL AND image_url != ''")
    print(f"Products with image_url: {cur.fetchone()['n']}")

    cur.execute("SELECT COUNT(*) as n FROM products WHERE is_in_stock = '1'")
    print(f"is_in_stock=1: {cur.fetchone()['n']}")

    cur.execute("SELECT custom_stock_status, COUNT(*) as cnt FROM products GROUP BY custom_stock_status ORDER BY cnt DESC")
    print("custom_stock_status distribution:")
    for r in cur.fetchall():
        print(f"  {dict(r)}")

    cur.execute("SELECT COUNT(*) as n FROM products WHERE wn_stock IS NOT NULL AND wn_stock > 0")
    print(f"wn_stock > 0: {cur.fetchone()['n']}")

    cur.execute("SELECT COUNT(*) as n FROM products WHERE consign IS NOT NULL AND consign > 0")
    print(f"consign > 0: {cur.fetchone()['n']}")

    # Sample price check
    print("\nSample prices (5 rows):")
    cur.execute("SELECT sku, price, cost, margin_pct, special_price, b2b_price FROM products WHERE price > 0 LIMIT 5")
    for r in cur.fetchall():
        print(f"  {dict(r)}")

    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no DB writes")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
    if not args.dry_run:
        verify()
