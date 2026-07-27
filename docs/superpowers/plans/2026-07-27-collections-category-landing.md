# Collections Category-Split Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Collections feature so `/collections` is a category-split editorial landing (Wine / Whisky / Sake & Asian / Spirits sections), add per-category landing pages, expand the curated seed set from 6 wine-only collections to ~18-20 spanning every major in-stock category, and add a "Collections" link to the site nav.

**Architecture:** Collections remain SAVED SHOP-FILTER PARAMS resolved through the shipped, pure `applyShopQuery(getAllProducts(), params)` engine — NO new filtering logic. The only data-model change: each collection gains a `group` (one of the 10 canonical `CATEGORY_GROUPS`) and a `sort_order`, added via an idempotent ALTER migration and carried through the same `taxonomy.db → export_collections.py → data/collections_export.json → lib/collections.ts` pipeline (Rule 9: catalog reads the JSON, never sqlite at runtime). The index groups collections by `group`; new category pages live at `/collections/category/[group]`. Existing `/collections/[slug]` listing is UNCHANGED except it already works.

**Tech Stack:** Python 3.9.6 (venv, needs `from __future__ import annotations`), sqlite3, Next.js 14 App Router (force-dynamic collection pages), React server components, Tailwind, Playfair Display + Inter (existing catalog type system), Lucide icons, pytest + vitest, Playwright (npx) for browser verification.

---

## HARD CONSTRAINTS (violating any of these is a defect, not a style nit)

1. **§7 grape/variety BLOCKED.** No seed filter may contain `grape` or `variety`. `products.variety` is free-text with no clean join. The export allowlist + the TS allowlist both enforce this; keep them enforcing it.
2. **The category key is `class`, NOT `category`.** `matchesFilters` (shop-query.ts) reads `params.class` → `typeForProduct(p)` (category_type string like "Red Wine", "Whisky", "Gin"). There is NO `category` branch. A seed using `category` silently collapses to its other keys.
3. **Every collection MUST resolve to >0 in-stock products through the REAL engine.** Not the raw export fields — the actual `applyShopQuery`. Task 8 verifies this; a 0-result collection is a bug (the §7-adjacent "silent empty" failure mode).
4. **`group` MUST be one of `CATEGORY_GROUPS`** (`apps/catalog/lib/category-constants.ts`): Wine, Whisky, Spirits, Sake & Asian, Liqueur, Beer & RTD, Non-Alcoholic, Cigars, Events, Accessories. The index only renders sections for groups that actually have collections.
5. **Rule 9:** after any change to `data/collections_export.json`, the catalog reads the committed JSON. The Python pipeline writes it; commit the regenerated file.
6. **Rule 7:** UI changes are not done until browser-verified at 375px + desktop.
7. **`schema.migrate`/`pairing_schema.migrate` semantics:** `pairing_schema.migrate` CREATEs the base `collections` table `IF NOT EXISTS`. The NEW `group`/`sort_order` columns must be added via an **ALTER-only, idempotent** migration (probe `PRAGMA table_info` first) so it is safe on the live DB that already has the table. Unit-test fixtures that start from `:memory:` call `pairing_schema.migrate` THEN the new alter migration.
8. **Git hygiene (Rule 9):** the worktree has NO node_modules — the catalog build/dev needs symlinks from the main checkout. Before EVERY commit, run `git status` and confirm it shows NO `node_modules` symlink, NO `.next/`, NO `.bak` DB, and NO scratchpad temp scripts. The ONLY data artifact ever committed is `data/collections_export.json`.

---

## Curated collection set (validated in-stock counts, 2026-07-27)

Counts below are raw-field probes; Task 8 re-verifies through the real engine. All use `class`/`country`/`region` only.

