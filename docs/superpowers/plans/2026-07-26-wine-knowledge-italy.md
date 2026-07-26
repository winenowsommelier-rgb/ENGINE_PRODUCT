# Wine-Knowledge Italy Chapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the Italy chapter of *The Wine Bible* (2e) into `data/taxonomy.db` — deepening Italian region contexts, adding the key Italian grape varieties, wiring the DOC/DOCG classification tiers, and introducing the first real `style` entity (Super Tuscan) — so the shipped explore-map drawer lights up for Italy automatically.

**Architecture:** Follow the France chapter pattern exactly (`scripts/wine_knowledge/france/`). Add a parallel `scripts/wine_knowledge/italy/` package of sub-chapter loaders driven by a runner `scripts/ingest_italy.py`. All prose is authored **in-session by reading `winebible.md` directly — NO paid API** (Rule 10 N/A). Every context/benchmark carries a real `Wine Bible 2e, Italy/X` citation. Loaders link to the EXISTING region skeleton via helpers that RAISE on a missing entity, and add new Italian `grape_variety` entities up front so later `grown_in` links resolve.

**Tech Stack:** Python 3.9.6 (needs `from __future__ import annotations`), sqlite3, the shipped `scripts/wine_knowledge` ingest library (`upsert_entity`, `upsert_context`, `upsert_benchmark`, `add_relationship`), pytest.

