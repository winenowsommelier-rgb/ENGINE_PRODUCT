import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts import audit_taste_data as A  # noqa: E402


def _mk_db(path):
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE products (sku TEXT, name TEXT, smokiness TEXT, "
               "sweetness TEXT, body TEXT, variety TEXT)")
    rows = [
        ("LWH0155BU", "Talisker 10 Year Old", "none", "", "", ""),        # peated FN
        ("WSP0009AA", "7 Cascine Prosecco Extra Dry", "", "Dry", "", ""),  # extra-dry inversion
        ("GWN0383BM", "Final Touch Champagne Glasses", "", "", "", "Pinot Noir, Chardonnay"),  # nonbev
        ("WWW0001AA", "Chablis", "", "Dry", "Light", "Chardonnay"),        # clean
    ]
    db.executemany("INSERT INTO products VALUES (?,?,?,?,?,?)", rows)
    db.commit()
    db.close()


def test_census_and_suspects(tmp_path):
    p = str(tmp_path / "t.db")
    _mk_db(p)
    result = A.run_census(p)
    suspect_skus = {f["sku"] for f in result["suspects"]}
    assert "LWH0155BU" in suspect_skus
    assert "WSP0009AA" in suspect_skus
    assert "GWN0383BM" in suspect_skus
    assert result["populated"]["sweetness"] == 2
    assert result["populated"]["variety"] == 2


def test_db_opened_readonly_cannot_write(tmp_path):
    p = str(tmp_path / "t.db")
    _mk_db(p)
    conn = A.open_ro(p)
    try:
        conn.execute("UPDATE products SET body='X'")
        assert False, "read-only DB allowed a write"
    except sqlite3.OperationalError:
        pass


def test_smokiness_not_killed_by_inapplicable(tmp_path):
    # REGRESSION: smokiness is in no applies() set; it must reach triage_smokiness.
    p = str(tmp_path / "t.db")
    _mk_db(p)
    result = A.run_census(p)
    tal = [f for f in result["suspects"] if f["sku"] == "LWH0155BU"]
    assert tal and tal[0]["rule"] == "peated_false_negative"


def test_census_suspects_carry_group_type_for_judge(tmp_path):
    # REGRESSION: census-built suspects MUST carry group/type/name so the live
    # judge prompt builds without KeyError on the first paid row (incl. canary).
    p = str(tmp_path / "t.db")
    _mk_db(p)
    result = A.run_census(p)
    s = result["suspects"][0]
    assert "group" in s and "type" in s and "name" in s
    A.build_judge_prompt(s)   # must not raise KeyError


def test_write_outputs_schema(tmp_path):
    census = {"populated": {"sweetness": 2, "smokiness": 1, "body": 1, "variety": 2},
              "total_rows": 4,
              "suspects": [{"sku": "WSP0009AA", "column": "sweetness",
                            "current_value": "Dry", "expected_value": "Off-Dry",
                            "rule": "sparkling_extra_dry_inversion", "reason": "x",
                            "group": "Wine", "type": "Sparkling & Champagne"}],
              "clean": []}
    report, findings = A.build_outputs(census, judged=None)
    assert "sweetness" in report
    assert "inversion" in report
    assert findings["suspects"][0]["sku"] == "WSP0009AA"
    assert findings["meta"]["total_rows"] == 4


def test_per_column_judged_measures_error_rate():
    judged = {"verdicts": [
        {"column": "sweetness", "verdict": "wrong_value"},
        {"column": "sweetness", "verdict": "confirm_correct"},
        {"column": "body", "verdict": "confirm_correct"},
    ], "calibration": {"checked": 1, "agreed": 1, "miscalibrated": False}}
    census = {"populated": {c: 0 for c in A.TASTE_COLS}, "total_rows": 3,
              "suspects": [], "clean": []}
    report, findings = A.build_outputs(census, judged)
    pc = findings["per_column"]
    assert pc["sweetness"]["judged"] == 2 and pc["sweetness"]["wrong"] == 1
    assert pc["sweetness"]["error_rate"] == 0.5
    assert pc["body"]["error_rate"] == 0.0 and pc["body"]["suggest"] == "trust"
    assert "measured error rate" in report and "ADVISORY leaning" in report


