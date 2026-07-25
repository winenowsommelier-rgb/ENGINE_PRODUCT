# Wine Knowledge Ingestion — France Chapter (Plan 2 of series)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen France's region/subregion/appellation contexts from *The Wine Bible* and add the missing structured knowledge — `classification_tier` entities (1855 Growths, Burgundy Grand/Premier Cru), `grown_in` grape→region relationships, and narrative-derived benchmarks — using the Plan 1 ingest library, verified against the live `data/taxonomy.db`.

**Architecture:** Reuses the Plan 1 `scripts/wine_knowledge/` library verbatim (`ingest.upsert_entity/upsert_context/upsert_benchmark/add_relationship`). One loader script per France sub-chapter (Bordeaux, Burgundy, Champagne, Rhône) so a mid-run failure loses at most one sub-chapter. All extraction is IN-SESSION by reading the book markdown — no paid API. Every context/benchmark carries a real `source_citation`; the citation and relationship-vocabulary invariants from Plan 1 must stay green on the live DB.

**Tech Stack:** Python 3.9, sqlite3, pytest. No new dependencies. Builds on Plan 1 (PR #85).

**Spec:** `docs/superpowers/specs/2026-07-25-wine-knowledge-ingestion-design.md`
**Prior plan:** `docs/superpowers/plans/2026-07-25-wine-knowledge-ingestion-foundation.md`

**Source:** `/Users/admin/Downloads/WNLQ9-sync/winebible.md`, FRANCE chapter (line 6985+). Sub-chapters: Bordeaux 7228, Champagne 8598, Burgundy 9658, Beaujolais 10974, Rhône 11281. The 1855 Classification detail is at 7530–7654 (+ appendix at line 350).

---

## Critical pre-existing DB facts (verified 2026-07-25)

The loaders MUST work WITH the existing skeleton, not duplicate it:

- **France (country) already exists** (id=4). Regions already exist and are LINKED to it: Bordeaux(58), Burgundy(77), Champagne(52), Rhône(64), Loire(53), Alsace(54), Provence(57), Languedoc(63), Sauternes(914), Cognac(912), Armagnac(913).
- **Subregions already exist and are parent-linked**, e.g. under Bordeaux(58): Médoc(142), Pauillac(167), Margaux(169), Saint-Julien(174), Saint-Émilion(176), Pomerol(192), Graves(153), Pessac-Léognan(168), Saint-Estèphe(206), Fronsac(152), Right Bank(189). Under Burgundy(77): Côte de Nuits(172), Côte de Beaune(148), Gevrey-Chambertin(159), Chablis(180), Beaune(193), Pommard(194), Volnay(175), Beaujolais(188).
- **DUPLICATE region entities exist** — `Rhône`(64) AND `Rhône Valley`(102); `Loire`(53) AND `Loire valley`(114). Loaders MUST target the canonical lower-id one (Rhône=64, Loire=53) and NOT create a third. Do a name/slug lookup before any `upsert_entity` for a region; prefer the existing id.
- **Bordeaux(58) and Burgundy(77) already have `status='validated'` wine contexts** currently carrying the `legacy:pre-wine-knowledge` citation marker. Loaders will UPSERT (overwrite) these with book-sourced content + a real citation. `upsert_context` updates in place by (entity_id, scope_id) — this is expected and correct; it REPLACES the legacy marker with a real one.
- `style`=0 and `classification_tier`=0 today (both entity types are new, introduced by Plan 1's vocab but never populated). 25 `grape_variety` entities exist (Plan 1) — link to them by slug.

**Idempotency requirement:** every loader must be safely re-runnable (upsert by natural key; `add_relationship` is already INSERT-OR-IGNORE). The shared DB can revert between turns.

---

## File Structure

- **Create** `scripts/wine_knowledge/france/__init__.py` — package marker.
- **Create** `scripts/wine_knowledge/france/_helpers.py` — small shared helpers used by every sub-chapter loader: `find_region(conn, name)` (returns canonical existing region id by name, case-insensitive; raises if absent — we never blind-create a France region), `find_or_create_subregion(conn, name, parent_region_id)`, `link_grape(conn, grape_slug, region_id)` (looks up grape entity by slug, adds `grown_in`). One responsibility: safe lookups against the existing skeleton.
- **Create** `scripts/wine_knowledge/france/bordeaux.py` — Bordeaux loader: region+subregion contexts, the 1855 First Growth `classification_tier` entities, grape links, benchmarks. Data authored from book lines 7228–8598.
- **Create** `scripts/wine_knowledge/france/burgundy.py` — Burgundy loader: the Grand Cru / Premier Cru / Village / Regional `classification_tier` ladder (the recursive-nesting STRESS TEST), region+subregion contexts, grape links. Lines 9658–10974 (+ Beaujolais 10974–11281).
- **Create** `scripts/wine_knowledge/france/champagne.py` — Champagne loader: Grand Cru / Premier Cru village tier concept, context, grape links. Lines 8598–9658.
- **Create** `scripts/wine_knowledge/france/rhone.py` — Rhône loader (targets canonical Rhône=64): context, grape links, benchmarks. Lines 11281+.
- **Create** `scripts/ingest_france.py` — thin runner: `WNLQ9_TAXONOMY_DB` env override (mirror `apply_wine_knowledge_migration.py`), calls each sub-chapter's `load(conn)` in order, prints counts.
- **Create** `tests/test_wine_knowledge_france.py` — unit tests for `_helpers` (canonical-region lookup, duplicate avoidance, grape linking) against a fixture DB; plus a live-DB post-load invariant (France has ≥1 classification_tier, all France relationships use the vocabulary, no NULL citations).

Execution worktree: `.worktrees/wine-knowledge-pr` (branch `feat/wine-knowledge-foundation-clean`). Run tests as `python3 -m pytest`. Broader `tests/` suite has pre-existing unrelated failures — only wine_knowledge test files matter.

---

## Task 1: France helpers — canonical region lookup + grape linking

**Files:**
- Create: `scripts/wine_knowledge/france/__init__.py` (empty)
- Create: `scripts/wine_knowledge/france/_helpers.py`
- Test: `tests/test_wine_knowledge_france.py`

- [ ] **Step 1: Write the failing test.** Create `tests/test_wine_knowledge_france.py` with a local fixture DB that mirrors the real skeleton (a France country, a Bordeaux region linked to it, a duplicate "Rhône"/"Rhône Valley" pair, and one grape). Inline the DDL (do NOT import fixtures across modules).

```python
import sqlite3
import pytest
from scripts.wine_knowledge import schema, ingest
from scripts.wine_knowledge.france import _helpers

_DDL = """
  CREATE TABLE scopes (id TEXT PRIMARY KEY, label TEXT);
  INSERT INTO scopes VALUES ('wine','Wine');
  CREATE TABLE taxonomy_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
    name TEXT NOT NULL, slug TEXT NOT NULL, parent_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE(entity_type, slug));
  CREATE TABLE taxonomy_contexts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL,
    scope_id TEXT NOT NULL, description_short TEXT, description_en TEXT,
    attributes TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
    UNIQUE(entity_id, scope_id));
  CREATE TABLE taxonomy_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, context_id INTEGER NOT NULL,
    dimension_id TEXT NOT NULL, typical_value REAL NOT NULL,
    range_low REAL, range_high REAL, UNIQUE(context_id, dimension_id));
  CREATE TABLE character_dimensions (
    id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, dimension_key TEXT NOT NULL);
  INSERT INTO character_dimensions VALUES ('wine.body','wine','body');
  CREATE TABLE taxonomy_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_entity_id INTEGER NOT NULL,
    to_entity_id INTEGER NOT NULL, relationship TEXT NOT NULL,
    scope_id TEXT, metadata TEXT DEFAULT '{}',
    UNIQUE(from_entity_id, to_entity_id, relationship, scope_id));
"""


@pytest.fixture
def db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL)
    c.commit()
    schema.migrate(c)
    # skeleton: France + a region + a DUPLICATE region pair + a grape
    fr = ingest.upsert_entity(c, "country", "France", "france")
    ingest.upsert_entity(c, "region", "Bordeaux", "bordeaux", parent_id=fr)
    ingest.upsert_entity(c, "region", "Rhône", "rhone", parent_id=fr)          # canonical (lower id)
    ingest.upsert_entity(c, "region", "Rhône Valley", "rhone-valley", parent_id=fr)  # duplicate
    ingest.upsert_entity(c, "grape_variety", "Cabernet Sauvignon", "cabernet-sauvignon")
    c.commit()
    yield c
    c.close()


def test_find_region_returns_existing_canonical_id(db):
    rid = _helpers.find_region(db, "Bordeaux")
    got = db.execute("SELECT name FROM taxonomy_entities WHERE id=?", (rid,)).fetchone()[0]
    assert got == "Bordeaux"


def test_find_region_prefers_lowest_id_on_duplicates(db):
    # "Rhône" (lower id) is canonical over "Rhône Valley"
    rid = _helpers.find_region(db, "Rhône")
    dup = db.execute("SELECT id FROM taxonomy_entities WHERE name='Rhône Valley'").fetchone()[0]
    assert rid < dup


def test_find_region_raises_when_absent(db):
    with pytest.raises(ValueError, match="region not found"):
        _helpers.find_region(db, "Nonexistent")


def test_link_grape_adds_grown_in(db):
    rid = _helpers.find_region(db, "Bordeaux")
    _helpers.link_grape(db, "cabernet-sauvignon", rid)
    n = db.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'"
    ).fetchone()[0]
    assert n == 1


def test_link_grape_is_idempotent(db):
    rid = _helpers.find_region(db, "Bordeaux")
    _helpers.link_grape(db, "cabernet-sauvignon", rid)
    _helpers.link_grape(db, "cabernet-sauvignon", rid)
    n = db.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'"
    ).fetchone()[0]
    assert n == 1
```

- [ ] **Step 2: Run to verify fail.** `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/wine-knowledge-pr" && python3 -m pytest tests/test_wine_knowledge_france.py -v` → FAIL (`scripts.wine_knowledge.france` missing).

- [ ] **Step 3: Implement.** Create empty `scripts/wine_knowledge/france/__init__.py`, then `_helpers.py`:

```python
"""Shared lookups for France sub-chapter loaders. We link to the EXISTING
region/subregion skeleton (verified present) rather than blind-creating, and
resolve duplicate region entities to the canonical lowest-id one."""
from __future__ import annotations

import sqlite3
from typing import Optional

from scripts.wine_knowledge import ingest


def find_region(conn, name: str) -> int:
    """Canonical region id by name (case-insensitive). On duplicates (e.g.
    'Rhône' vs 'Rhône Valley') returns the LOWEST id — the canonical entity.
    Raises if no region matches (we never blind-create a France region)."""
    rows = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='region' "
        "AND LOWER(name)=LOWER(?) ORDER BY id", (name,)).fetchall()
    if not rows:
        raise ValueError(f"region not found: {name!r}")
    return rows[0][0]


def find_or_create_subregion(conn, name: str, parent_region_id: int,
                             slug: Optional[str] = None) -> int:
    """Existing subregion id by name under the given parent, else create it."""
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='subregion' "
        "AND LOWER(name)=LOWER(?)", (name,)).fetchone()
    if row:
        return row[0]
    slug = slug or name.lower().replace(" ", "-").replace("é", "e").replace("è", "e")
    return ingest.upsert_entity(conn, "subregion", name, slug,
                                parent_id=parent_region_id)


def link_grape(conn, grape_slug: str, region_or_appellation_id: int) -> None:
    """Add grown_in from the grape entity (by slug) to a region/appellation."""
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug=?", (grape_slug,)).fetchone()
    if not row:
        raise ValueError(f"grape not found: {grape_slug!r}")
    ingest.add_relationship(conn, row[0], region_or_appellation_id, "grown_in")
```

- [ ] **Step 4: Run to verify pass.** `python3 -m pytest tests/test_wine_knowledge_france.py -v` → 5 passed.

- [ ] **Step 5: Commit.**
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/wine-knowledge-pr"
git add scripts/wine_knowledge/france/__init__.py scripts/wine_knowledge/france/_helpers.py tests/test_wine_knowledge_france.py
git commit -m "feat: France ingest helpers (canonical region lookup, grape linking)"
```

---

## Task 2: Bordeaux loader — contexts, 1855 classification tiers, grapes, benchmarks

**Files:**
- Create: `scripts/wine_knowledge/france/bordeaux.py`
- Test: extend `tests/test_wine_knowledge_france.py`

This is a data-authoring task. Read book lines **7228–8598** in chunks and author from the text. Content to capture:
- **Bordeaux region context** (upsert onto existing region id via `find_region`): deep description_en (Left Bank Cabernet/gravel, Right Bank Merlot/clay-limestone, maritime climate, the château system, claret history), a tight description_short, attributes (key_grapes, climate, classification_system="1855 Classification + others"), status='validated', citation="Wine Bible 2e, France/Bordeaux".
- **Subregion contexts** for Médoc, Graves, Sauternes/Barsac, St.-Émilion, Pomerol (use `find_or_create_subregion`; several already exist).
- **`classification_tier` entities** for the 1855 hierarchy: at minimum "Bordeaux 1855 First Growth" (the 5 First Growths: Lafite, Latour, Margaux, Haut-Brion, Mouton-since-1973). Create as `entity_type='classification_tier'`, then `classified_under` from the governing region/subregion → the tier (direction: from=region/subregion, to=classification_tier, per spec §4.5). Author a context describing what the tier means.
- **Grape links**: `link_grape` for cabernet-sauvignon, merlot, cabernet-franc, petit-verdot, sauvignon-blanc, semillon → Bordeaux region (only grapes that exist as entities; Plan 1 loaded the majors).
- **Benchmarks** where the book gives clear sensory language (e.g. Médoc Cabernet = high tannin/body; Sauternes = high sweetness). Ranges, medium confidence, "(narrative-derived)".

- [ ] **Step 1: Write the failing test** (append to `tests/test_wine_knowledge_france.py`). The test loads bordeaux against a fixture that includes the real-shaped skeleton + the relevant grapes, then asserts structural outcomes (not exact prose):

```python
from scripts.wine_knowledge.france import bordeaux


@pytest.fixture
def bordeaux_db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL)
    c.commit()
    schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    ingest.upsert_entity(c, "region", "Bordeaux", "bordeaux", parent_id=fr)
    for name, slug in [("Cabernet Sauvignon", "cabernet-sauvignon"),
                       ("Merlot", "merlot"), ("Cabernet Franc", "cabernet-franc"),
                       ("Sauvignon Blanc", "sauvignon-blanc"), ("Sémillon", "semillon")]:
        ingest.upsert_entity(c, "grape_variety", name, slug)
    c.commit()
    yield c
    c.close()


def test_bordeaux_loads_region_context_with_real_citation(bordeaux_db):
    bordeaux.load(bordeaux_db)
    rid = _helpers.find_region(bordeaux_db, "Bordeaux")
    row = bordeaux_db.execute(
        "SELECT status, source_citation FROM taxonomy_contexts "
        "WHERE entity_id=? AND scope_id='wine'", (rid,)).fetchone()
    assert row[0] == "validated"
    assert row[1] and not row[1].startswith("legacy:")  # real citation, not legacy


def test_bordeaux_creates_1855_classification_tier(bordeaux_db):
    bordeaux.load(bordeaux_db)
    n = bordeaux_db.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier'"
    ).fetchone()[0]
    assert n >= 1
    # and it is classified_under something, in the right direction
    rel = bordeaux_db.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='classified_under'"
    ).fetchone()[0]
    assert rel >= 1