**Series context:** Plan 1 (foundation) + Plan 2 (France) + Plan 4 (drawer UI) are MERGED (PR #85, #86). This is Plan 3 = Italy only (largest remaining SKU bucket, 2,118). USA/Australia/Chile/Spain are a later Plan 3b. Plan 5 (Collections) is a separate plan.

---

## Ground truth verified against the live DB (2026-07-26)

**Italy country entity:** id `5`, slug `italy`.

**Italian region entities that ALREADY EXIST** (link to these, never blind-create):

| Region | id | Region | id |
|---|---|---|---|
| Piedmont | 56 | Tuscany | 68 |
| Veneto | 61 | Sicily | 55 |
| Friuli | 107 | Friuli-Venezia Giulia | 100 |
| Lombardy | 132 | Campania | 86 |
| Emilia-Romagna | 92 | Puglia | 85 |
| Sardinia | 91 | Abruzzo | 98 |
| Marche | 119 | Lazio | 126 |
| Trentino-Alto Adige | 96 | Umbria | 133 |

> **Duplicate note:** both `Friuli` (107) and `Friuli-Venezia Giulia` (100) exist. Author the deepened context on **`Friuli-Venezia Giulia` (100)** (the full name), leave 107 as-is. This mirrors the France Rhône/Rhône-Valley duplicate handling — `find_region` returns the LOWEST id on a name collision, so query by the exact name you want.

**Grape varieties that ALREADY EXIST** (from Plan 1): `nebbiolo`, `barbera`, `sangiovese` — plus international grapes. **Missing Italian grapes we will ADD as new `grape_variety` entities** (Task 2): `primitivo`, `corvina`, `garganega`, `aglianico`, `montepulciano-grape`, `vermentino`, `dolcetto`, `glera`, `nero-d-avola`, `verdicchio`.

> **`montepulciano-grape` slug (critical):** "Montepulciano" is BOTH a grape (Abruzzo) AND a town (Vino Nobile di Montepulciano, Tuscany, made from sangiovese). Use slug `montepulciano-grape` for the grape entity to avoid confusion; name = "Montepulciano".

**No `style` or Italian `classification_tier` entities exist yet.** This plan creates them.

**Book source line ranges** (`/Users/admin/Downloads/WNLQ9-sync/winebible.md`):
- Italy chapter overview + Piedmont (Barolo/Barbaresco): ~15099–16205
- The Veneto (Soave, Amarone): ~16206–16745
- Friuli-Venezia Giulia: ~16746–18285 (also Tuscany, south, islands within)
- Cross-references: Barolo/nebbiolo ~3441; Tuscan wines (Chianti Classico, Vino Nobile, Brunello) ~3622.

## Vocabulary (from `scripts/wine_knowledge/vocab.py` — do NOT invent verbs)

```
grown_in           grape_variety            -> region | appellation
produces_style     region | appellation     -> style
exhibits_style     grape_variety | classification_tier -> style
sub_appellation_of appellation              -> appellation | region
classified_under   appellation | region     -> classification_tier
outranks           classification_tier      -> classification_tier
```

## Ingest API (from `scripts/wine_knowledge/ingest.py` — exact signatures)

```python
upsert_entity(conn, entity_type, name, slug, parent_id=None) -> int
upsert_context(conn, entity_id, scope_id, *, short, full, status="draft",
               source_citation=None, confidence=None, attributes="{}") -> int
    # status="validated" REQUIRES source_citation or it raises.
upsert_benchmark(conn, context_id, dimension_id, *, typical, low=None, high=None,
                 confidence=None, source_citation=None) -> int   # citation REQUIRED
add_relationship(conn, from_id, to_id, relationship, scope_id="wine", metadata="{}") -> int
    # validates verb + direction; INSERT-OR-IGNORE (idempotent)
```

## File Structure

- Create `scripts/wine_knowledge/italy/__init__.py`
- Create `scripts/wine_knowledge/italy/_helpers.py` — thin re-export of the France helpers (`find_region`, `find_or_create_subregion`, `link_grape`) so we don't duplicate. Add `find_grape(conn, slug)` + `link_style`/`classify_under` conveniences if useful, but keep it minimal (DRY).
- Create `scripts/wine_knowledge/italy/grapes.py` — adds the 10 missing Italian `grape_variety` entities + their contexts/benchmarks. **Runs FIRST** so region loaders can `grown_in`-link them.
- Create `scripts/wine_knowledge/italy/piedmont.py` — Piedmont region context + Barolo/Barbaresco DOCG tier + nebbiolo/barbera/dolcetto links.
- Create `scripts/wine_knowledge/italy/tuscany.py` — Tuscany region context + Chianti/Brunello/Vino-Nobile DOCG tier + **Super Tuscan `style`** (the §4.4 style stress test) + sangiovese link.
- Create `scripts/wine_knowledge/italy/veneto.py` — Veneto region context (Soave, Amarone/Valpolicella) + corvina/garganega/glera links.
- Create `scripts/wine_knowledge/italy/south_islands.py` — Campania (aglianico), Puglia (primitivo), Sicily (nero-d-avola), Sardinia (vermentino), Abruzzo (montepulciano-grape), Marche (verdicchio), Friuli-Venezia Giulia region contexts + links.
- Create `scripts/wine_knowledge/italy/tiers.py` — the Italian classification-tier entities (DOCG, DOC) + `classified_under` + `outranks` (DOCG outranks DOC).
- Create `scripts/ingest_italy.py` — runner mirroring `scripts/ingest_france.py` (WNLQ9_TAXONOMY_DB override, `schema.migrate` first, then grapes → tiers → regions, then a verification count print).
- Create `tests/test_wine_knowledge_italy.py` — behavior tests using a temp DB seeded with the minimal Italy skeleton.

> **Style entity scope reminder (spec §6):** `style` is NARROW — only cross-region/extra-legal styles. Super Tuscan qualifies (IGT wines outside the DOCG framework). Do NOT create a `style` per DOCG; those are `classification_tier`s or just region contexts.

---

### Task 1: Italy helpers module (re-export France helpers, add `find_grape`)

**Files:**
- Create: `scripts/wine_knowledge/italy/__init__.py` (empty)
- Create: `scripts/wine_knowledge/italy/_helpers.py`
- Test: `tests/test_wine_knowledge_italy.py`

- [ ] **Step 1: Write the failing test** (seed a temp DB with Italy skeleton via a fixture, assert helpers resolve)

> **CRITICAL — base tables must be created by the fixture, NOT by `schema.migrate`.** Verified: `scripts/wine_knowledge/schema.py::migrate()` only `ALTER TABLE ... ADD COLUMN`s (source_citation/confidence) onto pre-existing tables and runs the legacy-citation backfill — it does **NOT** `CREATE` any base table. On an empty `:memory:` DB the first ALTER raises `no such table: taxonomy_contexts`. The canonical fix already exists: `tests/test_wine_knowledge_france.py` defines a module-level `_DDL` string that CREATEs the base tables first. **Copy that exact `_DDL` constant into the Italy test** and run `c.executescript(_DDL); c.commit(); schema.migrate(c)` BEFORE seeding entities. All later tasks' tests reuse this `conn` fixture, so getting it right here unblocks everything.

```python
# tests/test_wine_knowledge_italy.py
from __future__ import annotations
import sqlite3
import pytest
from scripts.wine_knowledge import schema, ingest
from scripts.wine_knowledge.italy import _helpers

# Copied verbatim from tests/test_wine_knowledge_france.py — schema.migrate only
# ALTERs, it does not CREATE base tables, so the fixture must create them first.
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
  INSERT INTO character_dimensions VALUES ('wine.acidity','wine','acidity');
  INSERT INTO character_dimensions VALUES ('wine.tannin','wine','tannin');
  CREATE TABLE taxonomy_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_entity_id INTEGER NOT NULL,
    to_entity_id INTEGER NOT NULL, relationship TEXT NOT NULL,
    scope_id TEXT, metadata TEXT DEFAULT '{}',
    UNIQUE(from_entity_id, to_entity_id, relationship, scope_id));
"""


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "taxonomy.db")
    c.executescript(_DDL)
    c.commit()
    schema.migrate(c)   # adds source_citation/confidence columns onto the tables above
    # Seed the entities the Italy loaders expect to already exist. cabernet-sauvignon
    # is seeded too so Task 5's exhibits_style edge can use it if chosen.
    it = ingest.upsert_entity(c, "country", "Italy", "italy")
    ingest.upsert_entity(c, "region", "Piedmont", "piedmont", parent_id=it)
    ingest.upsert_entity(c, "region", "Tuscany", "tuscany", parent_id=it)
    ingest.upsert_entity(c, "region", "Veneto", "veneto", parent_id=it)
    ingest.upsert_entity(c, "grape_variety", "Nebbiolo", "nebbiolo")
    ingest.upsert_entity(c, "grape_variety", "Sangiovese", "sangiovese")
    ingest.upsert_entity(c, "grape_variety", "Barbera", "barbera")
    ingest.upsert_entity(c, "grape_variety", "Cabernet Sauvignon", "cabernet-sauvignon")
    ingest.upsert_entity(c, "grape_variety", "Pinot Gris", "pinot-gris")
    c.commit()
    yield c
    c.close()


def test_find_region_resolves_existing(conn):
    assert _helpers.find_region(conn, "Piedmont") > 0


def test_find_region_raises_on_missing(conn):
    with pytest.raises(ValueError):
        _helpers.find_region(conn, "Nowhere")


def test_find_grape_resolves_and_raises(conn):
    assert _helpers.find_grape(conn, "nebbiolo") > 0
    with pytest.raises(ValueError):
        _helpers.find_grape(conn, "no-such-grape")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_wine_knowledge_italy.py -v`
Expected: FAIL (`ModuleNotFoundError: scripts.wine_knowledge.italy`)

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/wine_knowledge/italy/__init__.py  (empty file)
```

```python
# scripts/wine_knowledge/italy/_helpers.py
"""Shared lookups for Italy sub-chapter loaders. Re-exports the France helpers
(find_region / find_or_create_subregion / link_grape) so the linking rules are
identical, and adds find_grape (raise-on-missing grape lookup)."""
from __future__ import annotations

from scripts.wine_knowledge.france._helpers import (  # noqa: F401
    find_region, find_or_create_subregion, link_grape,
)


def find_grape(conn, slug: str) -> int:
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug=?", (slug,)).fetchone()
    if not row:
        raise ValueError(f"grape not found: {slug!r}")
    return row[0]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_wine_knowledge_italy.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/italy/__init__.py scripts/wine_knowledge/italy/_helpers.py tests/test_wine_knowledge_italy.py
git commit -m "feat(wine-knowledge): Italy helpers module (find_region/find_grape)"
```

---

### Task 2: Italian grape varieties loader

**Files:**
- Create: `scripts/wine_knowledge/italy/grapes.py`
- Test: `tests/test_wine_knowledge_italy.py` (add tests)

**The 10 grapes** (name → slug), authored from the book's grape glossary + region chapters:
`Primitivo → primitivo`, `Corvina → corvina`, `Garganega → garganega`, `Aglianico → aglianico`, `Montepulciano → montepulciano-grape`, `Vermentino → vermentino`, `Dolcetto → dolcetto`, `Glera → glera`, `Nero d'Avola → nero-d-avola`, `Verdicchio → verdicchio`.

- [ ] **Step 1: Write the failing test**

```python
def test_grapes_load_creates_entities_with_cited_contexts(conn):
    from scripts.wine_knowledge.italy import grapes
    grapes.load(conn)
    # All 10 exist as grape_variety entities.
    n = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety' "
        "AND slug IN ('primitivo','corvina','garganega','aglianico',"
        "'montepulciano-grape','vermentino','dolcetto','glera','nero-d-avola',"
        "'verdicchio')").fetchone()[0]
    assert n == 10
    # Every new grape context is validated AND cited (Rule 6 invariant).
    bad = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0


def test_grapes_load_is_idempotent(conn):
    from scripts.wine_knowledge.italy import grapes
    grapes.load(conn); grapes.load(conn)   # second run must not duplicate
    n = conn.execute("SELECT COUNT(*) FROM taxonomy_entities "
                     "WHERE slug='primitivo'").fetchone()[0]
    assert n == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_wine_knowledge_italy.py -k grapes -v`
Expected: FAIL (no `grapes` module)

- [ ] **Step 3: Write minimal implementation**

Author `scripts/wine_knowledge/italy/grapes.py` with a `load(conn)` that, for each grape: `upsert_entity(conn, "grape_variety", name, slug)`, then `upsert_context(..., "wine", short=..., full=..., status="validated", source_citation="Wine Bible 2e, Italy (grape glossary)", confidence="medium", attributes=json.dumps({...}))`. Prose MUST be authored from the book — real varietal character (e.g. Primitivo = the Puglian clone of Zinfandel; Corvina = the backbone of Amarone/Valpolicella; Garganega = the Soave grape; Aglianico = the "Barolo of the South"; Nero d'Avola = Sicily's flagship red). Add 1–3 range benchmarks per grape with `confidence="medium"` and the same citation. **Follow the exact structure of `scripts/wine_knowledge/france/bordeaux.py` benchmarks** — note the `dimension_id` argument uses the full `wine.X` form: `"wine.body"`, `"wine.acidity"`, `"wine.tannin"`, `"wine.sweetness"` (NOT bare `"body"`). The benchmarks table stores `dimension_id` as free text (no FK), so the value is a convention, not enforced — match France exactly.

> **Read the book before writing prose.** Open `winebible.md` around the grape glossary and the relevant region chapters. Do NOT fabricate tasting notes — if the book doesn't characterize a grape, write only what it supports and cite it. A fabricated benchmark is a data-integrity break (Rule 6).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_wine_knowledge_italy.py -k grapes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/italy/grapes.py tests/test_wine_knowledge_italy.py
git commit -m "feat(wine-knowledge): 10 Italian grape varieties from The Wine Bible"
```

---

### Task 3: Italian classification tiers (DOCG / DOC + outranks)

**Files:**
- Create: `scripts/wine_knowledge/italy/tiers.py`
- Test: `tests/test_wine_knowledge_italy.py`

**Two tier entities:** `Italy DOCG` (slug `italy-docg`) and `Italy DOC` (slug `italy-doc`), both `entity_type='classification_tier'`. Wire `outranks`: DOCG outranks DOC (the second real use of the `outranks` verb after Burgundy). `classified_under` edges are authored in the region loaders (Piedmont/Tuscany regions → DOCG), not here — but this module MAY add region→tier edges if cleaner. Decide during build; keep authorship single-sourced.

> **Scope check vs spec §6 / Rule 12:** DOCG/DOC are Italy's legal quality pyramid — this is exactly what `classification_tier` is for (the taxonomy twin of the products.db `designation` gap). Do NOT model these as `style`. Do NOT touch products.db `classification`.

- [ ] **Step 1: Write the failing test**

```python
def test_tiers_create_docg_outranks_doc(conn):
    from scripts.wine_knowledge.italy import tiers
    tiers.load(conn)
    docg = conn.execute("SELECT id FROM taxonomy_entities "
        "WHERE entity_type='classification_tier' AND slug='italy-docg'").fetchone()
    doc = conn.execute("SELECT id FROM taxonomy_entities "
        "WHERE entity_type='classification_tier' AND slug='italy-doc'").fetchone()
    assert docg and doc
    edge = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE from_entity_id=? "
        "AND to_entity_id=? AND relationship='outranks'",
        (docg[0], doc[0])).fetchone()[0]
    assert edge == 1
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** implement `tiers.load(conn)` (upsert 2 tier entities with cited validated contexts describing the DOCG/DOC/IGT/VdT pyramid from the book; `add_relationship(conn, docg_id, doc_id, "outranks")`). **Step 4:** Run → PASS. **Step 5:** commit `feat(wine-knowledge): Italy DOCG/DOC classification tiers + outranks ladder`.

