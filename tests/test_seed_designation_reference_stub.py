import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATE = REPO_ROOT / "scripts" / "migrate_dossier_schema.py"
SEED = REPO_ROOT / "scripts" / "seed_designation_reference_stub.py"


def test_seed_creates_key_only_rows(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run([sys.executable, str(MIGRATE), "--db", str(db_path)], check=True, capture_output=True, text=True)
    subprocess.run([sys.executable, str(SEED), "--db", str(db_path)], check=True, capture_output=True, text=True)
    conn = sqlite3.connect(db_path)
    n = conn.execute("SELECT COUNT(*) FROM designation_reference").fetchone()[0]
    assert n > 0
    # explainer is intentionally NULL -- later content-authoring fills it in, not this task
    row = conn.execute("SELECT explainer FROM designation_reference LIMIT 1").fetchone()
    assert row[0] is None
