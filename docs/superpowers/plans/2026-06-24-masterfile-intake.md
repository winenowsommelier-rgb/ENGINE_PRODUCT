# Masterfile Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intake the new MReport masterfile, validate it against the authoritative products.db (DB wins, fill-null-only), ingest scores into the PIM, gap-fill designation, and export an enriched same-shape CSV — with a free gap report as the sign-off gate before any DB write.

**Architecture:** Six short, idempotent, single-purpose Python scripts on the existing repo pattern (`scripts/`). Steps 1–2 (intake → gap report) write nothing and spend nothing; the user reviews the report before any write. Score ingest ADAPTS the existing `scripts/load_critic_scores_from_csv.py`. All DB writes are NULL-only fill against `data/db/products.db`, backed up first, with an end-to-end invariant test proving data reaches `data/live_products_export.json`.

**Tech Stack:** Python 3.9 (`.venv/bin/python`), stdlib `csv`/`sqlite3`/`re`/`json`, `pytest`. No new dependencies. No LLM/API spend in this plan (paid enrichment is deferred behind a separate sign-off).

**Spec:** `docs/superpowers/specs/2026-06-24-masterfile-intake-design.md`

---

## Conventions (read once, apply to every task)

- **Canonical DB:** `data/db/products.db`. ALWAYS pass `--db data/db/products.db` explicitly (prior scripts default to a stale worktree DB). Root `products.db` is a 0-byte decoy — never use it.
- **Source CSV:** `/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv`
- **Run python as:** `.venv/bin/python scripts/<name>.py ...`
- **Run tests as:** `.venv/bin/python -m pytest tests/<name>.py -v`
- **DB wins / fill-null-only:** a write may only set a field that is currently NULL or empty-string in the DB. Never overwrite a non-empty DB value. This is the core invariant — every fill task's test must assert it.
- **Backup before any write task:** `cp data/db/products.db data/db/products.db.bak-pre-masterfile-<step>-$(date +%Y%m%d-%H%M%S)`
- **After any DB write:** refresh the export — `.venv/bin/python scripts/refresh_live_export.py` (Rule 9).
- **Commit after each task.** End commit messages with the Co-Authored-By trailer.

## File structure

| File | Responsibility |
|---|---|
| `scripts/masterfile_lib.py` | Shared helpers: load+dedupe CSV, sku/string normalize, "100% X"→X variety normalize, designation regex, HTML strip, point parse. Imported by all other scripts + tests. |
| `scripts/masterfile_gap_report.py` | Read-only. Emits `data/masterfile_gap_report.{json,md}`: SKU reconciliation, per-field fill/conflict counts, item_type buckets, score preview (incl. 39 bare/HTML conflicts), designation gap. NO writes. |
| `scripts/masterfile_free_fill.py` | NULL-only fill into products.db: region/subregion/variety/body/acidity/tannin/food_matching/country(fill-only)/desc + designation (gated regex). |
| `scripts/masterfile_ingest_scores.py` | ADAPTED copy of load_critic_scores_from_csv.py: parse points from HTML prose cols + positional bare-score attribution → critic_scores + score_summary/score_max. |
| `scripts/masterfile_insert_new.py` | GATED: insert the 539 in-stock mf-only SKUs as new products. Park 49 OOS. |
| `scripts/masterfile_export.py` | Emit enriched same-43-col CSV (QUOTE_ALL) + re-parse verify. |
| `tests/test_masterfile_lib.py` | Unit tests for the pure helpers. |
| `tests/test_masterfile_invariants.py` | End-to-end: fill-null-only honored; scores+designation reach the export; score dedupe is idempotent. |

---

## Task 1: Shared library — pure helpers (TDD)

**Files:**
- Create: `scripts/masterfile_lib.py`
- Test: `tests/test_masterfile_lib.py`

- [ ] **Step 1: Write failing tests for the pure helpers**

