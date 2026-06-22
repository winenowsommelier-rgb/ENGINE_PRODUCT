# /shop "Classification" (Designation) Chip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Classification" filter chip rail to `/shop` that filters by a newly-derived `designation` field (Grand Cru, DOCG, IGT, XO, Reserva, …), parsed from product names.

**Architecture:** Designations do NOT exist as structured data (`classification` = product TYPE per RULE 12; `wine_classification`/`appellation`/`designation` are 0/11,436). We derive a single most-specific designation per product from its `name` via an ordered regex table, kept in TWO parity-locked copies: a pure TS resolver (`lib/designation.ts`, fs-free) for the catalog runtime/facets, and a Python backfill (`scripts/backfill_designation.py`) that persists a `designation` column to `data/db/products.db` and propagates to `data/live_products_export.json`. One chip rail below Origin, wired into the shared `matchesFilters` predicate so grid + facet counts stay in sync.

**Tech Stack:** TypeScript / Next.js (App Router, `apps/catalog`), Vitest, Python 3.9 (`.venv`), SQLite.

---

## CRITICAL PATH FACTS (discovered during planning — do not skip)

- **Canonical DB is `data/db/products.db`** (11,436 rows). The root `products.db` and `data/products.db` have NO products table. `refresh_live_export.py` reads `data/db/products.db`.
- **`refresh_live_export.py` has an `EXPORT_COLS` allowlist** (scripts/refresh_live_export.py:51). A column is exported ONLY if it is in `EXPORT_COLS` AND present in the table. **If you add `designation` to the DB but NOT to `EXPORT_COLS`, the refresh silently drops it and the UI never sees it** — this is the exact Rule-1/Rule-9/$56-Phase-5 failure mode. Both edits are mandatory.
- **`lib/designation.ts` MUST be fs-free** — it is imported by the pure `shop-query` module and (transitively) usable client-side. Do NOT import `sku-taxonomy`/`category-groups` (they pull `fs`). Regex over `p.name` / `p.designation` only.
- **Shared-DB hazard** (memory `feedback_shared_db_reverts_between_turns`): a parallel process can revert an ALTER between turns. Make the backfill idempotent and re-query `PRAGMA table_info` before trusting a prior ALTER.
- **Worktree isolation** (memory `feedback_catalog_worktree_isolation`): the main checkout is shared; verify commit scope before every commit (`git status` / `git diff --stat`) so unrelated files don't get bundled into this work.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `apps/catalog/lib/designation.ts` | Create | Ordered designation pattern table + `designationForProduct()` + `DESIGNATIONS` list. Pure, fs-free. |
| `apps/catalog/lib/designation.test.ts` | Create | Unit tests: priority resolution, no-match, persisted-wins. |
| `apps/catalog/lib/types.ts` | Modify (~line 37) | Add `designation?: string` to `PublicProduct`. |
| `apps/catalog/lib/catalog-data.ts` | Modify (PUBLIC_FIELDS ~line 14-26) | Add `'designation'` to allowlist. |
| `apps/catalog/lib/shop-query.ts` | Modify (matchesFilters + header) | Honor `params.designation`. |
| `apps/catalog/lib/shop-query.test.ts` | Modify or create | Predicate test for designation filtering. |
| `apps/catalog/lib/facets.ts` | Modify | `designationsFor()` (tally then re-order by canonical specificity). |
| `apps/catalog/lib/shop-facets.ts` | Modify | Add `designations` to `ShopFacets`, computed with `omit(params,'designation')`. |
| `apps/catalog/lib/shop-facets.test.ts` | Modify or create | Facet-count == grid-total sync test. |
| `apps/catalog/components/Filters.tsx` | Modify | New "Classification" `FilterAccordion` + `ChipRail` below Origin; `designationOptions` prop + `activeDesignation`. |
| `apps/catalog/app/shop/page.tsx` | Modify (~line 146-153) | Pass `designationOptions={facets.designations}`. |
| `scripts/backfill_designation.py` | Create | Rule-10-gated regex backfill → `data/db/products.db`. |
| `scripts/refresh_live_export.py` | Modify (EXPORT_COLS ~line 51) | Add `"designation"` to allowlist. |
| `tests/test_designation_parity.py` | Create | TS↔Python parity on a shared sample. |
| `tests/test_enrichment_db_invariants.py` | Modify | Invariant: name-detected designation ⇒ export field populated. |

