# Image URL Refresh + magento_item_url / websites Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh `products.db.image_url` from a newer, larger CSV and add two new fields — `magento_item_url` (live storefront product page link) and `websites` (which storefront(s) a SKU is listed on) — sourced from the same CSV, flowing through to both live exports.

**Architecture:** Copy the user's CSV into the repo as the new source-of-truth file. Add an idempotent schema migration for the two new columns. Extend the existing `reconcile_image_urls.py` script (not a new script) to read the new CSV and reconcile all three fields with per-field semantics: `image_url` keeps its legacy "blank CSV value blanks the DB" behavior (currently dormant — 0/17,682 CSV rows are blank — but kept and tested since it's still load-bearing for future CSV refreshes); `magento_item_url`/`websites` are new fields that mirror the CSV exactly, including blanks, since there's no prior "known-good" value to protect. Extend the existing regression test (`tests/test_image_url_invariants.py`) to point at the new CSV and cover all three fields. Add both new fields to both export scripts' `EXPORT_COLS` allowlists.

**Tech Stack:** Python 3, sqlite3, csv (stdlib), pytest.

**Spec:** `docs/superpowers/specs/2026-07-24-image-and-item-url-refresh-design.md`

---

## File Structure

- **Create:** `data/data mastefile WNLQ9/winenow-base-images-20260724.csv` — the new source-of-truth CSV, copied into the repo (not read from `~/Downloads`).
- **Create:** `scripts/migrate_add_item_url_websites.py` — idempotent schema migration adding `magento_item_url` and `websites` columns. Follows the exact pattern of `scripts/migrate_spirits_fields.py`.
- **Modify:** `scripts/reconcile_image_urls.py` — repoint `IMGCSV` at the new file, update `load_master()` to read the new column names, add reconciliation logic for `magento_item_url` and `websites`, extend dry-run reporting and post-write verification to cover all three fields.
- **Modify:** `tests/test_image_url_invariants.py` — repoint at the new CSV, extend `_master()` to carry all three fields, add positive/negative/untouched-SKU test cases for the two new fields per the spec's Testing section.
- **Modify:** `scripts/refresh_live_export.py` — add `"magento_item_url", "websites"` to `EXPORT_COLS`.
- **Modify:** `scripts/refresh_live_export_supabase.py` — add `"magento_item_url", "websites"` to `EXPORT_COLS`.

---

### Task 1: Copy the new CSV into the repo

**Files:**
- Create: `data/data mastefile WNLQ9/winenow-base-images-20260724.csv`

- [ ] **Step 1: Copy the file**

Run:
```bash
cp "/Users/admin/Downloads/winenow-base-images-20260724-f3f2d67e3e2662f9cffc80069e5290a4.csv" \
   "data/data mastefile WNLQ9/winenow-base-images-20260724.csv"
```

- [ ] **Step 2: Verify row count and header match expectations**

Run:
```bash
wc -l "data/data mastefile WNLQ9/winenow-base-images-20260724.csv"
head -1 "data/data mastefile WNLQ9/winenow-base-images-20260724.csv"
```
Expected: `17683` lines (17,682 data rows + header), header
`sku,item_name,websites,base_image_url,item_url`

- [ ] **Step 3: Commit**

```bash
git add "data/data mastefile WNLQ9/winenow-base-images-20260724.csv"
git commit -m "data: add winenow-base-images-20260724 CSV (image/item_url/websites source)"
```

---

### Task 2: Schema migration — add magento_item_url and websites columns

**Files:**
- Create: `scripts/migrate_add_item_url_websites.py`
- Test: manual verification via `PRAGMA table_info` (no separate pytest file — this mirrors how `migrate_spirits_fields.py` is verified elsewhere in this repo; schema migrations aren't unit-tested here, they're run-and-verify)

- [ ] **Step 1: Write the migration script**

