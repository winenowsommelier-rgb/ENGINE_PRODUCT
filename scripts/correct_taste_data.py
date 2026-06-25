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

SMOKINESS_OK = {"none", "heavy"}
SWEETNESS_OK = {"Dry", "Off-Dry", "Medium-Sweet", "Sweet"}


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


def where_clause(col, sku, old_value):
    """Staleness guard. old_value=None -> literal IS NULL (a bound NULL never matches)."""
    if old_value is None:
        return f"WHERE sku = ? AND {col} IS NULL", (sku,)
    return f"WHERE sku = ? AND {col} = ?", (sku, old_value)


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


def assert_count(write_set, expected=EXPECTED_N):
    if len(write_set) != expected:
        print(f"COUNT TRIPWIRE: write set is {len(write_set)}, expected {expected}. "
              "findings.json may have changed — STOP and re-review.", file=sys.stderr)
        raise SystemExit(2)


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
