# Wine Knowledge — Explore-Map Drawer UI (Plan 4 of series)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the taxonomy knowledge (deep region description, terroir/climate/grapes/classification attributes, key grape varieties, classification tiers) in the shipped explore-map `RegionDrawer` via progressive disclosure — a short blurb at a glance, an expandable "Learn more" panel with the deep detail — fully responsive (bottom-sheet on mobile, side-panel on desktop) and accessible.

**Architecture:** Three layers, one existing data pipeline. (1) A NEW export script reads the richer fields from `data/taxonomy.db` into `data/taxonomy_descriptions_export.json` (today that file is hand-maintained — we replace it with a generated one). (2) The existing prebuild generator `gen-explore-map-data.mjs` injects the new fields into `explore-map-data.json`. (3) `RegionDrawer.tsx` renders them behind a collapsible section. The map, handoff values, and margin-safety invariants are untouched.

**Tech Stack:** Next.js (catalog app), React client component, Tailwind, MapLibre (unchanged), Python (export script), Vitest (component + data tests). Design language: editorial/content-first, progressive disclosure, existing `bg-card`/`text-foreground` design tokens (do NOT introduce raw hex).

**Spec:** `docs/superpowers/specs/2026-07-25-wine-knowledge-ingestion-design.md` (§ Layer 2). **Prior:** Plans 1–2 loaded the data this plan surfaces (25 grapes, 6 classification tiers, deepened France region contexts + attributes + grown_in links).

---

## Critical pre-existing facts (verified 2026-07-26)

- **Data pipeline (3 hops):** `taxonomy.db` → `data/taxonomy_descriptions_export.json` (`{regions,subregions,countries}`, each entry `{short, full}`) → `apps/catalog/scripts/gen-explore-map-data.mjs` (prebuild) merges into `apps/catalog/data/explore-map-data.json` → `RegionDrawer.tsx` renders. The export JSON currently has NO generator script (hand-committed once, commit cf34080). This plan adds the generator.
- **`gen-explore-map-data.mjs` is plain Node .mjs** (runs before tsc, cannot import TS). It reads `data/taxonomy_descriptions_export.json` and only pulls `.full` into `region.description` today (line ~294). Margin-safety/anti-drift is enforced by `explore-map-gen.test.ts` + `explore-map.invariant.test.ts` — the peek allowlist (4 fields, never spread) MUST stay intact.
- **`MapRegion` type** (`apps/catalog/lib/explore/types.ts`) has `description?: string` and `subregions?: {name,description?}[]`. This plan adds an OPTIONAL `knowledge?` object (see Task 2) — optional so regions without taxonomy knowledge render exactly as today.
- **`RegionDrawer.tsx`** is already responsive + accessible: bottom-sheet (mobile) / side-panel `md:w-[24rem]` (desktop), Escape closes, `motion-safe` gated, 44px touch targets, focus rings, uses design tokens. Its test (`RegionDrawer.test.tsx`) asserts name / lens count / `/shop` CTA with region NAME / peek→product link — ALL must stay green.
- **Live `taxonomy.db` has (from Plans 1–2):** for a region entity — `taxonomy_contexts.description_short`/`description_en`/`attributes`(JSON: key_grapes/climate/soil/classification_system/…); `grown_in` links from `grape_variety` entities; `classified_under` links to `classification_tier` entities. Bordeaux example: 5 grapes, 1855 First Growth tier, climate+key_grapes attributes.
- **Dev server:** catalog runs on **port 3100** (per project memory, NOT 3212); `rm -rf .next` on "Cannot find module" 500s. Explore map at `/explore-map`.

---

## File Structure

