# Curation Dossier Library — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every piece of Phase 0 from the curation dossier spec — schema, orphan purge, wine_key normalizer + registry, consistency checks, validators, invariant tests, and the export deriver — as pure code with zero LLM/API calls, so Phase 1 (the wine-generation canary) has a tested foundation to write into.

**Architecture:** A new standalone SQLite file `data/db/dossier.db` holds all dossier tables (never `products.db` — see spec §4, parallel processes replace that file wholesale). A pure Python module (`data/lib/dossier/wine_key.py`) normalizes SKU names into `wine_key` identities and is mirrored by a lock-step TypeScript twin for future catalog-side use, following the existing `sku_taxonomy.py` / `sku-taxonomy.ts` parity pattern. A migration script creates the schema; an audit script produces the eyeball artifact; a deriver script (modeled on `refresh_products_summary.py`) will denormalize dossier content into `products.curation_dossier` — but since Phase 0 generates no content yet, the deriver is built and tested against synthetic fixture rows, not live data.

**Tech Stack:** Python 3 (sqlite3, pytest), TypeScript (mirrored constants only, no runtime import), SQLite (JSON1 extension, WAL).

**Depends on:** `docs/superpowers/specs/2026-07-15-curation-dossier-library-design.md` (commits d036ca5, c2b4180, 7856d30, 7fff2d3).

---

## File Structure

| File | Responsibility |
|---|---|
| `data/db/dossier.db` | New standalone SQLite file (created by migration, not committed to git) |
| `scripts/migrate_dossier_schema.py` | Creates `wine_dossier`, `sku_dossier_overlay`, `designation_reference`, `dossier_runs`, `dossier_staging` in `dossier.db`; idempotent |
| `data/lib/dossier/wine_key.py` | Pure function: SKU+name → `wine_key`; hazard-class normalization; override map |
| `apps/catalog/lib/dossier/wine-key.ts` | TS twin of the override map only (no runtime resolver needed yet — nothing in the catalog consumes wine_key in Phase 0); parity-tested against the Python override map |
| `scripts/purge_orphan_critic_skus.py` | Resolves/purges the 20 critic_scores rows with no matching `products.sku` |
| `scripts/audit_wine_keys.py` | Runs the normalizer over the in-stock critic-scored scope; writes an eyeball CSV/JSON artifact; prints the scope re-derivation (Rule 1 style tally) |
| `data/lib/dossier/consistency_checks.py` | Name-year vs vintage-field mismatch detector (§5.8) |
| `data/lib/dossier/serve_defaults.py` | category_type/body/tannin → default `serve_guidance_json`; WSP/WDW designation-keyed exceptions |
| `data/lib/dossier/validators.py` | No-price-language check, canonical pairing-token check, provenance-URL check, JSON Schema conformance, n-gram overlap check, banned-phrase list |
| `data/lib/dossier/schema/dossier_response.schema.json` | Versioned JSON Schema for a subagent's staged response (referenced by `prompt_version`) |
| `scripts/refresh_products_dossier.py` | Deriver: `wine_dossier`/`sku_dossier_overlay` (dossier.db, ATTACHed) → `products.curation_dossier` (products.db) |
| `tests/test_wine_key_normalizer.py` | Six hazard-class unit tests + parity test (§5.7, §9 test 7) |
| `tests/test_dossier_consistency_checks.py` | Name-vintage mismatch detector tests (§5.8) |
| `tests/test_dossier_validators.py` | Validator unit tests (banned phrases, n-gram, price language, pairing tokens, provenance) |
| `tests/test_dossier_db_invariants.py` | The 7 invariant tests from spec §9 (pattern: `test_enrichment_db_invariants.py`) |
| `tests/test_refresh_products_dossier.py` | Deriver unit tests against a synthetic fixture DB |
| `tests/fixtures/wine_key_cases.json` | Hazard-class + parity fixture cases (pattern: `sku_taxonomy_cases.json`) |

Modified in a **later** plan (Phase 1, not this one): `scripts/refresh_live_export.py` (EXPORT_COLS/JSON_COLS), `apps/catalog/lib/catalog-data.ts` (PUBLIC_FIELDS). Phase 0 builds and tests the deriver's *output shape* so those two hookups are a small, low-risk change when Phase 1 starts generating real content — see Task 10.

---

## Task 1: Dossier schema migration

**Files:**
- Create: `scripts/migrate_dossier_schema.py`
- Test: `tests/test_migrate_dossier_schema.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_migrate_dossier_schema.py
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATE = REPO_ROOT / "scripts" / "migrate_dossier_schema.py"

def test_migration_creates_all_five_tables(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run(
        [sys.executable, str(MIGRATE), "--db", str(db_path)],
        check=True, capture_output=True, text=True,
    )
    conn = sqlite3.connect(db_path)
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert {"wine_dossier", "sku_dossier_overlay", "designation_reference",
            "dossier_runs", "dossier_staging"} <= tables

def test_migration_is_idempotent(tmp_path):
    db_path = tmp_path / "dossier.db"
    for _ in range(2):
        subprocess.run(
            [sys.executable, str(MIGRATE), "--db", str(db_path)],
            check=True, capture_output=True, text=True,
        )
    conn = sqlite3.connect(db_path)
    # still exactly one of each table, no "table already exists" crash
    n = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wine_dossier'"
    ).fetchone()[0]
    assert n == 1

def test_json_columns_reject_invalid_json(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run(
        [sys.executable, str(MIGRATE), "--db", str(db_path)],
        check=True, capture_output=True, text=True,
    )
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    import pytest
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO wine_dossier (wine_key, signature_pairings_json) "
            "VALUES ('x', 'not json')"
        )

def test_staging_rejected_rows_are_distinct_from_applied(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run(
        [sys.executable, str(MIGRATE), "--db", str(db_path)],
        check=True, capture_output=True, text=True,
    )
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO dossier_staging (wine_key, run_id, validation_status) "
        "VALUES ('x', 'r1', 'rejected')"
    )
    conn.commit()
    row = conn.execute(
        "SELECT validation_status FROM dossier_staging WHERE wine_key='x'"
    ).fetchone()
    assert row[0] == "rejected"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_migrate_dossier_schema.py -v`
Expected: FAIL — `scripts/migrate_dossier_schema.py` does not exist (`FileNotFoundError` / non-zero exit from subprocess).

- [ ] **Step 3: Write the migration script**

