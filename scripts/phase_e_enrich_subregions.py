#!/usr/bin/env python3
"""
Phase E — Subregion fill for products that have country+region but no subregion.

Uses Haiku 4.5. Subregion is optional geography (e.g. Saint-Julien within Bordeaux,
Pauillac within Bordeaux, Barossa Valley within South Australia).

Only fills where we can derive subregion from the product name or from known brand/producer
geography. Does NOT invent subregions — if uncertain, writes null and skips.

Strategy: batch products by region, ask the model to fill subregion for each product
based on name/brand knowledge. One API call per product for accuracy.

Usage:
    .venv/bin/python scripts/phase_e_enrich_subregions.py --limit 5 --dry-run
    .venv/bin/python scripts/phase_e_enrich_subregions.py --limit 5
    .venv/bin/python scripts/phase_e_enrich_subregions.py
    .venv/bin/python scripts/phase_e_enrich_subregions.py --skip-done
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

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

MODEL = "claude-haiku-4-5-20251001"
COST_IN  = 0.80  / 1_000_000
COST_OUT = 4.00  / 1_000_000
ENRICHMENT_SOURCE = "phase_e_haiku_subregion"

SYSTEM = """You are a geography expert for wine and spirits. Given a product's name, brand, classification, country, and region, identify the most specific subregion if you are confident.

Rules:
- Return ONLY a JSON object: {"subregion": "SubregionName"} or {"subregion": null}
- Use null if you are not confident, or if the region has no meaningful subregion system
- Subregion examples: "Pauillac" within Bordeaux, "Barossa Valley" within South Australia, "Napa Valley" within California, "Islay" within Scotland, "Speyside" within Scotland
- For spirits (vodka, gin, rum, whisky), subregion is the specific distillery region or island (e.g. "Islay", "Speyside", "Campbeltown")
- For sake: prefecture is region; subregion could be a specific town or brewing district — only if well-known
- Do NOT invent subregions. If the product could be from multiple subregions, return null.
- Output ONLY the JSON object, no explanation."""

USER_TMPL = """Product:
SKU: {sku}
Name: {name}
Brand: {brand}
Classification: {classification}
Country: {country}
Region: {region}

What is the subregion? Return {{"subregion": "name"}} or {{"subregion": null}}."""


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


def fill_one(client, row: dict) -> dict:
    user = USER_TMPL.format(
        sku=row["sku"],
        name=row["name"] or "",
        brand=row["brand"] or "",
        classification=row["classification"] or "",
        country=row["country"] or "",
        region=row["region"] or "",
    )

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=100,
            temperature=0.0,
            system=[{"type": "text", "text": SYSTEM}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:
        return {"sku": row["sku"], "status": "api_error", "error": str(e),
                "subregion": None, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}

    text = "".join(getattr(b, "text", "") for b in resp.content)
    clean = re.sub(r'^```json\s*', '', text.strip())
    clean = re.sub(r'```\s*$', '', clean.strip())

    try:
        start = clean.find("{")
        end = clean.rfind("}")
        result = json.loads(clean[start:end + 1])
        subregion = result.get("subregion")
        status = "ok"
    except Exception as e:
        subregion = None
        status = f"parse_error: {e}"

    usage = resp.usage
    cost = (usage.input_tokens or 0) * COST_IN + (usage.output_tokens or 0) * COST_OUT
    return {
        "sku": row["sku"], "status": status, "subregion": subregion,
        "tokens_in": usage.input_tokens or 0,
        "tokens_out": usage.output_tokens or 0,
        "cost_usd": cost,
    }


def apply_to_db(conn, sku: str, subregion: str, lock: threading.Lock) -> bool:
    import time
    updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    for attempt in range(5):
        try:
            with lock:
                conn.execute(
                    "UPDATE products SET subregion=?, updated_at=? WHERE sku=?",
                    (subregion, updated_at, sku)
                )
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
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--skip-done", action="store_true",
                   help="Skip SKUs that already have a subregion")
    p.add_argument("--workers", type=int, default=10)
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
        SELECT sku, name, brand, classification, country, region, price
        FROM products
        WHERE COALESCE(is_active,1)=1
          AND (subregion IS NULL OR subregion = '')
          AND country IS NOT NULL AND country != ''
          AND region IS NOT NULL AND region != ''
          AND sku NOT LIKE 'ABA%' AND sku NOT LIKE 'AWC%' AND sku NOT LIKE 'CIG%'
          AND sku NOT LIKE 'GBE%' AND sku NOT LIKE 'GDC%' AND sku NOT LIKE 'GLQ%'
          AND sku NOT LIKE 'GWN%' AND sku NOT LIKE 'WEV%'
        ORDER BY COALESCE(popularity_revenue_window,0) DESC, COALESCE(price,0) DESC, sku
    """)]

    if args.limit > 0:
        targets = targets[:args.limit]

    if not targets:
        print("No targets found.")
        return 0

    # Haiku: ~200 in tokens (short prompt), ~30 out
    est_cost = len(targets) * (200 * COST_IN + 30 * COST_OUT)
    print(f"Targets: {len(targets)}")
    print(f"Model: {MODEL}")
    print(f"Estimated cost: ${est_cost:.2f}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE WRITE'}")
    print()

    if not args.dry_run and not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = args.db.with_suffix(args.db.suffix + f".bak-phase-e-{ts}")
        shutil.copy2(args.db, bak)
        print(f"Backup: {bak}\n")

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    sidecar_path = REPO_ROOT / f"data/phase_e_results-{ts}.jsonl"
    sidecar_lock = threading.Lock()
    db_lock = threading.Lock()

    stats = {"filled": 0, "null": 0, "parse_error": 0, "api_error": 0, "db_failed": 0}
    total_cost = 0.0
    cost_lock = threading.Lock()

    def work(i: int, row: dict):
        nonlocal total_cost
        r = fill_one(client, row)
        with cost_lock:
            total_cost += r["cost_usd"]
        with sidecar_lock:
            with sidecar_path.open("a") as fh:
                fh.write(json.dumps({"sku": row["sku"], **r}, ensure_ascii=False) + "\n")

        if r["status"] == "ok":
            if r["subregion"]:
                stats["filled"] += 1
                if not args.dry_run:
                    ok = apply_to_db(conn, row["sku"], r["subregion"], db_lock)
                    if not ok:
                        stats["db_failed"] += 1
                print(f"  [{i+1:>4}/{len(targets)}] {row['sku']} -> {r['subregion']}  ${r['cost_usd']:.4f}")
            else:
                stats["null"] += 1
                # only print nulls in dry-run to avoid noise
                if args.dry_run:
                    print(f"  [{i+1:>4}/{len(targets)}] {row['sku']} -> null")
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
    fill_rate = round(stats['filled'] / len(targets) * 100, 1) if targets else 0
    print(f"filled={stats['filled']}  null={stats['null']}  fill_rate={fill_rate}%  parse_error={stats['parse_error']}  api_error={stats['api_error']}  db_failed={stats['db_failed']}")
    print(f"Total cost: ${total_cost:.4f}")
    print(f"Sidecar: {sidecar_path}")

    if not args.dry_run:
        filled = conn.execute("""
            SELECT COUNT(*) FROM products
            WHERE subregion IS NOT NULL AND subregion != ''
              AND COALESCE(is_active,1)=1
        """).fetchone()[0]
        print(f"\nVerification — total products with subregion in DB: {filled}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