- **Create** `scripts/export_taxonomy_knowledge.py` — reads `data/taxonomy.db`, writes `data/taxonomy_descriptions_export.json` with the EXISTING shape PLUS a new `knowledge` block per region (deep description, attributes, grapes, tiers). Idempotent, pure read of the DB. One responsibility: DB → export JSON.
- **Modify** `apps/catalog/scripts/gen-explore-map-data.mjs` — read the new `knowledge` block and attach `region.knowledge` (allowlisted fields only, mirroring the existing description merge at ~line 294). No change to peek/margin logic.
- **Modify** `apps/catalog/lib/explore/types.ts` — add the optional `RegionKnowledge` interface + `knowledge?` on `MapRegion`.
- **Modify** `apps/catalog/components/explore/RegionDrawer.tsx` — add a collapsible "Learn more" knowledge section (grapes chips, classification tiers, terroir/climate rows, deep description). Progressive disclosure; responsive; a11y.
- **Create** `apps/catalog/components/explore/__tests__/` additions / extend `RegionDrawer.test.tsx` — assert the knowledge section renders when present, is absent (no crash) when not, and the expand toggle works.
- **Create** `apps/catalog/scripts/__tests__/` or extend `explore-map-gen.test.ts` — assert `knowledge` is merged into a region when the export provides it, and the peek allowlist is unchanged.

Execution worktree: `.worktrees/wine-knowledge-pr` (branch `feat/wine-knowledge-foundation-clean`). Catalog tests: `cd apps/catalog && npm test`. Dev server: `cd apps/catalog && PORT=3100 npm run dev`.

---

## Task 1: Export script — taxonomy.db → enriched export JSON

**Files:**
- Create: `scripts/export_taxonomy_knowledge.py`
- Test: `tests/test_export_taxonomy_knowledge.py`

The script emits the SAME top-level shape the generator already reads (`{regions, subregions, countries}` keyed by lowercase name, each `{short, full}`) so nothing breaks, PLUS a `knowledge` key on each region entry:

```json
"bordeaux": {
  "short": "...", "full": "...",
  "knowledge": {
    "grapes": ["Cabernet Sauvignon", "Merlot", "Cabernet Franc", "Sauvignon Blanc", "Sémillon"],
    "tiers": ["Bordeaux 1855 First Growth"],
    "attributes": {"climate": "maritime …", "classification_system": "…", "key_grapes": [...]},
    "citation": "Wine Bible 2e, France/Bordeaux"
  }
}
```

- [ ] **Step 1: Write the failing test** `tests/test_export_taxonomy_knowledge.py`. Build a tiny fixture `taxonomy.db` (France + Bordeaux region with a validated wine context + attributes + 2 grapes via grown_in + 1 classification_tier via classified_under), run `export_taxonomy_knowledge.build(conn)`, assert the returned dict has `regions["bordeaux"]["knowledge"]["grapes"]` (sorted names), `["tiers"]`, `["attributes"]`, and that `short`/`full` still come through. Also assert a region with NO context is simply absent (not a crash).

```python
import sqlite3
import pytest
from scripts.wine_knowledge import schema, ingest
from scripts import export_taxonomy_knowledge as ex

_DDL = """ ...same taxonomy DDL used in tests/test_wine_knowledge_france.py... """


@pytest.fixture
def db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL); c.commit(); schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    bx = ingest.upsert_entity(c, "region", "Bordeaux", "bordeaux", parent_id=fr)
    ingest.upsert_context(c, bx, "wine", short="Benchmark red region.",
        full="Bordeaux is the reference point for fine wine …",
        status="validated", source_citation="Wine Bible 2e, France/Bordeaux",
        confidence="high", attributes='{"climate":"maritime","key_grapes":["merlot"]}')
    cab = ingest.upsert_entity(c, "grape_variety", "Cabernet Sauvignon", "cabernet-sauvignon")
    mer = ingest.upsert_entity(c, "grape_variety", "Merlot", "merlot")
    ingest.add_relationship(c, cab, bx, "grown_in")
    ingest.add_relationship(c, mer, bx, "grown_in")
    tier = ingest.upsert_entity(c, "classification_tier", "Bordeaux 1855 First Growth", "bordeaux-1855-first-growth")
    ingest.add_relationship(c, bx, tier, "classified_under")
    c.commit(); yield c; c.close()


def test_export_includes_short_and_full(db):
    out = ex.build(db)
    assert out["regions"]["bordeaux"]["short"] == "Benchmark red region."
    assert out["regions"]["bordeaux"]["full"].startswith("Bordeaux is the reference")


def test_export_includes_knowledge_grapes_sorted(db):
    out = ex.build(db)
    k = out["regions"]["bordeaux"]["knowledge"]
    assert k["grapes"] == ["Cabernet Sauvignon", "Merlot"]  # sorted display names


def test_export_includes_tiers_and_attributes(db):
    out = ex.build(db)
    k = out["regions"]["bordeaux"]["knowledge"]
    assert k["tiers"] == ["Bordeaux 1855 First Growth"]
    assert k["attributes"]["climate"] == "maritime"


def test_region_without_context_absent(db):
    # a region with no wine context does not appear / does not crash
    ingest.upsert_entity(db, "region", "Nowhere", "nowhere")
    out = ex.build(db)
    assert "nowhere" not in out["regions"]
```