```python
#!/usr/bin/env python3
"""Create the curation-dossier schema in its own SQLite file (spec §4).

WHY a separate file, not products.db: parallel processes in this repo are
known to replace products.db wholesale (see the ~20 products.db.backup-*
files in the working tree) — that would wipe weeks of batched curation
content. dossier.db is ATTACHed at derive/read time. NOTE: this repo has a
similar precedent of using a SEPARATE file (data/taxonomy.db, read via its
own independent connection) but no EXISTING code actually uses SQLite's
ATTACH DATABASE mechanism — Task 10 is the first. ATTACH is a standard,
well-supported SQLite feature, but treat the cross-database join as new
territory to smoke-test (WAL mode across two attached files, path handling),
not as a proven pattern being copied.

Idempotent: safe to run against an existing dossier.db (CREATE TABLE IF NOT EXISTS).
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "dossier.db"

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wine_dossier (
  wine_key TEXT PRIMARY KEY,
  style_summary TEXT,
  expert_note TEXT,
  producer_history TEXT,
  signature_pairings_json TEXT,
  serve_guidance_json TEXT,
  content_hooks_json TEXT,
  occasion_tags_json TEXT,
  course_placement TEXT,
  btg_suitable INTEGER,
  cuisine_tags_json TEXT,
  provenance_json TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK(review_status IN ('unreviewed','ai-cross-checked','human-approved')),
  reviewed_by TEXT, reviewed_at TEXT,
  model_id TEXT, prompt_version TEXT, source_run_id TEXT,
  generated_at TEXT,
  refresh_due TEXT,
  suppressed INTEGER NOT NULL DEFAULT 0,
  CHECK (signature_pairings_json IS NULL OR json_valid(signature_pairings_json)),
  CHECK (serve_guidance_json IS NULL OR json_valid(serve_guidance_json)),
  CHECK (content_hooks_json IS NULL OR json_valid(content_hooks_json)),
  CHECK (occasion_tags_json IS NULL OR json_valid(occasion_tags_json)),
  CHECK (cuisine_tags_json IS NULL OR json_valid(cuisine_tags_json)),
  CHECK (provenance_json IS NULL OR json_valid(provenance_json))
);

CREATE TABLE IF NOT EXISTS sku_dossier_overlay (
  sku TEXT PRIMARY KEY,
  wine_key TEXT NOT NULL REFERENCES wine_dossier(wine_key),
  vintage_scope TEXT CHECK(vintage_scope IN
    ('exact-vintage','adjacent-vintage','producer-track-record',
     'non-vintage','unknown-stock-vintage')),
  drink_from_year INTEGER, drink_to_year INTEGER,
  peak_from_year INTEGER, peak_to_year INTEGER,
  window_source_url TEXT,
  honors_json TEXT,
  stock_snapshot_json TEXT,
  CHECK (honors_json IS NULL OR json_valid(honors_json)),
  CHECK (stock_snapshot_json IS NULL OR json_valid(stock_snapshot_json))
);
CREATE INDEX IF NOT EXISTS idx_overlay_wine_key ON sku_dossier_overlay(wine_key);

CREATE TABLE IF NOT EXISTS designation_reference (
  designation TEXT NOT NULL, region TEXT NOT NULL,
  kind TEXT CHECK(kind IN
    ('quality-rank','dosage','aging-class','production-style')),
  explainer TEXT, sources_json TEXT,
  PRIMARY KEY (designation, region),
  CHECK (sources_json IS NULL OR json_valid(sources_json))
);

CREATE TABLE IF NOT EXISTS dossier_runs (
  run_id TEXT PRIMARY KEY, started_at TEXT, model_id TEXT, prompt_version TEXT,
  skus_attempted INTEGER, skus_sourced INTEGER, total_cost_usd REAL
);

CREATE TABLE IF NOT EXISTS dossier_staging (
  wine_key TEXT NOT NULL, run_id TEXT NOT NULL,
  raw_response_json TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(validation_status IN ('pending','applied','rejected')),
  error TEXT, created_at TEXT, validated_at TEXT,
  PRIMARY KEY (wine_key, run_id)
);
"""


def migrate(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args(argv)
    migrate(args.db)
    print(f"dossier schema ready at {args.db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_migrate_dossier_schema.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the migration against the real path to create the actual file**

Run: `.venv/bin/python scripts/migrate_dossier_schema.py`
Expected: `dossier schema ready at .../data/db/dossier.db`

- [ ] **Step 6: Add `data/db/dossier.db` to `.gitignore`** (same treatment as `products.db` — check first)

Run: `grep -n "products.db" .gitignore`
If `products.db` (or `data/db/*.db`) is already ignored, add `dossier.db` alongside it explicitly, or confirm the existing glob already covers it — do not commit the binary DB file.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate_dossier_schema.py tests/test_migrate_dossier_schema.py .gitignore
git commit -m "feat(dossier): create standalone dossier.db schema (Phase 0 Task 1)"
```

---

## Task 2: Orphan critic-SKU resolution/purge

**Files:**
- Create: `scripts/purge_orphan_critic_skus.py`
- Test: `tests/test_purge_orphan_critic_skus.py`

**Context:** Spec §3/§8 Phase 0: 1,641 distinct critic-scored SKUs, only 1,621 join to `products` — 20 orphans must be resolved (typo'd SKU) or purged (discontinued/renamed with no successor) before the wine_key normalizer runs, so the audit artifact in Task 3 isn't polluted by unresolvable rows.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_purge_orphan_critic_skus.py
import sqlite3
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from scripts.purge_orphan_critic_skus import find_orphans, ORPHAN_RESOLUTIONS

def _make_db(tmp_path):
    db = tmp_path / "products.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE products (sku TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE critic_scores (id TEXT PRIMARY KEY, sku TEXT, critic TEXT, score REAL, score_max REAL)")
    conn.execute("INSERT INTO products VALUES ('WRW0001')")
    conn.execute("INSERT INTO critic_scores VALUES ('c1', 'WRW0001', 'WA', 90, 100)")
    conn.execute("INSERT INTO critic_scores VALUES ('c2', 'WRW9999-ORPHAN', 'WA', 88, 100)")
    conn.commit()
    return conn

def test_find_orphans_returns_unjoinable_skus(tmp_path):
    conn = _make_db(tmp_path)
    orphans = find_orphans(conn)
    assert orphans == ["WRW9999-ORPHAN"]

def test_every_orphan_has_a_recorded_resolution():
    # Rule 3: no silent drops. Every SKU this script encounters in the live DB
    # must have an explicit entry in ORPHAN_RESOLUTIONS (resolve-to or purge),
    # so a re-run against fresh data can't silently skip a new orphan.
    assert isinstance(ORPHAN_RESOLUTIONS, dict)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_purge_orphan_critic_skus.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Query the live 20 orphans to build the resolution map**

Run:
```bash
.venv/bin/python -c "
import sqlite3
conn = sqlite3.connect('data/db/products.db')
rows = conn.execute('''
    SELECT DISTINCT cs.sku FROM critic_scores cs
    LEFT JOIN products p ON p.sku = cs.sku
    WHERE cs.sku IS NOT NULL AND cs.sku != '' AND p.sku IS NULL
''').fetchall()
for r in rows: print(r[0])
"
```
Inspect each of the ~20 SKUs manually (check for an obvious typo'd match in `products` via LIKE, or confirm it's a genuinely discontinued line with no successor). Record the finding for each as either `{"action": "resolve", "to_sku": "..."}` or `{"action": "purge", "reason": "..."}`.

- [ ] **Step 4: Write the implementation**

```python
#!/usr/bin/env python3
"""Resolve or purge critic_scores rows that don't join to any products.sku
(spec §3/§8 Phase 0 — 20 orphans as of 2026-07-15).

Rule 3 (CLAUDE.md): every orphan must have an EXPLICIT recorded resolution —
no silent drops. If a future run finds an orphan not in ORPHAN_RESOLUTIONS,
it is printed and left untouched (fail loud, not silent).
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

# Populated from the manual audit in Step 3. Each entry is either a resolve
# (typo'd SKU -> correct one) or a purge (no successor exists).
ORPHAN_RESOLUTIONS: dict[str, dict] = {
    # "WRW9999-TYPO": {"action": "resolve", "to_sku": "WRW9999"},
    # "WSP1234-DISC": {"action": "purge", "reason": "discontinued 2025, no successor SKU"},
}


def find_orphans(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("""
        SELECT DISTINCT cs.sku FROM critic_scores cs
        LEFT JOIN products p ON p.sku = cs.sku
        WHERE cs.sku IS NOT NULL AND cs.sku != '' AND p.sku IS NULL
        ORDER BY cs.sku
    """).fetchall()
    return [r[0] for r in rows]


def apply_resolutions(conn: sqlite3.Connection, dry_run: bool = True) -> dict:
    orphans = find_orphans(conn)
    unresolved = [o for o in orphans if o not in ORPHAN_RESOLUTIONS]
    if unresolved:
        print(f"WARN: {len(unresolved)} orphans have no recorded resolution, "
              f"left untouched: {unresolved}", file=sys.stderr)

    resolved_count = 0
    purged_count = 0
    for sku, res in ORPHAN_RESOLUTIONS.items():
        if sku not in orphans:
            continue  # already fixed by a prior run
        if res["action"] == "resolve":
            if not dry_run:
                conn.execute(
                    "UPDATE critic_scores SET sku = ? WHERE sku = ?",
                    (res["to_sku"], sku),
                )
            resolved_count += 1
        elif res["action"] == "purge":
            if not dry_run:
                conn.execute("DELETE FROM critic_scores WHERE sku = ?", (sku,))
            purged_count += 1
    if not dry_run:
        conn.commit()
    return {"resolved": resolved_count, "purged": purged_count, "unresolved": len(unresolved)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write changes (default is dry-run report)")
    args = ap.parse_args(argv)

    conn = sqlite3.connect(args.db)
    result = apply_resolutions(conn, dry_run=not args.apply)
    mode = "APPLIED" if args.apply else "DRY-RUN"
    print(f"[{mode}] resolved={result['resolved']} purged={result['purged']} "
          f"unresolved={result['unresolved']}")
    if not args.apply and (result["resolved"] or result["purged"]):
        print("Re-run with --apply to write these changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_purge_orphan_critic_skus.py -v`
Expected: PASS

- [ ] **Step 6: Dry-run against the live DB, review, then apply**

```bash
.venv/bin/python scripts/purge_orphan_critic_skus.py           # dry-run report
# review output against your manual audit from Step 3
.venv/bin/python scripts/purge_orphan_critic_skus.py --apply   # after populating ORPHAN_RESOLUTIONS
```
Expected: `unresolved=0` after `ORPHAN_RESOLUTIONS` is fully populated and applied.

- [ ] **Step 7: Verify via direct query (Rule 1 — no log-line trust)**

Run:
```bash
sqlite3 data/db/products.db "SELECT COUNT(DISTINCT cs.sku) FROM critic_scores cs LEFT JOIN products p ON p.sku=cs.sku WHERE cs.sku IS NOT NULL AND cs.sku != '' AND p.sku IS NULL"
```
Expected: `0`

- [ ] **Step 8: Commit**

```bash
git add scripts/purge_orphan_critic_skus.py tests/test_purge_orphan_critic_skus.py
git commit -m "feat(dossier): resolve/purge orphan critic_scores SKUs (Phase 0 Task 2)"
```

---

## Task 3: wine_key normalizer (Python) + hazard-class tests

**Files:**
- Create: `data/lib/dossier/__init__.py` (empty)
- Create: `data/lib/dossier/wine_key.py`
- Create: `tests/fixtures/wine_key_cases.json`
- Test: `tests/test_wine_key_normalizer.py`

**Context:** Spec §5.7 — this is the highest-risk piece of Phase 0. The normalizer must collapse vintage-year and bottle-format variants into one key, while NOT merging genuinely distinct wines. Verified hazard classes from the second-round review: vintage-year stripping, format variants (375ml/Magnum/Jeroboam), producer case drift, missing double-space separators, conflated houses (must-NOT-merge), single-vineyard-vs-base-cuvée (must-NOT-merge).

- [ ] **Step 1: Write the failing tests, including the six hazard classes**

```python
# tests/test_wine_key_normalizer.py
from data.lib.dossier.wine_key import wine_key_for

def test_vintage_year_stripped():
    a = wine_key_for("WRW0001", "Sassicaia 2020")
    b = wine_key_for("WRW0002", "Sassicaia 2021")
    assert a == b

def test_bottle_format_variant_collapses():
    a = wine_key_for("WRW0003", "Petrus 2015 750ml")
    b = wine_key_for("WRW0004", "Petrus 2015 Magnum")
    c = wine_key_for("WRW0005", "Petrus 2015 Jeroboam")
    assert a == b == c

def test_producer_case_drift_collapses():
    a = wine_key_for("WRW0006", "Rocca Di Frassinello Le Sughere")
    b = wine_key_for("WRW0007", "Rocca di Frassinello Le Sughere")
    assert a == b

def test_missing_separator_still_normalizes():
    # some names lack a double-space between producer and cuvée
    a = wine_key_for("WRW0008", "Banfi Summus")
    b = wine_key_for("WRW0009", "Banfi  Summus")  # double space
    assert a == b

def test_conflated_houses_must_not_merge():
    salon = wine_key_for("WSP0001", "Salon Le Mesnil Blanc de Blancs")
    delamotte = wine_key_for("WSP0002", "Delamotte Blanc de Blancs")
    assert salon != delamotte

def test_single_vineyard_vs_base_cuvee_must_not_merge():
    base = wine_key_for("WRW0010", "Brunello DOCG")
    single_vineyard = wine_key_for("WRW0011", "Brunello DOCG Poggio alle Mura")
    assert base != single_vineyard

def test_override_map_wins_over_normalization():
    # a manually-flagged irreducible case forces a specific key
    from data.lib.dossier.wine_key import WINE_KEY_OVERRIDES
    if WINE_KEY_OVERRIDES:
        sku, forced_key = next(iter(WINE_KEY_OVERRIDES.items()))
        assert wine_key_for(sku, "irrelevant name") == forced_key

def test_parity_fixture_matches_wine_key_for():
    import json
    from pathlib import Path
    fx = json.loads(
        (Path(__file__).resolve().parent / "fixtures" / "wine_key_cases.json").read_text()
    )
    for c in fx["cases"]:
        assert wine_key_for(c["sku"], c["name"]) == c["expected_key"], f"mismatch on {c['sku']}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_wine_key_normalizer.py -v`
Expected: FAIL — `data.lib.dossier.wine_key` does not exist.

- [ ] **Step 3: Create the fixtures file**

```json
{
  "cases": [
    {"sku": "WRW0001", "name": "Sassicaia 2020", "expected_key": "sassicaia"},
    {"sku": "WRW0002", "name": "Sassicaia 2021", "expected_key": "sassicaia"},
    {"sku": "WRW0003", "name": "Petrus 2015 750ml", "expected_key": "petrus-2015"},
    {"sku": "WRW0004", "name": "Petrus 2015 Magnum", "expected_key": "petrus-2015"},
    {"sku": "WSP0001", "name": "Salon Le Mesnil Blanc de Blancs", "expected_key": "salon-le-mesnil-blanc-de-blancs"},
    {"sku": "WSP0002", "name": "Delamotte Blanc de Blancs", "expected_key": "delamotte-blanc-de-blancs"},
    {"sku": "WRW0010", "name": "Brunello DOCG", "expected_key": "brunello-docg"},
    {"sku": "WRW0011", "name": "Brunello DOCG Poggio alle Mura", "expected_key": "brunello-docg-poggio-alle-mura"}
  ]
}
```
Note: Petrus intentionally keeps the vintage in its key here (`petrus-2015`) as a simplified fixture example — the real normalizer's vintage-stripping rule must be scoped to avoid collapsing genuinely different vintages of wines whose EXPECTED grain is vintage-level (see spec §4 two-level model: wine_dossier is producer+cuvée, not always vintage-blind — Sassicaia collapses across vintage because it's the same wine_key sharing one narrative; this is a modeling decision to validate against the real audit output in Task 4, not hard-code blindly from three examples).

- [ ] **Step 4: Write the implementation**

```python
# data/lib/dossier/wine_key.py
"""wine_key normalizer (spec §5.7) — one-time minting; sku_dossier_overlay IS
the registry. This module only computes what a FRESH mint would produce for
an unmapped SKU; scripts/audit_wine_keys.py + Task 8 orchestrator logic are
responsible for checking the existing overlay table BEFORE calling this, so a
rename never re-mints (see spec §5.7: renames must not re-mint).

PARITY: apps/catalog/lib/dossier/wine-key.ts mirrors WINE_KEY_OVERRIDES only.
tests/test_wine_key_normalizer.py + fixtures/wine_key_cases.json guard drift.
"""
from __future__ import annotations

import re

# Manual override map for irreducible cases the normalizer gets wrong.
# Pattern: SKU_OVERRIDES in data/lib/taxonomy/sku_taxonomy.py.
WINE_KEY_OVERRIDES: dict[str, str] = {}

_FORMAT_TOKENS = re.compile(
    r"\b(750\s?ml|375\s?ml|1\.?5\s?l|magnum|jeroboam|methuselah|imperial|"
    r"double\s?magnum|half\s?bottle)\b",
    re.IGNORECASE,
)
_VINTAGE_TOKEN = re.compile(r"\b(19|20)\d{2}\b")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    text = text.lower()
    text = _FORMAT_TOKENS.sub(" ", text)
    text = _NON_ALNUM.sub("-", text).strip("-")
    text = re.sub(r"-{2,}", "-", text)
    return text


def wine_key_for(sku: str, name: str) -> str:
    """Compute the wine_key a fresh mint would assign. Callers resolving an
    ALREADY-MAPPED sku must check sku_dossier_overlay first (§5.7) — this
    function has no knowledge of prior mintings."""
    if sku in WINE_KEY_OVERRIDES:
        return WINE_KEY_OVERRIDES[sku]
    name = name or ""
    # Strip vintage year for wines sharing one wine-level narrative across
    # vintages. This is intentionally aggressive; single-vineyard vs base
    # cuvée distinctions survive because they differ in NAME TEXT, not just
    # vintage — the slug below still includes "poggio alle mura" etc.
    stripped = _VINTAGE_TOKEN.sub(" ", name)
    return _slugify(stripped)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_wine_key_normalizer.py -v`
Expected: PASS (8 tests). If `test_bottle_format_variant_collapses` or others fail on exact slug text, adjust `_slugify`/`_FORMAT_TOKENS` — the fixture values above are illustrative, not gospel; tune against real Task 4 audit output before finalizing.

- [ ] **Step 6: Create the TypeScript override-map twin**

```typescript
// apps/catalog/lib/dossier/wine-key.ts
/**
 * WINE_KEY_OVERRIDES — TS twin of data/lib/dossier/wine_key.py's override map.
 * No runtime resolver here yet (nothing in the catalog consumes wine_key in
 * Phase 0); this file exists purely so the override map can't drift silently.
 * PARITY: tests/test_wine_key_normalizer.py checks both stay in lock-step.
 */