---

### Task 4: Piedmont loader (Barolo/Barbaresco)

**Files:**
- Create: `scripts/wine_knowledge/italy/piedmont.py`
- Test: `tests/test_wine_knowledge_italy.py`

Region context on Piedmont (56): nebbiolo homeland, Barolo & Barbaresco DOCG, Alba, fog ("nebbia"), tar-and-roses. `grown_in`: nebbiolo, barbera, dolcetto → Piedmont. `classified_under`: Piedmont → `italy-docg`. Benchmarks: nebbiolo-in-Piedmont high tannin/high acidity ranges, cited. Source lines ~15099–16205 + ~3441.

- [ ] **Step 1: failing test** — assert Piedmont context is validated+cited, ≥2 `grown_in` edges into region 56, and a `classified_under` edge to `italy-docg`.
- [ ] **Step 2–4:** RED → implement (mirror `france/bordeaux.py`; OVERWRITE the legacy Piedmont context with a book-cited one; `link_grape`/`find_grape` for each) → GREEN.
- [ ] **Step 5:** commit `feat(wine-knowledge): Piedmont (Barolo/Barbaresco) chapter`.

---

### Task 5: Tuscany loader + Super Tuscan style (the §4.4 style stress test)

**Files:**
- Create: `scripts/wine_knowledge/italy/tuscany.py`
- Test: `tests/test_wine_knowledge_italy.py`

