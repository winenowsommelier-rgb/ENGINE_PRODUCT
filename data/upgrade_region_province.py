#!/usr/bin/env python3
"""Upgrade region from generic country name to real province/area.

Targets SKUs where taxonomy_source == 'country_fallback'
(region was set to country as a last resort).

Uses Claude Haiku to infer the actual province, distillery region,
or production area — much more interesting than just "Japan" or "Scotland".

Usage:
    python data/upgrade_region_province.py --dry-run --limit 20
    python data/upgrade_region_province.py --limit 200 --workers 8
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_PRODUCTS_FILE = REPO_ROOT / "data" / "db" / "products.json"
DEFAULT_DB_PATH = REPO_ROOT / "data" / "db" / "products.db"

_SYSTEM = """You are a wine and spirits geography expert.
Given a product name, brand, country, and classification, infer the most specific
and interesting region or province of production.

Examples of what we want:
- "Grant's Triple Wood Whisky" + Scotland → "Speyside" (not just "Scotland")
- "Beluga Noble Vodka" + Russia → "Siberia" (not just "Russia")
- "Tenjaku Whisky" + Japan → "Nagano" (not just "Japan")
- "Macheatazo Mezcal" + Mexico → "Oaxaca" (not just "Mexico")
- "Hijos De Villa Tequila" + Mexico → "Jalisco" (not just "Mexico")
- "Inchon Gin" + Thailand → "Chiang Mai" (if known)

