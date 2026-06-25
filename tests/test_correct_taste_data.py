import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts import correct_taste_data as C  # noqa: E402


def _findings(suspects, verdicts):
    return {"suspects": suspects, "judge": {"verdicts": verdicts}}


# --- Task 1: write-set builder + literal map ---

def test_literal_map_never_uses_judge_value():
    assert C.WRITE["peated_false_negative"] == ("smokiness", "heavy")
    assert C.WRITE["nonbeverage_taste_leak"] == ("variety", None)


def test_build_write_set_gate_and_droplist():
    suspects = [
        {"sku": "WSP1", "column": "sweetness", "current_value": "Dry",
         "rule": "sparkling_extra_dry_inversion", "name": "Prosecco Extra Dry"},
        {"sku": "LWH0105BT", "column": "smokiness", "current_value": "none",
         "rule": "peated_false_negative", "name": "Bunnahabhain 16"},   # DROP-LIST
        {"sku": "LWH0155BU", "column": "smokiness", "current_value": "none",
         "rule": "peated_false_negative", "name": "Talisker 10"},       # keep
        {"sku": "LZZ9", "column": "smokiness", "current_value": "none",
         "rule": "peated_false_negative", "name": "Ardbeg Unpeated"},   # name-guard
        {"sku": "WBODY", "column": "body", "current_value": "full",
         "rule": "body_case_dup", "name": "x"},                          # not TierA
    ]
    verdicts = [
        {"sku": "WSP1", "column": "sweetness", "verdict": "wrong_value"},
        {"sku": "LWH0105BT", "column": "smokiness", "verdict": "wrong_value"},
        {"sku": "LWH0155BU", "column": "smokiness", "verdict": "wrong_value"},
        {"sku": "LZZ9", "column": "smokiness", "verdict": "wrong_value"},
        {"sku": "WBODY", "column": "body", "verdict": "wrong_value"},
    ]
    ws = C.build_write_set(_findings(suspects, verdicts))
    skus = {r["sku"] for r in ws}
    assert skus == {"WSP1", "LWH0155BU"}
    tal = next(r for r in ws if r["sku"] == "LWH0155BU")
    assert tal["new_value"] == "heavy" and tal["column"] == "smokiness"


def test_gate_excludes_confirm_correct():
    suspects = [{"sku": "X", "column": "sweetness", "current_value": "Dry",
                 "rule": "sparkling_extra_dry_inversion", "name": "n"}]
    verdicts = [{"sku": "X", "column": "sweetness", "verdict": "confirm_correct"}]
    assert C.build_write_set(_findings(suspects, verdicts)) == []


# --- Task 2: WHERE builder ---

def test_where_clause_nonnull_uses_equality():
    sql, params = C.where_clause("smokiness", "LWH0155BU", "none")
    assert "smokiness = ?" in sql and params == ("LWH0155BU", "none")


def test_where_clause_null_current_uses_is_null_literal():
    sql, params = C.where_clause("variety", "X", None)
    assert "variety IS NULL" in sql and params == ("X",)


# --- Task 3: hardened write path ---

def _mk_db(path):
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE products (sku TEXT, name TEXT, smokiness TEXT, "
               "sweetness TEXT, body TEXT, variety TEXT)")
    db.executemany("INSERT INTO products VALUES (?,?,?,?,?,?)", [
        ("WSP1", "Prosecco Extra Dry", "", "Dry", "", ""),
        ("LWH0155BU", "Talisker 10", "none", "", "", ""),
        ("GWN1", "Champagne Glasses", "", "", "", "Pinot Noir, Chardonnay"),
    ])
    db.commit(); db.close()