**Commands reference:**
- Catalog tests: `cd apps/catalog && npx vitest run <file>`
- Catalog build: `cd apps/catalog && npm run build` (memory: gate on build, not just tests)
- Dev server: catalog runs on **:3100** (`rm -rf .next` on stale-module 500s)
- Python: `.venv/bin/python ...` from repo root; Python 3.9 (use `from __future__ import annotations`)

---

## Task 1: Designation resolver (TS, pure)

**Files:**
- Create: `apps/catalog/lib/designation.ts`
- Test: `apps/catalog/lib/designation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/catalog/lib/designation.test.ts
import { describe, it, expect } from 'vitest';
import { designationForProduct, DESIGNATIONS } from './designation';

const p = (name: string, extra: Record<string, unknown> = {}) =>
  ({ sku: 'X', name, ...extra }) as any;

describe('designationForProduct', () => {
  it('picks most-specific: DOCG not DOC', () => {
    expect(designationForProduct(p('Chianti Classico DOCG 2019'))).toBe('DOCG');
  });
  it('picks most-specific: Extra Brut not Brut', () => {
    expect(designationForProduct(p('Champagne Extra Brut'))).toBe('Extra Brut');
  });
  it('picks most-specific: Gran Reserva not Reserva', () => {
    expect(designationForProduct(p('Rioja Gran Reserva 2015'))).toBe('Gran Reserva');
  });
  it('picks most-specific: VSOP not VS', () => {
    expect(designationForProduct(p('Cognac VSOP'))).toBe('VSOP');
  });
  it('matches Grand Cru', () => {
    expect(designationForProduct(p('Chablis Grand Cru Les Clos'))).toBe('Grand Cru');
  });
  it('matches IGT', () => {
    expect(designationForProduct(p('Masseto Toscana IGT 2021'))).toBe('IGT');
  });
  it('returns undefined when no designation token', () => {
    expect(designationForProduct(p('Yellow Tail Shiraz'))).toBeUndefined();
  });
  it('does NOT match DOC inside an ordinary word (boundary)', () => {
    expect(designationForProduct(p('Doctorow Estate Red'))).toBeUndefined();
  });
  it('prefers a persisted designation field over name parsing', () => {
    expect(designationForProduct(p('Some Wine DOCG', { designation: 'Grand Cru' }))).toBe('Grand Cru');
  });
  it('DESIGNATIONS is ordered most-specific first (Extra Brut before Brut)', () => {
    expect(DESIGNATIONS.indexOf('Extra Brut')).toBeLessThan(DESIGNATIONS.indexOf('Brut'));
    expect(DESIGNATIONS.indexOf('DOCG')).toBeLessThan(DESIGNATIONS.indexOf('DOC'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/designation.test.ts`
