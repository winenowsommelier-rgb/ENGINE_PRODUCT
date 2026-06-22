#!/usr/bin/env python3
"""
Phase D1 — Description enrichment for products with critic score >= 90 and no description.

Uses Haiku 4.5 (cheap: ~$0.09 for 73 products). These products surface in curation via
_web_freshness() and having no description is visible to users.

Usage:
    # 5-SKU canary (ALWAYS run first per Rule 10):
    .venv/bin/python scripts/phase_d1_enrich_critic_scored.py --limit 5 --dry-run
    .venv/bin/python scripts/phase_d1_enrich_critic_scored.py --limit 5

    # Full run (after canary sign-off):
    .venv/bin/python scripts/phase_d1_enrich_critic_scored.py

    # Resume after partial run:
    .venv/bin/python scripts/phase_d1_enrich_critic_scored.py --skip-done
"""
import argparse
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

# Haiku 4.5 pricing (USD per token)
MODEL = "claude-haiku-4-5-20251001"
COST_IN  = 0.80  / 1_000_000
COST_OUT = 4.00  / 1_000_000

ENRICHMENT_SOURCE = "phase_d1_haiku_critic_scored"

SYSTEM = """You are a senior sommelier writing curation-grade descriptions for a premium Thai online retailer (Wine-Now). Write in expert third-party voice — NEVER "we" or "our".

QUALITY BAR — this content sits next to ฿9k-฿65k bottles. Style:

1. **TERROIR-DENSE** — name the SITE early. Be specific about soil, elevation, aspect, microclimate, and what those conditions do to the wine/spirit.

2. **TECHNIQUE-FORWARD** — quote what's DONE to the product:
   - Wine: maceration length, fermentation vessel, oak regime (% new, French/American, barrique vs foudre vs cement), lees aging, malolactic
   - Spirits: cask types and percentages, finishing, ABV, age statement
   - Sake: rice variety, polish ratio, water source, kimoto/yamahai/sokujo
   - Liqueur/Bitters: base spirit, botanical sources, maceration vs distillation

3. **STORYTELLING** — concrete story hooks only: founding year, a deliberate producer choice and its WHY, place lore, or a rule this producer breaks.

4. **SPECIAL FEATURE** — what makes THIS specific expression unusual within its category.

FACTUAL DISCIPLINE — CRITICAL:
- Write ONLY facts you are confident are true about this specific product.
- If uncertain, OMIT it — do not invent it, do not guess.
- No hallucinated critic scores, invented vintages, or fabricated technique parameters.

FORBIDDEN phrases:
- "with notes of..." / "with hints of..." / "showcases..."
- "elegant", "refined", "classic", "iconic" without specifics
- "perfect for...", "ideal pairing for..."
- "represents the pinnacle of..." / "stands as a benchmark of..."
- "harmonious balance of..." / "a testament to..."
- Any structural words in flavor_tags (no "Soft tannins", "Crisp finish", "Smooth")

OUTPUT JSON SCHEMA:
{
  "desc_en_short": "<=160 char hook — lead with site, technique, or transgression",
  "full_description": "<p>800-1100 char HTML (only p/br/strong/em). Required structure: (1) STORY HOOK (2) SITE + soil/elevation (3) TECHNIQUE/winemaking — specific parameters with <strong> tags (4) SPECIAL FEATURE (5) VINTAGE character + drinking window. NO critic scores.</p>",
  "flavor_tags": ["6-8 actual aromatic descriptors — NO structural words"],
  "food_matching": ["4-6 specific dishes — restaurant-menu specific"],
  "pairing_rationale": "1-2 sentences grounding each pairing direction in a specific note.",
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
Critic Score: {score_max} ({score_summary})

# CATEGORY-SPECIFIC TASTE AXES (use EXACTLY these axis keys + scale values)
{category_axes_block}

# Task
Write the curation-grade JSON per schema. Use only facts you are confident are true about this specific product. Omit anything uncertain. Fill taste_axes using ONLY the axis keys from the category block above. If the category has no taste matrix, return taste_axes={{}} and style_tag=null."""


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


