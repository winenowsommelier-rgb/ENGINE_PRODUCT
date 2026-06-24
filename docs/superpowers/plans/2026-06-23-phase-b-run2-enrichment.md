# Phase B Run 2 — Taste-Field Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich `variety`/`body`/`acidity`/`tannin` (finder+shop) and `sweetness` (product-page gauge) for ~2,564 in-stock drinkable products via a paid Haiku run, gated by a per-category applicability matrix, then verify the data shipped to the UI export.

**Architecture:** Extend the proven Run-1 skeleton (`scripts/enrich_phase_b.py` cache-first → `scripts/merge_phase_b_cache.py` NULL-only merge → `refresh_live_export.py` → verify-shipped). FIRST refactor the hardcoded 2-field path into a `FIELDS` config (Task 0), THEN add fields/applicability. One small catalog code change makes `sweetness` render. No DB write in the enrichment script; no spend until a 5-SKU canary + user sign-off (Rule 10).

**Tech Stack:** Python 3.9 (stdlib + `anthropic` SDK), SQLite (`data/db/products.db` at repo ROOT — absolute path), pytest (Python), vitest (`apps/catalog`), Haiku 4.5.

**Spec:** `docs/superpowers/specs/2026-06-23-phase-b-run2-enrichment-design.md`

**⚠️ Cross-cutting rules (every task):**
- Run all Python via the repo venv: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python"`.
- The canonical DB is the **88 MB ROOT** `data/db/products.db`; the worktree copy is **0 bytes**. Tests use a tmp fixture DB; the real run passes `--db "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db"` (absolute).
- Verify `git branch --show-current == feat/phase-b-run2` before EVERY commit (shared checkout flips branches).
- NO API spend in Tasks 0–7. Spend happens ONLY in Task 8 after the canary + sign-off.

**File map:**
- Modify: `data/lib/taste_taxonomy/universal_scales.py` — add scales, validators, `applies`, broadened wine grape vocab, `FIELD_SPECS`.
- Modify: `scripts/enrich_phase_b.py` — `FIELDS`-driven select/prompt/parse/validate/counters; add Wine; `max_tokens` 300.
- Modify: `scripts/merge_phase_b_cache.py` — `FIELDS` → 5 + generic verify print.
- Create: `scripts/verify_phase_b_shipped.py` — Rule-1 merged-SKU-set JSON assertion.
- Modify: `apps/catalog/lib/taste-adapter.ts` — extend `Axis`/`SCALE`/`REMAP`, emit `sweetness` in `toStructural`.
- Modify/Create tests: `tests/test_universal_scales.py`, `tests/test_enrich_phase_b_*.py`, `tests/test_merge_phase_b_nullonly.py`, `tests/test_verify_phase_b_shipped.py`, `apps/catalog/lib/__tests__/taste-adapter.test.ts`.

---

## Task 0: Parameterize the field set (enabling refactor — NO behavior change)

Run-1 hardcodes `variety`/`body` at ~8 sites. Introduce a `FIELDS` tuple + per-field specs so the SELECT, prompt, parse, validate, and counters all iterate. Pin "behaves exactly like Run 1 when only variety+body are active" with a regression test.

**Files:**
- Modify: `data/lib/taste_taxonomy/universal_scales.py`
- Modify: `scripts/enrich_phase_b.py:93-124,300,317-320`
- Test: `tests/test_enrich_phase_b_select.py` (extend), `tests/test_universal_scales.py` (extend)

- [ ] **Step 1: Write the failing test — `applies` + `FIELD_SPECS` exist and gate variety/body for a non-wine group**

In `tests/test_universal_scales.py` add:

```python
def test_field_specs_and_applies_baseline():
    from data.lib.taste_taxonomy.universal_scales import FIELD_SPECS, applies
    # FIELD_SPECS keyed by field name, each has a validator
    assert set(FIELD_SPECS) >= {"variety", "body", "acidity", "tannin", "sweetness"}
    # a clear spirit: only variety applies (Run-1 parity = variety+body, but body now gated off spirits)
    ap = applies("Spirits", "Gin")
    assert "variety" in ap
    assert "body" not in ap and "acidity" not in ap and "tannin" not in ap and "sweetness" not in ap
```

- [ ] **Step 2: Run it, verify it fails**

