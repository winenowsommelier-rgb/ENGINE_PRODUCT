#!/usr/bin/env python3
"""Phase-3 region enrichment for Scotch whisky.

Maps Scotch single-malt brands to their distillery's geographic region:
  Speyside / Highland / Lowland / Islay / Campbeltown / Islands

Blended Scotch is multi-region by design — those rows stay blank and are
flagged validation_status='needs_review' with an explanatory note.

Non-whisky Scotland products (gin, beer, glassware) are not touched.
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

WHISKY_CLS = {"Whisky", "Whiskey", "Scotch", "Single Malt"}

# distillery brand -> (region, confidence)
SCOTCH_REGION: dict[str, tuple[str, str]] = {
    # Speyside
    "The Macallan":      ("Speyside", "high"),
    "The Balvenie":      ("Speyside", "high"),
    "Glenfiddich":       ("Speyside", "high"),
    "The Glenlivet":     ("Speyside", "high"),
    "Singleton":         ("Speyside", "high"),       # Singleton of Dufftown / Glendullan / Glen Ord (mostly Speyside)
    "Glen Moray":        ("Speyside", "high"),
    "Aberlour":          ("Speyside", "high"),
    "Tomintoul":         ("Speyside", "high"),
    "Tamnavulin":        ("Speyside", "high"),
    "Mortlach":          ("Speyside", "high"),
    "Cragganmore":       ("Speyside", "high"),
    "Roseisle":          ("Speyside", "high"),
    # Highland (mainland)
    "Glenmorangie":      ("Highland", "high"),
    "Old Pulteney":      ("Highland", "high"),
    "The Dalmore":       ("Highland", "high"),
    "Glenturret":        ("Highland", "high"),
    "Glen Turner":       ("Highland", "high"),
    "Wolfburn":          ("Highland", "high"),       # Thurso, Northern Highland
    "Dalwhinnie":        ("Highland", "high"),
    "Balblair":          ("Highland", "high"),
    "Fettercairn":       ("Highland", "high"),
    "Loch Lomond":       ("Highland", "high"),
    # Islay
    "Lagavulin":         ("Islay", "high"),
    "Ardbeg":            ("Islay", "high"),
    "Kilchoman":         ("Islay", "high"),
    # Lowland
    "Glenkinchie":       ("Lowland", "high"),
    "King's Inch":       ("Lowland", "high"),        # Glasgow distillery
    # Islands (sub-zone of Highland; we use 'Islands' as the region label)
    "Talisker":          ("Islands", "high"),        # Skye
    "Jura":              ("Islands", "high"),        # Jura
}

# Brands that are explicitly multi-region blends — flag for review, don't assign a region
BLEND_BRANDS = {
    "Johnnie Walker", "Chivas Regal", "Royal Salute", "Dewar's", "Ballantine's",
    "Famous Grouse", "Compass Box", "Cutty Sark", "Grant's", "Monkey Shoulder",
    "Dandy", "John Barr", "Lower East Side", "Moonshine Runners", "Shackleton",
    "The Deacon", "Matisse", "Crabbie’s",
    # Independent bottlers — varies by release
    "Douglas Laing", "Old Malt Cask", "Lost Distillery", "That Boutique-y Whisky Company",
}


def load_env(env_path):
    out = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def atomic_write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=str(path.parent), delete=False, suffix=".tmp", encoding="utf-8") as tmp:
        json.dump(data, tmp, indent=2, ensure_ascii=False)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)


def push(rows, env):
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not rows or not url or not key:
        return 0, 0
    sent, failed = 0, 0
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i+CHUNK]
        body = json.dumps(chunk).encode("utf-8")
        req = urllib.request.Request(
            f"{url}/rest/v1/products?on_conflict=sku",
            data=body, method="POST",
            headers={
                "apikey": key, "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if 200 <= resp.status < 300:
                    sent += len(chunk)
                else:
                    failed += len(chunk)
        except urllib.error.HTTPError as e:
            failed += len(chunk)
            print(f"FAIL {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}", file=sys.stderr)
        except urllib.error.URLError as e:
            failed += len(chunk)
            print(f"URLError: {e}", file=sys.stderr)
    return sent, failed


def main():
    products = json.loads(PRODUCTS_PATH.read_text())
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    upgraded = []
    blends = 0
    other_unmatched = 0

    for p in products:
        if p.get("country") != "Scotland":
            continue
        if (p.get("classification") or "") not in WHISKY_CLS:
            continue
        if (p.get("region") or "").strip():
            continue  # only blank regions
        brand = (p.get("brand") or "").strip()
        if brand in SCOTCH_REGION:
            new_region, conf = SCOTCH_REGION[brand]
            p["region"] = new_region
            p["enrichment_note"] = f"Scotch region set to {new_region!r} via distillery rule (confidence={conf})"
            p["enrichment_source"] = f"distillery_region_rule_{conf}"
            p["updated_at"] = now
            upgraded.append({"sku": p["sku"], "id": str(p["id"]), "brand": brand, "region": new_region, "conf": conf})
        elif brand in BLEND_BRANDS:
            p["validation_status"] = "needs_review"
            p["enrichment_note"] = f"{brand} is a multi-region blend / independent bottler — region is not single-distillery"
            p["enrichment_source"] = "scotch_blend_no_region"
            p["updated_at"] = now
            blends += 1
        else:
            p["validation_status"] = "needs_review"
            p["enrichment_note"] = f"Scotch with no distillery rule for brand {brand!r}; needs manual region assignment"
            p["updated_at"] = now
            other_unmatched += 1

    print(f"Upgraded: {len(upgraded)}")
    print(f"Blends flagged needs_review: {blends}")
    print(f"Other unmatched flagged needs_review: {other_unmatched}")
    if upgraded:
        from collections import Counter
        by_region = Counter(u["region"] for u in upgraded)
        print("\nBy region:")
        for r, c in by_region.most_common():
            print(f"  {r:<12}  {c}")
        print("\nBy brand:")
        by_brand = Counter((u["brand"], u["region"]) for u in upgraded)
        for (b, r), c in sorted(by_brand.items(), key=lambda x: -x[1]):
            print(f"  {b:<22} {c:>3}  -> {r}")

    if not upgraded and blends == 0 and other_unmatched == 0:
        return 0

    atomic_write_json(PRODUCTS_PATH, products)
    print(f"\nWrote {PRODUCTS_PATH.name}")

    upgraded_skus = {u["sku"] for u in upgraded}
    rows = []
    for p in products:
        if p.get("sku") in upgraded_skus or (p.get("validation_status") == "needs_review" and p.get("updated_at") == now):
            rows.append({
                "id": str(p["id"]),
                "sku": p["sku"],
                "region": p.get("region"),
                "subregion": p.get("subregion"),
                "validation_status": p.get("validation_status"),
                "enrichment_note": p.get("enrichment_note"),
                "enrichment_source": p.get("enrichment_source"),
            })
    sent, failed = push(rows, load_env(ENV_PATH))
    print(f"Supabase: sent={sent}, failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
