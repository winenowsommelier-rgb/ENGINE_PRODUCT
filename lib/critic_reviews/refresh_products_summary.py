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
