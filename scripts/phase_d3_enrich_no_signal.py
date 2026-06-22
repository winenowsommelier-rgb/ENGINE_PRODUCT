#!/usr/bin/env python3
"""
Phase D3 — Description enrichment for no-signal products (no sales, no critic score >= 90).

Uses Haiku 4.5 to keep cost low. These products have no sales history and no critic score —
they still need descriptions for completeness and search.

Excludes: non-bev prefixes, Mineral Water, NNA (Monin syrups).

Usage:
    .venv/bin/python scripts/phase_d3_enrich_no_signal.py --limit 5 --dry-run
    .venv/bin/python scripts/phase_d3_enrich_no_signal.py --limit 5
    .venv/bin/python scripts/phase_d3_enrich_no_signal.py
    .venv/bin/python scripts/phase_d3_enrich_no_signal.py --skip-done
"""
import argparse
import json
import re
import shutil
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from data.lib.taste_taxonomy.category_axes import schema_for_classification, serialise_for_prompt

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

MODEL = "claude-haiku-4-5-20251001"
COST_IN  = 0.80  / 1_000_000
COST_OUT = 4.00  / 1_000_000
ENRICHMENT_SOURCE = "phase_d3_haiku_no_signal"

SYSTEM = """You are a senior sommelier writing curation-grade descriptions for a premium Thai online retailer (Wine-Now). Write in expert third-party voice — NEVER "we" or "our".

QUALITY BAR:
1. **TERROIR-DENSE** — name the SITE early. Specific soil, elevation, aspect, microclimate.
2. **TECHNIQUE-FORWARD** — specific production parameters:
   - Wine: maceration, fermentation vessel, oak regime, lees aging
   - Spirits: cask types, ABV, age statement, finishing
   - Sake: rice variety, polish ratio, water source, kimoto/yamahai/sokujo
   - Mezcal: agave variety, earthen pit roasting, distillation vessel
   - Liqueur/Bitters: base spirit, botanicals, maceration vs distillation
3. **STORYTELLING** — one concrete story hook anchoring a technical point.
4. **SPECIAL FEATURE** — what makes this expression unusual.

FACTUAL DISCIPLINE — CRITICAL:
- Write ONLY facts you are confident are true about this specific product.
- If uncertain, OMIT — do not guess, do not invent.
- No hallucinated critic scores, invented vintages, fabricated parameters.

FORBIDDEN: "with notes of..." / "with hints of..." / "showcases..." / "elegant" / "refined" / "classic" without specifics / "perfect for..." / "harmonious balance of..." / structural words in flavor_tags.

OUTPUT JSON SCHEMA:
{
  "desc_en_short": "<=160 char hook — lead with site, technique, or transgression",
  "full_description": "<p>800-1100 char HTML (only p/br/strong/em). Structure: (1) STORY HOOK (2) SITE + soil/elevation (3) TECHNIQUE — specific parameters with <strong> tags (4) SPECIAL FEATURE (5) VINTAGE/drinking window. NO critic scores.</p>",
  "flavor_tags": ["6-8 actual aromatic descriptors — NO structural words"],
  "food_matching": ["4-6 specific dishes — restaurant-menu specific"],
  "pairing_rationale": "1-2 sentences grounding each pairing in a specific note.",
  "taste_axes": {},
  "style_tag": null,
  "chip_tags": []
}
Output ONLY JSON, no preamble."""

USER_TMPL = """# Product
SKU: {sku}
Name: {name}
Brand: {brand}
Classification: {classification}
Country: {country}  |  Region: {region}  |  Subregion: {subregion}
Price: ฿{price_thb}

# CATEGORY-SPECIFIC TASTE AXES
{category_axes_block}

# Task
Write the curation-grade JSON per schema. Use only facts you are confident are true. Omit anything uncertain. Fill taste_axes using ONLY the axis keys above. If no taste matrix, return taste_axes={{}} and style_tag=null."""


