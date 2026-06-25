# New-Product Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert the 498 in-stock mf-only beverages as complete, sellable catalog products — prices set inline, margins recomputed, imageless placeholder, behind a free pre-flight sign-off gate.

**Architecture:** One focused script `scripts/onboard_new_products.py` with three modes: `--dry-run` (pre-flight report, writes nothing), default (backup → single-transaction insert → verify), and the insert is idempotent (skip existing SKUs). Reuses `scripts/masterfile_lib.py` helpers and `data/lib/taxonomy/sku_taxonomy.py`. All writes behind the pre-flight sign-off gate.

**Tech Stack:** Python 3.9 (`.venv/bin/python`), stdlib `csv`/`sqlite3`/`json`, `pytest`. No new deps. No LLM/API spend.

**Spec:** `docs/superpowers/specs/2026-06-25-new-product-onboarding-design.md`

---

## Conventions (read once)

- **Canonical DB:** `data/db/products.db`. ALWAYS `--db data/db/products.db`. Root `products.db` is a 0-byte decoy.
- **Source CSV:** `/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv`
- **Branch:** `feat/new-product-onboarding`. Run `git branch --show-current` before AND after each task (shared checkout drifts).
- Run python: `.venv/bin/python scripts/<name>.py`; tests: `.venv/bin/python -m pytest tests/<name>.py -v`
- Commit after each task; end commit messages with the Co-Authored-By trailer.
- **Insert-only**: the run must NEVER modify an existing row. Every write is an INSERT of a new SKU.

## Key verified facts (from spec)

- `id` is `TEXT PRIMARY KEY`, not autoincrement → script assigns `id = f"onboard-{sku}"`.
- Only `sku` is NOT NULL; no CHECK constraints. `idx_products_sku` is UNIQUE (blocks dup-insert).
- pct cols (`margin_pct`/`sp_discount_pct`/`b2b_margin_pct`/`b2b_discount_pct`) are **TEXT**, format `'NN%'` (e.g. `'27%'`). margin_thb/b2b_margin_thb are REAL.
- `classification` → leave NULL (catalog re-derives category from SKU prefix; Rule 12).
- Accessory resolver types to EXCLUDE: `Bar Tools & Gifts, Glassware, Cigar, Wine Coolers & Fridges, Event, Wine Set, Mixer / Soft, Tonic / Mineral Water`.
- `margin_pct`/`b2b_margin_pct` ARE in the raw export JSON; stripped only at catalog `PUBLIC_FIELDS`.

## File structure

| File | Responsibility |
|---|---|
| `scripts/onboard_new_products.py` | select the 498 → pre-flight report (`--dry-run`) → backup → single-tx insert → verify |
| `tests/test_onboard_new_products.py` | selection, margin format, insert count, no-overwrite, idempotency, reaches-export, public-projection margin-leak |

Reuses: `scripts/masterfile_lib.py` (`load_masterfile`, `is_empty_cell`), `data/lib/taxonomy/sku_taxonomy.py` (`type_for`).

---

## Task 1: Selection + price helpers (pure, TDD)

**Files:**
- Create: `scripts/onboard_new_products.py` (helpers first)
- Test: `tests/test_onboard_new_products.py`

- [ ] **Step 1: Write failing tests for the pure helpers**

```python
# tests/test_onboard_new_products.py
import sys; sys.path.insert(0, ".")
from scripts.onboard_new_products import parse_money, pct_str, recompute_margins

def test_parse_money():
    assert parse_money("650") == 650.0
    assert parse_money("1,250.00") == 1250.0
    assert parse_money("฿880") == 880.0
    assert parse_money("") is None
    assert parse_money("-") is None
    assert parse_money("N/A") is None
    assert parse_money("abc") is None

def test_pct_str():
    assert pct_str(0.27) == "27%"     # ratio → 'NN%'
    assert pct_str(0.075) == "8%"     # rounds
    assert pct_str(None) is None

def test_recompute_margins_basic():
    m = recompute_margins(cost=480.0, price=700.0, special_price=None, b2b_price=None)
    assert m["margin_thb"] == 220.0
    assert m["margin_pct"] == "31%"          # (700-480)/700 = .314 → 31%
    assert m["sp_discount_pct"] is None       # no special
    assert m["b2b_margin_thb"] is None        # no b2b

def test_recompute_margins_full():
    m = recompute_margins(cost=450.0, price=600.0, special_price=540.0, b2b_price=520.0)
    assert m["margin_thb"] == 150.0
    assert m["margin_pct"] == "25%"
    assert m["sp_discount_pct"] == "10%"      # (600-540)/600
    assert m["b2b_margin_thb"] == 70.0        # 520-450
    assert m["b2b_margin_pct"] == "13%"       # (520-450)/520 = .1346 → 13%

def test_recompute_margins_guards_zero_price():
    # price 0 would div-by-zero; helper returns None pct, caller excludes the SKU
    m = recompute_margins(cost=10.0, price=0.0, special_price=None, b2b_price=None)
    assert m["margin_pct"] is None
```

