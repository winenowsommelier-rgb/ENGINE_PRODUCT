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


def test_reputation_recompute_runs_before_supabase_sync():
    """Order matters, the OPPOSITE way from an earlier draft of this test:
    compute_reputation.py must run BEFORE sync_to_supabase.py, not after.
    Automated review on PR #134 caught that running it last meant a
    same-night tier change never reached that night's Supabase push or
    Drive bundle -- both had already run against the pre-recompute state.
    compute_reputation.py also writes its own live_products_export.json
    internally (phase3_verify_and_export), so it doesn't need
    refresh_live_export.py to run first for its own correctness either."""
    src = SCRIPT.read_text()
    sync_pos = src.find("sync_to_supabase.py")
    reputation_pos = src.find("compute_reputation.py")
    assert sync_pos != -1 and reputation_pos != -1
    assert reputation_pos < sync_pos


def test_reputation_recompute_runs_before_drive_bundle():
    """Same reasoning as above, for the Drive export bundle consumer."""
    src = SCRIPT.read_text()
    drive_pos = src.find("export_drive_bundle.py")
    reputation_pos = src.find("compute_reputation.py")
    assert drive_pos != -1 and reputation_pos != -1
    assert reputation_pos < drive_pos
