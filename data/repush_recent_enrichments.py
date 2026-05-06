#!/usr/bin/env python3
"""Re-push to Supabase any rows in products.json whose enrichment_source starts with
'brand_region_rule_' OR whose validation_status is 'needs_review' (set by the recent
enrichment passes). Use after enrich_phase1_regions.py if its Supabase push aborted.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_PATH = REPO_ROOT / "data" / "db" / "products.json"
ENV_PATH = REPO_ROOT / ".env.local"


def load_env(env_path):
    out = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main():
    env = load_env(ENV_PATH)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        print("ERROR: missing Supabase env", file=sys.stderr)
        return 1

    products = json.loads(PRODUCTS_PATH.read_text())
    rows_to_push = []
    for p in products:
        es = p.get("enrichment_source") or ""
        vs = p.get("validation_status") or ""
        if es.startswith("brand_region_rule_") or vs == "needs_review":
            rows_to_push.append({
                "id": str(p["id"]),
                "sku": p["sku"],
                "region": p.get("region"),
                "subregion": p.get("subregion"),
                "validation_status": p.get("validation_status"),
                "enrichment_note": p.get("enrichment_note"),
                "enrichment_source": p.get("enrichment_source"),
            })

    print(f"Pushing {len(rows_to_push)} rows to Supabase...")
    sent, failed = 0, 0
    CHUNK = 500
    for i in range(0, len(rows_to_push), CHUNK):
        chunk = rows_to_push[i : i + CHUNK]
        body = json.dumps(chunk).encode("utf-8")
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
                    sent += len(chunk)
                    print(f"  [{i//CHUNK+1}] OK ({len(chunk)} rows)")
                else:
                    failed += len(chunk)
        except urllib.error.HTTPError as e:
            failed += len(chunk)
            print(f"  [{i//CHUNK+1}] FAIL {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}", file=sys.stderr)
        except urllib.error.URLError as e:
            failed += len(chunk)
            print(f"  [{i//CHUNK+1}] URLError: {e}", file=sys.stderr)

    print(f"\nDone: sent={sent}, failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
