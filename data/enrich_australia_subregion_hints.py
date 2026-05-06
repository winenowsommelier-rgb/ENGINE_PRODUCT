#!/usr/bin/env python3
"""Apply name-hint region upgrades for the long tail of coarse Australian rows.

Looks for sub-region tokens (Beechworth, Heathcote, Padthaway, etc.) in the
product name. These tokens weren't picked up by the main name_inference pass
because the rules table didn't include them. Conservative — only upgrades when
the token appears in the name.
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

# Token -> (region, subregion). Token matched case-insensitively as a substring of name.
NAME_HINTS: dict[str, tuple[str, str]] = {
    "Beechworth":   ("Beechworth", ""),
    "Heathcote":    ("Heathcote", ""),
    "Padthaway":    ("Padthaway", ""),
    "Mudgee":       ("Mudgee", ""),
    "Pyrenees":     ("Pyrenees", ""),
    "Murray Darling": ("Murray Darling", ""),
    "Riverina":     ("Riverina", ""),
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
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for p in products:
        if p.get("country") != "Australia":
            continue
        old_region = p.get("region") or ""
        if old_region not in COARSE_REGIONS:
            continue
        name = p.get("name") or ""
        name_low = name.lower()
        for token, (region, sub) in NAME_HINTS.items():
            if token.lower() in name_low:
                p["region"] = region
                if sub:
                    p["subregion"] = sub
                p["enrichment_note"] = f"region upgraded from {old_region!r} to {region!r} via name-hint {token!r}"
                p["enrichment_source"] = "name_hint"
                p["updated_at"] = now
                upgraded.append({
                    "sku": p["sku"], "id": str(p["id"]),
                    "old_region": old_region, "new_region": region, "name": name[:70],
                })
                break

    print(f"Upgraded {len(upgraded)} Australian product(s) via name hints:")
    for u in upgraded:
        print(f"  {u['sku']}  {u['old_region']!r} -> {u['new_region']!r}  | {u['name']}")

    if not upgraded:
        return 0

    atomic_write_json(PRODUCTS_PATH, products)
    print(f"\nWrote {len(upgraded)} updates to {PRODUCTS_PATH.name}")

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
