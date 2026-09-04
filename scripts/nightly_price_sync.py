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

# Preferred source: a "Publish to web" CSV URL of the Masterfile
# (…/spreadsheets/d/e/<id>/pub?...&output=csv). Needs NO Google auth, so it is
# robust to service-account expiry and works from any machine/CI. Set
# MASTERFILE_CSV_URL to enable; otherwise we fall back to the private-sheet
# gspread path (which needs GOOGLE_SERVICE_ACCOUNT_JSON).
MASTERFILE_CSV_URL = os.environ.get("MASTERFILE_CSV_URL", "").strip()
# Lazy: only required by the gspread fallback, not the CSV path.
GOOGLE_SA_JSON = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")

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
def fetch_published_csv_rows(url: str) -> list[dict]:
    """Fetch Masterfile rows from a published-to-web CSV URL (no auth).

    Values are kept as strings (row_to_payload does its own numeric parsing),
    matching the gspread path's numericise_ignore=["all"] behaviour.
    """
    import csv
    import io
    import urllib.request

    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode("utf-8", "replace")
    rows = list(csv.DictReader(io.StringIO(text)))
    print(f"  Published CSV: {len(rows)} rows fetched", flush=True)
    return rows


def fetch_sheet_rows() -> list[dict]:
    # Prefer the no-auth published CSV when configured.
    if MASTERFILE_CSV_URL:
        return fetch_published_csv_rows(MASTERFILE_CSV_URL)

    import gspread
    from google.oauth2.service_account import Credentials

    if not GOOGLE_SA_JSON:
        raise RuntimeError(
            "Neither MASTERFILE_CSV_URL nor GOOGLE_SERVICE_ACCOUNT_JSON is set — "
            "cannot fetch the Masterfile. Set MASTERFILE_CSV_URL to a published-CSV URL."
        )
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
# Supabase bulk update via parallel REST PATCHes.
# Single PATCH per SKU (each has unique values) but run 50 concurrently.
# 11,855 rows / 50 workers ≈ 240 rounds → ~60s total. Proven to work.
# ---------------------------------------------------------------------------
PARALLEL_WORKERS = 50


def _patch_one(payload: dict) -> Optional[str]:
    import urllib.request
    import urllib.error

    sku = payload["sku"]
    body = {k: v for k, v in payload.items() if k != "sku"}
    url = f"{SUPABASE_URL}/rest/v1/products?sku=eq.{urllib.parse.quote(sku)}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }, method="PATCH")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status in (200, 204):
                return None
            return f"SKU {sku}: HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        return f"SKU {sku}: HTTP {e.code}"
    except Exception as e:
        return f"SKU {sku}: {e}"


def bulk_update(payloads: list[dict]) -> tuple[int, list[str]]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    errors: list[str] = []
    updated = 0

    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as pool:
        futures = {pool.submit(_patch_one, p): p["sku"] for p in payloads}
        done = 0
        for fut in as_completed(futures):
            done += 1
            err = fut.result()
            if err:
                errors.append(err)
            else:
                updated += 1
            if done % 500 == 0:
                print(f"  {done}/{len(payloads)} processed...", flush=True)

    return updated, errors


# ---------------------------------------------------------------------------
# Incremental: keep only rows whose price/detail actually changed vs Supabase.
# ---------------------------------------------------------------------------
# Fields we compare to decide "did this row change". Enriched fields are NOT
# here — this sync only ever touches price/cost/stock, never enrichment.
_COMPARE_FIELDS = [
    "price", "cost", "special_price", "sp_discount_pct",
    "b2b_price", "b2b_margin_thb", "b2b_margin_pct", "b2b_discount_pct",
    "margin_thb", "margin_pct",
    "is_in_stock", "custom_stock_status", "wn_stock", "consign",
]


def _fetch_current(skus: list[str]) -> dict[str, dict]:
    """Fetch current _COMPARE_FIELDS for the given SKUs from Supabase, keyed by sku."""
    import urllib.request
    base = f"{SUPABASE_URL}/rest/v1/products?select=sku,{','.join(_COMPARE_FIELDS)}"
    out: dict[str, dict] = {}
    offset, page = 0, 1000
    while True:
        req = urllib.request.Request(base, headers={
            "apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
            "Range-Unit": "items", "Range": f"{offset}-{offset + page - 1}",
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        for r in rows:
            out[str(r.get("sku"))] = r
        if len(rows) < page:
            break
        offset += page
    return out


def _norm(v) -> str:
    """Normalise a value for change comparison.

    Numerics compare at 1-decimal precision so historical rounding differences
    (e.g. a stored '4.0' vs a freshly computed '3.97' discount %) do NOT count
    as a change — otherwise those rows would re-sync forever and defeat the
    "only what changed" goal. A real price move of >=0.1 in any field still
    trips the comparison. Non-numerics compare as trimmed strings.
    """
    if v is None or v == "":
        return ""
    try:
        return f"{float(v):.1f}"
    except (TypeError, ValueError):
        return str(v).strip()


def filter_changed(payloads: list[dict]) -> list[dict]:
    """Return only payloads whose tracked fields differ from Supabase now.

    Stamps updated_at on the changed rows so downstream incremental consumers
    (and audit) see the real change time. Unchanged rows are dropped entirely —
    this is the "only sync what actually changed" behaviour.
    """
    current = _fetch_current([p["sku"] for p in payloads])
    changed: list[dict] = []
    absent = 0
    now_iso = datetime_now_iso()
    for p in payloads:
        cur = current.get(p["sku"])
        if cur is None:
            # SKU not in Supabase yet — a NEW product. This price-sync uses PATCH
            # (update-only) and cannot create rows; new products must be onboarded
            # by the ENGINE_PRODUCT product-import pipeline first. Skip + count so
            # the gap is visible, don't error.
            absent += 1
            continue
        if any(_norm(p.get(f)) != _norm(cur.get(f)) for f in _COMPARE_FIELDS):
            p["updated_at"] = now_iso
            changed.append(p)
    if absent:
        print(f"  NOTE: {absent} SKUs are in the Masterfile but not yet in Supabase "
              f"(new products) — skipped; onboard them via ENGINE_PRODUCT first.", flush=True)
    return changed


def datetime_now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


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

    print(f"  Prepared {len(payloads)} rows from source", flush=True)

    # Incremental: keep only rows whose price/detail actually changed vs Supabase.
    print("  Diffing against current Supabase values...", flush=True)
    changed = filter_changed(payloads)
    print(f"  {len(changed)} rows changed (of {len(payloads)}) — syncing only those", flush=True)

    if dry_run:
        print("\n[DRY RUN] No writes performed.")
        print(f"  Sample changed payload: {json.dumps(changed[0], indent=2)}" if changed
              else "  No changed rows — Supabase already matches the source.")
        result.upserted = len(changed)
        result.duration_s = time.time() - t0
        return result

    if not changed:
        print("  Nothing to write — Supabase already up to date.", flush=True)
        result.duration_s = time.time() - t0
        return result

    # PATCH only the changed rows.
    print(f"  Writing {len(changed)} changed rows to Supabase...", flush=True)
    updated, errs = bulk_update(changed)
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