Run: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -m pytest tests/test_universal_scales.py::test_field_specs_and_applies_baseline -v`
Expected: FAIL — `ImportError: cannot import name 'FIELD_SPECS'`.

- [ ] **Step 3: Implement `FIELD_SPECS` + `applies` + scales/validators in `universal_scales.py`**

Add (keep existing `BODY_SCALE`, `VARIETY_VOCAB`, `validate_body`, `validate_variety`, `schema_for_group` — do NOT delete; `schema_for_group` may stay for back-compat but new code uses `applies`/`FIELD_SPECS`):

```python
ACIDITY_TANNIN_SCALE = ["Low", "Medium", "Medium-High", "High"]
SWEETNESS_SCALE = ["Dry", "Off-Dry", "Medium-Sweet", "Sweet"]  # product-page GAUGE scale (NOT the sake ladder)

# Broadened wine grape allowlist (spec §4.2) — includes the finder's 15 GRAPE_FAMILY tokens
# (so they still score) PLUS high-volume grapes that would otherwise be NULL'd.
WINE_GRAPE_VOCAB = [
    # finder GRAPE_FAMILY tokens (must keep — these score in grapeScore):
    "Cabernet Sauvignon", "Pinot Noir", "Syrah", "Shiraz", "Sangiovese", "Tempranillo",
    "Merlot", "Grenache", "Chardonnay", "Sauvignon Blanc", "Riesling", "Pinot Grigio",
    "Viognier", "Semillon", "Glera",
    # broadened (display + shop; score 0 in finder = neutral, harmless):
    "Malbec", "Zinfandel", "Primitivo", "Nebbiolo", "Barbera", "Nero d'Avola",
    "Montepulciano", "Carmenere", "Cabernet Franc", "Petit Verdot", "Chenin Blanc",
    "Gewurztraminer", "Gruner Veltliner", "Albarino", "Verdejo", "Torrontes",
    "Moscato", "Muscat", "Malvasia", "Garganega", "Vermentino", "Gamay",
    # blend tokens (lead with dominant grape so grapeScore substring still matches):
    "Bordeaux Blend", "GSM", "Rhone Blend", "Field Blend",
]

def _scale_validator(scale):
    def _v(value):
        return value if value in scale else None
    return _v

validate_acidity   = _scale_validator(ACIDITY_TANNIN_SCALE)
validate_tannin    = _scale_validator(ACIDITY_TANNIN_SCALE)
validate_sweetness = _scale_validator(SWEETNESS_SCALE)

# Per-field spec: scale shown in the prompt + validator. variety is special (per-group vocab).
FIELD_SPECS = {
    "variety":   {"validate": validate_variety},   # validator takes (group, value)
    "body":      {"scale": BODY_SCALE,            "validate": validate_body},
    "acidity":   {"scale": ACIDITY_TANNIN_SCALE,  "validate": validate_acidity},
    "tannin":    {"scale": ACIDITY_TANNIN_SCALE,  "validate": validate_tannin},
    "sweetness": {"scale": SWEETNESS_SCALE,        "validate": validate_sweetness},
}

# Wine sub-types (from sku_taxonomy.resolve(row)["type"]) that gate tannin / sweetness.
_RED_TYPES = {"Red Wine", "Orange Wine"}
_SWEETNESS_WINE_TYPES = {"Sweet/Dessert", "Fortified", "White Wine", "Sparkling & Champagne"}

def applies(group, wine_type=None):
    """Return the set of fields to REQUEST for a product, per spec §4.0.
    `group` = sku_taxonomy.resolve()["group"]; `wine_type` = ...["type"] (Wine only)."""
    s = {"variety"}  # every drinkable gets variety
    if group in ("Wine", "Sake & Asian", "Liqueur"):
        s.add("body")
    if group in ("Wine", "Liqueur"):
        s.add("acidity")
    if group == "Wine" and wine_type in _RED_TYPES:
        s.add("tannin")
    if group == "Wine" and wine_type in _SWEETNESS_WINE_TYPES:
        s.add("sweetness")
    if group == "Liqueur":
        s.add("sweetness")
    return s

def variety_vocab_for(group):
    """Wine uses the broadened grape vocab; others use the Run-1 per-group vocab."""
    if group == "Wine":
        return WINE_GRAPE_VOCAB
    return VARIETY_VOCAB.get(group) or []
```

Update `validate_variety` to also accept Wine via `variety_vocab_for`:

```python
def validate_variety(group, value):
    return value if value in variety_vocab_for(group) else None
```

- [ ] **Step 4: Run the new + existing universal_scales tests, verify pass**

Run: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -m pytest tests/test_universal_scales.py -v`
Expected: PASS (new test + all Run-1 tests still green).

- [ ] **Step 5: Refactor `enrich_phase_b.py` to drive off `FIELDS` + `applies` (no spirits/whisky behavior change yet beyond gating)**

