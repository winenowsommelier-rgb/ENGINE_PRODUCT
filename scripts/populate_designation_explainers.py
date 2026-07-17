#!/usr/bin/env python3
"""Phase 0.5: write authored explainer text for the 27 seeded
designation_reference rows (spec §8 Phase 0.5). Content is category-level
knowledge (checkable public consensus, e.g. Wikipedia/appellation-body
sources), not a product claim -- spec §5.3 permits this to draw on general
knowledge rather than requiring a per-row fetched source URL like
expert_note/producer_history do. sources_json still records the reference
material used, for auditability.

Splits the single seeded 'Grand Cru'/'ALL' stub row into 3 region-specific
rows (Burgundy/Alsace/Champagne) -- confirmed via direct query against
products.db that all 3 have real in-stock SKUs, and each region's Grand Cru
means something genuinely different (vineyard tier vs village rating). This
is the exact merge-hazard the spec calls out by name (§4 table comment).

Idempotent: safe to re-run. Content file is data, not logic -- keeping it
as a separate JSON (not inlined in this script) means re-running the same
content lands identically, and future content edits are a data change, not
a code change.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "dossier.db"
DEFAULT_CONTENT = REPO_ROOT / "data" / "dossier_content" / "designation_explainers.json"


def populate(conn: sqlite3.Connection, entries: list[dict]) -> dict:
    # Drop the single 'ALL' stub for any designation this content file
    # splits into region-specific rows (currently just Grand Cru), so the
    # generic stub doesn't linger alongside its regional replacements.
    split_designations = {
        e["designation"] for e in entries if e["region"] != "ALL"
    }
    for designation in split_designations:
        conn.execute(
            "DELETE FROM designation_reference WHERE designation = ? AND region = 'ALL'",
            (designation,),
        )

    written = 0
    for e in entries:
        cur = conn.execute(
            """
            INSERT INTO designation_reference (designation, region, kind, explainer, sources_json)
            VALUES (:designation, :region, :kind, :explainer, :sources_json)
            ON CONFLICT(designation, region) DO UPDATE SET
                kind = excluded.kind,
                explainer = excluded.explainer,
                sources_json = excluded.sources_json
            """,
            e,
        )
        written += cur.rowcount
    conn.commit()
    return {"written": written, "split_designations": sorted(split_designations)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--content", type=Path, default=DEFAULT_CONTENT)
    args = ap.parse_args(argv)

    entries = json.loads(args.content.read_text())
    for e in entries:
        e.setdefault("sources_json", None)

    conn = sqlite3.connect(args.db)
    result = populate(conn, entries)
    print(f"Wrote {result['written']} designation_reference rows "
          f"(split into per-region rows: {result['split_designations']}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
