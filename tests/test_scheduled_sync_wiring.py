"""Regression guard: scheduled_sync.sh (launchd daily 03:00) must call
compute_reputation.py. Without this, reputation tiers only ever update on
new-product onboarding, never for existing SKUs' sold_qty/acclaim drift —
see memory project_reputation_v1_expert_review, finding #5.
"""
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "scheduled_sync.sh"


def test_scheduled_sync_calls_compute_reputation():
    src = SCRIPT.read_text()
    assert "compute_reputation.py" in src


def test_reputation_recompute_runs_after_live_export_refresh():
    """Order matters: compute_reputation.py writes its own live export, so it
    must run after refresh_live_export.py, not before (else its export gets
    overwritten by a stale recompute)."""
    src = SCRIPT.read_text()
    export_pos = src.find("refresh_live_export.py")
    reputation_pos = src.find("compute_reputation.py")
    assert export_pos != -1 and reputation_pos != -1
    assert export_pos < reputation_pos