```python
#!/usr/bin/env python3
"""
Add magento_item_url and websites columns to the products table.

magento_item_url: the live storefront product-page URL (from the
"winenow-base-images" CSV's item_url column).
websites: raw string of which storefront(s) a SKU is listed on (e.g.
"Wine-now & Liq9, Wine-now.asia") — stored as-is, not parsed/structured.

Safe to run multiple times: before each ALTER TABLE, a Python-side
`PRAGMA table_info(products)` check confirms the column doesn't already
exist (SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS clause) —
columns already present are skipped and reported as "Already exists".

NOTE: Always pass --db explicitly when running from a git worktree; the
default path resolves relative to the script and can point at the wrong
DB (e.g. a stray 0-byte auto-created file in a worktree checkout).
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

NEW_COLS = [
    ('magento_item_url', 'TEXT'),
    ('websites',         'TEXT'),
]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    # Guard against the worktree/stray-empty-DB trap: sqlite3.connect() will
    # silently auto-create an empty SQLite file if the path doesn't already
    # exist as a real DB, and a 0-byte file would pass the .exists() check
    # above. Refuse to migrate unless the products table actually exists AND
    # has rows. (CLAUDE.md Rule 1.)
    probe = sqlite3.connect(args.db)
    try:
        has_table = probe.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='products'"
        ).fetchone()[0]
        row_count = probe.execute("SELECT count(*) FROM products").fetchone()[0] if has_table else 0
    finally:
        probe.close()
    if not has_table or row_count == 0:
        print(
            f"ERROR: {args.db} has no populated products table "
            f"(has_table={bool(has_table)}, rows={row_count}). Refusing to migrate "
            f"— pass --db with the real database path. This guards the worktree/"
            f"empty-DB trap (CLAUDE.md Rule 1).",
            file=sys.stderr,
        )
        return 1

    print(f"Target DB: {args.db} ({row_count} products)")

    con = sqlite3.connect(args.db)
    try:
        existing = {r[1] for r in con.execute("PRAGMA table_info(products)")}
        for col, coltype in NEW_COLS:
            if col in existing:
                print(f"  {col}: already exists, skipping")
                continue
            con.execute(f"ALTER TABLE products ADD COLUMN {col} {coltype}")
            print(f"  {col}: added ({coltype})")
        con.commit()
    finally:
        con.close()

    print("Migration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it against the real DB**

Run: `.venv/bin/python scripts/migrate_add_item_url_websites.py`
Expected output: `Target DB: .../products.db (11934 products)` followed by
`magento_item_url: added (TEXT)` and `websites: added (TEXT)`, then
`Migration complete.`

- [ ] **Step 3: Verify the columns exist**

Run:
```bash
.venv/bin/python -c "
import sqlite3
con = sqlite3.connect('data/db/products.db')
cols = [r[1] for r in con.execute('PRAGMA table_info(products)')]
assert 'magento_item_url' in cols
assert 'websites' in cols
print('OK: both columns present')
"
```
Expected: `OK: both columns present`

- [ ] **Step 4: Run it again to confirm idempotency**

Run: `.venv/bin/python scripts/migrate_add_item_url_websites.py`
Expected: both columns report `already exists, skipping`, script still
exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_add_item_url_websites.py
git commit -m "feat: add magento_item_url and websites columns to products table"
```

---

### Task 3: Extend reconcile_image_urls.py for the new CSV and new fields

