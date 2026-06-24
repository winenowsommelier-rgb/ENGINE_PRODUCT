#!/usr/bin/env python3
"""Task 4 — critic-score ingest from the MReport masterfile into products.db.

Adapted from scripts/load_critic_scores_from_csv.py. The new masterfile has NO
numeric WE/WA/WS/JS columns. Instead, per critic slot there may be:
  - an HTML prose cell with embedded points (wine_score_wineenthusiast / ...),
    parsed via masterfile_lib.parse_points(); the prose is kept as notes /
    supporting_text.
  - a BARE integer cell (wine_score_1..4), positionally attributed:
        1 -> Wine Enthusiast, 2 -> Wine Advocate,
        3 -> Wine Spectator,  4 -> James Suckling.

Combined value per (sku, critic): when BOTH a bare and an HTML value exist and
they DIFFER, the BARE value WINS (recorded as the score); the conflict is logged
to data/masterfile_score_conflicts.json. When only one exists, that one is used.
HTML prose is used as notes/supporting_text whenever present.

CRITICAL dedupe (critic_scores has no unique index):
  (a) DELETE this run's rows by SOURCE_TAG (re-run safety), AND
  (b) skip inserting any (sku, critic, vintage) already present in ANY source
      (snapshot of ALL rows taken at start) — never duplicate / touch the 3,144
      existing curated rows. vintage '' is normalized to None on BOTH sides.

NULL-only: products.score_max / score_summary are UPDATEd only where the SKU's
current score_max IS NULL or ''. SKUs that gain score_max are unioned into
data/masterfile_filled_skus.json under "score_max" (other keys preserved).

Pure local parse — NO API spend. Per Rule 9, refresh the live export after a
real run:  .venv/bin/python scripts/refresh_live_export.py
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from scripts.masterfile_lib import (  # noqa: E402
    load_masterfile, is_empty_cell, parse_points,
)

DEFAULT_DB = "data/db/products.db"
DEFAULT_CSV = ("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/"
               "Masterfile Data WNLQ9 - MReport Masterfile.csv")
SOURCE_TAG = "mreport_masterfile_2026-06-24"
CONFLICTS_PATH = Path("data/masterfile_score_conflicts.json")
FILLED_SKUS_PATH = Path("data/masterfile_filled_skus.json")

# (bare_col, html_col, canonical critic name, summary abbr) — positional order.
CRITICS = [
    ("wine_score_1", "wine_score_wineenthusiast", "Wine Enthusiast", "WE"),
    ("wine_score_2", "wine_score_wineadvocate",   "Wine Advocate",   "WA"),
    ("wine_score_3", "wine_score_winespectator",  "Wine Spectator",  "WS"),
    ("wine_score_4", "wine_score_jamessuckling",  "James Suckling",  "JS"),
]


def parse_bare(v) -> int | None:
    """A bare integer score 50..100, or None. parse_points() can't read a raw int."""
    if is_empty_cell(v):
        return None
    try:
        n = int(str(v).strip())
    except (ValueError, TypeError):
        return None
    return n if 50 <= n <= 100 else None


def norm_vintage(v) -> str | None:
    """Normalize for the dedupe key: empty/'' -> None, else stripped string."""
    s = (v or "").strip()
    return s or None