def test_bordeaux_links_grapes(bordeaux_db):
    bordeaux.load(bordeaux_db)
    n = bordeaux_db.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'"
    ).fetchone()[0]
    assert n >= 4  # at least the red majors


def test_bordeaux_is_idempotent(bordeaux_db):
    bordeaux.load(bordeaux_db)
    bordeaux.load(bordeaux_db)  # re-run must not duplicate
    tiers = bordeaux_db.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier'"
    ).fetchone()[0]
    grown = bordeaux_db.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'"
    ).fetchone()[0]
    bordeaux.load(bordeaux_db)
    assert tiers == bordeaux_db.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier'").fetchone()[0]
    assert grown == bordeaux_db.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'").fetchone()[0]
```

- [ ] **Step 2: Run to verify fail.** `python3 -m pytest tests/test_wine_knowledge_france.py -k bordeaux -v` → FAIL (no `bordeaux` module).

- [ ] **Step 3: Implement `scripts/wine_knowledge/france/bordeaux.py`.** Read the book first, then author. Structure: module-level `CITATION = "Wine Bible 2e, France/Bordeaux"`, a `load(conn)` that: (a) `rid = _helpers.find_region(conn, "Bordeaux")`; (b) `ingest.upsert_context(conn, rid, "wine", short=..., full=..., status="validated", source_citation=CITATION, confidence="high", attributes=json.dumps({...}))`; (c) create the First Growth tier: `tier = ingest.upsert_entity(conn, "classification_tier", "Bordeaux 1855 First Growth", "bordeaux-1855-first-growth")`, `ingest.upsert_context(conn, tier, "wine", ...)`, then `ingest.add_relationship(conn, rid, tier, "classified_under")`; (d) subregion contexts via `_helpers.find_or_create_subregion`; (e) grape links via `_helpers.link_grape`; (f) benchmarks via `ingest.upsert_benchmark`. All authored from the book text.

- [ ] **Step 4: Run to verify pass.** `python3 -m pytest tests/test_wine_knowledge_france.py -v` → all pass (Task 1's 5 + these 4).

- [ ] **Step 5: Commit.**
```bash
git add scripts/wine_knowledge/france/bordeaux.py tests/test_wine_knowledge_france.py
git commit -m "feat: Bordeaux loader — contexts, 1855 First Growth tier, grape links, benchmarks"
```

---

## Task 3: Burgundy loader — the Grand/Premier Cru ladder (recursive-nesting stress test)

**Files:**
- Create: `scripts/wine_knowledge/france/burgundy.py`
- Test: extend `tests/test_wine_knowledge_france.py`

This is the SPEC'S EXPLICIT STRESS TEST (§4.4). Read book lines **9658–11281** (Burgundy + Beaujolais). Capture:
- **Burgundy region context** (upsert onto Burgundy id): the Regional → Village → Premier Cru → Grand Cru quality ladder, Pinot Noir / Chardonnay, the climat concept (a single named vineyard), Côte de Nuits vs Côte de Beaune, Chablis, monopole/négociant system.
- **`classification_tier` entities for the ladder**: "Burgundy Grand Cru", "Burgundy Premier Cru", "Burgundy Village", "Burgundy Regional". Author a context for each explaining the tier.
- **The `outranks` relationships** between tiers: Grand Cru `outranks` Premier Cru `outranks` Village `outranks` Regional (direction: classification_tier → classification_tier, per §4.5). THIS is what exercises the `outranks` verb that Plan 1 defined but never used.
- **`classified_under`** from Burgundy region → each tier.
- Grape links: pinot-noir, chardonnay, gamay (Beaujolais) → Burgundy/Beaujolais.
- Benchmarks where clear (Burgundy Pinot Noir = light-medium body, high acidity, low-moderate tannin).

- [ ] **Step 1: Write the failing test** (append). Fixture includes Burgundy region + pinot-noir/chardonnay/gamay grapes. Assert:

```python
from scripts.wine_knowledge.france import burgundy


