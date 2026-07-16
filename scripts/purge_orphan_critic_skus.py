#!/usr/bin/env python3
"""Resolve or purge critic_scores rows that don't join to any products.sku
(spec §3/§8 Phase 0 — 20 orphans as of 2026-07-15).

Rule 3 (CLAUDE.md): every orphan must have an EXPLICIT recorded resolution —
no silent drops. If a future run finds an orphan not in ORPHAN_RESOLUTIONS,
it is printed and left untouched (fail loud, not silent).
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

# Populated from the manual audit against the LIVE products.db (this worktree
# does not have access to it). This is data-entry, not code: a human fills in
# this dict by running `--db <path-to-live-products.db>` (dry-run, no --apply)
# from the main checkout, inspecting each printed orphan SKU, then adding an
# explicit resolution entry for it before re-running with --apply.
ORPHAN_RESOLUTIONS: dict[str, dict] = {
    # "WRW9999-TYPO": {"action": "resolve", "to_sku": "WRW9999"},
    # "WSP1234-DISC": {"action": "purge", "reason": "discontinued 2025, no successor SKU"},
}


def find_orphans(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("""
        SELECT DISTINCT cs.sku FROM critic_scores cs
        LEFT JOIN products p ON p.sku = cs.sku
        WHERE cs.sku IS NOT NULL AND cs.sku != '' AND p.sku IS NULL
        ORDER BY cs.sku
    """).fetchall()
    return [r[0] for r in rows]


def apply_resolutions(conn: sqlite3.Connection, dry_run: bool = True) -> dict:
    orphans = find_orphans(conn)
    unresolved = [o for o in orphans if o not in ORPHAN_RESOLUTIONS]
    if unresolved:
        print(f"WARN: {len(unresolved)} orphans have no recorded resolution, "
              f"left untouched: {unresolved}", file=sys.stderr)

    resolved_count = 0
    purged_count = 0
    for sku, res in ORPHAN_RESOLUTIONS.items():
        if sku not in orphans:
            continue  # already fixed by a prior run
        if res["action"] == "resolve":
            if not dry_run:
                conn.execute(
                    "UPDATE critic_scores SET sku = ? WHERE sku = ?",
                    (res["to_sku"], sku),
                )
            resolved_count += 1
        elif res["action"] == "purge":
            if not dry_run:
                conn.execute("DELETE FROM critic_scores WHERE sku = ?", (sku,))
            purged_count += 1
    if not dry_run:
        conn.commit()
    return {"resolved": resolved_count, "purged": purged_count, "unresolved": len(unresolved)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write changes (default is dry-run report)")
    args = ap.parse_args(argv)

    conn = sqlite3.connect(args.db)
    result = apply_resolutions(conn, dry_run=not args.apply)
    mode = "APPLIED" if args.apply else "DRY-RUN"
    print(f"[{mode}] resolved={result['resolved']} purged={result['purged']} "
          f"unresolved={result['unresolved']}")
    if not args.apply and (result["resolved"] or result["purged"]):
        print("Re-run with --apply to write these changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
