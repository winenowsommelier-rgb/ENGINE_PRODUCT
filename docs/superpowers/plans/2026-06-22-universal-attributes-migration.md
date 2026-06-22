# Universal Product Attribute — Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename wine-specific attribute columns to category-neutral names across SQLite, ~20 Python scripts, and Supabase; add four new sensory columns; drop two dead columns — with the build/sync green at every stage.

**Architecture:** One shared `ATTRIBUTE_MAP` (Python + mirrored TS) is the single source of truth for old→new names. Three stages, each independently verified: (1) databases — SQLite + Supabase rename together, (2) pipeline + Python readers flip via the map, (3) catalog TS rename driven by the compiler. DROP of dead columns is split into a separate reversible-safe migration.

**Tech Stack:** SQLite 3.43, Postgres 17 (Supabase, project `dsyplzckfezcxiuikkfm`), Python 3.9 + pytest, Next.js + TypeScript + vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-universal-product-attributes-design.md`

**Scope note:** This plan covers the SCHEMA MIGRATION only. The enrichment (Phase A rules, Phase B paid LLM) is a SEPARATE plan written after this lands and is verified. Enrichment depends on these columns existing.

---

## The rename map (authoritative)

| old | new | type |
|-----|-----|------|
| grape_variety | variety | text |
| grape_blend_type | blend_type | text |
| wine_body | body | text |
| wine_acidity | acidity | text |
| wine_tannin | tannin | text |
| wine_color | color | text |
| wine_production_style | production_style | ARRAY (pg) / JSON (sqlite,export) |

New columns (nullable text): `sweetness`, `intensity`, `smokiness`, `finish`.
Dropped (separate migration): `wine_type`, `other_type`.

---

## File Structure

- **Create** `data/lib/taxonomy/attribute_map.py` — `ATTRIBUTE_MAP`, `NEW_COLUMNS`, `DROPPED_COLUMNS`, helper `rename_key()`. Single responsibility: own the rename vocabulary.
- **Create** `apps/catalog/lib/attribute-map.ts` — mirror of the same constants for the catalog.
- **Create** `tests/test_attribute_map_parity.py` — assert Py and TS maps match (same pattern as `sku_taxonomy_cases.json` parity).
- **Create** `scripts/migrate_attribute_rename.py` — applies SQLite rename+add (idempotent, backup-first).
- **Modify** `scripts/refresh_live_export.py` — `EXPORT_COLS` (lines 52–60), `JSON_COLS` (line 75).
- **Modify** `scripts/sync_to_supabase.py` — `PRODUCT_SYNC_COLUMNS` (lines ~36–37).
- **Modify** every Python script that references an old column name (grep-derived list — Task 4).
- **Modify** `apps/catalog/lib/types.ts` (lines 39–58) + ~8 consumer files.
- **Modify** `apps/catalog/app/product/[sku]/page.tsx:258` (UI label).
- **Supabase**: two migrations via MCP `apply_migration` (rename+add; then drop later).

---

## Task 1: ATTRIBUTE_MAP seam (Python + TS + parity test)

**Files:**
- Create: `data/lib/taxonomy/attribute_map.py`
- Create: `apps/catalog/lib/attribute-map.ts`
- Test: `tests/test_attribute_map_parity.py`

- [ ] **Step 1: Write the failing parity test**

```python
# tests/test_attribute_map_parity.py
"""Guard: the Python ATTRIBUTE_MAP and the TS mirror must stay identical."""
import json, re
from pathlib import Path
from data.lib.taxonomy.attribute_map import ATTRIBUTE_MAP, NEW_COLUMNS, DROPPED_COLUMNS

TS = Path(__file__).resolve().parent.parent / "apps/catalog/lib/attribute-map.ts"

def _ts_object(name: str) -> str:
    src = TS.read_text()
    m = re.search(name + r"\s*=\s*(\{.*?\}|\[.*?\])", src, re.S)
    assert m, f"{name} not found in attribute-map.ts"
    return m.group(1)

