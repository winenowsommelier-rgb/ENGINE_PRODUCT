#!/usr/bin/env python3
"""Apply name-based region upgrades to coarse-region Australian products.

Reads data/db/products.json, runs data.lib.name_inference on Australian
products whose region is "South Australia" / "South Eastern Australia" /
"Victoria" / "Tasmania" / blank, and writes back any rows where the
inference produced a more specific Australian region.

Also pushes the same updates to Supabase via the existing image-sync pattern.
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
sys.path.insert(0, str(REPO_ROOT))

from data.lib.name_inference import infer_from_name  # noqa: E402

PRODUCTS_PATH = REPO_ROOT / "data" / "db" / "products.json"
ENV_PATH = REPO_ROOT / ".env.local"
COARSE_REGIONS = {"South Australia", "South Eastern Australia", "Victoria", "Tasmania", ""}


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

    for p in products:
        if p.get("country") != "Australia":
            continue
        old_region = p.get("region") or ""
        if old_region not in COARSE_REGIONS:
            continue
        res = infer_from_name(p.get("name") or "", p.get("classification") or "")
        if res.get("country") != "Australia":
            continue
        new_region = res.get("region") or ""
        new_sub = res.get("subregion") or ""
        if not new_region or new_region in COARSE_REGIONS:
            continue
        old_sub = p.get("subregion") or ""
        if new_region == old_region and new_sub == old_sub:
            continue
        # Stamp the upgrade
        p["region"] = new_region
        if new_sub:
            p["subregion"] = new_sub
        p["enrichment_note"] = f"region upgraded from {old_region!r} to {new_region!r} via name inference"
        p["enrichment_source"] = "name_inference"
        p["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        upgraded.append({
            "sku": p["sku"],
            "id": str(p["id"]),
            "old_region": old_region,
            "new_region": new_region,
            "new_subregion": new_sub,
            "name": p.get("name", ""),
        })

    print(f"Upgraded {len(upgraded)} Australian product(s):")
    for u in upgraded:
        print(f"  {u['sku']}  {u['old_region']!r} -> region={u['new_region']!r} sub={u['new_subregion']!r}")
        print(f"    name: {u['name']}")

    if not upgraded:
        print("No upgrades to apply.")
        return 0

    atomic_write_json(PRODUCTS_PATH, products)
    print(f"\nWrote {len(upgraded)} updates to {PRODUCTS_PATH.name}")

    # Push to Supabase
    env = load_env(ENV_PATH)
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
        if p.get("sku") in {u["sku"] for u in upgraded}
    ]
    sent, failed = push_to_supabase(rows_to_push, env)
    print(f"Supabase: sent={sent}, failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
