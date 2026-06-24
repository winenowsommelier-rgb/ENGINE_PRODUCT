from scripts.masterfile_lib import (
    normalize_variety, parse_points, extract_designation, is_empty_cell,
)

def test_normalize_variety_strips_100pct():
    assert normalize_variety("100% Chardonnay") == "Chardonnay"
    assert normalize_variety("Chardonnay 100%") == "Chardonnay"
    assert normalize_variety("100%Chardonnay") == "Chardonnay"
    assert normalize_variety("Chardonnay (100%)") == "Chardonnay"

def test_normalize_variety_preserves_blends():
    assert normalize_variety("60% Cabernet / 40% Merlot") == "60% Cabernet / 40% Merlot"
    assert normalize_variety("Blended") == "Blended"

def test_parse_points_handles_points_word_and_bare_critic():
    assert parse_points("<p><strong>92 points James Suckling</strong></p>") == 92
    assert parse_points("91 James Suckling - \"Violets...\"") == 91   # no 'points' word
    assert parse_points("<p>&nbsp;</p>") is None                      # empty shell

def test_is_empty_cell():
    for v in ("", "-", "–", "—", "N/A", None):
        assert is_empty_cell(v) is True
    assert is_empty_cell("92") is False

def test_is_empty_cell_handles_non_string():
    assert is_empty_cell(92) is False
    assert is_empty_cell(92.0) is False
    assert is_empty_cell(0) is False          # 0 is a real value, not empty
    # floats/ints never crash

def test_extract_designation_gated_by_type():
    # Brut on a wine → designation; Brut on a beer → None (Kriek beer landmine)
    assert extract_designation("Pol Roger Brut Reserve", "Champagne") == "Brut"
    assert extract_designation("Liefmans Kriek Brut 330ml", "Beer") is None
    assert extract_designation("Barolo DOCG 2016", "Red Wine") == "DOCG"
    assert extract_designation("Hennessy XO", "Brandy") == "XO"

def test_parse_points_rejects_out_of_range():
    assert parse_points("914 points Wine Spectator") is None   # typo, not 914
    assert parse_points("2016 points") is None                 # 4-digit vintage noise
    assert parse_points("208 points") is None
    # valid range still works, incl the "Point by" form
    assert parse_points("95 Point by James Suckling") == 95
    assert parse_points("100 points Wine Advocate") == 100
    assert parse_points("50 points") == 50

def test_load_masterfile_utf8(tmp_path):
    import csv
    from scripts.masterfile_lib import load_masterfile
    p = tmp_path / "m.csv"
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["sku","name"]); w.writerow(["X1","St-Rémy Grosses Gewächs"])
    rows, dups = load_masterfile(str(p))
    assert rows[0]["name"] == "St-Rémy Grosses Gewächs"

def test_extract_designation_substring_landmine():
    # 'doc' inside "Doctor's" must NOT match (word boundary); whole name has no token → None
    assert extract_designation("The Doctor's Cuvee", "Red Wine") is None
    # real substring abutting punctuation: token next to comma/paren MUST still match
    assert extract_designation("Rioja (Gran Reserva), 2015", "Red Wine") == "Gran Reserva"
    assert extract_designation("Chablis 1er Cru, Vaillons", "White Wine") == "1er Cru"
    # longest-token-wins: 'Grand Cru' beats a bare 'Cru'
    assert extract_designation("Corton Grand Cru", "Red Wine") == "Grand Cru"


def test_gap_report_is_readonly_and_complete(tmp_path):
    import subprocess, sqlite3, json, sys
    from pathlib import Path
    db = Path("data/db/products.db")
    if not db.exists():
        import pytest; pytest.skip("live db absent")
    before = db.stat().st_mtime
    out = tmp_path / "rep.json"
    r = subprocess.run([sys.executable, "scripts/masterfile_gap_report.py",
                        "--db", str(db), "--out", str(out)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert db.stat().st_mtime == before, "gap report MUST NOT touch the DB"
    rep = json.loads(out.read_text())
    for sect in ("sku_reconciliation", "field_fill", "field_conflicts",
                 "item_type_buckets", "score_preview", "designation_gap"):
        assert sect in rep, f"missing section: {sect}"
    rec = rep["sku_reconciliation"]
    assert rec["matched"] + rec["mf_only_unique"] + rec["dup_artifacts"] == rec["mf_distinct"]