def _ws():
    return [
        {"sku": "WSP1", "column": "sweetness", "rule": "sparkling_extra_dry_inversion",
         "old_value": "Dry", "new_value": "Off-Dry"},
        {"sku": "LWH0155BU", "column": "smokiness", "rule": "peated_false_negative",
         "old_value": "none", "new_value": "heavy"},
        {"sku": "GWN1", "column": "variety", "rule": "nonbeverage_taste_leak",
         "old_value": "Pinot Noir, Chardonnay", "new_value": None},
    ]


def test_apply_writes_values_and_journal(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    res = C.apply(p, _ws(), undo_path=str(tmp_path / "undo.jsonl"), dry_run=False)
    db = sqlite3.connect(p)
    assert db.execute("SELECT sweetness FROM products WHERE sku='WSP1'").fetchone()[0] == "Off-Dry"
    assert db.execute("SELECT smokiness FROM products WHERE sku='LWH0155BU'").fetchone()[0] == "heavy"
    assert db.execute("SELECT variety FROM products WHERE sku='GWN1'").fetchone()[0] is None
    assert res["applied"] == 3 and res["external_drift"] == 0
    assert os.path.exists(str(tmp_path / "undo.jsonl"))


def test_dry_run_leaves_db_unchanged(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    before = sqlite3.connect(p).execute("SELECT sweetness FROM products WHERE sku='WSP1'").fetchone()[0]
    res = C.apply(p, _ws(), undo_path=str(tmp_path / "u.jsonl"), dry_run=True)
    after = sqlite3.connect(p).execute("SELECT sweetness FROM products WHERE sku='WSP1'").fetchone()[0]
    assert before == after == "Dry"
    assert res["applied"] == 3


def test_already_applied_vs_external_drift(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    db = sqlite3.connect(p)
    db.execute("UPDATE products SET sweetness='Off-Dry' WHERE sku='WSP1'")       # already
    db.execute("UPDATE products SET smokiness='light' WHERE sku='LWH0155BU'")    # drift
    db.commit(); db.close()
    res = C.apply(p, _ws(), undo_path=str(tmp_path / "u.jsonl"), dry_run=False)
    assert res["already_applied"] == 1
    assert res["external_drift"] == 1


def test_idempotent_second_run(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    C.apply(p, _ws(), undo_path=str(tmp_path / "u1.jsonl"), dry_run=False)
    res2 = C.apply(p, _ws(), undo_path=str(tmp_path / "u2.jsonl"), dry_run=False)
    assert res2["already_applied"] == 3 and res2["applied"] == 0


# --- Task 4: tripwire + scoped assertions ---

def test_tripwire_rejects_wrong_count():
    with pytest.raises(SystemExit):
        C.assert_count([{"sku": "X"}], expected=74)


def test_assert_targets_scoped(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    C.apply(p, _ws(), undo_path=str(tmp_path / "u.jsonl"), dry_run=False)
    db = sqlite3.connect(p)
    db.execute("INSERT INTO products VALUES ('OTHER','x','weird-token','','','')")
    db.commit(); db.close()
    assert C.assert_targets(p, _ws()) is True


def test_undo_journal_round_trips(tmp_path):
    import json
    p = str(tmp_path / "t.db"); _mk_db(p)
    undo = str(tmp_path / "u.jsonl")
    C.apply(p, _ws(), undo_path=undo, dry_run=False)
    # replay inverse: set col=old where col=new
    db = sqlite3.connect(p)
    for line in open(undo):
        u = json.loads(line)
        if u["old"] is None:
            db.execute(f"UPDATE products SET {u['column']}=NULL WHERE sku=? AND {u['column']}=?",
                       (u["sku"], u["new"]))
        else:
            db.execute(f"UPDATE products SET {u['column']}=? WHERE sku=? AND {u['column']}=?",
                       (u["old"], u["sku"], u["new"]))
    db.commit()
    assert db.execute("SELECT sweetness FROM products WHERE sku='WSP1'").fetchone()[0] == "Dry"
    assert db.execute("SELECT smokiness FROM products WHERE sku='LWH0155BU'").fetchone()[0] == "none"
    db.close()