Region context on Tuscany (68): sangiovese heartland; Chianti Classico, Brunello di Montalcino, Vino Nobile di Montepulciano; galestro soil. **Create the `Super Tuscan` `style` entity** (slug `super-tuscan`), with a cited context: IGT-classified premium reds (often cabernet/merlot-based or sangiovese blends) that deliberately fell OUTSIDE the DOC(G) rules — the first extra-legal cross-region style. Wire: `produces_style` (Tuscany region → super-tuscan) and `exhibits_style` (**use sangiovese** → super-tuscan — sangiovese is seeded in the fixture AND exists on the live DB; cabernet-sauvignon also works but only if seeded). `grown_in`: sangiovese → Tuscany. `classified_under`: Tuscany → `italy-docg`. Source ~3622 + Tuscany chapter.

- [ ] **Step 1: failing test**

```python
def test_super_tuscan_style_and_relationships(conn):
    # seed grapes + tiers first (call grapes.load, tiers.load)
    from scripts.wine_knowledge.italy import grapes, tiers, tuscany
    grapes.load(conn); tiers.load(conn); tuscany.load(conn)
    st = conn.execute("SELECT id FROM taxonomy_entities "
        "WHERE entity_type='style' AND slug='super-tuscan'").fetchone()
    assert st, "Super Tuscan style entity must exist"
    tus = conn.execute("SELECT id FROM taxonomy_entities WHERE slug='tuscany'").fetchone()[0]
    produces = conn.execute(
        "SELECT COUNT(*) FROM taxonomy_relationships WHERE from_entity_id=? "
        "AND to_entity_id=? AND relationship='produces_style'", (tus, st[0])).fetchone()[0]
    assert produces == 1
    # style context is validated + cited
    bad = conn.execute("SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0
```

