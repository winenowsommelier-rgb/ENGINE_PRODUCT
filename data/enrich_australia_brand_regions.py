#!/usr/bin/env python3
"""Apply brand → home-region upgrades for coarse-region Australian products.

For each Australian product whose region is "South Australia" / "South Eastern
Australia" / "Victoria" / "Tasmania" / blank, look up the brand in BRAND_REGION.
If the brand has a single high-confidence home region, upgrade region (and write
to subregion only if it's a real subregion within the same region).

Multi-region producers (Penfolds, De Bortoli, Lindeman's, etc.) are intentionally
absent from BRAND_REGION — they stay at the coarse level until per-product-line
rules are added.

Reads/writes data/db/products.json. Pushes the same updates to Supabase.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_PATH = REPO_ROOT / "data" / "db" / "products.json"
ENV_PATH = REPO_ROOT / ".env.local"
COARSE_REGIONS = {"South Australia", "South Eastern Australia", "Victoria", "Tasmania", ""}

# Brand -> (region, subregion). Subregion is "" when brand sits at region level.
# Curated for high-confidence single-region producers only.
BRAND_REGION: dict[str, tuple[str, str]] = {
    "Angove":             ("Riverland", ""),
    "Jacob's Creek":      ("Barossa Valley", ""),
    "Wolf Blass":         ("Barossa Valley", ""),
    "Chandon":            ("Yarra Valley", ""),
    "McGuigan":           ("Hunter Valley", ""),
    "Mcguigan":           ("Hunter Valley", ""),  # casing variant in data
    "Yellow Tail":        ("Riverina", ""),
    "Hardys":             ("McLaren Vale", ""),
    "Gapsted":            ("King Valley", ""),
    "Mount Langi Ghiran": ("Grampians", ""),
    "Tyrrell's":          ("Hunter Valley", ""),
    "Yalumba":            ("Eden Valley", ""),
    "Banrock Station":    ("Riverland", ""),
    "Norfolk Rise":       ("Mount Benson", ""),
    "Castelli Estate":    ("Great Southern", ""),
    "George Wyndham":     ("Hunter Valley", ""),
    "Oxford Landing":     ("Riverland", ""),
    "Victoria Park":      ("Margaret River", ""),
}


def load_env(env_path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not env_path.exists():
        return out
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def atomic_write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=str(path.parent), delete=False, suffix=".tmp", encoding="utf-8"
    ) as tmp:
        json.dump(data, tmp, indent=2, ensure_ascii=False)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)


def push_to_supabase(rows: list[dict], env: dict[str, str]) -> tuple[int, int]:
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        print("WARN: missing Supabase env, skipping push", file=sys.stderr)
        return 0, 0
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/rest/v1/products?on_conflict=sku",
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if 200 <= resp.status < 300:
                return len(rows), 0
            return 0, len(rows)
    except urllib.error.HTTPError as e:
        print(f"FAIL {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}", file=sys.stderr)
        return 0, len(rows)


def main() -> int:
    products = json.loads(PRODUCTS_PATH.read_text())
    upgraded: list[dict] = []
    by_brand: dict[str, int] = {}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for p in products:
        if p.get("country") != "Australia":
            continue
        old_region = p.get("region") or ""
        if old_region not in COARSE_REGIONS:
            continue
        brand = (p.get("brand") or "").strip()
        if brand not in BRAND_REGION:
            continue
        new_region, new_sub = BRAND_REGION[brand]
        if not new_region:
            continue
        # Apply
        p["region"] = new_region
        if new_sub:
            p["subregion"] = new_sub
        p["enrichment_note"] = f"region upgraded from {old_region!r} to {new_region!r} via brand→region rule"
        p["enrichment_source"] = "brand_region_rule"
        p["updated_at"] = now
        upgraded.append({
            "sku": p["sku"],
            "id": str(p["id"]),
            "brand": brand,
            "old_region": old_region,
            "new_region": new_region,
            "new_subregion": new_sub,
            "name": p.get("name", ""),
        })
        by_brand[brand] = by_brand.get(brand, 0) + 1

    print(f"Upgraded {len(upgraded)} Australian products via brand rules.")
    print()
    print("By brand:")
    for brand, count in sorted(by_brand.items(), key=lambda x: -x[1]):
        new_region, _ = BRAND_REGION[brand]
        print(f"  {brand:<25}  {count:>3}  -> {new_region}")

    if not upgraded:
        print("No upgrades to apply.")
        return 0

    atomic_write_json(PRODUCTS_PATH, products)
    print(f"\nWrote {len(upgraded)} updates to {PRODUCTS_PATH.name}")

    # Push to Supabase
    env = load_env(ENV_PATH)
    upgraded_skus = {u["sku"] for u in upgraded}
    rows_to_push = [
        {
            "id": str(p["id"]),
            "sku": p["sku"],
            "region": p.get("region"),
            "subregion": p.get("subregion"),
            "enrichment_note": p.get("enrichment_note"),
            "enrichment_source": p.get("enrichment_source"),
        }
        for p in products
        if p.get("sku") in upgraded_skus
    ]
    sent, failed = push_to_supabase(rows_to_push, env)
    print(f"Supabase: sent={sent}, failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