In `scripts/enrich_phase_b.py`:
- Add Wine to selection: change `NONWINE` usage — rename the gate to `DRINKABLE = {"Wine","Spirits","Whisky","Sake & Asian","Liqueur"}` (drop Beer & RTD per spec §2). Remove the buying-signal gate (spec §2: no signal gate).
- `select_rows`: SELECT all 5 cols `variety,body,acidity,tannin,sweetness` + `is_in_stock`; resolve group AND type; compute `applies(group, type)`; select the row if any applicable field is empty. Attach `"group"`, `"wine_type"`, and `"need"` (the applicable+empty field set).
- `build_prompt`: build the JSON shape dynamically from `row["need"]` — for each needed field, show its scale (variety → `variety_vocab_for(group)`). 
- `enrich_one`: parse + validate ONLY the needed fields via `FIELD_SPECS` (variety validator takes group); off-vocab/off-scale → None.
- Counters (line 300, 317-320): iterate `for f in FIELDS` instead of hardcoded variety/body.
- `max_tokens`: 200 → 300 (spec §6).

```python
FIELDS = ("variety", "body", "acidity", "tannin", "sweetness")
DRINKABLE = {"Wine", "Spirits", "Whisky", "Sake & Asian", "Liqueur"}
ENRICHMENT_SOURCE = "phase_b_run2_haiku_taste"

def select_rows(conn):
    conn.row_factory = sqlite3.Row
    out = []
    for r in conn.execute(
        "SELECT sku,name,is_in_stock,variety,body,acidity,tannin,sweetness "
        "FROM products ORDER BY sku"
    ):
        if not _instock(r["is_in_stock"]):
            continue
        res = resolve({"sku": r["sku"], "name": r["name"]})
        group, wine_type = res.get("group"), res.get("type")
        if group not in DRINKABLE:
            continue
        ap = applies(group, wine_type)
        need = {f for f in ap if _empty(r[f])}
        if need:
            out.append({**dict(r), "group": group, "wine_type": wine_type, "need": sorted(need)})
    return out

def build_prompt(row):
    lines = []
    for f in row["need"]:
        if f == "variety":
            vocab = ", ".join(variety_vocab_for(row["group"]))
            lines.append(f'"variety": <one of [{vocab}] or null>')
        else:
            scale = ", ".join(FIELD_SPECS[f]["scale"])
            lines.append(f'"{f}": <one of [{scale}] or null>')
    body = ",\n  ".join(lines)
    return (
        f"Product: {row['name']}\nCategory: {row['group']}"
        + (f" ({row['wine_type']})" if row.get("wine_type") else "")
        + "\n\nReturn STRICT JSON {\n  " + body + "\n}.\n"
        "Use ONLY the listed values. If unsure, use null. Never invent a value."
    )
```

In `enrich_one`, replace the variety/body parse block with:

```python
    out = {"sku": row["sku"], "group": row["group"], "status": "ok"}
    for f in FIELDS:
        if f not in row["need"]:
            out[f] = None
            continue
        spec = FIELD_SPECS[f]
        if f == "variety":
            out[f] = spec["validate"](row["group"], raw.get("variety"))
        else:
            out[f] = spec["validate"](raw.get(f))
    # ...tokens/cost as before; counters loop over FIELDS
```

(import `applies, variety_vocab_for, FIELD_SPECS` from `universal_scales`.)

- [ ] **Step 6: Regression test — run with only variety/body active == Run-1 selection shape**

Extend `tests/test_enrich_phase_b_select.py` to assert: for a fixture row that is a non-wine spirit with empty variety, `select_rows` picks it with `need == ["variety"]` (body gated off spirits now — this is the intended §4.0 change, document it in the test). For a red-wine fixture missing all, `need` includes `variety, body, acidity, tannin`. For a white-wine fixture, `need` excludes `tannin`, includes `sweetness`.

```python
def test_select_applies_gating(tmp_path):
    db = _make_fixture_db(tmp_path, rows=[
        dict(sku="WRW001", name="Some Red Wine", is_in_stock="1",
             variety=None, body=None, acidity=None, tannin=None, sweetness=None),  # resolve→Red Wine
        dict(sku="GIN001", name="London Dry Gin", is_in_stock="1",
             variety=None, body=None, acidity=None, tannin=None, sweetness=None),  # resolve→Spirits
    ])
    import sqlite3; from scripts.enrich_phase_b import select_rows
    picked = {r["sku"]: set(r["need"]) for r in select_rows(sqlite3.connect(db))}
    # NOTE: fixture SKUs must map to the intended group via sku_prefix_map; choose real prefixes.
    assert "tannin" in picked.get("WRW001", set())
    assert picked.get("GIN001", set()) == {"variety"}  # spirits: body/acidity/tannin gated off
```

