import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "refresh_products_json.py"

# data/db/products.json is git-tracked in a PUBLIC repo (unlike products.db,
# which is gitignored) -- these fields must never appear in it. Found live
# 2026-09-05: refresh_products_json.py's DB_COLS explicitly included all of
# these, so every regeneration re-leaked them into a public, clonable file.
FORBIDDEN = {"cost", "margin_pct", "margin_thb", "b2b_margin_pct", "b2b_margin_thb"}


def _make_db(path: Path) -> None:
    """Minimal synthetic products.db -- does NOT depend on the real,
    gitignored data/db/products.db, which is absent in a clean checkout/CI
    runner (found via automated review on this PR: the old git-worktree
    fallback only worked because this session happened to have a sibling
    main checkout with the real DB present). Includes all 5 FORBIDDEN
    columns WITH values so this test proves they're excluded from output
    despite being present in the source, not merely absent from the schema.
    """
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE products (id TEXT, sku TEXT, name TEXT, price REAL, "
        "cost REAL, margin_pct REAL, margin_thb REAL, "
        "b2b_margin_pct REAL, b2b_margin_thb REAL, b2b_price REAL)"
    )
    conn.execute(
        "INSERT INTO products (id, sku, name, price, cost, margin_pct, "
        "margin_thb, b2b_margin_pct, b2b_margin_thb, b2b_price) "
        "VALUES ('row-1','WRW0001','Test Wine',500.0,300.0,40.0,200.0,35.0,175.0,450.0)"
    )
    conn.commit()
    conn.close()


@pytest.fixture(scope="session")
def products_json_export(tmp_path_factory):
    """Generate products.json once per session into a temp file (hermetic)."""
    tmp = tmp_path_factory.mktemp("export")
    db = tmp / "products.db"
    out = tmp / "products.json"
    _make_db(db)
    subprocess.run(
        [sys.executable, str(SCRIPT), "--db", str(db), "--out", str(out)],
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
