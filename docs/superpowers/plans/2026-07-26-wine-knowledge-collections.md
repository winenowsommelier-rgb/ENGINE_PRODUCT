# Wine-Knowledge Collections (Layer 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the minimal Collections slice — a dynamic saved-filter product listing at `/collections/[slug]`, driven by the `collections` table in `taxonomy.db`, resolving each collection's `filter_definition` into a live products query at request time, with ~5–8 real seed collections a user can actually click.

**Architecture:** A collection is a **saved set of shop filter params**. We reuse the shipped shop filter engine (`applyShopQuery(getAllProducts(), params)`) — no new filtering logic. Definitions live in `taxonomy.db.collections`; a Python export (mirroring the Plan-4 knowledge export) emits a TRACKED `data/collections_export.json` that the catalog reads at request time (Rule 9: the catalog reads JSON exports, NOT sqlite directly). The `/collections/[slug]` page loads that JSON, maps `filter_definition` → `ShopParams`, runs `applyShopQuery`, and renders with the existing `ProductCard` grid + URL-reflected sort.

**Tech Stack:** Python 3.9.6 + sqlite3 (seed + export), Next.js 14 App Router + TypeScript (route), the shipped `applyShopQuery`/`matchesFilters` shop engine, pytest + vitest.

**Series context:** Plans 1/2/4 MERGED; Plan 3 (Italy) is a sibling plan. The `collections` table was created by Plan 1 (`scripts/wine_knowledge/pairing_schema.py`). This plan seeds + surfaces it.

---

## HARD scope boundaries (from spec §7 — do NOT cross)

1. **Clean-join fields ONLY.** `filter_definition` filters only on the keys `matchesFilters` (`apps/catalog/lib/shop-query.ts`) actually implements — VERIFIED against the source: `group`, `class` (this is the category_type key, e.g. "Red Wine"/"Whisky" — **there is NO `category` key**), `country`, `region`, `subregion`, `designation`, `flavor`, `body`, `acidity`, `tannin`, `price` (a single tier-id param, not min/max), `bev`, `inStock`, `hasScore`. Character dimensions are `body`/`acidity`/`tannin` (there is no `sweetness` branch). These are the SAME keys the `/shop` route accepts.
2. **`grape_variety` collections are BLOCKED.** `products.variety` is free-text/comma-joined; a taxonomy grape node has no reliable join. `matchesFilters` HAS a `grape` branch, but it matches free-text — using it would reintroduce exactly the join problem §7 blocks. A seed collection MUST NOT filter on `grape`/`variety`. (A "Barolo" collection filters on `region=Piedmont` + `class=Red Wine`, NOT `grape=nebbiolo`.)
3. **No `collection_pins`.** Manual add/exclude overrides are explicitly deferred. Do not build the pins table or any manual-membership logic.
4. **No recommender integration, no listing-page visual polish** beyond reusing the existing shop grid.

> **Design guard — every seed collection's `filter_definition` must be expressible as `/shop` query params.** Before seeding a collection, mentally construct the equivalent `/shop?...` URL. If you can't (because it needs a grape join), the collection is out of scope. This is the single most important correctness check in this plan.

---

## Ground truth (verified 2026-07-26)