- [ ] **Step 2: Run to verify fail.** `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/wine-knowledge-pr" && python3 -m pytest tests/test_export_taxonomy_knowledge.py -v` → FAIL (no module).

- [ ] **Step 3: Implement `scripts/export_taxonomy_knowledge.py`.** A `build(conn) -> dict` that: selects region/subregion/country entities with a wine context (`description_short`/`description_en`); for each region also gathers `grown_in` grape display-names (sorted), `classified_under` tier names, and parsed `attributes` JSON into a `knowledge` block. Only include the `knowledge` key when there is at least one of grapes/tiers/attributes. Preserve the existing `{short, full}` fields for subregions/countries. A `__main__` writes `data/taxonomy_descriptions_export.json` (pretty JSON), with `WNLQ9_TAXONOMY_DB` env override (mirror the other runners).

- [ ] **Step 4: Run to verify pass.** `python3 -m pytest tests/test_export_taxonomy_knowledge.py -v` → 4 passed.

- [ ] **Step 5: Commit.**
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/wine-knowledge-pr"
git add scripts/export_taxonomy_knowledge.py tests/test_export_taxonomy_knowledge.py
git commit -m "feat: export enriched taxonomy knowledge (grapes/tiers/attributes) to map export JSON"
```

---

## Task 2: MapRegion type + generator merge

**Files:**
- Modify: `apps/catalog/lib/explore/types.ts`
- Modify: `apps/catalog/scripts/gen-explore-map-data.mjs`
- Test: extend `apps/catalog/lib/__tests__/explore-map-gen.test.ts`

- [ ] **Step 1: Write the failing test** (extend `explore-map-gen.test.ts`). Feed the aggregate/merge path a region whose export entry has a `knowledge` block; assert the output region has `region.knowledge.grapes` etc. AND assert the peek objects still have EXACTLY the 4 allowlisted fields (margin-safety invariant unchanged). If the merge helper isn't separately exported, assert via the same seam the existing description test uses.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement.** In `types.ts` add:

```ts
export interface RegionKnowledge {
  grapes?: string[];
  tiers?: string[];
  attributes?: Record<string, string | string[]>;
  citation?: string;
}
```
and `knowledge?: RegionKnowledge;` on `MapRegion`. In `gen-explore-map-data.mjs`, where `region.description` is attached from the export (~line 294), also attach `r.knowledge` from the export entry's `knowledge` block IF present — copying only the allowlisted keys (`grapes`, `tiers`, `attributes`, `citation`), never spreading the whole object (same discipline as peeks).

- [ ] **Step 4: Run to verify pass.** `cd apps/catalog && npm test -- explore-map-gen` → pass; also run the invariant test `npm test -- explore-map.invariant` → pass (margin-safety intact).

- [ ] **Step 5: Commit.**
```bash
git add apps/catalog/lib/explore/types.ts apps/catalog/scripts/gen-explore-map-data.mjs apps/catalog/lib/__tests__/explore-map-gen.test.ts
git commit -m "feat: thread region knowledge (grapes/tiers/attributes) through map-data generator"
```

---

## Task 3: RegionDrawer — progressive-disclosure knowledge section

**Files:**
- Modify: `apps/catalog/components/explore/RegionDrawer.tsx`
- Test: extend `apps/catalog/components/__tests__/RegionDrawer.test.tsx`

Design (from ui-ux-pro-max design-system pass — editorial/content-first, progressive disclosure):
- The existing short `region.description` stays visible at a glance (unchanged).
- BELOW it, when `region.knowledge` exists, render:
  - **Grape chips** — a wrapped row of small pill chips (grape names), `text-xs`, `rounded-full`, `bg-muted`/`text-foreground`, each ≥ the 8px gap. Heading "Key grapes".
  - **Classification** — if `knowledge.tiers?.length`, a small labeled row listing tier names (e.g. "Classification: Bordeaux 1855 First Growth").
  - **Terroir rows** — from `knowledge.attributes`, show `climate`, `soil`, `classification_system` as compact label→value rows (only those present).
- A **collapsible "Learn more"** disclosure (a real `<button aria-expanded>` toggling a region) that reveals the deep `knowledge` detail (the terroir rows + any longer text). Collapsed by default so the glance view stays tight. Chevron rotates (transform, `motion-safe`, 200ms). Respect `prefers-reduced-motion`.
- Fully responsive: chips wrap; the section lives inside the existing scroll body so the sheet/panel height rules are unchanged. No horizontal scroll at 375px.
- A11y: the toggle is keyboard-operable with a visible focus ring (reuse existing `focus-visible:ring-primary/60`), `aria-expanded`/`aria-controls`, and the panel has an id. Chips are non-interactive text (no fake buttons). Contrast ≥4.5:1 using existing tokens.

- [ ] **Step 1: Write the failing tests** (extend `RegionDrawer.test.tsx`):

```ts
it('renders key grapes when knowledge present', () => {
  // render with region.knowledge = { grapes: ['Merlot','Cabernet Sauvignon'], tiers:['Bordeaux 1855 First Growth'], attributes:{climate:'maritime'} }
  expect(screen.getByText('Merlot')).toBeInTheDocument();
  expect(screen.getByText(/1855 First Growth/)).toBeInTheDocument();
});