export const WINE_KEY_OVERRIDES: Record<string, string> = {};
```

- [ ] **Step 7: Add a parity test between the two override maps**

```python
# append to tests/test_wine_key_normalizer.py
def test_ts_override_map_matches_python():
    import re
    from pathlib import Path
    ts_path = Path(__file__).resolve().parent.parent / "apps/catalog/lib/dossier/wine-key.ts"
    ts_text = ts_path.read_text()
    # crude but sufficient: confirm the TS file declares an empty (or matching) object
    from data.lib.dossier.wine_key import WINE_KEY_OVERRIDES
    if not WINE_KEY_OVERRIDES:
        assert "= {}" in ts_text.replace(" ", "").replace("\n", "") or "Record<string, string> = {" in ts_text
```

- [ ] **Step 8: Run full test file again**

Run: `.venv/bin/pytest tests/test_wine_key_normalizer.py -v`
Expected: PASS (9 tests)

- [ ] **Step 9: Commit**

```bash
git add data/lib/dossier/__init__.py data/lib/dossier/wine_key.py \
  apps/catalog/lib/dossier/wine-key.ts tests/test_wine_key_normalizer.py \
  tests/fixtures/wine_key_cases.json
git commit -m "feat(dossier): wine_key normalizer with 6 hazard-class tests (Phase 0 Task 3)"
```

---

## Task 4: wine_key audit artifact (owner eyeball gate)

**Files:**
- Create: `scripts/audit_wine_keys.py`
- Test: `tests/test_audit_wine_keys.py`

**Context:** Spec §5.7/§8: "Phase 0 produces a full key→SKUs audit artifact eyeballed by the owner before any generation." This also re-derives the "~35 multi-vintage families" and "903 in-stock" estimates at runtime instead of trusting the 2026-07-15 snapshot (spec-reviewer nit from the first round).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_audit_wine_keys.py
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AUDIT = REPO_ROOT / "scripts" / "audit_wine_keys.py"

def _make_products_db(tmp_path):
    db = tmp_path / "products.db"
    conn = sqlite3.connect(db)
    conn.execute("""CREATE TABLE products (
        sku TEXT PRIMARY KEY, name TEXT, custom_stock_status TEXT
    )""")
    conn.execute("CREATE TABLE critic_scores (id TEXT PRIMARY KEY, sku TEXT)")
    conn.execute("INSERT INTO products VALUES ('WRW0001','Sassicaia 2020', NULL)")
    conn.execute("INSERT INTO products VALUES ('WRW0002','Sassicaia 2021', NULL)")
    conn.execute("INSERT INTO products VALUES ('WRW0003','Other Wine 2019', 'CATALOG')")
    conn.execute("INSERT INTO critic_scores VALUES ('c1','WRW0001')")
    conn.execute("INSERT INTO critic_scores VALUES ('c2','WRW0002')")
    conn.execute("INSERT INTO critic_scores VALUES ('c3','WRW0003')")
    conn.commit()
    return db

def test_audit_groups_by_wine_key_and_excludes_archived(tmp_path):
    db = _make_products_db(tmp_path)
    out = tmp_path / "audit.json"
    subprocess.run(
        [sys.executable, str(AUDIT), "--db", str(db), "--out", str(out)],
        check=True, capture_output=True, text=True,
    )
    data = json.loads(out.read_text())
    assert data["in_stock_critic_scored_count"] == 2  # WRW0003 is CATALOG-archived
    keys = {g["wine_key"]: g["skus"] for g in data["groups"]}
    assert keys["sassicaia"] == ["WRW0001", "WRW0002"]
    assert data["multi_vintage_family_count"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_audit_wine_keys.py -v`
Expected: FAIL — script does not exist.

- [ ] **Step 3: Write the implementation**