> Worker note: pick fixture SKUs whose prefixes actually resolve to Red Wine / Spirits in `data/taxonomy/sku_prefix_map.json` — verify with `resolve()` in a REPL before finalizing the fixture.

- [ ] **Step 7: Migrate the existing Run-1 tests (LARGER than it looks — read this fully)**

The Run-1 select/validate/parity tests are wired to the OLD contract and will break broadly — this is EXPECTED, not a mistake. Update them deliberately (Rule 5: never keep a test green by preserving old behavior; add a regression-guard comment on each change):

1. **`tests/test_enrich_phase_b_select.py` — fixture schema + assertions.** The fixture `products` table only has `(sku,name,is_in_stock,variety,body,has_recent_sales,sold_orders)`. The new `select_rows` SELECTs `acidity,tannin,sweetness` too → `OperationalError: no such column` on EVERY fixture. **Add the 3 columns to the fixture table builder.** Then:
   - `test_wine_excluded` → INVERTS: wine is now INCLUDED. Rewrite to assert wine IS selected (with correct `need`), rename, add guard comment.
   - `test_no_signal_excluded`, `test_critic_signal_selects`, `test_sold_orders_signal_selects` → the buying-signal gate is GONE (spec §2). These no longer apply; replace with `need`-based applicability assertions (Task 0 Step 6 / Task 5).
   - `test_missing_critic_scores_table_does_not_raise` → becomes meaningless once the critic/signal code is deleted (see Step 5 note); remove it.
2. **`tests/test_enrich_phase_b_validate.py` + the parity test** — `_row()` and `test_build_prompt_parity_all_nonwine_groups` build rows WITHOUT a `need` key; the new `build_prompt`/`enrich_one` do `row["need"]` → `KeyError`. **Add `need=[...]` to those fixture rows** (e.g. `need=["variety","body"]` for a spirit; `need=["variety","body","acidity","tannin"]` for a red wine).
3. Also **delete the now-dead signal/critic/`_sold` block** in `select_rows` (see Step 5) so the no-signal-gate change is unambiguous, and **update the module docstring** (lines 1-22) which still says "non-wine … missing variety and/or body" + "has-a-buying-signal" — now stale.

Run: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -m pytest tests/ -v`
Expected: PASS after the migration above. If you see `no such column` or `KeyError: 'need'`, that's the migration not yet done — not a code bug.

- [ ] **Step 8: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/phase-b-run2" && [ "$(git branch --show-current)" = feat/phase-b-run2 ] && \
git add data/lib/taste_taxonomy/universal_scales.py scripts/enrich_phase_b.py tests/ && \
git commit -m "refactor(enrich): parameterize Phase B field set + applies() gating (Task 0)"
```

---

## Task 1: Free dry-run canary preview (NO spend) — confirm prompts + selection

**Files:** none new (uses Task 0 code).

- [ ] **Step 1: Run the dry-run against the ROOT DB**

Run:
```bash
"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" scripts/enrich_phase_b.py \
  --db "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db" --limit 5 --dry-run
```
Expected: prints `Selected ~2564 rows`, then 5 sample prompts. ZERO API calls. Verify each sample prompt asks ONLY for that row's applicable fields (a spirit asks variety only; a red wine asks variety/body/acidity/tannin; a white asks …+sweetness, no tannin).

- [ ] **Step 2: Sanity-check the selection count vs spec**

Confirm `Selected N` is ≈2,564 (re-count, the shared DB drifts). If wildly off, STOP and investigate before any spend (Rule 2).

- [ ] **Step 3: Commit (if any prompt-format tweak was needed)** — else skip.

---

## Task 2: Extend the merge to all 5 fields (FIX B — $56-class) + generic verify

**Files:**
- Modify: `scripts/merge_phase_b_cache.py:13,90-97`
- Test: `tests/test_merge_phase_b_nullonly.py` (extend)

- [ ] **Step 1: Write the failing test — merge fills acidity/tannin/sweetness NULL-only, never clobbers**

Extend `tests/test_merge_phase_b_nullonly.py`:

```python
def test_merge_all_five_fields_nullonly(tmp_path):
    db = _fixture_db(tmp_path, [
        dict(sku="A", variety="Single Malt", body=None, acidity=None, tannin=None, sweetness=None),
        dict(sku="B", variety=None, body="Full", acidity="High", tannin=None, sweetness=None),
    ])
    sidecar = tmp_path / "side.jsonl"
    sidecar.write_text(
        json.dumps(dict(sku="A", variety="Blended", body="Medium", acidity="Low", tannin="Low", sweetness="Dry")) + "\n" +
        json.dumps(dict(sku="B", variety="Merlot", body="Light", acidity="Low", tannin="Medium", sweetness="Sweet")) + "\n"
    )
    run_merge(["--db", str(db), "--sidecar", str(sidecar), "--apply"])
    row = read(db, "A")
    assert row["variety"] == "Single Malt"   # NOT clobbered (Rule 5)
    assert row["body"] == "Medium" and row["acidity"] == "Low" and row["tannin"] == "Low" and row["sweetness"] == "Dry"
    rowB = read(db, "B")
    assert rowB["body"] == "Full" and rowB["acidity"] == "High"  # NOT clobbered
    assert rowB["variety"] == "Merlot" and rowB["tannin"] == "Medium" and rowB["sweetness"] == "Sweet"  # filled
```

- [ ] **Step 2: Run it, verify it fails** — acidity/tannin/sweetness stay None because `FIELDS=("variety","body")`.

Run: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -m pytest tests/test_merge_phase_b_nullonly.py::test_merge_all_five_fields_nullonly -v`
Expected: FAIL.

- [ ] **Step 3: Extend `FIELDS` + generalize the verify print**

`scripts/merge_phase_b_cache.py`:
```python
FIELDS = ("variety", "body", "acidity", "tannin", "sweetness")
```
Replace the hardcoded verify print (lines 96-97) with:
```python
    after = {f: populated(f) for f in FIELDS}
    print("verify (gross DB totals — NOT Rule-1; see verify_phase_b_shipped.py): " +
          "; ".join(f"{f} {before[f]}->{after[f]}" for f in FIELDS))
```

- [ ] **Step 4: Run it, verify pass**

Run: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -m pytest tests/test_merge_phase_b_nullonly.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/phase-b-run2" && [ "$(git branch --show-current)" = feat/phase-b-run2 ] && \
git add scripts/merge_phase_b_cache.py tests/test_merge_phase_b_nullonly.py && \
git commit -m "fix(merge): extend Phase B merge to all 5 taste fields, NULL-only (Task 2, FIX B)"
```

---

## Task 3: Rule-1 verify-shipped script (FIX C) — assert merged SKUs in the EXPORT JSON

**Files:**
- Create: `scripts/verify_phase_b_shipped.py`
- Test: `tests/test_verify_phase_b_shipped.py`

- [ ] **Step 1: Write the failing test**

```python
def test_verify_shipped_detects_missing(tmp_path):
    # export JSON missing field for a merged sku -> verify returns nonzero / reports it
    export = tmp_path / "live_products_export.json"
    export.write_text(json.dumps([{"sku":"A","body":"Full","sweetness":""}]))
    sidecar = tmp_path / "side.jsonl"
    sidecar.write_text(json.dumps(dict(sku="A", body="Full", sweetness="Sweet"))+"\n")
    from scripts.verify_phase_b_shipped import verify
    missing = verify(export_path=export, sidecar_path=sidecar)
    assert ("A", "sweetness") in missing   # sidecar wrote sweetness but export shows empty
    assert ("A", "body") not in missing
```

- [ ] **Step 2: Run it, verify it fails** (module missing). Expected: FAIL.

- [ ] **Step 3: Implement `verify_phase_b_shipped.py`**