- **`collections` table already exists** in `taxonomy.db` (Plan 1): columns `id, slug, name, filter_definition (JSON TEXT), description, created_at`. `slug` is `UNIQUE`.
- **Shop engine to reuse:** `apps/catalog/lib/shop-query.ts` — `applyShopQuery(products: PublicProduct[], params: ShopParams): ShopQueryResult`, `normalizeShopParams`, `matchesFilters`. `ShopParams = Record<string, string|string[]|undefined>`. Filter keys `matchesFilters` reads (VERIFIED via grep of `params.*`): `group`, `class`, `country`, `region`, `subregion`, `designation`, `grape`, `flavor`, `body`, `acidity`, `tannin`, `price`, `bev`, `inStock`, `hasScore`, plus `sort`/`page`. **`class` is the category_type key** (e.g. "Red Wine"). There is **no `category`, no `appellation`, no `sweetness`, no `price_min`/`price_max`** branch — do not use those keys.
- **Live export** (`data/live_products_export.json`) row fields include `category_type` (NOT `category`), `country`, `region`, `subregion`, `appellation`, `body`, `acidity`, `tannin`, `designation`. The `class` param is resolved via `typeForProduct(p)` → the product's `category_type`, so a collection's `class` VALUE must be a real `category_type` (e.g. "Red Wine", "White Wine").
- **Product loader:** `apps/catalog/lib/catalog-data.ts` — `getAllProducts(): PublicProduct[]` (reads `data/live_products_export.json`, process-cached, PRE-RANKED in Recommended order).
- **Reusable UI:** `apps/catalog/components/ProductCard.tsx`, `apps/catalog/components/DrillBreadcrumb.tsx`. The `/shop` page (`app/shop/page.tsx`) is the reference for grid + pagination + sort markup — copy its structure, do NOT re-invent.
- **Catalog reads JSON, not sqlite** — confirmed: `gen-explore-map-data.mjs` re-reads exports; no catalog code opens `taxonomy.db` at runtime. Collections follow the same rule.

---

## File Structure

- Create `scripts/wine_knowledge/collections_seed.py` — authored seed collections (list of dicts: slug/name/description/filter_definition) + a `seed(conn)` that upserts them into `collections`.
- Create `scripts/export_collections.py` — reads `collections` from `taxonomy.db`, validates each `filter_definition` against an allowlist of clean-join keys, emits TRACKED `data/collections_export.json`. Mirrors `scripts/export_taxonomy_knowledge.py`. Env `WNLQ9_TAXONOMY_DB` override.
- Create `data/collections_export.json` — TRACKED artifact (like `taxonomy_descriptions_export.json`).
- Create `apps/catalog/lib/collections.ts` — `getCollections(): CollectionDef[]`, `getCollectionBySlug(slug): CollectionDef | undefined`, and `collectionToShopParams(def): ShopParams`. Reads `data/collections_export.json`. Includes the KEY allowlist (defense-in-depth: even if a bad key sneaks into the JSON, the mapper drops it).
- Create `apps/catalog/app/collections/page.tsx` — index page listing all collections (cards linking to each slug).
- Create `apps/catalog/app/collections/[slug]/page.tsx` — the collection listing page (reuses `applyShopQuery` + `ProductCard` grid + URL sort).
- Test: `tests/test_collections_export.py` (Python), `apps/catalog/lib/__tests__/collections.test.ts` (vitest).

> **Why an export JSON and not read sqlite in the route?** Rule 9 + the existing architecture: the deployed catalog on Vercel builds from tracked files; `taxonomy.db` is git-ignored and not present in the catalog's build context reliably. The knowledge drawer already solved this with `taxonomy_descriptions_export.json`. Collections MUST use the same tracked-export pattern, or the route breaks in production.

---

### Task 1: Seed collections module (Python)

**Files:**
- Create: `scripts/wine_knowledge/collections_seed.py`
- Test: `tests/test_collections_export.py`

**Seed set (~6 collections — all expressible as `/shop` params, NO grape filters). The category_type key is `class`, NOT `category`:**

| slug | name | filter_definition (JSON) |
|---|---|---|
| `bordeaux-reds` | Bordeaux Reds | `{"country":"France","region":"Bordeaux","class":"Red Wine"}` |
| `barolo-barbaresco` | Barolo & Barbaresco | `{"country":"Italy","region":"Piedmont","class":"Red Wine"}` |
| `champagne` | Champagne | `{"country":"France","region":"Champagne"}` |
| `high-acid-whites` | High-Acid White Wines | `{"class":"White Wine","acidity":"High"}` |
| `full-bodied-reds` | Full-Bodied Reds | `{"class":"Red Wine","body":"Full"}` |
| `tuscan-reds` | Tuscan Reds | `{"country":"Italy","region":"Tuscany","class":"Red Wine"}` |

