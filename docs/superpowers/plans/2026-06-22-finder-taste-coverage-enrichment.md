# Finder Taste-Coverage Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill the structured taste fields the `/finder` ranks on — wine `body`, sake `sweetness`, whisky `smokiness` — so the finder's matching answers actually discriminate instead of returning "no signal → neutral" for 13–58% of each pool.

**Architecture:** Two phases. **Phase A (free, deterministic):** rules/lookup backfill from the product `name` + SKU taxonomy, extending `data/lib/name_inference`. **Phase B (paid LLM, Rule-10 gated):** fill only the rows Phase A can't, reusing `enrichment_cache` (4,316 rows) so re-runs are cheap. Both write through the **universal attribute names** (`body`/`sweetness`/`smokiness`), via the `ATTRIBUTE_MAP` seam, so this is name-agnostic to the rename.

**Tech Stack:** Python 3.9 (`.venv`), SQLite (`data/db/products.db`), `refresh_live_export.py` (the two-source bridge, Rule 9), Anthropic API (Phase B only), pytest.

---

## ⚠️ HARD PRECONDITION — do not start until this is true

This plan writes to the `body` / `sweetness` / `smokiness` columns **under their universal names**. As of 2026-06-22 the universal-attributes rename is committed on `feat/universal-attributes` through **Stage 2** (DB+Supabase renamed, Python readers flipped) **but the live export `data/live_products_export.json` still carries the OLD names** (`wine_body`, `grape_variety`, …) and **none of the new columns exist in the export**.

**Gate (verify before Task 1):**
```bash
.venv/bin/python -c "import json; k=set(json.load(open('data/live_products_export.json'))[0]); \
print('READY' if {'body','sweetness'} <= k and 'wine_body' not in k else 'NOT READY — rename not exported')"
```
Expected: `READY`. If `NOT READY`, the universal-attributes rename (its own plan: `docs/superpowers/plans/2026-06-22-universal-attributes-migration.md`) must MERGE and the export must regenerate first. **Writing enrichment before this = throwaway work against soon-renamed columns.** STOP and surface to the user.

Also confirm the `ATTRIBUTE_MAP` seam module is importable on your branch (it ships with the
rename, not this plan — Task 1+ import it). If this fails, the rename merge is incomplete:

```bash
.venv/bin/python -c "from data.lib.taxonomy.attribute_map import ATTRIBUTE_MAP; print('ATTRIBUTE_MAP ok')"
```

Also confirm the `sweetness`/`smokiness` columns physically exist (they are in `NEW_COLUMNS`):
```bash
.venv/bin/python -c "import sqlite3; c=sqlite3.connect('data/db/products.db'); \
print([r[1] for r in c.execute('PRAGMA table_info(products)') if r[1] in ('body','sweetness','smokiness','intensity')])"
```
Expected: all four present.

---

## Why this exists (audit findings, 2026-06-22)

Measured against the live export (in-stock pools). The finder reads these for ranking; missing = the answer scores 0 (neutral "no signal", never penalized — but the question stops discriminating):

| Finding | Field | Coverage today | Effect on finder |
|---|---|---|---|
| **W1** | `body` (wine) | 85% red / 87% white / 89% sparkling | 13–15% of each wine pool invisible to the body question |
| **W2** | `sweetness` (sake) | 42% sake; skewed (off-dry 104 / sweet 12) | sake's PRIMARY question neutral for 58% of sake; "Sweet" answer has only 12 bottles |
| **W4** | `smokiness` (whisky) | not structured; finder proxies on `region=Islay` (27 rows) | peated non-Islay whiskies get no peat credit |

Phase A reach (verified feasibility, free): `smokiness` from name keywords (Islay/peated/smoky) + sweetness/body from style keywords. Phase B fills the residue.