```python
"""Rule-1 verify-shipped: for the EXACT set of (sku, field) values written this run
(from the sidecar), assert each is non-empty in live_products_export.json.
Gross DB column totals are NOT verification (they read the DB and can rise from
unrelated rows). This reads the USER-FACING export. Exits nonzero if any miss."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path

FIELDS = ("variety", "body", "acidity", "tannin", "sweetness")

def verify(export_path, sidecar_path):
    export = {p["sku"]: p for p in json.loads(Path(export_path).read_text())}
    missing = []
    seen = set()
    for line in Path(sidecar_path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        sku = rec.get("sku")
        for f in FIELDS:
            v = rec.get(f)
            if not v:                      # sidecar didn't write this field for this sku
                continue
            seen.add((sku, f))
            row = export.get(sku)
            shipped = row and str(row.get(f) or "").strip()
            if not shipped:
                missing.append((sku, f))
    return missing

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--sidecar", required=True)
    a = ap.parse_args(argv)
    missing = verify(a.export, a.sidecar)
    if missing:
        print(f"RULE-1 FAIL: {len(missing)} (sku,field) written to cache but NOT in export:", file=sys.stderr)
        for sku, f in missing[:50]:
            print(f"  {sku} {f}", file=sys.stderr)
        return 1
    print("RULE-1 OK: every field written this run is populated in live_products_export.json")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

> Note: a NULL-only merge legitimately leaves a sidecar field unshipped if the DB row already had a value (Rule 5). To avoid false fails, the verify should treat "export already non-empty" as shipped (it does — it only flags empty export values). Edge case for the worker to confirm in a second test: sidecar wrote `body=Medium` but DB already had `body=Full` → export shows `Full` → NOT missing (correct).

- [ ] **Step 4: Write the not-clobbered edge-case test (false-positive guard), run both, verify pass**

Add to `tests/test_verify_phase_b_shipped.py` — a sidecar field that the NULL-only merge legitimately did NOT ship (DB already had a value) must NOT be reported missing, because the export shows the pre-existing value (non-empty):

```python
def test_verify_shipped_preexisting_value_not_flagged(tmp_path):
    export = tmp_path / "live_products_export.json"
    # sidecar wrote body=Medium, but DB already had body=Full -> export shows Full (non-empty)
    export.write_text(json.dumps([{"sku":"A","body":"Full"}]))
    sidecar = tmp_path / "side.jsonl"
    sidecar.write_text(json.dumps(dict(sku="A", body="Medium"))+"\n")
    from scripts.verify_phase_b_shipped import verify
    assert verify(export_path=export, sidecar_path=sidecar) == []  # Full is shipped → no miss
