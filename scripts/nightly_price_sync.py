#!/usr/bin/env python3
"""
Nightly price sync: Google Sheets "MReport Masterfile" → Supabase products.

Only touches price/cost/stock columns. Never overwrites enriched fields.
Margins are always recomputed — sheet formula columns are ignored.

Usage:
    python scripts/nightly_price_sync.py           # live run
    python scripts/nightly_price_sync.py --dry-run # preview only
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SHEET_ID = "1m6JReDEdhTEk_VUno6tOU-DDlYhPxmL1RoU48VBljlU"
SHEET_TAB = "MReport Masterfile"
SUPABASE_URL = os.environ["SUPABASE_URL"]          # https://xxx.supabase.co
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GOOGLE_SA_JSON = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]  # full JSON string

# Supabase batch size for upserts
BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# Data parsing helpers
# ---------------------------------------------------------------------------
def _float(val: str) -> Optional[float]:
    v = val.strip().replace(",", "") if val else ""
    if not v or v in ("N/A", "-", "None", "#N/A", "#VALUE!"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _int(val: str) -> Optional[int]:
    v = val.strip() if val else ""
    if not v or v in ("N/A", "-", "None", "#N/A"):
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def _margin_pct(price: Optional[float], cost: Optional[float]) -> Optional[float]:
    if price and cost and price > 0:
        return round((price - cost) / price * 100, 2)
    return None


def _b2b_margin_pct(b2b: Optional[float], cost: Optional[float]) -> Optional[float]:
    if b2b and cost and b2b > 0:
        return round((b2b - cost) / b2b * 100, 2)
    return None


def _sp_discount_pct(price: Optional[float], sp: Optional[float]) -> Optional[float]:
    if price and sp and price > 0 and sp < price:
        return round((price - sp) / price * 100, 1)
    return None


def _b2b_discount_pct(price: Optional[float], b2b: Optional[float]) -> Optional[float]:
    if price and b2b and price > 0 and b2b < price:
        return round((price - b2b) / price * 100, 1)
    return None


# ---------------------------------------------------------------------------
# Result summary
# ---------------------------------------------------------------------------
@dataclass
class SyncResult:
    upserted: int = 0
    skipped_no_sku: int = 0
    skipped_no_price: int = 0
    errors: list[str] = field(default_factory=list)
    duration_s: float = 0.0

    def ok(self) -> bool:
        return len(self.errors) == 0

    def summary(self) -> str:
        lines = [
            "=== Nightly Price Sync ===",
            f"Upserted:          {self.upserted}",
            f"Skipped (no SKU):  {self.skipped_no_sku}",
            f"Skipped (no price):{self.skipped_no_price}",
            f"Errors:            {len(self.errors)}",
            f"Duration:          {self.duration_s:.1f}s",
        ]
        if self.errors:
            lines.append("Error details:")
            for e in self.errors[:10]:
                lines.append(f"  • {e}")
            if len(self.errors) > 10:
                lines.append(f"  … and {len(self.errors) - 10} more")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Sheet fetcher
# ---------------------------------------------------------------------------
def fetch_sheet_rows() -> list[dict]:
    import gspread
    from google.oauth2.service_account import Credentials

    sa_info = json.loads(GOOGLE_SA_JSON)
    scopes = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
    creds = Credentials.from_service_account_info(sa_info, scopes=scopes)
    gc = gspread.authorize(creds)

    sh = gc.open_by_key(SHEET_ID)
    ws = sh.worksheet(SHEET_TAB)
    rows = ws.get_all_records(numericise_ignore=["all"])  # keep everything as strings
    print(f"  Sheet: {len(rows)} rows fetched from '{SHEET_TAB}'", flush=True)
    return rows


# ---------------------------------------------------------------------------
# Row → Supabase payload
# ---------------------------------------------------------------------------
def row_to_payload(row: dict) -> Optional[dict]:
    sku = str(row.get("sku", "")).strip()
    if not sku:
        return None

    price = _float(row.get("price", ""))
    cost = _float(row.get("cost", ""))
    sp = _float(row.get("special_price", ""))
    b2b = _float(row.get("B2B", ""))
    wn_stock = _int(row.get("WN Stock", ""))
    consign = _int(row.get("Consign Stock", ""))
    is_in_stock = str(row.get("is_in_stock", "")).strip() or None
    custom_stock_status = str(row.get("custom_stock_status", "")).strip() or None

    # Always recompute margins — never trust sheet formula cells
    payload: dict = {
        "sku": sku,
        "price": price,
        "cost": cost,
        "special_price": sp,
        "sp_discount_pct": str(_sp_discount_pct(price, sp)) if _sp_discount_pct(price, sp) is not None else None,
        "b2b_price": b2b,
        "b2b_margin_thb": round(b2b - cost, 2) if b2b and cost else None,
        "b2b_margin_pct": str(_b2b_margin_pct(b2b, cost)) if _b2b_margin_pct(b2b, cost) is not None else None,
        "b2b_discount_pct": str(_b2b_discount_pct(price, b2b)) if _b2b_discount_pct(price, b2b) is not None else None,
        "margin_thb": round(price - cost, 2) if price and cost else None,
        "margin_pct": str(_margin_pct(price, cost)) if _margin_pct(price, cost) is not None else None,
        "is_in_stock": is_in_stock,
        "custom_stock_status": custom_stock_status,
        "wn_stock": wn_stock,
        "consign": str(consign) if consign is not None else None,
    }
    return payload


# ---------------------------------------------------------------------------
# Supabase bulk update via direct Postgres connection (psycopg2).
# One executemany() call — completes in seconds for 12k rows.
# We never INSERT — price sync only updates existing products.
# ---------------------------------------------------------------------------
SUPABASE_DB_URL = os.environ["SUPABASE_DB_URL"]

UPDATE_SQL = """
UPDATE products SET
    price=%s, cost=%s, special_price=%s, sp_discount_pct=%s,
    b2b_price=%s, b2b_margin_thb=%s, b2b_margin_pct=%s, b2b_discount_pct=%s,
    margin_thb=%s, margin_pct=%s,
    is_in_stock=%s, custom_stock_status=%s, wn_stock=%s, consign=%s,
    updated_at=NOW()
