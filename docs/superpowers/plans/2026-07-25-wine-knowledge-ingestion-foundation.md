# Wine Knowledge Ingestion — Foundation Plan (Plan 1 of series)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the schema migration, ingestion helper library, and invariant test suite for digesting *The Wine Bible* + *Food and Wine Pairing* into `data/taxonomy.db`, then ingest the foundational "Mastering Wine" chapter (grape varieties + character grounding) as the first real data load.

**Architecture:** All work is Python + sqlite3 against `data/taxonomy.db`, following the existing `scripts/*taxonomy*.py` + `tests/test_*_invariants.py` patterns. The migration is idempotent (shared DB reverts between turns — [feedback_shared_db_reverts_between_turns]). Book content is extracted **in-session by Claude reading the markdown directly — no paid API calls**. Every data row carries a `source_citation`; validated rows without one fail an invariant test (Rule 6 adapted).

**Tech Stack:** Python 3, sqlite3 (stdlib), pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-25-wine-knowledge-ingestion-design.md`

**Series scope:** This is Plan 1 (foundation). Plan 2 = France chapter (Burgundy/Champagne stress test). Plan 3 = Italy + remaining countries. Plan 4 = Layer 2 explore-map drawer wiring. Plan 5 = Layer 3 collections. Each depends on this one; none are in this plan.

---

## File Structure

- **Create** `scripts/wine_knowledge/__init__.py` — package marker.
- **Create** `scripts/wine_knowledge/schema.py` — idempotent migration: adds `source_citation`/`confidence` columns to `taxonomy_contexts` + `taxonomy_benchmarks`, defines the controlled relationship vocabulary constant, registers the three new entity_types (data-level; no DDL since `entity_type` is free-text). One responsibility: schema shape.
- **Create** `scripts/wine_knowledge/ingest.py` — the ingestion helper API used by every chapter script: `upsert_entity`, `upsert_context`, `upsert_benchmark`, `add_relationship`, `add_pairing_rule`. Enforces the relationship vocabulary and citation-required rules at write time. One responsibility: safe writes.
- **Create** `scripts/wine_knowledge/vocab.py` — the controlled relationship vocabulary + canonical direction map, imported by both `schema.py` and `ingest.py` (DRY single source of truth).
- **Create** `scripts/ingest_mastering_wine.py` — the first chapter loader; calls the `ingest` API to write grape_variety entities + foundational contexts extracted from the book. Data lives here, logic lives in the library.
- **Create** `scripts/wine_knowledge/pairing_schema.py` — creates the `pairing_rules` and `collections` tables (idempotent).
- **Create** `tests/test_wine_knowledge_invariants.py` — the Rule-6-adapted invariant suite.
- **Create** `tests/test_wine_knowledge_ingest.py` — unit tests for the ingest helper API (vocabulary enforcement, citation enforcement, idempotency).

Isolation: this whole plan should execute in a dedicated worktree ([feedback_catalog_worktree_isolation]) since the main checkout's `data/taxonomy.db` is shared.

---

## Task 1: Relationship vocabulary constant (single source of truth)

**Files:**
- Create: `scripts/wine_knowledge/__init__.py`
- Create: `scripts/wine_knowledge/vocab.py`
- Test: `tests/test_wine_knowledge_ingest.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_wine_knowledge_ingest.py
from scripts.wine_knowledge import vocab


def test_vocabulary_matches_spec_exactly():
    # The six §4.5 verbs, no more, no less.
    assert set(vocab.RELATIONSHIP_VERBS) == {
        "grown_in", "produces_style", "exhibits_style",
        "sub_appellation_of", "classified_under", "outranks",
    }


def test_every_verb_has_a_canonical_direction():
    # DIRECTION maps verb -> (from_types, to_types); every verb present.
    for verb in vocab.RELATIONSHIP_VERBS:
        assert verb in vocab.DIRECTION
        frm, to = vocab.DIRECTION[verb]
        assert frm and to
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_ingest.py -v`
Expected: FAIL — `ModuleNotFoundError: scripts.wine_knowledge`.

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/wine_knowledge/__init__.py
# (empty package marker)
```