def test_map_matches_ts():
    obj = _ts_object("ATTRIBUTE_MAP")
    # crude but sufficient: every old:new pair appears in the TS source
    for old, new in ATTRIBUTE_MAP.items():
        assert f'"{old}"' in obj or f"'{old}'" in obj, f"{old} missing in TS map"
        assert f'"{new}"' in obj or f"'{new}'" in obj, f"{new} missing in TS map"

def test_new_and_dropped_present_in_ts():
    for col in NEW_COLUMNS:
        assert f'"{col}"' in _ts_object("NEW_COLUMNS"), f"{col} missing in TS NEW_COLUMNS"
    for col in DROPPED_COLUMNS:
        assert f'"{col}"' in _ts_object("DROPPED_COLUMNS"), f"{col} missing in TS DROPPED_COLUMNS"
```

- [ ] **Step 2: Run test, verify it fails**

Run: `.venv/bin/python -m pytest tests/test_attribute_map_parity.py -v`
Expected: FAIL — `ModuleNotFoundError: data.lib.taxonomy.attribute_map`

- [ ] **Step 3: Create the Python map**

```python
# data/lib/taxonomy/attribute_map.py
"""Single source of truth for the wine_*→universal attribute rename.
Scripts import this instead of hardcoding column names. Mirror: apps/catalog/lib/attribute-map.ts."""
ATTRIBUTE_MAP = {
    "grape_variety": "variety",
    "grape_blend_type": "blend_type",
    "wine_body": "body",
    "wine_acidity": "acidity",
    "wine_tannin": "tannin",
    "wine_color": "color",
    "wine_production_style": "production_style",
}
NEW_COLUMNS = ["sweetness", "intensity", "smokiness", "finish"]
DROPPED_COLUMNS = ["wine_type", "other_type"]

def rename_key(key: str) -> str:
    """Map an old column/field name to its new name (identity if not renamed)."""
    return ATTRIBUTE_MAP.get(key, key)
```

- [ ] **Step 4: Create the TS mirror**

```typescript
// apps/catalog/lib/attribute-map.ts
// Mirror of data/lib/taxonomy/attribute_map.py. Parity guarded by tests/test_attribute_map_parity.py.
export const ATTRIBUTE_MAP: Record<string, string> = {
  grape_variety: "variety",
  grape_blend_type: "blend_type",
  wine_body: "body",
  wine_acidity: "acidity",
  wine_tannin: "tannin",
  wine_color: "color",
  wine_production_style: "production_style",
};
export const NEW_COLUMNS = ["sweetness", "intensity", "smokiness", "finish"] as const;
export const DROPPED_COLUMNS = ["wine_type", "other_type"] as const;
```

- [ ] **Step 5: Run test, verify it passes**

Run: `.venv/bin/python -m pytest tests/test_attribute_map_parity.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add data/lib/taxonomy/attribute_map.py apps/catalog/lib/attribute-map.ts tests/test_attribute_map_parity.py
git commit -m "feat(attrs): add ATTRIBUTE_MAP seam (py + ts) with parity test"
```

---

## Task 2: SQLite migration script (rename + add columns)

**Files:**
- Create: `scripts/migrate_attribute_rename.py`
- Test: `tests/test_migrate_attribute_rename.py`

- [ ] **Step 1: Write the failing test** (operates on a temp DB, not the real one)

```python
# tests/test_migrate_attribute_rename.py
import sqlite3, tempfile, os
from scripts.migrate_attribute_rename import migrate
from data.lib.taxonomy.attribute_map import ATTRIBUTE_MAP, NEW_COLUMNS

def _make_db(path):
    c = sqlite3.connect(path)
    cols = ", ".join(f"{old} TEXT" for old in ATTRIBUTE_MAP) + ", wine_type TEXT, other_type TEXT, sku TEXT"
    c.execute(f"CREATE TABLE products ({cols})")
    c.execute("INSERT INTO products (sku, grape_variety, wine_body) VALUES ('X','Chardonnay','Full')")
    c.commit(); c.close()

