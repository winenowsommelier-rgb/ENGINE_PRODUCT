#!/usr/bin/env python3
"""Phase-1 region enrichment for the 3 highest-impact countries:
  - Australia: multi-region producers -> producer flagship region (low-confidence stamp)
  - USA:       California breakdown via brand rules (Napa, Sonoma, Alexander, Lodi, etc.)
  - Chile:     Central Valley breakdown via brand rules (Maipo, Curicó, Colchagua, Limarí)

Only processes rows with a wine classification. Accessories / spirits / non-wine items
are left untouched. Unmatched coarse-region wines are stamped with
`validation_status='needs_review'` so they surface in a follow-up audit.

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

WINE_CLASSIFICATIONS = {
    "Red Wine", "White Wine", "Rose Wine", "Sparkling Wine", "Dessert Wine",
}

# Per country: which region values count as "coarse" and need refinement
COARSE_BY_COUNTRY: dict[str, set[str]] = {
    "Australia": {"South Australia", "South Eastern Australia", "Victoria", "Tasmania", ""},
    "USA":       {"California", ""},
    "Chile":     {"Central Valley", ""},
}

# Brand -> (region, subregion, confidence). Confidence is 'high' (single-region producer)
# or 'low' (multi-region producer; this is the flagship/HQ region).
RULES: dict[str, dict[str, tuple[str, str, str]]] = {
    "Australia": {
        # Multi-region majors — flagship region, low confidence
        "Penfolds":          ("Barossa Valley", "", "low"),
        "De Bortoli":        ("Riverina", "", "low"),
        "Lindeman's":        ("Hunter Valley", "", "low"),
        "19 Crimes":         ("Barossa Valley", "", "low"),
        "Rawson's Retreat":  ("Barossa Valley", "", "low"),
        "Hopes End":         ("Barossa Valley", "", "low"),
        # Smaller / single-region producers — high confidence
        "Rothbury":          ("Hunter Valley", "", "high"),
        "Jip Jip Rocks":     ("Padthaway", "", "high"),
        "Mt Monster":        ("Mount Benson", "", "high"),
        "Corryton Burge":    ("Eden Valley", "", "high"),
        "Salisbury":         ("Murray Darling", "", "low"),
        "Sunnycliff":        ("Murray Darling", "", "high"),
        "Richland":          ("Riverina", "", "low"),
        "Innovate":          ("South Eastern Australia", "", "low"),  # genuinely multi-region cheap label
    },
    "USA": {
        # Napa Valley — single-region or Napa-flagship producers
        "Robert Mondavi":      ("Napa Valley", "", "high"),
        "Beringer":            ("Napa Valley", "", "high"),
        "Cakebread":           ("Napa Valley", "", "high"),
        "Duckhorn":            ("Napa Valley", "", "high"),
        "Dominus Estate":      ("Napa Valley", "", "high"),
        "Staglin Family":      ("Napa Valley", "", "high"),
        "Frank Family":        ("Napa Valley", "", "high"),
        "Beaulieu Vineyard":   ("Napa Valley", "", "high"),
        "Ca'Momi":             ("Napa Valley", "", "high"),
        "Merryvale":           ("Napa Valley", "", "high"),
        "Sutter Home":         ("Napa Valley", "", "low"),
        "Bread & Butter":      ("Napa Valley", "", "low"),
        # Sonoma County
        "Francis Coppola":     ("Sonoma County", "", "high"),
        "Kendall Jackson":     ("Sonoma County", "", "low"),
        "Peter Michael":       ("Sonoma County", "", "high"),
        "Alexander Valley":    ("Alexander Valley", "", "high"),
        # Lodi / inland California
        "Crane Lake":          ("Lodi", "", "low"),
        # USA-tagged Penfolds (Bin 149 collab) — Napa
        "Penfolds":            ("Napa Valley", "", "low"),
    },
    "Chile": {
        "Concha Y Toro":         ("Maipo Valley", "", "low"),
        "Miguel Torres":         ("Curicó Valley", "", "high"),
        "San Pedro":             ("Curicó Valley", "", "high"),
        "Anakena":               ("Cachapoal Valley", "", "high"),
        "Antares":               ("Maipo Valley", "", "low"),
        "Santa Carolina":        ("Maipo Valley", "", "low"),
        "Cono Sur":              ("Colchagua Valley", "", "high"),
        "Maycas Del Limari":     ("Limarí Valley", "", "high"),
        "Montgras":              ("Colchagua Valley", "", "high"),
        "G7 The 7th Generation": ("Maule Valley", "", "high"),
        "Familia Correa Lisoni": ("Maipo Valley", "", "high"),
        "Mar Y Sol":             ("Central Valley", "", "low"),  # fruit-wine blend, leave broad
    },
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
    sent = 0
    failed = 0
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i : i + CHUNK]
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
                else:
                    failed += len(chunk)
        except urllib.error.HTTPError as e:
            print(f"FAIL {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}", file=sys.stderr)
            failed += len(chunk)
    return sent, failed


def main() -> int:
    products = json.loads(PRODUCTS_PATH.read_text())
    upgraded: dict[str, list[dict]] = {c: [] for c in RULES}
    needs_review: dict[str, int] = {c: 0 for c in RULES}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for p in products:
        country = p.get("country") or ""
        if country not in RULES:
            continue
        if (p.get("classification") or "") not in WINE_CLASSIFICATIONS:
            continue
        old_region = p.get("region") or ""
        if old_region not in COARSE_BY_COUNTRY[country]:
            continue
        brand = (p.get("brand") or "").strip()
        rule = RULES[country].get(brand)
        if rule:
            new_region, new_sub, conf = rule
            p["region"] = new_region
            if new_sub:
                p["subregion"] = new_sub
            p["enrichment_note"] = f"region upgraded from {old_region!r} to {new_region!r} via brand rule (confidence={conf})"
            p["enrichment_source"] = f"brand_region_rule_{conf}"
            p["updated_at"] = now
            if conf == "low":
                p["validation_status"] = "needs_review"
            upgraded[country].append({
                "sku": p["sku"], "id": str(p["id"]),
                "brand": brand, "old": old_region, "new": new_region, "conf": conf,
            })
        else:
            # No rule for this brand → flag for manual review
            p["validation_status"] = "needs_review"
            p["enrichment_note"] = f"region {old_region!r} is coarse; no brand rule available — needs manual review"
            p["updated_at"] = now
            needs_review[country] += 1

    # Report
    for country, rows in upgraded.items():
        print(f"\n=== {country} ===")
        print(f"  Upgraded: {len(rows)}")
        if rows:
            by_brand: dict[str, int] = {}
            for r in rows:
                by_brand[r["brand"]] = by_brand.get(r["brand"], 0) + 1
            for brand, cnt in sorted(by_brand.items(), key=lambda x: -x[1]):
                rule = RULES[country][brand]
                print(f"    {brand:<25}  {cnt:>3}  -> {rule[0]} (conf={rule[2]})")
        print(f"  Flagged needs_review (no brand rule): {needs_review[country]}")

    total_upgraded = sum(len(rows) for rows in upgraded.values())
    total_flagged = sum(needs_review.values())
    print(f"\nTotal upgraded: {total_upgraded}")
    print(f"Total flagged needs_review: {total_flagged}")

    if total_upgraded == 0 and total_flagged == 0:
        return 0

    atomic_write_json(PRODUCTS_PATH, products)
    print(f"\nWrote updates to {PRODUCTS_PATH.name}")

    # Push to Supabase: every row that was touched
    touched_skus: set[str] = set()
    for rows in upgraded.values():
        touched_skus.update(r["sku"] for r in rows)
    rows_to_push = []
    for p in products:
        sku = p.get("sku")
        # Push touched-and-upgraded rows AND newly-flagged needs_review rows
        if sku in touched_skus or (p.get("validation_status") == "needs_review" and p.get("updated_at") == now):
            rows_to_push.append({
                "id": str(p["id"]),
                "sku": sku,
                "region": p.get("region"),
                "subregion": p.get("subregion"),
                "validation_status": p.get("validation_status"),
                "enrichment_note": p.get("enrichment_note"),
                "enrichment_source": p.get("enrichment_source"),
            })

    env = load_env(ENV_PATH)
    sent, failed = push_to_supabase(rows_to_push, env)
    print(f"Supabase: sent={sent}, failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