**Existing (6, keep — assign groups):**
| slug | group | filter |
|---|---|---|
| bordeaux-reds | Wine | country=France, region=Bordeaux, class=Red Wine |
| barolo-barbaresco | Wine | country=Italy, region=Piedmont, class=Red Wine |
| champagne | Wine | country=France, region=Champagne |
| high-acid-whites | Wine | class=White Wine, acidity=High |
| full-bodied-reds | Wine | class=Red Wine, body=Full |
| tuscan-reds | Wine | country=Italy, region=Tuscany, class=Red Wine |

**New Wine (2):**
| slug | group | filter | ~count |
|---|---|---|---|
| rose-wine | Wine | class=Rosé Wine | 110 |
| sparkling-champagne | Wine | class=Sparkling & Champagne | 448 |

**New Whisky (4):**
| slug | group | filter | ~count |
|---|---|---|---|
| islay-single-malts | Whisky | class=Whisky, region=Islay | 28 |
| japanese-whisky | Whisky | class=Whisky, country=Japan | 58 |
| speyside-whisky | Whisky | class=Whisky, region=Speyside | 86 |
| american-whiskey | Whisky | class=Whisky, country=United States | 54 |

**New Sake & Asian (2):**
| slug | group | filter | ~count |
|---|---|---|---|
| sake-shochu | Sake & Asian | class=Sake / Shochu | 353 |
| umeshu | Sake & Asian | class=Umeshu | 60 |

**New Spirits (4):**
| slug | group | filter | ~count |
|---|---|---|---|
| craft-gin | Spirits | class=Gin | 182 |
| aged-rum | Spirits | class=Rum | 123 |
| tequila | Spirits | class=Tequila | 115 |
| cognac-brandy | Spirits | class=Brandy | 70 |

Total: 6 + 12 = **18 collections across 4 groups.** (`american-whiskey` country string, `islay`/`speyside` region strings, and `Rosé Wine`/`Sake / Shochu` class strings MUST be validated through the real engine in Task 8; if any resolves to 0, fix the string to what `typeForProduct`/region-normalization actually emits, or drop that seed and note it.)

---

## File Structure

- `scripts/wine_knowledge/collections_seed.py` — MODIFY: extend `COLLECTIONS` with `group` per entry + 12 new entries; extend `_UPSERT` to write `category_group` + `sort_order`.
- `scripts/wine_knowledge/collections_schema.py` — CREATE: idempotent ALTER migration adding `category_group TEXT` + `sort_order INTEGER` to `collections`.
- `scripts/export_collections.py` — MODIFY: SELECT + emit `group` and `sort_order`; keep filter allowlist; sort output by (sort_order, slug).
- `scripts/ingest_collections.py` — CREATE: tiny runner (WNLQ9_TAXONOMY_DB override) → pairing_schema.migrate → collections_schema.migrate → seed → export. Mirrors ingest_italy.py.
- `tests/test_collections_export.py` — MODIFY: add group-presence, valid-group, and export-carries-group tests; keep all existing guards.
- `apps/catalog/lib/collections.ts` — MODIFY: add `group` + `sortOrder` to `CollectionDef`; add `getCollectionsByGroup()` + `getGroupsWithCollections()` helpers (grouped, ordered). Keep `ALLOWED_KEYS`, `collectionToShopParams`.
- `apps/catalog/lib/__tests__/collections.test.ts` — MODIFY: cover the new grouping helpers.
- `apps/catalog/app/collections/page.tsx` — REWRITE: category-split index (section per group, horizontal card row, "see all" → category page).
- `apps/catalog/app/collections/category/[group]/page.tsx` — CREATE: per-category landing (all collections in that group as cards; force-dynamic not needed — no searchParams — but keep a static-safe server component).
- `apps/catalog/app/collections/[slug]/page.tsx` — UNCHANGED (already correct). Only touch: breadcrumb MAY add the category hop (optional, Task 7).
- `apps/catalog/components/Header.tsx` — MODIFY: add `{ href: '/collections', label: 'Collections' }` to `NAV_LINKS`.
- `data/collections_export.json` — REGENERATED artifact (tracked); committed in Task 8.

---

### Task 1: Add group/sort_order schema migration (idempotent ALTER)