def test_rename_preserves_data_and_adds_columns():
    d = tempfile.mkdtemp(); p = os.path.join(d, "t.db")
    _make_db(p)
    migrate(p)
    c = sqlite3.connect(p); c.row_factory = sqlite3.Row
    cols = {r[1] for r in c.execute("PRAGMA table_info(products)")}
    for new in ATTRIBUTE_MAP.values():
        assert new in cols, f"{new} missing after rename"
    for old in ATTRIBUTE_MAP:
        assert old not in cols, f"{old} should be gone"
    for nc in NEW_COLUMNS:
        assert nc in cols, f"{nc} not added"
    row = c.execute("SELECT variety, body FROM products WHERE sku='X'").fetchone()
    assert row["variety"] == "Chardonnay" and row["body"] == "Full"  # data survived
    c.close()

def test_idempotent():
    d = tempfile.mkdtemp(); p = os.path.join(d, "t.db")
    _make_db(p); migrate(p); migrate(p)  # second run must not raise
```

- [ ] **Step 2: Run test, verify it fails**

Run: `.venv/bin/python -m pytest tests/test_migrate_attribute_rename.py -v`
Expected: FAIL — `ModuleNotFoundError: scripts.migrate_attribute_rename`

- [ ] **Step 3: Write the migration script**

```python
#!/usr/bin/env python3
"""Rename wine_* attribute columns → universal names + add new sensory columns.
Idempotent (checks current schema first). Does NOT drop wine_type/other_type —
that is a separate one-way migration. Backs up the real DB when run on it."""
from __future__ import annotations
import argparse, shutil, sqlite3, sys
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path: sys.path.insert(0, str(REPO))
from data.lib.taxonomy.attribute_map import ATTRIBUTE_MAP, NEW_COLUMNS

def migrate(db_path: str | Path) -> None:
    conn = sqlite3.connect(db_path)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    for old, new in ATTRIBUTE_MAP.items():
        if old in cols and new not in cols:
            conn.execute(f"ALTER TABLE products RENAME COLUMN {old} TO {new}")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    for nc in NEW_COLUMNS:
        if nc not in cols:
            conn.execute(f"ALTER TABLE products ADD COLUMN {nc} TEXT")
    conn.commit(); conn.close()

def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(REPO / "data" / "db" / "products.db"))
    ap.add_argument("--no-backup", action="store_true")
    a = ap.parse_args(argv)
    if not a.no_backup:
        from datetime import datetime  # local import; argless new() is fine here
        bak = f"{a.db}.bak-pre-attr-rename"
        shutil.copy2(a.db, bak); print(f"backup → {bak}")
    migrate(a.db); print("migration applied")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test, verify it passes**

Run: `.venv/bin/python -m pytest tests/test_migrate_attribute_rename.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_attribute_rename.py tests/test_migrate_attribute_rename.py
git commit -m "feat(attrs): idempotent SQLite rename+add migration with tests"
```

> **Index note:** an index `idx_products_grape_blend_type` exists on
> `grape_blend_type`. SQLite (3.25+) auto-rewrites the index's column reference on
> RENAME, so it keeps working on the now-`blend_type` column — no functional break.
> The index NAME stays stale (cosmetic). Optional: `DROP INDEX
> idx_products_grape_blend_type; CREATE INDEX idx_products_blend_type ON
> products(blend_type);`. Not required.

---

## Task 3: Apply migration to the REAL SQLite DB + Supabase (Stage 1)

**Files:** `data/db/products.db` (data), Supabase project `dsyplzckfezcxiuikkfm`, `scripts/sync_to_supabase.py:36-37`

