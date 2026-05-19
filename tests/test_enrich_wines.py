"""Integration test for data/enrich_wines.py using the 5-SKU fixture."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DRIVER = REPO_ROOT / "data" / "enrich_wines.py"


def test_dry_run_succeeds_with_fixture():
    """--dry-run mode + --skus-file pointing at the fixture: no API call needed."""
    result = subprocess.run(
        [
            sys.executable, str(DRIVER),
            "--dry-run",
            "--skus-file", str(REPO_ROOT / "tests" / "fixtures" / "wine_pilot_skus.json"),
            "--winesensed-file", str(REPO_ROOT / "tests" / "fixtures" / "winesensed_sample.json"),
            "--brand-library-file", str(REPO_ROOT / "tests" / "fixtures" / "brand_library_sample.csv"),
            "--no-supabase",
            "--limit", "5",
        ],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    # Driver should print per-SKU dry-run lines + summary
    assert "FX-BORDEAUX-001" in result.stdout
    assert "would call Haiku" in result.stdout or "Cache hits" in result.stdout