WHERE sku=%s
"""


def bulk_update(payloads: list[dict]) -> tuple[int, list[str]]:
    import psycopg2

    rows = [
        (
            p["price"], p["cost"], p["special_price"], p["sp_discount_pct"],
            p["b2b_price"], p["b2b_margin_thb"], p["b2b_margin_pct"], p["b2b_discount_pct"],
            p["margin_thb"], p["margin_pct"],
            p["is_in_stock"], p["custom_stock_status"], p["wn_stock"], p["consign"],
            p["sku"],
        )
        for p in payloads
    ]
    try:
        conn = psycopg2.connect(SUPABASE_DB_URL)
        cur = conn.cursor()
        cur.executemany(UPDATE_SQL, rows)
        updated = cur.rowcount if cur.rowcount >= 0 else len(rows)
        conn.commit()
        conn.close()
        return updated, []
    except Exception as e:
        return 0, [str(e)]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def run(dry_run: bool = False) -> SyncResult:
    result = SyncResult()
    t0 = time.time()

    print("Fetching sheet...", flush=True)
    rows = fetch_sheet_rows()

    payloads: list[dict] = []
    for row in rows:
        p = row_to_payload(row)
        if p is None:
            result.skipped_no_sku += 1
            continue
        if p.get("price") is None:
            result.skipped_no_price += 1
            continue
        payloads.append(p)

    print(f"  Prepared {len(payloads)} rows to update", flush=True)

    if dry_run:
        print("\n[DRY RUN] No writes performed.")
        print(f"  Sample payload: {json.dumps(payloads[0], indent=2)}" if payloads else "  No payloads")
        result.upserted = len(payloads)
        result.duration_s = time.time() - t0
        return result

    # Bulk update via direct Postgres — one round-trip for all rows
    print("  Writing to Supabase via Postgres...", flush=True)
    updated, errs = bulk_update(payloads)
    result.upserted = updated
    result.errors.extend(errs)
    print(f"  ✓ {updated} rows updated", flush=True)

    result.duration_s = time.time() - t0
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    res = run(dry_run=args.dry_run)
    print("\n" + res.summary())
    sys.exit(0 if res.ok() else 1)