def load_env():
    env = {}
    env_path = REPO_ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def fix_unescaped_quotes(text: str) -> str:
    out = []
    i = 0
    n = len(text)
    in_str = False
    esc = False
    while i < n:
        c = text[i]
        if esc:
            out.append(c)
            esc = False
            i += 1
            continue
        if c == '\\':
            out.append(c)
            esc = True
            i += 1
            continue
        if c == '"':
            if not in_str:
                out.append(c)
                in_str = True
            else:
                j = i + 1
                while j < n and text[j] in ' \t\n\r':
                    j += 1
                next_c = text[j] if j < n else ''
                if next_c in (':', ',', '}', ']'):
                    out.append(c)
                    in_str = False
                else:
                    out.append('\\"')
        else:
            out.append(c)
        i += 1
    return ''.join(out)


def enrich_one(client, row: dict) -> dict:
    schema = schema_for_classification(row.get("classification"))
    category_axes_block = serialise_for_prompt(schema) if schema else "(no taste matrix — set taste_axes={} and style_tag=null)"

    user = USER_TMPL.format(
        sku=row["sku"],
        name=row["name"] or "",
        brand=row["brand"] or "",
        classification=row["classification"] or "",
        country=row["country"] or "",
        region=row["region"] or "",
        subregion=row["subregion"] or "",
        price_thb=int(row["price"]) if row.get("price") else 0,
        category_axes_block=category_axes_block,
    )

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=2000,
            temperature=0.3,
            system=[{"type": "text", "text": SYSTEM}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:
        return {"sku": row["sku"], "status": "api_error", "error": str(e),
                "result": None, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}

    text = "".join(getattr(b, "text", "") for b in resp.content)
    clean = re.sub(r'^```json\s*', '', text.strip())
    clean = re.sub(r'```\s*$', '', clean.strip())

    try:
        start = clean.find("{")
        end = clean.rfind("}")
        result = json.loads(clean[start:end + 1])
        status = "ok"
    except Exception:
        try:
            fixed = fix_unescaped_quotes(clean[clean.find("{"):clean.rfind("}") + 1])
            result = json.loads(fixed)
            status = "ok_fixed"
        except Exception as e2:
            result = None
            status = f"parse_error: {e2}"

    usage = resp.usage
    cost = (usage.input_tokens or 0) * COST_IN + (usage.output_tokens or 0) * COST_OUT
    return {
        "sku": row["sku"], "status": status, "result": result,
        "raw_text": text if result is None else None,
        "tokens_in": usage.input_tokens or 0,
        "tokens_out": usage.output_tokens or 0,
        "cost_usd": cost,
    }


def apply_to_db(conn, sku: str, result: dict, lock: threading.Lock) -> bool:
    import time
    enriched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    flavor_tags_json = json.dumps(result.get("flavor_tags") or [], ensure_ascii=False)
    food_matching = "|".join(result.get("food_matching") or [])

    payload = {
        "desc_en_short": result.get("desc_en_short"),
        "full_description": result.get("full_description"),
        "flavor_tags": flavor_tags_json,
        "food_matching": food_matching,
        "pairing_rationale": result.get("pairing_rationale"),
        "enrichment_source": ENRICHMENT_SOURCE,
        "enriched_at": enriched_at,
        "enriched_by": MODEL,
        "updated_at": enriched_at,
    }

    for attempt in range(5):
        try:
            with lock:
                conn.execute("""
                    UPDATE products SET
                        desc_en_short=:desc_en_short, full_description=:full_description,
                        flavor_tags=:flavor_tags, food_matching=:food_matching,
                        pairing_rationale=:pairing_rationale, enrichment_source=:enrichment_source,
                        enriched_at=:enriched_at, enriched_by=:enriched_by, updated_at=:updated_at
                    WHERE sku=:sku
                """, {**payload, "sku": sku})
                conn.commit()
            return True
        except sqlite3.OperationalError as e:
            if "locked" in str(e) and attempt < 4:
                import time as t; t.sleep(0.5 * (2 ** attempt))
            else:
                print(f"  DB write failed for {sku}: {e}", file=sys.stderr)
                return False
    return False


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--skip-done", action="store_true")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--no-backup", action="store_true")
    args = p.parse_args(argv)

    env = load_env()
    import os
    os.environ.setdefault("ANTHROPIC_API_KEY", env.get("ANTHROPIC_API_KEY", ""))
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY missing", file=sys.stderr)
        return 1

    import anthropic
    client = anthropic.Anthropic()

    conn = sqlite3.connect(args.db, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")

    targets = [dict(r) for r in conn.execute("""
        SELECT sku, name, brand, classification, country, region, subregion, price
        FROM products
        WHERE COALESCE(is_active,1)=1
          AND (full_description IS NULL OR LENGTH(full_description) < 100)
          AND COALESCE(popularity_revenue_window,0) = 0
          AND COALESCE(has_recent_sales,0) = 0
          AND COALESCE(score_max,0) < 90
          AND classification NOT IN ('Accessories','Events','Glassware','Non-Alcoholic','Mineral Water','Cigar')
          AND sku NOT LIKE 'ABA%' AND sku NOT LIKE 'AWC%' AND sku NOT LIKE 'CIG%'
          AND sku NOT LIKE 'GBE%' AND sku NOT LIKE 'GDC%' AND sku NOT LIKE 'GLQ%'
          AND sku NOT LIKE 'GWN%' AND sku NOT LIKE 'WEV%' AND sku NOT LIKE 'NNA%'
        ORDER BY COALESCE(price,0) DESC, sku
    """)]

    if args.skip_done:
        targets = [r for r in targets if r.get("enrichment_source") != ENRICHMENT_SOURCE]

    if args.limit > 0:
        targets = targets[:args.limit]

    if not targets:
        print("No targets found.")
        return 0

    # Haiku: ~600 in, ~500 out per product
    est_cost = len(targets) * (600 * COST_IN + 500 * COST_OUT)
    print(f"Targets: {len(targets)}")
    print(f"Model: {MODEL}")
    print(f"Estimated cost: ${est_cost:.2f}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE WRITE'}")
    print()

    if not args.dry_run and not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = args.db.with_suffix(args.db.suffix + f".bak-phase-d3-{ts}")
        shutil.copy2(args.db, bak)
        print(f"Backup: {bak}\n")

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    sidecar_path = REPO_ROOT / f"data/phase_d3_results-{ts}.jsonl"
    sidecar_lock = threading.Lock()
    db_lock = threading.Lock()

    stats = {"ok": 0, "ok_fixed": 0, "parse_error": 0, "api_error": 0, "db_failed": 0}
    total_cost = 0.0
    cost_lock = threading.Lock()

    def work(i: int, row: dict):
        nonlocal total_cost
        r = enrich_one(client, row)
        with cost_lock:
            total_cost += r["cost_usd"]
        with sidecar_lock:
            with sidecar_path.open("a") as fh:
                fh.write(json.dumps({"sku": row["sku"], **r}, ensure_ascii=False) + "\n")
        if r["status"] in ("ok", "ok_fixed"):
            stats[r["status"]] += 1
            if not args.dry_run:
                ok = apply_to_db(conn, row["sku"], r["result"], db_lock)
                if not ok:
                    stats["db_failed"] += 1
            short = (r["result"] or {}).get("desc_en_short", "")[:72]
            print(f"  [{i+1:>4}/{len(targets)}] {row['sku']} {r['status']}  ${r['cost_usd']:.4f}  \"{short}\"")
        else:
            if r["status"].startswith("parse"):
                stats["parse_error"] += 1
            else:
                stats["api_error"] += 1
            print(f"  [{i+1:>4}/{len(targets)}] {row['sku']} {r['status']}", file=sys.stderr)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, i, row): i for i, row in enumerate(targets)}
        for f in as_completed(futures):
            f.result()

    print()
    print("=== DONE ===")
    print(f"ok={stats['ok']}  ok_fixed={stats['ok_fixed']}  parse_error={stats['parse_error']}  api_error={stats['api_error']}  db_failed={stats['db_failed']}")
    print(f"Total cost: ${total_cost:.4f}")
    print(f"Sidecar: {sidecar_path}")

    if not args.dry_run:
        filled = conn.execute("""
            SELECT COUNT(*) FROM products
            WHERE enrichment_source=?
              AND full_description IS NOT NULL AND LENGTH(full_description) >= 100
        """, (ENRICHMENT_SOURCE,)).fetchone()[0]
        print(f"\nVerification — {ENRICHMENT_SOURCE}: {filled} rows in DB with description >= 100 chars")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
