# Taste-Data Quality Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only audit (`scripts/audit_taste_data.py`) that measures per-column error rates for the four taste columns (smokiness, sweetness, body, variety), emits a per-SKU findings file, and recommends trust/correct/re-enrich per column — with no DB writes.

**Architecture:** A single Python script with three composable stages — (1) census + category resolution, (2) free deterministic triage, (3) optional paid Haiku judge over suspects + a stratified control. Pure helper functions live in a small `audit_taste_lib.py` so they're unit-testable without a DB or network. The judge reuses Run-1's proven Anthropic pattern (JSONL sidecar cache, lazy `import anthropic`, temp=0, Haiku). The script never opens the DB for writing.

**Tech Stack:** Python 3.9 (`from __future__ import annotations`), `sqlite3`, `pytest`, `anthropic` SDK (lazy-imported), the existing `data/lib/taxonomy/sku_taxonomy.py` resolver and `data/lib/taste_taxonomy/universal_scales.py` applicability matrix.

**Spec:** `docs/superpowers/specs/2026-06-24-taste-data-quality-audit-design.md`

---

## Key contracts (load-bearing — verified against the codebase)

- **Canonical DB:** `data/db/products.db`. The audit opens it **read-only** via
  `sqlite3.connect("file:...?mode=ro", uri=True)` so it physically cannot write.
- **Category:** `from data.lib.taxonomy import sku_taxonomy` → `sku_taxonomy.resolve({"sku":..,"name":..})` returns `{"group","type"}`. NEVER read the `classification` column (Rule 12).
- **Applicability:** `from data.lib.taste_taxonomy import universal_scales` → `universal_scales.applies(group, type)` returns the set of taste fields that *should* exist for that category. A populated value in a column where `applies()` is False is itself a finding ("inapplicable-column leak").
- **Population test:** a value is "populated" iff `TRIM(COALESCE(col,'')) <> ''` — there are 2,988 empty-string `variety` rows that `IS NOT NULL` would wrongly count.
- **`variety` is comma-delimited multi-value** — split on `,` and trim before any per-token logic.
- **`is_in_stock` is a STRING** `"0"/"1"/null` — not relevant to the audit (we audit all populated rows regardless of stock) but do NOT add a truthiness gate on it.
- **Haiku reuse:** `MODEL = "claude-haiku-4-5-20251001"`; `import anthropic; client = anthropic.Anthropic(); client.messages.create(model=MODEL, max_tokens=300, temperature=0, ...)`. `.env.local` holds the key (loaded the same way `scripts/enrich_phase_b.py` does). Lazy-import anthropic inside the paid branch so tests/dry-run never need the SDK or a key.
- **Run commands use the symlinked venv:** `./.venv/bin/python ...` and `./.venv/bin/pytest ...` (venv is symlinked into this worktree).

## File structure

- **Create** `scripts/audit_taste_lib.py` — pure, DB-free, network-free helpers: population predicate, variety splitter, the deterministic triage rules, the control-sampler, the Wilson lower-bound, the report/JSON serializers. ~200 lines, fully unit-tested.
- **Create** `scripts/audit_taste_data.py` — the CLI orchestrator: opens the DB read-only, resolves categories, calls the lib for triage/sampling, runs the (optional) Haiku judge with the JSONL cache, writes the two output artifacts. Thin glue over the lib.
- **Create** `tests/test_audit_taste_lib.py` — unit tests for every helper (no DB, no network).
- **Create** `tests/test_audit_taste_data.py` — integration tests against a tiny in-memory/temp SQLite fixture (no network; judge stubbed).
- **Outputs at runtime** (not committed by the script): `docs/superpowers/audits/2026-06-24-taste-audit-report.md`, `data/audits/taste_audit_findings.json`, `data/audits/taste_audit_judge_cache.jsonl`.

---

## Task 0: Scaffolding — package imports + read-only DB open

**Files:**
- Create: `scripts/audit_taste_lib.py`
- Create: `tests/test_audit_taste_lib.py`

- [ ] **Step 1: Write the failing test** for the population predicate and variety splitter.

```python
# tests/test_audit_taste_lib.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts import audit_taste_lib as L

def test_is_populated():
    assert L.is_populated("Dry")
    assert not L.is_populated("")
    assert not L.is_populated("   ")
    assert not L.is_populated(None)

def test_split_variety_multivalue():
    assert L.split_variety("Cabernet Sauvignon, Merlot") == ["Cabernet Sauvignon", "Merlot"]
    assert L.split_variety("Chardonnay") == ["Chardonnay"]
    assert L.split_variety("") == []
    assert L.split_variety(None) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./.venv/bin/pytest tests/test_audit_taste_lib.py -v`
Expected: FAIL — `ModuleNotFoundError` / `AttributeError: module 'scripts.audit_taste_lib' has no attribute 'is_populated'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/audit_taste_lib.py
"""Pure, DB-free, network-free helpers for the taste-data audit.

No sqlite, no anthropic, no filesystem side effects here — that lives in
scripts/audit_taste_data.py. Everything in this module is unit-testable in
isolation. See docs/superpowers/specs/2026-06-24-taste-data-quality-audit-design.md
"""
from __future__ import annotations


def is_populated(value) -> bool:
    """A taste value counts as present iff it is a non-blank string.

    Guards the 2,988 empty-string `variety` rows that `IS NOT NULL` miscounts.
    """
    return bool(value is not None and str(value).strip() != "")


def split_variety(value) -> list:
    """variety is comma-delimited multi-value; split + trim, drop blanks."""
    if not is_populated(value):
        return []
    return [tok.strip() for tok in str(value).split(",") if tok.strip()]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./.venv/bin/pytest tests/test_audit_taste_lib.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/audit_taste_lib.py tests/test_audit_taste_lib.py
git commit -m "feat(audit): taste-audit lib scaffold — population + variety-split helpers"
```