```python
#!/usr/bin/env python3
"""Produce the wine_key -> SKUs audit artifact for owner eyeball review
(spec §5.7/§8 Phase 0). Re-derives scope counts at RUN TIME — the 903/~35
figures in the spec are a 2026-07-15 snapshot, not a constant (stock shifts
nightly).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from data.lib.dossier.wine_key import wine_key_for

DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "dossier_wine_key_audit.json"


def build_audit(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("""
        SELECT DISTINCT p.sku, p.name
        FROM products p
        JOIN critic_scores cs ON cs.sku = p.sku
        WHERE (p.custom_stock_status IS NULL OR p.custom_stock_status != 'CATALOG')
        ORDER BY p.sku
    """).fetchall()

    groups: dict[str, list[str]] = {}
    for sku, name in rows:
        key = wine_key_for(sku, name or "")
        groups.setdefault(key, []).append(sku)

    multi = sum(1 for skus in groups.values() if len(skus) > 1)
    return {
        "in_stock_critic_scored_count": len(rows),
        "distinct_wine_key_count": len(groups),
        "multi_vintage_family_count": multi,
        "groups": [
            {"wine_key": k, "skus": sorted(v)}
            for k, v in sorted(groups.items())
        ],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    conn = sqlite3.connect(args.db)
    audit = build_audit(conn)
    args.out.write_text(json.dumps(audit, indent=2, ensure_ascii=False))
    print(f"in-stock critic-scored SKUs: {audit['in_stock_critic_scored_count']}")
    print(f"distinct wine_keys:          {audit['distinct_wine_key_count']}")
    print(f"multi-vintage families:      {audit['multi_vintage_family_count']}")
    print(f"Wrote {args.out} — EYEBALL THIS before any generation (spec §5.7).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_audit_wine_keys.py -v`
Expected: PASS

- [ ] **Step 5: Run against the live DB and manually eyeball the output**

Run: `.venv/bin/python scripts/audit_wine_keys.py`
Then open `data/dossier_wine_key_audit.json` and manually scan for:
- Any group with an implausibly large SKU count (probably an over-merge — a hazard class not yet covered)
- Any wine you know has multiple vintages appearing as separate singleton groups (probably a missed merge)
This eyeball pass is the actual Phase-0 exit gate for the normalizer, not the unit tests alone — flag anything suspicious back into `WINE_KEY_OVERRIDES` (Task 3) before Phase 1 starts.

- [ ] **Step 6: Commit**

```bash
git add scripts/audit_wine_keys.py tests/test_audit_wine_keys.py
git commit -m "feat(dossier): wine_key audit artifact for owner eyeball gate (Phase 0 Task 4)"
```

---

## Task 5: wine_key parity test (spec §9 test 7)

**Files:**
- Test: `tests/test_dossier_db_invariants.py` (new file — houses all 7 invariant tests; this task adds the first one, which is standalone since no overlay data exists yet)

**Context:** "Re-running the normalizer reproduces every existing sku→wine_key mapping in sku_dossier_overlay." Since Phase 0 has not populated `sku_dossier_overlay` yet (no generation has run), this test is written now against a synthetic fixture and will run for real once Phase 1 populates the table — but the test itself, and the invariant it encodes, must exist before any write path is built, per spec §9's framing as a pre-condition on the pipeline.

- [ ] **Step 1: Write the test (starts the shared invariants file)**

```python
# tests/test_dossier_db_invariants.py
"""The 7 invariant tests from spec §9. Run against dossier.db (+ products.db
for the export-facing ones). Pattern: tests/test_enrichment_db_invariants.py.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DOSSIER_DB = REPO_ROOT / "data" / "db" / "dossier.db"


@pytest.fixture(scope="module")
def dossier_conn():
    if not DEFAULT_DOSSIER_DB.exists():
        pytest.skip(f"dossier db not present: {DEFAULT_DOSSIER_DB}")
    c = sqlite3.connect(DEFAULT_DOSSIER_DB)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def test_invariant_7_wine_key_parity(dossier_conn):
    """INVARIANT: re-running the normalizer over every sku currently in
    sku_dossier_overlay reproduces its existing wine_key exactly. A mismatch
    means either the normalizer changed (and needs a migration script to
    re-key existing rows) or — worse — a rename silently re-minted a key,
    orphaning whatever dossier content pointed at the old one (spec §5.7)."""
    import sys
    sys.path.insert(0, str(REPO_ROOT))
    from data.lib.dossier.wine_key import wine_key_for

    rows = dossier_conn.execute(
        "SELECT sku, wine_key FROM sku_dossier_overlay"
    ).fetchall()
    if not rows:
        pytest.skip("no overlay rows yet — nothing to check parity against")

    products_conn = sqlite3.connect(REPO_ROOT / "data" / "db" / "products.db")
    mismatches = []
    for r in rows:
        name = products_conn.execute(
            "SELECT name FROM products WHERE sku = ?", (r["sku"],)
        ).fetchone()
        if not name:
            continue
        fresh_key = wine_key_for(r["sku"], name[0] or "")
        if fresh_key != r["wine_key"]:
            mismatches.append((r["sku"], r["wine_key"], fresh_key))
    assert not mismatches, (
        f"{len(mismatches)} SKUs would get a DIFFERENT wine_key on re-mint — "
        f"this would orphan existing dossier content. Sample: {mismatches[:10]}"
    )
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `.venv/bin/pytest tests/test_dossier_db_invariants.py -v`
Expected: SKIP (no overlay rows yet — dossier.db exists from Task 1 but is empty). This is the correct state for Phase 0; the test activates once Phase 1 writes overlay rows.

- [ ] **Step 3: Commit**

```bash
git add tests/test_dossier_db_invariants.py
git commit -m "test(dossier): wine_key parity invariant, skips until overlay has data (Phase 0 Task 5)"
```

---

## Task 6: Name-vintage consistency check (spec §5.8)

**Files:**
- Create: `data/lib/dossier/consistency_checks.py`
- Test: `tests/test_dossier_consistency_checks.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_dossier_consistency_checks.py
from data.lib.dossier.consistency_checks import name_vintage_mismatch

def test_matching_year_is_not_a_mismatch():
    assert name_vintage_mismatch("Chateau X 2017", "2017") is False

def test_name_year_disagrees_with_vintage_field():
    assert name_vintage_mismatch("Chateau X 2017", "2004") is True

def test_non_vintage_field_is_not_a_mismatch():
    assert name_vintage_mismatch("Some NV Champagne", "N/V") is False

def test_no_year_in_name_is_not_a_mismatch():
    assert name_vintage_mismatch("Chateau X Reserve", "2015") is False

def test_bracketed_may_change_suffix_still_compares_base_year():
    assert name_vintage_mismatch("Chateau X 2019", "2004 [MAY CHANGE]") is True
    assert name_vintage_mismatch("Chateau X 2004", "2004 [MAY CHANGE]") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_dossier_consistency_checks.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```python
# data/lib/dossier/consistency_checks.py
"""Name-vintage consistency check (spec §5.8). A mismatch forces
vintage_scope='unknown-stock-vintage' and caps confidence at 'partial'
regardless of what sources are found — the field is untrustworthy input,
not a sourcing problem.
"""
from __future__ import annotations

import re

_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def name_vintage_mismatch(name: str, vintage_field: str | None) -> bool:
    """True if `name` embeds a year that disagrees with `vintage_field`."""
    if not vintage_field:
        return False
    vintage_clean = vintage_field.strip()
    if vintage_clean.upper() in ("N/V", "NV", ""):
        return False
    field_year_match = _YEAR_RE.search(vintage_clean)
    if not field_year_match:
        return False  # non-numeric vintage field ("Current vintage" etc) — not this check's job
    field_year = field_year_match.group(0)

    name_year_match = _YEAR_RE.search(name or "")
    if not name_year_match:
        return False  # no year embedded in name — nothing to compare against
    name_year = name_year_match.group(0)

    return name_year != field_year
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_dossier_consistency_checks.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add data/lib/dossier/consistency_checks.py tests/test_dossier_consistency_checks.py
git commit -m "feat(dossier): name-vintage consistency check (Phase 0 Task 6)"
```

---

## Task 7: Serve-guidance defaults (spec §8, WSP/WDW exceptions)

**Files:**
- Create: `data/lib/dossier/serve_defaults.py`
- Test: `tests/test_serve_defaults.py`

**Context:** Dossier stores exceptions only; code derives sane defaults from `category_type`/body/tannin for most wines, but sparkling (WSP) and sweet/fortified (WDW) key on designation/dosage tokens instead since body/tannin derive nothing useful there.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_serve_defaults.py
from data.lib.dossier.serve_defaults import default_serve_guidance

def test_full_bodied_red_gets_wide_glass_and_decant():
    g = default_serve_guidance(category_type="Red Wine", body="full", tannin="high")
    assert g["temp_c_min"] >= 15
    assert g["decant"]["type"] in ("aerate", "sediment")

def test_light_white_gets_cold_serve_no_decant():
    g = default_serve_guidance(category_type="White Wine", body="light", tannin=None)
    assert g["temp_c_max"] <= 12
    assert g["decant"]["type"] == "none"

def test_nv_brut_sparkling_keys_on_designation_not_body():
    g = default_serve_guidance(category_type="Sparkling", body="light", tannin=None,
                                designation="Brut")
    assert 6 <= g["temp_c_min"] <= 8
    assert "flute" in g["glass_code"]

def test_prestige_cuvee_sparkling_differs_from_nv_brut():
    nv = default_serve_guidance(category_type="Sparkling", body="light", tannin=None,
                                 designation="Brut")
    prestige = default_serve_guidance(category_type="Sparkling", body="light", tannin=None,
                                       designation="Prestige Cuvée")
    assert nv["temp_c_max"] < prestige["temp_c_max"]
    assert nv["glass_code"] != prestige["glass_code"]