Expected: FAIL — `designation.ts` does not exist / `designationForProduct is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/catalog/lib/designation.ts
/**
 * designation — derive a single most-specific product DESIGNATION (the "class":
 * Grand Cru, DOCG, IGT, XO, Reserva, …) from a product name.
 *
 * WHY a separate field: the raw `classification` field is product TYPE, not a
 * designation (CLAUDE.md ABSOLUTE RULE 12). The structured designation field did
 * not exist; this module + scripts/backfill_designation.py create it.
 *
 * PURE + fs-free: imported by the pure shop-query predicate (unit-tested without
 * Next) and usable client-side. MUST NOT import sku-taxonomy/category-groups
 * (they pull `fs`). Regex over name / persisted field only.
 *
 * PARITY: scripts/backfill_designation.py mirrors this table. tests/
 * test_designation_parity.py guards them against drift — update BOTH together.
 */
import type { PublicProduct } from './types';

/** Ordered MOST-SPECIFIC FIRST. First matching label wins. */
const DESIGNATION_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'Grand Cru',      re: /\bgrand\s+cru\b/i },
  { label: 'Premier Cru',    re: /\b(?:premier\s+cru|1er\s+cru)\b/i },
  { label: 'Cru Classé',     re: /\bcru\s+class[eé]\b/i },
  { label: 'DOCG',           re: /\bDOCG\b/ },
  { label: 'DOC',            re: /\bDOC\b/ },
  { label: 'IGT',            re: /\bIGT\b/ },
  { label: 'DOP/IGP',        re: /\b(?:DOP|IGP)\b/ },
  { label: 'AOC',            re: /\b(?:AOC|AOP)\b/ },
  { label: 'Gran Reserva',   re: /\bgran\s+reserva\b/i },
  { label: 'Reserva',        re: /\b(?:reserva|riserva)\b/i },
  { label: 'Reserve',        re: /\breserve\b/i },
  { label: 'Extra Brut',     re: /\bextra\s+brut\b/i },
  { label: 'Brut',           re: /\bbrut\b/i },
  { label: 'Single Malt',    re: /\bsingle\s+malt\b/i },
  { label: 'XO',             re: /\bXO\b/ },
  { label: 'VSOP',           re: /\bVSOP\b/ },
  { label: 'VS',             re: /\bVS\b/ },
  { label: 'Limited',        re: /\blimited(?:\s+edition)?\b/i },
  { label: 'Vintage',        re: /\bvintage\b/i },
];

/** Canonical ordered label list (most-specific first) for facet ordering + tests. */
export const DESIGNATIONS: readonly string[] = DESIGNATION_PATTERNS.map((d) => d.label);

/**
 * The single most-specific designation for a product, or undefined.
 * Prefers a persisted `designation` field; else parses `name`.
 */
export function designationForProduct(p: PublicProduct): string | undefined {
  const persisted = (p.designation ?? '').trim();
  if (persisted) return persisted;
  const name = p.name ?? '';
  for (const { label, re } of DESIGNATION_PATTERNS) {
    if (re.test(name)) return label;
  }
  return undefined;
}
```

> NOTE: `PublicProduct` does not yet have `designation` — Task 2 adds it. If TS complains here before Task 2, do Task 2 first; they are tightly coupled. Recommended order: 1 → 2 → 1-verify.