def test_parse_env_line_strips_quotes():
    # REGRESSION: .env.local value is quoted; quotes MUST be stripped or the SDK
    # gets a key with literal quotes -> 401 invalid x-api-key.
    assert A.parse_env_line('ANTHROPIC_API_KEY="sk-abc123"') == ("ANTHROPIC_API_KEY", "sk-abc123")
    assert A.parse_env_line("FOO='bar'") == ("FOO", "bar")
    assert A.parse_env_line("BARE=value") == ("BARE", "value")
    assert A.parse_env_line("# comment") is None
    assert A.parse_env_line("") is None


def test_judge_prompt_carries_category_and_rule():
    row = {"sku": "WSP0009AA", "name": "Prosecco Extra Dry", "column": "sweetness",
           "current_value": "Dry", "group": "Wine", "type": "Sparkling & Champagne"}
    prompt = A.build_judge_prompt(row)
    assert "Sparkling" in prompt and "Extra Dry" in prompt


def test_cache_roundtrip(tmp_path):
    cache = tmp_path / "c.jsonl"
    A.cache_put(cache, "WSP0009AA|sweetness", {"verdict": "wrong_value", "value": "Off-Dry"})
    assert A.cache_get(cache, "WSP0009AA|sweetness")["value"] == "Off-Dry"
    assert A.cache_get(cache, "missing|key") is None


def test_judge_uses_stub_and_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "JUDGE_CACHE", tmp_path / "jc.jsonl")
    calls = {"n": 0}

    def fake_call(prompt):
        calls["n"] += 1
        return {"verdict": "wrong_value", "value": "Off-Dry", "reason": "extra dry"}

    monkeypatch.setattr(A, "_call_haiku", fake_call)
    census = {"populated": {c: 0 for c in A.TASTE_COLS}, "total_rows": 1, "clean": [],
              "suspects": [{"sku": "WSP0009AA", "column": "sweetness",
                            "current_value": "Dry", "expected_value": "Off-Dry",
                            "rule": "sparkling_extra_dry_inversion", "reason": "x",
                            "name": "Prosecco Extra Dry", "group": "Wine",
                            "type": "Sparkling & Champagne"}]}
    j1 = A.run_judge(census, canary=0)
    assert calls["n"] == 1
    A.run_judge(census, canary=0)
    assert calls["n"] == 1                    # served from cache
    assert j1["calibration"]["checked"] >= 1


def test_per_cell_escalation_fires_on_dirty_large_cell(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "JUDGE_CACHE", tmp_path / "jc2.jsonl")
    monkeypatch.setattr(A, "CONTROL_PER_TYPE", 25)
    monkeypatch.setattr(A, "_call_haiku",
                        lambda p: {"verdict": "wrong_value", "value": "X", "reason": "r"})
    clean = [{"sku": f"C{i}", "column": "body", "current_value": "Full",
              "group": "Wine", "type": "Red Wine", "name": "n"} for i in range(40)]
    census = {"populated": {c: 0 for c in A.TASTE_COLS}, "total_rows": 40,
              "suspects": [], "clean": clean}
    res = A.run_judge(census, canary=0)
    fired = [c for c in res["cell_report"] if c["escalated"]]
    assert fired and res["escalated"] > 0


def test_tiny_cell_not_gated(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "JUDGE_CACHE", tmp_path / "jc3.jsonl")
    monkeypatch.setattr(A, "_call_haiku",
                        lambda p: {"verdict": "wrong_value", "value": "X", "reason": "r"})
    clean = [{"sku": f"D{i}", "column": "body", "current_value": "Full",
              "group": "Wine", "type": "Red Wine", "name": "n"} for i in range(3)]
    census = {"populated": {c: 0 for c in A.TASTE_COLS}, "total_rows": 3,
              "suspects": [], "clean": clean}
    res = A.run_judge(census, canary=0)
    assert all(not c["escalated"] for c in res["cell_report"])