> **Fixture note:** this test needs Tuscany + sangiovese + tiers seeded. Extend the `conn` fixture or seed inside the test. `produces_style` requires the FROM to be region/appellation and TO to be style — the direction guard will raise if reversed, which is the point of the stress test.

- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5:** commit `feat(wine-knowledge): Tuscany + first Super Tuscan style entity`.

---

### Task 6: Veneto loader

**Files:**
- Create: `scripts/wine_knowledge/italy/veneto.py`
- Test: `tests/test_wine_knowledge_italy.py`

Region context on Veneto (61): Soave (garganega), Valpolicella/Amarone (corvina, appassimento/dried-grape method), Prosecco (glera). `grown_in`: garganega, corvina, glera → Veneto. Benchmarks where cited. Source ~16206–16745.

- [ ] Steps 1–5 as above (RED test asserts ≥2 grown_in edges + validated/cited context) → commit `feat(wine-knowledge): Veneto (Soave/Amarone/Prosecco) chapter`.

---

### Task 7: South & Islands loader (Campania, Puglia, Sicily, Sardinia, Abruzzo, Marche, Friuli-VG)

**Files:**
- Create: `scripts/wine_knowledge/italy/south_islands.py`
- Test: `tests/test_wine_knowledge_italy.py`

One `load(conn)` that deepens each remaining region context (cited) and links its flagship grape:
Campania(86)→aglianico; Puglia(85)→primitivo; Sicily(55)→nero-d-avola; Sardinia(91)→vermentino; Abruzzo(98)→montepulciano-grape; Marche(119)→verdicchio; Friuli-Venezia Giulia(100)→(pinot-gris/friulano — link only grapes that EXIST; pinot-gris exists). Source: within Italy chapter.