> **The key is `class` (NOT `category`) — this was a caught bug.** `matchesFilters` has no `category` branch; the category_type filter is keyed on `class` (matched via `norm(typeForProduct(p))`). Using `category` would silently collapse each collection to its remaining keys (e.g. `high-acid-whites` → `acidity:High` across ALL categories including whisky/sake — wrong contents, not zero). The category_type VALUES ("Red Wine"/"White Wine") ARE correct; only the key name changes.
>
> **Verify each filter_definition against the live export BEFORE seeding.** The executor MUST confirm the VALUES used (`class:"Red Wine"`, `body:"Full"`, `acidity:"High"`, region names) are what `matchesFilters` recognizes — run the `applyShopQuery` sanity check in Task 5. The taste scales (`app/shop/page.tsx`): BODY_SCALE=['Light','Medium','Medium-Full','Full'], ACIDITY_SCALE=['Low','Medium','Medium-High','High']; check `matchesFilters`' body/acidity branches for how the value is compared (exact vs threshold). A collection that resolves to <5 products because of a value mismatch is a silent failure (Rule 2) — fix the seed, don't ship it.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_collections_export.py
from __future__ import annotations
import json, sqlite3
import pytest
from scripts.wine_knowledge import pairing_schema, collections_seed


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    pairing_schema.migrate(c)   # creates the collections table
    yield c
    c.close()


def test_seed_inserts_collections_with_valid_json(conn):
    collections_seed.seed(conn)
    rows = conn.execute("SELECT slug, filter_definition FROM collections").fetchall()
    assert len(rows) >= 6
    for slug, fdef in rows:
        parsed = json.loads(fdef)          # must be valid JSON
        assert isinstance(parsed, dict) and parsed  # non-empty


def test_seed_is_idempotent(conn):
    collections_seed.seed(conn); collections_seed.seed(conn)
    n = conn.execute("SELECT COUNT(*) FROM collections WHERE slug='bordeaux-reds'").fetchone()[0]
    assert n == 1


# Only keys matchesFilters actually implements (verified against shop-query.ts).
# NOTE: category_type key is `class`, NOT `category`. No appellation/sweetness/price_min.
# `grape` is deliberately EXCLUDED (spec §7 blocks the grape join).
ALLOWED_KEYS = {"country","region","subregion","class","body","acidity","tannin","price"}

def test_no_grape_or_variety_filters(conn):
    """Spec §7: grape_variety collections are BLOCKED."""
    collections_seed.seed(conn)
    for (fdef,) in conn.execute("SELECT filter_definition FROM collections"):
        keys = set(json.loads(fdef).keys())
        assert "variety" not in keys and "grape" not in keys
        assert "category" not in keys, "use `class`, not `category` (matchesFilters key)"
        assert keys <= ALLOWED_KEYS, f"disallowed keys: {keys - ALLOWED_KEYS}"
```

- [ ] **Step 2: Run → FAIL** (`.venv/bin/python -m pytest tests/test_collections_export.py -v`) — no `collections_seed` module.
- [ ] **Step 3: Implement** `collections_seed.py` with a `COLLECTIONS` list (the table above as dicts) and `seed(conn)` that upserts each via `INSERT ... ON CONFLICT(slug) DO UPDATE SET name=..., filter_definition=..., description=...` (idempotent). `filter_definition` stored as `json.dumps(dict)`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(collections): seed collection definitions (clean-join filters only)`.

---

### Task 2: Export collections → tracked JSON (Python)

**Files:**
- Create: `scripts/export_collections.py`
- Test: `tests/test_collections_export.py`

- [ ] **Step 1: Write the failing test**

```python
def test_export_shape_and_allowlist(conn, tmp_path):
    from scripts import export_collections
    collections_seed.seed(conn)
    data = export_collections.build(conn)   # pure function, returns list[dict]
    assert isinstance(data, list) and len(data) >= 6
    for c in data:
        assert set(c) >= {"slug","name","description","filter"}
        assert isinstance(c["filter"], dict)
        # allowlist enforced at export time (defense in depth)
        assert set(c["filter"].keys()) <= ALLOWED_KEYS
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `export_collections.py`:
  - `ALLOWED_KEYS = {"country","region","subregion","class","body","acidity","tannin","price"}` (same set as the test — note `class` not `category`, and `grape` is excluded per §7).
  - `build(conn) -> list[dict]`: read all rows; for each, `json.loads(filter_definition)`, **drop any key not in `ALLOWED_KEYS`** (log a warning if dropped — Rule 2, don't silently swallow), emit `{"slug","name","description","filter"}`.
  - `main()`: `WNLQ9_TAXONOMY_DB` override → `build(conn)` → write `data/collections_export.json` (pretty, sorted by slug for stable diffs).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(collections): export collections to tracked JSON`.

