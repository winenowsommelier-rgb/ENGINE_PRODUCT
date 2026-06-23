"""All-sources merge: critic_scores -> products.score_max/score_summary (spec §16).

Reads EVERY critic_scores row, applies source precedence (curated beats scraped),
and full-re-derives the denormalized fields for every SKU with >=1 row. Pure-local,
NO API spend. Per Rule 9 the caller must run scripts/refresh_live_export.py after.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

BADGE_CONFIDENCE_FLOOR = 0.5   # spec §16: confidence < 0.5 excluded from badge
MAX_CRITICS = 5                # spec §6: 5-entry cap
SCORE_MAX_TIERS = {1, 2}       # spec §16: score_max from tier<=2 numeric only

# Canonical critic -> abbr (source of truth = loader CRITICS table). abbr is NOT a
# column on critic_scores, so it MUST be derived here, never from critic[:2].
CRITIC_ABBR = {
    "Wine Enthusiast": "WE",
    "Wine Advocate":   "WA",
    "Wine Spectator":  "WS",
    "James Suckling":  "JS",
}


def abbr_for(critic: str) -> str:
    """Canonical abbr; for an unknown future critic, first letter of each
    capitalized word (e.g. 'James Suckling' -> 'JS'), NEVER critic[:2]."""
    if critic in CRITIC_ABBR:
        return CRITIC_ABBR[critic]
    initials = "".join(w[0] for w in critic.split() if w and w[0].isupper())
    return (initials or critic[:2]).upper()


def _precedence_key(r: dict) -> tuple:
    # higher confidence, then more recent fetched_at, then lower tier, then higher score
    return (
        r.get("confidence") or 0.0,
        r.get("fetched_at") or "",
        -(r.get("signal_tier") or 99),
        r.get("score") or 0.0,
    )


def merge_for_sku(rows: list[dict]) -> list[dict]:
    """Collapse multi-source rows to one winner per (critic, score_scale), drop
    confidence < 0.5, then apply the §6 second dedup on (critic, score_native).
    Returns the winning rows (unsorted)."""
    eligible = [r for r in rows if (r.get("confidence") or 0.0) >= BADGE_CONFIDENCE_FLOOR]
    # step 1: §16 precedence collapse per (critic, score_scale)
    by_scale: dict[tuple, dict] = {}
    for r in eligible:
        key = (r["critic"], r.get("score_scale"))
        cur = by_scale.get(key)
        if cur is None or _precedence_key(r) > _precedence_key(cur):
            by_scale[key] = r
    # step 2: §6 rule-2 dedup on (critic, score_native) — keep highest-precedence
    by_native: dict[tuple, dict] = {}
    for r in by_scale.values():
        key = (r["critic"], r.get("score_native"))
        cur = by_native.get(key)
        if cur is None or _precedence_key(r) > _precedence_key(cur):
            by_native[key] = r
    return list(by_native.values())


def _primary_source(winners: list[dict]) -> str | None:
    """The dated added_by tag preserves the current value (magento_csv_2026-06-15);
    fall back to the source column for feeds with no added_by (scraper rows)."""
    tags = [w.get("added_by") for w in winners if w.get("added_by")]
    if tags:
        return sorted(tags)[0]
    sources = [w.get("source") for w in winners if w.get("source")]
    return sorted(sources)[0] if sources else None


def build_summary(winners: list[dict]) -> tuple[float | None, str | None]:
    """From precedence winners, build (score_max, score_summary_json) in the shape
    consumers expect. abbr is derived from the canonical map (NEVER critic[:2]).
    rows_total = number of badge entries (post-merge winners).
    Returns (None, None) when there are no badge-eligible rows."""
    if not winners:
        return None, None
    critics = sorted(
        ({"abbr": abbr_for(w["critic"]),
          "critic": w["critic"],
          "score_native": w.get("score_native") or "",
          "score_value": float(w["score"])}
         for w in winners),
        key=lambda c: -c["score_value"],
    )[:MAX_CRITICS]
    numeric_tier12 = [
        w["score"] for w in winners
        if (w.get("signal_tier") in SCORE_MAX_TIERS)
        and (w.get("score_scale") or "").endswith("pt")
    ]
    score_max = max(numeric_tier12) if numeric_tier12 else None
    summary = {
        "critics": critics,
        "community": [],
        "medals": [],
        "primary_source": _primary_source(winners),
        "rows_total": len(winners),
        "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    return score_max, json.dumps(summary, ensure_ascii=False)


_SELECT_ALL = """
SELECT sku, critic, score, source, score_native, score_scale,
       signal_class, signal_tier, confidence, fetched_at, added_by
FROM critic_scores
WHERE sku IS NOT NULL AND sku != ''
"""


def refresh_all(conn: sqlite3.Connection) -> int:
    """Full re-derive: for every SKU with >=1 bound critic_scores row, recompute
    score_max/score_summary via §16 precedence; reset SKUs with no rows to NULL.
    Self-healing. Returns the number of SKUs written with a non-NULL summary."""
    rows_by_sku: dict[str, list[dict]] = {}
    for r in conn.execute(_SELECT_ALL):
        d = {"sku": r[0], "critic": r[1], "score": r[2], "source": r[3],
             "score_native": r[4], "score_scale": r[5], "signal_class": r[6],
             "signal_tier": r[7], "confidence": r[8], "fetched_at": r[9],
             "added_by": r[10]}
        rows_by_sku.setdefault(r[0], []).append(d)

    # 1) reset every product that currently has a summary but no rows (self-heal)
    conn.execute(
        "UPDATE products SET score_max = NULL, score_summary = NULL "
        "WHERE (score_summary IS NOT NULL OR score_max IS NOT NULL) "
        "AND sku NOT IN (SELECT DISTINCT sku FROM critic_scores WHERE sku IS NOT NULL AND sku != '')"
    )
    # 2) recompute for every SKU that has rows
    written = 0
    for sku, rows in rows_by_sku.items():
        winners = merge_for_sku(rows)
        score_max, summary = build_summary(winners)
        cur = conn.execute(
            "UPDATE products SET score_max = ?, score_summary = ? WHERE sku = ?",
            (score_max, summary, sku),
        )
        # Rule 4: only count rows that actually updated a product row. ~81 critic
        # SKUs bind to SKUs not present in products (rowcount==0); they must not
        # inflate the "shipped" count (would print 1631 instead of the true 1550).
        if summary is not None and cur.rowcount > 0:
            written += 1
    conn.commit()
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Re-derive products.score_max/score_summary from all critic_scores sources (§16).")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args(argv)
    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1
    conn = sqlite3.connect(args.db)
    n = refresh_all(conn)
    print(f"Re-derived score_max/score_summary for {n} products with badge-eligible critic scores.")
    print("Rule 9: now run  .venv/bin/python scripts/refresh_live_export.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