```python
# scripts/wine_knowledge/vocab.py
"""Controlled relationship vocabulary for taxonomy_relationships.

Single source of truth — imported by schema.py and ingest.py so no
ingestion session can invent ad-hoc synonyms (spec §4.5). Each verb's
canonical direction is (from_entity_types, to_entity_types); rows MUST be
written from -> to, because the table's UNIQUE(from,to,relationship,scope_id)
constraint does not self-correct a reversed edge.
"""
from __future__ import annotations

# verb -> (allowed from entity_types, allowed to entity_types)
DIRECTION: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "grown_in":           (("grape_variety",),                  ("region", "appellation")),
    "produces_style":     (("region", "appellation"),           ("style",)),
    "exhibits_style":     (("grape_variety", "classification_tier"), ("style",)),
    "sub_appellation_of": (("appellation",),                    ("appellation", "region")),
    "classified_under":   (("appellation", "region"),           ("classification_tier",)),
    "outranks":           (("classification_tier",),            ("classification_tier",)),
}

RELATIONSHIP_VERBS: tuple[str, ...] = tuple(DIRECTION.keys())

# New entity_types this effort introduces (entity_type is free-text in the DDL).
NEW_ENTITY_TYPES: tuple[str, ...] = ("grape_variety", "style", "classification_tier")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_ingest.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/__init__.py scripts/wine_knowledge/vocab.py tests/test_wine_knowledge_ingest.py
git commit -m "feat: controlled relationship vocabulary for wine knowledge graph"
```

---

## Task 2: Idempotent schema migration

**Files:**
- Create: `scripts/wine_knowledge/schema.py`
- Test: `tests/test_wine_knowledge_invariants.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_wine_knowledge_invariants.py
import sqlite3
from pathlib import Path

import pytest

from scripts.wine_knowledge import schema

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def db(tmp_path):
    """A minimal taxonomy.db-shaped fixture DB (not the live one)."""
    p = tmp_path / "taxonomy.db"
    c = sqlite3.connect(p)
    c.executescript("""
        CREATE TABLE scopes (id TEXT PRIMARY KEY, label TEXT);
        INSERT INTO scopes VALUES ('wine','Wine');
        CREATE TABLE taxonomy_entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
          name TEXT NOT NULL, slug TEXT NOT NULL, parent_id INTEGER,
          sort_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE(entity_type, slug));
        CREATE TABLE taxonomy_contexts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL,
          scope_id TEXT NOT NULL, description_short TEXT, description_en TEXT,
          attributes TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
          UNIQUE(entity_id, scope_id));
        CREATE TABLE taxonomy_benchmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, context_id INTEGER NOT NULL,
          dimension_id TEXT NOT NULL, typical_value REAL NOT NULL,
          range_low REAL, range_high REAL,
          UNIQUE(context_id, dimension_id));
        CREATE TABLE character_dimensions (
          id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, dimension_key TEXT NOT NULL);
        INSERT INTO character_dimensions VALUES ('wine.body','wine','body');
        CREATE TABLE taxonomy_relationships (
          id INTEGER PRIMARY KEY AUTOINCREMENT, from_entity_id INTEGER NOT NULL,
          to_entity_id INTEGER NOT NULL, relationship TEXT NOT NULL,
          scope_id TEXT, metadata TEXT DEFAULT '{}',
          UNIQUE(from_entity_id, to_entity_id, relationship, scope_id));
    """)
    c.commit()
    yield c
    c.close()


def _cols(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_migration_adds_citation_columns(db):
    schema.migrate(db)
    assert "source_citation" in _cols(db, "taxonomy_contexts")
    assert "confidence" in _cols(db, "taxonomy_contexts")
    assert "source_citation" in _cols(db, "taxonomy_benchmarks")
    assert "confidence" in _cols(db, "taxonomy_benchmarks")


def test_migration_is_idempotent(db):
    schema.migrate(db)
    schema.migrate(db)  # must not raise "duplicate column"
    assert "source_citation" in _cols(db, "taxonomy_contexts")


def test_migration_backfills_legacy_validated_citations(db):
    # A validated context with no citation existed BEFORE the citation regime.
    eid = db.execute(
        "INSERT INTO taxonomy_entities (entity_type,name,slug) "
        "VALUES ('region','Legacy','legacy')").lastrowid
    db.execute(
        "INSERT INTO taxonomy_contexts (entity_id,scope_id,status) "
        "VALUES (?, 'wine', 'validated')", (eid,))
    db.commit()
    schema.migrate(db)
    cite = db.execute(
        "SELECT source_citation FROM taxonomy_contexts WHERE entity_id=?",
        (eid,)).fetchone()[0]
    assert cite == schema.LEGACY_CITATION  # marked, not left NULL, not faked
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_invariants.py -v`
Expected: FAIL — `AttributeError: module scripts.wine_knowledge.schema has no attribute migrate`.

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/wine_knowledge/schema.py
"""Idempotent migration for the wine-knowledge ingestion effort.

Adds source_citation + confidence to taxonomy_contexts and
taxonomy_benchmarks (spec §4.2). entity_type is free-text in the DDL, so
the three new types (grape_variety/style/classification_tier) need no DDL
change — see vocab.NEW_ENTITY_TYPES. Idempotent because the shared DB can
revert between turns (feedback_shared_db_reverts_between_turns).
"""
from __future__ import annotations

