#!/usr/bin/env python3
"""
Phase C — Description enrichment for HIGH-priority products with no brand library entry.

Uses Sonnet 4.6 with the proven sommelier prompt. Model writes from its own knowledge
(no brand library injection), but is held to the same factual discipline: omit anything
uncertain rather than invent it.

Usage:
    # 5-SKU canary (ALWAYS run first, verify in DB before scaling):
    .venv/bin/python scripts/phase_c_enrich_descriptions.py --limit 5 --dry-run
    .venv/bin/python scripts/phase_c_enrich_descriptions.py --limit 5

    # Full HIGH-priority run (after canary sign-off):
    .venv/bin/python scripts/phase_c_enrich_descriptions.py

    # Resume after partial run:
    .venv/bin/python scripts/phase_c_enrich_descriptions.py --skip-done
"""
import argparse
import csv
import json
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

# Sonnet 4.6 pricing (USD per token)
COST_IN  = 3.0  / 1_000_000
COST_OUT = 15.0 / 1_000_000

SYSTEM = """You are a senior sommelier writing curation-grade descriptions for a premium Thai online retailer (Wine-Now). Write in expert third-party voice — NEVER "we" or "our".

QUALITY BAR — this content sits next to ฿9k-฿65k bottles. Style:

1. **TERROIR-DENSE** — name the SITE early. Be specific about soil (gravel-over-clay, galestro/alberese, schist, granite, volcanic basalt, etc.), elevation, aspect, microclimate, and what those conditions do to the wine/spirit.

2. **TECHNIQUE-FORWARD** — quote what's DONE to the product:
   - Wine: maceration length, fermentation vessel, oak regime (% new, French/American, barrique vs foudre vs cement), lees aging, malolactic, native vs cultured yeast
   - Spirits: cask types and percentages, finishing, ABV, chill-filtration, age statement
   - Sake: rice variety, polish ratio (seimaibuai), water source, kimoto/yamahai/sokujo, pasteurization
   - Liqueur/Bitters: base spirit, botanical sources, production method, maceration vs distillation

3. **STORYTELLING** — concrete story hooks only: founding year, a deliberate producer choice and its WHY, place lore, or a rule this producer breaks. Every story sentence must anchor a technical or factual point.

4. **SPECIAL FEATURE** — what makes THIS specific expression unusual within its category.

FACTUAL DISCIPLINE — CRITICAL:
- Write ONLY facts you are confident are true about this specific product.
- If you are uncertain whether a specific technique, score, appellation, or detail applies to THIS exact product, OMIT it — do not invent it, do not guess.
- You may use your general knowledge of the brand and category, but flag uncertainty by omitting rather than hedging.
- No hallucinated critic scores, invented vintages, or fabricated technique parameters.

FORBIDDEN phrases:
- "with notes of..." / "with hints of..." / "showcases..."
- "elegant", "refined", "classic", "iconic" without specifics
- "perfect for...", "ideal pairing for..."
- "represents the pinnacle of..." / "stands as a benchmark of..."
- "harmonious balance of..." / "a testament to..."
- Any structural words in flavor_tags (no "Soft tannins", "Crisp finish", "Smooth", "Refreshing")

OUTPUT JSON SCHEMA:
{
  "desc_en_short": "<=160 char hook — lead with site, technique, or transgression",
  "full_description": "<p>800-1100 char HTML (only p/br/strong/em). RICH but ZERO filler. Required structure: (1) STORY HOOK — single concrete narrative or historical fact that GROUNDS a technical point (1-2 sentences) (2) SITE + soil/elevation + what those conditions DO to the wine (1-2 sentences) (3) TECHNIQUE/winemaking signature — specific parameters with <strong> tags (2-3 sentences) (4) SPECIAL FEATURE — what's unusual here, what rule is broken, what no peer does (1 sentence) (5) VINTAGE character + drinking window (1-2 sentences). NO critic scores. Aim ~900-1000 chars including HTML.</p>",
  "flavor_tags": ["6-8 actual aromatic descriptors — NO structural words"],
  "food_matching": ["4-6 specific dishes — restaurant-menu specific, not generic categories"],
  "pairing_rationale": "1-2 sentences. Ground EACH pairing direction in a specific note.",
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

# CATEGORY-SPECIFIC TASTE AXES (use EXACTLY these axis keys + scale values)
{category_axes_block}

# Task
Write the curation-grade JSON per schema. Use only facts you are confident are true about this specific product. Omit anything uncertain rather than guessing. Fill taste_axes using ONLY the axis keys from the category block above. If the category has no taste matrix, return taste_axes={{}} and style_tag=null."""