---

### Task 3: Catalog collections lib (TypeScript)

**Files:**
- Create: `apps/catalog/lib/collections.ts`
- Test: `apps/catalog/lib/__tests__/collections.test.ts`

- [ ] **Step 1: Write the failing test (vitest)**

```ts
import { describe, it, expect } from 'vitest';
import { collectionToShopParams, type CollectionDef } from '../collections';

describe('collectionToShopParams', () => {
  it('passes through allowlisted keys as ShopParams (class, not category)', () => {
    const def: CollectionDef = { slug: 'x', name: 'X', description: '',
      filter: { country: 'Italy', region: 'Piedmont', class: 'Red Wine' } };
    expect(collectionToShopParams(def)).toEqual(
      { country: 'Italy', region: 'Piedmont', class: 'Red Wine' });
  });

  it('drops non-allowlisted keys: grape (spec §7 join block) AND category (wrong key)', () => {
    const def = { slug: 'x', name: 'X', description: '',
      filter: { region: 'Tuscany', grape: 'sangiovese', category: 'Red Wine', evil: '1' } } as unknown as CollectionDef;
    const params = collectionToShopParams(def);
    expect(params).toEqual({ region: 'Tuscany' });  // grape/category/evil all dropped
    expect('grape' in params).toBe(false);
    expect('category' in params).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`cd apps/catalog && npx vitest run lib/__tests__/collections.test.ts`).
- [ ] **Step 3: Implement** `apps/catalog/lib/collections.ts`:
  - `export interface CollectionDef { slug: string; name: string; description: string; filter: Record<string, string>; }`
  - `const ALLOWED_KEYS = new Set(['country','region','subregion','class','body','acidity','tannin','price'])` (same allowlist — `class` not `category`; NO `grape`).
  - `getCollections(): CollectionDef[]` — read `data/collections_export.json` (use the same dual-path resolution `catalog-data.ts` `exportPath()` uses: cwd=repo root OR cwd=apps/catalog). Process-cache it.
  - `getCollectionBySlug(slug)`.
  - `collectionToShopParams(def): ShopParams` — return only allowlisted keys (drops `category`, `grape`, `variety`, anything unknown).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(collections): catalog lib to load + map collection filters`.

---

### Task 4: `/collections/[slug]` route + index page

**Files:**
- Create: `apps/catalog/app/collections/page.tsx` (index)
- Create: `apps/catalog/app/collections/[slug]/page.tsx` (listing)