@pytest.fixture
def burgundy_db(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL); c.commit(); schema.migrate(c)
    fr = ingest.upsert_entity(c, "country", "France", "france")
    ingest.upsert_entity(c, "region", "Burgundy", "burgundy", parent_id=fr)
    for name, slug in [("Pinot Noir", "pinot-noir"), ("Chardonnay", "chardonnay"),
                       ("Gamay", "gamay")]:
        ingest.upsert_entity(c, "grape_variety", name, slug)
    c.commit(); yield c; c.close()


def test_burgundy_creates_four_tier_ladder(burgundy_db):
    burgundy.load(burgundy_db)
    tiers = {r[0] for r in burgundy_db.execute(
        "SELECT name FROM taxonomy_entities WHERE entity_type='classification_tier'")}
    assert {"Burgundy Grand Cru", "Burgundy Premier Cru",
            "Burgundy Village", "Burgundy Regional"} <= tiers


def test_burgundy_outranks_chain_uses_the_verb(burgundy_db):
    burgundy.load(burgundy_db)
    n = burgundy_db.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'"
    ).fetchone()[0]
    assert n >= 3  # GrandCru>Premier>Village>Regional = 3 outranks edges


def test_burgundy_outranks_is_tier_to_tier(burgundy_db):
    burgundy.load(burgundy_db)
    # every outranks edge must be classification_tier -> classification_tier
    rows = burgundy_db.execute("""
        SELECT ef.entity_type, et.entity_type
        FROM taxonomy_relationships r
        JOIN taxonomy_entities ef ON ef.id=r.from_entity_id
        JOIN taxonomy_entities et ON et.id=r.to_entity_id
        WHERE r.relationship='outranks'""").fetchall()
    assert rows and all(f == "classification_tier" and t == "classification_tier"
                        for f, t in rows)