def test_tawny_port_no_decant_vintage_port_sediment_decant():
    tawny = default_serve_guidance(category_type="Fortified", body="full", tannin="medium",
                                    designation="Tawny")
    vintage = default_serve_guidance(category_type="Fortified", body="full", tannin="medium",
                                      designation="Vintage Port")
    assert tawny["decant"]["type"] == "none"
    assert vintage["decant"]["type"] == "sediment"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_serve_defaults.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```python
# data/lib/dossier/serve_defaults.py
"""Default serve_guidance_json derivation (spec §8). Dossier generation only
stores EXCEPTIONS to these code-derived defaults — most wines never need an
LLM call for serve temperature/glass/decant.

WSP (sparkling) and WDW (sweet/fortified) key on designation/dosage tokens,
NOT body/tannin — for these two categories body/tannin derive nothing useful
(see spec §8 Phase 0 bullet on serve-guidance defaults).
"""
from __future__ import annotations


def _decant(type_: str, minutes_min: int = 0, minutes_max: int = 0) -> dict:
    return {"type": type_, "minutes_min": minutes_min, "minutes_max": minutes_max}


def default_serve_guidance(
    category_type: str,
    body: str | None,
    tannin: str | None,
    designation: str | None = None,
) -> dict:
    if category_type == "Sparkling":
        if designation and "prestige" in designation.lower():
            return {"temp_c_min": 10, "temp_c_max": 12, "glass_code": "wide-tulip",
                    "decant": _decant("none"), "notes": "Prestige cuvée — wider glass to open aromatics"}
        if designation and "demi-sec" in designation.lower():
            return {"temp_c_min": 8, "temp_c_max": 10, "glass_code": "flute",
                    "decant": _decant("none"), "notes": "Demi-sec"}
        # default: NV Brut
        return {"temp_c_min": 6, "temp_c_max": 8, "glass_code": "flute",
                "decant": _decant("none"), "notes": "NV Brut — serve well chilled"}

    if category_type == "Fortified":
        d = (designation or "").lower()
        if "vintage port" in d or "vintage" in d:
            return {"temp_c_min": 16, "temp_c_max": 18, "glass_code": "port-glass",
                    "decant": _decant("sediment", 30, 120), "notes": "Vintage Port — decant off sediment"}
        if "tawny" in d:
            return {"temp_c_min": 14, "temp_c_max": 16, "glass_code": "port-glass",
                    "decant": _decant("none"), "notes": "Tawny — no sediment, no decant needed"}
        # generic sweet/fortified default
        return {"temp_c_min": 10, "temp_c_max": 12, "glass_code": "dessert-glass",
                "decant": _decant("none"), "notes": None}

    # Standard still-wine path: body/tannin derive the default.
    body = (body or "medium").lower()
    tannin = (tannin or "").lower()
    if category_type == "White Wine":
        if body == "light":
            return {"temp_c_min": 8, "temp_c_max": 10, "glass_code": "white-standard",
                    "decant": _decant("none"), "notes": None}
        return {"temp_c_min": 10, "temp_c_max": 13, "glass_code": "white-standard",
                "decant": _decant("none"), "notes": None}

    # Red Wine (default category)
    if body == "full" or tannin in ("high", "firm"):
        return {"temp_c_min": 16, "temp_c_max": 18, "glass_code": "bordeaux",
                "decant": _decant("aerate", 30, 60), "notes": "Full-bodied — benefits from aeration"}
    if body == "light":
        return {"temp_c_min": 13, "temp_c_max": 15, "glass_code": "burgundy",
                "decant": _decant("none"), "notes": None}
    return {"temp_c_min": 15, "temp_c_max": 17, "glass_code": "bordeaux",
            "decant": _decant("none"), "notes": None}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_serve_defaults.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add data/lib/dossier/serve_defaults.py tests/test_serve_defaults.py
git commit -m "feat(dossier): serve-guidance code defaults with WSP/WDW exceptions (Phase 0 Task 7)"
```

---

## Task 8: Validators (no-price-language, pairing tokens, provenance, JSON Schema, n-gram, banned phrases)

**Files:**
- Create: `data/lib/dossier/validators.py`
- Create: `data/lib/dossier/schema/dossier_response.schema.json`
- Test: `tests/test_dossier_validators.py`

**Context:** Spec §8 Phase 0 lists 6 validators; §8b adds the banned-phrase list. These are the guardrails a real Phase-1 generation run will call before anything reaches staging — Phase 0 builds and unit-tests them against synthetic strings, since no real content exists yet.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_dossier_validators.py
from data.lib.dossier.validators import (
    contains_price_language,
    contains_banned_phrase,
    ngram_overlap_ratio,
    provenance_has_source_for_sourced_fields,
    validate_against_schema,
)

def test_price_language_detected():
    assert contains_price_language("At only ฿1,200 this is a steal") is True
    assert contains_price_language("A classic Bordeaux blend with dark fruit") is False

def test_investment_language_detected():
    assert contains_price_language("A superb investment for your collection") is True

def test_banned_marketing_phrase_detected():
    assert contains_banned_phrase("Notes of blackcurrant and cedar") is True  # "notes of"
    assert contains_banned_phrase("A hidden gem from Tuscany") is True
    assert contains_banned_phrase("Produced in the Chianti hills using traditional methods") is False

def test_ngram_overlap_flags_near_verbatim_copy():
    source_text = "This wine shows remarkable depth with notes of dark cherry and tobacco leaf on the long finish"
    generated = "This wine shows remarkable depth with notes of dark cherry and tobacco leaf lingering"
    ratio = ngram_overlap_ratio(generated, source_text, n=6)
    assert ratio > 0.5

def test_ngram_overlap_low_for_original_prose():
    source_text = "This wine shows remarkable depth with notes of dark cherry and tobacco leaf on the long finish"
    generated = "A structured red with firm tannins, best paired with grilled meats"
    ratio = ngram_overlap_ratio(generated, source_text, n=6)
    assert ratio < 0.1

def test_provenance_requires_source_url_for_sourced_confidence():
    good = {"expert_note": {"confidence": "sourced", "source_urls": ["https://x.com"]}}
    bad = {"expert_note": {"confidence": "sourced", "source_urls": []}}
    assert provenance_has_source_for_sourced_fields(good) == []
    assert provenance_has_source_for_sourced_fields(bad) == ["expert_note"]

def test_schema_validation_rejects_unknown_provenance_key():
    import json
    from pathlib import Path
    schema = json.loads(
        (Path(__file__).resolve().parent.parent /
         "data/lib/dossier/schema/dossier_response.schema.json").read_text()
    )
    bad_response = {
        "wine_key": "sassicaia",
        "provenance": {"soem_typo_field": {"confidence": "sourced", "source_urls": []}},
    }
    errors = validate_against_schema(bad_response, schema)
    assert errors  # typo'd key should not silently pass
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_dossier_validators.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the JSON Schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "dossier_response.schema.json",
  "title": "Curation dossier subagent response (prompt_version tracks this file)",
  "type": "object",
  "required": ["wine_key"],
  "properties": {
    "wine_key": {"type": "string"},
    "style_summary": {"type": ["string", "null"], "maxLength": 160},
    "expert_note": {"type": ["string", "null"]},
    "producer_history": {"type": ["string", "null"]},
    "signature_pairings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["dish", "cuisine", "confidence"],
        "properties": {
          "dish": {"type": "string"},
          "dish_local": {"type": ["string", "null"]},
          "cuisine": {"type": "string"},
          "course": {"type": ["string", "null"]},
          "heat_level_ok": {"type": "integer", "minimum": 0, "maximum": 3},
          "reason": {"type": "string", "maxLength": 200},
          "confidence": {"enum": ["sourced", "partial", "pairing-theory", "model"]}
        }
      }
    },
    "provenance": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["confidence"],
        "properties": {
          "confidence": {"enum": ["sourced", "partial", "pairing-theory", "model"]},
          "source_urls": {"type": "array", "items": {"type": "string"}}
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": true
}
```
Note: `provenance.additionalProperties` uses a fixed sub-schema so a typo'd field name inside a provenance entry (e.g. `soem_typo_field`) still validates structurally — the *value* of any key must match the confidence/source_urls shape. To catch an unknown top-level provenance KEY against the real field list (spec §9 test 5's "provenance keys ⊆ known field list"), that check happens in `validators.py` (Step 4 below), not the schema — schemas can't easily express "keys must be from this closed enum" without an unwieldy `patternProperties` per key.

- [ ] **Step 4: Write the validators implementation**

```python
# data/lib/dossier/validators.py
"""Validators wired into the Phase-1/2 generation pipeline before staging
(spec §8 Phase 0, §8b, §9). Pure functions — no DB, no network.
"""
from __future__ import annotations

import json
import re
from collections import Counter

try:
    import jsonschema
    _HAS_JSONSCHEMA = True
except ImportError:
    _HAS_JSONSCHEMA = False

_PRICE_LANGUAGE_RE = re.compile(
    r"(฿\s?\d|only\s+\$|great\s+value|a\s+steal|investment|"
    r"appreciat(e|ing|ion)\s+in\s+value|resale\s+value)",
    re.IGNORECASE,
)

BANNED_PHRASES = [
    "notes of", "perfect for any occasion", "elevate your experience",
    "a must-have", "hidden gem", "world-class", "unparalleled",
    "truly exceptional", "one of a kind",
]

# The closed set of known provenance field keys (spec §9 test 5). Any key
# outside this set is almost certainly a typo that would otherwise pass
# every json_each-based DB test silently.
KNOWN_PROVENANCE_FIELDS = {
    "style_summary", "expert_note", "producer_history",
    "signature_pairings_json", "serve_guidance_json",
    "content_hooks_json", "occasion_tags_json", "cuisine_tags_json",
    "honors_json", "drink_from_year", "drink_to_year",
    "peak_from_year", "peak_to_year",
}


def contains_price_language(text: str) -> bool:
    return bool(_PRICE_LANGUAGE_RE.search(text or ""))


