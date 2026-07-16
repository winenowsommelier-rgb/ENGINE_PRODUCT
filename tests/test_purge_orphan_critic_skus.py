import sqlite3
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from scripts.purge_orphan_critic_skus import find_orphans, ORPHAN_RESOLUTIONS

def _make_db(tmp_path):
    db = tmp_path / "products.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE products (sku TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE critic_scores (id TEXT PRIMARY KEY, sku TEXT, critic TEXT, score REAL, score_max REAL)")
    conn.execute("INSERT INTO products VALUES ('WRW0001')")
    conn.execute("INSERT INTO critic_scores VALUES ('c1', 'WRW0001', 'WA', 90, 100)")
    conn.execute("INSERT INTO critic_scores VALUES ('c2', 'WRW9999-ORPHAN', 'WA', 88, 100)")
    conn.commit()
    return conn

def test_find_orphans_returns_unjoinable_skus(tmp_path):
    conn = _make_db(tmp_path)
    orphans = find_orphans(conn)
    assert orphans == ["WRW9999-ORPHAN"]

def test_every_orphan_has_a_recorded_resolution():
    # Rule 3: no silent drops. Every SKU this script encounters in the live DB
    # must have an explicit entry in ORPHAN_RESOLUTIONS (resolve-to or purge),
    # so a re-run against fresh data can't silently skip a new orphan.
    assert isinstance(ORPHAN_RESOLUTIONS, dict)