```python
# tests/test_masterfile_lib.py
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

def test_extract_designation_gated_by_type():
    # Brut on a wine → designation; Brut on a beer → None (Kriek beer landmine)
    assert extract_designation("Pol Roger Brut Reserve", "Champagne") == "Brut"
    assert extract_designation("Liefmans Kriek Brut 330ml", "Beer") is None
    assert extract_designation("Barolo DOCG 2016", "Red Wine") == "DOCG"
    assert extract_designation("Hennessy XO", "Brandy") == "XO"
    # substring landmine: 'doc' inside a word must NOT match
    assert extract_designation("The Doctor's Reserve", "Red Wine") != "DOC"
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `.venv/bin/python -m pytest tests/test_masterfile_lib.py -v`
Expected: FAIL with `ModuleNotFoundError` / `ImportError`.

- [ ] **Step 3: Implement `scripts/masterfile_lib.py`**

```python
#!/usr/bin/env python3
"""Pure helpers for masterfile intake. No I/O, no DB — unit-testable."""
from __future__ import annotations
import csv, re, html
from pathlib import Path

EMPTY = {"", "-", "–", "—", "n/a", "na"}
def is_empty_cell(v) -> bool:
    return (v or "").strip().lower() in EMPTY

_PCT = re.compile(r"\s*\(?100\s*%\)?\s*")
def normalize_variety(v: str | None) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    if "/" in v or "," in v or "%" in v.replace("100%", "").replace("100 %", ""):
        # blends carry their own percentages or separators — preserve verbatim
        if re.search(r"\d+\s*%.*\d+\s*%", v) or "/" in v or "," in v:
            return v
    out = _PCT.sub(" ", v).strip()
    return out or v

_PTS = re.compile(
    r"(\d{2,3})\s*(?:points?|pts|Point|"
    r"(?=(?:&nbsp;|\s)*(?:by\s*)?(?:Wine|James|Robert|Jeb|Decanter|Vinous)))",
    re.I,
)
def parse_points(raw: str | None) -> int | None:
    if is_empty_cell(raw):
        return None
    txt = html.unescape(re.sub(r"<[^>]+>", " ", raw or ""))
    m = _PTS.search(txt)
    return int(m.group(1)) if m else None

# Designation tokens, longest-first so 'Grand Cru' beats 'Cru'. Word-boundaried.
_DESIGS = [
    "Grosses Gewächs", "Gran Reserva", "Premier Cru", "1er Cru", "Grand Cru",
    "Extra Brut", "Brut Nature", "Single Malt", "Brut", "Riserva", "Reserva",
    "DOCG", "DOC", "DOP", "IGT", "IGP", "AOC", "AOP", "XO", "VSOP", "VS",
    "Villages", "GG",
]
_DESIG_RE = re.compile(r"\b(" + "|".join(re.escape(d) for d in _DESIGS) + r")\b", re.I)
# Only these item_types may carry a wine/spirit designation.
_DESIG_TYPES = {
    "Red Wine", "White Wine", "Rosé Wine", "Rose Wine", "Sparkling Wine",
    "Champagne", "Sparkling & Champagne", "Dessert Wine", "Sweet/Dessert",
    "Port Wine", "Orange Wine", "Whisky", "Brandy", "Grappa",
}
def extract_designation(name: str | None, item_type: str | None) -> str | None:
    if not name or (item_type or "").strip() not in _DESIG_TYPES:
        return None
    m = _DESIG_RE.search(name)
    if not m:
        return None
    canon = {d.lower(): d for d in _DESIGS}
    return canon[m.group(1).lower()]

def load_masterfile(path: str | Path) -> tuple[list[dict], list[str]]:
    """Return (deduped rows, list of duplicate SKUs). Last row wins on dup."""
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    seen, out, dups = {}, [], []
    for r in rows:
        sku = (r.get("sku") or "").strip()
        if not sku:
            continue
        if sku in seen:
            dups.append(sku)
        seen[sku] = r
    out = list(seen.values())
    return out, dups
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `.venv/bin/python -m pytest tests/test_masterfile_lib.py -v`
Expected: PASS (all 5). If `parse_points` "bare critic" case fails, widen the lookahead critic list — do NOT loosen to match any 2-digit number.