**Files:**
- Modify: `scripts/reconcile_image_urls.py` (full rewrite of the file — it's small, ~120 lines, cleaner than patchwork edits)

- [ ] **Step 1: Rewrite the script**

Replace the full contents of `scripts/reconcile_image_urls.py` with:

```python
#!/usr/bin/env python3
"""Reconcile products.db image_url / magento_item_url / websites against
the winenow-base-images CSV.

WHY image_url RECONCILIATION EXISTS (recurring bug — see commits cfeb215,
e9e11c9, 0f4b327, edcf1fd):
Many distinct products had image_url pointing at ANOTHER SKU's bottle image
(e.g. 40+ wines all showing wrw6567gx.jpg = Riporta Nero D'Avola). A prior fix
reconciled the export + seed json + masterfile, but products.db got reverted/
re-seeded from a stale source afterward, resurrecting the wrong bottles.

SOURCE OF TRUTH: data/data mastefile WNLQ9/winenow-base-images-20260724.csv
(sku, item_name, websites, base_image_url, item_url). As of 2026-07-24 this
CSV has 0 blank base_image_url values, unlike the older masterfile image CSV
it replaces (which used blank='' to mean "intentionally no image"). The
blank-means-intentionally-blank / blank-the-DB behavior for image_url is kept
in this script (guarded, currently dormant) because a future refresh of this
same CSV could legitimately carry a blank for a delisted SKU — see CLAUDE.md
Rule 3 on not deleting behavior just because it's untriggered by today's data.

magento_item_url and websites are NEW fields with no prior "known-good" value
to protect, so they mirror the CSV exactly for any SKU present in it
(including blanking out on an empty CSV cell) rather than following
image_url's leave-alone-if-blank convention.

For ALL THREE fields: a SKU present in products.db but ABSENT from the CSV
entirely is left untouched (no_master rule) — this CSV does not cover every
existing SKU (141 known gaps as of 2026-07-24, 48 of which currently have a
populated image_url).

This script is idempotent. Run with --apply to write; default is dry-run.
After --apply you MUST run scripts/refresh_live_export.py (Rule 9).
"""
import argparse
import csv
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "products.db"
IMGCSV = ROOT / "data" / "data mastefile WNLQ9" / "winenow-base-images-20260724.csv"

SKU_RE = re.compile(r"/([a-z0-9_]+)\.jpg", re.I)

FIELDS = ("image_url", "magento_item_url", "websites")
CSV_COL_FOR_FIELD = {
    "image_url": "base_image_url",
    "magento_item_url": "item_url",
    "websites": "websites",
}


def img_token(url: str) -> str:
    """Filename stem of an image URL, lowercased (for comparison/logging)."""
    if not url:
        return ""
    m = SKU_RE.search(url)
    return m.group(1).lower() if m else url.lower()


def load_master() -> dict:
    """sku(upper) -> {field: csv value string} for all three FIELDS."""
    good = {}
    with open(IMGCSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip().upper()
            if not sku:
                continue
            good[sku] = {
                field: (row.get(csv_col) or "").strip()
                for field, csv_col in CSV_COL_FOR_FIELD.items()
            }
    return good


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default dry-run)")
    args = ap.parse_args()

    good = load_master()
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    rows = cur.execute(
        "SELECT sku, image_url, magento_item_url, websites FROM products"
    ).fetchall()

    # fixes[field] = list of (sku, old, new)
    fixes = {field: [] for field in FIELDS}
    no_master = []  # SKUs absent from CSV entirely — left untouched, all fields

    for r in rows:
        sku = (r["sku"] or "").strip()
        if not sku:
            continue
        master = good.get(sku.upper())
        if master is None:
            # Every SKU absent from the CSV counts here, regardless of
            # whether any field is currently populated in the DB — this
            # must equal the disclosed 141-SKU coverage gap on every run,
            # not just the subset that happens to have a populated
            # image_url today (magento_item_url/websites are NULL for
            # every row before the first reconcile, so gating on "any
            # field truthy" would undercount to 48 pre-reconcile and
            # change again after — always count the SKU itself).
            no_master.append(sku)
            continue
        for field in FIELDS:
            db_val = (r[field] or "").strip()
            csv_val = master[field]
            if db_val.lower() != csv_val.lower():
                fixes[field].append((sku, db_val, csv_val))

    print(f"DB rows: {len(rows)}  CSV SKUs: {len(good)}")
    for field in FIELDS:
        print(f"{field}: {len(fixes[field])} SKUs need reconcile")
    print(f"(SKU absent from CSV entirely, left untouched across all fields: {len(no_master)})")
    print()

    for field in FIELDS:
        print(f"--- {field} changes (first 40) ---")
        for sku, old, new in fixes[field][:40]:
            if field == "image_url":
                old_disp, new_disp = img_token(old), (img_token(new) or "(BLANK)")
            else:
                old_disp, new_disp = (old or "(BLANK)"), (new or "(BLANK)")
            print(f"  {sku:12s} {old_disp!s:40.40s} -> {new_disp}")
        if len(fixes[field]) > 40:
            print(f"  ... and {len(fixes[field]) - 40} more")
        print()

    if fixes["image_url"]:
        blanked = sum(1 for _s, _o, new in fixes["image_url"] if not new)
        print(f"image_url blank-out count this run: {blanked} "
              f"({'dormant, as expected' if blanked == 0 else 'ACTIVE — review before applying'})")

    if not args.apply:
        print("\nDRY RUN — re-run with --apply to write, then refresh_live_export.py "
              "and refresh_live_export_supabase.py")
        con.close()
        return 0

    for field in FIELDS:
        if not fixes[field]:
            continue
        cur.executemany(
            f"UPDATE products SET {field} = ? WHERE sku = ?",
            [(new, sku) for sku, _old, new in fixes[field]],
        )
    con.commit()

    # Verify the write landed (Rule 1): re-query and assert invariant, per field.
    bad = 0
    for field in FIELDS:
        for sku, _old, new in fixes[field]:
            got = cur.execute(
                f"SELECT {field} FROM products WHERE sku = ?", (sku,)
            ).fetchone()[0]
            if (got or "").lower() != new.lower():
                bad += 1
                print(f"  !! STILL WRONG: {field} {sku} -> {got!r}")
    con.close()

    if bad:
        print(f"\nFAILED: {bad} rows did not take the update")
        return 1

    total = sum(len(fixes[f]) for f in FIELDS)
    print(f"\nApplied {total} corrections across {len(FIELDS)} fields. "
          f"Now run: .venv/bin/python scripts/refresh_live_export.py "
          f"&& .venv/bin/python scripts/refresh_live_export_supabase.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Dry run and inspect output**

Run: `.venv/bin/python scripts/reconcile_image_urls.py`

Expected: prints DB row count, CSV SKU count, per-field reconcile counts
(image_url / magento_item_url / websites), the no-master count (should be
141, matching the spec's disclosed gap), sample diffs per field, and the
image_url blank-out count (should read "0 (dormant, as expected)" — if
it's nonzero, stop and investigate before applying, since that's new,
unverified behavior firing for the first time).

- [ ] **Step 3: Apply**

Run: `.venv/bin/python scripts/reconcile_image_urls.py --apply`

Expected: same summary, no `!! STILL WRONG` lines, ends with `Applied N
corrections across 3 fields.`

- [ ] **Step 4: Verify via direct SQL count queries (Rule 1)**

Run:
```bash
.venv/bin/python -c "
import sqlite3
con = sqlite3.connect('data/db/products.db')
for field in ('image_url', 'magento_item_url', 'websites'):
    n = con.execute(f\"SELECT COUNT(*) FROM products WHERE {field} IS NOT NULL AND {field} != ''\").fetchone()[0]
    print(f'{field}: {n} populated')
"
```
Expected: three counts printed, all nonzero and consistent with the
dry-run reconcile counts reported in Step 2 (magento_item_url and
websites populated counts should each be in the same ballpark as
"CSV SKUs" minus the no-master count, since almost every CSV row is
non-blank for these two fields per Task 1's row-count check).

- [ ] **Step 5: Run --apply again to confirm idempotency**

Run: `.venv/bin/python scripts/reconcile_image_urls.py --apply`
Expected: all three per-field reconcile counts now 0 (nothing left to
fix), no-master count unchanged (141), exits 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/reconcile_image_urls.py
git commit -m "feat: reconcile image_url/magento_item_url/websites from new CSV"
```

---

### Task 4: Extend the regression test for all three fields

**Files:**
- Modify: `tests/test_image_url_invariants.py` (full rewrite — same reasoning as Task 3, the file is small and the changes touch most of it)

- [ ] **Step 1: Write the failing/updated tests**

Replace the full contents of `tests/test_image_url_invariants.py` with:

```python
"""Regression guard for image_url / magento_item_url / websites reconciliation.

History: products kept showing ANOTHER product's bottle (e.g. 40+ wines all
rendering wrw6567gx.jpg = Riporta Nero D'Avola). Fixed repeatedly (commits
0f4b327, edcf1fd, e9e11c9, cfeb215) but resurrected each time because a re-seed
or DB revert reintroduced the borrowed URLs and NOTHING failed when it did.

data/data mastefile WNLQ9/winenow-base-images-20260724.csv is the curated
source of truth (see scripts/reconcile_image_urls.py). These tests assert
downstream sources agree with it, so a regression breaks the build (Rule 6)
instead of silently shipping the wrong bottle or a stale/missing item_url.

Run: python -m pytest tests/test_image_url_invariants.py -q
"""
import csv
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "products.db"
EXPORT = ROOT / "data" / "live_products_export.json"
IMGCSV = ROOT / "data" / "data mastefile WNLQ9" / "winenow-base-images-20260724.csv"

FIELDS = ("image_url", "magento_item_url", "websites")
CSV_COL_FOR_FIELD = {
    "image_url": "base_image_url",
    "magento_item_url": "item_url",
    "websites": "websites",
}


def _master():
    """sku(upper) -> {field: csv value lowercased}."""
    good = {}
    with open(IMGCSV, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sku = (row.get("sku") or "").strip().upper()
            if not sku:
                continue
            good[sku] = {
                field: (row.get(csv_col) or "").strip().lower()
                for field, csv_col in CSV_COL_FOR_FIELD.items()
            }
    return good


def _disagreements(rows, master, field):
    """rows: iterable of (sku, value_for_field). Returns list of (sku, got, want)."""
    bad = []
    for sku, val in rows:
        su = (sku or "").strip().upper()
        if su not in master:
            continue  # SKU not in CSV — out of scope (no_master rule)
        want = master[su][field]
        got = (val or "").strip().lower()
        if got != want:
            bad.append((sku, got, want))
    return bad


@pytest.fixture(scope="module")
def master():
    assert IMGCSV.exists(), f"source CSV missing: {IMGCSV}"
    return _master()


@pytest.mark.parametrize("field", FIELDS)
def test_db_fields_match_csv(master, field):
    con = sqlite3.connect(DB)
    rows = con.execute(f"SELECT sku, {field} FROM products").fetchall()
    con.close()
    bad = _disagreements(rows, master, field)
    assert not bad, (
        f"{len(bad)} products.db {field} value(s) disagree with source CSV. "
        f"First 10: {bad[:10]}. Fix: python scripts/reconcile_image_urls.py --apply"
    )


@pytest.mark.parametrize("field", FIELDS)
def test_export_fields_match_csv(master, field):
    raw = json.loads(EXPORT.read_text())
    items = raw if isinstance(raw, list) else raw.get("products", raw)
    rows = [(p.get("sku"), p.get(field)) for p in items if isinstance(p, dict)]
    bad = _disagreements(rows, master, field)
    assert not bad, (
        f"{len(bad)} live_products_export.json {field} value(s) disagree with "
        f"source CSV. First 10: {bad[:10]}. "
        f"Fix: reconcile DB then run scripts/refresh_live_export.py"
    )


def test_image_url_blank_out_behavior(tmp_path, monkeypatch):
    """Regression test for the legacy blank-out path, which is DORMANT on the
    real CSV (0/17,682 rows have a blank base_image_url as of 2026-07-24) but
    still load-bearing code (CLAUDE.md Rule 3 — don't delete an inherited
    behavior just because current data never exercises it). Runs the REAL
    reconcile_image_urls.main() against a throwaway copy of products.db and a
    synthetic CSV, so the path is provably still correct — this is not a
    tautology check against hand-built locals, it executes the actual UPDATE
    statement and reads back the result.
    """
    import importlib.util
    import shutil

    # sku WDW0001AA has a populated image_url in products.db today (per Task 1
    # verification). Work on a throwaway copy so this test cannot mutate the
    # real DB.
    tmp_db = tmp_path / "products.db"
    shutil.copy(DB, tmp_db)
    con = sqlite3.connect(tmp_db)
    before = con.execute(
        "SELECT image_url, magento_item_url, websites FROM products WHERE sku = 'WDW0001AA'"
    ).fetchone()
    con.close()
    assert before and before[0], (
        "fixture assumption broken: WDW0001AA has no image_url in products.db "
        "— pick a different fixture SKU with a populated image_url"
    )

    # Synthetic CSV: one row for WDW0001AA with all three fields blank —
    # exercises the blank-out path for image_url specifically.
    tmp_csv = tmp_path / "synthetic.csv"
    tmp_csv.write_text(
        "sku,item_name,websites,base_image_url,item_url\n"
        "WDW0001AA,Test Product,,,\n",
        encoding="utf-8",
    )

    spec = importlib.util.spec_from_file_location(
        "reconcile_image_urls", ROOT / "scripts" / "reconcile_image_urls.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # Point the loaded module at our throwaway DB/CSV instead of the real ones.
    monkeypatch.setattr(mod, "DB", tmp_db)
    monkeypatch.setattr(mod, "IMGCSV", tmp_csv)
    monkeypatch.setattr("sys.argv", ["reconcile_image_urls.py", "--apply"])

    rc = mod.main()
    assert rc == 0, "reconcile script exited non-zero on synthetic fixture"

    con = sqlite3.connect(tmp_db)
    after = con.execute(
        "SELECT image_url, magento_item_url, websites FROM products WHERE sku = 'WDW0001AA'"
    ).fetchone()
    con.close()

    assert after == ("", "", ""), (
        f"expected all three fields blanked for WDW0001AA after reconciling "
        f"against an all-blank synthetic CSV row, got {after!r}"
    )


def test_sku_absent_from_csv_left_untouched():
    """A SKU in products.db but absent from the source CSV entirely must not
    be reported as a disagreement for any of the three fields — the no_master
    rule leaves it untouched rather than blanking it."""
    master = _master()
    con = sqlite3.connect(DB)
    all_skus = [r[0] for r in con.execute("SELECT sku FROM products").fetchall()]
    con.close()
    missing = [s for s in all_skus if (s or "").strip().upper() not in master]
    assert missing, (
        "expected some products.db SKUs to be absent from the source CSV "
        "(141 known as of 2026-07-24) — if this is now 0, the CSV coverage "
        "gap disclosed in the design spec has closed; update this test's "
        "expectations accordingly rather than deleting it"
    )
```

- [ ] **Step 2: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_image_url_invariants.py -v`

Expected: all tests PASS. `test_db_fields_match_csv[image_url]`,
`[magento_item_url]`, `[websites]` pass because Task 3 already
reconciled the DB. `test_export_fields_match_csv[*]` will FAIL at this
point — the export hasn't been refreshed yet (Task 5 does that). That's
expected; note it and continue, the export tests will pass after Task 5.

- [ ] **Step 3: Commit**

```bash
git add tests/test_image_url_invariants.py
git commit -m "test: extend image_url invariant guard to magento_item_url and websites"
```

---

### Task 5: Wire new fields into both export scripts

**Files:**
- Modify: `scripts/refresh_live_export.py` (EXPORT_COLS list, currently ends `"curation_dossier",` before the closing `]`)
- Modify: `scripts/refresh_live_export_supabase.py` (EXPORT_COLS list, currently ends `"created_at", "updated_at",` before the closing `]`)

- [ ] **Step 1: Add fields to refresh_live_export.py**

In `scripts/refresh_live_export.py`, find:
```python
    # Curation dossier — expert-reference content (style/expert note/producer
    # history/pairings). Populated via scripts/refresh_products_dossier.py,
    # which already gates out anything below 'sourced'/'pairing-theory'
    # confidence, so whatever lands here is safe to expose as-is.
    "curation_dossier",
]
```
Replace with:
```python
    # Curation dossier — expert-reference content (style/expert note/producer
    # history/pairings). Populated via scripts/refresh_products_dossier.py,
    # which already gates out anything below 'sourced'/'pairing-theory'
    # confidence, so whatever lands here is safe to expose as-is.
    "curation_dossier",
    # Live storefront product-page URL and per-SKU site placement — sourced
    # from data/data mastefile WNLQ9/winenow-base-images-20260724.csv via
    # scripts/reconcile_image_urls.py. websites is a raw string, not parsed.
    "magento_item_url", "websites",
]
```

- [ ] **Step 2: Add fields to refresh_live_export_supabase.py**

In `scripts/refresh_live_export_supabase.py`, find:
```python
    # Timestamps
    "created_at", "updated_at",
]
```
Replace with:
```python
    # Timestamps
    "created_at", "updated_at",
    # Live storefront product-page URL and per-SKU site placement — sourced
    # from data/data mastefile WNLQ9/winenow-base-images-20260724.csv via
    # scripts/reconcile_image_urls.py. websites is a raw string, not parsed.
    "magento_item_url", "websites",
]
```

- [ ] **Step 3: Run the live export refresh**

Run: `.venv/bin/python scripts/refresh_live_export.py`

Expected: no `WARN: skipping columns not in products table` line
mentioning `magento_item_url` or `websites` (the migration in Task 2
already added them, so they should be picked up cleanly).

- [ ] **Step 4: Verify via count queries against the export (Rule 1/Rule 9)**

Run:
```bash
.venv/bin/python -c "
import json
d = json.load(open('data/live_products_export.json'))
items = d if isinstance(d, list) else d.get('products', d)
for field in ('magento_item_url', 'websites', 'image_url'):
    n = sum(1 for p in items if p.get(field))
    print(f'{field}: {n} populated in export')