def build_summary(critic_rows: list[dict]) -> tuple[float | None, str]:
    """Return (score_max, score_summary_json) for one SKU's critic rows."""
    critics = sorted(
        (
            {
                "abbr": r["abbr"],
                "critic": r["critic"],
                "score_native": r["score_native"],
                "score_value": r["score"],
            }
            for r in critic_rows
        ),
        key=lambda c: -c["score_value"],
    )[:5]
    score_max = max((c["score_value"] for c in critics), default=None)
    summary = {
        "critics": critics,
        "community": [],
        "medals": [],
        "primary_source": SOURCE_TAG,
        "rows_total": len(critic_rows),
        "computed_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    return score_max, json.dumps(summary, ensure_ascii=False)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--csv", default=DEFAULT_CSV)
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the pre-write backup (tests use this on a temp copy)")
    ap.add_argument("--dry-run", action="store_true",
                    help="parse + report, write nothing")
    args = ap.parse_args(argv)

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"ERROR: db not found: {db_path}", file=sys.stderr)
        return 1
    if not Path(args.csv).exists():
        print(f"ERROR: csv not found: {args.csv}", file=sys.stderr)
        return 1

    # Backup BEFORE opening for write (Rule 10). Skip on dry-run / --no-backup.
    if not args.no_backup and not args.dry_run:
        try:
            ckpt = sqlite3.connect(db_path)
            ckpt.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            ckpt.close()
        except Exception as e:
            print(f"warning: wal_checkpoint before backup failed ({e}); copying anyway")
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        bak = db_path.with_name(db_path.name + f".bak-pre-masterfile-scores-{ts}")
        shutil.copy(db_path, bak)
        print(f"backup: {bak}")

    conn = sqlite3.connect(db_path)
    db_skus = {r[0] for r in conn.execute("SELECT sku FROM products")}

    # (b) snapshot of EVERY existing (sku, critic, vintage) key from OTHER sources.
    # Exclude our own SOURCE_TAG rows: step (a) DELETEs them before re-insert, so
    # on a re-run they must NOT count as "already present" (else we'd skip every
    # row, delete the prior 61, and net to zero — non-idempotent).
    existing_keys: set[tuple] = set()
    for sku, critic, vintage in conn.execute(
        "SELECT sku, critic, vintage FROM critic_scores WHERE added_by IS NOT ?",
        (SOURCE_TAG,),
    ):
        existing_keys.add((sku, critic, norm_vintage(vintage)))

    rows, dups = load_masterfile(args.csv)
    if dups:
        print(f"masterfile: {len(dups)} duplicate SKU(s) collapsed (last wins)")

    loaded_at = (datetime.now(timezone.utc)
                 .isoformat(timespec="seconds").replace("+00:00", "Z"))

    by_sku: dict[str, list[dict]] = {}
    score_rows: list[tuple] = []
    conflicts: list[dict] = []
    orphan_skus: set[str] = set()
    parsed_total = 0
    skipped_dup = 0
    # Guard against re-skipping when a SKU lists the same critic twice in-batch.
    batch_keys: set[tuple] = set()

    for row in rows:
        sku = (row.get("sku") or "").strip()
        if not sku:
            continue
        vintage_raw = (row.get("vintage") or "").strip() or None
        vkey = norm_vintage(vintage_raw)

        for bare_col, html_col, critic_name, abbr in CRITICS:
            bare = parse_bare(row.get(bare_col))
            html_raw = row.get(html_col)
            html_pts = parse_points(html_raw)
            html_notes = None if is_empty_cell(html_raw) else (html_raw or "").strip()

            # Combined value: bare wins on conflict; else whichever exists.
            if bare is not None and html_pts is not None and bare != html_pts:
                conflicts.append({"sku": sku, "critic": critic_name,
                                  "bare": bare, "html": html_pts})
                score = bare
            elif bare is not None:
                score = bare
            elif html_pts is not None:
                score = html_pts
            else:
                continue  # neither slot has a usable score

            parsed_total += 1

            key = (sku, critic_name, vkey)
            if key in existing_keys or key in batch_keys:
                skipped_dup += 1
                continue
            batch_keys.add(key)

            score = float(score)
            notes = html_notes  # HTML prose -> notes + supporting_text when present
            row_id = str(uuid.uuid4())
            score_rows.append(
                # Columns named explicitly in the INSERT below — order matches THAT
                # list, not the physical table order.
                (row_id, sku, critic_name, score, 100.0, vintage_raw,
                 None, None, notes, SOURCE_TAG,
                 "mreport_masterfile", str(score_max_native(bare, html_pts)),
                 "100pt", "critic_numeric", 1, 1.0, notes, loaded_at)
            )
            by_sku.setdefault(sku, []).append(
                {"abbr": abbr, "critic": critic_name,
                 "score_native": str(int(score)), "score": score}
            )
            if sku not in db_skus:
                orphan_skus.add(sku)

    binding_skus = [s for s in by_sku if s in db_skus]
    print(f"Parsed {parsed_total} critic scores from masterfile "
          f"({len(conflicts)} bare/html conflicts).")
    print(f"  NEW after dedupe: {len(score_rows)} rows / {len(by_sku)} SKUs "
          f"(skipped {skipped_dup} already present in critic_scores)")
    print(f"  orphan (SKU not in products): "
          f"{sum(len(by_sku[s]) for s in orphan_skus)} rows / {len(orphan_skus)} SKUs")

    if args.dry_run:
        print("DRY RUN — nothing written.")
        return 0

    cur = conn.cursor()
    # (a) idempotent: clear any prior load from THIS source tag.
    deleted = cur.execute(
        "DELETE FROM critic_scores WHERE added_by = ?", (SOURCE_TAG,)
    ).rowcount
    if deleted:
        print(f"  cleared {deleted} prior rows tagged {SOURCE_TAG}")

    assert all(len(r) == 18 for r in score_rows), \
        "score_rows width != 18 — INSERT column/value mismatch"
    cur.executemany(
        """INSERT INTO critic_scores
           (id, sku, critic, score, score_max, vintage, tasting_year,
            source_url, notes, added_by,
            source, score_native, score_scale, signal_class, signal_tier,
            confidence, supporting_text, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)""",
        score_rows,
    )

    # NULL-only: recompute denormalized fields ONLY where score_max is empty.
    gained: list[str] = []
    for sku in binding_skus:
        cur_val = cur.execute(
            "SELECT score_max FROM products WHERE sku = ?", (sku,)
        ).fetchone()
        if cur_val is None:
            continue
        existing_max = cur_val[0]
        if existing_max is not None and str(existing_max).strip() != "":
            continue  # DB wins — do not overwrite a populated score_max
        score_max, summary = build_summary(by_sku[sku])
        cur.execute(
            "UPDATE products SET score_max = ?, score_summary = ? WHERE sku = ?",
            (score_max, summary, sku),
        )
        if cur.rowcount and score_max is not None:
            gained.append(sku)
    conn.commit()
    conn.close()

    print(f"Inserted {len(score_rows)} critic_scores rows; "
          f"filled score_max/score_summary on {len(gained)} products (NULL-only).")

    # Conflicts log (overwrite — describes this run's parse, deterministic).
    CONFLICTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFLICTS_PATH.write_text(json.dumps(conflicts, indent=2, ensure_ascii=False))
    print(f"wrote {CONFLICTS_PATH} ({len(conflicts)} conflicts)")

    # Merge gained SKUs into the shared filled-set under "score_max" (union).
    existing: dict = {}
    if FILLED_SKUS_PATH.exists():
        try:
            existing = json.loads(FILLED_SKUS_PATH.read_text())
        except Exception:
            existing = {}
    existing["score_max"] = sorted(set(existing.get("score_max", [])) | set(gained))
    FILLED_SKUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    FILLED_SKUS_PATH.write_text(json.dumps(existing, indent=2))
    print(f"wrote {FILLED_SKUS_PATH} (keys: {sorted(existing)})")
    return 0


def score_max_native(bare: int | None, html_pts: int | None) -> int:
    """The native value to record: bare wins, else html points."""
    return bare if bare is not None else html_pts


if __name__ == "__main__":
    raise SystemExit(main())
