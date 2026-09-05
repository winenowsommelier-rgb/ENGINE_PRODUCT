import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
_CANDIDATE_DB = REPO / "data" / "db" / "products.db"

SCRIPT = REPO / "scripts" / "refresh_products_json.py"

# data/db/products.json is git-tracked in a PUBLIC repo (unlike products.db,
# which is gitignored) -- these fields must never appear in it. Found live
# 2026-09-05: refresh_products_json.py's DB_COLS explicitly included all of
# these, so every regeneration re-leaked them into a public, clonable file.
FORBIDDEN = {"cost", "margin_pct", "margin_thb", "b2b_margin_pct", "b2b_margin_thb"}


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
def products_json_export(tmp_path_factory):
    """Generate products.json once per session into a temp file (hermetic)."""
    out = tmp_path_factory.mktemp("export") / "products.json"
    subprocess.run(
        [sys.executable, str(SCRIPT), "--db", str(DB), "--out", str(out)],
        check=True,
    )
    return json.loads(out.read_text())


def test_no_forbidden_fields(products_json_export):
    for r in products_json_export:
        leaked = FORBIDDEN & set(r.keys())
        assert not leaked, f"leaked fields in {r.get('sku')}: {leaked}"


def test_committed_file_has_no_forbidden_fields():
    """The file actually sitting in git right now, not just what the script produces."""
    committed = json.loads((REPO / "data" / "db" / "products.json").read_text())
    sample = committed if isinstance(committed, list) else list(committed.values())
    for r in sample:
        leaked = FORBIDDEN & set(r.keys())
        assert not leaked, f"leaked fields in committed products.json {r.get('sku')}: {leaked}"