"
```
Expected: three nonzero counts, each matching (or very close to,
accounting for any stock-exclusion filtering already documented for
other fields) the DB counts from Task 3 Step 4.

- [ ] **Step 5: Re-run the invariant tests to confirm export now agrees**

Run: `.venv/bin/python -m pytest tests/test_image_url_invariants.py -v`

Expected: ALL tests pass now, including
`test_export_fields_match_csv[magento_item_url]` and
`test_export_fields_match_csv[websites]` which failed in Task 4 Step 2.

- [ ] **Step 6: If a Supabase instance is configured, run that export too**

Check whether `SUPABASE_URL`/`SUPABASE_KEY` env vars are set (see top of
`scripts/refresh_live_export_supabase.py` for the exact var names). If
configured:
```bash
.venv/bin/python scripts/refresh_live_export_supabase.py
```
If not configured, skip this step and note it — do not fabricate a
"verified" claim for a destination that was never actually written to.

- [ ] **Step 7: Commit**

```bash
git add scripts/refresh_live_export.py scripts/refresh_live_export_supabase.py
git commit -m "feat: export magento_item_url and websites in both live export scripts"
```

---

### Task 6: Final end-to-end verification and summary

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite for this area**

Run: `.venv/bin/python -m pytest tests/test_image_url_invariants.py -v`
Expected: all PASS.

- [ ] **Step 2: Produce the "what shipped to users" report (CLAUDE.md Rule 4)**

Run the count queries from Task 3 Step 4 and Task 5 Step 4 one more
time together, and report to the user:
- DB: `magento_item_url` populated count, `websites` populated count,
  `image_url` changed count (from the reconcile --apply run)
- Export: same three counts, confirmed matching DB
- The disclosed gap: 141 SKUs left untouched (48 with a pre-existing
  image_url), unchanged by this work
- Zero API/LLM spend this run (pure CSV reconciliation) — Rule 4's
  "per-successful-row cost" line is $0/row.

- [ ] **Step 3: Confirm git log shows all commits from this plan**

Run: `git log --oneline -8`
Expected: 6 commits from Tasks 1–5 visible (CSV add, migration, reconcile
script, test extension, export wiring — Task 5 is one commit covering
both export files).