def fix_unescaped_quotes(text: str) -> str:
    """Fix unescaped double-quotes inside JSON string values (state-machine approach)."""
    result = []
    in_string = False
    escaped = False
    i = 0
    while i < len(text):
        c = text[i]
        if escaped:
            result.append(c)
            escaped = False
        elif c == '\\':
            result.append(c)
            escaped = True
        elif c == '"' and in_string:
            # Peek ahead: is this a closing quote?
            j = i + 1
            while j < len(text) and text[j] == ' ':
                j += 1
            if j < len(text) and text[j] in (',', '}', ']', '\n', '\r'):
                result.append(c)
                in_string = False
            else:
                result.append('\\"')
        elif c == '"' and not in_string:
            result.append(c)
            in_string = True
        else:
            result.append(c)
        i += 1
    return ''.join(result)


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
        score_max=row.get("score_max") or "",
        score_summary=row.get("score_summary") or "",
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
    try:
        start = text.find("{")
        end = text.rfind("}")
        result = json.loads(text[start:end + 1])
        status = "ok"
    except Exception:
        try:
            fixed = fix_unescaped_quotes(text[text.find("{"):text.rfind("}") + 1])
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
    food_matching_raw = result.get("food_matching") or []
    food_matching = "|".join(food_matching_raw)

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
    p.add_argument("--skip-done", action="store_true", help="Skip SKUs already enriched by this phase")
    p.add_argument("--min-score", type=float, default=90.0, help="Minimum critic score (default 90)")
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
        SELECT sku, name, brand, classification, country, region, subregion, price,
               score_max, score_summary
        FROM products
        WHERE COALESCE(is_active,1)=1
          AND (full_description IS NULL OR LENGTH(full_description) < 100)
          AND score_max >= ?
          AND sku NOT LIKE 'ABA%' AND sku NOT LIKE 'AWC%' AND sku NOT LIKE 'CIG%'
          AND sku NOT LIKE 'GBE%' AND sku NOT LIKE 'GDC%' AND sku NOT LIKE 'GLQ%'
          AND sku NOT LIKE 'GWN%' AND sku NOT LIKE 'WEV%'
        ORDER BY score_max DESC, sku
    """, (args.min_score,))]

    if args.skip_done:
        targets = [r for r in targets if r.get("enrichment_source") != ENRICHMENT_SOURCE]

    if args.limit > 0:
        targets = targets[:args.limit]

    if not targets:
        print("No targets found.")
        return 0

    # Haiku: ~600 in tokens (includes score context), ~500 out
    est_cost = len(targets) * (600 * COST_IN + 500 * COST_OUT)
    print(f"Targets: {len(targets)}")
    print(f"Model: {MODEL}")
    print(f"Estimated cost: ${est_cost:.4f}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE WRITE'}")
    print()

    if not args.dry_run and not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = args.db.with_suffix(args.db.suffix + f".bak-phase-d1-{ts}")
        shutil.copy2(args.db, bak)
        print(f"Backup: {bak}\n")

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    sidecar_path = REPO_ROOT / f"data/phase_d1_results-{ts}.jsonl"
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
            short = (r["result"] or {}).get("desc_en_short", "")[:80]
            score = row.get("score_max") or ""
            print(f"  [{i+1:>4}/{len(targets)}] {row['sku']} ({score}) {r['status']}  ${r['cost_usd']:.4f}  \"{short}\"")
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
        # Rule 1 verification
        filled = conn.execute("""
            SELECT COUNT(*) FROM products
            WHERE enrichment_source=?
              AND full_description IS NOT NULL AND LENGTH(full_description) >= 100
        """, (ENRICHMENT_SOURCE,)).fetchone()[0]
        print(f"\nVerification — {ENRICHMENT_SOURCE} rows in DB with description >= 100 chars: {filled}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
