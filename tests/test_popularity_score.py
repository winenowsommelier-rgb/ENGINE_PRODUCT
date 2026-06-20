# tests/test_popularity_score.py
"""Unit tests for the popularity score fix (95th-percentile cap then min-max).

Regression guard: the pre-fix score was degenerate — a single ~673-qty outlier
pinned the min-max scale, median ≈ 0.0007, ~92% of rows < 0.1. The cap removes
the single-outlier pin so the score has a usable spread. See
docs/superpowers/specs/2026-06-17-bi-popularity-backfill-design.md.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "sync_pop", REPO / "data" / "sync_popularity_from_bi.py"
)
sync_pop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync_pop)


def test_outlier_does_not_pin_the_scale():
    # The real-world shape: a band of typical sellers WITH internal spread, plus
    # one extreme outlier that (pre-fix) pinned the min-max scale and crushed the
    # typical band toward zero. The fixture MUST give typical rows variation —
    # if every typical row were identical, min-max would (correctly) score them
    # all 0 and this test would be meaningless. Here typical orders span 1..40.
    rows = [
        {"qty": float(o), "orders": o, "revenue": float(o) * 100.0}
        for o in range(1, 41)  # 40 typical sellers, orders 1..40
    ]
    rows.append({"qty": 673.0, "orders": 400, "revenue": 673000.0})  # outlier
    sync_pop.compute_scores(rows)
    typical = [r["score"] for r in rows[:40]]
    median = sorted(typical)[len(typical) // 2]
    # Pre-fix (no cap): the 400-order outlier pins the scale and the typical
    # median lands near ~0.05. With the 95th-pctile cap the outlier is clipped
    # back to the top of the typical band, so the typical median lifts well up.
    assert median > 0.2, f"score still pinned by outlier (median={median})"

    # And the cap must NOT flatten everyone to one value — order must survive.
    scores = [r["score"] for r in rows[:40]]
    assert max(scores) > min(scores) + 0.3, "cap over-flattened the typical band"


def test_score_in_unit_range():
    rows = [
        {"qty": 5.0, "orders": 2, "revenue": 500.0},
        {"qty": 50.0, "orders": 20, "revenue": 5000.0},
        {"qty": 1.0, "orders": 1, "revenue": 100.0},
    ]
    sync_pop.compute_scores(rows)
    for r in rows:
        assert 0.0 <= r["score"] <= 1.0


def test_empty_rows_no_crash():
    rows = []
    sync_pop.compute_scores(rows)  # must not raise
    assert rows == []


def test_compute_scores_adds_bounded_float_score_to_every_row():
    rows = [
        {"qty": 5.0, "orders": 2, "revenue": 500.0},
        {"qty": 50.0, "orders": 20, "revenue": 5000.0},
    ]
    sync_pop.compute_scores(rows)
    for r in rows:
        assert "score" in r, "compute_scores must add a 'score' field to each row"
        assert isinstance(r["score"], float), f"score must be float, got {type(r['score'])}"
        assert 0.0 <= r["score"] <= 1.0, f"score out of [0,1]: {r['score']}"
        # round(...,6) is applied, so no more than 6 decimal places of precision
        assert round(r["score"], 6) == r["score"], "score must be rounded to 6 dp"
