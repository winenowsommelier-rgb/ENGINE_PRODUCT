"""Phase B enrichment — ROW SELECTION + FREE dry-run (Task 3).

This module selects the non-wine, in-stock, has-a-buying-signal products that
are still missing `variety` and/or `body`, and builds the constrained LLM
prompt for each. The PAID LLM call lands in a LATER task (Task 4); this file
makes ZERO network/API calls and never writes to the DB (read-only SELECT).

Critical contracts (load-bearing — see CLAUDE.md Rules 1, 12 + Task-1 fix):
  * Category comes from sku_taxonomy.resolve()["group"], NEVER the magento
    `classification` field (Rule 12).
  * schema_for_group() is keyed by GROUP. resolve() returns BOTH group and
    type and they DIVERGE for non-wine (group "Spirits" -> type "Rum",
    group "Sake & Asian" -> type "Umeshu"). We ALWAYS pass the GROUP. Passing
    the type returns None and silently skips most non-wine products after the
    LLM has already been paid. The parity test guards this at the call site.
  * is_in_stock is a STRING "0"/"1"/null — truthiness is backwards; only
    treat str(v) in ("1","True","true") as in-stock.

Run the FREE dry-run (no spend):
  ./.venv/bin/python scripts/enrich_phase_b.py --db data/db/products.db \
      --limit 5 --dry-run
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from data.lib.taxonomy.sku_taxonomy import resolve  # noqa: E402
from data.lib.taste_taxonomy.universal_scales import (  # noqa: E402
    schema_for_group,
    validate_body,
    validate_variety,
)

# Canonical DB lives at repo-root data/db/products.db. This resolves inside the
# worktree too; for the real run the operator passes --db data/db/products.db.
DEFAULT_DB = REPO / "data" / "db" / "products.db"

MODEL = "claude-haiku-4-5-20251001"
COST_IN, COST_OUT = 0.80 / 1_000_000, 4.00 / 1_000_000

# These are SKU-taxonomy GROUP names (Rule 12), and each has a Phase-B schema.
NONWINE = {"Spirits", "Whisky", "Sake & Asian", "Liqueur", "Beer & RTD"}
ENRICHMENT_SOURCE = "phase_b_haiku_variety_body"


def _instock(v) -> bool:
    """is_in_stock is a string "0"/"1"/null; only "1"/"True"/"true" = in stock."""
    return str(v) in ("1", "True", "true")


def _empty(v) -> bool:
    return v is None or str(v).strip() == ""


def group_for(row) -> str | None:
    """Return the SKU-derived GROUP (Rule 12). NEVER the type — schema_for_group
    is group-keyed and the two diverge for non-wine categories."""
    return (resolve({"sku": row["sku"], "name": row["name"]}) or {}).get("group")


def select_rows(conn: sqlite3.Connection) -> list[dict]:
    """Pick in-stock, non-wine, has-signal rows still missing variety or body."""
    conn.row_factory = sqlite3.Row
    critic = {r[0] for r in conn.execute("SELECT DISTINCT sku FROM critic_scores")}
    out: list[dict] = []
    for r in conn.execute(
        "SELECT sku,name,is_in_stock,variety,body,"
        "has_recent_sales,sold_orders FROM products"
    ):
        if not _instock(r["is_in_stock"]):
            continue
        group = group_for(r)
        if group not in NONWINE:
            continue
        signal = (
            str(r["has_recent_sales"]) in ("1", "True", "true")
            or int(r["sold_orders"] or 0) > 0
            or r["sku"] in critic
        )
        if not signal:
            continue
        if _empty(r["variety"]) or _empty(r["body"]):
            out.append({**dict(r), "group": group})
    return out


def build_prompt(row: dict) -> str:
    """Build the constrained variety+body prompt. Keyed on the GROUP (Task-1)."""
    schema = schema_for_group(row["group"])  # GROUP-keyed (Task-1 critical fix)
    vocab = ", ".join(schema["variety_vocab"])
    body = ", ".join(schema["body_scale"])
    return (
        f"Product: {row['name']}\nCategory: {row['group']}\n\n"
        f"Return STRICT JSON {{\"variety\": <one of [{vocab}] or null>, "
        f"\"body\": <one of [{body}] or null>}}.\n"
        "Use ONLY the listed values. If unsure, use null. Never invent a value."
    )


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Phase B row selection + FREE dry-run")
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="NO API CALL — print prompts + selection only (free)",
    )
    p.add_argument("--ts", default="run", help="sidecar suffix (e.g. canary/full)")
    a = p.parse_args(argv)

    conn = sqlite3.connect(a.db)
    rows = select_rows(conn)
    if a.limit:
        rows = rows[: a.limit]
    print(f"Selected {len(rows)} rows (need variety or body).")

    if a.dry_run:
        for r in rows[:5]:
            print(f"\n--- {r['sku']} {r['name']} [{r['group']}] ---")
            print(build_prompt(r))
        print("\n(dry-run — ZERO API calls made)")
        return 0

    print("Paid path not yet enabled (Task 4).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