- [ ] **Step 5: Commit**

```bash
git add scripts/masterfile_lib.py tests/test_masterfile_lib.py
git commit -m "feat(masterfile): pure helpers — variety/designation/points/dedupe"
```

---

## Task 2: Gap report (read-only, the sign-off artifact)

**Files:**
- Create: `scripts/masterfile_gap_report.py`
- Test: extend `tests/test_masterfile_lib.py` for the pure counting fn, or smoke-test the script.

- [ ] **Step 1: Write a smoke test asserting the report has every required section and writes NOTHING to the DB**

```python
# tests/test_masterfile_lib.py (append)
import subprocess, sqlite3, json, shutil, sys
from pathlib import Path

def test_gap_report_is_readonly_and_complete(tmp_path):
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
    # arithmetic must reconcile (spec): matched + mf_only + dup_artifacts == mf_distinct
    assert rec["matched"] + rec["mf_only_unique"] + rec["dup_artifacts"] == rec["mf_distinct"]
```

- [ ] **Step 2: Run, verify it fails** (script missing).

Run: `.venv/bin/python -m pytest tests/test_masterfile_lib.py::test_gap_report_is_readonly_and_complete -v`
Expected: FAIL.

- [ ] **Step 3: Implement `scripts/masterfile_gap_report.py`**

Read-only. Opens DB with `?mode=ro` URI. For each mapped field, count: DB-null+mf-has (fill candidate), DB-has+mf-has+differ (conflict, DB kept), agree. Build `item_type_buckets` by cross-tabbing `sku_taxonomy.type_for(sku)` vs masterfile `item_type` (cosmetic vs real, list override candidates). Build `score_preview` separating masterfile-incoming (named-HTML, bare-by-position, the 39 bare/HTML conflicts) vs existing critic_scores (3,144) vs new-after-dedupe. Build `designation_gap` (null-designation rows the gated regex fills, with 10 samples). Write `.json` and a human `.md`. Import resolver via `sys.path.insert(0, "data/lib/taxonomy")`.

Key: open DB read-only —
```python
conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
```

- [ ] **Step 4: Run test, verify PASS; then generate the real report**

Run: `.venv/bin/python -m pytest tests/test_masterfile_lib.py::test_gap_report_is_readonly_and_complete -v` → PASS
Run: `.venv/bin/python scripts/masterfile_gap_report.py --db data/db/products.db --out data/masterfile_gap_report.json`
Expected: writes `data/masterfile_gap_report.{json,md}`; DB mtime unchanged.

- [ ] **Step 5: Commit + STOP for user sign-off**

```bash
git add scripts/masterfile_gap_report.py tests/test_masterfile_lib.py data/masterfile_gap_report.md
git commit -m "feat(masterfile): read-only gap report (sign-off artifact)"
```
**HARD GATE:** present `data/masterfile_gap_report.md` to the user. Do NOT proceed to Task 3+ (any write) until the user approves the report.

---

## Task 3: Free-fill (NULL-only) into products.db (TDD)

**Files:**
- Create: `scripts/masterfile_free_fill.py`
- Test: `tests/test_masterfile_invariants.py`

- [ ] **Step 1: Write the fill-null-only invariant test**

```python
# tests/test_masterfile_invariants.py
import sqlite3, subprocess, sys, shutil
from pathlib import Path
from scripts.masterfile_lib import is_empty_cell

def test_free_fill_never_overwrites_nonnull(tmp_path):
    src = Path("data/db/products.db")
    if not src.exists():
        import pytest; pytest.skip("live db absent")
    db = tmp_path / "t.db"; shutil.copy(src, db)
    before = {r[0]: r[1] for r in
              sqlite3.connect(db).execute("SELECT sku, region FROM products")}
    nonnull = {s: v for s, v in before.items() if v and v.strip()}
    subprocess.run([sys.executable, "scripts/masterfile_free_fill.py",
                    "--db", str(db), "--no-backup"], check=True)
    after = {r[0]: r[1] for r in
             sqlite3.connect(db).execute("SELECT sku, region FROM products")}
    for s, v in nonnull.items():
        assert after[s] == v, f"OVERWROTE curated region for {s}: {v} -> {after[s]}"
```