---

## Task 1: Deterministic triage rules (the free, 100%-recall pre-pass)

Each rule takes a row dict (`sku`, `name`, the column value, resolved `group`, `type`) and returns a finding dict or `None`. Findings carry: `sku`, `column`, `current_value`, `expected_value` (or `None` for "just flag"), `rule`, `reason`. These are the rows the spec calls "suspects."

**Files:**
- Modify: `scripts/audit_taste_lib.py`
- Modify: `tests/test_audit_taste_lib.py`

- [ ] **Step 1: Write the failing tests** covering each known systematic bug from the spec §3.

```python
# add to tests/test_audit_taste_lib.py

def test_extra_dry_inversion_flagged():
    f = L.triage_sweetness(sku="WSP0009AA", name="7 Cascine Prosecco Extra Dry",
                            value="Dry", group="Wine", type_="Sparkling & Champagne")
    assert f and f["expected_value"] == "Off-Dry" and f["rule"] == "sparkling_extra_dry_inversion"

def test_plain_dry_sparkling_not_flagged_by_extradry_rule():
    # A true Brut/Dry sparkling with no "Extra Dry" cue must NOT be touched by this rule.
    f = L.triage_sweetness(sku="WSP9999ZZ", name="Champagne Brut",
                           value="Dry", group="Wine", type_="Sparkling & Champagne")
    assert f is None or f["rule"] != "sparkling_extra_dry_inversion"

def test_nonbeverage_taste_leak_flagged():
    f = L.triage_nonbeverage(sku="GWN0383BM", name="Final Touch Champagne Glasses",
                             column="variety", value="Pinot Noir, Chardonnay, Pinot Meunier",
                             group="Accessories", type_="Glassware")
    assert f and f["expected_value"] is None and f["rule"] == "nonbeverage_taste_leak"

def test_peated_false_negative_flagged():
    f = L.triage_smokiness(sku="LWH0155BU", name="Talisker 10 Year Old",
                           value="none", group="Whisky", type_="Single Malt")
    assert f and f["rule"] == "peated_false_negative"

def test_smoky_brand_not_a_real_peat_positive():
    # "Ole Smoky" is a brand on unpeated corn moonshine -> heavy is a false positive.
    f = L.triage_smokiness(sku="LWH0293DG", name="Ole Smoky Original Moonshine",
                           value="heavy", group="Whisky", type_="Moonshine")
    assert f and f["rule"] == "smoky_brand_false_positive"

def test_body_lowercase_casedup_flagged():
    f = L.triage_body_case(sku="X", name="n", value="light", group="Wine", type_="Red Wine")
    assert f and f["expected_value"] == "Light" and f["rule"] == "body_case_dup"

def test_body_case_only_emits_canonical_scale_tokens():
    # Every expected_value MUST be in BODY_SCALE (no off-scale 'Medium-Light').
    from data.lib.taste_taxonomy.universal_scales import BODY_SCALE
    for low in ["full", "light", "medium", "medium-full"]:
        f = L.triage_body_case("X", "n", low, "Wine", "Red Wine")
        assert f and f["expected_value"] in BODY_SCALE

def test_inapplicable_column_leak():
    # body on a Gin: applies(Spirits, Gin) has no "body" -> leak.
    f = L.triage_inapplicable(sku="LGN0001AA", name="Some Gin", column="body",
                              value="Full", group="Spirits", type_="Gin")
    assert f and f["rule"] == "inapplicable_column"
```

- [ ] **Step 2: Run to verify they fail**

Run: `./.venv/bin/pytest tests/test_audit_taste_lib.py -k triage -v`
Expected: FAIL (functions not defined)

- [ ] **Step 3: Implement the triage rules.** Use module-level constants so the lexicon is auditable and extensible.