- [ ] **Step 2: Run, verify FAIL** (`ImportError`).

- [ ] **Step 3: Implement the helpers in `scripts/onboard_new_products.py`**

```python
#!/usr/bin/env python3
"""Onboard in-stock mf-only beverages as sellable products. See spec 2026-06-25."""
from __future__ import annotations
import re

def parse_money(v) -> float | None:
    if v is None:
        return None
    s = re.sub(r"[^\d.\-]", "", str(v))          # strip ฿, commas, spaces
    if s in ("", "-", ".", "--"):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f

def pct_str(ratio: float | None) -> str | None:
    if ratio is None:
        return None
    return f"{round(ratio * 100)}%"

def recompute_margins(cost, price, special_price, b2b_price) -> dict:
    """All derived from INPUT cost/price/b2b. File's own margin cells are ignored."""
    out = {"margin_thb": None, "margin_pct": None, "sp_discount_pct": None,
           "b2b_margin_thb": None, "b2b_margin_pct": None, "b2b_discount_pct": None}
    if cost is not None and price:
        out["margin_thb"] = round(price - cost, 2)
        out["margin_pct"] = pct_str((price - cost) / price) if price > 0 else None
    if special_price and price and price > 0:
        out["sp_discount_pct"] = pct_str((price - special_price) / price)
    if b2b_price and cost is not None:
        out["b2b_margin_thb"] = round(b2b_price - cost, 2)
        out["b2b_margin_pct"] = pct_str((b2b_price - cost) / b2b_price) if b2b_price > 0 else None
    return out
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** (`feat(onboard): money/margin pure helpers`).

---

## Task 2: Selection of the 498 (TDD)

**Files:** modify `scripts/onboard_new_products.py`; test append.

- [ ] **Step 1: Write the selection test**

```python
def test_select_new_beverages():
    from scripts.onboard_new_products import select_candidates
    cands, report = select_candidates(
        db_path="data/db/products.db",
        csv_path="/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv")
    # ~498 in-stock beverages (allow small drift if stock changed)
    assert 450 <= len(cands) <= 540
    # every candidate: not in DB, in stock, beverage (not accessory), has parseable cost+price
    for c in cands:
        assert c["sku"] and c["price"] and c["cost"]
    # report has the Rule-10 sections
    for k in ("n", "unknown_prefix", "price_parse_failures", "negative_margin",
              "missing_cost_or_price", "dup_skus", "type_distribution"):
        assert k in report
    # no candidate resolves to Unknown type (today 0; if any, they'd be in report.unknown_prefix not cands)
    assert report["unknown_prefix"] == [] or all(x not in [c["sku"] for c in cands] for x in report["unknown_prefix"])
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `select_candidates`** — load+dedupe masterfile (`load_masterfile`); for each row: skip if sku in products; skip if `is_in_stock != '1'`; resolve `type_for(sku)`; if type in ACCESSORY set → skip; if type == 'Unknown' → add sku to `report['unknown_prefix']` and SKIP (don't insert). Parse cost/price via `parse_money`; if either None → `report['missing_cost_or_price']` + skip; if a non-empty cell failed to parse → also note in `report['price_parse_failures']`. If cost > price → add to `report['negative_margin']` (keep — allowed, flagged). Build candidate dict with all insert fields (id, descriptive, prices, recomputed margins, currency, is_in_stock, is_active, enrichment_source, timestamps). Return `(candidates, report)`.

- [ ] **Step 4: Run, verify PASS. Print the report counts.**
- [ ] **Step 5: Commit** (`feat(onboard): candidate selection + pre-flight report`).

---

## Task 3: Pre-flight report mode + backup (TDD)

**Files:** modify script; test append.

- [ ] **Step 1: Write the dry-run-writes-nothing test**

```python
def test_dry_run_writes_nothing(tmp_path):
    import subprocess, sys, shutil, sqlite3
    from pathlib import Path
    src = Path("data/db/products.db")
    if not src.exists():
        import pytest; pytest.skip("live db absent")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    before = db.stat().st_mtime
    before_n = sqlite3.connect(db).execute("SELECT COUNT(*) FROM products").fetchone()[0]
    r = subprocess.run([sys.executable, "scripts/onboard_new_products.py",
                        "--db", str(db), "--dry-run"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    after_n = sqlite3.connect(db).execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert after_n == before_n, "dry-run inserted rows"
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement argparse + `--dry-run`** — `--db`, `--dry-run`, `--csv` (default the masterfile path). On `--dry-run`: run `select_candidates`, write `data/onboard_preflight_report.json` + a human `.md`, print the section counts, write NOTHING to the DB. Backup helper (copy from `scripts/masterfile_free_fill.py`: PRAGMA wal_checkpoint(TRUNCATE) then `shutil.copy` to `data/db/products.db.bak-pre-onboard-<UTC ts>`), used only in the real-insert path (Task 4).

- [ ] **Step 4: Run, verify PASS. Generate the REAL pre-flight report against `data/db/products.db` and print the `.md`.**
- [ ] **Step 5: Commit** (`feat(onboard): dry-run pre-flight report + backup helper`). **Then STOP — controller shows the report to the user for sign-off (Rule 10).**

---

## Task 4: Single-transaction insert + verify (TDD)

**Files:** modify script; test append.

- [ ] **Step 1: Write the insert invariant tests**

```python
def test_insert_count_and_idempotent(tmp_path):
    import subprocess, sys, shutil, sqlite3
    from pathlib import Path
    src = Path("data/db/products.db")
    if not src.exists():
        import pytest; pytest.skip("live db absent")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    before = sqlite3.connect(db).execute("SELECT COUNT(*) FROM products").fetchone()[0]
    run = lambda: subprocess.run([sys.executable, "scripts/onboard_new_products.py",
                                  "--db", str(db), "--no-backup"], check=True)
    run()
    after1 = sqlite3.connect(db).execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert after1 > before, "nothing inserted"
    # every onboarded row complete
    rows = sqlite3.connect(db).execute(
        "SELECT id, price, cost, currency, is_in_stock, margin_thb, margin_pct, classification "
        "FROM products WHERE enrichment_source='masterfile_onboard_2026-06-25'").fetchall()
    assert len(rows) == after1 - before
    for id_, price, cost, cur, stock, mthb, mpct, classif in rows:
        assert id_ and id_.startswith("onboard-")
        assert price and price > 0 and cost and cost > 0
        assert cur == "THB" and stock == "1"
        assert round(price - cost, 2) == mthb           # margin recompute correct
        assert mpct and mpct.endswith("%")               # 'NN%' format
        assert classif is None                            # classification left NULL
    # idempotent: second run inserts 0
    run()
    after2 = sqlite3.connect(db).execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert after2 == after1, "re-run double-inserted"

def test_insert_does_not_touch_existing(tmp_path):
    import subprocess, sys, shutil, sqlite3, hashlib
    from pathlib import Path
    src = Path("data/db/products.db")
    if not src.exists():
        import pytest; pytest.skip("live db absent")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    def existing_digest():
        rows = sqlite3.connect(db).execute(
            "SELECT * FROM products WHERE enrichment_source IS NOT 'masterfile_onboard_2026-06-25' "
            "OR enrichment_source IS NULL ORDER BY sku").fetchall()
        return hashlib.sha256(repr(rows).encode()).hexdigest()
    before = existing_digest()
    subprocess.run([sys.executable, "scripts/onboard_new_products.py",
                    "--db", str(db), "--no-backup"], check=True)
    assert existing_digest() == before, "onboarding modified existing rows"
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement the insert** — `--no-backup` flag (tests). Default path: backup, then `select_candidates`, then open one transaction (`conn.execute("BEGIN")`), `INSERT` each candidate (skip if sku already present — idempotent), `conn.commit()`. On ANY exception: `conn.rollback()`, exit non-zero (all-or-nothing). After commit, print "inserted N". Then VERIFY in-process: COUNT rose by N; sample 10 rows assert margin_thb == price-cost. Use parameterized INSERT with an explicit column list; never string-format SQL.

- [ ] **Step 4: Run, verify PASS (both tests). Canary on a /tmp copy; print inserted N.**
- [ ] **Step 5: Commit** (`feat(onboard): single-transaction idempotent insert + verify`). **Do NOT run the real DB yet — controller does the real insert after the pre-flight sign-off + review.**

---

## Task 5: Reaches-export + margin-leak public-projection test (TDD)

**Files:** test append. (Run AFTER the real insert + `refresh_live_export.py`.)

- [ ] **Step 1: Write the export tests**

```python
def test_onboarded_reach_export_no_margin_leak():
    import json, sqlite3
    exp = {r["sku"]: r for r in json.load(open("data/live_products_export.json"))}
    db = sqlite3.connect("data/db/products.db")
    onboarded = [r[0] for r in db.execute(
        "SELECT sku FROM products WHERE enrichment_source='masterfile_onboard_2026-06-25'")]
    assert onboarded, "no onboarded SKUs in DB (run insert + refresh first)"
    for sku in onboarded[:50]:
        row = exp.get(sku)
        assert row, f"{sku} missing from live export"
        assert row.get("price"), f"{sku} has no price in export"
        # category re-derived from prefix → must not be Unknown
        assert row.get("category_type") not in (None, "", "Unknown"), f"{sku} Unknown category"
    # public-projection margin-leak guard: the catalog public projection strips margin/cost.
    # Assert via the catalog's PUBLIC allowlist applied to a sample (mirror toPublicProduct):
    LEAK = {"cost", "b2b_price", "margin_pct", "margin_thb", "b2b_margin_pct", "b2b_margin_thb"}
    # raw export MAY contain margin_pct (known); the guard is that PUBLIC_FIELDS excludes them.
    # Read the catalog allowlist to confirm none of LEAK is public:
    import re, pathlib
    cat = pathlib.Path("apps/catalog/lib/catalog-data.ts").read_text()
    pub = set(re.findall(r"'([a-z_0-9]+)'", cat.split("PUBLIC_FIELDS")[1].split("]")[0])) \
        if "PUBLIC_FIELDS" in cat else set()
    assert not (LEAK & pub), f"margin/cost field is in PUBLIC_FIELDS: {LEAK & pub}"
```

- [ ] **Step 2: Run** — will FAIL until the real insert+refresh is done (expected; this task's test is the post-run gate).
- [ ] **Step 3: (no new impl)** — this task is the verification harness; if `PUBLIC_FIELDS` parsing is brittle, simplify to asserting the known LEAK names are absent from the catalog's public allowlist by a direct substring check.
- [ ] **Step 4: After controller's real insert + `refresh_live_export.py`, run → PASS.**
- [ ] **Step 5: Commit** (`test(onboard): reaches-export + margin-leak public-projection guard`).

---

## Real-run sequence (controller, after plan tasks pass)

1. `--dry-run` → review `data/onboard_preflight_report.md` → **user sign-off (Rule 10)**.
2. Backup (automatic) → real insert against `data/db/products.db`.
3. Verify: COUNT rose by N; count query on onboarded rows.
4. `.venv/bin/python scripts/refresh_live_export.py` (Rule 9).
5. Run Task-5 export tests → PASS.
6. Rule 7: browse catalog + open 3 new product pages (placeholder + price render).

## Out of scope
- Price-import for the 7,068 existing cost-gap products (separate spec; reuses `recompute_margins`).
- 41 accessories, 49 OOS SKUs, image upload, taste/score enrichment of the 498.
- Any "newest"/created_at sort (would flood /shop with placeholders).

## Definition of done
- Pre-flight report reviewed + signed off.
- All tests in `tests/test_onboard_new_products.py` pass.
- Count query on `live_products_export.json` shows the N new SKUs with price + non-Unknown category; no margin/cost in the catalog public projection.
- Rule-7 browser check on 3 new product pages.