import sqlite3


def _has_column(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def _add_column_if_missing(conn, table, col, decl):
    if not _has_column(conn, table, col):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


# Legacy validated contexts predate the citation regime (153 rows from the
# explore-map effort — 93 wine / 52 spirits / 4 sake / 4 accessories). We do
# NOT retroactively pretend they came from a book; we mark them honestly so the
# citation invariant can enforce "no NULL citation on validated rows" without
# either failing on legacy data or silently exempting it.
LEGACY_CITATION = "legacy:pre-wine-knowledge (uncited explore-map seed)"


def migrate(conn: sqlite3.Connection) -> None:
    for table in ("taxonomy_contexts", "taxonomy_benchmarks"):
        _add_column_if_missing(conn, table, "source_citation", "TEXT")
        _add_column_if_missing(conn, table, "confidence", "TEXT")
    # Backfill legacy validated contexts with the explicit legacy marker.
    conn.execute(
        "UPDATE taxonomy_contexts SET source_citation=? "
        "WHERE status='validated' AND (source_citation IS NULL OR source_citation='')",
        (LEGACY_CITATION,))
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_invariants.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/schema.py tests/test_wine_knowledge_invariants.py
git commit -m "feat: idempotent migration adding source_citation to taxonomy contexts/benchmarks"
```

---

## Task 3: Ingest helper — entity + context upsert with citation enforcement

**Files:**
- Create: `scripts/wine_knowledge/ingest.py`
- Test: `tests/test_wine_knowledge_ingest.py:add`

- [ ] **Step 1: Write the failing test**

Define a local `db` fixture in this test file by inlining the same
`CREATE TABLE` script from Task 2 (do NOT import the fixture across modules —
cross-module pytest fixture reuse relies on private internals and is fragile).
Keeping each test file's fixture self-contained is worth the small duplication.

```python
# append to tests/test_wine_knowledge_ingest.py
import sqlite3
import pytest
from scripts.wine_knowledge import ingest, schema

_FIXTURE_DDL = """
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
    c.executescript(_FIXTURE_DDL)
    c.commit()
    yield c
    c.close()


def test_upsert_entity_is_idempotent(db):
    schema.migrate(db)
    id1 = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    id2 = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    assert id1 == id2


def test_validated_context_requires_citation(db):
    schema.migrate(db)
    eid = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    with pytest.raises(ValueError, match="source_citation"):
        ingest.upsert_context(db, eid, "wine", short="x", full="y",
                              status="validated", source_citation=None)


def test_draft_context_allows_missing_citation(db):
    schema.migrate(db)
    eid = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    cid = ingest.upsert_context(db, eid, "wine", short="x", full="y",
                                status="draft", source_citation=None)
    assert cid > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_ingest.py -v`
Expected: FAIL — `ingest` has no `upsert_entity`/`upsert_context`.

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/wine_knowledge/ingest.py
"""Safe write API for the wine-knowledge graph.

Every write goes through here so two rules are enforced in ONE place:
  1. status='validated' rows MUST carry a non-null source_citation (§4.2, §8).
  2. relationships MUST use a verb from vocab.RELATIONSHIP_VERBS in its
     canonical direction (§4.5).
"""
from __future__ import annotations

import sqlite3
from typing import Optional

from scripts.wine_knowledge import vocab


def upsert_entity(conn, entity_type: str, name: str, slug: str,
                  parent_id: Optional[int] = None) -> int:
    row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type=? AND slug=?",
        (entity_type, slug)).fetchone()
    if row:
        return row[0]
    cur = conn.execute(
        "INSERT INTO taxonomy_entities (entity_type,name,slug,parent_id) "
        "VALUES (?,?,?,?)", (entity_type, name, slug, parent_id))
    conn.commit()
    return cur.lastrowid


def upsert_context(conn, entity_id: int, scope_id: str, *, short: str,
                   full: str, status: str = "draft",
                   source_citation: Optional[str] = None,
                   confidence: Optional[str] = None,
                   attributes: str = "{}") -> int:
    if status == "validated" and not source_citation:
        raise ValueError("validated context requires a non-null source_citation")
    existing = conn.execute(
        "SELECT id FROM taxonomy_contexts WHERE entity_id=? AND scope_id=?",
        (entity_id, scope_id)).fetchone()
    if existing:
        conn.execute(
            "UPDATE taxonomy_contexts SET description_short=?, description_en=?, "
            "attributes=?, status=?, source_citation=?, confidence=? WHERE id=?",
            (short, full, attributes, status, source_citation, confidence, existing[0]))
        conn.commit()
        return existing[0]
    cur = conn.execute(
        "INSERT INTO taxonomy_contexts (entity_id,scope_id,description_short,"
        "description_en,attributes,status,source_citation,confidence) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (entity_id, scope_id, short, full, attributes, status,
         source_citation, confidence))
    conn.commit()
    return cur.lastrowid
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_ingest.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/ingest.py tests/test_wine_knowledge_ingest.py
git commit -m "feat: ingest helper with citation-required enforcement on validated contexts"
```

---

## Task 4: Ingest helper — relationship with vocabulary + direction enforcement

**Files:**
- Modify: `scripts/wine_knowledge/ingest.py`
- Test: `tests/test_wine_knowledge_ingest.py:add`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_wine_knowledge_ingest.py
def test_add_relationship_rejects_unknown_verb(db):
    schema.migrate(db)
    g = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    r = ingest.upsert_entity(db, "region", "Piedmont", "piedmont")
    with pytest.raises(ValueError, match="verb"):
        ingest.add_relationship(db, g, r, "is_grown_in")  # ad-hoc synonym


def test_add_relationship_rejects_wrong_direction(db):
    schema.migrate(db)
    g = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    r = ingest.upsert_entity(db, "region", "Piedmont", "piedmont")
    # grown_in must be grape_variety -> region, not region -> grape_variety
    with pytest.raises(ValueError, match="direction"):
        ingest.add_relationship(db, r, g, "grown_in")


def test_add_relationship_happy_path(db):
    schema.migrate(db)
    g = ingest.upsert_entity(db, "grape_variety", "Nebbiolo", "nebbiolo")
    r = ingest.upsert_entity(db, "region", "Piedmont", "piedmont")
    rid = ingest.add_relationship(db, g, r, "grown_in")
    assert rid > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_ingest.py -k relationship -v`
Expected: FAIL — no `add_relationship`.

- [ ] **Step 3: Write minimal implementation**

```python
# append to scripts/wine_knowledge/ingest.py
def _entity_type(conn, entity_id: int) -> str:
    row = conn.execute("SELECT entity_type FROM taxonomy_entities WHERE id=?",
                       (entity_id,)).fetchone()
    if not row:
        raise ValueError(f"no entity id={entity_id}")
    return row[0]


def add_relationship(conn, from_id: int, to_id: int, relationship: str,
                     scope_id: Optional[str] = "wine", metadata: str = "{}") -> int:
    if relationship not in vocab.RELATIONSHIP_VERBS:
        raise ValueError(f"unknown relationship verb: {relationship!r}")
    allowed_from, allowed_to = vocab.DIRECTION[relationship]
    ft, tt = _entity_type(conn, from_id), _entity_type(conn, to_id)
    if ft not in allowed_from or tt not in allowed_to:
        raise ValueError(
            f"wrong direction for {relationship}: {ft}->{tt}, "
            f"expected {allowed_from}->{allowed_to}")
    cur = conn.execute(
        "INSERT OR IGNORE INTO taxonomy_relationships "
        "(from_entity_id,to_entity_id,relationship,scope_id,metadata) "
        "VALUES (?,?,?,?,?)", (from_id, to_id, relationship, scope_id, metadata))
    conn.commit()
    if cur.lastrowid:
        return cur.lastrowid
    row = conn.execute(
        "SELECT id FROM taxonomy_relationships WHERE from_entity_id=? AND "
        "to_entity_id=? AND relationship=? AND scope_id IS ?",
        (from_id, to_id, relationship, scope_id)).fetchone()
    return row[0]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_ingest.py -k relationship -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/ingest.py tests/test_wine_knowledge_ingest.py
git commit -m "feat: relationship writes enforce controlled vocabulary + canonical direction"
```

---

## Task 5: Benchmark + pairing/collections schema

**Files:**
- Create: `scripts/wine_knowledge/pairing_schema.py`
- Modify: `scripts/wine_knowledge/ingest.py` (add `upsert_benchmark`, `add_pairing_rule`)
- Test: `tests/test_wine_knowledge_ingest.py:add`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_wine_knowledge_ingest.py
from scripts.wine_knowledge import pairing_schema


def test_benchmark_is_range_with_confidence(db):
    schema.migrate(db)
    eid = ingest.upsert_entity(db, "region", "Barolo", "barolo")
    cid = ingest.upsert_context(db, eid, "wine", short="x", full="y",
                                status="validated",
                                source_citation="Wine Bible 2e, Italy/Piedmont")
    bid = ingest.upsert_benchmark(db, cid, "wine.body", typical=4.0,
                                  low=3.5, high=5.0, confidence="medium",
                                  source_citation="Wine Bible 2e, Italy/Piedmont")
    assert bid > 0


def test_validated_benchmark_requires_citation(db):
    schema.migrate(db)
    eid = ingest.upsert_entity(db, "region", "Barolo", "barolo")
    cid = ingest.upsert_context(db, eid, "wine", short="x", full="y", status="draft")
    with pytest.raises(ValueError, match="source_citation"):
        ingest.upsert_benchmark(db, cid, "wine.body", typical=4.0,
                                confidence="medium", source_citation=None)


def test_pairing_rules_table_created(db):
    pairing_schema.migrate(db)
    cols = {r[1] for r in db.execute("PRAGMA table_info(pairing_rules)")}
    assert {"wine_dimension", "food_attribute", "score", "rationale",
            "source_citation"} <= cols


def test_collections_table_created(db):
    pairing_schema.migrate(db)
    cols = {r[1] for r in db.execute("PRAGMA table_info(collections)")}
    assert {"slug", "name", "filter_definition", "description"} <= cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_ingest.py -k "benchmark or pairing or collections" -v`
Expected: FAIL — no `pairing_schema`, no `upsert_benchmark`.

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/wine_knowledge/pairing_schema.py
"""Creates pairing_rules (component-matching layer only, §5) and collections
(dynamic saved-filter, §7) tables. Idempotent."""
from __future__ import annotations
import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS pairing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wine_dimension TEXT NOT NULL,      -- e.g. 'acidity'
      wine_op TEXT NOT NULL,             -- '>=','<=','=='
      wine_value REAL NOT NULL,
      food_attribute TEXT NOT NULL,      -- e.g. 'fat'
      food_value TEXT NOT NULL,          -- e.g. 'high'
      score REAL NOT NULL,               -- +2 boost / -2 clash
      rationale TEXT,                    -- 'cuts richness'
      source_citation TEXT NOT NULL,     -- component-matching only; §5
      confidence TEXT
    );
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      filter_definition TEXT NOT NULL DEFAULT '{}',  -- JSON; clean-join fields only §7
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)
    conn.commit()
```

```python
# append to scripts/wine_knowledge/ingest.py
def upsert_benchmark(conn, context_id: int, dimension_id: str, *,
                     typical: float, low: Optional[float] = None,
                     high: Optional[float] = None,
                     confidence: Optional[str] = None,
                     source_citation: Optional[str] = None) -> int:
    # benchmarks derived from narrative prose are always sourced (§4.2/§8).
    if not source_citation:
        raise ValueError("benchmark requires a non-null source_citation")
    existing = conn.execute(
        "SELECT id FROM taxonomy_benchmarks WHERE context_id=? AND dimension_id=?",
        (context_id, dimension_id)).fetchone()
    if existing:
        conn.execute(
            "UPDATE taxonomy_benchmarks SET typical_value=?, range_low=?, "
            "range_high=?, confidence=?, source_citation=? WHERE id=?",
            (typical, low, high, confidence, source_citation, existing[0]))
        conn.commit()
        return existing[0]
    cur = conn.execute(
        "INSERT INTO taxonomy_benchmarks (context_id,dimension_id,typical_value,"
        "range_low,range_high,confidence,source_citation) VALUES (?,?,?,?,?,?,?)",
        (context_id, dimension_id, typical, low, high, confidence, source_citation))
    conn.commit()
    return cur.lastrowid


def add_pairing_rule(conn, *, wine_dimension: str, wine_op: str,
                     wine_value: float, food_attribute: str, food_value: str,
                     score: float, rationale: str, source_citation: str,
                     confidence: Optional[str] = None) -> int:
    if not source_citation:
        raise ValueError("pairing rule requires a source_citation")
    cur = conn.execute(
        "INSERT INTO pairing_rules (wine_dimension,wine_op,wine_value,"
        "food_attribute,food_value,score,rationale,source_citation,confidence) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (wine_dimension, wine_op, wine_value, food_attribute, food_value,
         score, rationale, source_citation, confidence))
    conn.commit()
    return cur.lastrowid
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_ingest.py -k "benchmark or pairing or collections" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/wine_knowledge/pairing_schema.py scripts/wine_knowledge/ingest.py tests/test_wine_knowledge_ingest.py
git commit -m "feat: benchmark/pairing/collections schema + citation-required writes"
```

---

## Task 6: Live-DB invariant suite (Rule 6 adapted)

**Files:**
- Modify: `tests/test_wine_knowledge_invariants.py` (add live-DB invariants)

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_wine_knowledge_invariants.py
from scripts.wine_knowledge import vocab as _vocab

LIVE_DB = REPO_ROOT / "data" / "taxonomy.db"


@pytest.fixture(scope="module")
def live():
    if not LIVE_DB.exists():
        pytest.skip(f"live taxonomy.db not present: {LIVE_DB}")
    c = sqlite3.connect(LIVE_DB)
    yield c
    c.close()


def _has_col(conn, table, col):
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def test_validated_contexts_have_citation(live):
    """INVARIANT (Rule 6 adapted): a validated context with no source_citation
    means we can't audit where the claim came from. Since extraction is
    in-session (no paid API), this is our only provenance guard."""
    if not _has_col(live, "taxonomy_contexts", "source_citation"):
        pytest.skip("migration not yet applied to live db")
    bad = live.execute(
        "SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' "
        "AND (source_citation IS NULL OR source_citation='')").fetchone()[0]
    assert bad == 0, f"{bad} validated contexts missing source_citation"


def test_all_relationships_use_controlled_vocabulary(live):
    """INVARIANT (§4.5/§8): no ad-hoc relationship verbs."""
    rows = live.execute(
        "SELECT DISTINCT relationship FROM taxonomy_relationships").fetchall()
    unknown = [r[0] for r in rows if r[0] not in _vocab.RELATIONSHIP_VERBS]
    assert not unknown, f"unknown relationship verbs in live db: {unknown}"
```

- [ ] **Step 2: Run test to verify current live-DB state**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_invariants.py -k "live or citation or vocabulary" -v`
Expected (BEFORE the Task 7 migration runs): the citation test SKIPs — the
`source_citation` column does not exist on the live DB yet, so `_has_col` is
False and the test skips. The vocabulary test PASSES (relationships table is
empty today). AFTER Task 7 migration runs, the citation test will actively PASS
because the migration backfills the 153 legacy validated rows with
`schema.LEGACY_CITATION` (so none are NULL). This is the correct behavior — the
invariant enforces "no validated row has a NULL/empty citation," and legacy rows
satisfy it via the honest legacy marker, not by exemption.

- [ ] **Step 3: (no implementation needed — invariants only)**

- [ ] **Step 4: Confirm suite is green/skipped**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_invariants.py -v`
Expected: all PASS or SKIP, none FAIL.

- [ ] **Step 5: Commit**

```bash
git add tests/test_wine_knowledge_invariants.py
git commit -m "test: live-db provenance + relationship-vocabulary invariants"
```

---

## Task 7: Apply migration to the live taxonomy.db

**Files:**
- Create: `scripts/apply_wine_knowledge_migration.py` (thin runner)

- [ ] **Step 1: Back up the live DB first (Rule 10-adapted safety)**

```bash
cd "$(git rev-parse --show-toplevel)"
cp data/taxonomy.db data/taxonomy.db.bak-pre-wine-knowledge-20260725
```

- [ ] **Step 2: Write the runner**

```python
# scripts/apply_wine_knowledge_migration.py
"""Applies schema.migrate + pairing_schema.migrate to the live taxonomy.db."""
from pathlib import Path
import sqlite3
from scripts.wine_knowledge import schema, pairing_schema

DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"

if __name__ == "__main__":
    conn = sqlite3.connect(DB)
    schema.migrate(conn)
    pairing_schema.migrate(conn)
    conn.close()
    print(f"migrated {DB}")
```

- [ ] **Step 3: Run it**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m scripts.apply_wine_knowledge_migration`
Expected: prints `migrated .../data/taxonomy.db`.

- [ ] **Step 4: Verify columns landed (direct query — not log lines, per Rule 1)**

Run:
```bash
cd "$(git rev-parse --show-toplevel)" && python3 -c "
import sqlite3; c=sqlite3.connect('data/taxonomy.db')
for t in ('taxonomy_contexts','taxonomy_benchmarks'):
    cols={r[1] for r in c.execute(f'PRAGMA table_info({t})')}
    assert 'source_citation' in cols and 'confidence' in cols, t
for t in ('pairing_rules','collections'):
    assert c.execute(f\"SELECT 1 FROM sqlite_master WHERE name='{t}'\").fetchone(), t
print('live schema OK')"
```
Expected: `live schema OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/apply_wine_knowledge_migration.py
git commit -m "chore: runner to apply wine-knowledge migration to live taxonomy.db"
```

---

## Task 8: Ingest the "Mastering Wine" foundational chapter (grape varieties)

This is the first real book digestion. It is **manual, in-session extraction** by
the implementing agent reading `winebible.md` lines ~2884–5340 (Top 25 Grapes +
A-Z glossary). No paid API. The script is a data file; the agent fills the
`GRAPES` list by reading the book.

**Files:**
- Create: `scripts/ingest_mastering_wine.py`
- Test: `tests/test_wine_knowledge_invariants.py` (add post-load count assertions, run only after load)

- [ ] **Step 1: Read the source and extract grape data**

Read `/Users/admin/Downloads/WNLQ9-sync/winebible.md` lines 2884–5340. For each
grape, capture: `name`, `slug`, `description_short` (≤160 chars, one-line
essence), `description_en` (full profile: origin, character, key regions),
`source_citation` (e.g. `"Wine Bible 2e, Top 25 Grapes"` or the glossary letter),
and where the book gives clear sensory language, a benchmark or two
(body/acidity/tannin/sweetness) as a **range** with `confidence='medium'` and
provenance noting it's narrative-derived.

- [ ] **Step 2: Write the loader**

```python
# scripts/ingest_mastering_wine.py
"""Loads grape_variety entities + contexts from the Wine Bible foundational
chapters (Top 25 Grapes + A-Z glossary). Extraction is manual/in-session;
GRAPES below is authored by reading winebible.md directly (no paid API).

Every context is status='validated' WITH a source_citation, so the live-db
invariant (test_validated_contexts_have_citation) stays green.
"""
from pathlib import Path
import json
import sqlite3
from scripts.wine_knowledge import ingest, schema

DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"

# Authored by reading winebible.md ~L2884-5340. Grow this list per grape.
# Shape: dict(name, slug, short, full, citation, attributes(dict), benchmarks(list))
GRAPES = [
    {
        "name": "Nebbiolo", "slug": "nebbiolo",
        "short": "Italy's noble red of Piedmont — pale but ferociously "
                 "tannic and high-acid, with tar, rose, and cherry.",
        "full": "…",  # authored from the book
        "citation": "Wine Bible 2e, Top 25 Grapes / Nebbiolo",
        "attributes": {"key_regions": ["Piedmont", "Barolo", "Barbaresco"]},
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 4.5, "low": 4.0, "high": 5.0},
            {"dim": "wine.acidity", "typ": 4.5, "low": 4.0, "high": 5.0},
        ],
    },
    # … remaining grapes authored in-session …
]


def load(conn):
    schema.migrate(conn)
    for g in GRAPES:
        eid = ingest.upsert_entity(conn, "grape_variety", g["name"], g["slug"])
        cid = ingest.upsert_context(
            conn, eid, "wine", short=g["short"], full=g["full"],
            status="validated", source_citation=g["citation"],
            confidence="high", attributes=json.dumps(g.get("attributes", {})))
        for b in g.get("benchmarks", []):
            ingest.upsert_benchmark(
                conn, cid, b["dim"], typical=b["typ"], low=b.get("low"),
                high=b.get("high"), confidence="medium",
                source_citation=g["citation"] + " (narrative-derived)")
    return len(GRAPES)


if __name__ == "__main__":
    conn = sqlite3.connect(DB)
    n = load(conn)
    conn.close()
    print(f"loaded {n} grape varieties")
```

- [ ] **Step 3: Run the loader**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m scripts.ingest_mastering_wine`
Expected: `loaded N grape varieties` (N = number authored, target ≥25 for the Top 25).

- [ ] **Step 4: Verify data landed in the live destination (Rule 1 — direct query, not log lines)**

Run:
```bash
cd "$(git rev-parse --show-toplevel)" && python3 -c "
import sqlite3; c=sqlite3.connect('data/taxonomy.db')
n=c.execute(\"SELECT COUNT(*) FROM taxonomy_entities WHERE entity_type='grape_variety'\").fetchone()[0]
ctx=c.execute(\"SELECT COUNT(*) FROM taxonomy_contexts tc JOIN taxonomy_entities te ON te.id=tc.entity_id WHERE te.entity_type='grape_variety' AND tc.status='validated'\").fetchone()[0]
# NEW grape contexts must carry a REAL (non-legacy) citation. Legacy explore-map
# rows are marked schema.LEGACY_CITATION and are excluded from this check.
badgrape=c.execute(\"SELECT COUNT(*) FROM taxonomy_contexts tc JOIN taxonomy_entities te ON te.id=tc.entity_id WHERE te.entity_type='grape_variety' AND tc.status='validated' AND (tc.source_citation IS NULL OR tc.source_citation='' OR tc.source_citation LIKE 'legacy:%')\").fetchone()[0]
# And no validated row anywhere may have a NULL/empty citation (legacy backfilled).
nullcite=c.execute(\"SELECT COUNT(*) FROM taxonomy_contexts WHERE status='validated' AND (source_citation IS NULL OR source_citation='')\").fetchone()[0]
print(f'grapes={n} validated_grape_contexts={ctx} grape_without_real_citation={badgrape} any_null_citation={nullcite}')
assert n>=25 and ctx>=25 and badgrape==0 and nullcite==0"
```
Expected: `grapes=N validated_grape_contexts=N grape_without_real_citation=0 any_null_citation=0` with N≥25.

- [ ] **Step 5: Run the full invariant suite against the now-populated live DB**

Run: `cd "$(git rev-parse --show-toplevel)" && python3 -m pytest tests/test_wine_knowledge_invariants.py tests/test_wine_knowledge_ingest.py -v`
Expected: all PASS (the citation invariant now actively verifies real rows, not skipped).

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest_mastering_wine.py
git commit -m "feat: ingest Top 25 grape varieties from Wine Bible foundational chapter"
```

---

## Done criteria for Plan 1

- Migration applied to live `data/taxonomy.db`; `source_citation`/`confidence`
  columns + `pairing_rules`/`collections` tables exist.
- ≥25 `grape_variety` entities with validated, cited contexts loaded.
- All invariant tests green against the live DB (provenance + vocabulary).
- Backup `data/taxonomy.db.bak-pre-wine-knowledge-20260725` exists.
- Zero validated rows without a citation (the core provenance guarantee).

**Not in this plan (later plans):** France/Italy/other country chapters, the
`style`/`classification_tier` entities that come with those chapters, explore-map
drawer wiring (Layer 2), collections resolver + URL routes (Layer 3), pairing
rule extraction from Harrington (Layer 1b — can be its own plan, runs parallel).