```python
# add to scripts/audit_taste_lib.py
import re

# Peated distilleries whose core/this-expression is smoky even with NO "peat"
# token in the name. Extend as needed; this is the seed list from the spec.
PEATED_DISTILLERIES = {
    "talisker", "ledaig", "caol ila", "kilchoman", "lagavulin", "laphroaig",
    "ardbeg", "bowmore", "smokehead", "octomore", "port charlotte",
    "bunnahabhain", "springbank", "longrow", "kilkerran", "benriach smoke",
}
# Brand names containing a smoke word but NOT actually peated whisky.
SMOKY_BRAND_NOT_PEAT = {"ole smoky"}

_EXTRA_DRY = re.compile(r"\bextra\s*dry\b", re.I)
_SPARKLING_TYPES = {"Sparkling & Champagne"}
_NONBEVERAGE_GROUPS = {"Accessories", "Events", "Non-Alcoholic"}


def _finding(sku, column, value, expected, rule, reason):
    return {"sku": sku, "column": column, "current_value": value,
            "expected_value": expected, "rule": rule, "reason": reason}


def triage_sweetness(sku, name, value, group, type_):
    """Sparkling 'Extra Dry' tagged Dry is an inversion -> Off-Dry."""
    if type_ in _SPARKLING_TYPES and _EXTRA_DRY.search(name or "") and value == "Dry":
        return _finding(sku, "sweetness", value, "Off-Dry",
                        "sparkling_extra_dry_inversion",
                        "Extra Dry (12-17 g/L) is sweeter than Brut; 'Dry' label is inverted")
    return None


def triage_nonbeverage(sku, name, column, value, group, type_):
    """variety/body on a non-beverage (glassware, events) should be NULL."""
    if group in _NONBEVERAGE_GROUPS and column in ("variety", "body"):
        return _finding(sku, column, value, None, "nonbeverage_taste_leak",
                        f"{column} populated on non-beverage group {group}")
    return None


def _name_has(name, needles):
    nl = (name or "").lower()
    return any(k in nl for k in needles)


def triage_smokiness(sku, name, value, group, type_):
    """3-state smokiness checks: peated false-neg, brand-not-peat false-pos."""
    if _name_has(name, SMOKY_BRAND_NOT_PEAT) and value == "heavy":
        return _finding(sku, "smokiness", value, "none", "smoky_brand_false_positive",
                        "name carries a smoke BRAND, not an actual peated whisky")
    if _name_has(name, PEATED_DISTILLERIES) and value in ("none", "", None):
        return _finding(sku, "smokiness", value, "heavy", "peated_false_negative",
                        "distillery is on the peated lexicon but tagged not-smoky")
    return None


def triage_body_case(sku, name, value, group, type_):
    """Lowercase body case-dupes -> canonical BODY_SCALE token.

    Only the four canonical lowercase tokens are mapped; 'medium-light' is NOT a
    BODY_SCALE value (it silently collapses to Medium per universal_scales) so it
    is deliberately excluded here to avoid emitting an off-scale expected_value.
    """
    canon = {"light": "Light", "medium": "Medium",
             "medium-full": "Medium-Full", "full": "Full"}
    if value in canon:
        return _finding(sku, "body", value, canon[value],
                        "body_case_dup", "lowercase body token -> canonical BODY_SCALE")
    return None


def triage_inapplicable(sku, name, column, value, group, type_):
    """A populated value in a column that does not apply to the category."""
    from data.lib.taste_taxonomy import universal_scales
    if column not in universal_scales.applies(group, type_):
        return _finding(sku, column, value, None, "inapplicable_column",
                        f"{column} does not apply to {group}/{type_} per applies()")
    return None
```

> NOTE on `triage_body_case`: `"light".title()` → `"Light"`, `"medium-full".title()` → `"Medium-Full"`. The `.replace("-","-")` is a no-op placeholder; rely on `.title()` which already capitalizes after hyphens. Keep the expected value matching the canonical scale tokens in `universal_scales.BODY_SCALE`.

- [ ] **Step 4: Run to verify they pass**

