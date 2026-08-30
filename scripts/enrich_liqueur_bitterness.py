#!/usr/bin/env python3
"""Liqueur Bitterness enrichment (Haiku, Rule-10 compliant).

Populates the `bitterness` column for Liqueur-category products using Claude Haiku.
Scale: Low / Medium / Medium-High / High (matches StructuralGauges SCALE_DEFINITIONS).
Products with no bitterness → omit field → no gauge (correct UX).

Rule 10 gates:
  1. Backup created automatically when --apply is passed.
  2. Default is dry-run (prints prompt + cost estimate, no API calls, no writes).
  3. Use --limit 5 for the canary run. Verify in UI before removing the limit.
  4. --apply actually calls Haiku and writes to products.db.

Usage:
  # Dry-run (no API calls, no cost):
  .venv/bin/python scripts/enrich_liqueur_bitterness.py --limit 5 --dry-run

  # Canary (5 SKUs, real API, writes to DB):
  .venv/bin/python scripts/enrich_liqueur_bitterness.py --limit 5 --apply

  # Full run (after canary verified in UI):
  .venv/bin/python scripts/enrich_liqueur_bitterness.py --apply
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from data.lib.taxonomy.sku_taxonomy import resolve  # noqa: E402

DEFAULT_DB = REPO / "data" / "db" / "products.db"
MODEL = "claude-haiku-4-5-20251001"
# Haiku pricing (per token): $0.80/M input, $4.00/M output
COST_IN = 0.80 / 1_000_000
COST_OUT = 4.00 / 1_000_000
VALID_SCALE = {"Low", "Medium", "Medium-High", "High"}

SYSTEM_PROMPT = """\
You are a spirits and liqueur expert. Rate the bitterness level of liqueur products.
Respond with valid JSON only: {"bitterness": "<value>"} where value is one of:
  Low        — little to no bitterness (cream liqueurs, fruit liqueurs, sweet cordials)
  Medium     — mild, pleasant bitterness (some amaro styles, coffee liqueurs)
  Medium-High — noticeable bitterness that defines the product (Aperol, lighter amaros)
  High       — dominant, intense bitterness (Campari, Fernet-Branca, Cynar, Underberg)
If you genuinely cannot assess from the product name alone, respond: {"bitterness": null}"""

USER_TEMPLATE = 'Rate the bitterness of this liqueur: "{name}"'


def _instock(v) -> bool:
    return str(v) in ("1", "True", "true")


def _empty(v) -> bool:
    return v is None or str(v).strip() == ""


def select_liqueurs(conn: sqlite3.Connection, limit: int | None) -> list[dict]:
    conn.row_factory = sqlite3.Row
    out = []
    for r in conn.execute(
        "SELECT sku, name, is_in_stock, bitterness FROM products ORDER BY sku"
    ):
        if not _instock(r["is_in_stock"]):
            continue
        res = resolve({"sku": r["sku"], "name": r["name"]})
        if res.get("group") != "Liqueur":
            continue
        if not _empty(r["bitterness"]):
            continue  # already enriched — never overwrite
        out.append({"sku": r["sku"], "name": r["name"]})
        if limit and len(out) >= limit:
            break
    return out


def call_haiku(name: str, client) -> tuple[str | None, int, int]:
    """Returns (bitterness_value_or_None, input_tokens, output_tokens)."""
    msg = client.messages.create(
        model=MODEL,
        max_tokens=64,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": USER_TEMPLATE.format(name=name)}],
    )
    raw = msg.content[0].text.strip()
    # Haiku sometimes wraps JSON in ```json ... ``` fences — strip them
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        payload = json.loads(raw)
        val = payload.get("bitterness")
        if val not in VALID_SCALE:
            val = None
    except Exception:
        val = None
    return val, msg.usage.input_tokens, msg.usage.output_tokens


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--limit", type=int, default=None, help="cap SKU count (canary: 5)")
    ap.add_argument("--apply", action="store_true", help="call API + write (default: dry-run)")
    ap.add_argument("--dry-run", action="store_true", dest="dry_run", help="explicit dry-run (default)")
    ap.add_argument("--ts", default=None, help="backup timestamp suffix (default: auto)")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"ERROR: DB not found: {args.db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.db)

    # Ensure column exists (idempotent — ignore if already present)
    try:
        conn.execute("ALTER TABLE products ADD COLUMN bitterness TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    rows = select_liqueurs(conn, args.limit)
    print(f"Eligible Liqueur rows (null bitterness, in-stock): {len(rows)}")

    if not rows:
        print("Nothing to enrich.")
        conn.close()
        return 0

    # Cost estimate (approximate 250 input + 20 output tokens per call)
    est_cost = len(rows) * (250 * COST_IN + 20 * COST_OUT)
    print(f"Estimated cost: ${est_cost:.4f} ({len(rows)} SKUs × ~$0.000204/SKU)")

    if not args.apply:
        print("\n--- DRY RUN — no API calls, no writes ---")
        print("Sample prompt for first row:")
        print(f"  {USER_TEMPLATE.format(name=rows[0]['name'])}")
        print("\nPass --apply to run the enrichment.")
        conn.close()
        return 0

    # Backup before any writes (Rule 10 step 1)
    ts = args.ts or time.strftime("%Y%m%d-%H%M%S")
    bak = args.db.parent / f"{args.db.name}.backup-bitterness-{ts}.db"
    shutil.copy2(args.db, bak)
    print(f"Backup: {bak}")

    try:
        import anthropic
    except ImportError:
        print("ERROR: pip install anthropic", file=sys.stderr)
        conn.close()
        return 1

    client = anthropic.Anthropic()
    total_in = total_out = 0
    written = skipped = 0

    for row in rows:
        val, tok_in, tok_out = call_haiku(row["name"], client)
        total_in += tok_in
        total_out += tok_out
        if val:
            conn.execute(
                "UPDATE products SET bitterness = ? WHERE sku = ?",
                (val, row["sku"]),
            )
            conn.commit()
            print(f"  ✓ {row['sku']} — {row['name'][:50]} → {val}")
            written += 1
        else:
            print(f"  — {row['sku']} — {row['name'][:50]} → null (no gauge)")
            skipped += 1

    actual_cost = total_in * COST_IN + total_out * COST_OUT
    print(f"\nDone. Written: {written}  Skipped/null: {skipped}")
    print(f"Actual cost: ${actual_cost:.4f}  ({total_in} in / {total_out} out tokens)")
    print("\nNext steps (Rule 1 / Rule 9):")
    print("  1. Verify DB: SELECT COUNT(*) FROM products WHERE bitterness IS NOT NULL;")
    print("  2. Run: .venv/bin/python scripts/refresh_live_export.py")
    print("  3. Check a liqueur product page in the UI for the Bitterness gauge.")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