it('Learn more toggle expands the deep detail', async () => {
  // render with knowledge incl. attributes.climate
  const toggle = screen.getByRole('button', { name: /learn more/i });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/maritime/i)).toBeInTheDocument();
});

it('renders normally with no knowledge (no crash, no toggle)', () => {
  // render region WITHOUT knowledge → the existing name/count/CTA still present, no "Learn more" button
  expect(screen.getByText('Bordeaux')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /learn more/i })).toBeNull();
});
```
Keep the existing 2 tests (name/count/CTA, peek link) intact.

- [ ] **Step 2: Run to verify fail.** `cd apps/catalog && npm test -- RegionDrawer` → new tests FAIL, old 2 still pass.

- [ ] **Step 3: Implement** the knowledge section in `RegionDrawer.tsx` using `useState` for the expand toggle, existing design tokens, and the responsive/a11y rules above. Do not touch the header, peeks, subregions, or footer CTA.

- [ ] **Step 4: Run to verify pass.** `cd apps/catalog && npm test -- RegionDrawer` → all pass (old 2 + new 3).

- [ ] **Step 5: Commit.**
```bash
git add apps/catalog/components/explore/RegionDrawer.tsx apps/catalog/components/__tests__/RegionDrawer.test.tsx
git commit -m "feat(explore): progressive-disclosure knowledge section in region drawer (grapes/tiers/terroir)"
```

---

## Task 4: Regenerate export + map-data, typecheck/build, browser-verify (Rule 7)

**Files:** regenerated data artifacts; no new source.

- [ ] **Step 1: Regenerate the export from the live DB, then the map-data.**
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
WNLQ9_TAXONOMY_DB="$(pwd)/data/taxonomy.db" .venv/bin/python scripts/export_taxonomy_knowledge.py  # writes data/taxonomy_descriptions_export.json
cd apps/catalog && node scripts/gen-explore-map-data.mjs   # writes data/explore-map-data.json
```

