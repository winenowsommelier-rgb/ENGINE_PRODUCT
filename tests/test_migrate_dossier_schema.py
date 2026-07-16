import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATE = REPO_ROOT / "scripts" / "migrate_dossier_schema.py"

def test_migration_creates_all_five_tables(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run(
        [sys.executable, str(MIGRATE), "--db", str(db_path)],
        check=True, capture_output=True, text=True,
    )
    conn = sqlite3.connect(db_path)
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert {"wine_dossier", "sku_dossier_overlay", "designation_reference",
            "dossier_runs", "dossier_staging"} <= tables

def test_migration_is_idempotent(tmp_path):
    db_path = tmp_path / "dossier.db"
    for _ in range(2):
        subprocess.run(
            [sys.executable, str(MIGRATE), "--db", str(db_path)],
            check=True, capture_output=True, text=True,
        )
    conn = sqlite3.connect(db_path)
    # still exactly one of each table, no "table already exists" crash
    n = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wine_dossier'"
    ).fetchone()[0]
    assert n == 1

def test_json_columns_reject_invalid_json(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run(
        [sys.executable, str(MIGRATE), "--db", str(db_path)],
        check=True, capture_output=True, text=True,
    )
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    import pytest
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO wine_dossier (wine_key, signature_pairings_json) "
            "VALUES ('x', 'not json')"
        )

def test_staging_rejected_rows_are_distinct_from_applied(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run(
        [sys.executable, str(MIGRATE), "--db", str(db_path)],
        check=True, capture_output=True, text=True,
    )
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO dossier_staging (wine_key, run_id, validation_status) "
        "VALUES ('x', 'r1', 'rejected')"
    )
    conn.commit()
    row = conn.execute(
        "SELECT validation_status FROM dossier_staging WHERE wine_key='x'"
    ).fetchone()
    assert row[0] == "rejected"