> **🔴 LOAD-BEARING CONNECTION (plan-review finding 2026-06-22).** Populating the flat
> `smokiness` / `sweetness` columns alone produces **ZERO finder effect** with today's code,
> because the finder does not read those columns:
> - Whisky peat: `peatScore()` in `apps/catalog/lib/finder/scoring.ts` reads ONLY `region`
>   (`norm(region) === 'islay'`) — never a `smokiness` field.
> - Sake sweetness: `sakeSweetness()` reads the NESTED `taste_profile.axes.sweetness.value`,
>   NOT the flat `sweetness` column.
> So the backfill must be paired with a **finder rewire (Task 0 below)** that makes the finder
> READ the flat columns — otherwise this plan fills dead columns and the Rule-7 walkthrough
> shows no change (a Rule-1 false-success trap). Wine `body` is exempt: this branch is based
> on `feat/universal-attributes`, so the finder ALREADY reads the universal `p.body` / `p.variety`
> directly — wine body/variety work end-to-end with no rewire. Task 0 covers ONLY sake
> sweetness + whisky smokiness (still read via taste_profile / region today).

## File Structure

- **Modify (Task 0, FIRST)** `apps/catalog/lib/finder/scoring.ts` — `peatScore` reads `p.smokiness` (falling back to the `region=Islay` proxy when smokiness is absent, so nothing regresses); `sakeSweetness` reads the flat `p.sweetness` column with the nested `taste_profile.axes.sweetness.value` as fallback. Plus `apps/catalog/lib/types.ts` + the `PUBLIC_FIELDS` allowlist in `apps/catalog/lib/catalog-data.ts` — add `smokiness`/`sweetness` so they survive projection to the UI (else the allowlist strips them; see [[project_sku_taxonomy]] Task-7 PUBLIC_FIELDS gotcha).
- **Create** `data/lib/enrichment/taste_rules.py` — pure deterministic inferers: `infer_body(name, category_type) -> str|None`, `infer_sweetness(name, category_type) -> str|None`, `infer_smokiness(name, region) -> str|None`. No I/O. One responsibility: name/lookup → a ladder value. Mirrors the `name_inference/rules.py` style.
- **Create** `tests/test_taste_rules.py` — unit tests for the three inferers (table-driven).
- **Create** `scripts/backfill_taste_phase_a.py` — applies `taste_rules` to `products.db` for NULL-only rows, dry-run by default, `--apply` to write; prints a per-field fill delta. Backs up the DB first (Rule 10).
- **Create** `tests/test_backfill_taste_phase_a.py` — integration test on a temp DB: asserts only-NULL rows are filled, populated rows untouched, fill counts match.
- **Modify** `scripts/audit_data_validity.py` — add a "universal-axis coverage" report (per-category fill-rate of body/sweetness/smokiness) so the dashboard shows progress, not false "wine attr on spirit" warnings (folds in the spec's audit-inversion ask).
- **Phase B (separate sub-plan, written only after Phase A lands & is verified):** `scripts/backfill_taste_phase_b.py` — LLM gap-fill, canary-first, estimate-first. NOT built in this plan; this plan ends with the Phase-B go/no-go gate.

**Out of scope:** `intensity` (a universal column that ships with the rename) is referenced by the precondition gate + the audit coverage report only — this plan does NOT backfill it (the finder doesn't rank on it yet). Listed so an implementer doesn't expect it filled here.

All Python column writes go through `ATTRIBUTE_MAP` (`data/lib/taxonomy/attribute_map.py`, ships with the rename) so the script never hardcodes `body` vs `wine_body`.

---

## Task 0 (DO FIRST): finder READS the flat smokiness/sweetness columns

**Why first:** until the finder reads these columns, the Phase-A backfill fills dead data and
the Rule-7 walkthrough shows no change. This task is pure TS, has no data dependency, and can
land even before the rename (it adds a NEW read with a fallback to the existing behaviour, so it
never regresses). Wine `body` needs NO change here — the finder already reads it (rename Stage 3
flips `wine_body`→`body`).

**Files:**
- Modify: `apps/catalog/lib/finder/scoring.ts` (`peatScore`, `sakeSweetness`)
- Modify: `apps/catalog/lib/types.ts` (add `smokiness?`, `sweetness?` to `PublicProduct`)
- Modify: `apps/catalog/lib/catalog-data.ts` (add both to `PUBLIC_FIELDS` allowlist)
- Test: `apps/catalog/lib/finder/__tests__/scoring.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// smokiness column drives peat even for a NON-Islay peated whisky (was impossible via region).
it('peat heavy: a smokiness="heavy" non-Islay whisky scores like an Islay one', () => {
  const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
  const pool = [W({sku:'LWHspey', region:'Speyside', smokiness:'heavy'}), W({sku:'LWHplain', region:'Speyside'})];
  const out = scoreProducts({ category:'whisky', peat:'heavy' } as any, pool as any);
  expect(out.products[0].sku).toBe('LWHspey'); // smokiness column wins, not region
});
it('peat falls back to region=Islay when smokiness column is absent (no regression)', () => {
  const W = (o:any)=>({ price:2000, is_in_stock:true, classification:'Whisky', country:'Scotland', ...o });
  const pool = [W({sku:'LWHspey', region:'Speyside'}), W({sku:'LWHislay', region:'Islay'})];
  const out = scoreProducts({ category:'whisky', peat:'heavy' } as any, pool as any);
  expect(out.products[0].sku).toBe('LWHislay');
});
it('sake sweetness reads the flat column when present', () => {
  const SK = (sku:string,o:any={})=>({ sku, price:4000, is_in_stock:true, category_group:'Sake & Asian', category_type:'Sake/Shochu', ...o });
  const pool = [SK('LSKdry',{sweetness:'Dry'}), SK('LSKsweet',{sweetness:'Sweet'})];
  const out = scoreProducts({ category:'sake', axis1:'sweet' } as any, pool as any);
  expect(out.products[0].sku).toBe('LSKsweet');
});
it('sake sweetness falls back to taste_profile.axes when flat column absent (no regression)', () => {
  const SK = (sku:string,o:any={})=>({ sku, price:4000, is_in_stock:true, category_group:'Sake & Asian', category_type:'Sake/Shochu', ...o });
  const pool = [SK('LSKdry',{taste_profile:{axes:{sweetness:{value:'Dry'}}}}), SK('LSKsweet',{taste_profile:{axes:{sweetness:{value:'Sweet'}}}})];
  const out = scoreProducts({ category:'sake', axis1:'sweet' } as any, pool as any);
  expect(out.products[0].sku).toBe('LSKsweet');
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `cd apps/catalog && npx vitest run lib/finder/__tests__/scoring.test.ts` → the two flat-column tests FAIL (columns not read yet); the two fallback tests already PASS.

- [ ] **Step 3: Implement the dual reads.**
  - `peatScore(token, region, smokiness?)`: if `smokiness` present, use it directly (`heavy`→reward, `none`→reward-clean, `light`/absent→0); ELSE fall back to the existing `region==='islay'` proxy. Wire the call site to pass `p.smokiness`. Also: handle the `light` token honestly (still 0 for ranking, but documented — INFO from review).
  - `sakeSweetness(p)`: read `p.sweetness` (flat) first; if absent, fall back to the existing nested `taste_profile.axes.sweetness.value`. Same return contract (string | undefined).
  - `types.ts`: add `smokiness?: string; sweetness?: string;` to `PublicProduct`.
  - `catalog-data.ts`: add `'smokiness','sweetness'` to `PUBLIC_FIELDS` (the drift-guard type will fail to compile if you forget `types.ts` — that's intended).

- [ ] **Step 4: Run to verify all pass + Rule-7 sanity.** Run: `cd apps/catalog && npx vitest run lib/finder && npx tsc --noEmit` → all green. Then a quick browser sanity-check (`:3100`): `cat=whisky&peat=heavy` and `cat=sake&a1=sweet` still rank normally via the fallback paths and don't crash (the VISIBLE taste improvement only appears after the Task-4 backfill — this check just confirms no regression from the new reads).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/finder/scoring.ts apps/catalog/lib/types.ts apps/catalog/lib/catalog-data.ts apps/catalog/lib/finder/__tests__/scoring.test.ts
git commit -m "feat(finder): read flat smokiness/sweetness columns (region/taste_profile fallback)"
```

> This task makes the columns LOAD-BEARING. Now the Phase-A backfill below has a path to the UI.

---

## Phase A — Task 1: `infer_smokiness` (highest-value, cleanest signal)

**Files:**
- Create: `data/lib/enrichment/taste_rules.py`
- Test: `tests/test_taste_rules.py`

Smokiness ladder (matches the finder's intent): `none | light | heavy`. Signal is unambiguous in the name/region for whisky.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_taste_rules.py
from data.lib.enrichment.taste_rules import infer_smokiness

def test_islay_region_is_heavy():
    assert infer_smokiness("Ardbeg 10 Year Old", "Islay") == "heavy"
def test_peated_keyword_is_heavy():
    assert infer_smokiness("Benriach The Smoky Ten", "Speyside") == "heavy"
def test_lightly_peated_is_light():
    assert infer_smokiness("Highland Park 12 (lightly peated)", "Islands") == "light"
def test_no_signal_is_none_value():
    # An unpeated Speyside with no keyword → 'none' (clean), NOT None (unknown).
    assert infer_smokiness("Glenfiddich 12", "Speyside") == "none"
def test_non_whisky_returns_None():
    # No region + no keyword on a non-whisky name → None (no claim).
    assert infer_smokiness("Tanqueray London Dry Gin", "") is None

# ── NEGATION GUARD (from live-data validation 2026-06-22; Rule 5 — don't lock in a bug).
# A naive "name contains 'peat'/distillery" rule mis-flags these REAL in-stock bottles:
def test_explicit_non_peated_overrides_keyword():
    # Name literally says "Non-Peated" — must NOT be heavy even though 'peat' substring is present.
    assert infer_smokiness("Nikka YOICHI Discovery - Non-Peated", "Hokkaido") == "none"
def test_unpeated_islay_distillery_is_not_heavy():
    # Bruichladdich's CLASSIC line is UNPEATED despite being an Islay distillery. region=Islay
    # alone must not force heavy when the name signals the unpeated flagship. (Peated Bruich-
    # laddich = "Port Charlotte"/"Octomore", which DO carry their own peat cue and score heavy.)
    assert infer_smokiness("Bruichladdich The Classic Laddie", "Islay") == "none"
def test_peated_non_islay_IS_caught():
    # The whole point of W4: a peated whisky OUTSIDE Islay (region proxy misses these) → heavy.
    assert infer_smokiness("The Glenturret 10 Years old Peat Smoked", "Highland") == "heavy"
    assert infer_smokiness("Nikka MIYAGIKYO Discovery - Peated", "Miyagikyo") == "heavy"
```

> **Validated against the live export (W4 evidence):** the current finder proxies peat on
> `region=='islay'` (27 bottles). `infer_smokiness` catches **8 genuinely peated whiskies the
> region proxy MISSES** — Glenturret Peat Smoked (Highland), Lark Peated (Tasmania), Nikka
> Miyagikyo Peated (Japan), Matsui The Peated, Prakaan (Khao Yai), Kilchoman Sanaig (Islands),
> Port Charlotte — and (with the negation guard) correctly EXCLUDES Bruichladdich Classic
> (unpeated Islay) and Nikka Yoichi Non-Peated, which the naive rule false-positives.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_taste_rules.py -v`
Expected: FAIL — `ModuleNotFoundError` / `infer_smokiness` not defined.

- [ ] **Step 3: Write minimal implementation**

```python
# data/lib/enrichment/taste_rules.py
"""Deterministic taste-axis inferers (Phase A, free). name/region/type → ladder value.
Pure functions, no I/O. Values feed the universal columns body/sweetness/smokiness.
Conservative by design: return None when there is no confident signal (so Phase B,
not a guess, fills it). 'none' (a real ladder value) is distinct from None (unknown)."""
import re

# Distillery names whose CORE range is heavily peated (so the name alone implies smoke even
# when region data is wrong/missing — validated against live in-stock stock).
_PEAT_HEAVY = re.compile(
    r"\b(peated|smoky|smoke|laphroaig|ardbeg|lagavulin|kilchoman|caol ila|"
    r"port charlotte|octomore|big peat|peat monster)\b", re.I)
# bare 'peat' is matched separately so the negation guard can pre-empt 'non-peated'.
_PEAT_WORD = re.compile(r"\bpeat\b", re.I)
_PEAT_LIGHT = re.compile(r"lightly peated|a touch of (smoke|peat)|gently peated", re.I)
# NEGATION GUARD (Rule 5): explicit "non/un-peated", and Islay distilleries whose FLAGSHIP is
# unpeated (Bruichladdich Classic/Laddie, Bunnahabhain) — region=Islay must NOT force heavy.
_NOT_PEATED = re.compile(
    r"non[- ]?peated|un[- ]?peated|bruichladdich\s+(the\s+)?(classic|laddie|\d)|bunnahabhain", re.I)
_ISLAY = {"islay"}

def infer_smokiness(name: str, region: str = "") -> str | None:
    hay = f"{name} {region}".lower()
    # 1) Explicit non-peated / unpeated-flagship wins over everything (incl. region=Islay).
    if _NOT_PEATED.search(hay):
        return "none"
    if _PEAT_LIGHT.search(hay):
        return "light"
    # 2) Heavy if a peat cue OR an Islay region (the proxy) OR a heavy-distillery name.
    if (region or "").strip().lower() in _ISLAY or _PEAT_HEAVY.search(hay) or _PEAT_WORD.search(hay):
        return "heavy"
    # 3) A whisky-shaped row with a Scotch/whisky region but no peat cue reads as clean.
    if (region or "").strip():
        return "none"
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_taste_rules.py -v`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/taste_rules.py tests/test_taste_rules.py
git commit -m "feat(enrich): deterministic smokiness inferer (Phase A)"
```

---

## Phase A — Task 2: `infer_sweetness` (sake) + `infer_body` (wine)

**Files:**
- Modify: `data/lib/enrichment/taste_rules.py`
- Test: `tests/test_taste_rules.py`

Sweetness ladder: `very dry | dry | off-dry | sweet` (the finder's sake ladder). Body ladder: `light | medium-light | medium | medium-full | full` (the finder's 5-rung body).

- [ ] **Step 1: Write the failing test**

```python
from data.lib.enrichment.taste_rules import infer_sweetness, infer_body

def test_sake_nigori_is_sweet():
    assert infer_sweetness("Hakutsuru Sayuri Nigori Sake", "Sake/Shochu") == "sweet"
def test_sake_karakuchi_is_dry():
    assert infer_sweetness("Ozeki Karakuchi Dry Sake", "Sake/Shochu") == "dry"
def test_sake_no_keyword_returns_None():
    assert infer_sweetness("Dassai 45 Junmai Daiginjo", "Sake/Shochu") is None
def test_body_light_keyword():
    assert infer_body("Beaujolais Nouveau (light, easy)", "Red Wine") == "light"
def test_body_full_keyword():
    assert infer_body("Barossa Shiraz — big, full-bodied", "Red Wine") == "full"
def test_body_no_keyword_returns_None():
    assert infer_body("Generic Red Blend", "Red Wine") is None
```

- [ ] **Step 2: Run to verify it fails.** Run: `.venv/bin/python -m pytest tests/test_taste_rules.py -v` → FAIL (new functions undefined).

- [ ] **Step 3: Implement** (append to `taste_rules.py`):

```python
_SWEET = re.compile(r"\bnigori\b|\bamakuchi\b|\bsweet\b|\bplum\b|\bumeshu\b", re.I)
_DRY = re.compile(r"\bkarakuchi\b|\bdry\b|\bsuper dry\b", re.I)

def infer_sweetness(name: str, category_type: str = "") -> str | None:
    hay = name.lower()
    if _SWEET.search(hay):
        return "sweet"
    if _DRY.search(hay):
        return "dry"
    return None  # no confident cue → leave for Phase B (most polished sake has no name cue)

_BODY_FULL = re.compile(r"\b(full[- ]bodied|big|bold|powerful|robust)\b", re.I)
_BODY_LIGHT = re.compile(r"\b(light[- ]bodied|light|easy[- ]drinking|delicate)\b", re.I)

def infer_body(name: str, category_type: str = "") -> str | None:
    hay = name.lower()
    if _BODY_FULL.search(hay):
        return "full"
    if _BODY_LIGHT.search(hay):
        return "light"
    return None  # no cue → Phase B (body is rarely stated in the name; expect low A-reach)
```

- [ ] **Step 4: Run to verify it passes.** Expected: PASS (11/11 total).

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/taste_rules.py tests/test_taste_rules.py
git commit -m "feat(enrich): deterministic sweetness + body inferers (Phase A)"
```

---

## Phase A — Task 3: backfill script (NULL-only, dry-run default, Rule-10 backup)

**Files:**
- Create: `scripts/backfill_taste_phase_a.py`
- Test: `tests/test_backfill_taste_phase_a.py`

**Invariant (Rule 5/6):** only writes a column where it is currently NULL/empty. Never overwrites an existing enriched value. Dry-run prints the delta; `--apply` writes after backing up.

- [ ] **Step 1: Write the failing integration test**

```python
# tests/test_backfill_taste_phase_a.py — temp DB, asserts NULL-only fill + no clobber.
import sqlite3, subprocess, sys, os, tempfile, shutil

def _mkdb(path):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE products (sku TEXT, name TEXT, category_type TEXT, region TEXT, "
              "body TEXT, sweetness TEXT, smokiness TEXT)")
    c.executemany("INSERT INTO products VALUES (?,?,?,?,?,?,?)", [
        ("LWH1","Ardbeg 10","Whisky","Islay",None,None,None),         # smokiness→heavy
        ("LWH2","Glenfiddich 12","Whisky","Speyside",None,None,"light"), # smokiness PRESERVED (light)
        ("LSK1","Ozeki Karakuchi Dry","Sake/Shochu","",None,None,None), # sweetness→dry
    ]); c.commit(); c.close()

def test_fills_nulls_only(tmp_path):
    db = str(tmp_path/"p.db"); _mkdb(db)
    r = subprocess.run([sys.executable,"scripts/backfill_taste_phase_a.py","--db",db,"--apply"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    c = sqlite3.connect(db); rows = dict((s,(b,sw,sm)) for s,b,sw,sm in
        c.execute("SELECT sku,body,sweetness,smokiness FROM products"))
    assert rows["LWH1"][2] == "heavy"      # filled
    assert rows["LWH2"][2] == "light"      # PRESERVED, not overwritten to 'none'
    assert rows["LSK1"][1] == "dry"        # filled
```

- [ ] **Step 2: Run to verify it fails.** Run: `.venv/bin/python -m pytest tests/test_backfill_taste_phase_a.py -v` → FAIL (script missing).

- [ ] **Step 3: Implement the script** (key behaviours: arg `--db` default `data/db/products.db`; `--apply` gate; backup `cp <db> <db>.bak-pre-taste-A-<ts>` when `--apply` on the real DB; for each row read `name/category_type/region`, compute the three inferers, write ONLY where the column `IS NULL OR =''`; print `field: filled N / was-null M` per field). Use `ATTRIBUTE_MAP` to resolve the physical column name. Timestamp comes from `sys.argv`/env, NOT `datetime.now()` inside a tested path (pass `--ts` or stamp in the caller) to keep the test deterministic.

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill_taste_phase_a.py tests/test_backfill_taste_phase_a.py
git commit -m "feat(enrich): Phase A NULL-only taste backfill script (Rule-10 backup)"
```

---

## Phase A — Task 4: run it for real + refresh export + VERIFY SHIPPED (Rules 1, 9)

**Files:** none created — this is the data run + the two-source bridge.

> **⚠️ SHARED-DB HAZARD (memory: shared-products-db-reverts-between-turns).** The single
> `products.db` can be REPLACED by a parallel process between turns, reverting a verified
> write and drifting from Supabase. Therefore: (a) make the backfill **idempotent** (NULL-only
> already is — re-running is safe); (b) **re-query `PRAGMA table_info` and a fill count
> IMMEDIATELY before AND after** the apply, in the SAME turn, and don't trust a prior turn's
> state; (c) for JSON columns compare with decoded `[]` semantics, not `!= ''`; (d) keep the
> apply → `refresh_live_export.py` → verify sequence in ONE turn so a between-turn swap can't
> separate the write from its verification.

- [ ] **Step 1: Backup + dry-run on the REAL DB**

```bash
cp data/db/products.db data/db/products.db.bak-pre-taste-A-$(date +%s)
# Re-query state THIS turn — do not trust a prior turn's PRAGMA (DB may have been swapped).
.venv/bin/python -c "import sqlite3;c=sqlite3.connect('data/db/products.db');\
print('cols ok' if {'body','sweetness','smokiness'} <= {r[1] for r in c.execute('PRAGMA table_info(products)')} else 'MISSING COLS — DB may have reverted; re-run rename')"
.venv/bin/python scripts/backfill_taste_phase_a.py   # dry-run, prints per-field delta
```
Expected: a delta like `smokiness: filled ~250 / was-null ~390`, `sweetness: filled ~60`, `body: filled ~low` (body has weak name signal — that's expected; Phase B carries body).

- [ ] **Step 2: Apply**

```bash
.venv/bin/python scripts/backfill_taste_phase_a.py --apply
```

- [ ] **Step 3: Refresh the live export (Rule 9 — the UI reads the export, not the DB)**

```bash
.venv/bin/python scripts/refresh_live_export.py
```

- [ ] **Step 4: VERIFY SHIPPED — count in the USER-FACING export, not the DB (Rule 1/4)**

```bash
.venv/bin/python -c "
import json; d=json.load(open('data/live_products_export.json'))
ins=[p for p in d if str(p.get('is_in_stock')) in ('1','True','true')]
def grp(p): return (p.get('category_group') or '')
def filled(pool,f): return sum(1 for p in pool if (p.get(f) or '').strip())
wh=[p for p in ins if grp(p)=='Whisky']; sk=[p for p in ins if grp(p)=='Sake & Asian']
print('whisky smokiness:', filled(wh,'smokiness'), '/', len(wh))
print('sake sweetness:', filled(sk,'sweetness'), '/', len(sk))
"
```
Expected: the FLAT-column counts jump from ~0 (whisky smokiness flat 0→~250+; sake sweetness FLAT 0→Phase-A reach). NOTE: the pre-existing 169 sake values live in `taste_profile.axes.sweetness`, NOT the flat `sweetness` column — Task 0's `sakeSweetness` fallback already reads those, so the finder's effective sake coverage is (flat Phase-A fill) ∪ (169 nested) and only the NEW flat rows show in this count. **If the flat count is unchanged → the export didn't pick up the write; STOP and investigate (Rule 1 — do not claim done on a count that didn't move).**

- [ ] **Step 5: Finder re-verify (Rule 7) + commit the regenerated export**

Because Task 0 wired the finder to READ these columns, the walkthrough now genuinely changes.
Run the finder dev server (`:3100`), do `cat=whisky&peat=heavy` (expect non-Islay peated whiskies
now scoring) and `cat=sake&a1=sweet` (expect more genuine sweet-sake matches), confirm the labels
are honest. Then:

```bash
git add data/live_products_export.json data/db/products.db
git commit -m "data(enrich): apply Phase A taste backfill + refresh export (verified shipped)"
```

> The finder reads `p.smokiness` / flat `p.sweetness` as of Task 0, so these columns are
> load-bearing here — no separate follow-up PR needed for the read path.

---

## Phase A — Task 5: audit becomes a coverage dashboard (folds in the spec's ask)

**Files:**
- Modify: `scripts/audit_data_validity.py`

- [ ] **Step 1–4:** Add a `--coverage` report that prints, per category_group, the fill-rate of `body`/`sweetness`/`smokiness`/`intensity`. Stop emitting "wine attr on spirit" as a warning (the universal model makes those correct). Add a regression test asserting the report runs and returns per-category rows. Commit.

```bash
git commit -m "feat(audit): universal-axis coverage report (replaces false wine-attr warnings)"
```

---

## PHASE B GATE — stop here; do not spend without sign-off (Rule 10)

Phase A is free and now landed. Phase B (LLM gap-fill for the rows rules couldn't reach — most of `body`, the polished-sake `sweetness` residue) is **paid** and is a **separate plan**, written only after Phase A is verified shipped. Before that plan runs:

1. Backup the target table.
2. **5-SKU canary** per category; verify the values in the finder UI.
3. **Estimate full-run cost** from the canary per-SKU rate; **show the user the number and get sign-off** (Rule 10 step 5).
4. Reuse `enrichment_cache` (4,316 rows) so re-runs are cheap.
5. Verify shipped: count on the new columns in the export AND a finder walkthrough (Rule 1/4).

**This plan ENDS at the Phase-B gate.** The implementer must surface the canary estimate to the user and STOP.

---

## Success criteria

1. `taste_rules.py` inferers are pure, tested, conservative (None when unsure).
2. Phase A backfill is NULL-only (never clobbers enriched values), Rule-10 backed up, dry-run-first.
3. Verified SHIPPED in the live export (counts moved) — not just DB rows or log lines.
4. Audit reports universal-axis coverage instead of false warnings.
5. No paid spend occurs in this plan; Phase B is gated behind a signed-off estimate.