def test_burgundy_is_idempotent(burgundy_db):
    burgundy.load(burgundy_db); burgundy.load(burgundy_db)
    n = burgundy_db.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'"
    ).fetchone()[0]
    assert n == 3  # exactly 3, no duplicates from re-run
```

- [ ] **Step 2: Run to verify fail.** `python3 -m pytest tests/test_wine_knowledge_france.py -k burgundy -v` → FAIL.

- [ ] **Step 3: Implement `scripts/wine_knowledge/france/burgundy.py`** from the book. Create the four tier entities, wire `outranks` in a chain (grand→premier→village→regional), `classified_under` from region→each tier, region/subregion contexts, grape links, benchmarks. NOTE: `add_relationship` already validates that `outranks` is tier→tier and rejects wrong direction (Plan 1) — lean on it.

- [ ] **Step 4: Run to verify pass.** `python3 -m pytest tests/test_wine_knowledge_france.py -v` → all pass.

- [ ] **Step 5: Commit.**
```bash
git add scripts/wine_knowledge/france/burgundy.py tests/test_wine_knowledge_france.py
git commit -m "feat: Burgundy loader — Grand/Premier Cru tier ladder with outranks chain"
```

---

## Task 4: Champagne + Rhône loaders

**Files:**
- Create: `scripts/wine_knowledge/france/champagne.py`, `scripts/wine_knowledge/france/rhone.py`
- Test: extend `tests/test_wine_knowledge_france.py`

Two smaller loaders, same pattern. Champagne (lines 8598–9658): region context (méthode traditionnelle, blanc de blancs/noirs, NV vs vintage, the cru-village system, Montagne de Reims/Côte des Blancs), grape links (chardonnay, pinot-noir, and pinot-meunier IF it exists as an entity — skip gracefully if not), optionally a "Champagne Grand Cru" classification_tier for the village system. Rhône (lines 11281+, target canonical Rhône=64): Northern (Syrah, Viognier) vs Southern (Grenache-based GSM blends, Châteauneuf-du-Pape) context, grape links (syrah, grenache, viognier, mourvedre), benchmarks.

- [ ] **Step 1: Write the failing tests** (append) — one per loader, asserting: region context validated + real citation, grape links added (grown_in count ≥2 each), idempotent re-run. Follow the Task-2/3 test shape. Guard grape links so a missing grape entity (e.g. pinot-meunier not loaded) is skipped, not an error — either pre-create it in the fixture or have `champagne.load` use a try/skip; PREFER: only link grapes the loader knows exist from Plan 1's 25 (chardonnay, pinot-noir, syrah, grenache, viognier, mourvedre are all in Plan 1; pinot-meunier is NOT — so DON'T link it, or create it as an entity first with its own context).

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement both loaders** from the book text.

- [ ] **Step 4: Run to verify pass.** `python3 -m pytest tests/test_wine_knowledge_france.py -v` → all pass.

- [ ] **Step 5: Commit.**
```bash
git add scripts/wine_knowledge/france/champagne.py scripts/wine_knowledge/france/rhone.py tests/test_wine_knowledge_france.py
git commit -m "feat: Champagne + Rhône loaders (contexts, grape links, benchmarks)"
```

---

## Task 5: Runner + live-DB load + verification

**Files:**
- Create: `scripts/ingest_france.py`
- Test: extend `tests/test_wine_knowledge_france.py` with a live-DB invariant (skips if DB absent)

- [ ] **Step 1: Write the runner** `scripts/ingest_france.py` — `WNLQ9_TAXONOMY_DB` env override (mirror `apply_wine_knowledge_migration.py`), `schema.migrate(conn)` first (idempotent), then `bordeaux.load(conn); burgundy.load(conn); champagne.load(conn); rhone.load(conn)`, print per-type counts.

- [ ] **Step 2: Write the live-DB invariant test** (append) — skips if `LIVE_DB` absent (worktree case); when present asserts: France region contexts no longer carry `legacy:` citation for Bordeaux/Burgundy; ≥1 classification_tier exists; every relationship verb ∈ vocab; zero validated contexts with NULL citation. (Mirror the Plan 1 `live` fixture pattern.)

- [ ] **Step 3: BACKUP the live DB, then run the loader against it (Rule 10 + Rule 1).**
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
cp data/taxonomy.db data/taxonomy.db.bak-pre-france-20260725
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/wine-knowledge-pr"
WNLQ9_TAXONOMY_DB="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/taxonomy.db" python3 -m scripts.ingest_france
```