**Files:**
- Create: `scripts/wine_knowledge/collections_schema.py`
- Test: `tests/test_collections_schema.py`

- [ ] **Step 1: Write the failing test**

```python
from __future__ import annotations
import sqlite3
from scripts.wine_knowledge import pairing_schema, collections_schema


def _cols(conn):
    return {r[1] for r in conn.execute("PRAGMA table_info(collections)")}


def test_migrate_adds_group_and_sort_columns():
    c = sqlite3.connect(":memory:")
    pairing_schema.migrate(c)
    assert "category_group" not in _cols(c)  # base table lacks them
    collections_schema.migrate(c)
    cols = _cols(c)
    assert "category_group" in cols and "sort_order" in cols


def test_migrate_is_idempotent():
    c = sqlite3.connect(":memory:")
    pairing_schema.migrate(c)
    collections_schema.migrate(c)
    collections_schema.migrate(c)  # must not raise "duplicate column"
    assert "category_group" in _cols(c)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_collections_schema.py -v`
Expected: FAIL (`No module named 'scripts.wine_knowledge.collections_schema'`)

- [ ] **Step 3: Write minimal implementation**

```python
"""Idempotent ALTER migration: adds category_group + sort_order to the
`collections` table (created by pairing_schema.migrate). ALTER-only so it is
safe to run against the live taxonomy.db that already has the table + rows.
"""
from __future__ import annotations
import sqlite3


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def migrate(conn: sqlite3.Connection) -> None:
    if not _has_column(conn, "collections", "category_group"):
        conn.execute("ALTER TABLE collections ADD COLUMN category_group TEXT")
    if not _has_column(conn, "collections", "sort_order"):
        conn.execute("ALTER TABLE collections ADD COLUMN sort_order INTEGER")
    conn.commit()
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_collections_schema.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/collections_schema.py tests/test_collections_schema.py
git commit -m "feat: idempotent ALTER migration for collections group/sort_order"
```

---

### Task 2: Extend seeds with group + 12 new collections

**Files:**
- Modify: `scripts/wine_knowledge/collections_seed.py`
- Test: `tests/test_collections_export.py` (extended in Task 4; here just make the module load + seed)

- [ ] **Step 1: Write the failing test** (append to `tests/test_collections_export.py`)

```python
VALID_GROUPS = {"Wine","Whisky","Spirits","Sake & Asian","Liqueur",
                "Beer & RTD","Non-Alcoholic","Cigars","Events","Accessories"}


def test_every_seed_has_a_valid_group():
    from scripts.wine_knowledge import collections_seed
    assert len(collections_seed.COLLECTIONS) >= 18
    for c in collections_seed.COLLECTIONS:
        assert c.get("group") in VALID_GROUPS, f"{c['slug']} bad group {c.get('group')!r}"


def test_seed_writes_group_column(conn):
    from scripts.wine_knowledge import collections_schema, collections_seed
    collections_schema.migrate(conn)   # add the columns first
    collections_seed.seed(conn)
    rows = conn.execute("SELECT slug, category_group FROM collections").fetchall()
    assert all(g in VALID_GROUPS for _, g in rows)
```