- [ ] **Step 4: Run test to verify it passes** (after Task 2's type edit)

Run: `cd apps/catalog && npx vitest run lib/designation.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git status   # verify ONLY designation.{ts,test.ts} + types.ts are staged
git add apps/catalog/lib/designation.ts apps/catalog/lib/designation.test.ts
git commit -m "feat(catalog): add pure designation resolver (name → Grand Cru/DOCG/IGT/…)"
```

---

## Task 2: Field plumbing (type + allowlist)

**Files:**
- Modify: `apps/catalog/lib/types.ts` (PublicProduct, near the existing `classification?` at ~line 37)
- Modify: `apps/catalog/lib/catalog-data.ts` (PUBLIC_FIELDS, ~line 14-26)

- [ ] **Step 1: Add the type field**

In `types.ts`, in the "Optional descriptive / classification fields" block:
```ts
  designation?: string;   // derived class/designation (Grand Cru/DOCG/IGT/XO/…); see lib/designation.ts
```

- [ ] **Step 2: Add to PUBLIC_FIELDS allowlist**

In `catalog-data.ts`, append `'designation'` to the `PUBLIC_FIELDS` array (the drift-guard type at ~line 32-35 requires both edits — if only one is done, the project won't compile).

- [ ] **Step 3: Verify the project still type-checks**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no new errors (drift guard satisfied).

- [ ] **Step 4: Run the Task-1 resolver tests (now that the type exists)**

Run: `cd apps/catalog && npx vitest run lib/designation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/types.ts apps/catalog/lib/catalog-data.ts
git commit -m "feat(catalog): plumb designation through PublicProduct + PUBLIC_FIELDS allowlist"
```

---

## Task 3: Filter predicate

**Files:**
- Modify: `apps/catalog/lib/shop-query.ts` (import + matchesFilters after the geo block, ~line 144; header doc block ~line 24-38)
- Modify/Create: `apps/catalog/lib/shop-query.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/catalog/lib/shop-query.test.ts
import { matchesFilters } from './shop-query';
const prod = (name: string) => ({ sku: 'X', name, country: 'France' }) as any;

it('designation param filters by derived designation', () => {
  expect(matchesFilters(prod('Chablis Grand Cru'), { designation: 'Grand Cru' })).toBe(true);
  expect(matchesFilters(prod('Chablis Grand Cru'), { designation: 'DOCG' })).toBe(false);
  expect(matchesFilters(prod('Yellow Tail Shiraz'), { designation: 'Grand Cru' })).toBe(false);
  // absent param imposes no constraint
  expect(matchesFilters(prod('Yellow Tail Shiraz'), {})).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/shop-query.test.ts -t designation`
Expected: FAIL — predicate ignores `designation` (Grand-Cru/DOCG case wrong).

- [ ] **Step 3: Implement**

Add import at top of `shop-query.ts`:
```ts
import { designationForProduct } from './designation';
```
Insert in `matchesFilters` AFTER the subregion block (~line 144), BEFORE grape:
```ts
  const designation = norm(firstParam(params.designation));
  if (designation && norm(designationForProduct(p)) !== designation) return false;
```
Add a line to the header doc block (near the `region`/`subregion` docs):
```
 *   designation → exact (ci) match on the derived designation (lib/designation.ts:
 *               most-specific single tag parsed from name, e.g. "Grand Cru","DOCG").
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/shop-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/shop-query.ts apps/catalog/lib/shop-query.test.ts
git commit -m "feat(catalog): filter /shop by designation in the shared matchesFilters predicate"
```

---

## Task 4: Facets (option list + count sync)

**Files:**
- Modify: `apps/catalog/lib/facets.ts` (add `designationsFor`)
- Modify: `apps/catalog/lib/shop-facets.ts` (add `designations` to `ShopFacets`)
- Modify/Create: `apps/catalog/lib/shop-facets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/catalog/lib/shop-facets.test.ts
import { describe, it, expect } from 'vitest';
import { shopFacets } from './shop-facets';
import { applyShopQuery } from './shop-query';

const mk = (sku: string, name: string) => ({ sku, name, country: 'France', is_in_stock: '1' }) as any;
const products = [
  mk('A', 'Chablis Grand Cru'),
  mk('B', 'Chianti DOCG'),
  mk('C', 'Yellow Tail Shiraz'),
];

describe('shopFacets.designations', () => {
  it('lists derived designations with counts, drops products with none', () => {
    const f = shopFacets(products, {});
    const labels = f.designations.map((o) => o.value);
    expect(labels).toContain('Grand Cru');
    expect(labels).toContain('DOCG');
    expect(labels).not.toContain('');               // no empty bucket for the Shiraz
  });
  it('facet count for a designation == grid total when that designation is selected', () => {
    const f = shopFacets(products, {});
    const gc = f.designations.find((o) => o.value === 'Grand Cru')!;
    const grid = applyShopQuery(products, { designation: 'Grand Cru' });
    expect(gc.count).toBe(grid.total);
  });
  it('orders by canonical specificity (DOCG before DOC, not by count)', () => {
    const set = [mk('A','Wine DOC'), mk('B','Wine DOC 2'), mk('C','Wine DOCG')];
    const labels = shopFacets(set, {}).designations.map((o) => o.value);
    expect(labels.indexOf('DOCG')).toBeLessThan(labels.indexOf('DOC'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/shop-facets.test.ts`
Expected: FAIL — `f.designations` is undefined.

- [ ] **Step 3: Implement**

In `facets.ts` add (note: `tally` is private; re-implement the count + re-order, or export a small helper — simplest is to tally inline then sort by canonical order):
```ts
import { designationForProduct, DESIGNATIONS } from './designation';

/** Derived designations present, ordered by canonical specificity (most-specific first). */
export function designationsFor(products: PublicProduct[]): FacetOption[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    const v = designationForProduct(p);
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => DESIGNATIONS.indexOf(a.value) - DESIGNATIONS.indexOf(b.value));
}
```
In `shop-facets.ts`:
- import `designationsFor`
- add `designations: FacetOption[]` to the `ShopFacets` interface
- compute and return it:
```ts
  // designations: apply everything EXCEPT designation, so each chip's count
  // reflects the OTHER active filters and selecting one doesn't zero its siblings.
  const designationSet = all.filter((p) => matchesFilters(p, omit(params, 'designation')));
  const designations = designationsFor(designationSet);
```
(add `designations` to the returned object)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/shop-facets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/facets.ts apps/catalog/lib/shop-facets.ts apps/catalog/lib/shop-facets.test.ts
git commit -m "feat(catalog): designation facet options with grid-synced counts"
```

---

## Task 5: UI — Classification chip rail

**Files:**
- Modify: `apps/catalog/components/Filters.tsx` (FiltersProps ~line 65, destructure ~line 441, active reads ~line 483, new accordion after the Origin `</FilterAccordion>` ~line 749)
- Modify: `apps/catalog/app/shop/page.tsx` (~line 146-153)

- [ ] **Step 1: Add the prop + active read**

In `FiltersProps`:
```ts
  /** Designation options WITH counts, ordered most-specific first. */
  designationOptions?: FacetOption[];
```
In the destructure (with the other `= []` defaults): `designationOptions = [],`
With the other active reads (~line 483): `const activeDesignation = get('designation');`

- [ ] **Step 2: Render the accordion (immediately AFTER the Origin `</FilterAccordion>`)**

```tsx
      {/* Classification — derived product designation (Grand Cru/DOCG/IGT/XO/…),
          leaf single-select rail; self-hides when no options under active filters.
          Label is "Classification" per product; field is `designation`. */}
      {designationOptions.length > 0 ? (
        <FilterAccordion
          label="Classification"
          defaultOpen={Boolean(activeDesignation)}
          summary={activeDesignation ? <SectionBadge>{activeDesignation}</SectionBadge> : null}
        >
          <ChipRail
            ariaLabel="Classification"
            options={designationOptions}
            active={activeDesignation}
            onSelect={(value) => apply({ designation: value })}
          />
        </FilterAccordion>
      ) : null}
```
(Confirm `SectionBadge`, `FilterAccordion`, `ChipRail` are already imported/defined in this file — they are, used by Origin.)

- [ ] **Step 3: Wire the page prop**

In `app/shop/page.tsx`, in the `<Filters … />` props (~line 146-153), add:
```tsx
            designationOptions={facets.designations}
```

- [ ] **Step 4: Build + type-check (gate on build, not just tests — memory)**

Run: `cd apps/catalog && npx tsc --noEmit && npm run build`
Expected: clean build. (`rm -rf .next` first if a stale-module 500 appears.)

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/components/Filters.tsx apps/catalog/app/shop/page.tsx
git commit -m "feat(catalog): Classification chip rail on /shop below Origin"
```

---

## Task 6: Python backfill resolver + parity test

**Files:**
- Create: `scripts/backfill_designation.py` (resolver fn first; DB write in Task 7)
- Create: `tests/test_designation_parity.py`

- [ ] **Step 1: Write the parity test (failing)**

```python
# tests/test_designation_parity.py
"""TS lib/designation.ts and scripts/backfill_designation.py must agree."""
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "backfill_designation",
    pathlib.Path(__file__).resolve().parent.parent / "scripts" / "backfill_designation.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
designation_for = mod.designation_for_name

CASES = {
    "Chablis Grand Cru Les Clos": "Grand Cru",
    "Chianti Classico DOCG 2019": "DOCG",
    "Feudi Primitivo di Manduria DOC": "DOC",
    "Masseto Toscana IGT 2021": "IGT",
    "Champagne Extra Brut": "Extra Brut",
    "Tosti Prosecco DOC Extra Dry": "DOC",
    "Rioja Gran Reserva 2015": "Gran Reserva",
    "Tempranillo Reserva": "Reserva",
    "Cognac VSOP": "VSOP",
    "Glenfiddich Single Malt": "Single Malt",
    "Yellow Tail Shiraz": None,
    "Doctorow Estate Red": None,
}

def test_python_resolver_matches_expected():
    for name, expected in CASES.items():
        assert designation_for(name) == expected, f"{name!r} -> {designation_for(name)!r}, want {expected!r}"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_designation_parity.py -v`
Expected: FAIL — module/function does not exist yet.

- [ ] **Step 3: Implement the resolver (parity with the TS table)**

```python
# scripts/backfill_designation.py
#!/usr/bin/env python3
"""Backfill a `designation` column on data/db/products.db from product names.

Designations are the product CLASS (Grand Cru/DOCG/IGT/XO/Reserva/…). They are
NOT the raw `classification` field (that is product TYPE — CLAUDE.md RULE 12).
Pure regex over `name`; NO paid API. Mirrors apps/catalog/lib/designation.ts —
keep them in sync (tests/test_designation_parity.py guards drift).
"""
from __future__ import annotations  # Python 3.9
import argparse, re, shutil, sqlite3, sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

# Ordered MOST-SPECIFIC FIRST — first match wins. Mirrors the TS table EXACTLY.
DESIGNATION_PATTERNS = [
    ("Grand Cru",   re.compile(r"\bgrand\s+cru\b", re.I)),
    ("Premier Cru", re.compile(r"\b(?:premier\s+cru|1er\s+cru)\b", re.I)),
    ("Cru Classé",  re.compile(r"\bcru\s+class[eé]\b", re.I)),
    ("DOCG",        re.compile(r"\bDOCG\b")),
    ("DOC",         re.compile(r"\bDOC\b")),
    ("IGT",         re.compile(r"\bIGT\b")),
    ("DOP/IGP",     re.compile(r"\b(?:DOP|IGP)\b")),
    ("AOC",         re.compile(r"\b(?:AOC|AOP)\b")),
    ("Gran Reserva",re.compile(r"\bgran\s+reserva\b", re.I)),
    ("Reserva",     re.compile(r"\b(?:reserva|riserva)\b", re.I)),
    ("Reserve",     re.compile(r"\breserve\b", re.I)),
    ("Extra Brut",  re.compile(r"\bextra\s+brut\b", re.I)),
    ("Brut",        re.compile(r"\bbrut\b", re.I)),
    ("Single Malt", re.compile(r"\bsingle\s+malt\b", re.I)),
    ("XO",          re.compile(r"\bXO\b")),
    ("VSOP",        re.compile(r"\bVSOP\b")),
    ("VS",          re.compile(r"\bVS\b")),
    ("Limited",     re.compile(r"\blimited(?:\s+edition)?\b", re.I)),
    ("Vintage",     re.compile(r"\bvintage\b", re.I)),
]

def designation_for_name(name: str | None) -> str | None:
    n = name or ""
    for label, rx in DESIGNATION_PATTERNS:
        if rx.search(n):
            return label
    return None
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_designation_parity.py -v`
Expected: PASS.

> If any case disagrees with the TS test in Task 1, FIX BOTH tables, not just one. Watching for: `\bVS\b` could match "VS" inside other tokens — both engines use the same boundary so they should agree; verify on the canary in Task 7.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill_designation.py tests/test_designation_parity.py
git commit -m "feat(data): designation regex resolver (Python) + TS↔Py parity test"
```

---

## Task 7: Backfill execution (Rule 10 gated) + export plumbing

**Files:**
- Modify: `scripts/backfill_designation.py` (add DB write + canary + CLI)
- Modify: `scripts/refresh_live_export.py` (EXPORT_COLS ~line 51)

> ⚠️ This task WRITES to the canonical DB and the UI-facing export. Follow the Rule-10 checklist exactly. Re-query `PRAGMA table_info` before trusting any prior ALTER (shared-DB hazard).

- [ ] **Step 1: Add `"designation"` to `EXPORT_COLS` in `refresh_live_export.py`**

Without this, the refresh SILENTLY drops the column and the UI never sees it (the $56 Phase-5 failure mode). Add it near `wine_classification`:
```python
    "id", "sku", "name", "brand", "classification", "wine_classification", "designation",
```

- [ ] **Step 2: Add the DB-write body to `backfill_designation.py`**

```python
def ensure_column(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    if "designation" not in cols:
        conn.execute("ALTER TABLE products ADD COLUMN designation TEXT")
        conn.commit()

def backfill(db: Path, limit_skus: list[str] | None = None) -> int:
    conn = sqlite3.connect(db)
    try:
        ensure_column(conn)  # re-query PRAGMA each run — shared-DB hazard, idempotent
        q = "SELECT sku, name FROM products"
        if limit_skus:
            q += " WHERE sku IN (%s)" % ",".join("?" * len(limit_skus))
        rows = conn.execute(q, limit_skus or []).fetchall()
        n = 0
        for sku, name in rows:
            d = designation_for_name(name)
            if d:
                conn.execute("UPDATE products SET designation=? WHERE sku=?", (d, sku))
                n += 1
            else:
                conn.execute("UPDATE products SET designation=NULL WHERE sku=?", (sku,))
        conn.commit()
        return n
    finally:
        conn.close()

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--canary", nargs="*", help="SKUs for a canary run")
    ap.add_argument("--verify", action="store_true", help="print populated count and exit")
    args = ap.parse_args()
    if args.verify:
        conn = sqlite3.connect(args.db)
        n = conn.execute("SELECT count(*) FROM products WHERE designation IS NOT NULL AND designation != ''").fetchone()[0]
        print(f"designation populated: {n}")
        return 0
    n = backfill(args.db, args.canary)
    print(f"designation set on {n} row(s)" + (f" (canary: {args.canary})" if args.canary else ""))
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Backup the DB (Rule 10.1)**

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
cp data/db/products.db data/db/products.db.bak-pre-designation
```
Expected: backup file exists (`ls -la data/db/products.db.bak-pre-designation`).

- [ ] **Step 4: Canary on 5 SKUs (Rule 10.2-3)**

Pick 5 SKUs whose names contain known designations (find them first):
```bash
.venv/bin/python - <<'PY'
import sqlite3
c = sqlite3.connect("data/db/products.db")
for sku, name in c.execute("SELECT sku,name FROM products WHERE name LIKE '%Grand Cru%' OR name LIKE '%DOCG%' OR name LIKE '%VSOP%' LIMIT 5"):
    print(sku, "|", name)
PY
```
Then run the canary and inspect:
```bash
.venv/bin/python scripts/backfill_designation.py --canary SKU1 SKU2 SKU3 SKU4 SKU5
.venv/bin/python - <<'PY'
import sqlite3
c = sqlite3.connect("data/db/products.db")
for r in c.execute("SELECT sku,name,designation FROM products WHERE designation IS NOT NULL LIMIT 10"):
    print(r)
PY
```
Expected: the 5 canary SKUs now show the correct designation; values match what the TS resolver would produce. STOP and fix if any are wrong.

- [ ] **Step 5: Full run + refresh export (Rule 10.6) + VERIFY (Rule 1/4/9)**

```bash
.venv/bin/python scripts/backfill_designation.py            # full DB write ($0 API)
.venv/bin/python scripts/backfill_designation.py --verify   # DB count
.venv/bin/python scripts/refresh_live_export.py             # RULE 9 — propagate to UI JSON
# Verify the field actually landed in the UI-facing export:
.venv/bin/python - <<'PY'
import json
data = json.load(open("data/live_products_export.json"))
pop = sum(1 for p in data if (p.get("designation") or "").strip())
print(f"export rows with designation: {pop} / {len(data)}")
from collections import Counter
print(Counter((p.get("designation") or "").strip() for p in data if (p.get("designation") or "").strip()).most_common())
PY
```
Expected: DB count == export count, ~2,700–2,800 rows, distribution roughly matching the planning audit (DOC ~460, Brut ~430, etc.). **This is the Rule-1 verification — the work is NOT done until this prints a populated count from the export, not the DB or logs.**

- [ ] **Step 6: Commit (data export + scripts; do NOT commit the .bak)**

```bash
git status   # confirm scope: scripts + data/live_products_export.json only; .bak is gitignored or excluded
git add scripts/backfill_designation.py scripts/refresh_live_export.py data/live_products_export.json
git commit -m "feat(data): backfill designation column + export it; ~2.8k rows populated (\$0 API)"
```

---

## Task 8: DB invariant test (RULE 6)

**Files:**
- Modify: `tests/test_enrichment_db_invariants.py`

- [ ] **Step 1: Add the invariant test**

```python
def test_name_detected_designation_is_populated_in_export():
    """If a product name contains a designation token, the export field is populated.
    Guards the $56 Phase-5 failure: paid/derived data must reach the UI-facing export."""
    import json, importlib.util, pathlib
    root = pathlib.Path(__file__).resolve().parent.parent
    spec = importlib.util.spec_from_file_location("bd", root / "scripts" / "backfill_designation.py")
    bd = importlib.util.module_from_spec(spec); spec.loader.exec_module(bd)
    data = json.load(open(root / "data" / "live_products_export.json"))
    missing = [p["sku"] for p in data
               if bd.designation_for_name(p.get("name")) and not (p.get("designation") or "").strip()]
    assert not missing, f"{len(missing)} products have a name-designation but empty export field: {missing[:10]}"
```

- [ ] **Step 2: Run it**

Run: `.venv/bin/python -m pytest tests/test_enrichment_db_invariants.py -k designation -v`
Expected: PASS (because Task 7 ran the backfill + refresh). If FAIL, the export wasn't refreshed — re-run Task 7 Step 5.

- [ ] **Step 3: Commit**

```bash
git add tests/test_enrichment_db_invariants.py
git commit -m "test(data): invariant — name-detected designation must populate the export field"
```

---

## Task 9: Browser verification (RULE 7) — the only proof a UI change works

- [ ] **Step 1: Start the catalog dev server on :3100**

```bash
cd apps/catalog && npm run dev   # serves :3100; rm -rf .next first if a 500 "Cannot find module" appears
```

- [ ] **Step 2: Walk the user journey**

Open `http://localhost:3100/shop`. Verify, end-to-end:
1. A **"Classification"** accordion appears directly below **Origin**.
2. It shows chips: Grand Cru, DOCG, DOC, IGT, Reserva, Brut, Single Malt, XO, etc., each with a count badge.
3. Click **"Grand Cru"** → the grid filters to Grand Cru products; the URL gains `?designation=Grand+Cru`; the chip count badge == the grid result count.
4. Click it again → clears (grid restored, param removed).
5. Combine with another filter (e.g. Country=France) → counts update sensibly; no crash.
6. The chip ordering reads most-specific-first (DOCG before DOC).

- [ ] **Step 3: Record evidence**

Capture the result count for a known designation and confirm it equals the facet badge. Note anything off (sparse rail under non-wine groups is EXPECTED — designations skew to wine).

- [ ] **Step 4: Final full-suite gate (build, not just tests — memory)**

```bash
cd apps/catalog && npm run build && npx vitest run
.venv/bin/python -m pytest tests/test_designation_parity.py tests/test_enrichment_db_invariants.py -v
```
Expected: green build + all tests pass.

---

## Done criteria (verify, don't infer)

- [ ] `designation` populated in `data/live_products_export.json` (count printed, ~2.8k) — NOT just in the DB.
- [ ] Classification chip renders below Origin and filters the grid in the browser at :3100.
- [ ] Facet count == grid total for a selected designation.
- [ ] TS↔Python parity test green; DB invariant test green; catalog build green.
- [ ] Commits are scoped to this feature only (no bundled unrelated files — memory `feedback_catalog_worktree_isolation`).
- [ ] Update memory: note canonical DB path `data/db/products.db` + EXPORT_COLS allowlist gotcha if not already captured.