- [ ] **Step 4: Verify against the live destination (direct query — Rule 1).**
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python3 -c "
import sqlite3; c=sqlite3.connect('data/taxonomy.db')
tiers=c.execute(\"SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier'\").fetchone()[0]
grown=c.execute(\"SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='grown_in'\").fetchone()[0]
outr=c.execute(\"SELECT COUNT(*) FROM taxonomy_relationships WHERE relationship='outranks'\").fetchone()[0]
nullcite=c.execute(\"SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' AND (source_citation IS NULL OR source_citation='')\").fetchone()[0]
# Bordeaux/Burgundy contexts must now be REAL-cited, not legacy
bx=c.execute(\"SELECT source_citation FROM taxonomy_contexts WHERE entity_id=(SELECT id FROM taxonomy_entities WHERE name='Bordeaux' AND entity_type='region') AND scope_id='wine'\").fetchone()[0]
print(f'classification_tiers={tiers} grown_in={grown} outranks={outr} null_citations={nullcite}')
print('Bordeaux citation:', bx)
assert tiers>=5 and grown>=8 and outr>=3 and nullcite==0 and not bx.startswith('legacy:')
print('FRANCE LOAD VERIFIED')
"
```
Expected: classification_tiers ≥5 (1855 First Growth + 4 Burgundy tiers), grown_in ≥8, outranks ≥3, null_citations=0, Bordeaux no longer legacy.

- [ ] **Step 5: Run full wine_knowledge test suite + commit.**
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.worktrees/wine-knowledge-pr"
python3 -m pytest tests/test_wine_knowledge_france.py tests/test_wine_knowledge_ingest.py tests/test_wine_knowledge_invariants.py -v
git add scripts/ingest_france.py tests/test_wine_knowledge_france.py
git commit -m "feat: France runner + live load (1855 + Burgundy tiers, grape links) + invariants"
```

---

## Done criteria for Plan 2

- Bordeaux, Burgundy, Champagne, Rhône region contexts deepened from the book, all with REAL citations (Bordeaux/Burgundy legacy markers replaced).
- ≥5 `classification_tier` entities (1855 First Growth + Burgundy Grand/Premier/Village/Regional), wired with `classified_under` and the Burgundy `outranks` chain — exercising the previously-unused `outranks` verb.
- Grape→region `grown_in` links for France's major grapes.
- Narrative-derived benchmarks (ranges, medium confidence) where the book supports them.
- Live-DB invariants green: zero validated contexts with NULL citation; every relationship verb in the controlled vocabulary; duplicate regions NOT re-created.
- Backup `data/taxonomy.db.bak-pre-france-20260725` exists.

**Not in this plan:** Italy + other countries (Plan 3), explore-map drawer wiring (Plan 4), collections resolver (Plan 5), `style` entities (deferred until a country needs a genuine cross-region style; France's appellations are handled as geography, per spec §4.3).