Note: the `conn` fixture must be updated to also run `collections_schema.migrate` — see Task 4 Step 1 for the final fixture. Until Task 4, `test_seed_writes_group_column` calls `collections_schema.migrate(conn)` itself (shown above), so it works with the current fixture too.

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_collections_export.py::test_every_seed_has_a_valid_group -v`
Expected: FAIL (seeds lack `group`; only 6 entries)

- [ ] **Step 3: Write implementation** — add `"group"` to each existing entry (all `"Wine"`), append the 12 new entries from the curation table, and add `sort_order`. Rewrite `COLLECTIONS` so each dict is `{slug, name, description, group, filter, sort_order}`. `sort_order` groups by category then curates within: Wine 10-29, Whisky 30-39, Sake & Asian 40-49, Spirits 50-59 (leave gaps). **Assign the 6 EXISTING entries explicit `sort_order` values 10-15** (e.g. bordeaux-reds 10, barolo-barbaresco 11, tuscan-reds 12, full-bodied-reds 13, high-acid-whites 14, champagne 15) — do NOT let them default to 999, or the Task 3 `orders == sorted(orders)` assertion (which requires globally monotonic order) will fail. Update `_UPSERT` to:

```python
_UPSERT = (
    "INSERT INTO collections(slug, name, filter_definition, description, "
    "category_group, sort_order) VALUES(?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(slug) DO UPDATE SET "
    "name=excluded.name, filter_definition=excluded.filter_definition, "
    "description=excluded.description, category_group=excluded.category_group, "
    "sort_order=excluded.sort_order"
)
```

and `seed()`:

```python
def seed(conn: sqlite3.Connection) -> None:
    """Upsert every collection in COLLECTIONS. Idempotent (keyed on slug).
    Requires collections_schema.migrate() to have added category_group/sort_order."""
    for c in COLLECTIONS:
        conn.execute(_UPSERT, (
            c["slug"], c["name"], json.dumps(c["filter"]), c["description"],
            c["group"], c.get("sort_order", 999),
        ))
    conn.commit()
