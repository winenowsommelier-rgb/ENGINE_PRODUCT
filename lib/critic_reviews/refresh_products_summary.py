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