If no specific province is determinable, return the country as region.
Output ONLY valid JSON — no preamble.
Always include confidence (0.0–1.0).
"""


def build_prompt(name: str, country: str, classification: str) -> tuple[str, str]:
    user = (
        f"Product: {name}\n"
        f"Country: {country}\n"
        f"Classification: {classification}\n\n"
        f"What is the most specific province, region, or production area?\n"
        f"Output JSON:\n"
        f'{{"region": "...", "subregion": "...", "confidence": 0.0, "reasoning": "1 sentence"}}'
    )
    return _SYSTEM, user


def parse_response(raw: str, country: str) -> dict:
    if not raw:
        return {"region": country, "subregion": "", "confidence": 0.0, "valid": False}
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return {"region": country, "subregion": "", "confidence": 0.0, "valid": False}
        data = json.loads(raw[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return {"region": country, "subregion": "", "confidence": 0.0, "valid": False}

    region = str(data.get("region") or "").strip()
    subregion = str(data.get("subregion") or "").strip()

    try:
        conf = float(data.get("confidence", 0.0))
        conf = round(max(0.0, min(1.0, conf)), 2)
    except (TypeError, ValueError):
        conf = 0.0

    # Only accept if it's more specific than the country
    is_upgrade = region and region.lower() != country.lower()

    return {
        "region": region or country,
        "subregion": subregion,
        "confidence": conf,
        "valid": True,
        "is_upgrade": is_upgrade,
    }


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _write_to_sqlite(db_path: Path, sku: str, updates: dict, enriched_at: str) -> None:
    if not db_path.exists():
        return
    conn = sqlite3.connect(db_path)
    try:
        set_clauses = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [enriched_at, sku]
        conn.execute(
            f"UPDATE products SET {set_clauses}, updated_at = ? WHERE sku = ?",
            values,
        )
        conn.commit()
    except Exception as e:
        print(f"WARN: SQLite write failed for {sku}: {e}", file=sys.stderr)
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Upgrade region from country name to province/area.")
    p.add_argument("--limit", type=int, default=200)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--min-confidence", type=float, default=0.70)
    p.add_argument("--model", default="claude-haiku-4-5-20251001")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--skus-file", type=Path, default=DEFAULT_PRODUCTS_FILE)
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    args = p.parse_args(argv)

    env = load_env(REPO_ROOT / ".env.local")
    anthropic_key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

    source_path = args.skus_file
    products_raw = json.loads(source_path.read_text())
    products_list: list[dict] = products_raw if isinstance(products_raw, list) else products_raw.get("records", [])
    products_by_sku = {p["sku"]: p for p in products_list if p.get("sku")}

    # Skip purely non-beverage classifications — no production region concept
    _SKIP_CLS = {"Glassware", "Accessories", "Cigar", "Others", "Non-Alcoholic",
                 "Mineral Water"}

    # Target:
    #   (a) country_fallback SKUs where region == country (main case)
    #   (b) SKUs with no taxonomy_source and no region at all (e.g. Wine product
    #       spirits/beers that Haiku processed but returned country name as region)
    candidates = [
        p for p in products_list
        if (p.get("country") or "").strip()
        and (p.get("classification") or "") not in _SKIP_CLS
        and (
            (
                p.get("taxonomy_source") == "country_fallback"
                and (p.get("region") or "").strip() == (p.get("country") or "").strip()
            )
            or (
                not p.get("taxonomy_source")
                and not (p.get("region") or "").strip()
            )
        )
    ][:args.limit]

    if not candidates:
        print("No SKUs to upgrade.")
        return 0

    print(f"Found {len(candidates)} SKUs to upgrade (region→province).")

    if args.dry_run:
        print("[dry-run] Would call Haiku for each to infer province/area.")
        for r in candidates[:10]:
            print(f"  {r['sku']} | {r.get('name','')[:50]} | {r.get('country','')}")
        return 0

    if not anthropic_key:
        print("ERROR: ANTHROPIC_API_KEY missing.", file=sys.stderr)
        return 1

    from data.lib.enrichment.shared.client import AnthropicClient
    client = AnthropicClient(api_key=anthropic_key, model=args.model)

    stats = {"upgraded": 0, "same": 0, "failed": 0, "api_calls": 0}
    total_cost_thb = 0.0
    lock = threading.Lock()
    enriched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    def process(idx: int, prod: dict) -> None:
        nonlocal total_cost_thb
        sku = prod["sku"]
        name = prod.get("name", "")
        country = (prod.get("country") or "").strip()
        classification = prod.get("classification", "")

        system, user = build_prompt(name, country, classification)
        try:
            gen = client.generate(system=system, user=user, max_tokens=120, temperature=0.1)
            parsed = parse_response(gen.text, country)
            cost = gen.cost_thb
        except Exception as e:
            with lock:
                stats["failed"] += 1
                print(f"WARN [{sku}]: {e}", file=sys.stderr)
            return

        with lock:
            stats["api_calls"] += 1
            total_cost_thb += cost

        if not parsed["valid"] or parsed["confidence"] < args.min_confidence:
            with lock:
                stats["same"] += 1
            return

        region = parsed["region"]
        subregion = parsed.get("subregion", "")
        is_upgrade = parsed.get("is_upgrade", False)

        updates: dict = {"region": region}
        if subregion:
            updates["subregion"] = subregion

        with lock:
            prod_ref = products_by_sku.get(sku, prod)
            prod_ref.update(updates)
            prod_ref["taxonomy_source"] = "haiku_inferred"
            prod_ref["updated_at"] = enriched_at
            prov = prod_ref.get("taxonomy_provenance") or {}
            prov["region"] = {"source": "haiku_province", "confidence": parsed["confidence"]}
            if subregion:
                prov["subregion"] = {"source": "haiku_province", "confidence": parsed["confidence"]}
            prod_ref["taxonomy_provenance"] = prov

            if is_upgrade:
                stats["upgraded"] += 1
                print(f"[{idx}/{len(candidates)}] {sku}  {country!r} → {region!r}"
                      f"{' / ' + subregion if subregion else ''}  conf={parsed['confidence']:.2f}  cost={cost:.4f}")
            else:
                stats["same"] += 1

        sqlite_updates = {k: v for k, v in updates.items() if k in ("region", "subregion")}
        if sqlite_updates:
            _write_to_sqlite(args.db, sku, sqlite_updates, enriched_at)

    if args.workers <= 1:
        for i, prod in enumerate(candidates, start=1):
            process(i, prod)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = [ex.submit(process, i, prod) for i, prod in enumerate(candidates, start=1)]
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as e:
                    with lock:
                        print(f"WORKER CRASH: {e}", file=sys.stderr)

    # Write JSON back
    if args.skus_file.resolve() == DEFAULT_PRODUCTS_FILE.resolve():
        source_path.write_text(json.dumps(products_list, ensure_ascii=False, indent=2))
        print(f"\n✓ products.json updated in place.")

    print()
    print("───── Province upgrade summary ─────")
    print(f"Candidates:       {len(candidates)}")
    print(f"  Upgraded:       {stats['upgraded']}  (region → real province)")
    print(f"  Same/no-signal: {stats['same']}")
    print(f"  Failed:         {stats['failed']}")
    print(f"  API calls:      {stats['api_calls']}")
    print(f"Cost (this run):  THB {total_cost_thb:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