```

New entries (exact — copy verbatim; descriptions are filter labels, not tasting claims, so no citation needed):

```python
    # --- New Wine ---
    {"slug": "rose-wine", "name": "Rosé Wine", "group": "Wine", "sort_order": 20,
     "description": "Dry and fruit-forward rosé from around the world.",
     "filter": {"class": "Rosé Wine"}},
    {"slug": "sparkling-champagne", "name": "Sparkling & Champagne", "group": "Wine", "sort_order": 21,
     "description": "Champagne, prosecco, cava and sparkling wines.",
     "filter": {"class": "Sparkling & Champagne"}},
    # --- Whisky ---
    {"slug": "islay-single-malts", "name": "Islay Single Malts", "group": "Whisky", "sort_order": 30,
     "description": "Peaty, maritime single malts from Islay, Scotland.",
     "filter": {"class": "Whisky", "region": "Islay"}},
    {"slug": "japanese-whisky", "name": "Japanese Whisky", "group": "Whisky", "sort_order": 31,
     "description": "Refined single malts and blends from Japan.",
     "filter": {"class": "Whisky", "country": "Japan"}},
    {"slug": "speyside-whisky", "name": "Speyside Whisky", "group": "Whisky", "sort_order": 32,
     "description": "Elegant, fruit-driven malts from Speyside, Scotland.",
     "filter": {"class": "Whisky", "region": "Speyside"}},
    {"slug": "american-whiskey", "name": "American Whiskey", "group": "Whisky", "sort_order": 33,
     "description": "Bourbon and rye from the United States.",
     "filter": {"class": "Whisky", "country": "United States"}},
    # --- Sake & Asian ---
    {"slug": "sake-shochu", "name": "Sake & Shochu", "group": "Sake & Asian", "sort_order": 40,
     "description": "Premium Japanese sake and shochu.",
     "filter": {"class": "Sake / Shochu"}},
    {"slug": "umeshu", "name": "Umeshu", "group": "Sake & Asian", "sort_order": 41,
     "description": "Japanese plum liqueurs, sweet and aromatic.",
     "filter": {"class": "Umeshu"}},
    # --- Spirits ---
    {"slug": "craft-gin", "name": "Craft Gin", "group": "Spirits", "sort_order": 50,
     "description": "Botanical-led gins from craft distillers.",
     "filter": {"class": "Gin"}},
    {"slug": "aged-rum", "name": "Aged Rum", "group": "Spirits", "sort_order": 51,
     "description": "Sipping and mixing rums from across the tropics.",
     "filter": {"class": "Rum"}},
    {"slug": "tequila", "name": "Tequila", "group": "Spirits", "sort_order": 52,
     "description": "Blanco, reposado and añejo agave spirits.",
     "filter": {"class": "Tequila"}},
    {"slug": "cognac-brandy", "name": "Cognac & Brandy", "group": "Spirits", "sort_order": 53,
     "description": "Grape brandies for after dinner.",
     "filter": {"class": "Brandy"}},
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_collections_export.py::test_every_seed_has_a_valid_group tests/test_collections_export.py::test_seed_writes_group_column -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/collections_seed.py tests/test_collections_export.py
git commit -m "feat: add group to seeds + 12 category collections (whisky/sake/spirits/wine)"
```

---

### Task 3: Export group + sort_order

**Files:**
- Modify: `scripts/export_collections.py`
- Test: `tests/test_collections_export.py`

- [ ] **Step 1: Write the failing test** (append)

```python
def test_export_carries_group_and_sorts(conn):
    from scripts.wine_knowledge import collections_schema, collections_seed
    from scripts import export_collections
    collections_schema.migrate(conn)
    collections_seed.seed(conn)
    data = export_collections.build(conn)
    assert all("group" in c for c in data)
    assert {c["group"] for c in data} >= {"Wine", "Whisky", "Sake & Asian", "Spirits"}
    # sorted by (sort_order, slug): Wine collections (10-29) come before Spirits (50-59)
    orders = [c.get("sortOrder", 999) for c in data]
    assert orders == sorted(orders)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_collections_export.py::test_export_carries_group_and_sorts -v`
Expected: FAIL (`build` emits no `group`)

- [ ] **Step 3: Implementation** — update the SELECT and the emitted dict, and change the sort:

```python
    rows = conn.execute(
        "SELECT slug, name, description, filter_definition, category_group, sort_order "
        "FROM collections"
    ).fetchall()

    for slug, name, description, fdef, group, sort_order in rows:
        ...  # allowlist filtering unchanged
        out.append({
            "slug": slug,
            "name": name,
            "description": description or "",
            "group": group or "",
            "sortOrder": sort_order if sort_order is not None else 999,
            "filter": allowed,
        })

    out.sort(key=lambda c: (c["sortOrder"], c["slug"]))
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_collections_export.py -v`
Expected: PASS (all, including the pre-existing guards)

- [ ] **Step 5: Commit**

```bash
git add scripts/export_collections.py tests/test_collections_export.py
git commit -m "feat: export collection group + sortOrder, order output by sort_order"
```

---

### Task 4: Consolidate test fixture + full suite green

**Files:**
- Modify: `tests/test_collections_export.py` (fixture)

- [ ] **Step 1** — Update the `conn` fixture so every test gets the group columns, and remove the now-redundant inline `collections_schema.migrate` calls added in Tasks 2-3:

```python
@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    pairing_schema.migrate(c)          # base collections table
    from scripts.wine_knowledge import collections_schema
    collections_schema.migrate(c)      # + category_group / sort_order
    yield c
    c.close()
```

- [ ] **Step 2: Run the whole collections test suite**

Run: `.venv/bin/python -m pytest tests/test_collections_export.py tests/test_collections_schema.py -v`
Expected: PASS (all)

- [ ] **Step 3: Commit**

```bash
git add tests/test_collections_export.py
git commit -m "test: unify collections fixture on group-aware schema"
```

---

### Task 5: TS lib — CollectionDef.group + grouping helpers

**Files:**
- Modify: `apps/catalog/lib/collections.ts`
- Test: `apps/catalog/lib/__tests__/collections.test.ts`

- [ ] **Step 1: Write failing tests** (extend the existing test file; read it first for its fixture/mocking style). Add:

```ts
// CollectionDef now carries group + sortOrder; helpers bucket by group in order.
it('getGroupsWithCollections returns only groups that have collections, in sort order', () => {
  // uses the real data/collections_export.json via getCollections()
  const groups = getGroupsWithCollections();
  expect(groups.length).toBeGreaterThanOrEqual(4);
  const names = groups.map((g) => g.group);
  expect(names).toEqual(Array.from(new Set(names))); // no dupes
  expect(names).toContain('Wine');
  expect(names).toContain('Whisky');
  for (const g of groups) expect(g.collections.length).toBeGreaterThan(0);
});

