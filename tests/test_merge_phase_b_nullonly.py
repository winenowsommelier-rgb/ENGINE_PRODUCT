import sqlite3, subprocess, sys, json
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "merge_phase_b_cache.py"

def _mkdb(p):
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE products (sku TEXT, variety TEXT, body TEXT)")
    c.executemany("INSERT INTO products VALUES (?,?,?)", [
        ("LWH1", None, None),                 # both empty -> both fill
        ("LWH2", "Single Malt", None),        # variety SET -> must be PRESERVED
        ("LWH3", "", "Full"),                 # body SET -> must be PRESERVED
    ]); c.commit(); c.close()

def test_merge_is_null_only(tmp_path):
    db = str(tmp_path / "p.db")
    _mkdb(db)
    sidecar = tmp_path / "sc.jsonl"
    sidecar.write_text("\n".join(json.dumps(r) for r in [
        {"sku": "LWH1", "variety": "Bourbon", "body": "Medium"},
        {"sku": "LWH2", "variety": "Blended", "body": "Light"},   # variety must NOT overwrite
        {"sku": "LWH3", "variety": "Rye",     "body": "Light"},   # body must NOT overwrite
    ]) + "\n")
    r = subprocess.run([sys.executable, str(SCRIPT), "--db", db,
                        "--sidecar", str(sidecar), "--apply", "--ts", "test"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    rows = dict((s, (v, b)) for s, v, b in
                sqlite3.connect(db).execute("SELECT sku,variety,body FROM products"))
    assert rows["LWH1"] == ("Bourbon", "Medium")   # filled from empty
    assert rows["LWH2"][0] == "Single Malt"        # PRESERVED, not 'Blended'
    assert rows["LWH3"][1] == "Full"               # PRESERVED, not 'Light'
    assert rows["LWH3"][0] == "Rye"                # empty-string variety DID fill
