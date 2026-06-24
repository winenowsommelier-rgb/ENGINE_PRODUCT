import sqlite3, subprocess, sys, shutil
from pathlib import Path
import pytest

FILLED_COLS = ["region", "subregion", "variety", "body", "acidity", "tannin",
               "food_matching", "country", "desc_en_short", "full_description", "designation"]


@pytest.mark.parametrize("col", FILLED_COLS)
def test_free_fill_never_overwrites_nonnull(tmp_path, col):
    src = Path("data/db/products.db")
    if not src.exists():
        pytest.skip("live db absent")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    before = {r[0]: r[1] for r in
              sqlite3.connect(db).execute(f"SELECT sku, {col} FROM products")}
    nonnull = {s: v for s, v in before.items() if v and str(v).strip()}
    subprocess.run([sys.executable, "scripts/masterfile_free_fill.py",
                    "--db", str(db), "--no-backup"], check=True)
    after = {r[0]: r[1] for r in
             sqlite3.connect(db).execute(f"SELECT sku, {col} FROM products")}
    for s, v in nonnull.items():
        assert after[s] == v, f"OVERWROTE curated {col} for {s}: {v} -> {after[s]}"


def test_filled_skus_json_survives_rerun(tmp_path, monkeypatch):
    src = Path("data/db/products.db")
    if not src.exists():
        pytest.skip("live db absent")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    import json
    j = Path("data/masterfile_filled_skus.json")
    saved = j.read_text() if j.exists() else None
    try:
        # run once
        subprocess.run([sys.executable, "scripts/masterfile_free_fill.py",
                        "--db", str(db), "--no-backup"], check=True, cwd=".")
        first = json.loads(j.read_text())
        first_designation = list(first.get("designation", []))
        assert first_designation, "run 1 should have filled some designations"
        # run again (idempotent — fills 0)
        subprocess.run([sys.executable, "scripts/masterfile_free_fill.py",
                        "--db", str(db), "--no-backup"], check=True, cwd=".")
        second = json.loads(j.read_text())
        assert list(second.get("designation", [])) == first_designation, \
            "re-run clobbered the run-1 filled-SKU list"
    finally:
        # restore/clean the regenerable repo artifact to avoid leaving stale state
        if saved is not None:
            j.write_text(saved)
        elif j.exists():
            j.unlink()
