import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
_CANDIDATE_DB = REPO / "data" / "db" / "products.db"

SCRIPT = REPO / "scripts" / "refresh_b2b_export.py"

FORBIDDEN = {
    "cost", "margin_pct", "b2b_margin_pct", "b2b_margin_thb",
    "price", "special_price", "sp_discount_pct", "b2b_discount_pct",
}


def _resolve_db(path: Path) -> Path:
    """Resolve the real DB path — handles 0-byte git-worktree placeholders."""
    if path.exists() and path.stat().st_size > 0:
        return path
    result = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"],
        capture_output=True, text=True, cwd=path.parent,
    )
    if result.returncode == 0:
        main_db = Path(result.stdout.strip()).parent / "data" / "db" / "products.db"
        if main_db.exists() and main_db.stat().st_size > 0:
            return main_db
    return path  # let sqlite3 raise a useful error


DB = _resolve_db(_CANDIDATE_DB)


@pytest.fixture(scope="session")
def b2b_export(tmp_path_factory):
    """Generate the B2B export once per session into a temp file (hermetic)."""
    out = tmp_path_factory.mktemp("export") / "b2b_products_export.json"
    subprocess.run(
        [sys.executable, str(SCRIPT), "--out", str(out)],
        check=True,
    )
    return json.loads(out.read_text())


def test_rowcount_matches_db(b2b_export):
    con = sqlite3.connect(DB)
    (n,) = con.execute(
        "SELECT COUNT(*) FROM products WHERE b2b_price IS NOT NULL"
    ).fetchone()
    assert len(b2b_export) == n


def test_every_row_has_numeric_b2b_price(b2b_export):
    for r in b2b_export:
        assert isinstance(r.get("b2b_price"), (int, float)), f"bad row: {r.get('sku')}"


def test_no_forbidden_fields(b2b_export):
    for r in b2b_export:
        leaked = FORBIDDEN & set(r.keys())
        assert not leaked, f"leaked fields in {r.get('sku')}: {leaked}"


def test_has_score_summary_column(b2b_export):
    """Critic pill requires score_summary; verify at least one row carries it."""
    has_score = [r for r in b2b_export if r.get("score_summary")]
    assert has_score, "No rows have score_summary — critic pill will be empty"


def test_public_export_has_no_b2b_price():
    """Public export must NEVER contain b2b_price."""
    pub = json.loads((REPO / "data" / "live_products_export.json").read_text())
    sample = pub if isinstance(pub, list) else list(pub.values())
    for r in sample[:500]:
        assert "b2b_price" not in r, "b2b_price leaked into public export!"