def load_env() -> dict:
    env = {}
    env_path = REPO_ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def enrich_one(client, row: dict) -> dict:
    schema = schema_for_classification(row.get("classification"))
    category_axes_block = serialise_for_prompt(schema) if schema else "(no taste matrix for this category — set taste_axes={} and style_tag=null)"

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
            model="claude-sonnet-4-6",
            max_tokens=2000,
            temperature=0.3,
            system=[{"type": "text", "text": SYSTEM}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:
        return {"sku": row["sku"], "status": "api_error", "error": str(e),
                "result": None, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}

    text = "".join(getattr(b, "text", "") for b in resp.content)
    try:
        start = text.find("{")
        end = text.rfind("}")
        result = json.loads(text[start:end + 1])
        status = "ok"
    except Exception as e:
        result = None
        status = f"parse_error: {e}"

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
    food_matching = ", ".join(result.get("food_matching") or [])

    payload = {
        "desc_en_short": result.get("desc_en_short"),
        "full_description": result.get("full_description"),
        "flavor_tags": flavor_tags_json,
        "food_matching": food_matching,
        "pairing_rationale": result.get("pairing_rationale"),
        "enrichment_source": "phase_c_sonnet_direct",
        "enriched_at": enriched_at,
        "enriched_by": "claude-sonnet-4-6",
        "updated_at": enriched_at,
    }

    for attempt in range(5):
        try:
            with lock:
                conn.execute("""
                    UPDATE products SET
                        desc_en_short=:desc_en_short,
                        full_description=:full_description,
                        flavor_tags=:flavor_tags,
                        food_matching=:food_matching,
                        pairing_rationale=:pairing_rationale,
                        enrichment_source=:enrichment_source,
                        enriched_at=:enriched_at,
                        enriched_by=:enriched_by,
                        updated_at=:updated_at
                    WHERE sku=:sku
                """, {**payload, "sku": sku})
                conn.commit()
            return True
        except sqlite3.OperationalError as e:
            if "locked" in str(e) and attempt < 4:
                time.sleep(0.5 * (2 ** attempt))
            else:
                print(f"  DB write failed for {sku}: {e}", file=sys.stderr)
                return False
    return False


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0, help="Process at most N SKUs (0=all)")
    p.add_argument("--dry-run", action="store_true", help="Generate but do NOT write to DB")
    p.add_argument("--skip-done", action="store_true", help="Skip SKUs already enriched by phase_c")
    p.add_argument("--workers", type=int, default=6)
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
          AND (popularity_revenue_window > 0 OR has_recent_sales = 1)
          AND classification NOT IN ('Accessories','Events','Glassware','Non-Alcoholic','Mineral Water','Cigar')
          AND sku NOT LIKE 'ABA%' AND sku NOT LIKE 'AWC%' AND sku NOT LIKE 'CIG%'
          AND sku NOT LIKE 'GBE%' AND sku NOT LIKE 'GDC%' AND sku NOT LIKE 'GLQ%'
          AND sku NOT LIKE 'GWN%' AND sku NOT LIKE 'WEV%'
        ORDER BY popularity_revenue_window DESC NULLS LAST, has_recent_sales DESC, sku
    """)]

    if args.skip_done:
        targets = [r for r in targets if r.get("enrichment_source") != "phase_c_sonnet_direct"]

    if args.limit > 0:
        targets = targets[:args.limit]

    if not targets:
        print("No targets found.")
        return 0

    est_cost = len(targets) * 670 * (COST_IN + COST_OUT * (270 / 670))
    # More precise: ~400 tokens in, ~270 tokens out per product
    est_cost = len(targets) * (400 * COST_IN + 270 * COST_OUT)
    print(f"Targets: {len(targets)}")
    print(f"Estimated cost: ${est_cost:.2f}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE WRITE'}")
    print()

    if not args.dry_run and not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = args.db.with_suffix(args.db.suffix + f".bak-phase-c-{ts}")
        shutil.copy2(args.db, bak)
        print(f"Backup: {bak}\n")

    # Sidecar — every AI result written immediately before DB write (Rule 1)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    sidecar_path = REPO_ROOT / f"data/phase_c_results-{ts}.jsonl"
    sidecar_lock = threading.Lock()
    db_lock = threading.Lock()

    stats = {"ok": 0, "parse_error": 0, "api_error": 0, "db_failed": 0}
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
        if r["status"] == "ok":
            stats["ok"] += 1
            if not args.dry_run:
                ok = apply_to_db(conn, row["sku"], r["result"], db_lock)
                if not ok:
                    stats["db_failed"] += 1
            short = (r["result"] or {}).get("desc_en_short", "")[:80]
            print(f"  [{i+1:>4}/{len(targets)}] {row['sku']} OK  ${r['cost_usd']:.4f}  \"{short}\"")
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
    print(f"=== DONE ===")
    print(f"ok={stats['ok']}  parse_error={stats['parse_error']}  api_error={stats['api_error']}  db_failed={stats['db_failed']}")
    print(f"Total cost: ${total_cost:.4f}")
    print(f"Sidecar: {sidecar_path}")

    if not args.dry_run:
        # Rule 1: verify data actually landed
        filled = conn.execute("""
            SELECT COUNT(*) FROM products
            WHERE enrichment_source='phase_c_sonnet_direct'
              AND full_description IS NOT NULL AND LENGTH(full_description) >= 100
        """).fetchone()[0]
        print(f"\nVerification — phase_c rows in DB with description >= 100 chars: {filled}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
