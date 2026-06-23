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
import json
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
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


def _sold(v) -> int:
    """Coerce sold_orders to int. Prod data is dirty (Rule 3): 'N/A', '1,234',
    '3.0', None all appear. A bad value must NOT crash the whole selection —
    treat anything non-numeric as 0 (no sales signal)."""
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def group_for(row) -> str | None:
    """Return the SKU-derived GROUP (Rule 12). NEVER the type — schema_for_group
    is group-keyed and the two diverge for non-wine categories."""
    return resolve({"sku": row["sku"], "name": row["name"]}).get("group")


def select_rows(conn: sqlite3.Connection) -> list[dict]:
    """Pick in-stock, non-wine, has-signal rows still missing variety or body."""
    conn.row_factory = sqlite3.Row
    try:
        critic = {r[0] for r in conn.execute("SELECT DISTINCT sku FROM critic_scores")}
    except sqlite3.OperationalError:
        # Stale/backup DB may lack the table; degrade to sales-signal-only (Rule 3).
        print(
            "WARN: critic_scores table absent — proceeding with sales-signal only",
            file=sys.stderr,
        )
        critic = set()
    out: list[dict] = []
    for r in conn.execute(
        "SELECT sku,name,is_in_stock,variety,body,"
        "has_recent_sales,sold_orders FROM products ORDER BY sku"
    ):
        if not _instock(r["is_in_stock"]):
            continue
        group = group_for(r)
        if group not in NONWINE:
            continue
        signal = (
            str(r["has_recent_sales"]) in ("1", "True", "true")
            or _sold(r["sold_orders"]) > 0
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


SYSTEM = ("You are a precise beverage attribute extractor. "
          "Output ONLY the requested JSON, values from the allowlist or null.")


def load_done_skus(path) -> set:
    """Read a JSONL sidecar and return the set of skus already present (ANY
    status, incl. api_error). Resume cost-safety (Rule 4/10): a re-run must not
    re-PAY for a sku already in the sidecar.

    A non-existent path -> empty set (fresh run). Blank / truncated / malformed
    lines (a crash mid-write leaves a partial last line) are skipped, not fatal —
    a corrupt tail must never abort the resume scan."""
    path = Path(path)
    if not path.exists():
        return set()
    done: set = set()
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001 — partial/garbage line -> skip, don't crash resume
                continue
            sku = rec.get("sku")
            if sku is not None:
                done.add(sku)
    return done


def filter_undone(rows: list[dict], done_skus: set) -> list[dict]:
    """Drop rows whose sku is already in done_skus (resume without re-paying)."""
    return [r for r in rows if r["sku"] not in done_skus]


def enrich_one(client, row: dict) -> dict:
    """ONE paid Haiku call: extract variety+body, parse JSON-in-text, then
    VALIDATE against the group's allowlist + the 4-step body scale. Off-vocab
    variety and off-scale body are DROPPED to None (Rule 1/12 + spec §4.1) — the
    LLM is constrained but NOT trusted; a coerced wrong value would silently ship
    bad data, whereas None just leaves the gap for the NULL-only merge to fill
    later. SDK usage mirrors phase_d1. Never raises — API errors become a row
    with status 'api_error' so one bad SKU can't abort a paid bulk run."""
    try:
        resp = client.messages.create(
            model=MODEL, max_tokens=200, temperature=0,  # temp=0 for determinism
            system=[{"type": "text", "text": SYSTEM}],
            messages=[{"role": "user", "content": build_prompt(row)}])
    except Exception as e:  # noqa: BLE001 — any SDK/network error -> recorded, not raised
        return {"sku": row["sku"], "group": row["group"],
                "status": f"api_error: {e}", "variety": None, "body": None,
                "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}
    text = "".join(getattr(b, "text", "") for b in resp.content)
    try:
        raw = json.loads(text[text.find("{"):text.rfind("}") + 1])
    except Exception:  # noqa: BLE001 — malformed/non-JSON -> empty dict (graceful None/None)
        raw = {}
    variety = validate_variety(row["group"], raw.get("variety"))  # off-vocab -> None
    body = validate_body(raw.get("body"))                         # off-scale -> None
    u = resp.usage
    tin = u.input_tokens or 0
    tout = u.output_tokens or 0
    return {"sku": row["sku"], "group": row["group"], "status": "ok",
            "variety": variety, "body": body,
            "tokens_in": tin, "tokens_out": tout,
            "cost_usd": tin * COST_IN + tout * COST_OUT}


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
    p.add_argument(
        "--skip-done",
        action="store_true",
        help="skip SKUs already in the sidecar (resume without re-paying)",
    )
    a = p.parse_args(argv)

    conn = sqlite3.connect(a.db)
    rows = select_rows(conn)
    print(f"Selected {len(rows)} rows (need variety or body).")

    if a.dry_run:
        # Apply --limit to the preview so `--limit N --dry-run` previews the same
        # window the paid run would take. (Resume filtering is paid-path only.)
        preview = rows[: a.limit] if a.limit else rows
        for r in preview[:5]:
            print(f"\n--- {r['sku']} {r['name']} [{r['group']}] ---")
            print(build_prompt(r))
        print("\n(dry-run — ZERO API calls made)")
        return 0

    # ----- PAID BRANCH (Task 4) — spends money. Rule 10: only after sign-off. ---
    # SOURCE OF TRUTH is the JSONL sidecar below, NOT enrichment_cache. We do NOT
    # write enrichment_cache: it has 6 NOT NULL columns (incl. prompt_hash /
    # evidence_hash) plus a cost_thb column, so a naive insert would crash
    # mid-paid-run after money is already spent. The separate NULL-only merge
    # script (Task 2) reads this sidecar to fill DB gaps; this script writes NO
    # products.db rows. Each sidecar record carries the validated (or None)
    # values only, so the downstream gap-fill never clobbers existing data.
    sidecar = REPO / f"data/phase_b_results-{a.ts}.jsonl"

    # ----- RESUME / ANTI-CLOBBER cost-safety (Rule 4/10) — BEFORE any SDK/spend -
    # The sidecar is the source of truth + the ONLY record of what we already
    # paid for. This guard runs before the SDK import/client so it can refuse
    # safely without needing an API key or making any call:
    #   --skip-done  -> read existing skus, drop them from `rows`, APPEND-mode
    #                   (prior results preserved, no re-pay).
    #   no flag, but a non-empty sidecar already exists -> REFUSE to run rather
    #                   than truncate it (truncate = destroy completed work AND
    #                   re-pay for everything). Operator must --skip-done or --ts.
    done_skus = load_done_skus(sidecar)
    if a.skip_done:
        before = len(rows)
        rows = filter_undone(rows, done_skus)
        print(f"Resume: {len(done_skus)} already in sidecar; "
              f"skipped {before - len(rows)}, {len(rows)} remaining to call.")
        open_mode = "a"  # APPEND — never truncate prior paid results
    else:
        if done_skus:
            print(
                f"ERROR: sidecar {sidecar} already has {len(done_skus)} result(s).\n"
                "Refusing to truncate it (that would DESTROY completed work and "
                "RE-PAY for every SKU).\n"
                "Use --skip-done to resume (append), or a fresh --ts for a new run.",
                file=sys.stderr,
            )
            return 1
        open_mode = "w"

    # Apply --limit AFTER resume-filtering so a capped resume processes the NEXT N
    # *undone* rows (not the first N selected, which on a resume may already be done
    # -> the run would stall / re-evaluate the same window). select_rows ORDER BY sku
    # makes "next N" deterministic across DB rewrites.
    if a.limit:
        rows = rows[: a.limit]

    if not rows:
        print("Nothing to do — all selected SKUs already in sidecar. No API calls.")
        return 0

    import os

    # Load ANTHROPIC_API_KEY from .env.local (mirrors phase_d1's loader). The key is
    # never in the shell env; .env.local lives at the repo root (symlinked into the
    # worktree). setdefault so a real env var still wins.
    env_path = REPO / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY missing (.env.local not found or no key)",
              file=sys.stderr)
        return 1

    import anthropic  # imported here so dry-run/tests never need the SDK installed

    client = anthropic.Anthropic()

    lock = threading.Lock()
    total_cost = 0.0
    total_in = total_out = 0
    n_calls = n_ok = n_api_error = n_variety = n_body = 0

    with sidecar.open(open_mode) as fh, ThreadPoolExecutor(max_workers=6) as ex:
        futures = {ex.submit(enrich_one, client, r): r for r in rows}
        for fut in as_completed(futures):
            res = fut.result()
            with lock:
                fh.write(json.dumps(res) + "\n")
                fh.flush()
                n_calls += 1
                total_cost += res["cost_usd"]
                total_in += res["tokens_in"]
                total_out += res["tokens_out"]
                if res["status"] == "ok":
                    n_ok += 1
                elif str(res["status"]).startswith("api_error"):
                    n_api_error += 1
                if res["variety"] is not None:
                    n_variety += 1
                if res["body"] is not None:
                    n_body += 1

    # Rule 4: per-SUCCESSFUL-row cost (NOT per-attempt — api_errors paid nothing
    # but must not deflate the cost-per-good-row the operator reasons about).
    per_ok = total_cost / max(n_ok, 1)
    print(f"Sidecar: {sidecar}")
    print(f"Calls: {n_calls}  ok: {n_ok}  api_error: {n_api_error}")
    print(f"Total cost: ${total_cost:.4f}  in: {total_in}  out: {total_out}")
    print(f"variety filled: {n_variety}  body filled: {n_body}")
    print(f"Per-SUCCESSFUL-row cost: ${per_ok:.6f}")
    print(
        "NOTE: these are cache/sidecar counts, NOT user-facing 'shipped' counts. "
        "The shipped verification (Rule 1/4) happens at the merge+export step "
        "(Task 6): merge sidecar -> products.db -> refresh_live_export -> count.",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