- [ ] **Step 1:** Implement `app/collections/[slug]/page.tsx`:
  - **Rendering mode — decided (do NOT re-derive):** use `export const dynamic = 'force-dynamic'`, exactly as `app/shop/page.tsx` line 9 does. The shop chose this because Next 14's router cache serves stale SSR snapshots when filtering is driven by `searchParams`; collections drive `sort`/`page` the same way, so the same staleness applies. **Do NOT add `generateStaticParams()`** — it's redundant and inconsistent with `force-dynamic`. Slug validity is enforced at request time via `getCollectionBySlug` → `notFound()`.
  - In the page: `getCollectionBySlug(params.slug)` → 404 via `notFound()` if missing. Merge `collectionToShopParams(def)` with the incoming `searchParams` for `sort`/`page` ONLY (collection filter is FIXED; user only controls sort + pagination — do NOT let a searchParam override a collection's filter keys). Run `applyShopQuery(getAllProducts(), mergedParams)`. Render the `ProductCard` grid + pagination + sort control — **copy the markup from `app/shop/page.tsx`** (DrillBreadcrumb, grid, pager). URL reflects sort/page (`?sort=price-asc&page=2`).
  - `generateMetadata()` — title = collection name, canonical `https://wnlq9.shop/collections/[slug]`, `robots noindex` when `total < 5` (match the shop thin-page rule).
- [ ] **Step 2:** Implement `app/collections/page.tsx` — grid of collection cards (name + description + count via `applyShopQuery(...).total`) linking to each slug.
- [ ] **Step 3:** Typecheck + build the catalog: `cd apps/catalog && npm run build` (or `npx tsc --noEmit`). Expected: compiles, both routes appear in the build output.
- [ ] **Step 4: Commit** `feat(collections): /collections index + [slug] listing pages`.

---

### Task 5: Seed live DB, export, and VERIFY end-to-end (Rule 1 + Rule 7)

**Files:** data operation + browser verification. No new code.

> **Shared-DB safety:** target the canonical git-ignored `data/taxonomy.db` in the MAIN checkout via `WNLQ9_TAXONOMY_DB`. Back up first. NEVER touch products.db.

- [ ] **Step 1: Sanity-check each seed resolves to > 0 products** (catches value-mismatch silent failures — Rule 2). Write a throwaway node/ts snippet or extend a test that loads `getAllProducts()`, applies each collection's params via `applyShopQuery`, and prints `slug → total`. **Every collection must return ≥ 5 products** or fix its `filter_definition` (wrong region/category/scale value). Show the counts.

- [ ] **Step 2: Seed + export against the live DB**

```bash
MAIN=/Users/admin/WNLQ9\ PIE/ENGINE_PRODUCT
cp "$MAIN/data/taxonomy.db" "$MAIN/data/taxonomy.db.bak-pre-collections-$(date +%Y%m%d-%H%M%S)"
WNLQ9_TAXONOMY_DB="$MAIN/data/taxonomy.db" .venv/bin/python -c "import sqlite3, os; from scripts.wine_knowledge import collections_seed; c=sqlite3.connect(os.environ['WNLQ9_TAXONOMY_DB']); collections_seed.seed(c); c.close()"
WNLQ9_TAXONOMY_DB="$MAIN/data/taxonomy.db" .venv/bin/python scripts/export_collections.py
```

- [ ] **Step 3: VERIFY the tracked export (Rule 1 — query the destination, not the log)**

```bash
python -c "import json; d=json.load(open('$MAIN/data/collections_export.json')); print(len(d), 'collections'); [print(c['slug'], list(c['filter'].keys())) for c in d]"
```
Expected: ≥ 6 collections, each with only allowlisted filter keys (NO `variety`).

- [ ] **Step 4: Browser-verify (Rule 7)** — start the catalog dev server on :3100:
  - Open `/collections` → all collection cards render with non-zero counts.
  - Click one (e.g. `/collections/tuscan-reds`) → the product grid shows real Tuscan reds, pagination works, changing sort updates the URL and re-orders.
  - Verify at **375px AND desktop**, 0 console errors, no horizontal scroll.
  - Screenshot both pages. (Playwright via `npx` in scratchpad, per the Plan-4 pattern.)

> **Rule 7 is the proof.** "Route compiles" is necessary but not sufficient. A screenshot of `/collections/tuscan-reds` with real bottles is the deliverable. If any collection shows 0 products in the browser, STOP and fix the filter_definition — do not ship an empty collection.

- [ ] **Step 5: Commit** the tracked export + any seed fixes:

```bash
git add data/collections_export.json scripts/wine_knowledge/collections_seed.py
git commit -m "feat(collections): seed live collections + verified export"
```

---

## Definition of Done (Plan 5)

- [ ] `collections` table seeded with ~6 collections in the live `data/taxonomy.db`; NONE filter on grape/variety (spec §7 boundary held).
- [ ] Tracked `data/collections_export.json` emitted, allowlist-enforced.
- [ ] `/collections` index + `/collections/[slug]` listing routes reuse `applyShopQuery` (no new filter logic) and render the existing ProductCard grid with URL-reflected sort.
- [ ] Every seed collection resolves to ≥ 5 real products (verified by count query — Rule 1/2).
- [ ] Browser-verified at 375px + desktop; screenshots of `/collections` and one `[slug]` page (Rule 7).
- [ ] Catalog `npm run build` green.
- [ ] No `collection_pins`, no recommender wiring, no grape-filter collections (deferred scope respected).