- [ ] **Step 2: Run, verify FAIL** (script missing).

- [ ] **Step 3: Implement `scripts/masterfile_free_fill.py`**

Backup first (unless `--no-backup` for tests). Load+dedupe via `masterfile_lib.load_masterfile`. For each DB SKU present in the masterfile, build a `SET` clause that ONLY assigns columns where the DB value `is_empty_cell(...)` AND the masterfile has a value. Fields: region→region, sub_region→subregion, grape_variety/grape_class→variety (precedence: variety first), wine_body/acidity/tanin→body/acidity/tannin, food_matching→food_matching, country→country (fill-only), short_description/description→desc_en_short/full_description. Designation: `extract_designation(name, item_type)` where DB designation is empty. Use parameterized UPDATEs (never string-format SQL). Print a per-field "filled N" count. Re-query PRAGMA before trusting prior state (DB-reverts memory).

- [ ] **Step 4: Run test → PASS. Then dry-run against a copy and eyeball counts.**

Run: `.venv/bin/python -m pytest tests/test_masterfile_invariants.py::test_free_fill_never_overwrites_nonnull -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/masterfile_free_fill.py tests/test_masterfile_invariants.py
git commit -m "feat(masterfile): NULL-only free-fill (DB wins) + invariant test"
```

---

## Task 4: Score ingest — ADAPT existing loader (TDD)

**Files:**
- Create: `scripts/masterfile_ingest_scores.py` (copy of `scripts/load_critic_scores_from_csv.py`, then adapt)
- Test: extend `tests/test_masterfile_invariants.py`

- [ ] **Step 1: Write the score tests (positional attribution + idempotency)**

```python
# tests/test_masterfile_invariants.py (append)
def test_score_dedupe_idempotent(tmp_path):
    src = Path("data/db/products.db")
    if not src.exists():
        import pytest; pytest.skip("live db absent")
    db = tmp_path / "s.db"; shutil.copy(src, db)
    def n(): return sqlite3.connect(db).execute(
        "SELECT COUNT(*) FROM critic_scores").fetchone()[0]
    run = lambda: subprocess.run([sys.executable,
        "scripts/masterfile_ingest_scores.py", "--db", str(db), "--no-backup"], check=True)
    run(); first = n(); run(); second = n()
    assert first == second, f"re-run changed row count {first}->{second}"
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Adapt the script.** Copy `load_critic_scores_from_csv.py` → `masterfile_ingest_scores.py`. Changes:
  - New `SOURCE_TAG = "mreport_masterfile_2026-06-24"`.
  - Replace `CRITICS` numeric-column logic. Named critics now parse points from HTML prose via `masterfile_lib.parse_points`; keep prose as `notes`/`supporting_text`.
  - Add positional bare path: `wine_score_1→Wine Enthusiast, 2→Wine Advocate, 3→Wine Spectator, 4→James Suckling`. When both bare and HTML-points exist and DIFFER, **bare wins** (user decision) — record the bare value, and the script appends the conflict to a `--conflicts-out` log (the 39 rows for the gap report).
  - Idempotency stays as source-tag delete-reinsert (re-run deletes prior `mreport_masterfile_2026-06-24` rows first). DB-wins note: this run only deletes ITS OWN tag's rows — never touches the 3,144 existing curated rows from other sources.
  - `score_summary`/`score_max` via the existing `build_summary()` — but write them NULL-only (do not overwrite a curated DB value).

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/masterfile_ingest_scores.py tests/test_masterfile_invariants.py
git commit -m "feat(masterfile): score ingest — HTML points + positional bare attribution"
```

---

## Task 5: New-product insert (GATED, separate sign-off)