> **Link only existing grapes.** `find_grape`/`link_grape` RAISE on missing. Friulano is NOT loaded — link pinot-gris (exists) or skip. Do not blind-create.

- [ ] Steps 1–5 (RED asserts each region context validated+cited and its flagship grown_in edge present) → commit `feat(wine-knowledge): Southern Italy + islands + Friuli chapter`.

---

### Task 8: Runner script `scripts/ingest_italy.py`

**Files:**
- Create: `scripts/ingest_italy.py`
- Test: manual run (integration; the per-loader tests cover units)

Mirror `scripts/ingest_france.py` EXACTLY: `resolve_db()` with `WNLQ9_TAXONOMY_DB` override, `DEFAULT_DB`, `load_all(conn)` calling `schema.migrate` → `pairing_schema.migrate` → `grapes.load` → `tiers.load` → `piedmont/tuscany/veneto/south_islands.load`, then a verification print of counts (grape_variety total, style total, classified_under edges, outranks edges).

- [ ] **Step 1:** Write `scripts/ingest_italy.py`.
- [ ] **Step 2: Dry integration run against a COPY of the live DB** (never the shared file directly during dev):

```bash
cp data/taxonomy.db /tmp/tax_italy_test.db
WNLQ9_TAXONOMY_DB=/tmp/tax_italy_test.db .venv/bin/python -m scripts.ingest_italy
```
Expected: prints `Italy loaded: grapes=... styles=1 classified_under=... outranks=1`, no traceback.

- [ ] **Step 3:** Run the full Italy test suite: `.venv/bin/python -m pytest tests/test_wine_knowledge_italy.py -v` → all PASS.
- [ ] **Step 4: Commit** `feat(wine-knowledge): Italy chapter runner script`.

---

### Task 9: Apply to the live `data/taxonomy.db` + VERIFY (Rule 1/6)

**Files:** none (data operation on the canonical git-ignored DB in the MAIN checkout).

> **Shared-DB safety (learned the hard way):** the canonical `data/taxonomy.db` lives in the MAIN checkout and is git-ignored; the worktree may not have it. Use the `WNLQ9_TAXONOMY_DB` env override to point at the main-checkout DB. NEVER touch products.db. Back up first.

- [ ] **Step 1: Back up the live DB**

```bash
MAIN=/Users/admin/WNLQ9\ PIE/ENGINE_PRODUCT
cp "$MAIN/data/taxonomy.db" "$MAIN/data/taxonomy.db.bak-pre-italy-$(date +%Y%m%d-%H%M%S)"
```