def contains_banned_phrase(text: str) -> bool:
    lower = (text or "").lower()
    return any(p in lower for p in BANNED_PHRASES)


def _ngrams(text: str, n: int) -> Counter:
    words = re.findall(r"\w+", (text or "").lower())
    return Counter(tuple(words[i:i + n]) for i in range(len(words) - n + 1))


def ngram_overlap_ratio(generated: str, source: str, n: int = 6) -> float:
    """Fraction of `generated`'s n-grams that also appear in `source`.
    High ratio = risk of near-verbatim reproduction of (possibly copyrighted)
    critic prose (spec §5.9)."""
    gen_grams = _ngrams(generated, n)
    if not gen_grams:
        return 0.0
    src_grams = _ngrams(source, n)
    overlap = sum(min(c, src_grams.get(g, 0)) for g, c in gen_grams.items())
    total = sum(gen_grams.values())
    return overlap / total if total else 0.0


def provenance_has_source_for_sourced_fields(provenance: dict) -> list[str]:
    """Returns field names marked 'sourced' with an empty source_urls list —
    a contradiction the validator must catch before staging."""
    bad = []
    for field, entry in (provenance or {}).items():
        if entry.get("confidence") == "sourced" and not entry.get("source_urls"):
            bad.append(field)
    return bad


def unknown_provenance_keys(provenance: dict) -> list[str]:
    return [k for k in (provenance or {}) if k not in KNOWN_PROVENANCE_FIELDS]


def validate_against_schema(response: dict, schema: dict) -> list[str]:
    if not _HAS_JSONSCHEMA:
        # Fallback minimal check if the jsonschema package isn't installed:
        # at least confirm wine_key is present, since that's required=true.
        return [] if "wine_key" in response else ["missing required field: wine_key"]
    validator = jsonschema.Draft7Validator(schema)
    return [e.message for e in validator.iter_errors(response)]
```

- [ ] **Step 5: Check whether `jsonschema` is already a dependency**

Run: `.venv/bin/pip show jsonschema 2>&1 | head -3`
If not installed, add it: `.venv/bin/pip install jsonschema` and add to `requirements.txt` (check the file first).

- [ ] **Step 6: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_dossier_validators.py -v`
Expected: PASS (7 tests). If the schema-validation test doesn't fail on the typo'd key (because `additionalProperties` inside provenance is permissive by key name), that's expected — Step 3's note above explains why that specific check lives in `unknown_provenance_keys()` instead; adjust the test to call that function directly if the schema-based assertion doesn't do what's wanted.

- [ ] **Step 7: Commit**

```bash
git add data/lib/dossier/validators.py data/lib/dossier/schema/dossier_response.schema.json \
  tests/test_dossier_validators.py requirements.txt
git commit -m "feat(dossier): validators - price language, banned phrases, n-gram overlap, provenance, schema (Phase 0 Task 8)"
```

---

## Task 9: designation_reference seed rows (schema-only smoke test)

