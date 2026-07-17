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
#
# Real audit 2026-07-17 (full name/notes cross-reference against products.db,
# see docs/superpowers/plans/2026-07-16-curation-dossier-phase0.md Task 12
# notes): the "resolve" SKUs below are old-supplier-code listings (importer
# changed, same physical wine re-listed under a new SKU) -- notes text or
# exact name+vintage match confirms identity. "defer" SKUs are a DIFFERENT
# problem: same wine, but an OLDER vintage than whatever the current base SKU
# lists -- critic_scores has no vintage-scoped key, so remapping would
# overwrite the base SKU's current-vintage score. Real data, currently
# homeless; leave untouched until the dossier's per-vintage storage exists.
# "purge" SKUs are either an exact same-vintage duplicate of an existing row
# (WRW4912AA-6) or had no plausible match anywhere in products.db.
ORPHAN_RESOLUTIONS: dict[str, dict] = {
    "WRW0632HI": {"action": "resolve", "to_sku": "WRW0632AA",
                  "reason": "supplier-code change; notes text names Villa Antinori Chianti Classico Riserva"},
    "WWW0216HI": {"action": "resolve", "to_sku": "WWW0216AA",
                  "reason": "supplier-code change; notes text names Cervaro della Sala, vintage 2023 matches"},
    "WSP5706AD": {"action": "resolve", "to_sku": "WSP5706BU",
                  "reason": "supplier-code change; notes text names Krug 2006 Brut, exact vintage match"},
    "WSP5707AD": {"action": "resolve", "to_sku": "WSP5707BU",
                  "reason": "supplier-code change; notes text names Veuve Clicquot La Grande Dame Rose, vintage 2012 matches"},
    "WSP1102AD": {"action": "resolve", "to_sku": "WSP1102BU",
                  "reason": "supplier-code change; notes text names Veuve Clicquot La Grande Dame"},
    # NOTE: originally classified "resolve" -> WSP1096AD, but WSP1096AD already
    # held the identical 3 scores (same critics/scores/vintage=N/V) -- this was
    # an exact duplicate scrape under a stray SKU, not a supplier-code gap-fill
    # like the other 5. Corrected to "purge" after the mistaken remap created
    # 3 duplicate rows on WSP1096AD, which were manually deleted by exact id
    # match against the pre-change backup (products.db.backup-orphan-critic-sku-
    # resolution-20260717.db) with direct user sign-off on 2026-07-17.
    "WSP1100AD": {"action": "purge",
                  "reason": "exact duplicate: WSP1096AD (standard 750ml Veuve Clicquot Yellow Label) already has identical Wine Enthusiast 90/Wine Spectator 90/James Suckling 92, all N/V"},

    "WRW3368BS-6": {"action": "defer",
                    "reason": "same wine (Castello di Bossi Corbaia IGT) but 2016 vintage vs base WRW3368BS's current 2020 -- no vintage-scoped slot in critic_scores yet"},
    "WRW4245BS-6": {"action": "defer",
                    "reason": "same wine (Castello di Bossi Girolamo IGT) but 2019 vintage vs base WRW4245BS's current 2020"},
    "WRW4918AA-6": {"action": "defer",
                    "reason": "same wine (Damilano Barolo Liste DOCG) but 2015 vintage vs base WRW4918AA's current listing"},
    "WRW5265DW-6": {"action": "defer",
                    "reason": "same wine (Castelli del Grevepesa Clemente VII Riserva) but 2016 vintage vs base WRW5265DW's current 2019"},
    "WRW5477DW-6": {"action": "defer",
                    "reason": "same wine (Castelli del Grevepesa Castello Di Bibbione Riserva) but 2019 vintage matches base -- verify before next pass"},
    "WRW5478DW-6": {"action": "defer",
                    "reason": "same wine (Castelli del Grevepesa Castello Di Bibbione Gran Selezione) but 2018 vintage matches base -- verify before next pass"},

    "WRW4912AA-6": {"action": "purge",
                    "reason": "exact duplicate: base WRW4912AA already has an identical James Suckling 93/2019 row"},
    "WRW5288AA-6": {"action": "purge",
                    "reason": "exact duplicate: base WRW5288AA already has identical Wine Spectator 93/2020 and James Suckling 96/2020 rows"},
    "WRW4693DW": {"action": "purge", "reason": "no plausible match found in products.db after full-text search"},
    "WRW5098FO": {"action": "purge", "reason": "no plausible match found in products.db after full-text search"},
    "WSP1206AD": {"action": "purge", "reason": "no plausible match found in products.db after full-text search"},
    "WSP9030BN": {"action": "purge", "reason": "nearest candidate (WSP2444BN Cristal Rose 2013) is a vintage/SKU-block mismatch, not confirmed"},
    "WWW2321ED": {"action": "purge", "reason": "no plausible match found in products.db after full-text search"},
    "WWW2412DK": {"action": "purge", "reason": "no plausible match found in products.db after full-text search"},
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
    deferred_count = 0
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
        elif res["action"] == "defer":
            # Explicitly recorded, deliberately untouched -- real data with no
            # safe destination yet (see reason string). Counts as "handled"
            # for Rule 3 purposes, not left silently unresolved.
            deferred_count += 1
    if not dry_run:
        conn.commit()
    return {"resolved": resolved_count, "purged": purged_count,
             "deferred": deferred_count, "unresolved": len(unresolved)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write changes (default is dry-run report)")
    args = ap.parse_args(argv)

    conn = sqlite3.connect(args.db)
    result = apply_resolutions(conn, dry_run=not args.apply)
    mode = "APPLIED" if args.apply else "DRY-RUN"
    print(f"[{mode}] resolved={result['resolved']} purged={result['purged']} "
          f"deferred={result['deferred']} unresolved={result['unresolved']}")
    if not args.apply and (result["resolved"] or result["purged"]):
        print("Re-run with --apply to write these changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
