#!/usr/bin/env python3
"""Phase-2 region enrichment for European wine blanks.

Targets: Germany / Spain / Italy / Portugal / Austria / New Zealand wine-classified
products with blank region. Brand-based rules; unmatched flagged needs_review.
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

WINE = {"Red Wine", "White Wine", "Rose Wine", "Sparkling Wine", "Dessert Wine"}

RULES: dict[str, dict[str, tuple[str, str, str]]] = {
    "Germany": {
        "J. Oppmann": ("Franken", "", "high"),
    },
    "Spain": {
        "Finca Fella":            ("Almansa", "", "high"),
        "Navaro Lopez":           ("La Mancha", "", "high"),
        "Miguel Domecq":          ("Cádiz", "", "high"),
        "Finca Sobreno":          ("Toro", "", "high"),
        "Alto Las Rocas":         ("Calatayud", "", "high"),
        "Wines N’ Roses":         ("Valencia", "", "low"),
        "Cibolo":                 ("Yecla", "", "low"),
        "Museum Wine":            ("Cigales", "", "high"),
        "Borsao":                 ("Campo de Borja", "", "high"),
        "Anibal De Otero Winery": ("Bierzo", "", "high"),
        "Bodegas Mauro":          ("Castilla y León", "", "high"),
        "Paco Y Lola":            ("Rías Baixas", "", "high"),
        "Vintae":                 ("Aragón", "", "low"),
    },
    "Portugal": {
        "Herdade Do Peso":         ("Alentejo", "", "high"),
        "Fundacao Abreu Callado":  ("Alentejo", "", "high"),
        "Herdade Do Gamito":       ("Alentejo", "", "high"),
        "Quinta Do Carvalhais":    ("Dão", "", "high"),
        "Terra Franca":            ("Alentejo", "", "low"),
    },
    "Austria": {
        "Winzer Krems": ("Kremstal", "", "high"),
    },
    "New Zealand": {
        "Stone bay": ("Nelson", "", "high"),
    },
    "Italy": {},  # no wine blanks
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
            if 200 <= resp.status < 300:
                return len(rows), 0
            return 0, len(rows)
    except urllib.error.HTTPError as e:
        print(f"FAIL {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}", file=sys.stderr)
        return 0, len(rows)


def main():
    products = json.loads(PRODUCTS_PATH.read_text())
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    upgraded = []
    flagged = 0

    for p in products:
        country = p.get("country") or ""
        if country not in RULES:
            continue
        if (p.get("classification") or "") not in WINE:
            continue
        if (p.get("region") or "").strip():
            continue  # only blank regions
        brand = (p.get("brand") or "").strip()
        rule = RULES[country].get(brand)
        if rule:
            new_region, new_sub, conf = rule
            p["region"] = new_region
            if new_sub:
                p["subregion"] = new_sub
            p["enrichment_note"] = f"region set to {new_region!r} via brand rule (confidence={conf})"
            p["enrichment_source"] = f"brand_region_rule_{conf}"
            p["updated_at"] = now
            if conf == "low":
                p["validation_status"] = "needs_review"
            upgraded.append({"sku": p["sku"], "id": str(p["id"]), "country": country, "brand": brand, "new": new_region, "conf": conf})
        else:
            p["validation_status"] = "needs_review"
            p["enrichment_note"] = "blank region; no brand rule available — needs manual review"
            p["updated_at"] = now
            flagged += 1

    print(f"Upgraded: {len(upgraded)}, flagged needs_review: {flagged}")
    if upgraded:
        print("\nBy country/brand:")
        from collections import Counter
        for country in RULES:
            ups = [u for u in upgraded if u["country"] == country]
            if not ups:
                continue
            print(f"  {country} ({len(ups)}):")
            counts = Counter((u["brand"], u["new"], u["conf"]) for u in ups)
            for (brand, region, conf), c in counts.most_common():
                print(f"    {brand:<28} {c:>3} -> {region} ({conf})")

    if not upgraded and flagged == 0:
        return 0

    atomic_write_json(PRODUCTS_PATH, products)
    print(f"\nWrote {PRODUCTS_PATH.name}")

    env = load_env(ENV_PATH)
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
    sent, failed = push(rows, env)
    print(f"Supabase: sent={sent}, failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