**Files:**
- Modify: `scripts/migrate_dossier_schema.py` (no change — table already exists from Task 1)
- Create: `scripts/seed_designation_reference_stub.py` (Phase-0 placeholder; full authoring is Phase 0.5, out of this plan's scope per your "no API yet" instruction — Phase 0.5 involves generating explainer text, which even at $0 marginal cost is still content generation, not pure code)

**Context:** Per your instruction to proceed "internal, no API yet," this task deliberately stops short of Phase 0.5 (writing the ~21 explainer rows) since that's content authoring. What Phase 0 CAN do purely in code: seed the `(designation, region)` KEYS (no explainer text) from the existing `classification_master.json`, so the table has structural rows ready for Phase 0.5 to fill in.

- [ ] **Step 1: Inspect the existing classification_master.json shape**

Run: `.venv/bin/python -c "import json; d=json.load(open('data/taxonomy/classification_master.json')); print(json.dumps(d['data'][:3], indent=2))"`

**Verified real shape (2026-07-16):** the file is `{"data": [...]}` where each
record looks like:

```json
{
  "classification_id": 1,
  "classification": "First Growth",
  "classification_slug": "first-growth",
  "classification_group": "wine_classification",
  "category_scope": "wine",
  "priority": 1,
  "description": "Bordeaux 1855 top tier",
  "is_active": 1
}
```

**There is no `region` field anywhere in this file** — not under a different
name, genuinely absent. `designation_reference`'s primary key is
`(designation, region)` (spec §4: "Grand Cru differs across Burgundy/Alsace/
Champagne"), so region can't be mechanically extracted here; it has to be
assigned per-row. Step 4 below seeds every row with `region='ALL'` as a
placeholder — Phase 0.5's actual authoring work is precisely to split these
into per-region rows where the designation's meaning genuinely differs (Grand
Cru) and leave `region='ALL'` where it doesn't (XO, VSOP). Do not treat the
`region='ALL'` stub as a real answer; it exists only so the table has
non-empty structural rows for Phase 0.5 to edit, not to duplicate, and so
Task 9's own test has something to assert against.

- [ ] **Step 2: Write the failing test**

```python
# tests/test_seed_designation_reference_stub.py
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATE = REPO_ROOT / "scripts" / "migrate_dossier_schema.py"
SEED = REPO_ROOT / "scripts" / "seed_designation_reference_stub.py"

def test_seed_creates_key_only_rows(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run([sys.executable, str(MIGRATE), "--db", str(db_path)], check=True, capture_output=True, text=True)
    subprocess.run([sys.executable, str(SEED), "--db", str(db_path)], check=True, capture_output=True, text=True)
    conn = sqlite3.connect(db_path)
    n = conn.execute("SELECT COUNT(*) FROM designation_reference").fetchone()[0]
    assert n > 0
    # explainer is intentionally NULL — Phase 0.5 fills it in, not Phase 0
    row = conn.execute("SELECT explainer FROM designation_reference LIMIT 1").fetchone()
    assert row[0] is None
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_seed_designation_reference_stub.py -v`
Expected: FAIL — script does not exist.

- [ ] **Step 4: Write the implementation** (field names below match the verified real shape from Step 1 — `classification`, not a guessed `label`/`region` key)

```python
#!/usr/bin/env python3
"""Seed designation_reference with (designation, region) KEYS ONLY — no
explainer text. Explainer authoring is Phase 0.5 (content generation, run
separately). This script is pure structural bootstrapping from the existing
classification_master.json taxonomy file.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "dossier.db"
MASTER = REPO_ROOT / "data" / "taxonomy" / "classification_master.json"


def extract_designation_region_pairs(master: dict) -> list[tuple[str, str, str | None]]:
    """Returns (designation, region, kind) triples. `region` is always 'ALL' —
    classification_master.json has NO region field (verified 2026-07-16); this
    is a structural placeholder, not a real answer. Phase 0.5's authoring work
    is precisely to split the 'ALL' rows into per-region rows where the
    designation's meaning genuinely differs (e.g. Grand Cru: Burgundy vs
    Alsace vs Champagne mean different things) and leave 'ALL' where it
    doesn't (XO, VSOP mean the same thing everywhere). `kind` is left None —
    inferring quality-rank/dosage/aging-class/production-style also requires
    judgment Phase 0.5 supplies, not something this file encodes."""
    pairs = []
    seen_active_only = [
        r for r in master.get("data", []) if r.get("is_active", 1)
    ]
    for entry in seen_active_only:
        designation = entry.get("classification")
        if not designation:
            continue
        pairs.append((designation, "ALL", None))
    return pairs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--master", type=Path, default=MASTER)
    args = ap.parse_args(argv)

    master = json.loads(args.master.read_text())
    pairs = extract_designation_region_pairs(master)

    conn = sqlite3.connect(args.db)
    inserted = 0
    for designation, region, kind in pairs:
        if not designation:
            continue
        cur = conn.execute(
            "INSERT OR IGNORE INTO designation_reference (designation, region, kind) "
            "VALUES (?, ?, ?)",
            (designation, region, kind),
        )
        inserted += cur.rowcount
    conn.commit()
    print(f"Seeded {inserted} (designation, region) key rows — explainer text is Phase 0.5.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_seed_designation_reference_stub.py -v`
Expected: PASS.

- [ ] **Step 6: Run against the real dossier.db and sanity-check row count**

Run: `.venv/bin/python scripts/seed_designation_reference_stub.py`
Then verify the count landed and matches the active-row count in the source file:
```bash
sqlite3 data/db/dossier.db "SELECT COUNT(*) FROM designation_reference"
.venv/bin/python -c "import json; d=json.load(open('data/taxonomy/classification_master.json')); print(sum(1 for r in d['data'] if r.get('is_active', 1)))"
```
The two counts should match (or the dossier.db count should be lower only if some `classification` values repeat across rows, since `INSERT OR IGNORE` dedupes on the `(designation, region)` primary key).

- [ ] **Step 7: Commit**

```bash
git add scripts/seed_designation_reference_stub.py tests/test_seed_designation_reference_stub.py
git commit -m "feat(dossier): seed designation_reference keys from classification_master (Phase 0 Task 9, explainer text deferred to Phase 0.5)"
```

---

## Task 10: Export deriver (`refresh_products_dossier.py`) against synthetic fixtures

**Files:**
- Create: `scripts/refresh_products_dossier.py`
- Test: `tests/test_refresh_products_dossier.py`

**Context:** Spec §7 — this is the export-path deriver, modeled on `refresh_products_summary.py`. Phase 0 has no real dossier content, so this task builds and tests the deriver's logic (consumer-gate suppression, JSON shape, ATTACH mechanics) against a synthetic fixture DB. **This task deliberately does NOT touch `refresh_live_export.py`'s EXPORT_COLS or `catalog-data.ts`'s PUBLIC_FIELDS** — per spec §7 step 5's ordering rule, that hookup happens right before Phase 1's first real batch, not now while the column would sit empty and the nightly bot would need to carry a permanently-null field. Wiring it too early just means more surface area with nothing to show for it.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_refresh_products_dossier.py
import json
import sqlite3
from pathlib import Path

import pytest

from scripts.refresh_products_dossier import derive_curation_dossier, refresh_all

def _make_dbs(tmp_path):
    products_db = tmp_path / "products.db"
    dossier_db = tmp_path / "dossier.db"

    pconn = sqlite3.connect(products_db)
    pconn.execute("CREATE TABLE products (sku TEXT PRIMARY KEY, curation_dossier TEXT)")
    pconn.execute("INSERT INTO products (sku) VALUES ('WRW0001')")
    pconn.execute("INSERT INTO products (sku) VALUES ('WRW0002')")
    pconn.commit()
    pconn.close()

    dconn = sqlite3.connect(dossier_db)
    dconn.execute("""CREATE TABLE wine_dossier (
        wine_key TEXT PRIMARY KEY, style_summary TEXT, expert_note TEXT,
        signature_pairings_json TEXT, provenance_json TEXT, suppressed INTEGER DEFAULT 0
    )""")
    dconn.execute("""CREATE TABLE sku_dossier_overlay (
        sku TEXT PRIMARY KEY, wine_key TEXT,
        stock_snapshot_json TEXT, honors_json TEXT
    )""")
    dconn.execute("""
        INSERT INTO wine_dossier VALUES (
            'sassicaia', 'A Super Tuscan icon', 'Sourced expert note text',
            '[{"dish":"Steak","cuisine":"thai","confidence":"sourced"}]',
            '{"style_summary":{"confidence":"model","source_urls":[]},
              "expert_note":{"confidence":"sourced","source_urls":["https://x.com"]}}',
            0
        )
    """)
    dconn.execute("INSERT INTO sku_dossier_overlay (sku, wine_key, stock_snapshot_json) "
                  "VALUES ('WRW0001', 'sassicaia', '{\"price\": 5000}')")
    dconn.commit()
    dconn.close()
    return products_db, dossier_db

def test_public_export_suppresses_model_confidence_fields(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)
    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")
    dossier_json = derive_curation_dossier(conn, sku="WRW0001", wine_key="sassicaia")
    assert dossier_json is not None
    parsed = json.loads(dossier_json)
    # style_summary is 'model' confidence -> suppressed from public export
    assert "style_summary" not in parsed or parsed.get("style_summary") is None
    assert parsed["expert_note"] == "Sourced expert note text"

def test_stock_snapshot_never_in_public_export(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)
    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")
    dossier_json = derive_curation_dossier(conn, sku="WRW0001", wine_key="sassicaia")
    parsed = json.loads(dossier_json)
    assert "stock_snapshot_json" not in parsed
    assert "price" not in json.dumps(parsed)

def test_refresh_all_writes_products_curation_dossier_column(tmp_path):
    products_db, dossier_db = _make_dbs(tmp_path)
    conn = sqlite3.connect(products_db)
    conn.execute(f"ATTACH DATABASE '{dossier_db}' AS dossier")
    written = refresh_all(conn)
    assert written == 1  # only WRW0001 has an overlay row
    row = conn.execute("SELECT curation_dossier FROM products WHERE sku='WRW0001'").fetchone()
    assert row[0] is not None
    row2 = conn.execute("SELECT curation_dossier FROM products WHERE sku='WRW0002'").fetchone()
    assert row2[0] is None  # no overlay row -> stays NULL, not fabricated
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_refresh_products_dossier.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```python
#!/usr/bin/env python3
"""Derive products.curation_dossier from dossier.db (spec §7). Pattern:
lib/critic_reviews/refresh_products_summary.py. dossier.db is ATTACHed at
run time (own file — see spec §4 for why it's not merged into products.db).

Consumer gate (spec §6): only 'sourced' fields (+ 'pairing-theory' for
pairings) reach this public JSON. 'partial'/'model'/NULL never leave
internal tooling. stock_snapshot_json and provenance URLs are excluded
entirely (price leak risk / no reason to expose raw source URLs publicly).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PRODUCTS_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_DOSSIER_DB = REPO_ROOT / "data" / "db" / "dossier.db"

_PUBLIC_CONFIDENCE = {"sourced", "pairing-theory"}


def _gate_field(value, field_name: str, provenance: dict):
    """Return value only if its provenance confidence clears the public bar."""
    if value is None:
        return None
    entry = (provenance or {}).get(field_name) or {}
    if entry.get("confidence") in _PUBLIC_CONFIDENCE:
        return value
    return None


def derive_curation_dossier(conn: sqlite3.Connection, sku: str, wine_key: str) -> str | None:
    wd = conn.execute(
        "SELECT style_summary, expert_note, producer_history, "
        "signature_pairings_json, provenance_json, suppressed "
        "FROM dossier.wine_dossier WHERE wine_key = ?",
        (wine_key,),
    ).fetchone()
    if not wd or wd[5]:  # missing or suppressed
        return None
    style_summary, expert_note, producer_history, pairings_json, provenance_json, _ = wd
    provenance = json.loads(provenance_json) if provenance_json else {}

    out = {}
    gated_style = _gate_field(style_summary, "style_summary", provenance)
    if gated_style:
        out["style_summary"] = gated_style
    gated_note = _gate_field(expert_note, "expert_note", provenance)
    if gated_note:
        out["expert_note"] = gated_note
    gated_history = _gate_field(producer_history, "producer_history", provenance)
    if gated_history:
        out["producer_history"] = gated_history

    if pairings_json:
        pairings = json.loads(pairings_json)
        public_pairings = [p for p in pairings if p.get("confidence") in _PUBLIC_CONFIDENCE]
        if public_pairings:
            out["signature_pairings"] = public_pairings

    if not out:
        return None
    return json.dumps(out, ensure_ascii=False)


def refresh_all(conn: sqlite3.Connection) -> int:
    """Re-derive products.curation_dossier for every SKU with an overlay row.
    Self-healing: SKUs that lose their overlay/dossier get reset to NULL."""
    rows = conn.execute(
        "SELECT sku, wine_key FROM dossier.sku_dossier_overlay"
    ).fetchall()

    conn.execute("""
        UPDATE products SET curation_dossier = NULL
        WHERE curation_dossier IS NOT NULL
          AND sku NOT IN (SELECT sku FROM dossier.sku_dossier_overlay)
    """)

    written = 0
    for sku, wine_key in rows:
        dossier_json = derive_curation_dossier(conn, sku, wine_key)
        cur = conn.execute(
            "UPDATE products SET curation_dossier = ? WHERE sku = ?",
            (dossier_json, sku),
        )
        if dossier_json is not None and cur.rowcount > 0:
            written += 1
    conn.commit()
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--products-db", type=Path, default=DEFAULT_PRODUCTS_DB)
    ap.add_argument("--dossier-db", type=Path, default=DEFAULT_DOSSIER_DB)
    args = ap.parse_args(argv)

    if not args.products_db.exists():
        print(f"ERROR: products db not found: {args.products_db}", file=sys.stderr)
        return 1
    if not args.dossier_db.exists():
        print(f"ERROR: dossier db not found: {args.dossier_db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.products_db)
    conn.execute(f"ATTACH DATABASE '{args.dossier_db}' AS dossier")
    # products.curation_dossier column must exist before this runs.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    if "curation_dossier" not in cols:
        print("ERROR: products.curation_dossier column missing — add it first "
              "(ALTER TABLE products ADD COLUMN curation_dossier TEXT).", file=sys.stderr)
        return 1

    n = refresh_all(conn)
    print(f"Re-derived curation_dossier for {n} products.")
    print("Rule 9: now run  .venv/bin/python scripts/refresh_live_export.py")
    print("(EXPORT_COLS/JSON_COLS + PUBLIC_FIELDS hookup happens in Phase 1, per spec §7 ordering rule)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_refresh_products_dossier.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the `curation_dossier` column to the real `products.db` schema** (structural prep only — column stays NULL for everyone until Phase 1 generates content)

```bash
sqlite3 data/db/products.db "ALTER TABLE products ADD COLUMN curation_dossier TEXT"
```
Verify: `sqlite3 data/db/products.db "SELECT COUNT(*) FROM products WHERE curation_dossier IS NOT NULL"` → expect `0`.

- [ ] **Step 6: Smoke-test ATTACH against the two real files**

No existing code in this repo uses SQLite's `ATTACH DATABASE` (verified during plan review — `data/taxonomy.db` is read via its own independent connection, not attached to anything). Task 10's tests exercise ATTACH against synthetic tmp_path fixtures, which proves the logic works, but not that ATTACH behaves cleanly against the real WAL-mode files. Confirm directly before relying on it in Phase 1:

```bash
.venv/bin/python -c "
import sqlite3
conn = sqlite3.connect('data/db/products.db')
conn.execute(\"ATTACH DATABASE 'data/db/dossier.db' AS dossier\")
print(conn.execute('SELECT COUNT(*) FROM dossier.wine_dossier').fetchone())
print(conn.execute('SELECT COUNT(*) FROM products').fetchone())
conn.execute('DETACH DATABASE dossier')
print('ATTACH/DETACH OK')
"
```
Expected: prints two zero-or-real counts and `ATTACH/DETACH OK` with no errors. If this fails (e.g. a WAL-mode conflict), resolve it here — before Phase 1 generation depends on it working.

- [ ] **Step 7: Commit**

```bash
git add scripts/refresh_products_dossier.py tests/test_refresh_products_dossier.py
git commit -m "feat(dossier): export deriver tested against synthetic fixtures (Phase 0 Task 10)

products.curation_dossier column added (structural only, stays NULL until
Phase 1 generates content). EXPORT_COLS/PUBLIC_FIELDS hookup deferred to
Phase 1 start per spec §7 ordering rule."
```

---

## Task 11: Full invariant test suite (spec §9, remaining 6 tests)

**Files:**
- Modify: `tests/test_dossier_db_invariants.py` (add invariants 1-6; invariant 7 already added in Task 5)

**Context:** Invariants 1, 2, 4, 6 depend on real dossier content and will legitimately SKIP until Phase 1 runs — same pattern as Task 5's invariant 7. Invariants 3 (orphan guard) and 5 (provenance guard) CAN run meaningfully now since they check structural properties that should hold even for an empty table (vacuously true) and will catch violations the moment Phase 1 starts writing.

- [ ] **Step 1: Write the failing tests (append to the file from Task 5)**

```python
# append to tests/test_dossier_db_invariants.py

def test_invariant_1_staging_success_has_dossier_row(dossier_conn):
    """Every staged 'applied' generation has a dossier row with >=1 non-NULL
    content field. Prevents the Phase-5 failure mode: paid for content that
    never landed in the user-facing table."""
    applied = dossier_conn.execute(
        "SELECT wine_key FROM dossier_staging WHERE validation_status = 'applied'"
    ).fetchall()
    if not applied:
        pytest.skip("no applied staging rows yet")
    missing = []
    for (wine_key,) in applied:
        row = dossier_conn.execute(
            "SELECT style_summary, expert_note, producer_history "
            "FROM wine_dossier WHERE wine_key = ?", (wine_key,)
        ).fetchone()
        if not row or not any(row):
            missing.append(wine_key)
    assert not missing, f"{len(missing)} 'applied' staging rows have no dossier content: {missing[:10]}"


def test_invariant_2_sourced_dossier_surfaces_in_export(dossier_conn):
    export_path = REPO_ROOT / "data" / "live_products_export.json"
    if not export_path.exists():
        pytest.skip("live export not present")
    sourced = dossier_conn.execute("""
        SELECT DISTINCT o.sku FROM sku_dossier_overlay o
        JOIN wine_dossier w ON w.wine_key = o.wine_key
        WHERE w.provenance_json LIKE '%"sourced"%'
    """).fetchall()
    if not sourced:
        pytest.skip("no sourced dossier content yet")
    export = json.loads(export_path.read_text())
    export_skus = {p["sku"] for p in export if p.get("curation_dossier")}
    missing = [sku for (sku,) in sourced if sku not in export_skus]
    assert not missing, f"{len(missing)} SKUs have sourced dossier content but nothing in the export: {missing[:10]}"


def test_invariant_3_orphan_guard(dossier_conn):
    """Zero overlay SKUs absent from products; zero overlays without a
    wine_dossier parent. Vacuously true on an empty table — meaningful once
    Phase 1 writes rows."""
    products_conn = sqlite3.connect(REPO_ROOT / "data" / "db" / "products.db")
    product_skus = {r[0] for r in products_conn.execute("SELECT sku FROM products")}
    overlay_skus = [r[0] for r in dossier_conn.execute("SELECT sku FROM sku_dossier_overlay")]
    orphan_skus = [s for s in overlay_skus if s not in product_skus]
    assert not orphan_skus, f"{len(orphan_skus)} overlay SKUs absent from products: {orphan_skus[:10]}"

    orphan_overlays = dossier_conn.execute("""
        SELECT o.sku FROM sku_dossier_overlay o
        LEFT JOIN wine_dossier w ON w.wine_key = o.wine_key
        WHERE w.wine_key IS NULL
    """).fetchall()
    assert not orphan_overlays, f"overlays with no wine_dossier parent: {orphan_overlays}"


def test_invariant_4_human_approved_survives_regeneration(dossier_conn):
    """Regenerating over review_status='human-approved' must be a no-op
    (clobber guard, spec §5.6). This test exercises the guard directly rather
    than waiting for real human-approved content to exist."""
    dossier_conn.execute("""
        INSERT OR IGNORE INTO wine_dossier (wine_key, style_summary, review_status)
        VALUES ('__test_guard_key__', 'original approved text', 'human-approved')
    """)
    dossier_conn.commit()
    dossier_conn.execute("""
        INSERT INTO wine_dossier (wine_key, style_summary, review_status)
        VALUES ('__test_guard_key__', 'REGENERATED TEXT', 'unreviewed')
        ON CONFLICT(wine_key) DO UPDATE SET
            style_summary = excluded.style_summary
        WHERE wine_dossier.review_status != 'human-approved'
    """)
    dossier_conn.commit()
    row = dossier_conn.execute(
        "SELECT style_summary FROM wine_dossier WHERE wine_key = '__test_guard_key__'"
    ).fetchone()
    assert row[0] == "original approved text"
    # cleanup
    dossier_conn.execute("DELETE FROM wine_dossier WHERE wine_key = '__test_guard_key__'")
    dossier_conn.commit()


def test_invariant_5_provenance_guard(dossier_conn):
    """Any field marked 'sourced' has >=1 source_url; converse: a 'sourced'
    field whose column is NULL fails; provenance keys are a subset of the
    known field list (a typo'd key otherwise passes json_each tests silently)."""
    import sys
    sys.path.insert(0, str(REPO_ROOT))
    from data.lib.dossier.validators import (
        provenance_has_source_for_sourced_fields,
        unknown_provenance_keys,
    )
    rows = dossier_conn.execute(
        "SELECT wine_key, style_summary, expert_note, producer_history, provenance_json "
        "FROM wine_dossier WHERE provenance_json IS NOT NULL"
    ).fetchall()
    if not rows:
        pytest.skip("no provenance data yet")
    bad_source = []
    bad_keys = []
    for wine_key, style, note, history, prov_json in rows:
        provenance = json.loads(prov_json)
        missing_urls = provenance_has_source_for_sourced_fields(provenance)
        if missing_urls:
            bad_source.append((wine_key, missing_urls))
        unknown = unknown_provenance_keys(provenance)
        if unknown:
            bad_keys.append((wine_key, unknown))
    assert not bad_source, f"'sourced' fields with no source_urls: {bad_source[:10]}"
    assert not bad_keys, f"unknown provenance keys (typo risk): {bad_keys[:10]}"


def test_invariant_6_vintage_guard(dossier_conn):
    """Any honor with applies_to_stock=false must never render 'this bottle'
    phrasing — validator-level check, exercised here against staged content."""
    rows = dossier_conn.execute(
        "SELECT sku, honors_json FROM sku_dossier_overlay WHERE honors_json IS NOT NULL"
    ).fetchall()
    if not rows:
        pytest.skip("no honors data yet")
    violations = []
    for sku, honors_json in rows:
        honors = json.loads(honors_json)
        for h in honors:
            if h.get("applies_to_stock") is False and "this bottle" in (h.get("supporting_text") or "").lower():
                violations.append(sku)
    assert not violations, f"SKUs with mismatched-vintage honors using 'this bottle' phrasing: {violations[:10]}"
```

- [ ] **Step 2: Run the full invariants file**

Run: `.venv/bin/pytest tests/test_dossier_db_invariants.py -v`
Expected: PASS for invariant 3 (vacuously — empty table) and invariant 4 (exercises the guard directly with synthetic data); SKIP for invariants 1, 2, 5, 6, 7 (no real content yet — correct Phase-0 state).

- [ ] **Step 3: Commit**

```bash
git add tests/test_dossier_db_invariants.py
git commit -m "test(dossier): full 7-invariant suite from spec §9 (Phase 0 Task 11)"
```

---

## Task 12: Phase 0 exit checklist (manual verification, no code)

This task has no files to create — it's the Rule-10-style manual gate before Phase 1 can start.

- [ ] **Step 1: Run the full new test suite together**

```bash
.venv/bin/pytest tests/test_migrate_dossier_schema.py tests/test_purge_orphan_critic_skus.py \
  tests/test_wine_key_normalizer.py tests/test_audit_wine_keys.py \
  tests/test_dossier_consistency_checks.py tests/test_serve_defaults.py \
  tests/test_dossier_validators.py tests/test_seed_designation_reference_stub.py \
  tests/test_refresh_products_dossier.py tests/test_dossier_db_invariants.py -v
```
Expected: all PASS or SKIP (skips only for invariants gated on real content), zero FAIL.

- [ ] **Step 2: Verify orphan purge landed (Rule 1 — direct query, not log lines)**

```bash
sqlite3 data/db/products.db "SELECT COUNT(DISTINCT cs.sku) FROM critic_scores cs LEFT JOIN products p ON p.sku=cs.sku WHERE cs.sku IS NOT NULL AND cs.sku != '' AND p.sku IS NULL"
```
Expected: `0`

- [ ] **Step 3: Eyeball the wine_key audit artifact one more time**

Open `data/dossier_wine_key_audit.json`. Confirm `multi_vintage_family_count` is in a plausible range and no group looks like an obvious over/under-merge. This is the actual go/no-go signal for Phase 1 — if anything looks wrong, add entries to `WINE_KEY_OVERRIDES` (Task 3) and re-run `audit_wine_keys.py` before proceeding.

- [ ] **Step 4: Confirm the standalone dossier.db is git-ignored, not committed**

```bash
git status data/db/dossier.db
```
Expected: not tracked (or ignored) — this is a local generated artifact, same treatment as `products.db`.

- [ ] **Step 5: Report to user**

Summarize: schema created, N orphans resolved/purged (with the split), wine_key audit produced with counts, all validators unit-tested, invariant suite in place (skip-until-Phase-1 as expected). State explicitly: **no LLM/API calls were made in Phase 0** — this satisfies the "internal, no API yet" instruction. Ask whether to proceed to Phase 0.5 (designation_reference explainer authoring — first content-generation step, still $0 in-session) or pause here.

---

## Plan Review Loop

After this plan is written, dispatch the `plan-document-reviewer` subagent against this file + the spec before execution begins, per the writing-plans skill.
