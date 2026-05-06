#!/usr/bin/env python3
"""Normalize region-name variants (accent / casing duplicates).

Currently: "Curico Valley" -> "Curicó Valley".
Add more entries to NORMALIZATIONS as duplicates surface.
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

NORMALIZATIONS: dict[str, str] = {
    "Curico Valley": "Curicó Valley",
    "Limari Valley": "Limarí Valley",
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


def main():
    products = json.loads(PRODUCTS_PATH.read_text())
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    touched = []
    for p in products:
        old = p.get("region") or ""
        if old in NORMALIZATIONS:
            new = NORMALIZATIONS[old]
            p["region"] = new
            p["updated_at"] = now
            touched.append({"sku": p["sku"], "id": str(p["id"]), "old": old, "new": new})

    print(f"Normalized {len(touched)} region values:")
    counts = {}
    for t in touched:
        k = (t["old"], t["new"])
        counts[k] = counts.get(k, 0) + 1
    for (old, new), c in counts.items():
        print(f"  {c:>4}  {old!r}  ->  {new!r}")

    if not touched:
        return 0

    atomic_write_json(PRODUCTS_PATH, products)
    print(f"\nWrote {PRODUCTS_PATH.name}")

    # Push to Supabase
    env = load_env(ENV_PATH)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    rows = [{"id": t["id"], "sku": t["sku"], "region": t["new"]} for t in touched]
    body = json.dumps(rows).encode("utf-8")
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
            print(f"Supabase: {resp.status} OK ({len(rows)} rows)")
    except urllib.error.HTTPError as e:
        print(f"Supabase FAIL {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
