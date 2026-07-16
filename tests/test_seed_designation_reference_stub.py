import json
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATE = REPO_ROOT / "scripts" / "migrate_dossier_schema.py"
SEED = REPO_ROOT / "scripts" / "seed_designation_reference_stub.py"
MASTER = REPO_ROOT / "data" / "taxonomy" / "classification_master.json"


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


def test_seed_scoped_to_wine_only(tmp_path):
    # Regression guard: an earlier version of the seed script inserted all 78
    # active classification_master.json rows unfiltered, including 39
    # spirits/sake designations (Phase 2/3 addendum, not in scope yet) and 12
    # non-designation rows (glassware/wine_fridge/cigar/marketing-tier values
    # that share the file via other category_scope values). v1 is wine-only.
    db_path = tmp_path / "dossier.db"
    subprocess.run([sys.executable, str(MIGRATE), "--db", str(db_path)], check=True, capture_output=True, text=True)
    subprocess.run([sys.executable, str(SEED), "--db", str(db_path)], check=True, capture_output=True, text=True)

    master = json.loads(MASTER.read_text())
    wine_designations = {
        r["classification"]
        for r in master["data"]
        if r.get("is_active", 1) and r.get("category_scope") == "wine"
    }
    non_wine_designations = {
        r["classification"]
        for r in master["data"]
        if r.get("is_active", 1) and r.get("category_scope") != "wine"
    }

    conn = sqlite3.connect(db_path)
    seeded = {row[0] for row in conn.execute("SELECT designation FROM designation_reference")}

    assert seeded == wine_designations
    assert len(seeded) == 27  # verified against classification_master.json 2026-07-16
    assert not (seeded & non_wine_designations)