- [ ] **Step 1: Capture pre-migration fill counts (verification baseline)**

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -c '
import sqlite3
c=sqlite3.connect("data/db/products.db")
for col in ["grape_variety","wine_body","wine_acidity","wine_tannin","wine_color","grape_blend_type","wine_production_style"]:
    n=c.execute(f"SELECT COUNT(*) FROM products WHERE {col} IS NOT NULL AND {col}!=\"\"").fetchone()[0]
    print(col, n)
' | tee /tmp/attr_fill_before.txt
```
Expected: prints 7 counts. SAVE this output — Task 5 asserts they survive.

- [ ] **Step 2: Run the migration on the real DB (auto-backs-up)**

Run: `.venv/bin/python scripts/migrate_attribute_rename.py`
Expected: `backup → .../products.db.bak-pre-attr-rename` then `migration applied`

- [ ] **Step 3: Verify SQLite schema**

Run:
```bash
.venv/bin/python -c '
import sqlite3
cols={r[1] for r in sqlite3.connect("data/db/products.db").execute("PRAGMA table_info(products)")}
assert {"variety","body","acidity","tannin","color","blend_type","production_style"} <= cols
assert {"sweetness","intensity","smokiness","finish"} <= cols
assert not ({"grape_variety","wine_body"} & cols)
print("SQLite schema OK")'
```
Expected: `SQLite schema OK`

- [ ] **Step 4: Apply the SAME rename+add migration to Supabase**

Use MCP `mcp__claude_ai_Supabase__apply_migration` on project `dsyplzckfezcxiuikkfm`, name `rename_wine_attrs_to_universal`, with SQL:
```sql
ALTER TABLE products RENAME COLUMN grape_variety TO variety;
ALTER TABLE products RENAME COLUMN grape_blend_type TO blend_type;
ALTER TABLE products RENAME COLUMN wine_body TO body;
ALTER TABLE products RENAME COLUMN wine_acidity TO acidity;
ALTER TABLE products RENAME COLUMN wine_tannin TO tannin;
ALTER TABLE products RENAME COLUMN wine_color TO color;
ALTER TABLE products RENAME COLUMN wine_production_style TO production_style;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sweetness text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS intensity text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS smokiness text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS finish text;
```
Then verify with `mcp__claude_ai_Supabase__list_tables` (verbose) that `production_style` is still `ARRAY` and the new names exist.

- [ ] **Step 5: Update sync_to_supabase.py column list**

Modify `scripts/sync_to_supabase.py` lines 36-37: replace `wine_body, wine_acidity, wine_tannin` → `body, acidity, tannin` and `grape_variety, grape_blend_type, wine_production_style` → `variety, blend_type, production_style`. (Import `ATTRIBUTE_MAP` and map the list, or edit literals — either; the parity test does not cover this file.)

- [ ] **Step 6: Verify a sync round-trip**

Run: `.venv/bin/python scripts/sync_to_supabase.py` (delta sync)
Expected: completes without `column ... does not exist`; log shows rows synced.

- [ ] **Step 7: Commit**

```bash
git add scripts/sync_to_supabase.py
git commit -m "feat(attrs): apply rename to SQLite+Supabase, update sync columns (Stage 1)"
```

---

## Task 4: Flip the pipeline + all Python readers (Stage 2)

**Files:** `scripts/refresh_live_export.py:52-75` + grep-derived list of all callers.

- [ ] **Step 1: Produce the exhaustive caller list**

Run:
```bash
grep -rl -E 'grape_variety|grape_blend_type|wine_body|wine_acidity|wine_tannin|wine_color|wine_production_style' scripts/ data/lib/ --include='*.py' | grep -v __pycache__ | tee /tmp/attr_callers.txt
```
Expected: ~30+ paths. The count IS whatever grep returns — this list, not the spec's "~20", is the authority for what to edit.

- [ ] **Step 2: Update refresh_live_export.py**

Modify `EXPORT_COLS` (lines 52-60): `grape_variety`→`variety`, `wine_body`→`body`, `wine_acidity`→`acidity`, `wine_tannin`→`tannin`, `wine_color`→`color`. Add `blend_type`, `production_style`, and the 4 new cols. Modify `JSON_COLS` (line 75): `wine_production_style`→`production_style`.

- [ ] **Step 3: Update every other caller from /tmp/attr_callers.txt**

For each file, replace old column-name string literals with the new ones (use `ATTRIBUTE_MAP` where the file already imports taxonomy helpers; otherwise edit literals). Skip already-migrated files (refresh, sync) and the audit (Task 6 handles it). Re-grep after to confirm zero stray old names remain in non-test code:
```bash
grep -rn -E 'grape_variety|wine_body|wine_acidity|wine_tannin|wine_color|grape_blend_type|wine_production_style' scripts/ data/lib/ --include='*.py' | grep -v __pycache__ | grep -v test | grep -v attribute_map.py
```
Expected: empty.

- [ ] **Step 4: Regenerate the export**

Run: `.venv/bin/python scripts/refresh_live_export.py`
Expected: `Wrote 11436 products`; no traceback.

- [ ] **Step 5: Commit**

```bash
git add scripts/ data/lib/ data/live_products_export.json
git commit -m "feat(attrs): flip pipeline + python readers to universal names (Stage 2)"
```

---

## Task 5: Verify no data lost in translation (fill-count parity)

**Files:** none (verification only)

- [ ] **Step 1: Compare post-rename export fill counts to the pre-migration baseline**

Run:
```bash
.venv/bin/python -c '
import json
arr=json.load(open("data/live_products_export.json"))
pairs={"grape_variety":"variety","wine_body":"body","wine_acidity":"acidity","wine_tannin":"tannin","wine_color":"color","grape_blend_type":"blend_type","wine_production_style":"production_style"}
before=dict(l.split() for l in open("/tmp/attr_fill_before.txt"))
for old,new in pairs.items():
    n=sum(1 for p in arr if p.get(new) not in (None,"",[]))
    print(f"{new:18} before({old})={before[old]:>5}  after={n:>5}  {\"OK\" if int(before[old])==n else \"MISMATCH\"}")'
