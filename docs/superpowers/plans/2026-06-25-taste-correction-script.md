# Taste-Data Correction Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 74 high-confidence, judge-confirmed taste corrections to `products.db` (read from the audit's `findings.json`), with a hardened write procedure safe for the WAL-mode, symlinked-shared, concurrently-mutated DB — then refresh the user-facing export and verify.

**Architecture:** One script `scripts/correct_taste_data.py` built on the proven `scripts/normalize_sweetness_case.py` skeleton. Pure helpers (`build_write_set`, `literal_for`, `where_clause`) are unit-tested with no DB. The write path uses `BEGIN IMMEDIATE` + `busy_timeout` + bounded retry + a `data_version` freshness guard, per-row staleness-guarded UPDATEs, a per-row undo journal, and post-write assertions scoped to the target SKUs. NEVER writes `judge.value` — uses a per-rule literal map.

**Tech Stack:** Python 3.9 (`from __future__ import annotations`), `sqlite3`, `pytest`. Consumes `data/audits/taste_audit_findings.json`. Post-run: `scripts/refresh_live_export.py`.

**Spec:** `docs/superpowers/specs/2026-06-25-taste-correction-script-design.md`

---

## Key contracts (verified against the codebase)

- **Canonical DB:** `data/db/products.db` (symlinked in this worktree to the shared real DB). Payment-path write (Rules 1/4/6/9).
- **Per-rule literal write map — NEVER `judge.value`** (it's off-scale `"smoky"` / null/"None"):
  ```python
  WRITE = {
      "sparkling_extra_dry_inversion": ("sweetness", "Off-Dry"),
      "nonbeverage_taste_leak":        ("variety",   None),     # SQL NULL
      "peated_false_negative":         ("smokiness", "heavy"),
      "smoky_brand_false_positive":    ("smokiness", "none"),
  }
  ```
- **Gate:** `rule ∈ WRITE.keys() ∧ judge_verdict ∈ {wrong_value, not_applicable_null_it}`, MINUS the peated drop-list, MINUS the unpeated name-guard.
- **Peated drop-list (sommelier):** `{"LWH0105BT", "LWH1206DG", "LWH0089BT"}` (2 core Bunnahabhain + held Y&F). Resulting write set = **74**.
- **Unpeated name-guard:** also skip any `peated_false_negative` row whose name contains `unpeated`/`non-peated`/`non peated`.
- **Expected write set = 74** = 49 sweetness + 17 variety + 5 smokiness-heavy + 3 smokiness-none. Tripwire: assert this.
- **BEGIN IMMEDIATE caveat:** Python `sqlite3` needs `conn.isolation_level = None` for a manual `BEGIN IMMEDIATE` to hold the lock.
- **Export reach:** `refresh_live_export.py` defaults `--db`/`--out` to its checkout's REPO_ROOT. All 4 taste cols are in `EXPORT_COLS` (verified). Run with explicit `--db data/db/products.db`; the export is git-tracked and the catalog builds from main's committed copy.
- **Run commands:** `./.venv/bin/python …`, `./.venv/bin/pytest …` (venv symlinked into this worktree).

## File structure

- **Create** `scripts/correct_taste_data.py` — the whole script (helpers + write path + CLI). ~220 lines; small enough not to need a lib split, mirroring `normalize_sweetness_case.py`.
- **Create** `tests/test_correct_taste_data.py` — pure-helper unit tests + integration tests against a temp-file SQLite fixture (no network, no shared DB).
- **Runtime artifacts** (gitignored / under data): `data/db/products.db.bak-pre-taste-correct-<ts>`, `data/audits/taste_correction_undo_<ts>.jsonl`, `data/audits/taste_correction_drift_<ts>.json`.

---

## Task 1: Pure helpers — write-set builder, literal map, gate

**Files:**
- Create: `scripts/correct_taste_data.py`
- Create: `tests/test_correct_taste_data.py`

- [ ] **Step 1: Write failing tests.**

```python
# tests/test_correct_taste_data.py
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts import correct_taste_data as C


def _findings(suspects, verdicts):
    return {"suspects": suspects, "judge": {"verdicts": verdicts}}


def test_literal_map_never_uses_judge_value():
    # smokiness peated -> 'heavy' (NOT the judge's 'smoky'); nonbeverage -> None
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
    assert skus == {"WSP1", "LWH0155BU"}      # dropped Bunna, name-guarded Ardbeg, non-TierA body
    # the write VALUE comes from the literal map, never judge.value
    tal = next(r for r in ws if r["sku"] == "LWH0155BU")
    assert tal["new_value"] == "heavy" and tal["column"] == "smokiness"


def test_gate_excludes_confirm_correct():
    suspects = [{"sku": "X", "column": "sweetness", "current_value": "Dry",
                 "rule": "sparkling_extra_dry_inversion", "name": "n"}]
    verdicts = [{"sku": "X", "column": "sweetness", "verdict": "confirm_correct"}]
    assert C.build_write_set(_findings(suspects, verdicts)) == []
```

- [ ] **Step 2: Run to verify they fail.**

Run: `./.venv/bin/pytest tests/test_correct_taste_data.py -k "literal or build or gate" -v`
Expected: FAIL (module/functions not defined).

- [ ] **Step 3: Implement the helpers.**

```python
# scripts/correct_taste_data.py
"""Apply 74 high-confidence taste corrections from the audit findings to products.db.

Payment-path write (CLAUDE.md Rules 1/4/6/9). NEVER writes judge.value — uses a
per-rule literal map. Hardened for the WAL-mode, symlinked-shared, concurrently-
mutated DB: BEGIN IMMEDIATE + busy_timeout + bounded retry + data_version guard,
per-row staleness-guarded UPDATEs, undo journal, scoped post-write assertions.
See docs/superpowers/specs/2026-06-25-taste-correction-script-design.md
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "data" / "db" / "products.db"
FINDINGS = REPO / "data" / "audits" / "taste_audit_findings.json"
AUDIT_DIR = REPO / "data" / "audits"

# Per-rule literal map. The WRITE VALUE here is authoritative — judge.value is
# off-scale ('smoky') / null and is NEVER used.
WRITE = {
    "sparkling_extra_dry_inversion": ("sweetness", "Off-Dry"),
    "nonbeverage_taste_leak":        ("variety",   None),
    "peated_false_negative":         ("smokiness", "heavy"),
    "smoky_brand_false_positive":    ("smokiness", "none"),
}
# Sommelier drop-list: 2 core (unpeated) Bunnahabhain + held Y&F.
PEATED_DROP = {"LWH0105BT", "LWH1206DG", "LWH0089BT"}
_UNPEATED = ("unpeated", "non-peated", "non peated")
EXPECTED_N = 74


def _agreed(verdict):
    return verdict in ("wrong_value", "not_applicable_null_it")


def build_write_set(findings: dict) -> list:
    """Gate findings -> the rows to write. Value comes from WRITE, not judge.value."""
    vby = {(v["sku"], v["column"]): v["verdict"]
           for v in findings["judge"]["verdicts"]}
    out = []
    for s in findings["suspects"]:
        rule = s.get("rule")
        if rule not in WRITE:
            continue
        if not _agreed(vby.get((s["sku"], s["column"]))):
            continue
        if rule == "peated_false_negative":
            if s["sku"] in PEATED_DROP:
                continue
            if any(k in (s.get("name") or "").lower() for k in _UNPEATED):
                continue
        col, lit = WRITE[rule]
        out.append({"sku": s["sku"], "column": col, "rule": rule,
                    "old_value": s["current_value"], "new_value": lit})
    return out
```

- [ ] **Step 4: Run to verify pass.**

Run: `./.venv/bin/pytest tests/test_correct_taste_data.py -k "literal or build or gate" -v`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/correct_taste_data.py tests/test_correct_taste_data.py
git commit -m "feat(correct): write-set builder + literal map (never judge.value) + drop-list/name-guard"
```

---

## Task 2: Staleness-guarded WHERE builder + value normalization

**Files:** Modify both files.

- [ ] **Step 1: Failing tests** for the WHERE-clause builder (the `IS NULL` vs `= ?` branch).

```python
# add to tests/test_correct_taste_data.py
def test_where_clause_nonnull_uses_equality():
    sql, params = C.where_clause("smokiness", "LWH0155BU", "none")
    assert "smokiness = ?" in sql and params == ("LWH0155BU", "none")

def test_where_clause_null_current_uses_is_null_literal():
    # a bound NULL param does equality (never matches); must be a literal IS NULL
    sql, params = C.where_clause("variety", "X", None)
    assert "variety IS NULL" in sql and params == ("X",)
```

- [ ] **Step 2: Run to verify fail.** `./.venv/bin/pytest tests/test_correct_taste_data.py -k where -v`

- [ ] **Step 3: Implement.**

```python
# add to scripts/correct_taste_data.py
def where_clause(col, sku, old_value):
    """Staleness guard. old_value=None -> literal IS NULL (a bound NULL never matches)."""
    if old_value is None:
        return f"WHERE sku = ? AND {col} IS NULL", (sku,)
    return f"WHERE sku = ? AND {col} = ?", (sku, old_value)
```

- [ ] **Step 4: Run to verify pass.** Same command → PASS.

- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(correct): staleness-guard WHERE builder (IS NULL literal branch)"
```

---

## Task 3: The hardened write path (connection, lock, transaction, undo journal)

**Files:** Modify both.

- [ ] **Step 1: Failing integration test** against a temp-file SQLite DB (real file so `BEGIN IMMEDIATE`/`data_version` work). Stub nothing — this exercises the real write path.

```python
# add to tests/test_correct_taste_data.py
import sqlite3

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
    # undo journal round-trips
    import os
    assert os.path.exists(str(tmp_path / "undo.jsonl"))

def test_dry_run_leaves_db_unchanged(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    before = sqlite3.connect(p).execute("SELECT sweetness FROM products WHERE sku='WSP1'").fetchone()[0]
    res = C.apply(p, _ws(), undo_path=str(tmp_path / "u.jsonl"), dry_run=True)
    after = sqlite3.connect(p).execute("SELECT sweetness FROM products WHERE sku='WSP1'").fetchone()[0]
    assert before == after == "Dry"          # unchanged
    assert res["applied"] == 3                # would-apply count still reported

def test_already_applied_vs_external_drift(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    db = sqlite3.connect(p)
    db.execute("UPDATE products SET sweetness='Off-Dry' WHERE sku='WSP1'")   # already applied
    db.execute("UPDATE products SET smokiness='light' WHERE sku='LWH0155BU'")  # external drift
    db.commit(); db.close()
    res = C.apply(p, _ws(), undo_path=str(tmp_path / "u.jsonl"), dry_run=False)
    assert res["already_applied"] == 1        # WSP1
    assert res["external_drift"] == 1         # LWH0155BU (live 'light' != old 'none')

def test_idempotent_second_run(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    C.apply(p, _ws(), undo_path=str(tmp_path / "u1.jsonl"), dry_run=False)
    res2 = C.apply(p, _ws(), undo_path=str(tmp_path / "u2.jsonl"), dry_run=False)
    assert res2["already_applied"] == 3 and res2["applied"] == 0
```

- [ ] **Step 2: Run to verify fail.** `./.venv/bin/pytest tests/test_correct_taste_data.py -k "apply or dry or already or idempotent" -v`

- [ ] **Step 3: Implement the write path.**

```python
# add to scripts/correct_taste_data.py
def _connect(db_path):
    conn = sqlite3.connect(db_path, timeout=10)
    conn.execute("PRAGMA busy_timeout=10000")
    conn.isolation_level = None              # required for manual BEGIN IMMEDIATE
    return conn


def _begin_immediate(conn, attempts=5):
    for i in range(attempts):
        try:
            conn.execute("BEGIN IMMEDIATE")
            return
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower() or i == attempts - 1:
                raise
            time.sleep(0.5 * (i + 1))


def apply(db_path, write_set, undo_path, dry_run, freshness_attempts=5):
    """Apply the write set in one BEGIN IMMEDIATE transaction with per-row guards.
    Returns a summary dict. dry_run rolls back (exercises the lock path)."""
    conn = _connect(db_path)
    for _ in range(freshness_attempts):
        dv0 = conn.execute("PRAGMA data_version").fetchone()[0]
        _begin_immediate(conn)
        dv1 = conn.execute("PRAGMA data_version").fetchone()[0]
        if dv0 == dv1:
            break
        conn.execute("ROLLBACK")            # DB shifted between snapshot and lock; retry
    else:
        conn.close()
        raise RuntimeError("DB kept changing under us; aborting (data_version unstable)")

    applied = already = drift = 0
    undo = []
    base_changes = conn.total_changes
    for r in write_set:
        col, sku, old, new = r["column"], r["sku"], r["old_value"], r["new_value"]
        where, params = where_clause(col, sku, old)
        cur = conn.execute(f"UPDATE products SET {col} = ? {where}", (new, *params))
        if cur.rowcount == 1:
            applied += 1
            undo.append({"sku": sku, "column": col, "old": old, "new": new})
        else:
            live = conn.execute(f"SELECT {col} FROM products WHERE sku = ?", (sku,)).fetchone()
            liveval = live[0] if live else "<<missing>>"
            if liveval == new:
                already += 1
            else:
                drift += 1
                print(f"  EXTERNAL_DRIFT {sku} {col}: live={liveval!r} expected_old={old!r}")

    total_changed = conn.total_changes - base_changes
    ok = (total_changed == applied) and drift == 0
    if dry_run or not ok:
        conn.execute("ROLLBACK")
        if not ok and not dry_run:
            print(f"  ROLLBACK: total_changed={total_changed} applied={applied} drift={drift}")
    else:
        conn.execute("COMMIT")
        Path(undo_path).parent.mkdir(parents=True, exist_ok=True)
        with open(undo_path, "w") as fh:
            for u in undo:
                fh.write(json.dumps(u) + "\n")
    conn.close()
    return {"applied": applied, "already_applied": already, "external_drift": drift,
            "total_changed": total_changed, "committed": (not dry_run and ok)}
```

- [ ] **Step 4: Run to verify pass.** Same `-k` command → PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(correct): hardened write path — BEGIN IMMEDIATE + data_version guard + staleness UPDATEs + undo journal + drift disambiguation"
```

---

## Task 4: Backup, post-write assertions, CLI, count tripwire

**Files:** Modify both.

- [ ] **Step 1: Failing tests** for the post-write assertion + tripwire.

```python
# add to tests/test_correct_taste_data.py
def test_tripwire_rejects_wrong_count(tmp_path, monkeypatch):
    # build_write_set returns !=74 -> main must refuse (we test the guard fn directly)
    import pytest
    with pytest.raises(SystemExit):
        C.assert_count([{"sku": "X"}], expected=74)

def test_assert_targets_scoped(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    C.apply(p, _ws(), undo_path=str(tmp_path / "u.jsonl"), dry_run=False)
    # pre-existing off-scale row OUTSIDE the target set must NOT fail the scoped sweep
    db = sqlite3.connect(p)
    db.execute("INSERT INTO products VALUES ('OTHER','x','weird-token','','','')")
    db.commit(); db.close()
    # assertion is scoped to target SKUs only -> passes despite 'weird-token'
    assert C.assert_targets(p, _ws()) is True
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement backup, assertions, CLI.**

```python
# add to scripts/correct_taste_data.py
def assert_count(write_set, expected=EXPECTED_N):
    if len(write_set) != expected:
        print(f"COUNT TRIPWIRE: write set is {len(write_set)}, expected {expected}. "
              "findings.json may have changed — STOP and re-review.", file=sys.stderr)
        raise SystemExit(2)


SMOKINESS_OK = {"none", "heavy"}
SWEETNESS_OK = {"Dry", "Off-Dry", "Medium-Sweet", "Sweet"}


def assert_targets(db_path, write_set):
    """Post-write: each target SKU has its literal; off-scale sweep SCOPED to targets."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA busy_timeout=10000")   # shared WAL DB — cheap insurance
    for r in write_set:
        live = conn.execute(f"SELECT {r['column']} FROM products WHERE sku=?",
                            (r["sku"],)).fetchone()[0]
        want = r["new_value"]
        if (live or None) != (want or None):
            conn.close()
            raise AssertionError(f"target {r['sku']} {r['column']}={live!r} != {want!r}")
    # scoped off-scale sweep
    target_skus = {r["sku"] for r in write_set}
    for r in write_set:
        if r["column"] == "smokiness":
            v = conn.execute("SELECT smokiness FROM products WHERE sku=?", (r["sku"],)).fetchone()[0]
            assert v in SMOKINESS_OK, f"off-scale smokiness {r['sku']}={v!r}"
        if r["column"] == "sweetness":
            v = conn.execute("SELECT sweetness FROM products WHERE sku=?", (r["sku"],)).fetchone()[0]
            assert v in SWEETNESS_OK, f"off-scale sweetness {r['sku']}={v!r}"
    conn.close()
    return True


def backup(db_path, ts):
    bak = f"{db_path}.bak-pre-taste-correct-{ts}"
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(bak)
    with dst:
        src.backup(dst)                      # WAL-safe (consolidates -wal)
    src.close(); dst.close()
    return bak


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--findings", default=str(FINDINGS))
    ap.add_argument("--ts", default="manual", help="timestamp tag for backup/undo files")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    findings = json.loads(Path(a.findings).read_text())
    ws = build_write_set(findings)
    assert_count(ws)                         # tripwire: must be 74
    print(f"write set: {len(ws)} rows "
          f"({sum(1 for r in ws if r['column']=='sweetness')} sweetness, "
          f"{sum(1 for r in ws if r['column']=='variety')} variety, "
          f"{sum(1 for r in ws if r['new_value']=='heavy')} heavy, "
          f"{sum(1 for r in ws if r['new_value']=='none')} none)")

    if not a.dry_run:
        bak = backup(a.db, a.ts)
        print(f"backup: {bak}")
    undo_path = str(AUDIT_DIR / f"taste_correction_undo_{a.ts}.jsonl")
    res = apply(a.db, ws, undo_path=undo_path, dry_run=a.dry_run)
    print(f"RESULT: {res}")

    if a.dry_run:
        print("DRY-RUN complete (no write). Re-run without --dry-run to apply.")
        return 0
    if res["external_drift"] or not res["committed"]:
        print("NOT committed (external drift or count mismatch). DB unchanged.", file=sys.stderr)
        return 1
    assert_targets(a.db, ws)
    print(f"VERIFIED {res['applied']} writes landed. Undo journal: {undo_path}")
    print("NEXT (manual, Rules 1/7/9): refresh_live_export with explicit --db, "
          "commit the export, browser-verify a sparkling + a peated whisky page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the FULL suite.**

Run: `./.venv/bin/pytest tests/test_correct_taste_data.py -v`
Expected: ALL PASS, no network, no touch to the real DB.

- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(correct): backup (WAL-safe) + scoped post-write assertions + count tripwire + CLI"
```

---

## Task 5: DRY-RUN against the real DB (no write), verify the 74

- [ ] **Step 1:** Run the dry-run against the canonical DB.

Run: `./.venv/bin/python scripts/correct_taste_data.py --db data/db/products.db --dry-run`
Expected: prints `write set: 74 rows (49 sweetness, 17 variety, 5 heavy, 3 none)`; `RESULT: {... applied: 74, external_drift: 0, committed: False}`; DB unchanged. If the count ≠ 74 or any external_drift, STOP and investigate (Rule 2) — do NOT proceed.

- [ ] **Step 2:** Confirm the DB was not modified.

Run: `git status` (the gitignored DB won't show, but) re-run a quick query to confirm e.g. `LWH0155BU` smokiness is still `none` (dry-run didn't write).

- [ ] **Step 3: STOP — present the dry-run result to the user** for go-ahead on the real write (the spec's payment-path equivalent of a canary). Show the 74-row breakdown and the zero-drift confirmation.

---

## Task 6: REAL write (post user go-ahead) + export refresh + verify

- [ ] **Step 1:** Backup is automatic. Run the real correction.

Run: `./.venv/bin/python scripts/correct_taste_data.py --db data/db/products.db --ts $(date +%Y%m%d-%H%M%S)`
Expected: `backup: …bak-pre-taste-correct-…`; `RESULT: {applied: 74, external_drift: 0, committed: True}`; `VERIFIED 74 writes landed.`

- [ ] **Step 2:** Refresh the export with EXPLICIT paths (the worktree-default gotcha).

Run: `./.venv/bin/python scripts/refresh_live_export.py --db data/db/products.db`
Then verify ALL 74 in the JSON the catalog reads (iterate the write set — Rule-1
full verification, not a one-SKU spot check):

```bash
./.venv/bin/python - <<'PY'
import json, sys
sys.path.insert(0, ".")
from scripts import correct_taste_data as C
findings = json.load(open("data/audits/taste_audit_findings.json"))
ws = C.build_write_set(findings)
by = {p["sku"]: p for p in json.load(open("data/live_products_export.json"))}
bad = []
for r in ws:
    live = by.get(r["sku"], {}).get(r["column"])
    want = r["new_value"]
    # export encodes NULL as None or "" ; both are "unpopulated" for variety
    ok = (live in (None, "")) if want is None else (live == want)
    if not ok:
        bad.append((r["sku"], r["column"], live, want))
print(f"{len(ws)-len(bad)}/{len(ws)} corrections present in export")
assert not bad, f"MISSING IN EXPORT: {bad[:10]}"
print("export reflects all 74 corrections")
PY
```

- [ ] **Step 3: Browser verify (Rule 7).** Start the catalog dev server (port 3100 per memory), open a corrected sparkling product page (sweetness gauge shows Off-Dry) and Talisker 10 (smokiness badge). Confirm they render the corrected value.

- [ ] **Step 4: Commit** the script, tests, undo journal, and the refreshed export.

```bash
git add scripts/correct_taste_data.py tests/test_correct_taste_data.py \
        data/audits/taste_correction_undo_*.jsonl data/live_products_export.json
git commit -m "feat(correct): apply 74 taste corrections + refresh export (verified DB+export+browser)"
```

- [ ] **Step 5:** Update memory `project_taste_data_quality_audit` with the correction outcome (74 applied, the deferred efforts) and confirm the PR/merge path for the export so the catalog rebuilds.

---

## Notes for the implementer

- **Rollback:** if a bad write ships, use the undo journal (`taste_correction_undo_<ts>.jsonl`) — replay inverse `UPDATE products SET col=old WHERE sku=? AND col=new` (staleness-guarded), NOT a `.backup` file restore (that clobbers concurrent sessions' work). Then re-refresh + re-commit the export.
- **Never** broaden the off-scale assertion to the whole table — there are pre-existing `Medium-Light`/lowercase rows this run doesn't touch (scope to target SKUs).
- The script spends NO API money. The dry-run + backup + staleness guard + undo journal are the safety net (Rule 10's canary equivalent for an irreversible DB write).
- If `--dry-run` shows count ≠ 74, findings.json drifted — do not edit the tripwire to pass; investigate why (Rule 2 / Rule 5: don't lock in a bug).
