import sqlite3, subprocess, sys, json
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "merge_phase_b_cache.py"

def _mkdb(p):
    # Real products table has all 5 taste cols; the merge now queries all of them
    # (Task 2 / FIX B), so the fixture must mirror the real schema. The extra 3 cols
    # are left NULL here — these tests only exercise variety/body behaviour.
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE products "
              "(sku TEXT, variety TEXT, body TEXT, acidity TEXT, tannin TEXT, sweetness TEXT)")
    c.executemany("INSERT INTO products (sku,variety,body) VALUES (?,?,?)", [
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


def _run(db, sidecar, *extra):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--db", db, "--sidecar", str(sidecar), *extra],
        capture_output=True, text=True)


def test_duplicate_sku_counts_agree_and_verify_line(tmp_path):
    """FIX A: a sku appearing twice in the sidecar must be counted ONCE, and the
    dry-run count must equal the applied count. FIX B: a post-write verify line
    (real SELECT before/after) must appear on --apply."""
    db = str(tmp_path / "p.db")
    _mkdb(db)
    sidecar = tmp_path / "sc.jsonl"
    # LWH1 (both NULL) appears TWICE — must count as 1 fill per field, not 2
    sidecar.write_text("\n".join(json.dumps(r) for r in [
        {"sku": "LWH1", "variety": "Bourbon", "body": "Medium"},
        {"sku": "LWH1", "variety": "Rye",     "body": "Full"},  # dup sku, last wins
    ]) + "\n")

    dry = _run(db, sidecar)
    assert dry.returncode == 0, dry.stderr
    apply = _run(db, sidecar, "--apply", "--ts", "test")
    assert apply.returncode == 0, apply.stderr

    # FIX A: dry-run and apply count the SAME unit — both report variety=1, body=1
    assert "variety=1" in dry.stdout and "body=1" in dry.stdout, dry.stdout
    assert "variety=1" in apply.stdout and "body=1" in apply.stdout, apply.stdout

    # last occurrence wins for the dup sku
    rows = dict((s, (v, b)) for s, v, b in
                sqlite3.connect(db).execute("SELECT sku,variety,body FROM products"))
    assert rows["LWH1"] == ("Rye", "Full")

    # FIX B: post-write verify line from a REAL SELECT against committed DB
    assert "verify (gross DB totals" in apply.stdout, apply.stdout
    assert "variety populated" in apply.stdout, apply.stdout
    # before 1 populated (LWH2), after 2 (LWH1 now filled); body before 1 (LWH3) after 2
    assert "variety populated 1 -> 2" in apply.stdout, apply.stdout
    assert "body populated 1 -> 2" in apply.stdout, apply.stdout

    # FIX C: Rule-9 reminder on --apply
    assert "refresh_live_export.py" in apply.stdout, apply.stdout


def _mkdb5(p):
    """Fixture DB with all 5 taste cols (Task 2 / FIX B)."""
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE products "
              "(sku TEXT, variety TEXT, body TEXT, acidity TEXT, tannin TEXT, sweetness TEXT)")
    c.executemany("INSERT INTO products VALUES (?,?,?,?,?,?)", [
        # A: only variety set -> variety preserved, other 4 fill
        ("A", "Single Malt", None, None, None, None),
        # B: body + acidity set -> those preserved, variety/tannin/sweetness fill
        ("B", None, "Full", "High", None, None),
    ]); c.commit(); c.close()


def test_merge_all_five_fields_nullonly(tmp_path):
    """Task 2 / FIX B: merge must apply ALL 5 taste fields NULL-only — the prior
    FIELDS=("variety","body") silently DROPPED paid acidity/tannin/sweetness
    ($56-class data-loss bug). Existing values must NOT be clobbered (Rule 5)."""
    db = str(tmp_path / "p.db")
    _mkdb5(db)
    sidecar = tmp_path / "sc.jsonl"
    sidecar.write_text("\n".join(json.dumps(r) for r in [
        {"sku": "A", "variety": "Blended", "body": "Medium",
         "acidity": "Low", "tannin": "Low", "sweetness": "Dry"},
        {"sku": "B", "variety": "Merlot", "body": "Light",
         "acidity": "Low", "tannin": "Medium", "sweetness": "Sweet"},
    ]) + "\n")
    r = _run(db, sidecar, "--apply", "--ts", "test")
    assert r.returncode == 0, r.stderr
    rows = dict((s, (v, b, ac, ta, sw)) for s, v, b, ac, ta, sw in
                sqlite3.connect(db).execute(
                    "SELECT sku,variety,body,acidity,tannin,sweetness FROM products"))

    # A: variety PRESERVED (Rule 5), the other 4 filled
    assert rows["A"][0] == "Single Malt"                       # NOT clobbered
    assert rows["A"][1:] == ("Medium", "Low", "Low", "Dry")    # filled

    # B: body + acidity PRESERVED, variety/tannin/sweetness filled
    assert rows["B"][1] == "Full"                              # body NOT clobbered
    assert rows["B"][2] == "High"                              # acidity NOT clobbered
    assert rows["B"][0] == "Merlot"                            # variety filled
    assert rows["B"][3] == "Medium"                            # tannin filled
    assert rows["B"][4] == "Sweet"                             # sweetness filled