```
Expected: every row `OK` (counts identical pre/post). Any `MISMATCH` → STOP, investigate before continuing.

- [ ] **Step 2: Commit (verification note only, if any artifact)** — no commit if nothing changed.

---

## Task 6: Catalog TypeScript rename (Stage 3)

**Files:** `apps/catalog/lib/types.ts:39-58`, ~8 consumers, `apps/catalog/app/product/[sku]/page.tsx:258`

- [ ] **Step 1: Rename fields in types.ts**

Modify `apps/catalog/lib/types.ts`: `grape_variety?`→`variety?`, `wine_body?`→`body?`, `wine_acidity?`→`acidity?`, `wine_tannin?`→`tannin?`, `wine_color?`→`color?`. Add `blend_type?: string; production_style?: string[]; sweetness?: string; intensity?: string; smokiness?: string; finish?: string;`.

- [ ] **Step 2: Let the compiler enumerate consumers**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: errors listing every file referencing the old names (catalog-data, shop-query, shop-facets, finder/scoring, recommender, taste-adapter, QuickView, product page). This list is the work.

- [ ] **Step 3: Fix each consumer**

Replace old field accesses with new in every file `tsc` flagged. In `app/product/[sku]/page.tsx:258` change `<AttrRow label="Grape" value={product.grape_variety} />` → `<AttrRow label="Variety" value={product.variety} />` and line 272 `product.grape_variety`→`product.variety`.

- [ ] **Step 4: Verify tsc + vitest**

Run: `cd apps/catalog && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 5: Gate on full build (Rule: build, not just tests)**

Run: `cd apps/catalog && rm -rf .next && npm run build`
Expected: build succeeds. (Local macOS build can be flaky per project memory; if it fails for non-attr reasons, note and rely on Vercel.)

- [ ] **Step 6: Browser verify (Rule 7)**

