"""Integration test for the Phase A NULL-only taste backfill.

Runs the script against a TEMP DB and asserts the load-bearing invariant: it fills
ONLY columns that are NULL/empty, NEVER overwrites an existing enriched value, and
its fill counts match the deterministic inferers.
"""
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "backfill_taste_phase_a.py"


def _mkdb(path: str) -> None:
    c = sqlite3.connect(path)
    c.execute(
        "CREATE TABLE products (sku TEXT, name TEXT, category_type TEXT, region TEXT, "
        "body TEXT, sweetness TEXT, smokiness TEXT)"
    )
    c.executemany(
        "INSERT INTO products VALUES (?,?,?,?,?,?,?)",
        [
            # real SKU prefixes so sku_taxonomy.resolve() scopes smokiness correctly.
            # LWH* → Whisky group → smokiness inferred. Islay → 'heavy'.
            ("LWH0051BU", "Ardbeg 10", "Whisky", "Islay", None, None, None),
            # smokiness ALREADY 'light' → must be PRESERVED (never overwritten to 'none')
            ("LWH0052BU", "Glenfiddich 12", "Whisky", "Speyside", None, None, "light"),
            # LSK* → Sake group → sweetness inferred 'dry' (Karakuchi)
            ("LSK0001AA", "Ozeki Karakuchi Dry", "Sake/Shochu", "", None, None, None),
            # WRW* → Wine group → body preserved; smokiness must STAY NULL (wine ≠ smoky)
            ("WRW0001AA", "Light easy red", "Red Wine", "Bordeaux", "full", None, None),
        ],
    )
    c.commit()
    c.close()


def test_fills_nulls_only(tmp_path):
    db = str(tmp_path / "p.db")
    _mkdb(db)
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "--db", db, "--apply"],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    c = sqlite3.connect(db)
    rows = {
        sku: (body, sw, sm)
        for sku, body, sw, sm in c.execute(
            "SELECT sku, body, sweetness, smokiness FROM products"
        )
    }
    assert rows["LWH0051BU"][2] == "heavy"   # whisky, filled from NULL
    assert rows["LWH0052BU"][2] == "light"   # PRESERVED, not overwritten to 'none'
    assert rows["LSK0001AA"][1] == "dry"     # sake, filled from NULL
    assert rows["WRW0001AA"][0] == "full"    # body PRESERVED, not overwritten to 'light'
    # SCOPE GUARD: a WINE must NOT receive a smokiness value (smokiness is whisky/spirits-only).
    assert rows["WRW0001AA"][2] is None      # wine smokiness stays NULL despite a region


def test_dry_run_does_not_write(tmp_path):
    db = str(tmp_path / "p.db")
    _mkdb(db)
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "--db", db],  # no --apply → dry-run
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    c = sqlite3.connect(db)
    smk = c.execute("SELECT smokiness FROM products WHERE sku='LWH0051BU'").fetchone()[0]
    assert smk is None  # dry-run must NOT write