- [ ] **Step 2: Verify the data landed (direct inspection — Rule 1 analogue for UI data).**
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python3 -c "
import json
d=json.load(open('apps/catalog/data/explore-map-data.json'))
bx=[r for r in d['regions'] if r['name']=='Bordeaux'][0]
assert bx.get('knowledge'), 'Bordeaux missing knowledge'
k=bx['knowledge']; assert k['grapes'] and k['tiers'], k
print('Bordeaux knowledge in map-data:', {'grapes':k['grapes'],'tiers':k['tiers'],'attrs':list((k.get('attributes') or {}).keys())})
print('OK')
"
```
Expected: Bordeaux (and other France regions) carry a `knowledge` block with grapes + tiers.

- [ ] **Step 3: Typecheck + build the catalog (gate on build, not just tests).**
```bash
cd apps/catalog && npx tsc --noEmit && npm run build 2>&1 | tail -20
```
Expected: clean typecheck, successful build. (If "Cannot find module" 500s appear in dev later, `rm -rf .next`.)

- [ ] **Step 4: Browser verification (CLAUDE.md Rule 7 — MANDATORY for UI).** Start the dev server and walk the user journey. Use the `run` skill or Playwright/manual:
```bash
cd apps/catalog && PORT=3100 npm run dev &
# open http://localhost:3100/explore-map
```
Verify, at BOTH a mobile viewport (375px) and desktop (≥1024px):
  1. The map renders; clicking a France region (e.g. Bordeaux) opens the drawer.
  2. The short description shows at a glance; "Key grapes" chips render; classification tier shows.
  3. "Learn more" expands to reveal terroir/climate detail; chevron rotates; collapses again.
  4. No horizontal scroll at 375px; chips wrap; the sheet scrolls, map stays behind.
  5. Keyboard: Tab to the toggle, Enter/Space expands; focus ring visible; Escape closes the drawer.
  6. A region with NO knowledge (e.g. a non-France hotspot) still renders cleanly with no "Learn more".
Capture a screenshot of the expanded Bordeaux drawer (mobile + desktop) as evidence.

- [ ] **Step 5: Commit the regenerated artifacts + screenshots note.**
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/wine-knowledge-pr"
git add data/taxonomy_descriptions_export.json apps/catalog/data/explore-map-data.json
git commit -m "chore(explore): regenerate map-data with region knowledge; browser-verified drawer (Rule 7)"
```

---

## Done criteria for Plan 4

- `RegionDrawer` shows key grapes + classification tier + short description at a glance, with a working "Learn more" progressive-disclosure expansion for terroir/climate detail — for France regions that now have knowledge.
- Regions without knowledge render exactly as before (optional field; no crash, no empty toggle).
- Responsive verified at 375px and desktop; keyboard + focus + Escape work; no horizontal scroll; reduced-motion respected; contrast AA using design tokens (no raw hex).
- Peek/margin-safety invariants unchanged (`explore-map.invariant.test.ts` green); existing drawer tests green.
- Build + typecheck pass; **browser-verified with screenshots** (Rule 7).
- `explore-map-data.json` regenerated and carries `knowledge` for France regions.

**Not in this plan:** grape/style/classification_tier as their OWN clickable map nodes or dedicated pages (this plan surfaces them as region-attached content, matching the spec's "enrich existing drawer" decision); collections resolver (Plan 5); Italy/other countries' data (Plan 3). The drawer will show knowledge for whatever regions have it, so it lights up automatically as later country plans load more.