Run: `cd apps/catalog && PORT=3100 npm run dev` then open a spirit product page (e.g. a Don Julio SKU). Confirm the Details row reads **"Variety"** (not "Grape") and the page renders without crash.

- [ ] **Step 7: Commit**

```bash
git add apps/catalog/
git commit -m "feat(attrs): rename wine_* fields to universal in catalog TS + UI (Stage 3)"
```

---

## Task 7: Invert the audit's wine-attr check + drop dead columns

**Files:** `scripts/audit_data_validity.py`, `scripts/export_data_review_candidates.py`, separate Supabase + SQLite DROP migration.

- [ ] **Step 1: Update the audit to report coverage, not flag spirits**

In `audit_data_validity.py`, replace the `WINE_ONLY_ATTRS` "spirit with wine-only attrs" WARNING with a per-category fill-rate report of the universal axes (`variety, body, sweetness, intensity, smokiness, finish`). Update `WINE_ONLY_ATTRS`/field names to the renamed columns throughout. Update `export_data_review_candidates.py` likewise (drop the `spirit_wine_attr` issue type).

- [ ] **Step 2: Run the audit, confirm no false "wine attr on spirit" warnings**

Run: `.venv/bin/python scripts/audit_data_validity.py`
Expected: structural all-green; the 417-warning is gone; a coverage section prints.

- [ ] **Step 3: Verify the dead columns are 0-fill on BOTH databases before dropping**

Run (SQLite):
```bash
.venv/bin/python -c 'import sqlite3;c=sqlite3.connect("data/db/products.db");print("wine_type",c.execute("SELECT COUNT(*) FROM products WHERE wine_type IS NOT NULL AND wine_type!=\"\"").fetchone()[0]);print("other_type",c.execute("SELECT COUNT(*) FROM products WHERE other_type IS NOT NULL AND other_type!=\"\"").fetchone()[0])'
```
And Supabase via `mcp__claude_ai_Supabase__execute_sql`: `SELECT count(*) FROM products WHERE wine_type IS NOT NULL` and same for other_type.
Expected: all 0 (or near-0). If non-zero, STOP — do not drop; revisit.

- [ ] **Step 4: Drop the dead columns (separate one-way migration)**

SQLite: `ALTER TABLE products DROP COLUMN wine_type; ALTER TABLE products DROP COLUMN other_type;` (backup first).
Supabase: MCP `apply_migration` name `drop_dead_wine_columns` with the two DROP statements.

- [ ] **Step 4b: Remove the dropped columns from the sync column list**

`scripts/sync_to_supabase.py` `PRODUCT_SYNC_COLUMNS` still lists `wine_type` and
`other_type` (lines ~33-34). After the DROP, a sync referencing them fails with
`column ... does not exist`. Remove both entries, then re-run a delta sync
(`.venv/bin/python scripts/sync_to_supabase.py`) and confirm it round-trips.

- [ ] **Step 5: Regenerate export + final audit**

Run: `.venv/bin/python scripts/refresh_live_export.py && .venv/bin/python scripts/audit_data_validity.py`
Expected: 11436 rows; audit green.

- [ ] **Step 6: Commit**

```bash
git add scripts/audit_data_validity.py scripts/export_data_review_candidates.py data/live_products_export.json
git commit -m "feat(attrs): invert audit to coverage report + drop dead wine_type/other_type"
```

---

## Done criteria

- [ ] `ATTRIBUTE_MAP` parity test green.
- [ ] SQLite + Supabase use universal names; `production_style` still ARRAY in pg.
- [ ] Sync round-trips; export regenerated; fill counts identical pre/post (Task 5).
- [ ] `npm run build` green; product page shows "Variety" not "Grape" (browser-verified).
- [ ] Audit reports universal-axis coverage; no false spirit warnings; dead cols dropped.
- [ ] Enrichment is a SEPARATE plan (next) — schema is now ready for it.