it('getCollectionsByGroup filters to one group', () => {
  const whisky = getCollectionsByGroup('Whisky');
  expect(whisky.length).toBeGreaterThan(0);
  expect(whisky.every((c) => c.group === 'Whisky')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/collections.test.ts`
Expected: FAIL (helpers/`group` don't exist)

- [ ] **Step 3: Implementation** — add to `collections.ts`:

```ts
export interface CollectionDef {
  slug: string;
  name: string;
  description: string;
  group: string;        // one of CATEGORY_GROUPS; '' if unset
  sortOrder: number;
  filter: Record<string, string>;
}

/** All collections in a single group, already in export (sort) order. */
export function getCollectionsByGroup(group: string): CollectionDef[] {
  return getCollections().filter((c) => c.group === group);
}

/**
 * Collections bucketed by group, preserving the export order for both the group
 * sequence (first appearance) and the collections within each group.
 */
export function getGroupsWithCollections(): Array<{ group: string; collections: CollectionDef[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, CollectionDef[]>();
  for (const c of getCollections()) {
    const g = c.group || 'Other';
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
    byGroup.get(g)!.push(c);
  }
  return order.map((g) => ({ group: g, collections: byGroup.get(g)! }));
}
```

Also make the JSON parse tolerant of a missing `group`/`sortOrder` (older export): when reading, default `group` to `''` and `sortOrder` to `999` if absent (map over the parsed array in `getCollections()`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/collections.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/collections.ts apps/catalog/lib/__tests__/collections.test.ts
git commit -m "feat: CollectionDef.group + getGroupsWithCollections/getCollectionsByGroup"
```

---

### Task 6: Category-split index + category landing page

**Files:**
- Modify: `apps/catalog/app/collections/page.tsx` (rewrite as category-split)
- Create: `apps/catalog/app/collections/category/[group]/page.tsx`

**Design (matches shipped catalog editorial style — NOT Liquid Glass):**
- Reuse the existing card markup (rounded border, `bg-card`, hover:border-primary, ArrowRight, count line). Do not introduce glass/blur.
- Index: `<h1>Collections` + intro. Then one `<section>` per group from `getGroupsWithCollections()`, in order. Section header = group name (`text-2xl font-semibold`, Playfair via existing `font-serif`/heading class if the catalog uses one — check globals) + a "See all →" link to `/collections/category/<slug(group)>` shown only when the group has > 3 collections. Cards laid out in the SAME responsive grid the current index uses (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) — NOT a horizontal scroller (avoids `gesture-conflicts` / horizontal-scroll a11y issues; on mobile the grid just stacks). Each card links to `/collections/<slug>` and shows its live count from `applyShopQuery`.
- Group slug: lowercase, spaces/`&`→`-`, collapse dashes (e.g. `Sake & Asian` → `sake-asian`). Provide a tiny `groupToSlug`/`slugToGroup` pair (pure) co-located in the category page; the index links with `groupToSlug`.
- Category page `/collections/category/[group]`: resolve the group from the slug (404 via `notFound()` if it matches no group with collections). `<h1>` = group name, breadcrumb `Collections / <Group>`, then the SAME card grid for just that group's collections. Server component; may stay static (no searchParams). Counts via `applyShopQuery` like the index.

- [ ] **Step 1: Write index page** — rewrite `page.tsx`. Keep the existing `metadata`. Replace the flat grid with grouped sections. Compute counts once: `const products = getAllProducts();` then per collection `applyShopQuery(products, collectionToShopParams(col)).total`. Keep the `cards.length === 0` empty state. Extract a `CollectionCard` inline component reused by both pages.

- [ ] **Step 2: Write category page** — create `category/[group]/page.tsx` with `generateMetadata` (title `<Group> Collections — WNLQ9`, canonical `/collections/category/<slug>`), `notFound()` for unknown group, breadcrumb, and the card grid.

- [ ] **Step 3: Typecheck + build the catalog**

Run: `cd apps/catalog && npx tsc --noEmit && npm run build`
Expected: compiles; `/collections` and `/collections/category/[group]` appear in the route list. (If build needs node_modules and the worktree lacks them, symlink from the main checkout per project memory `feedback_catalog_worktree_isolation`, and REMOVE the symlinks before committing — never `git add` them.)

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/app/collections/page.tsx apps/catalog/app/collections/category
git commit -m "feat: category-split Collections index + per-category landing pages"
```

---

### Task 7: Nav link + (optional) breadcrumb category hop

**Files:**
- Modify: `apps/catalog/components/Header.tsx`
- Modify (optional): `apps/catalog/app/collections/[slug]/page.tsx` breadcrumb

- [ ] **Step 1** — add to `NAV_LINKS` (place after Explore by Map):

```ts
  { href: '/collections', label: 'Collections' },
```

This renders in both desktop nav and the mobile disclosure (both map over `NAV_LINKS`). No other change needed. NOTE: the explore-map pill from the original ask was NOT selected by the user — do NOT add it.

- [ ] **Step 2 (optional, low-risk)** — in `[slug]/page.tsx`, if `def.group` is set, insert a middle breadcrumb hop `Collections / <Group> / <Name>` linking the group to its category page. Skip if it complicates the existing breadcrumb; the slug page is otherwise unchanged.

- [ ] **Step 3: Typecheck**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/components/Header.tsx apps/catalog/app/collections/[slug]/page.tsx
git commit -m "feat: add Collections to site nav (+ category breadcrumb hop)"
```

---

### Task 8: Regenerate export + verify EVERY collection resolves via the REAL engine

**Files:**
- Create: `scripts/ingest_collections.py`
- Regenerate: `data/collections_export.json`

- [ ] **Step 1: Write the runner** `scripts/ingest_collections.py`:

```python
"""Load + export shop-filter collections into the live taxonomy.db.
WNLQ9_TAXONOMY_DB overrides the target DB (worktree → main checkout)."""
from __future__ import annotations
import os, sqlite3, subprocess, sys
from pathlib import Path
from scripts.wine_knowledge import pairing_schema, collections_schema, collections_seed

def main() -> None:
    db = os.environ.get("WNLQ9_TAXONOMY_DB") or str(
        Path(__file__).resolve().parent.parent / "data" / "taxonomy.db")
    conn = sqlite3.connect(db)
    try:
        pairing_schema.migrate(conn)
        collections_schema.migrate(conn)
        collections_seed.seed(conn)
    finally:
        conn.close()
    print(f"seeded collections into {db}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Back up the live taxonomy.db, then load** (Rule 10 — even though $0/in-session, back up before a write to the shared DB):

```bash
MAIN="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
cp "$MAIN/data/taxonomy.db" "$MAIN/data/taxonomy.db.bak-pre-collections-$(date +%Y%m%d-%H%M%S)"
WNLQ9_TAXONOMY_DB="$MAIN/data/taxonomy.db" .venv/bin/python -m scripts.ingest_collections
WNLQ9_TAXONOMY_DB="$MAIN/data/taxonomy.db" .venv/bin/python -m scripts.export_collections
# copy the regenerated export into the worktree tree so it's committed here:
cp "$MAIN/data/collections_export.json" data/collections_export.json
```

Expected: "seeded collections …", "wrote …/collections_export.json — 18 collections".

- [ ] **Step 3: VERIFY every collection resolves >0 through the REAL shop engine** (Rule 1/6 — the destination is the UI, resolved by `applyShopQuery`). ANY collection with total 0 is a FAIL — fix the offending filter string (the real `typeForProduct`/region normalization value) or drop the seed and note it. Re-run Steps 2-3 after any seed edit.

Concrete approach: add a TEMPORARY vitest (or a `tsx` script) under `apps/catalog` that imports the REAL TS engine (do NOT hand-port the filter logic in JS — that would test a copy, not the shipped engine):

```ts
import { getAllProducts } from '@/lib/catalog-data';
import { applyShopQuery } from '@/lib/shop-query';
import { getCollections, collectionToShopParams } from '@/lib/collections';
for (const c of getCollections()) {
  const total = applyShopQuery(getAllProducts(), collectionToShopParams(c)).total;
  console.log(total.toString().padStart(5), c.slug);
  if (total === 0) throw new Error(`ZERO: ${c.slug}`);
}
```

Run with `npx tsx` (or as a vitest). Expected: all 18 print total > 0. Delete the temp script after.

- [ ] **Step 4: Commit** the regenerated export + runner (NOT the .bak, NOT the temp verify script):

```bash
git add scripts/ingest_collections.py data/collections_export.json
git commit -m "feat: seed + export 18 category collections; verified all resolve via shop engine"
```

---

### Task 9: Browser verification (Rule 7) — 375px + desktop

**Files:** none (verification only; use Playwright via npx, dev server on :3100 per project memory `project_catalog_dev_port`).

- [ ] **Step 1** — start the catalog dev server (`cd apps/catalog && PORT=3100 npm run dev`; if worktree lacks node_modules, symlink from main checkout, clean up after). If `Cannot find module` 500s, `rm -rf .next`.

- [ ] **Step 2** — Playwright script (scratchpad), at 1280×900 AND 375×780, asserting:
  1. `/collections` renders section headers for Wine, Whisky, Sake & Asian, Spirits, each with ≥1 card and visible bottle counts; no console errors; no horizontal scroll.
  2. A "See all →" link (e.g. Whisky) navigates to `/collections/category/whisky` which lists that group's collections.
  3. Clicking a collection card (e.g. Japanese Whisky) opens `/collections/japanese-whisky` with > 5 product cards.
  4. The header nav shows a "Collections" link that navigates to `/collections` (desktop nav + mobile disclosure after opening the hamburger at 375px).
  Save screenshots; eyeball them (Rule 7 — screenshots, not just assertions).

- [ ] **Step 3** — record the result (counts + screenshot paths) in the finish summary. If anything fails to render, fix before proceeding. Remove any node_modules symlinks; confirm `git status` shows no symlink/.next noise.

---

### Task 10: Final review + finish

- [ ] **Step 1** — run the full changed test surface:

```bash
.venv/bin/python -m pytest tests/test_collections_export.py tests/test_collections_schema.py -v
cd apps/catalog && npx vitest run lib/__tests__/collections.test.ts && npx tsc --noEmit && npm run build
```

Expected: all green; build lists the new routes.

- [ ] **Step 2** — dispatch a final code-quality reviewer over the whole branch diff (spec compliance + the HARD CONSTRAINTS list above).

- [ ] **Step 3** — use **superpowers:finishing-a-development-branch**: verify tests → present the 4 options → on "Push + PR", push `worktree-collections-category-landing` and open a PR summarizing: category-split index, category landing pages, +12 collections, nav link, all-resolve verification, browser-verified.

---

## Notes for the implementer
- Read each file before editing (project rule). The two catalog pages reuse `ProductCard`, `applyShopQuery`, `getAllProducts`, `buildContactLinks`/`getContactEnv` exactly as `[slug]/page.tsx` already does.
- Do NOT spread `searchParams` into any filter — the index and category pages take NO filter searchParams; the `[slug]` page already restricts to sort+page.
- Keep the export/TS allowlists intact; the new `group`/`sortOrder` are metadata OUTSIDE `filter`, so they never reach `collectionToShopParams`.
- Descriptions are curation labels, not tasting/benchmark claims — no source_citation needed (the citation rule governs `taxonomy_contexts`/`benchmarks`, not collection copy).
- `data/collections_export.json` is the ONLY data artifact to commit; never commit `.bak` DBs or node_modules symlinks.
