#!/usr/bin/env python3
"""Taxonomy enrichment CLI driver.

Fills region, subregion, and grape_variety for SKUs that are missing them.

Layer 1: name-inference (zero API cost)
Layer 2: Haiku (falls back when Layer 1 leaves fields unresolved)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.name_inference import infer_from_name  # noqa: E402
from data.lib.enrichment.taxonomy.grape_rules import infer_grape  # noqa: E402
from data.lib.enrichment.taxonomy.haiku_taxonomy import build_prompt, parse_response  # noqa: E402

DEFAULT_PRODUCTS_FILE = REPO_ROOT / "data" / "db" / "products.json"
DEFAULT_DB_PATH = REPO_ROOT / "data" / "db" / "products.db"

_SKIP_CLASSIFICATIONS = {
    "Glassware", "Accessories", "Wine product", "Cigar", "Others",
    "Non-Alcoholic", "Mineral Water",
}
_NO_GRAPE_CLASSIFICATIONS = {
    "Whisky", "Whiskey", "Gin", "Vodka", "Rum", "Tequila", "Brandy",
    "Sake/Shochu", "Beer", "Liqueur", "RTD",
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


def _needs_taxonomy(p: dict) -> tuple[list[str], bool]:
    """Return (list_of_needed_fields, bool_needs_any).

    Never processes classifications in _SKIP_CLASSIFICATIONS.
    Respects manual origin: if origin_source=='manual' AND a field is already set,
    don't overwrite it.
    """
    cls = p.get("classification", "")
    if cls in _SKIP_CLASSIFICATIONS:
        return [], False

    is_manual = (p.get("origin_source") or "").lower() == "manual"
    region_val    = (p.get("region") or "").strip()
    subregion_val = (p.get("subregion") or "").strip()
    grape_val     = (p.get("grape_variety") or "").strip()

    needs: list[str] = []

    if not (region_val and is_manual):
        if not region_val:
            needs.append("region")

    if not (subregion_val and is_manual):
        if not subregion_val:
            needs.append("subregion")

    if cls not in _NO_GRAPE_CLASSIFICATIONS:
        if not (grape_val and is_manual):
            if not grape_val:
                needs.append("grape_variety")

    return needs, bool(needs)


def _write_to_sqlite(db_path: Path, sku: str, updates: dict, enriched_at: str) -> None:
    import sqlite3
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
    p = argparse.ArgumentParser(description="Taxonomy enrichment pipeline.")
    p.add_argument("--limit", type=int, default=200,
                   help="Max SKUs to process (default 200)")
    p.add_argument("--sku", action="append", dest="skus",
                   help="Process only specific SKUs (repeatable)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print what would happen; don't write")
    p.add_argument("--no-haiku", action="store_true",
                   help="Layer 1 (name inference) only; skip Haiku calls")
    p.add_argument("--no-write-json", action="store_true",
                   help="Skip writing back to products.json (also skips SQLite)")
    p.add_argument("--min-confidence", type=float, default=0.75,
                   help="Confidence threshold for accepting inferred values (default 0.75)")
    p.add_argument("--model", default="claude-haiku-4-5-20251001",
                   help="Haiku model (default claude-haiku-4-5-20251001)")
    p.add_argument("--workers", type=int, default=8,
                   help="Parallel workers (default 8)")
    p.add_argument("--skus-file", type=Path, default=DEFAULT_PRODUCTS_FILE,
                   help="Source products file (default data/db/products.json)")
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH,
                   help="SQLite path (default data/db/products.db)")
    args = p.parse_args(argv)

    env = load_env(REPO_ROOT / ".env.local")
    anthropic_key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

    source_path: Path = args.skus_file
    if not source_path.exists():
        print(f"ERROR: products source not found: {source_path}", file=sys.stderr)
        return 1

    products_raw = json.loads(source_path.read_text())
    if isinstance(products_raw, dict):
        products_list: list[dict] = products_raw.get("records", [])
    else:
        products_list = products_raw

    # Build a mutable lookup by SKU so we can update in-memory
    products_by_sku: dict[str, dict] = {p["sku"]: p for p in products_list if p.get("sku")}

    # Select eligible SKUs
    if args.skus:
        sku_set = set(args.skus)
        candidates = [p for p in products_list if p.get("sku") in sku_set]
    else:
        candidates = products_list

    selected: list[dict] = []
    for prod in candidates:
        _, needs_any = _needs_taxonomy(prod)
        if needs_any:
            selected.append(prod)
        if len(selected) >= args.limit:
            break

    if not selected:
        print("No SKUs to process.")
        print()
        print("───── Taxonomy enrichment summary ─────")
        print(f"SKUs processed:         0")
        print(f"  Layer 1 filled:       0")
        print(f"  Layer 2 (Haiku):      0")
        print(f"  Unresolved:           0")
        print(f"  Dry-run (not written):0")
        print(f"  API calls:            0")
        print(f"Cost (this run):        THB 0.00")
        return 0

    total = len(selected)
    print(f"Selected {total} SKUs for taxonomy enrichment.")

    # Build Haiku client unless disabled
    haiku = None
    if not args.no_haiku and not args.dry_run:
        if not anthropic_key:
            print("WARN: ANTHROPIC_API_KEY missing — Layer 2 (Haiku) disabled.", file=sys.stderr)
        else:
            from data.lib.enrichment.shared.client import AnthropicClient
            haiku = AnthropicClient(api_key=anthropic_key, model=args.model)

    stats = {
        "layer1": 0,
        "layer2": 0,
        "unresolved": 0,
        "dry_run": 0,
        "api_calls": 0,
    }
    total_cost_thb = 0.0
    db_lock = threading.Lock()

    def process_sku(idx: int, prod: dict) -> None:
        nonlocal total_cost_thb

        sku = prod["sku"]
        name = prod.get("name", "")
        classification = prod.get("classification", "")
        country = prod.get("country", "")

        needed, _ = _needs_taxonomy(prod)
        if not needed:
            return

        updates: dict[str, str] = {}
        layer1_contributed = False
        layer2_contributed = False

        # ── Layer 1: name inference ──────────────────────────────────────────
        geo = infer_from_name(name, classification)
        grape_result = infer_grape(name, classification)

        still_needed: list[str] = []
        for field in needed:
            if field == "region":
                val = geo.get("region", "")
                conf = geo.get("confidence", 0.0)
                if val and conf >= args.min_confidence:
                    updates["region"] = val
                    layer1_contributed = True
                else:
                    still_needed.append("region")
            elif field == "subregion":
                val = geo.get("subregion", "")
                conf = geo.get("confidence", 0.0)
                if val and conf >= args.min_confidence:
                    updates["subregion"] = val
                    layer1_contributed = True
                else:
                    still_needed.append("subregion")
            elif field == "grape_variety":
                grapes = grape_result.get("grapes", [])
                conf = grape_result.get("confidence", 0.0)
                if grapes and conf >= args.min_confidence:
                    updates["grape_variety"] = ", ".join(grapes)
                    layer1_contributed = True
                else:
                    still_needed.append("grape_variety")

        # ── Layer 2: Haiku ───────────────────────────────────────────────────
        cost_thb = 0.0
        if still_needed and haiku and not args.dry_run:
            try:
                system, user = build_prompt(
                    name=name,
                    country=country,
                    classification=classification,
                    needs=still_needed,
                )
                gen = haiku.generate(system=system, user=user, max_tokens=150, temperature=0.1)
                with db_lock:
                    stats["api_calls"] += 1
                    total_cost_thb += gen.cost_thb
                cost_thb = gen.cost_thb

                parsed = parse_response(gen.text, needs=still_needed)
                haiku_conf = parsed.get("confidence", 0.0)
                if parsed.get("valid") and haiku_conf >= args.min_confidence:
                    for field in still_needed:
                        if field == "region":
                            val = parsed.get("region", "")
                            if val:
                                updates["region"] = val
                                layer2_contributed = True
                        elif field == "subregion":
                            val = parsed.get("subregion", "")
                            if val:
                                updates["subregion"] = val
                                layer2_contributed = True
                        elif field == "grape_variety":
                            grapes = parsed.get("grape_variety", [])
                            if grapes:
                                updates["grape_variety"] = ", ".join(grapes) if isinstance(grapes, list) else grapes
                                layer2_contributed = True
            except Exception as e:
                with db_lock:
                    print(f"WARN: Haiku call failed for {sku}: {e}", file=sys.stderr)

        # ── Determine source ─────────────────────────────────────────────────
        if layer1_contributed and layer2_contributed:
            taxonomy_source = "mixed"
        elif layer2_contributed:
            taxonomy_source = "haiku_inferred"
        elif layer1_contributed:
            taxonomy_source = "name_inference"
        else:
            taxonomy_source = ""

        # Determine which layer "won" for logging
        if layer2_contributed:
            layer_label = "haiku"
        elif layer1_contributed:
            layer_label = "name_inference"
        else:
            layer_label = "none"

        with db_lock:
            if args.dry_run:
                print(
                    f"[{idx}/{total}] {sku}  needs={needed}"
                    f"  would_fill={list(updates.keys())}"
                    f"  source={taxonomy_source}"
                    f"  [dry-run]"
                )
                stats["dry_run"] += 1
                return

            if updates:
                if layer1_contributed and not layer2_contributed:
                    stats["layer1"] += 1
                elif layer2_contributed:
                    stats["layer2"] += 1
            else:
                stats["unresolved"] += 1

            print(
                f"[{idx}/{total}] {sku}"
                f"  filled={list(updates.keys())}"
                f"  via={layer_label}"
                f"  cost={cost_thb:.4f} THB"
            )

        if updates and not args.no_write_json:
            enriched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            # Persist to in-memory dict
            with db_lock:
                prod_ref = products_by_sku.get(sku, prod)
                prod_ref.update(updates)
                prod_ref["taxonomy_source"] = taxonomy_source
                prod_ref["updated_at"] = enriched_at

            # SQLite update — filter to only the three taxonomy columns
            sqlite_updates = {k: v for k, v in updates.items()
                              if k in ("region", "subregion", "grape_variety")}
            if sqlite_updates:
                _write_to_sqlite(args.db, sku, sqlite_updates, enriched_at)

    # ── Run workers ──────────────────────────────────────────────────────────
    if args.workers <= 1:
        for i, prod in enumerate(selected, start=1):
            process_sku(i, prod)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = [ex.submit(process_sku, i, prod) for i, prod in enumerate(selected, start=1)]
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as e:
                    with db_lock:
                        print(f"WORKER CRASH: {type(e).__name__}: {e}", file=sys.stderr)

    # ── Write JSON once at the end ────────────────────────────────────────────
    should_write_json = (
        not args.dry_run
        and not args.no_write_json
        and args.skus_file.resolve() == DEFAULT_PRODUCTS_FILE.resolve()
    )
    if should_write_json:
        try:
            updated_list = list(products_by_sku.values())
            source_path.write_text(json.dumps(updated_list, ensure_ascii=False, indent=2))
        except Exception as e:
            print(f"WARN: JSON write-back failed: {e}", file=sys.stderr)

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    print("───── Taxonomy enrichment summary ─────")
    print(f"SKUs processed:         {total}")
    print(f"  Layer 1 filled:       {stats['layer1']}")
    print(f"  Layer 2 (Haiku):      {stats['layer2']}")
    print(f"  Unresolved:           {stats['unresolved']}")
    print(f"  Dry-run (not written):{stats['dry_run']}")
    print(f"  API calls:            {stats['api_calls']}")
    print(f"Cost (this run):        THB {total_cost_thb:.2f}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