**Files:**
- Create: `scripts/masterfile_insert_new.py`

- [ ] **Step 1: Implement** — insert ONLY the 539 in-stock mf-only SKUs (resolve type via `sku_taxonomy`, set `enrichment_source='masterfile_new_2026-06-24'`). Park the 49 OOS (log them, do not insert). Backup first. Idempotent: skip SKUs already in products.
- [ ] **Step 2: Dry-run** (`--dry-run`) → confirms 539 insert / 49 parked.
- [ ] **Step 3: STOP for user sign-off** before the real insert (separate gate per spec).
- [ ] **Step 4: Real insert after sign-off; verify `SELECT COUNT(*)` rose by exactly 539.**
- [ ] **Step 5: Commit.**

---

## Task 6: Export enriched CSV + refresh live export + end-to-end verify

**Files:**
- Create: `scripts/masterfile_export.py`
- Test: extend `tests/test_masterfile_invariants.py`

- [ ] **Step 1: Write the round-trip + reaches-export tests**

```python
# tests/test_masterfile_invariants.py (append)
import csv, json
def test_export_roundtrip_quoteall(tmp_path):
    out = tmp_path / "enriched.csv"
    subprocess.run([sys.executable, "scripts/masterfile_export.py",
                    "--db", "data/db/products.db", "--out", str(out)], check=True)
    rows = list(csv.DictReader(out.open(newline="")))
    db_n = sqlite3.connect("data/db/products.db").execute(
        "SELECT COUNT(*) FROM products").fetchone()[0]
    assert len(rows) >= db_n, "export dropped rows (DB-only SKUs must be carried)"
    assert len(rows[0]) == 43, "column count must stay 43"

def test_scores_and_designation_reach_live_export():
    exp = json.load(open("data/live_products_export.json"))
    by = {r["sku"]: r for r in exp}
    conn = sqlite3.connect("data/db/products.db")
    for sku, sm in conn.execute(
        "SELECT sku, score_max FROM products WHERE score_max IS NOT NULL LIMIT 50"):
        assert by.get(sku, {}).get("score_max") == sm, f"score_max not in export for {sku}"
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `scripts/masterfile_export.py`** — read products (LEFT JOIN logic so all 11,436 + any inserted are present), emit the exact 43-col header in order with `csv.QUOTE_ALL`. After writing, RE-PARSE the output: assert row count and a 10-SKU field checksum match the DB (rollback/abort on mismatch). Then run `scripts/refresh_live_export.py` (Rule 9) so scores/designation reach the UI JSON.

- [ ] **Step 4: Run tests → PASS. Final verification (Rule 1/6/7/9):**

```bash
.venv/bin/python -m pytest tests/test_masterfile_invariants.py -v
.venv/bin/python scripts/refresh_live_export.py
# count query proving data shipped to the user-facing destination:
.venv/bin/python -c "import json; e=json.load(open('data/live_products_export.json')); \
print('designation populated:', sum(1 for r in e if r.get('designation'))); \
print('score_max populated:', sum(1 for r in e if r.get('score_max')))"
```
Then a UI spot-check on 3 enriched SKUs (Rule 7).

- [ ] **Step 5: Commit.**

```bash
git add scripts/masterfile_export.py tests/test_masterfile_invariants.py
git commit -m "feat(masterfile): enriched export + round-trip verify + live refresh"
```

---

## Out of scope (do NOT build here)
- Paid LLM enrichment (deferred behind its own estimate + sign-off).
- Prices/cost/margins (BI app).
- Inserting the 49 OOS mf-only SKUs.
- A true Magento import-format CSV.

## Definition of done
- Gap report reviewed + approved by user (Task 2 gate).
- All tests in `tests/test_masterfile_lib.py` + `tests/test_masterfile_invariants.py` pass.
- A count query against `data/live_products_export.json` (NOT log lines) shows designation + score_max populated.
- UI spot-check on 3 SKUs confirms the enrichment renders (Rule 7).
