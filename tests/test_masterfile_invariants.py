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


# ---------------------------------------------------------------------------
# Task 4 — masterfile score ingest (scripts/masterfile_ingest_scores.py)
# ---------------------------------------------------------------------------

def _pick_masterfile_scored_sku():
    """A SKU that is in products AND has >=1 non-empty named-critic OR bare score."""
    sys.path.insert(0, ".")
    from scripts.masterfile_lib import load_masterfile, is_empty_cell
    src = Path("data/db/products.db")
    if not src.exists():
        return None
    db_skus = {r[0] for r in sqlite3.connect(src).execute("SELECT sku FROM products")}
    rows, _ = load_masterfile(
        "/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/"
        "Masterfile Data WNLQ9 - MReport Masterfile.csv"
    )
    cols = ["wine_score_1", "wine_score_2", "wine_score_3", "wine_score_4",
            "wine_score_wineenthusiast", "wine_score_wineadvocate",
            "wine_score_winespectator", "wine_score_jamessuckling"]
    for r in rows:
        sku = (r.get("sku") or "").strip()
        if sku not in db_skus:
            continue
        if any(not is_empty_cell(r.get(c)) for c in cols):
            return sku
    return None


def test_score_no_cross_source_duplicate(tmp_path):
    src = Path("data/db/products.db")
    if not src.exists():
        pytest.skip("live db absent")
    sku = _pick_masterfile_scored_sku()
    if not sku:
        pytest.skip("no scored sku found in masterfile")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    conn = sqlite3.connect(db)
    # Remove any existing Wine Advocate rows for this sku, then plant a curated row.
    conn.execute("DELETE FROM critic_scores WHERE sku=? AND critic=?",
                 (sku, "Wine Advocate"))
    conn.execute(
        "INSERT INTO critic_scores (id, sku, critic, score, score_max, vintage, "
        "added_by, source) VALUES (?,?,?,?,?,?,?,?)",
        ("curated-test-row", sku, "Wine Advocate", 88.0, 100.0, None,
         "curated_other", "human"),
    )
    conn.commit(); conn.close()

    subprocess.run([sys.executable, "scripts/masterfile_ingest_scores.py",
                    "--db", str(db), "--no-backup"], check=True, cwd=".")

    conn = sqlite3.connect(db)
    n = conn.execute(
        "SELECT COUNT(*) FROM critic_scores WHERE sku=? AND critic=? "
        "AND vintage IS NULL", (sku, "Wine Advocate")).fetchone()[0]
    scores = [r[0] for r in conn.execute(
        "SELECT score FROM critic_scores WHERE sku=? AND critic=? "
        "AND vintage IS NULL", (sku, "Wine Advocate"))]
    conn.close()
    assert n == 1, f"cross-source duplicate: {n} Wine Advocate rows for {sku}"
    assert scores == [88.0], f"curated score should survive, got {scores}"


def test_score_dedupe_idempotent(tmp_path):
    src = Path("data/db/products.db")
    if not src.exists():
        pytest.skip("live db absent")
    db = tmp_path / "t.db"; shutil.copy(src, db)

    def count():
        return sqlite3.connect(db).execute(
            "SELECT COUNT(*) FROM critic_scores").fetchone()[0]

    subprocess.run([sys.executable, "scripts/masterfile_ingest_scores.py",
                    "--db", str(db), "--no-backup"], check=True, cwd=".")
    after1 = count()
    subprocess.run([sys.executable, "scripts/masterfile_ingest_scores.py",
                    "--db", str(db), "--no-backup"], check=True, cwd=".")
    after2 = count()
    assert after1 == after2, f"non-idempotent: run1={after1} run2={after2}"


def test_score_summary_null_only(tmp_path):
    src = Path("data/db/products.db")
    if not src.exists():
        pytest.skip("live db absent")
    sku = _pick_masterfile_scored_sku()
    if not sku:
        pytest.skip("no scored sku found in masterfile")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    conn = sqlite3.connect(db)
    conn.execute("UPDATE products SET score_max=99.0 WHERE sku=?", (sku,))
    conn.commit(); conn.close()

    subprocess.run([sys.executable, "scripts/masterfile_ingest_scores.py",
                    "--db", str(db), "--no-backup"], check=True, cwd=".")

    val = sqlite3.connect(db).execute(
        "SELECT score_max FROM products WHERE sku=?", (sku,)).fetchone()[0]
    assert val == 99.0, f"NULL-only violated: score_max {sku} = {val}, expected 99.0"