```

Run: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -m pytest tests/test_verify_phase_b_shipped.py -v`
Expected: PASS (both the missing-detection test and this false-positive guard).

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/phase-b-run2" && [ "$(git branch --show-current)" = feat/phase-b-run2 ] && \
git add scripts/verify_phase_b_shipped.py tests/test_verify_phase_b_shipped.py && \
git commit -m "feat(verify): Rule-1 merged-SKU-set export assertion for Phase B (Task 3, FIX C)"
```

---

## Task 4: Make `sweetness` render on the product gauge (§4.6, the ONLY catalog code change)

**Files:**
- Modify: `apps/catalog/lib/taste-adapter.ts:40,45-67,112-121`
- Test: `apps/catalog/lib/__tests__/taste-adapter.test.ts` (extend)

- [ ] **Step 1: Write the failing test (vitest)**

In `apps/catalog/lib/__tests__/taste-adapter.test.ts`:

```ts
import { toStructural } from '../taste-adapter';
it('emits sweetness on the gauge scale and drops off-scale', () => {
  expect(toStructural({ sweetness: 'Sweet' } as any).sweetness).toBe('Sweet');
  expect(toStructural({ sweetness: 'Off-Dry' } as any).sweetness).toBe('Off-Dry');
  // sake-ladder lowercase value is off the gauge scale -> dropped (no all-empty gauge)
  expect(toStructural({ sweetness: 'very dry' } as any).sweetness).toBeUndefined();
  expect(toStructural({} as any).sweetness).toBeUndefined();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/taste-adapter.test.ts`
Expected: FAIL (`toStructural` doesn't emit sweetness; `normalizeScale('sweetness',…)` returns null).

- [ ] **Step 3: Extend `Axis`, `SCALE`, `REMAP`, and `toStructural`**

`apps/catalog/lib/taste-adapter.ts`:
```ts
type Axis = 'body' | 'acidity' | 'tannin' | 'sweetness';
// in REMAP add:
  sweetness: {},   // no aliases — model emits exact gauge values, validate guards
// in SCALE add:
  sweetness: new Set(['Dry', 'Off-Dry', 'Medium-Sweet', 'Sweet']),
```
In `toStructural` (after tannin):
```ts
  const sweetness = normalizeScale('sweetness', product.sweetness);
  if (sweetness) out.sweetness = sweetness;
```
Fix the stale comment at line 108-110 ("sweetness… no flat source") — it now has one.

- [ ] **Step 4: Run it, verify pass + full catalog test suite**

Run: `cd apps/catalog && npx vitest run lib/__tests__/taste-adapter.test.ts && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/phase-b-run2" && [ "$(git branch --show-current)" = feat/phase-b-run2 ] && \
git add apps/catalog/lib/taste-adapter.ts apps/catalog/lib/__tests__/taste-adapter.test.ts && \
git commit -m "feat(catalog): toStructural emits sweetness gauge; extend normalizeScale (Task 4, §4.6)"
```

---

## Task 5: Applicability + validator unit tests (the §4.0 guards) — lock the gates

**Files:** Test: `tests/test_universal_scales.py` (extend)

- [ ] **Step 1: Write the failing tests — type-gates + scale validators + sake-ladder rejection**

```python
def test_tannin_gate_by_wine_type():
    from data.lib.taste_taxonomy.universal_scales import applies
    assert "tannin" in applies("Wine", "Red Wine")
    assert "tannin" in applies("Wine", "Orange Wine")
    for t in ("White Wine", "Sparkling & Champagne", "Rosé Wine"):
        assert "tannin" not in applies("Wine", t)

def test_sweetness_gate_by_wine_type():
    from data.lib.taste_taxonomy.universal_scales import applies
    for t in ("Sweet/Dessert", "Fortified", "White Wine", "Sparkling & Champagne"):
        assert "sweetness" in applies("Wine", t)
    assert "sweetness" not in applies("Wine", "Red Wine")
    assert "sweetness" not in applies("Wine", "Rosé Wine")

def test_body_acidity_gates():
    from data.lib.taste_taxonomy.universal_scales import applies
    assert "body" not in applies("Whisky") and "body" not in applies("Spirits")
    assert "acidity" not in applies("Sake & Asian")
    assert "body" in applies("Sake & Asian")

def test_validate_sweetness_rejects_sake_ladder():
    from data.lib.taste_taxonomy.universal_scales import validate_sweetness
    assert validate_sweetness("Off-Dry") == "Off-Dry"
    assert validate_sweetness("very dry") is None  # sake-ladder lowercase -> dropped (gauge trap)
    assert validate_sweetness("Medium-Sweet") == "Medium-Sweet"

def test_validate_acidity_tannin_scale():
    from data.lib.taste_taxonomy.universal_scales import validate_acidity, validate_tannin
    assert validate_acidity("Medium-High") == "Medium-High"
    assert validate_tannin("Full") is None  # body-scale word, not acidity/tannin scale
```

- [ ] **Step 2: Run, verify fail/pass** — these should PASS if Task 0 was correct; if any FAIL, fix `applies`/validators (these are the load-bearing §4.0 guards).

Run: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -m pytest tests/test_universal_scales.py -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/phase-b-run2" && [ "$(git branch --show-current)" = feat/phase-b-run2 ] && \
git add tests/test_universal_scales.py && \
git commit -m "test(enrich): lock §4.0 applicability gates + scale validators (Task 5)"
```

---

## Task 6: Full Python + catalog suites green; freeze the grape vocab artifact

**Files:** none new (verification gate).

- [ ] **Step 1: Run the full Python suite**

Run: `"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -m pytest tests/ -v`
Expected: PASS. Any Run-1 test asserting the old signal-gate or body-for-spirits must already be updated (Task 0 step 7) with a Rule-5 regression-guard comment.

- [ ] **Step 2: Run the catalog suite + typecheck + build**

Run: `cd apps/catalog && npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS (memory `feedback_gate_on_build_not_tests`: build catches cross-file type issues tests miss).

- [ ] **Step 3: Eyeball the frozen wine grape vocab** — confirm `WINE_GRAPE_VOCAB` contains all 15 finder tokens (else those wines stop scoring) and the broadened grapes. This list is the committed artifact (no separate file needed; it lives in `universal_scales.py`).

- [ ] **Step 4: Commit (if anything changed)** — else skip.

---

## Task 7: Pre-flight readiness (NO spend) — backup, count, group-resolution assert

**Files:** none new (operator runbook step).

- [ ] **Step 1: Assert ROOT DB is the real one (non-empty)**

Run:
```bash
"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -c "import sqlite3; print(sqlite3.connect('/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db').execute('SELECT COUNT(*) FROM products').fetchone()[0])"
```
Expected: 11436 (NOT 0 — 0 means the empty worktree DB; STOP).

- [ ] **Step 2: Back up the ROOT DB by ABSOLUTE path**

Run:
```bash
cp "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db" "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db.bak-pre-run2"
ls -la "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db.bak-pre-run2"
```
Expected: ~88 MB backup exists.

- [ ] **Step 3: Assert all selected rows resolve to a drinkable group + the gate types are LIVE**

Run the dry-run (Task 1) again and confirm `Selected N` and that no selected SKU has an unknown group. **Also print the distribution of `resolve()["type"]` over selected Wine rows** and confirm the literal gate strings are present (`Red Wine`, `White Wine`, `Sparkling & Champagne`, `Sweet/Dessert`, `Fortified`). If a taxonomy rename has changed them (e.g. `Sparkling` vs `Sparkling & Champagne`), the tannin/sweetness gate would silently zero out — STOP and fix the `_RED_TYPES`/`_SWEETNESS_WINE_TYPES` literals to match. Record N for the cost estimate.

```bash
"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" -c "
import sqlite3,sys; sys.path.insert(0,'data/lib/taxonomy'); import sku_taxonomy as t
from collections import Counter
db=sqlite3.connect('/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db'); db.row_factory=sqlite3.Row
c=Counter(t.resolve({'sku':r['sku'],'name':r['name']})['type'] for r in db.execute('SELECT sku,name FROM products') if t.resolve({'sku':r['sku'],'name':r['name']})['group']=='Wine')
print(dict(c))"
```
Expected: keys include the exact gate strings above.

- [ ] **STOP — do not proceed to Task 8 without the canary + user sign-off.**

---

## Task 8: Rule-10 canary → estimate → SIGN-OFF → full run → merge → verify-shipped (THE PAID TASK)

**Files:** none new. This is the gated execution; each sub-step is an operator action.

- [ ] **Step 1: Paid canary — 5 SKUs to cache only**

Pick a MIXED 5-SKU set (≥1 Red Wine, 1 White/Sparkling, 1 dessert/fortified, 1 spirit, 1 sake). Run:
```bash
"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" scripts/enrich_phase_b.py \
  --db "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db" --limit 5 --ts canary
```
Expected: <$0.01, sidecar `data/phase_b_results-canary.jsonl` with 5 rows.

- [ ] **Step 2: Eyeball canary accuracy** — variety in-vocab + on a real grape for wine; body/acidity/tannin/sweetness on correct scales; **tannin only on the red; body absent for the spirit; acidity absent for the sake; sweetness present on dessert/white**. If poor, reconsider model (Sonnet) before scaling.

- [ ] **Step 3: Estimate full-run cost** from the canary's measured per-SKU token rate × the run-time selected N. Show the user.

- [ ] **Step 4: 🚦 GET USER SIGN-OFF on the number. Do NOT proceed without it.**

- [ ] **Step 5: Full run → cache** (after sign-off):
```bash
"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" scripts/enrich_phase_b.py \
  --db "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db" --ts full
```
(Resume note: `--skip-done` is SKU-only — safe only for an identical selection within this run. A crash mid-run → re-run with `--skip-done --ts full` to continue without re-paying.)

- [ ] **Step 6: Merge cache → ROOT DB (NULL-only), dry-run first**:
```bash
PYBIN="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python"; DB="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db"
"$PYBIN" scripts/merge_phase_b_cache.py --db "$DB" --sidecar data/phase_b_results-full.jsonl --ts run2   # dry-run
"$PYBIN" scripts/merge_phase_b_cache.py --db "$DB" --sidecar data/phase_b_results-full.jsonl --ts run2 --apply
```

- [ ] **Step 7: Refresh the UI export (Rule 9)**:
```bash
"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" scripts/refresh_live_export.py
```

- [ ] **Step 8: Verify-shipped (Rule 1, FIX C)**:
```bash
"/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python" scripts/verify_phase_b_shipped.py \
  --export data/live_products_export.json --sidecar data/phase_b_results-full.jsonl
```
Expected: `RULE-1 OK`. If it reports misses, STOP and investigate (do NOT claim success).

- [ ] **Step 9: Rule-7 browser check** — `cd apps/catalog && npm run dev` (port :3100), open a Port/Sauternes product page, confirm the **Sweetness gauge renders populated** (a wine whose ONLY new field is sweetness, so a populated gauge proves the §4.6 path). Confirm no crash.

- [ ] **Step 10: Rule-4 cost report** — print: total spend, # API calls, **# rows where each of variety/body/acidity/tannin/sweetness is populated in `live_products_export.json`** (from the verify script / a count), per-successful-row cost, and # `api_error` SKUs (abandoned unless re-run with fresh `--ts`).

- [ ] **Step 11: Commit the data run artifacts + open PR**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/phase-b-run2" && [ "$(git branch --show-current)" = feat/phase-b-run2 ] && \
git add data/live_products_export.json docs/ && \
git commit -m "feat(enrich): Phase B Run 2 — taste fields for in-stock drinkables (paid, \$X) verified shipped"
```
(Do NOT commit the 88 MB products.db — it's gitignored. The export JSON is the committed UI source.)

---

## Done criteria
- All Python + catalog tests green; `npm run build` green.
- `verify_phase_b_shipped.py` → RULE-1 OK for the merged-SKU set.
- Browser: a dessert/fortified wine page shows a populated Sweetness gauge.
- Rule-4 cost report shows per-field shipped counts in the export.
- No existing values clobbered (NULL-only merge + tests prove it).
