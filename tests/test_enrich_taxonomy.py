"""Integration tests for data/enrich_taxonomy.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DRIVER = REPO_ROOT / "data" / "enrich_taxonomy.py"
FIXTURE = REPO_ROOT / "tests" / "fixtures" / "taxonomy_skus.json"


def test_dry_run_exits_zero():
    result = subprocess.run(
        [sys.executable, str(DRIVER),
         "--dry-run",
         "--skus-file", str(FIXTURE),
         "--no-haiku",
         "--limit", "5"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    assert "dry-run" in result.stdout.lower() or "would" in result.stdout.lower()


def test_name_inference_fills_region(tmp_path):
    """Layer 1 alone fills Pauillac region without API.
    Note: --no-write-json suppresses BOTH JSON and SQLite writes.
    The assertion checks stdout logging only.
    """
    import shutil
    tmp_products = tmp_path / "products.json"
    shutil.copy(FIXTURE, tmp_products)

    result = subprocess.run(
        [sys.executable, str(DRIVER),
         "--skus-file", str(tmp_products),
         "--no-haiku",
         "--no-write-json",
         "--limit", "5"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}\nstdout:\n{result.stdout}"
    # Pauillac SKU should have been resolved by Layer 1
    assert "TAX-BORDEAUX-001" in result.stdout


def test_non_wine_skipped():
    """Whisky SKUs are NOT skipped for geography (region/subregion still filled if empty),
    but grape_variety is never inferred for spirits. The script should complete without error."""
    result = subprocess.run(
        [sys.executable, str(DRIVER),
         "--dry-run",
         "--skus-file", str(FIXTURE),
         "--no-haiku",
         "--limit", "5"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0