Run: `./.venv/bin/pytest tests/test_audit_taste_lib.py -k triage -v`
Expected: PASS (all triage tests). If `triage_inapplicable` import fails, ensure the repo root is on `sys.path` (the test's `sys.path.insert` covers it; the script will too).

- [ ] **Step 5: Commit**

```bash
git add scripts/audit_taste_lib.py tests/test_audit_taste_lib.py
git commit -m "feat(audit): deterministic triage rules (extra-dry, nonbeverage, peated, body-case, inapplicable)"
```

---

## Task 2: Stratified control sampler + Wilson lower-bound

**Files:**
- Modify: `scripts/audit_taste_lib.py`
- Modify: `tests/test_audit_taste_lib.py`

- [ ] **Step 1: Write failing tests.**

```python
# add to tests/test_audit_taste_lib.py
def test_wilson_lower_bound_monotone():
    # More failures -> higher lower bound; tiny n -> wide (low LB) interval.
    lb_clean = L.wilson_lower_bound(0, 30)
    lb_dirty = L.wilson_lower_bound(15, 30)
    assert lb_clean < lb_dirty
    assert 0.0 <= lb_clean <= lb_dirty <= 1.0

def test_stratified_control_respects_min_per_type_and_determinism():
    rows = [{"sku": f"S{i}", "type": "Red Wine"} for i in range(50)] + \
           [{"sku": f"T{i}", "type": "Gin"} for i in range(5)]
    s1 = L.stratified_control(rows, key="type", per_type=10, seed=42)
    s2 = L.stratified_control(rows, key="type", per_type=10, seed=42)
    assert s1 == s2                       # deterministic for a fixed seed
    red = [r for r in s1 if r["type"] == "Red Wine"]
    gin = [r for r in s1 if r["type"] == "Gin"]
    assert len(red) == 10                  # capped at per_type
    assert len(gin) == 5                   # fewer than per_type -> take all
```

- [ ] **Step 2: Run to verify they fail**

Run: `./.venv/bin/pytest tests/test_audit_taste_lib.py -k "wilson or control" -v`
Expected: FAIL

- [ ] **Step 3: Implement.** Use stdlib `random.Random(seed)` (deterministic; avoids the banned argless `Math.random`/`Date.now` concern — this is Python, but determinism still matters for reproducible audits) and a closed-form Wilson bound (no scipy).

```python
# add to scripts/audit_taste_lib.py
import math
import random


def wilson_lower_bound(failures: int, n: int, z: float = 1.96) -> float:
    """Wilson score lower bound for a proportion. n==0 -> 0.0."""
    if n == 0:
        return 0.0
    phat = failures / n
    denom = 1 + z * z / n
    centre = phat + z * z / (2 * n)
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)
    return max(0.0, (centre - margin) / denom)


def stratified_control(rows: list, key: str, per_type: int, seed: int) -> list:
    """Sample up to `per_type` rows from each stratum `row[key]`, deterministically."""
    rng = random.Random(seed)
    buckets: dict = {}
    for r in rows:
        buckets.setdefault(r.get(key), []).append(r)
    out = []
    for k in sorted(buckets, key=lambda x: (x is None, str(x))):
        group_rows = sorted(buckets[k], key=lambda r: r.get("sku", ""))
        if len(group_rows) <= per_type:
            out.extend(group_rows)
        else:
            out.extend(rng.sample(group_rows, per_type))
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `./.venv/bin/pytest tests/test_audit_taste_lib.py -k "wilson or control" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/audit_taste_lib.py tests/test_audit_taste_lib.py
git commit -m "feat(audit): stratified control sampler + Wilson lower-bound"
```

---

## Task 3: Census stage — read DB read-only, resolve categories, build the suspect + control sets

**Files:**
- Create: `scripts/audit_taste_data.py`
- Create: `tests/test_audit_taste_data.py`

- [ ] **Step 1: Write a failing integration test** against a tiny temp-file SQLite DB (real file so the `mode=ro` URI works), asserting census counts + that the Talisker row and the Extra-Dry row land in suspects.

```python
# tests/test_audit_taste_data.py
import os, sqlite3, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts import audit_taste_data as A

def _mk_db(path):
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE products (sku TEXT, name TEXT, smokiness TEXT, "
               "sweetness TEXT, body TEXT, variety TEXT)")
    rows = [
        ("LWH0155BU", "Talisker 10 Year Old", "none", "", "", ""),       # peated FN
        ("WSP0009AA", "7 Cascine Prosecco Extra Dry", "", "Dry", "", ""), # extra-dry inversion
        ("GWN0383BM", "Final Touch Champagne Glasses", "", "", "", "Pinot Noir, Chardonnay"),  # nonbev
        ("WWW0001AA", "Chablis", "", "Dry", "Light", "Chardonnay"),       # clean
    ]
    db.executemany("INSERT INTO products VALUES (?,?,?,?,?,?)", rows)
    db.commit(); db.close()

def test_census_and_suspects(tmp_path):
    p = str(tmp_path / "t.db")
    _mk_db(p)
    result = A.run_census(p)
    suspect_skus = {f["sku"] for f in result["suspects"]}
    assert "LWH0155BU" in suspect_skus      # peated false-negative
    assert "WSP0009AA" in suspect_skus      # extra-dry inversion
    assert "GWN0383BM" in suspect_skus      # nonbeverage leak
    # populated counts use TRIM<>'' (empty strings excluded)
    assert result["populated"]["sweetness"] == 2
    assert result["populated"]["variety"] == 2

def test_smokiness_not_killed_by_inapplicable(tmp_path):
    # REGRESSION: smokiness is in no applies() set; it must reach triage_smokiness,
    # NOT be swallowed as 'inapplicable_column'. The Talisker 'none' must be a
    # peated_false_negative, not an inapplicable leak.
    p = str(tmp_path / "t.db"); _mk_db(p)
    result = A.run_census(p)
    tal = [f for f in result["suspects"] if f["sku"] == "LWH0155BU"]
    assert tal and tal[0]["rule"] == "peated_false_negative"

def test_db_opened_readonly_cannot_write(tmp_path):
    p = str(tmp_path / "t.db"); _mk_db(p)
    conn = A.open_ro(p)
    try:
        conn.execute("UPDATE products SET body='X'")
        assert False, "read-only DB allowed a write"
    except sqlite3.OperationalError:
        pass
```

- [ ] **Step 2: Run to verify it fails**

Run: `./.venv/bin/pytest tests/test_audit_taste_data.py -v`
Expected: FAIL (module/functions not defined)

- [ ] **Step 3: Implement the census + the read-only open.**

```python
# scripts/audit_taste_data.py
"""Read-only taste-data quality audit. NO DB writes (opens DB mode=ro).

Stages: (1) census + category resolve, (2) free deterministic triage,
(3) optional paid Haiku judge over suspects + a stratified control.
Outputs a markdown report + per-SKU findings JSON. Rule-10: the paid stage
is gated behind --judge and prints a cost estimate; default run is FREE.
See docs/superpowers/specs/2026-06-24-taste-data-quality-audit-design.md
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from scripts import audit_taste_lib as L          # noqa: E402
from data.lib.taxonomy import sku_taxonomy         # noqa: E402

TASTE_COLS = ("smokiness", "sweetness", "body", "variety")
DEFAULT_DB = REPO / "data" / "db" / "products.db"


def open_ro(db_path) -> sqlite3.Connection:
    """Open the DB strictly read-only so the audit can never mutate it."""
    uri = f"file:{Path(db_path).resolve()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def run_census(db_path) -> dict:
    conn = open_ro(db_path)
    rows = [dict(r) for r in conn.execute(
        f"SELECT sku, name, {', '.join(TASTE_COLS)} FROM products")]
    conn.close()

    populated = {c: 0 for c in TASTE_COLS}
    suspects, clean = [], []
    for r in rows:
        cat = sku_taxonomy.resolve({"sku": r["sku"], "name": r.get("name", "")})
        r["group"], r["type"] = cat["group"], cat["type"]
        for col in TASTE_COLS:
            if not L.is_populated(r[col]):
                continue
            populated[col] += 1
            f = _triage_cell(r, col)
            (suspects if f else clean).append(f or {
                "sku": r["sku"], "column": col, "current_value": r[col],
                "group": r["group"], "type": r["type"], "rule": None})
    return {"populated": populated, "suspects": suspects, "clean": clean,
            "total_rows": len(rows)}


def _triage_cell(r, col):
    """Run the applicable deterministic rules for one (row, column); first hit wins.

    CRITICAL: smokiness is NOT in any universal_scales.applies() set (the matrix
    has no smokiness axis), so it must NEVER be routed through triage_inapplicable
    — doing so would flag all ~1,970 smokiness rows as 'inapplicable' and the
    peated-false-negative / brand-false-positive rules would never run. The
    inapplicable-column check applies ONLY to the matrix-modelled columns.
    """
    name, g, t, v = r.get("name", ""), r["group"], r["type"], r[col]
    if col == "smokiness":
        # whisky/spirits-native; matrix doesn't model it -> skip triage_inapplicable
        return L.triage_smokiness(r["sku"], name, v, g, t)
    # inapplicable-column leak is checked first for the matrix columns only
    f = L.triage_inapplicable(r["sku"], name, col, v, g, t)
    if f:
        return f
    if col == "sweetness":
        return L.triage_sweetness(r["sku"], name, v, g, t)
    if col == "body":
        return (L.triage_nonbeverage(r["sku"], name, "body", v, g, t)
                or L.triage_body_case(r["sku"], name, v, g, t))
    if col == "variety":
        return L.triage_nonbeverage(r["sku"], name, "variety", v, g, t)
    return None
```

- [ ] **Step 4: Run to verify pass**

Run: `./.venv/bin/pytest tests/test_audit_taste_data.py -v`
Expected: PASS (2 tests). The `mode=ro` write attempt raises `OperationalError: attempt to write a readonly database`.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit_taste_data.py tests/test_audit_taste_data.py
git commit -m "feat(audit): census stage — read-only DB, category resolve, deterministic suspect routing"
```

---

## Task 4: Free report — run census over the REAL DB, write report + findings JSON (NO judge)

This is the first user-visible deliverable and is 100% free (no API). It proves the deterministic findings against real data and produces the artifacts the spec promises, minus the judge verdicts (which fill in at Task 6).

**Files:**
- Modify: `scripts/audit_taste_data.py` (add `write_outputs` + `main` free path)
- Modify: `tests/test_audit_taste_data.py`

- [ ] **Step 1: Failing test** — `write_outputs` produces a findings JSON with the expected schema and a non-empty report string.

```python
# add to tests/test_audit_taste_data.py
def test_write_outputs_schema(tmp_path):
    census = {"populated": {"sweetness": 2, "smokiness": 1, "body": 1, "variety": 2},
              "total_rows": 4,
              "suspects": [{"sku": "WSP0009AA", "column": "sweetness",
                            "current_value": "Dry", "expected_value": "Off-Dry",
                            "rule": "sparkling_extra_dry_inversion", "reason": "x",
                            "group": "Wine", "type": "Sparkling & Champagne"}],
              "clean": []}
    report, findings = A.build_outputs(census, judged=None)
    assert "sweetness" in report and "Extra Dry" in report or "inversion" in report
    assert findings["suspects"][0]["sku"] == "WSP0009AA"
    assert findings["meta"]["total_rows"] == 4
```

- [ ] **Step 2: Run to verify fail**

Run: `./.venv/bin/pytest tests/test_audit_taste_data.py -k write_outputs -v`
Expected: FAIL

- [ ] **Step 3: Implement `build_outputs` + `write_outputs` + the free `main` path.**

```python
# add to scripts/audit_taste_data.py
AUDIT_DIR = REPO / "data" / "audits"
REPORT_PATH = REPO / "docs" / "superpowers" / "audits" / "2026-06-24-taste-audit-report.md"


def build_outputs(census: dict, judged):
    """Return (report_markdown, findings_dict). judged=None for the free run."""
    by_col = {}
    for f in census["suspects"]:
        by_col.setdefault(f["column"], []).append(f)
    lines = ["# Taste-Data Quality Audit — Report", "",
             f"Total rows: {census['total_rows']}", ""]
    for col in TASTE_COLS:
        sus = by_col.get(col, [])
        lines += [f"## {col}",
                  f"- populated: {census['populated'][col]}",
                  f"- deterministic suspects: {len(sus)}"]
        rules = {}
        for f in sus:
            rules[f["rule"]] = rules.get(f["rule"], 0) + 1
        for rule, n in sorted(rules.items(), key=lambda kv: -kv[1]):
            lines.append(f"    - {rule}: {n}")
        lines.append("")
    findings = {"meta": {"total_rows": census["total_rows"],
                         "populated": census["populated"],
                         "judged": bool(judged)},
                "suspects": census["suspects"],
                "judge": judged or {}}
    return "\n".join(lines), findings


def write_outputs(report: str, findings: dict):
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report)
    (AUDIT_DIR / "taste_audit_findings.json").write_text(json.dumps(findings, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--judge", action="store_true",
                    help="run the PAID Haiku judge (Rule-10 gated)")
    ap.add_argument("--canary", type=int, default=0,
                    help="judge only N rows, print a cost estimate, then stop")
    args = ap.parse_args()

    census = run_census(args.db)
    judged = None
    if args.judge or args.canary:
        judged = run_judge(census, canary=args.canary)   # Task 5/6
    report, findings = build_outputs(census, judged)
    write_outputs(report, findings)
    print(report)
    print(f"\nWrote {REPORT_PATH}\nWrote {AUDIT_DIR/'taste_audit_findings.json'}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run unit test, then run the real free audit.**

Run: `./.venv/bin/pytest tests/test_audit_taste_data.py -k write_outputs -v` → PASS

Then the REAL free run (no API, reads canonical DB):
Run: `./.venv/bin/python scripts/audit_taste_data.py --db data/db/products.db`
Expected: prints per-column populated counts + deterministic suspect counts; writes the report + findings JSON. **Sanity-check against the spec:** sweetness `sparkling_extra_dry_inversion` ≈ 56, a non-zero `peated_false_negative` count, `nonbeverage_taste_leak` ≈ 22, body `body_case_dup` ≈ 6. If any is wildly off, STOP and investigate (Rule 2) before continuing.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit_taste_data.py tests/test_audit_taste_data.py
git commit -m "feat(audit): free deterministic report + findings JSON over real DB"
```

---

## Task 5: Judge prompt builder + JSONL cache (pure/testable; no live API yet)

**Files:**
- Modify: `scripts/audit_taste_data.py`
- Modify: `tests/test_audit_taste_data.py`

- [ ] **Step 1: Failing test** — the prompt for a row carries the row's group/type and the relevant domain rule; the cache round-trips by a stable key.

```python
# add to tests/test_audit_taste_data.py
def test_judge_prompt_carries_category_and_rule():
    row = {"sku": "WSP0009AA", "name": "Prosecco Extra Dry", "column": "sweetness",
           "current_value": "Dry", "group": "Wine", "type": "Sparkling & Champagne"}
    prompt = A.build_judge_prompt(row)
    assert "Sparkling" in prompt and "Extra Dry" in prompt and "Off-Dry" in prompt

def test_cache_roundtrip(tmp_path):
    cache = tmp_path / "c.jsonl"
    A.cache_put(cache, "WSP0009AA|sweetness", {"verdict": "wrong_value", "value": "Off-Dry"})
    assert A.cache_get(cache, "WSP0009AA|sweetness")["value"] == "Off-Dry"
    assert A.cache_get(cache, "missing|key") is None
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** the prompt builder (domain rules inline per spec §5), `cache_key`, `cache_get`, `cache_put`. Reuse Run-1's JSONL sidecar idea (`scripts/enrich_phase_b.py` line ~162).

```python
# add to scripts/audit_taste_data.py
JUDGE_CACHE = AUDIT_DIR / "taste_audit_judge_cache.jsonl"
MODEL = "claude-haiku-4-5-20251001"

JUDGE_SYSTEM = """You audit a single beverage taste attribute. Reply ONLY with JSON:
{"verdict":"confirm_correct"|"wrong_value"|"not_applicable_null_it","value":<corrected value or null>,"reason":"<short>"}

Domain rules (apply strictly):
- Sparkling dosage ladder: Brut Nature(0-3) < Extra Brut < Brut < Extra Dry(12-17 g/L) < Sec/Dry < Demi-Sec < Doux. "Extra Dry" is SWEETER than Brut -> Off-Dry, NOT Dry.
- "Dry" as a STYLE NAME is not palate: London/Plymouth Dry Gin, Riesling Trocken, sake Karakuchi(=dry). Judge palate, not the label word. Vermouth Dry vs Rosso IS a real palate distinction.
- Peat is by-distillery: Talisker/Ledaig/Caol Ila/Kilchoman/Lagavulin/Laphroaig/Ardbeg/Bowmore = smoky even with no "peat" in the name. But "Smoky/Smokehead/Ole Smoky" may be a BRAND -> verify actually peated.
- German Pradikat: Kabinett/Spatlese default off-dry/sweet UNLESS "Trocken/Feinherb" present (then dry).
- variety = base material / class per category: wine->grape; whisky->Single Malt/Blended/Bourbon/Rye; sake->Junmai/Ginjo grade; gin->botanical. NEVER judge a whisky/sake variety against a grape rubric.
- not_applicable_null_it: use when the attribute should not exist for this product (e.g. grape variety on glassware)."""


def build_judge_prompt(row: dict) -> str:
    return (f"group={row['group']} type={row['type']}\n"
            f"product name: {row.get('name','')}\n"
            f"attribute: {row['column']}\n"
            f"current value: {row['current_value']}\n"
            f"Is the current value correct for THIS product? Apply the domain rules.")


def cache_key(row: dict) -> str:
    return f"{row['sku']}|{row['column']}"


def cache_get(path, key):
    p = Path(path)
    if not p.exists():
        return None
    for line in p.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("key") == key:
            return rec.get("value")
    return None


def cache_put(path, key, value):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a") as fh:
        fh.write(json.dumps({"key": key, "value": value}) + "\n")
```

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit_taste_data.py tests/test_audit_taste_data.py
git commit -m "feat(audit): judge prompt builder (inline domain rules) + JSONL verdict cache"
```

---

## Task 6: Live judge stage — canary first (Rule-10 gate), then full

The judge function judges `suspects ∪ stratified_control`, reading/writing the cache so reruns are free. **The live API call is exercised only via the canary first.** The calibration check (spec §7) runs over the deterministic-bug rows.

**Files:**
- Modify: `scripts/audit_taste_data.py`
- Modify: `tests/test_audit_taste_data.py`

- [ ] **Step 1: Failing test** with the network call **stubbed** (monkeypatch `_call_haiku`) — verifies the judge populates verdicts, uses the cache on rerun, and computes the calibration result.

```python
# add to tests/test_audit_taste_data.py
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
    A.run_judge(census, canary=0)            # rerun
    assert calls["n"] == 1                    # served from cache, no new call
    assert j1["calibration"]["checked"] >= 1  # the extra-dry row is a known-bug check

def test_per_cell_escalation_fires_on_dirty_large_cell(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "JUDGE_CACHE", tmp_path / "jc2.jsonl")
    monkeypatch.setattr(A, "CONTROL_PER_TYPE", 25)   # let n>=20 in one cell
    # Everything the judge sees is "wrong" -> a large clean cell must escalate.
    monkeypatch.setattr(A, "_call_haiku",
                        lambda p: {"verdict": "wrong_value", "value": "X", "reason": "r"})
    clean = [{"sku": f"C{i}", "column": "body", "current_value": "Full",
              "group": "Wine", "type": "Red Wine", "name": "n"} for i in range(40)]
    census = {"populated": {c: 0 for c in A.TASTE_COLS}, "total_rows": 40,
              "suspects": [], "clean": clean}
    res = A.run_judge(census, canary=0)
    fired = [c for c in res["cell_report"] if c["escalated"]]
    assert fired and res["escalated"] > 0      # the dirty Full/Red-Wine cell escalated

def test_tiny_cell_not_gated(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "JUDGE_CACHE", tmp_path / "jc3.jsonl")
    monkeypatch.setattr(A, "_call_haiku",
                        lambda p: {"verdict": "wrong_value", "value": "X", "reason": "r"})
    clean = [{"sku": f"D{i}", "column": "body", "current_value": "Full",
              "group": "Wine", "type": "Red Wine", "name": "n"} for i in range(3)]
    census = {"populated": {c: 0 for c in A.TASTE_COLS}, "total_rows": 3,
              "suspects": [], "clean": clean}
    res = A.run_judge(census, canary=0)
    assert all(not c["escalated"] for c in res["cell_report"])  # n<20 never gated
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement `_call_haiku`, `run_judge`, calibration.** Lazy-import anthropic inside `_call_haiku` only.

```python
# add to scripts/audit_taste_data.py
CONTROL_PER_TYPE = 10
ESCALATE_LB = 0.15


def _load_env_local():
    """Mirror enrich_phase_b: load ANTHROPIC_API_KEY from .env.local if unset."""
    import os
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    envp = REPO / ".env.local"
    if envp.exists():
        for line in envp.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip()


def _call_haiku(prompt: str) -> dict:
    import anthropic                       # lazy: tests/free run never import it
    _load_env_local()
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL, max_tokens=200, temperature=0,
        system=JUDGE_SYSTEM, messages=[{"role": "user", "content": prompt}])
    text = resp.content[0].text
    return json.loads(text[text.find("{"):text.rfind("}") + 1])


def _judge_one(row):
    key = cache_key(row)
    cached = cache_get(JUDGE_CACHE, key)
    if cached is not None:
        return cached
    verdict = _call_haiku(build_judge_prompt(row))
    cache_put(JUDGE_CACHE, key, verdict)
    return verdict


def _judge_rows(rows):
    """Judge a list of rows (cache-backed), returning verdict dicts."""
    out = []
    for row in rows:
        v = _judge_one(row)
        out.append({**{k: row.get(k) for k in
                       ("sku", "column", "current_value", "rule",
                        "expected_value", "group", "type", "name")}, **v})
    return out


def _cell_key(v):
    """A cell = (column, current_value, group, type) per spec §6."""
    return (v["column"], v["current_value"], v.get("group"), v.get("type"))


def _escalate_dirty_cells(control_verdicts, census, min_n=20, lb=ESCALATE_LB):
    """Per-CELL Wilson-LB escalation (spec §6). For each control cell with n>=min_n
    whose wrong-rate lower bound > lb, judge ALL remaining clean rows in that cell.
    Cells with n<min_n are reported but NOT gated (tiny-cell rule)."""
    cells = {}
    for v in control_verdicts:
        cells.setdefault(_cell_key(v), []).append(v)
    escalated, cell_report = [], []
    for key, vs in cells.items():
        n = len(vs)
        wrong = sum(1 for v in vs if v["verdict"] in
                    ("wrong_value", "not_applicable_null_it"))
        lower = L.wilson_lower_bound(wrong, n)
        gated = n >= min_n
        cell_report.append({"cell": list(key), "n": n, "wrong": wrong,
                            "wilson_lb": round(lower, 3), "gated": gated,
                            "escalated": gated and lower > lb})
        if gated and lower > lb:
            col, val, grp, typ = key
            already = {v["sku"] for v in vs}
            extra = [r for r in census["clean"]
                     if r["column"] == col and r["current_value"] == val
                     and r.get("group") == grp and r.get("type") == typ
                     and r["sku"] not in already]
            escalated.extend(_judge_rows(extra))
    return escalated, cell_report


def run_judge(census: dict, canary: int = 0) -> dict:
    suspects = census["suspects"]
    control = L.stratified_control(census["clean"], key="type",
                                   per_type=CONTROL_PER_TYPE, seed=42)
    if canary:
        targets = (suspects + control)[:canary]
        verdicts = _judge_rows(targets)
        control_verdicts, escalated, cell_report = [], [], []
    else:
        suspect_verdicts = _judge_rows(suspects)
        control_verdicts = _judge_rows(control)
        escalated, cell_report = _escalate_dirty_cells(control_verdicts, census)
        verdicts = suspect_verdicts + control_verdicts + escalated

    # Calibration (spec §7): on known-bug rows, did the judge agree they're wrong?
    checked = [v for v in verdicts if v.get("rule") in
               ("sparkling_extra_dry_inversion", "nonbeverage_taste_leak")]
    agreed = sum(1 for v in checked
                 if v["verdict"] in ("wrong_value", "not_applicable_null_it"))
    calibration = {"checked": len(checked), "agreed": agreed,
                   "miscalibrated": bool(checked) and agreed < len(checked) * 0.8}

    if canary:
        n_full = len(suspects) + len(control)
        est = n_full * (60 * 1e-6 * 1.0 + 30 * 1e-6 * 5.0)  # Haiku ~$1/M in, $5/M out
        print(f"[CANARY] judged {len(targets)} rows; full set = {n_full} rows "
              f"(pre-escalation); est ${est:.3f}. Calibration: {calibration}. "
              f"Re-run WITHOUT --canary and WITH sign-off to judge the full set.")
    return {"verdicts": verdicts, "calibration": calibration,
            "cell_report": cell_report, "escalated": len(escalated),
            "control_size": len(control), "suspect_size": len(suspects)}
```

- [ ] **Step 4: Run the stubbed test** → PASS. Do NOT run live yet.

Run: `./.venv/bin/pytest tests/test_audit_taste_data.py -v`
Expected: ALL pass, zero network calls.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit_taste_data.py tests/test_audit_taste_data.py
git commit -m "feat(audit): live judge stage (stubbed-testable) + canary cost gate + calibration"
```

---

## Task 7: Full test sweep + self-review, then STOP at the Rule-10 gate

- [ ] **Step 1: Run the whole audit test suite.**

Run: `./.venv/bin/pytest tests/test_audit_taste_lib.py tests/test_audit_taste_data.py -v`
Expected: ALL PASS, no network.

- [ ] **Step 2: Run the FREE real audit end-to-end** and eyeball the report against spec §3 expectations.

Run: `./.venv/bin/python scripts/audit_taste_data.py --db data/db/products.db`

- [ ] **Step 3: Run the CANARY (this DOES call the API — ~20 rows, a few cents).** Per Rule 10 this is the smallest paid step and prints the full-run estimate + calibration. **This is the hard gate: STOP here and present the canary's estimate + calibration to the user for sign-off before any full judge.**

Run: `./.venv/bin/python scripts/audit_taste_data.py --db data/db/products.db --canary 20`
Expected: canary verdicts cached; a printed `est $X.XXX`; a calibration line. If `miscalibrated: True`, the judge prompt is wrong — fix it before spending more (do NOT proceed to the full run).

- [ ] **Step 4: Present to user** — canary cost estimate, calibration result, and the free deterministic findings. Obtain explicit sign-off (Rule 10 step 5).

- [ ] **Step 5: (Post sign-off) full judge + final report.**

Run: `./.venv/bin/python scripts/audit_taste_data.py --db data/db/products.db --judge`
Then commit the artifacts:

```bash
git add docs/superpowers/audits/2026-06-24-taste-audit-report.md data/audits/taste_audit_findings.json
git commit -m "audit(taste): full report + per-SKU findings (judge verdicts + per-column decision)"
```

---

## Task 8: Per-column decision + memory update

- [ ] **Step 1:** From the full report, write the per-column **trust / correct / re-enrich** decision into the report's conclusion (spec §10).
- [ ] **Step 2:** Update memory `project_taste_data_quality_audit` with the measured error rates and the decisions, so the follow-on correction effort starts from facts.
- [ ] **Step 3:** Use `superpowers:requesting-code-review` for a final review of the audit script before any correction work is planned.
- [ ] **Step 4:** Use `superpowers:finishing-a-development-branch` to decide PR/merge for the audit script + spec + plan.

---

## Notes for the implementer

- **Never** add a write path to `products.db` in this script — the `mode=ro` open is a deliberate guardrail. The correction script is a SEPARATE, later effort.
- The deterministic counts in spec §3 (56 extra-dry, ~22 nonbeverage, ~6 body-case) are *expected ranges*, not asserts — the DB drifts. If the free run is wildly off, investigate (Rule 2), don't paper over it.
- Keep `audit_taste_lib.py` pure (no sqlite/anthropic imports at module top except the lazy `universal_scales` import inside `triage_inapplicable`). This keeps the unit tests fast and network-free.
- Pricing for the estimate: Haiku 4.5 ≈ $1/M input, $5/M output. Adjust the constant in `run_judge` if pricing changed — check the `claude-api` skill if unsure.
- `data/` is a namespace package (no `data/__init__.py`). The imports work because the script does `sys.path.insert(0, REPO)`. Do NOT "fix" the missing `__init__.py` by adding one — that can break sibling tooling relying on namespace-package behavior.
- `resolve()` returns coarse `type` for spirits/whisky (Talisker → `type="Whisky"`, not "Single Malt"). Triage rules key on the `name` lexicon, not `type`, so they're correct — but control-sampler strata are coarse (all whiskies share one `Whisky` type). Acceptable; don't assume finer granularity.
- Non-beverage group strings: `triage_nonbeverage` hard-codes `{Accessories, Events, Non-Alcoholic}`. Before relying on it, `SELECT DISTINCT` resolved groups over taste-bearing rows and confirm those exact strings exist (`applies('Accessories',...)` returns `{'variety'}`, so the matrix won't catch the leak). A differently-spelled group would be silently missed.
