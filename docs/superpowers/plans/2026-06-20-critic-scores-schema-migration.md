# Critic Scores Schema Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the live `critic_scores` table (3,144 rows, sku-keyed, simple) to the rich schema the three-feed design needs — adding provenance/signal/confidence columns and making `sku` nullable — **without breaking the 1,550 product badges already shipping**.

**Architecture:** Three ordered, irreversible DB steps on the existing `data/db/products.db`: (1) `ALTER ADD COLUMN` for the new fields, (2) backfill the 3,144 existing `magento_csv` rows with provenance/tier/confidence values, (3) a 12-step SQLite table-rebuild to make `sku` nullable (SQLite can't drop NOT NULL via ALTER). The CSV loader is updated to populate the new columns on future runs. Everything is guarded by a backup (Rule 10), a pre/post SKU-set snapshot, a live-export refresh + Layer-3 probe (Rules 1/9), and a permanent invariant test (Rule 6).

**Tech Stack:** Python 3.9 + stdlib `sqlite3`, pytest 8.4.2 (`.venv/bin/python -m pytest`). No new dependencies. No network, no API spend.

**Spec:** [docs/superpowers/specs/2026-06-16-critic-score-harvester-scrapy-design.md](../specs/2026-06-16-critic-score-harvester-scrapy-design.md) §15 (this plan), with §11 (verification) and §19 (anti-drift) in play.

**CLAUDE.md rules in play:** 1 (verify in live export, not cache), 6 (end-to-end invariant test), 9 (refresh `live_products_export.json` after DB writes), 10 (backup + canary + verify-shipped before bulk write).

---

## Pre-flight: re-verify assumptions (spec §19 — do this FIRST, 5 min)

The spec is a point-in-time snapshot on an actively-developed branch. Before writing any code, confirm the starting state still holds. If any check disagrees with the expected value, STOP and reconcile — do not proceed with the migration.

- [ ] **Step 0.1: Confirm table shape + counts.**

Run:
```bash
.venv/bin/python - <<'PY'
import sqlite3
c = sqlite3.connect("data/db/products.db")
print("schema:", c.execute("SELECT sql FROM sqlite_master WHERE name='critic_scores'").fetchone()[0])
print("rows/skus/sources:", c.execute(
  "SELECT count(*), count(DISTINCT sku), count(DISTINCT added_by) FROM critic_scores").fetchone())
print("badges:", c.execute(
  "SELECT count(*) FROM products WHERE score_summary IS NOT NULL").fetchone()[0])
print("source tag:", c.execute("SELECT DISTINCT added_by FROM critic_scores").fetchall())
print("fractional scores:", c.execute(
  "SELECT count(*) FROM critic_scores WHERE score <> CAST(score AS INTEGER)").fetchone()[0])
print("new cols already present?:", [r[1] for r in c.execute("PRAGMA table_info(critic_scores)")
  if r[1] in ('source','signal_tier','confidence')])
PY
```
Expected: schema has `sku TEXT NOT NULL`, **no** `source`/`signal_tier`/`confidence` columns; rows/skus/sources = `(3144, 1631, 1)`; badges = `1550`; source tag = `magento_csv_2026-06-15`; fractional scores = `0`; new cols present = `[]`.

If `source`/`signal_tier`/`confidence` already exist, the migration (or part of it) already ran — STOP and inspect before re-running (this migration is run-once, §15).

- [ ] **Step 0.2: Confirm live export is in sync (Rule 9).**

Run: `ls -l data/db/products.db data/live_products_export.json` (compare mtimes)
Run:
```bash
.venv/bin/python -c "import json;print('export badges:', sum(1 for p in json.load(open('data/live_products_export.json')) if p.get('score_summary')))"
```
Expected: export badge count = `1550` (matches DB). If it differs, run `.venv/bin/python scripts/refresh_live_export.py` first so the baseline is clean.

---

## File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `scripts/migrate_critic_scores_schema.py` | Create | The one-shot, run-once migration: ALTER + backfill + table-rebuild, all in one transaction with a backup precondition. |
| `tests/critic_reviews/__init__.py` | Create | Test package marker. |
| `tests/critic_reviews/integration/__init__.py` | Create | Test package marker. |
| `tests/critic_reviews/integration/test_critic_db_invariants.py` | Create | Rule 6 invariant test: migration preserves all rows + the 1,550-SKU badge set; new columns populated for curated rows. Runs against live DB (read-only). Permanent regression guard. |
| `scripts/load_critic_scores_from_csv.py` | Modify | Populate the new columns on future CSV loads (`source`, `signal_tier`, `signal_class`, `confidence`, `score_scale`, `score_native`, `supporting_text`, `fetched_at`). |
| `tests/curation/test_scoring_engine.py` | Verify only | Existing scoring-engine tests must still pass (engine parses `score_native` as string). Not modified. |

**Why a script, not raw SQL:** the table-rebuild (Task 3) needs a backup precondition check, a transaction, and `PRAGMA foreign_keys=OFF`/`ON` bracketing — too much for a one-liner, and it must be re-runnable-safe (abort if already migrated) per §15's run-once banner.

---

## Task 1: The Rule 6 invariant test (write FIRST — it defines "didn't break the badges")

This is TDD for a migration: the invariant test is written and run against the **pre-migration** DB first (where it must pass for the parts that already hold, and we capture the baseline snapshot), then re-run after each migration step. It is the permanent regression guard the spec (§11.7) requires.

**Files:**
- Create: `tests/critic_reviews/__init__.py`
- Create: `tests/critic_reviews/integration/__init__.py`
- Create: `tests/critic_reviews/integration/test_critic_db_invariants.py`

- [ ] **Step 1.1: Create the package markers**

```bash
mkdir -p tests/critic_reviews/integration
touch tests/critic_reviews/__init__.py tests/critic_reviews/integration/__init__.py
```

- [ ] **Step 1.2: Write the invariant test**

Create `tests/critic_reviews/integration/test_critic_db_invariants.py` (patterned on `tests/test_enrichment_db_invariants.py`):

```python
"""Production-data invariants for the critic_scores schema migration.

Guards the §15 migration: the rich-schema migration must NOT break the
1,550 product badges already shipping, and must NOT lose any of the 3,144
curated rows. This is the Rule 6 end-to-end invariant (CLAUDE.md), the
single most load-bearing test for the migration given the project's
$56 Phase-5 history. DO NOT delete or skip without an equivalent replacement.

Run read-only against the live data/db/products.db:
    .venv/bin/python -m pytest tests/critic_reviews/integration -v
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

# Expected steady-state, asserted by the §19 pre-flight. If the catalog grows
# and the loader re-runs, update these together with a documented reason.
EXPECTED_ROWS = 3144
EXPECTED_BADGE_SKUS = 1550


@pytest.fixture(scope="module")
def conn():
    if not DEFAULT_DB.exists():
        pytest.skip(f"live db not present: {DEFAULT_DB}")
    c = sqlite3.connect(DEFAULT_DB)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def _has_columns(conn) -> bool:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(critic_scores)")}
    return {"source", "signal_tier", "confidence"}.issubset(cols)


def test_curated_rows_preserved(conn):
    """INVARIANT: the 3,144 magento_csv rows are all still present after migration."""
    n = conn.execute(
        "SELECT count(*) FROM critic_scores WHERE added_by LIKE 'magento_csv%'"
    ).fetchone()[0]
    assert n == EXPECTED_ROWS, (
        f"expected {EXPECTED_ROWS} curated rows, found {n} — migration lost or "
        f"duplicated rows"
    )


def test_badge_set_unchanged(conn):
    """INVARIANT: exactly the same SKUs carry a product badge after migration."""
    n = conn.execute(
        "SELECT count(*) FROM products WHERE score_summary IS NOT NULL"
    ).fetchone()[0]
    assert n == EXPECTED_BADGE_SKUS, (
        f"expected {EXPECTED_BADGE_SKUS} badged SKUs, found {n} — migration "
        f"changed which products show critic scores"
    )


def test_curated_rows_have_provenance_after_migration(conn):
    """INVARIANT (post-migration only): once the rich columns exist, every
    curated row has source/signal_tier/confidence populated — no NULL gaps
    that would make a curated row indistinguishable from an un-migrated one.

    Skips cleanly BEFORE migration (columns absent), so this file can be the
    pre-migration baseline too.
    """
    if not _has_columns(conn):
        pytest.skip("rich columns not yet added (pre-migration) — nothing to assert")
    missing = conn.execute("""
        SELECT count(*) FROM critic_scores
        WHERE added_by LIKE 'magento_csv%'
          AND (source IS NULL OR signal_tier IS NULL OR confidence IS NULL
               OR score_native IS NULL OR score_scale IS NULL)
    """).fetchone()[0]
    assert missing == 0, (
        f"{missing} curated rows have NULL provenance after migration — the "
        f"backfill UPDATE did not cover every row"
    )


def test_score_native_not_corrupted(conn):
    """INVARIANT (post-migration only): score_native is the published value,
    never a corrupted re-CAST. For the all-integer current data, score_native
    must equal the integer string of score (e.g. 91.0 -> '91', not '91.0').
    """
    if not _has_columns(conn):
        pytest.skip("rich columns not yet added (pre-migration)")
    bad = conn.execute("""
        SELECT id, score, score_native FROM critic_scores
        WHERE added_by LIKE 'magento_csv%'
          AND score = CAST(score AS INTEGER)
          AND score_native <> CAST(CAST(score AS INTEGER) AS TEXT)
        LIMIT 5
    """).fetchall()
    assert not bad, (
        f"score_native mismatch on {len(bad)}+ rows, e.g. "
        f"{[(r['id'], r['score'], r['score_native']) for r in bad]}"
    )
```

- [ ] **Step 1.3: Run the test against the pre-migration DB — confirm baseline behavior**

Run: `.venv/bin/python -m pytest tests/critic_reviews/integration -v`
Expected: `test_curated_rows_preserved` PASS, `test_badge_set_unchanged` PASS, the two post-migration tests SKIP ("pre-migration"). This proves the baseline (3,144 / 1,550) holds and the post-migration asserts are correctly gated.

- [ ] **Step 1.4: Commit**

```bash
git add tests/critic_reviews/__init__.py tests/critic_reviews/integration/__init__.py tests/critic_reviews/integration/test_critic_db_invariants.py
git commit -m "test(critic-reviews): Rule 6 migration invariant (rows + 1,550 badges preserved)"
```

---

## Task 2: The migration script — ALTER + backfill (Steps 1-2 of §15)

**Files:**
- Create: `scripts/migrate_critic_scores_schema.py`

- [ ] **Step 2.1: Write the migration script (ALTER + backfill only; rebuild is Task 3)**

Create `scripts/migrate_critic_scores_schema.py`:

```python
#!/usr/bin/env python3
"""One-shot, RUN-ONCE migration of critic_scores to the rich schema (spec §15).

Steps:
  1. add the rich columns (ALTER ADD COLUMN — additive, safe)
  2. backfill the existing magento_csv rows (source/tier/confidence/score_native…)
  3. table-rebuild to make `sku` nullable (SQLite can't drop NOT NULL via ALTER)

NOT idempotent: re-running errors on the duplicate ALTER / re-rebuild. Take the
Rule 10 backup first; on failure, restore from backup and re-run from the top.

Pure local — NO API spend. After running, refresh the live export (Rule 9):
    .venv/bin/python scripts/refresh_live_export.py
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

NEW_COLUMNS = [
    ("source", "TEXT"),
    ("score_native", "TEXT"),
    ("score_scale", "TEXT"),
    ("signal_class", "TEXT"),
    ("signal_tier", "INTEGER"),
    ("supporting_text", "TEXT"),
    ("confidence", "REAL"),
    ("producer", "TEXT"),
    ("cuvee", "TEXT"),
    ("fetched_at", "TEXT"),
]


def already_migrated(conn) -> bool:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(critic_scores)")}
    return "source" in cols


def add_columns(conn) -> None:
    for name, typ in NEW_COLUMNS:
        conn.execute(f"ALTER TABLE critic_scores ADD COLUMN {name} {typ}")


def backfill_curated(conn) -> int:
    # score_native must be AS-PUBLISHED, never a re-derived integer (spec §15).
    # All current rows are integer-valued; the CASE keeps any future 94.5 intact.
    cur = conn.execute("""
        UPDATE critic_scores
        SET source = 'magento_csv',
            score_native = CASE WHEN score = CAST(score AS INTEGER)
                                THEN CAST(CAST(score AS INTEGER) AS TEXT)
                                ELSE CAST(score AS TEXT) END,
            score_scale = '100pt',
            signal_class = 'critic_numeric',
            signal_tier = 1,
            confidence = 1.0,
            supporting_text = NULL,
            fetched_at = COALESCE(fetched_at, added_at)
        WHERE added_by LIKE 'magento_csv%' AND source IS NULL
    """)
    return cur.rowcount


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the backup (TESTS ONLY — never in production)")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    # Rule 10: backup before any irreversible write.
    if not args.no_backup:
        bak = args.db.with_suffix(args.db.suffix + ".bak-pre-critic-migration")
        shutil.copy2(args.db, bak)
        print(f"backup -> {bak}")

    conn = sqlite3.connect(args.db)
    try:
        if already_migrated(conn):
            print("ALREADY MIGRATED (source column present) — aborting (run-once).",
                  file=sys.stderr)
            return 2

        # ALL THREE STEPS in ONE transaction so a failure rolls back atomically
        # (no half-migrated DB). foreign_keys pragma must be set OUTSIDE the tx.
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("BEGIN")
        add_columns(conn)
        n = backfill_curated(conn)
        rebuild_sku_nullable(conn)          # Task 3 — runs inside this same tx
        conn.execute("COMMIT")
        conn.execute("PRAGMA foreign_keys=ON")
        print(f"added {len(NEW_COLUMNS)} columns; backfilled {n} curated rows; "
              f"rebuilt critic_scores with nullable sku")
        return 0
    except Exception as e:
        conn.rollback()   # DB-API method — safe no-op if no tx is active
        print(f"ERROR — rolled back: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2.2: Confirm the script imports/parses (do NOT run it end-to-end yet)**

⚠️ `main()` references `rebuild_sku_nullable`, which is **added in Task 3**. Running the script end-to-end now would `NameError`. So Task 2's check is parse-only; the first real dry-run happens in Step 3.2 once the rebuild function exists.

Run: `.venv/bin/python -c "import ast; ast.parse(open('scripts/migrate_critic_scores_schema.py').read()); print('parses OK')"`
Expected: `parses OK`. (The full ALTER+backfill+rebuild dry-run and its provenance/score_native/badge verification are Steps 3.2-3.3 — deferred here because the script isn't complete until Task 3.)

  The end-to-end dry-run and its provenance / score_native / badge verification
  are **deferred to Steps 3.2-3.3** (the script is only runnable once Task 3 adds
  `rebuild_sku_nullable`).

- [ ] **Step 2.3: Commit (partial script — completed in Task 3)**

```bash
git add scripts/migrate_critic_scores_schema.py
git commit -m "feat(critic-reviews): migration script — rich columns + curated backfill (§15 steps 1-2)"
```

---

## Task 3: Table-rebuild for nullable `sku` (Step 3 of §15)

SQLite cannot drop a `NOT NULL` constraint with `ALTER`; it needs the documented 12-step rebuild. Append this to the migration script so the full migration is one atomic run.

**Files:**
- Modify: `scripts/migrate_critic_scores_schema.py`

- [ ] **Step 3.1: Add the rebuild function**

Add to `scripts/migrate_critic_scores_schema.py`. ⚠️ This function runs **inside the single transaction `main()` already opened** (Task 2's refactor) — it must NOT open its own `BEGIN`/`COMMIT` or touch `PRAGMA foreign_keys` (main() owns both). The new table includes the rich columns inline and `sku TEXT` *without* NOT NULL; all other columns and indexes are recreated:

```python
def rebuild_sku_nullable(conn) -> None:
    """SQLite can't drop NOT NULL via ALTER — rebuild the table with nullable sku.
    Preserves all rows + all (now-migrated) columns + indexes. Runs inside the
    caller's transaction (no BEGIN/COMMIT/PRAGMA here)."""
    conn.execute("""
        CREATE TABLE critic_scores_new (
          id            TEXT PRIMARY KEY,
          sku           TEXT,                       -- now NULLABLE (scraped rows bind by producer+cuvee+vintage)
          critic        TEXT NOT NULL,
          score         REAL NOT NULL,
          score_max     REAL NOT NULL DEFAULT 100,
          vintage       TEXT,
          tasting_year  INTEGER,
          source_url    TEXT,
          notes         TEXT,
          added_by      TEXT,
          added_at      TEXT DEFAULT CURRENT_TIMESTAMP,
          source        TEXT,
          score_native  TEXT,
          score_scale   TEXT,
          signal_class  TEXT,
          signal_tier   INTEGER,
          supporting_text TEXT,
          confidence    REAL,
          producer      TEXT,
          cuvee         TEXT,
          fetched_at    TEXT
        )
    """)
    conn.execute("""
        INSERT INTO critic_scores_new
          (id, sku, critic, score, score_max, vintage, tasting_year, source_url,
           notes, added_by, added_at, source, score_native, score_scale,
           signal_class, signal_tier, supporting_text, confidence, producer,
           cuvee, fetched_at)
        SELECT
           id, sku, critic, score, score_max, vintage, tasting_year, source_url,
           notes, added_by, added_at, source, score_native, score_scale,
           signal_class, signal_tier, supporting_text, confidence, producer,
           cuvee, fetched_at
        FROM critic_scores
    """)
    conn.execute("DROP TABLE critic_scores")
    conn.execute("ALTER TABLE critic_scores_new RENAME TO critic_scores")
    conn.execute("CREATE INDEX idx_critic_scores_sku ON critic_scores (sku)")
    conn.execute("CREATE INDEX idx_critic_scores_critic_score ON critic_scores (critic, score DESC)")
    # NO COMMIT / PRAGMA here — main() owns the single transaction (Task 2 refactor).
```

`main()` already calls `rebuild_sku_nullable(conn)` inside its transaction (see the Task 2 `main()` body) — no further wiring needed for Step 3.

- [ ] **Step 3.2: Re-run the full migration on a FRESH copy**

Run:
```bash
cp data/db/products.db /tmp/migrate_test2.db
.venv/bin/python scripts/migrate_critic_scores_schema.py --db /tmp/migrate_test2.db --no-backup
```
Expected (one line): `added 10 columns; backfilled 3144 curated rows; rebuilt critic_scores with nullable sku`

- [ ] **Step 3.3: Verify the migrated copy — nullable sku, rows/indexes/badges, AND provenance/score_native (the checks deferred from Task 2)**

Run:
```bash
.venv/bin/python - <<'PY'
import sqlite3
c = sqlite3.connect("/tmp/migrate_test2.db")
notnull = [r for r in c.execute("PRAGMA table_info(critic_scores)") if r[1]=="sku"][0][3]
print("sku notnull flag (want 0):", notnull)                                   # 0
print("rows:", c.execute("SELECT count(*) FROM critic_scores").fetchone()[0])  # 3144
print("null provenance:", c.execute("SELECT count(*) FROM critic_scores WHERE source IS NULL").fetchone()[0])  # 0
print("sample native:", c.execute("SELECT score, score_native FROM critic_scores LIMIT 3").fetchall())  # (91.0,'91')...
bad = c.execute("""SELECT count(*) FROM critic_scores WHERE added_by LIKE 'magento_csv%'
  AND score = CAST(score AS INTEGER) AND score_native <> CAST(CAST(score AS INTEGER) AS TEXT)""").fetchone()[0]
print("score_native corrupted (want 0):", bad)                                 # 0
print("indexes:", [r[1] for r in c.execute("PRAGMA index_list(critic_scores)")])
print("badges:", c.execute("SELECT count(*) FROM products WHERE score_summary IS NOT NULL").fetchone()[0])  # 1550
# prove a null-sku insert now works (then roll back)
c.execute("INSERT INTO critic_scores (id,critic,score,producer,cuvee) VALUES ('t','X',90,'p','c')")
print("null-sku insert OK")
c.rollback()
PY
```
Expected: sku notnull flag = 0, rows=3144, null provenance=0, native values are integer strings (`'91'` not `'91.0'`), score_native corrupted=0, both indexes present, badges=1550, `null-sku insert OK`.

- [ ] **Step 3.4: Verify re-run guard works (run-once safety)**

Run: `.venv/bin/python scripts/migrate_critic_scores_schema.py --db /tmp/migrate_test2.db --no-backup`
Expected: `ALREADY MIGRATED (source column present) — aborting (run-once).` and exit code 2.

- [ ] **Step 3.5: Commit**

```bash
git add scripts/migrate_critic_scores_schema.py
git commit -m "feat(critic-reviews): migration step 3 — table-rebuild for nullable sku (§15)"
```

---

## Task 4: Update the CSV loader for the new columns

The loader (`scripts/load_critic_scores_from_csv.py`) must populate the rich columns on future runs, or a re-run leaves new rows with NULL provenance and the invariant test (Task 1) fails.

**Files:**
- Modify: `scripts/load_critic_scores_from_csv.py`

- [ ] **Step 4.1: Read the current loader INSERT to anchor the edit**

Run: `sed -n '108,160p' scripts/load_critic_scores_from_csv.py`
Note the `score_rows.append((...))` tuple (line ~114) and the `INSERT INTO critic_scores (...) VALUES (?,?,?,?,?,?,?,?,?,?)` (line ~144). The edit adds the new columns to both.

- [ ] **Step 4.2: Update the INSERT to populate rich columns**

In `scripts/load_critic_scores_from_csv.py`, change the `score_rows.append(...)` tuple and the matching `INSERT` so each row also sets `source='magento_csv'`, `score_native=clean(raw_cell)` (the AS-PUBLISHED string — NOT a re-CAST), `score_scale='100pt'`, `signal_class='critic_numeric'`, `signal_tier=1`, `confidence=1.0`, `supporting_text=NULL`, `fetched_at` = now-ISO. `producer`/`cuvee` stay NULL (CSV rows are sku-bound, not natural-key-bound).

Append columns to the INSERT (keep existing 10, add the rich ones):
```python
    cur.executemany(
        """INSERT INTO critic_scores
           (id, sku, critic, score, score_max, vintage, tasting_year,
            source_url, notes, added_by,
            source, score_native, score_scale, signal_class, signal_tier,
            confidence, supporting_text, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)""",
        score_rows,
    )
```
And extend the `score_rows.append(...)` tuple to match (in `main()`'s parse loop), using the raw cell string for `score_native`:
```python
                score_rows.append(
                    (row_id, sku, critic_name, score, 100.0, vintage,
                     None, None, notes, SOURCE_TAG,
                     "magento_csv", clean(row.get(score_col)), "100pt",
                     "critic_numeric", 1, 1.0, None,
                     datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"))
                )
```
(`datetime`/`timezone` are already imported at the top of the loader.)

- [ ] **Step 4.3: Verify loader is idempotent + populates new columns, on a migrated copy**

Run (uses the migrated copy from Task 3 + the real CSV; the loader's DELETE-by-`SOURCE_TAG` makes it idempotent):
```bash
cp /tmp/migrate_test2.db /tmp/loader_test.db
.venv/bin/python scripts/load_critic_scores_from_csv.py \
  "/Users/admin/Downloads/Wine score magento - WIne score_15.06.2026.csv" \
  --db /tmp/loader_test.db
.venv/bin/python - <<'PY'
import sqlite3
c = sqlite3.connect("/tmp/loader_test.db")
print("rows:", c.execute("SELECT count(*) FROM critic_scores").fetchone()[0])         # 3144 (re-inserted, not duplicated)
print("null provenance:", c.execute("SELECT count(*) FROM critic_scores WHERE source IS NULL").fetchone()[0])  # 0
print("native sample:", c.execute("SELECT score, score_native FROM critic_scores LIMIT 3").fetchall())
print("badges:", c.execute("SELECT count(*) FROM products WHERE score_summary IS NOT NULL").fetchone()[0])  # 1550
PY
```
Expected: rows=3144 (DELETE+re-INSERT, no dupes), null provenance=0, native = integer strings, badges=1550.

- [ ] **Step 4.4: Confirm scoring-engine tests still pass (string score_native)**

Run: `.venv/bin/python -m pytest tests/curation/test_scoring_engine.py -v`
Expected: all PASS (the engine already parses `score_native` as a string in its fallback path — this confirms the migration's string native values don't break ranking).

- [ ] **Step 4.5: Commit**

```bash
git add scripts/load_critic_scores_from_csv.py
git commit -m "feat(critic-reviews): CSV loader populates rich schema columns (score_native as-published)"
```

---

## Task 5: Run the migration on the LIVE DB + verify it shipped (Rules 1, 9, 10)

Only now do we touch the real `products.db`. Everything above ran on copies.

- [ ] **Step 5.1: Snapshot the live badge SKU set BEFORE migration (for the pre/post identity check)**

Run:
```bash
.venv/bin/python - <<'PY'
import sqlite3, json
c = sqlite3.connect("data/db/products.db")
skus = sorted(r[0] for r in c.execute(
  "SELECT sku FROM products WHERE score_summary IS NOT NULL"))
json.dump(skus, open("/tmp/badge_skus_before.json","w"))
print("snapshotted", len(skus), "badge SKUs")   # 1550
PY
```
Expected: `snapshotted 1550 badge SKUs`

- [ ] **Step 5.2: Run the migration on the live DB (backup is automatic, Rule 10)**

Run: `.venv/bin/python scripts/migrate_critic_scores_schema.py`
Expected: `backup -> data/db/products.db.bak-pre-critic-migration`, then `added 10 columns; backfilled 3144 curated rows`, then `rebuilt critic_scores with nullable sku`. Exit code 0.

- [ ] **Step 5.3: Assert the badge SKU set is IDENTICAL pre/post (not just the count)**

Run:
```bash
.venv/bin/python - <<'PY'
import sqlite3, json
before = set(json.load(open("/tmp/badge_skus_before.json")))
c = sqlite3.connect("data/db/products.db")
after = set(r[0] for r in c.execute(
  "SELECT sku FROM products WHERE score_summary IS NOT NULL"))
assert before == after, f"badge set CHANGED: -{len(before-after)} +{len(after-before)}"
print("badge SKU set identical:", len(after))   # 1550
PY
```
Expected: `badge SKU set identical: 1550`. If this fails, restore from `.bak-pre-critic-migration` and investigate — do NOT proceed.

- [ ] **Step 5.4: Refresh the live export (Rule 9)**

Run: `.venv/bin/python scripts/refresh_live_export.py`
Expected: completes without error.

- [ ] **Step 5.5: Layer-3 destination probe — verify in the export the UI reads (Rule 1)**

Run:
```bash
.venv/bin/python -c "import json;print('export badges:', sum(1 for p in json.load(open('data/live_products_export.json')) if p.get('score_summary')))"
```
Expected: `export badges: 1550`. This is THE number that matters (Rule 1) — DB column populated is not enough; the export the UI reads must still show 1,550.

- [ ] **Step 5.6: Run the full invariant test against the migrated live DB**

Run: `.venv/bin/python -m pytest tests/critic_reviews/integration -v`
Expected: all 4 tests PASS now (the two post-migration tests no longer skip — columns exist).

- [ ] **Step 5.7: Browser spot-check (Rule 7) — 3 known badged SKUs**

Pick 3 SKUs from `/tmp/badge_skus_before.json` (e.g. `WSP1112BU`, `WRW1649BU`, `WRW6598GX`). Run `npm run dev`, open each product page, confirm the critic badges still render exactly as before. Record sign-off.

- [ ] **Step 5.8: Commit the export + migration artifacts (NOT the DB — it's gitignored)**

⚠️ `data/db/products.db` is gitignored (`.gitignore` line 43) and untracked — `git add data/db/products.db` would **silently no-op** (git ignores it without `-f`), making a "committed the DB" claim false. The repo convention is: the DB is **not** version-controlled; it is reproduced by running the migration script. So commit only the tracked, user-facing artifact (the refreshed export) plus the script/tests:

```bash
git add data/live_products_export.json
git commit -m "chore(critic-reviews): refresh live export after rich-schema migration (1,550 badges preserved)"
```

The migration ships as **`scripts/migrate_critic_scores_schema.py` + the invariant test + this refreshed export** (all committed in Tasks 1-4 / here). Each machine reproduces the migrated DB by running the script once. The local backup `data/db/products.db.bak-pre-critic-migration` (also gitignored via `.gitignore` `*.bak-*`) is the rollback artifact — intentionally local, not committed.

---

## Done criteria (all must hold)

- [ ] `critic_scores` has the 10 new columns; `sku` is nullable; both indexes present.
- [ ] All 3,144 curated rows present with `source='magento_csv'`, `signal_tier=1`, `confidence=1.0`, `score_native` as published.
- [ ] **Live export shows exactly 1,550 badges** (Layer-3, Rule 1) — same SKU set as before.
- [ ] `tests/critic_reviews/integration` 4/4 pass; `tests/curation/test_scoring_engine.py` passes.
- [ ] Backup `products.db.bak-pre-critic-migration` exists.
- [ ] Browser spot-check on 3 SKUs signed off (Rule 7).

## Next plan (not this one)
Track 2 — source-precedence merge (§16) in `refresh_products_summary.py`. Must land before any non-CSV source writes. Write that plan after this migration is verified live.