- [ ] **Step 2: Run the loader against the live DB**

```bash
WNLQ9_TAXONOMY_DB="$MAIN/data/taxonomy.db" .venv/bin/python -m scripts.ingest_italy
```

- [ ] **Step 3: VERIFY with direct queries (NOT log lines — Rule 1)**

```bash
sqlite3 "$MAIN/data/taxonomy.db" "
SELECT 'italian_grapes', COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety' AND slug IN ('primitivo','corvina','garganega','aglianico','montepulciano-grape','vermentino','dolcetto','glera','nero-d-avola','verdicchio');
SELECT 'styles', COUNT(*) FROM taxonomy_entities WHERE entity_type='style';
SELECT 'italy_tiers', COUNT(*) FROM taxonomy_entities WHERE entity_type='classification_tier' AND slug LIKE 'italy-%';
SELECT 'validated_missing_citation', COUNT(*) FROM taxonomy_contexts WHERE status='validated' AND (source_citation IS NULL OR source_citation='');
"
```
Expected: `italian_grapes|10`, `styles|1` (Super Tuscan), `italy_tiers|2`, **`validated_missing_citation|0`** (the Rule 6 invariant MUST hold).

- [ ] **Step 4: Run the live-DB invariant suite** (the shipped one from Plan 1):

```bash
.venv/bin/python -m pytest tests/test_wine_knowledge_invariants.py -v
```
Expected: PASS (relationship-vocabulary + citation invariants green with the new Italy rows).

---

### Task 10: Refresh the drawer export + browser-verify Italy (Rule 7 + Rule 9)

**Files:** regenerates `data/taxonomy_descriptions_export.json` (TRACKED) via the shipped Plan-4 export script.

- [ ] **Step 1: Re-run the knowledge export** (reads WINE-scope contexts from taxonomy.db):

```bash
WNLQ9_TAXONOMY_DB="$MAIN/data/taxonomy.db" .venv/bin/python scripts/export_taxonomy_knowledge.py
git diff --stat data/taxonomy_descriptions_export.json   # should show Italy regions gained knowledge blocks
```

- [ ] **Step 2: Regenerate the explore-map build artifact**

```bash
cd apps/catalog && node scripts/gen-explore-map-data.mjs && cd ../..
```

- [ ] **Step 3: Browser-verify (Rule 7)** — start the catalog dev server on :3100, open `/explore-map`, click the **Italy** country chip, then a region (Piedmont or Tuscany), and confirm the drawer shows: Italian grape chips, the Italian classification tier, and the "Learn more" terroir expansion. Verify at **375px AND desktop**, 0 console errors, no horizontal scroll. (Reuse the Playwright pattern from Plan 4; playwright is not a repo dep — `npx` it in scratchpad.)

> **Rule 7 is not optional and "the data loaded" is not proof the UI works.** A screenshot of the Italy drawer with grape chips is the deliverable. If a region has knowledge in the export but no map coords, note it (Plan 4 found 30/38 knowledge regions have coords) — that's an accepted gap, not a failure, but state it.

- [ ] **Step 4: Commit** the regenerated tracked export:

```bash
git add data/taxonomy_descriptions_export.json
git commit -m "feat(wine-knowledge): export Italy knowledge to explore-map drawer"
```

---

## Definition of Done (Plan 3)

- [ ] 10 Italian grape_variety entities + 1 `style` (Super Tuscan) + 2 Italian classification tiers loaded to the live `data/taxonomy.db`, all contexts validated **and cited**.
- [ ] `outranks` (DOCG→DOC) and `produces_style` (Tuscany→Super Tuscan) edges exist (new-verb stress tests pass).
- [ ] `validated_missing_citation = 0` on the live DB (Rule 6 invariant).
- [ ] Live-DB invariant suite green.
- [ ] Tracked `taxonomy_descriptions_export.json` regenerated; explore-map drawer browser-verified for an Italian region at 375px + desktop (Rule 7 screenshot).
- [ ] All work on the worktree branch; nothing written to products.db; live DB backed up pre-run.
