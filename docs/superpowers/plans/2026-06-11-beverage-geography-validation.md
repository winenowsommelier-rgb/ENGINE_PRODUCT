# Beverage Geography Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conservative, review-gated workflow that validates active beverage `country`, `region`, and `subregion`, applies only approved exact corrections, and proves parity across SQLite, Supabase, the live JSON export, and the Magento CSV.

**Architecture:** A small Python package owns taxonomy indexing, deterministic classification, batch-file contracts, reviewed SQLite application, SKU-scoped Supabase publication, and parity verification. The existing JavaScript Magento quality helper remains the catalog export authority; a shared fixture prevents its beverage-selection rule from drifting from the Python audit. Read-only audit and evidence review are isolated from all write-capable commands.

**Tech Stack:** Python 3.11 standard library (`sqlite3`, `csv`, `json`, `hashlib`, `urllib.request`, `unicodedata`), `pytest`, Node.js test runner, `better-sqlite3`, existing Supabase PostgREST API, existing Magento export script.

**Spec:** `docs/superpowers/specs/2026-06-11-beverage-geography-validation-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `scripts/geography/__init__.py` | Create | Package marker and public workflow version |
| `scripts/geography/core.py` | Create | Normalization, beverage selection, fingerprints, taxonomy loading, integrity gate, deterministic classification |
| `scripts/geography/batch.py` | Create | Three-output contract, CSV readers/writers, report renderer, duplicate-SKU validation |
| `scripts/audit_beverage_geography.py` | Create | Read-only Stage 1/2 CLI |
| `scripts/apply_beverage_geography.py` | Create | Dry-run/approved Stage 4 CLI, SQLite backup, guarded update, changelog append |
| `scripts/publish_beverage_geography.py` | Create | Dry-run/retryable Stage 5 Supabase publisher limited to approved SKUs and geography fields |
| `scripts/verify_beverage_geography.py` | Create | Local/Supabase/live-export/Magento parity checks and report update |
| `data/taxonomy/geography-aliases.json` | Create | Explicit mechanical aliases only; no inferred geographic mappings |
| `tests/fixtures/geography/beverage-selection.json` | Create | Shared JS/Python beverage-selection cases |
| `tests/geography/conftest.py` | Create | Minimal taxonomy and SQLite factories |
| `tests/geography/test_core.py` | Create | Taxonomy, classification, quarantine, basis, and fingerprint tests |
| `tests/geography/test_batch.py` | Create | Output schema, sorting, uniqueness, and report tests |
| `tests/geography/test_apply.py` | Create | Dry-run, approval, stale-input, backup, update-scope, and changelog tests |
| `tests/geography/test_publish.py` | Create | Supabase request-scope, verification, failure, and retry tests |
| `tests/geography/test_verify.py` | Create | Four-destination mismatch detection tests |
| `tests/magento-catalog-quality.test.mjs` | Modify | Read the shared beverage fixture and preserve independent Magento columns |
| `scripts/export-magento-catalog.mjs` | Modify | Add an optional approved-batch filter while retaining current full export behavior |

Do not reuse `scripts/fix_subregion_taxonomy.py` for application. It writes the retired `data/db/products.json` path and contains hand-coded semantic decisions that bypass this workflow's taxonomy hash and source-fingerprint gates.

## Stable Batch Contract

The audit output directory is `outputs/beverage-geography-YYYY-MM-DD/`. The only user-facing files are:

```text
automatically_corrected_records.csv
human_review_queue.csv
before_after_quality_report.md
```

The workflow may also create `.batch-state.json` in that directory. It is internal state, not a fourth reporting deliverable.

`automatically_corrected_records.csv` columns:

```text
sku,name,classification,status,reason_codes,
old_country,old_region,old_subregion,
new_country,new_region,new_subregion,
country_id,region_id,subregion_id,
match_evidence,geography_basis,taxonomy_hash,source_fingerprint,
review_priority,popularity_revenue_90d,popularity_orders_90d,wn_stock,
reviewer_decision,reviewer_note,application_status,publish_status,applied_at
```

`human_review_queue.csv` columns:

```text
sku,name,classification,status,reason_codes,
country,region,subregion,candidate_paths,refusal_reason,
current_geography_basis,proposed_geography_basis,
evidence_url_1,evidence_url_2,evidence_retrieved_at,evidence_fact_summary,
contradiction_notes,popularity_revenue_90d,popularity_orders_90d,wn_stock,
review_priority,reviewer_decision,approved_country,approved_region,
approved_subregion,reviewer_note
```

Approval values are exact lowercase tokens:

```text
approve
reject
defer
```

Only rows with `reviewer_decision=approve` may be applied. `application_status` and `publish_status` are workflow-owned fields and must not be used as approval inputs.

### Task 1: Lock Shared Beverage Selection

**Files:**
- Create: `scripts/geography/__init__.py`
- Create: `tests/fixtures/geography/beverage-selection.json`
- Create: `tests/geography/test_core.py`
- Modify: `tests/magento-catalog-quality.test.mjs`
- Create: `scripts/geography/core.py`

- [ ] **Step 1: Add the cross-language fixture**

Create `tests/fixtures/geography/beverage-selection.json`:

```json
[
  {"sku":"WRW0001AA","classification":"Red Wine","expected":true},
  {"sku":"LWH0001AA","classification":"Wine product","expected":true},
  {"sku":"ABA0001BH","classification":"Wine product","expected":false},
  {"sku":"WEV0001AA","classification":"Wine product","expected":false},
  {"sku":"CIG0001AA","classification":"Cigar","expected":false},
  {"sku":"GWN0001AA","classification":"Glassware","expected":false},
  {"sku":"ABC0001AA","classification":"Non-Alcoholic","expected":false},
  {"sku":"LBD0006CN","classification":"Brandy","expected":true}
]
```

- [ ] **Step 2: Add failing Python and Node fixture tests**

Add to `tests/geography/test_core.py`:

```python
import json
from pathlib import Path

from scripts.geography.core import is_beverage

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "geography" / "beverage-selection.json"


def test_python_beverage_selector_matches_shared_fixture():
    for case in json.loads(FIXTURE.read_text(encoding="utf-8")):
        assert is_beverage(case) is case["expected"], case
```

Append to `tests/magento-catalog-quality.test.mjs`:

```javascript
import fs from 'node:fs';

test('JavaScript beverage selector matches shared geography fixture', () => {
  const fixture = JSON.parse(fs.readFileSync(
    new URL('./fixtures/geography/beverage-selection.json', import.meta.url),
    'utf8',
  ));
  for (const entry of fixture) {
    assert.equal(isBeverage(entry), entry.expected, JSON.stringify(entry));
  }
});
```

- [ ] **Step 3: Run both tests and confirm the Python import fails**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_core.py -v
node --test tests/magento-catalog-quality.test.mjs
```

Expected: Python fails with `ModuleNotFoundError`; Node passes.

- [ ] **Step 4: Implement the package marker and Python selector**

Create `scripts/geography/__init__.py`:

```python
"""Conservative beverage geography validation workflow."""

WORKFLOW_VERSION = "1.0"
```

Create the first section of `scripts/geography/core.py`:

```python
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

NON_BEVERAGE_CLASSIFICATIONS = {
    "accessories", "cigar", "events", "glassware", "mineral water", "non-alcoholic",
}
NON_BEVERAGE_PREFIXES = {"ABA", "AWC", "CIG", "GBE", "GDC", "GLQ", "GWN", "WEV"}


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def is_beverage(product: dict[str, Any]) -> bool:
    classification = clean(product.get("classification")).lower()
    prefix = clean(product.get("sku"))[:3].upper()
    if classification in NON_BEVERAGE_CLASSIFICATIONS or prefix in NON_BEVERAGE_PREFIXES:
        return False
    if classification == "wine product":
        return prefix.startswith("L") or (prefix.startswith("W") and prefix != "WEV")
    return True
```

- [ ] **Step 5: Run both selectors**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_core.py -v
node --test tests/magento-catalog-quality.test.mjs
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/geography tests/fixtures/geography tests/geography/test_core.py tests/magento-catalog-quality.test.mjs
git commit -m "test: lock beverage geography selection"
```

### Task 2: Build Taxonomy Integrity Gate

**Files:**
- Create: `data/taxonomy/geography-aliases.json`
- Modify: `scripts/geography/core.py`
- Create: `tests/geography/conftest.py`
- Modify: `tests/geography/test_core.py`

- [ ] **Step 1: Add explicit alias storage**

Create `data/taxonomy/geography-aliases.json`:

```json
{
  "schema_version": 1,
  "country": [
    {"alias": "United States", "canonical": "USA"}
  ],
  "region": [],
  "subregion": []
}
```

Aliases are reviewed data. Do not add `Toscana -> Tuscany`, `Piemonte -> Piedmont`, or cross-level mappings until the canonical parent is reviewed and encoded.

- [ ] **Step 2: Add taxonomy fixtures**

Create `tests/geography/conftest.py`:

```python
import json
import sqlite3

import pytest


@pytest.fixture
def taxonomy_dir(tmp_path):
    docs = {
        "countries.json": {"data": [{"id": 1, "name": "France", "iso": "FR"}]},
        "regions.json": {"data": [
            {"id": 10, "country_id": 1, "name": "Cognac"},
            {"id": 11, "country_id": 1, "name": "Bordeaux"},
        ]},
        "subregions.json": {"data": [
            {"id": 100, "region_id": 10, "name": "Grande Champagne"},
            {"id": 101, "region_id": 11, "name": "Pauillac"},
        ]},
        "geography-aliases.json": {
            "schema_version": 1,
            "country": [{"alias": "French Republic", "canonical": "France"}],
            "region": [],
            "subregion": [],
        },
    }
    for name, document in docs.items():
        (tmp_path / name).write_text(json.dumps(document), encoding="utf-8")
    return tmp_path


@pytest.fixture
def products_db(tmp_path):
    path = tmp_path / "products.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
      CREATE TABLE products (
        id TEXT PRIMARY KEY, sku TEXT UNIQUE, name TEXT, classification TEXT,
        country TEXT, region TEXT, subregion TEXT, is_active INTEGER,
        has_recent_sales INTEGER, popularity_revenue_90d REAL,
        popularity_orders_90d INTEGER, wn_stock INTEGER, quantity_in_stock INTEGER,
        enrichment_source TEXT, enrichment_note TEXT, updated_at TEXT
      );
    """)
    conn.close()
    return path
```

- [ ] **Step 3: Add failing integrity and hash tests**

Append to `tests/geography/test_core.py`:

```python
import json

from scripts.geography.core import load_taxonomy


def test_taxonomy_hash_is_stable_and_integrity_passes(taxonomy_dir):
    taxonomy = load_taxonomy(taxonomy_dir)
    assert len(taxonomy.batch_hash) == 64
    assert taxonomy.failures == []
    assert taxonomy.quarantined_names == set()


def test_orphan_subregion_is_a_failure_and_quarantined(taxonomy_dir):
    path = taxonomy_dir / "subregions.json"
    doc = json.loads(path.read_text())
    doc["data"].append({"id": 999, "region_id": 404, "name": "Lost Place"})
    path.write_text(json.dumps(doc))
    taxonomy = load_taxonomy(taxonomy_dir)
    assert "orphan_subregion:999" in taxonomy.failures
    assert "lost place" in taxonomy.quarantined_names


def test_cross_level_name_is_quarantined(taxonomy_dir):
    path = taxonomy_dir / "subregions.json"
    doc = json.loads(path.read_text())
    doc["data"].append({"id": 102, "region_id": 11, "name": "Cognac"})
    path.write_text(json.dumps(doc))
    taxonomy = load_taxonomy(taxonomy_dir)
    assert "cross_level:france:cognac" in taxonomy.failures
    assert "cognac" in taxonomy.quarantined_names


def test_ambiguous_alias_is_a_failure(taxonomy_dir):
    path = taxonomy_dir / "geography-aliases.json"
    doc = json.loads(path.read_text())
    doc["country"].append({"alias": "French Republic", "canonical": "Missing"})
    path.write_text(json.dumps(doc))
    taxonomy = load_taxonomy(taxonomy_dir)
    assert any(item.startswith("ambiguous_alias:country:french republic") for item in taxonomy.failures)
```

- [ ] **Step 4: Confirm failure**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_core.py -v
```

Expected: import failure for `load_taxonomy`.

- [ ] **Step 5: Implement normalized taxonomy indexes and integrity checks**

Add to `scripts/geography/core.py`:

```python
from dataclasses import dataclass


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKC", clean(value)).casefold()
    return re.sub(r"\s+", " ", text)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class Taxonomy:
    batch_hash: str
    file_hashes: dict[str, str]
    countries: dict[int, dict[str, Any]]
    regions: dict[int, dict[str, Any]]
    subregions: dict[int, dict[str, Any]]
    countries_by_name: dict[str, list[dict[str, Any]]]
    regions_by_parent_name: dict[tuple[int, str], list[dict[str, Any]]]
    subregions_by_parent_name: dict[tuple[int, str], list[dict[str, Any]]]
    aliases: dict[str, dict[str, str]]
    failures: list[str]
    quarantined_names: set[str]


def _group(rows, key):
    grouped = {}
    for row in rows:
        grouped.setdefault(key(row), []).append(row)
    return grouped


def load_taxonomy(directory: Path) -> Taxonomy:
    names = ["countries.json", "regions.json", "subregions.json", "geography-aliases.json"]
    paths = {name: directory / name for name in names}
    hashes = {name: _sha256(path) for name, path in paths.items()}
    batch_hash = hashlib.sha256(
        json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    countries_list = json.loads(paths["countries.json"].read_text(encoding="utf-8"))["data"]
    regions_list = json.loads(paths["regions.json"].read_text(encoding="utf-8"))["data"]
    subregions_list = json.loads(paths["subregions.json"].read_text(encoding="utf-8"))["data"]
    alias_doc = json.loads(paths["geography-aliases.json"].read_text(encoding="utf-8"))
    countries = {row["id"]: row for row in countries_list}
    regions = {row["id"]: row for row in regions_list}
    subregions = {row["id"]: row for row in subregions_list}
    failures, quarantined = [], set()

    for row in regions_list:
        if row["country_id"] not in countries:
            failures.append(f"orphan_region:{row['id']}")
            quarantined.add(normalize(row["name"]))
    for row in subregions_list:
        if row["region_id"] not in regions:
            failures.append(f"orphan_subregion:{row['id']}")
            quarantined.add(normalize(row["name"]))

    countries_by_name = _group(countries_list, lambda row: normalize(row["name"]))
    regions_by_parent_name = _group(
        regions_list, lambda row: (row["country_id"], normalize(row["name"]))
    )
    subregions_by_parent_name = _group(
        subregions_list, lambda row: (row["region_id"], normalize(row["name"]))
    )
    for label, grouped in (
        ("country", countries_by_name),
        ("region", regions_by_parent_name),
        ("subregion", subregions_by_parent_name),
    ):
        for key, rows in grouped.items():
            if len(rows) > 1:
                failures.append(f"duplicate_{label}:{key}")
                quarantined.add(key[-1] if isinstance(key, tuple) else key)

    for region in regions_list:
        country = countries.get(region["country_id"])
        if not country:
            continue
        name = normalize(region["name"])
        for subregion in subregions_list:
            parent = regions.get(subregion["region_id"])
            if parent and parent["country_id"] == region["country_id"] and normalize(subregion["name"]) == name:
                failures.append(f"cross_level:{normalize(country['name'])}:{name}")
                quarantined.add(name)

    aliases = {"country": {}, "region": {}, "subregion": {}}
    canonical_names = {
        "country": set(countries_by_name),
        "region": {key[1] for key in regions_by_parent_name},
        "subregion": {key[1] for key in subregions_by_parent_name},
    }
    for level in aliases:
        for entry in alias_doc.get(level, []):
            alias, canonical = normalize(entry["alias"]), normalize(entry["canonical"])
            if alias in aliases[level] or canonical not in canonical_names[level]:
                failures.append(f"ambiguous_alias:{level}:{alias}")
                quarantined.add(alias)
                continue
            aliases[level][alias] = canonical

    return Taxonomy(
        batch_hash, hashes, countries, regions, subregions,
        countries_by_name, regions_by_parent_name, subregions_by_parent_name,
        aliases, sorted(set(failures)), quarantined,
    )
```

- [ ] **Step 6: Run integrity tests**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_core.py -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add data/taxonomy/geography-aliases.json scripts/geography/core.py tests/geography
git commit -m "feat: add geography taxonomy integrity gate"
```

### Task 3: Implement Deterministic Classification

**Files:**
- Modify: `scripts/geography/core.py`
- Modify: `tests/geography/test_core.py`

- [ ] **Step 1: Add failing classification tests**

Append to `tests/geography/test_core.py`:

```python
from scripts.geography.core import classify_product, source_fingerprint


def base_product(**overrides):
    product = {
        "id": "p1", "sku": "LBD0006CN", "name": "St-Rémy X.O",
        "classification": "Brandy", "country": "France", "region": "Cognac",
        "subregion": "Grande Champagne", "updated_at": "2026-06-02T00:00:00Z",
        "has_recent_sales": 1, "popularity_revenue_90d": 1000,
        "popularity_orders_90d": 2, "wn_stock": 3,
    }
    product.update(overrides)
    return product


def test_exact_path_is_valid(taxonomy_dir):
    result = classify_product(base_product(), load_taxonomy(taxonomy_dir))
    assert result["status"] == "valid_exact"
    assert result["geography_basis"] == "protected_origin"


def test_case_and_space_only_change_is_mechanical(taxonomy_dir):
    result = classify_product(
        base_product(region="  cognac ", subregion="GRANDE   CHAMPAGNE"),
        load_taxonomy(taxonomy_dir),
    )
    assert result["status"] == "exact_mechanical_correction"
    assert result["new_region"] == "Cognac"
    assert result["new_subregion"] == "Grande Champagne"


def test_compound_region_is_review_not_auto_split(taxonomy_dir):
    result = classify_product(
        base_product(region="Cognac | Grande Champagne", subregion="Grande Champagne"),
        load_taxonomy(taxonomy_dir),
    )
    assert result["status"] == "exact_restructure_review"
    assert "compound_region" in result["reason_codes"]


def test_wrong_parent_routes_to_review(taxonomy_dir):
    result = classify_product(
        base_product(region="Bordeaux", subregion="Grande Champagne"),
        load_taxonomy(taxonomy_dir),
    )
    assert result["status"] == "evidence_review"
    assert "subregion_parent_mismatch" in result["reason_codes"]


def test_quarantined_name_never_auto_corrects(taxonomy_dir):
    path = taxonomy_dir / "subregions.json"
    doc = json.loads(path.read_text())
    doc["data"].append({"id": 102, "region_id": 11, "name": "Cognac"})
    path.write_text(json.dumps(doc))
    result = classify_product(base_product(region="cognac"), load_taxonomy(taxonomy_dir))
    assert result["status"] == "taxonomy_blocked"


def test_source_fingerprint_changes_when_geography_changes():
    before = source_fingerprint(base_product())
    after = source_fingerprint(base_product(region="Bordeaux"))
    assert before != after
```

- [ ] **Step 2: Run tests and confirm missing functions**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_core.py -v
```

Expected: import failure for `classify_product`.

- [ ] **Step 3: Implement fingerprints, basis, resolution, and status precedence**

Add to `scripts/geography/core.py`:

```python
def source_fingerprint(product: dict[str, Any]) -> str:
    payload = {
        key: clean(product.get(key))
        for key in ("id", "sku", "country", "region", "subregion", "updated_at")
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def geography_basis(product: dict[str, Any]) -> str:
    classification = normalize(product.get("classification"))
    if any(token in classification for token in ("wine", "cognac", "armagnac", "brandy")):
        return "protected_origin"
    if any(token in classification for token in ("gin", "vodka", "beer", "liqueur")):
        return "production_location"
    if any(token in normalize(product.get("name")) for token in ("blend", "mixed pack", "assorted")):
        return "multi_region_blend"
    return "unknown"


def _one(rows):
    return rows[0] if len(rows) == 1 else None


def classify_product(product: dict[str, Any], taxonomy: Taxonomy) -> dict[str, Any]:
    old_country, old_region, old_subregion = (
        clean(product.get("country")), clean(product.get("region")), clean(product.get("subregion"))
    )
    country_key = taxonomy.aliases["country"].get(normalize(old_country), normalize(old_country))
    country = _one(taxonomy.countries_by_name.get(country_key, []))
    reasons = []
    base = {
        "sku": clean(product.get("sku")), "name": clean(product.get("name")),
        "classification": clean(product.get("classification")),
        "old_country": old_country, "old_region": old_region, "old_subregion": old_subregion,
        "new_country": old_country, "new_region": old_region, "new_subregion": old_subregion,
        "country_id": "", "region_id": "", "subregion_id": "",
        "geography_basis": geography_basis(product),
        "taxonomy_hash": taxonomy.batch_hash,
        "source_fingerprint": source_fingerprint(product),
    }
    if not country:
        return {**base, "status": "evidence_review", "reason_codes": ["country_missing_or_unknown"]}
    base["country_id"], base["new_country"] = country["id"], country["name"]
    region_text = old_region
    embedded_subregion = ""
    if "|" in region_text:
        parts = [part.strip() for part in region_text.split("|") if part.strip()]
        if len(parts) == 2:
            region_text, embedded_subregion = parts
            reasons.append("compound_region")
        else:
            return {**base, "status": "evidence_review", "reason_codes": ["compound_region_ambiguous"]}
    region_key = taxonomy.aliases["region"].get(normalize(region_text), normalize(region_text))
    if region_key in taxonomy.quarantined_names or normalize(old_subregion) in taxonomy.quarantined_names:
        return {**base, "status": "taxonomy_blocked", "reason_codes": ["quarantined_taxonomy_path"]}
    region = _one(taxonomy.regions_by_parent_name.get((country["id"], region_key), []))
    if not region:
        return {**base, "status": "evidence_review", "reason_codes": ["region_missing_or_unknown"]}
    base["region_id"], base["new_region"] = region["id"], region["name"]
    subregion_text = old_subregion or embedded_subregion
    if not subregion_text:
        status = "legitimately_blank" if base["geography_basis"] in {"multi_region_blend", "production_location"} else "valid_region_only"
        return {**base, "status": status, "reason_codes": [status]}
    subregion_key = taxonomy.aliases["subregion"].get(normalize(subregion_text), normalize(subregion_text))
    subregion = _one(taxonomy.subregions_by_parent_name.get((region["id"], subregion_key), []))
    if not subregion:
        matches = [
            row for (parent_id, name), rows in taxonomy.subregions_by_parent_name.items()
            if name == subregion_key for row in rows
        ]
        reason = "subregion_parent_mismatch" if matches else "subregion_missing_or_unknown"
        return {**base, "status": "evidence_review", "reason_codes": [reason]}
    base["subregion_id"], base["new_subregion"] = subregion["id"], subregion["name"]
    if reasons:
        return {**base, "status": "exact_restructure_review", "reason_codes": reasons}
    changed = (old_country, old_region, old_subregion) != (
        base["new_country"], base["new_region"], base["new_subregion"]
    )
    return {
        **base,
        "status": "exact_mechanical_correction" if changed else "valid_exact",
        "reason_codes": ["canonical_normalization"] if changed else ["exact_taxonomy_path"],
    }
```

- [ ] **Step 4: Add redundant region/subregion clearing rule**

Before subregion lookup, add this guarded branch:

```python
    if normalize(subregion_text) == normalize(region["name"]):
        same_name_sub = taxonomy.subregions_by_parent_name.get((region["id"], normalize(subregion_text)), [])
        if not same_name_sub and normalize(subregion_text) not in taxonomy.quarantined_names:
            return {
                **base, "new_subregion": "", "status": "exact_mechanical_correction",
                "reason_codes": ["redundant_subregion_equals_region"],
            }
```

Add a test asserting the branch clears only when no same-name subregion exists under the parent.

- [ ] **Step 5: Run classification tests**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_core.py -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/geography/core.py tests/geography/test_core.py
git commit -m "feat: classify beverage geography deterministically"
```

### Task 4: Generate the Three Review Outputs

**Files:**
- Create: `scripts/geography/batch.py`
- Create: `scripts/audit_beverage_geography.py`
- Create: `tests/geography/test_batch.py`

- [ ] **Step 1: Add failing output-contract tests**

Create `tests/geography/test_batch.py`:

```python
import csv
import sqlite3

from scripts.audit_beverage_geography import run_audit


def insert_product(db, values):
    conn = sqlite3.connect(db)
    conn.execute(
        """INSERT INTO products
        (id,sku,name,classification,country,region,subregion,is_active,has_recent_sales,
         popularity_revenue_90d,popularity_orders_90d,wn_stock,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        values,
    )
    conn.commit()
    conn.close()


def test_audit_writes_only_three_user_facing_outputs(products_db, taxonomy_dir, tmp_path):
    insert_product(products_db, (
        "p1","LBD0006CN","St-Rémy X.O","Brandy","France",
        "Cognac | Grande Champagne","Grande Champagne",1,1,1000,2,3,"2026-06-02T00:00:00Z",
    ))
    out = tmp_path / "batch"
    summary = run_audit(products_db, taxonomy_dir, out, "2026-06-11")
    assert summary["included_beverages"] == 1
    assert {path.name for path in out.iterdir() if not path.name.startswith(".")} == {
        "automatically_corrected_records.csv",
        "human_review_queue.csv",
        "before_after_quality_report.md",
    }
    rows = list(csv.DictReader((out / "automatically_corrected_records.csv").open()))
    assert rows[0]["status"] == "exact_restructure_review"
    assert rows[0]["reviewer_decision"] == ""
    assert "|" not in rows[0]["new_region"]


def test_review_queue_is_unique_and_recent_sales_first(products_db, taxonomy_dir, tmp_path):
    for values in [
        ("p1","A","A","Gin","France","Unknown","",1,0,0,0,9,"2026-06-02T00:00:00Z"),
        ("p2","B","B","Gin","France","Unknown","",1,1,5,1,0,"2026-06-02T00:00:00Z"),
    ]:
        insert_product(products_db, values)
    out = tmp_path / "batch"
    run_audit(products_db, taxonomy_dir, out, "2026-06-11")
    rows = list(csv.DictReader((out / "human_review_queue.csv").open()))
    assert [row["sku"] for row in rows] == ["B", "A"]
    assert len({row["sku"] for row in rows}) == len(rows)
```

- [ ] **Step 2: Run and confirm import failure**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_batch.py -v
```

Expected: import failure for `run_audit`.

- [ ] **Step 3: Implement batch constants and writers**

Create `scripts/geography/batch.py` with:

```python
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

AUTO_COLUMNS = [
    "sku","name","classification","status","reason_codes",
    "old_country","old_region","old_subregion","new_country","new_region","new_subregion",
    "country_id","region_id","subregion_id","match_evidence","geography_basis",
    "taxonomy_hash","source_fingerprint","review_priority","popularity_revenue_90d",
    "popularity_orders_90d","wn_stock","reviewer_decision","reviewer_note",
    "application_status","publish_status","applied_at",
]
REVIEW_COLUMNS = [
    "sku","name","classification","status","reason_codes","country","region","subregion",
    "candidate_paths","refusal_reason","current_geography_basis","proposed_geography_basis",
    "evidence_url_1","evidence_url_2","evidence_retrieved_at","evidence_fact_summary",
    "contradiction_notes","popularity_revenue_90d","popularity_orders_90d","wn_stock",
    "review_priority","reviewer_decision","approved_country","approved_region",
    "approved_subregion","reviewer_note",
]


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    skus = [row["sku"] for row in rows]
    if len(skus) != len(set(skus)):
        raise ValueError(f"duplicate SKU in {path.name}")
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def priority(row: dict) -> str:
    if int(row.get("has_recent_sales") or 0) == 1 or float(row.get("popularity_revenue_90d") or 0) > 0:
        return "HIGH"
    if float(row.get("wn_stock") or row.get("quantity_in_stock") or 0) > 0:
        return "MEDIUM"
    return "LOW"


def priority_key(row: dict):
    rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    return (
        rank[row["review_priority"]],
        -float(row.get("popularity_revenue_90d") or 0),
        -float(row.get("wn_stock") or 0),
        row["sku"],
    )


def render_report(summary: dict) -> str:
    counts = summary["status_counts"]
    return f"""# Beverage Geography Quality Report

Generated: {summary["generated_at"]}
Taxonomy batch hash: `{summary["taxonomy_hash"]}`

## Scope

- Active catalog rows scanned: {summary["active_rows"]}
- Included beverages: {summary["included_beverages"]}
- Excluded non-beverages: {summary["excluded_non_beverages"]}

## Before And Projected After

- Exact valid: {counts.get("valid_exact", 0)}
- Valid region only: {counts.get("valid_region_only", 0)}
- Legitimately blank: {counts.get("legitimately_blank", 0)}
- Exact mechanical corrections: {counts.get("exact_mechanical_correction", 0)}
- Exact restructures requiring approval: {counts.get("exact_restructure_review", 0)}
- Human evidence review: {counts.get("evidence_review", 0)}
- Taxonomy blocked: {counts.get("taxonomy_blocked", 0)}
- Before exact-path coverage: {summary["before_exact_pct"]:.1f}%
- Projected exact-path coverage after approved exact rows: {summary["projected_exact_pct"]:.1f}%

## Taxonomy Integrity

Failures: {len(summary["taxonomy_failures"])}

{chr(10).join(f"- {item}" for item in summary["taxonomy_failures"]) or "- None"}

Quarantined normalized names:

{chr(10).join(f"- {item}" for item in summary["quarantined_names"]) or "- None"}

## Field Issues

{chr(10).join(f"- {key}: {value}" for key, value in sorted(summary["issue_counts"].items())) or "- None"}

## Publication Verification

- Local SQLite: not run
- Production Supabase: not run
- Live JSON export: not run
- Magento CSV: not run
"""


def write_state(path: Path, state: dict) -> None:
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
```

- [ ] **Step 4: Implement the read-only audit CLI**

Create `scripts/audit_beverage_geography.py` with the public functions
`load_active_products(db_path)`, `run_audit(db_path, taxonomy_dir, output_dir,
audit_date)`, and `main(argv=None)`.

Use the following query exactly:

```sql
SELECT id, sku, name, classification, country, region, subregion,
       is_active, has_recent_sales, popularity_revenue_90d,
       popularity_orders_90d, wn_stock, quantity_in_stock, updated_at
FROM products
WHERE COALESCE(is_active, 1) = 1
ORDER BY sku
```

Inside `run_audit`:

```python
taxonomy = load_taxonomy(taxonomy_dir)
active = load_active_products(db_path)
included = [row for row in active if is_beverage(row)]
classified = [classify_product(row, taxonomy) | {
    "review_priority": priority(row),
    "popularity_revenue_90d": row.get("popularity_revenue_90d") or 0,
    "popularity_orders_90d": row.get("popularity_orders_90d") or 0,
    "wn_stock": row.get("wn_stock") or row.get("quantity_in_stock") or 0,
} for row in included]
```

Route `exact_mechanical_correction` and `exact_restructure_review` to the automatic CSV. Route `evidence_review` and `taxonomy_blocked` to the review CSV. Valid rows appear only in counts. Populate `match_evidence` as `exact normalized taxonomy path`; populate review `refusal_reason` from `reason_codes`; leave all reviewer/evidence fields blank. Sort both files with `priority_key`.

Calculate issue counts from reason codes and field emptiness. Write `.batch-state.json` with `workflow_version`, `audit_date`, absolute DB path, taxonomy file hashes, taxonomy batch hash, included SKU count, and status counts. Never put environment secrets or product descriptions in state.

CLI:

```bash
.venv/bin/python scripts/audit_beverage_geography.py \
  --db data/db/products.db \
  --taxonomy-dir data/taxonomy \
  --date 2026-06-11
```

The default output directory is `outputs/beverage-geography-<date>`. Also
accept `--output-dir PATH` so post-application validation can run without
overwriting the reviewed batch.

- [ ] **Step 5: Run output tests**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_batch.py -v
```

Expected: all pass.

- [ ] **Step 6: Run the read-only audit against the real database**

Run:

```bash
.venv/bin/python scripts/audit_beverage_geography.py --date 2026-06-11
```

Expected: output reports `5,469` included beverages unless source data changed after the planning snapshot. If the count differs, record the current count rather than forcing the old number.

- [ ] **Step 7: Commit code and generated review outputs separately**

```bash
git add scripts/geography/batch.py scripts/audit_beverage_geography.py tests/geography/test_batch.py
git commit -m "feat: generate beverage geography review batch"
git add outputs/beverage-geography-2026-06-11
git commit -m "data: add beverage geography audit outputs"
```

### Task 5: Apply Only Reviewed Corrections Locally

**Files:**
- Create: `scripts/apply_beverage_geography.py`
- Create: `tests/geography/test_apply.py`

- [ ] **Step 1: Add failing application tests**

Create `tests/geography/test_apply.py` with these test names:

```text
test_dry_run_changes_neither_database_nor_changelog
test_unapproved_row_is_skipped
test_changed_taxonomy_hash_aborts_batch
test_stale_source_fingerprint_rejects_row
test_apply_updates_only_geography_and_audit_columns
test_apply_creates_timestamped_database_backup
test_apply_appends_one_changelog_entry_per_changed_field
test_duplicate_approved_sku_aborts_before_backup
```

Use this concrete assertion pattern for the dry-run and successful apply:

```python
before_db = products_db.read_bytes()
before_log = changelog_path.read_bytes()
result = apply_batch(
    batch_dir=batch_dir,
    db_path=products_db,
    taxonomy_dir=taxonomy_dir,
    changelog_path=changelog_path,
    dry_run=True,
)
assert result == {"approved": 1, "applied": 0, "rejected": 0, "dry_run": True}
assert products_db.read_bytes() == before_db
assert changelog_path.read_bytes() == before_log

result = apply_batch(
    batch_dir=batch_dir,
    db_path=products_db,
    taxonomy_dir=taxonomy_dir,
    changelog_path=changelog_path,
    dry_run=False,
    applied_at="2026-06-11T12:00:00Z",
)
assert result["applied"] == 1
```

For the changed-hash case use
`pytest.raises(ValueError, match="taxonomy hash changed")`; for duplicate SKU
use `pytest.raises(ValueError, match="duplicate approved SKU")`. Assert the
database bytes, changelog bytes, and backup-directory listing are unchanged.
For a stale row, assert `application_status=stale_source_fingerprint`, that SKU
is unchanged, and any independent valid approved row can still apply.

Use a CSV row with `reviewer_decision=approve`, exact taxonomy IDs, the fixture taxonomy hash, and `source_fingerprint(base_product())`. Snapshot the full SQLite row before and after and assert only:

```text
country
region
subregion
updated_at
enrichment_source
enrichment_note
```

may differ.

- [ ] **Step 2: Run and confirm import failure**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_apply.py -v
```

Expected: import failure.

- [ ] **Step 3: Implement reviewed-row loading and preflight**

Create `scripts/apply_beverage_geography.py` with:

```python
APPROVED = "approve"
ALLOWED_STATUSES = {"exact_mechanical_correction", "exact_restructure_review"}
AUDIT_FIELDS = {"country", "region", "subregion", "updated_at", "enrichment_source", "enrichment_note"}


def load_approved_rows(csv_path: Path) -> list[dict]:
    rows = [row for row in csv.DictReader(csv_path.open(encoding="utf-8-sig"))
            if row["reviewer_decision"].strip().lower() == APPROVED]
    skus = [row["sku"] for row in rows]
    if len(skus) != len(set(skus)):
        raise ValueError("duplicate approved SKU")
    invalid = [row["sku"] for row in rows if row["status"] not in ALLOWED_STATUSES]
    if invalid:
        raise ValueError(f"non-exact approved rows: {invalid}")
    return rows
```

Preflight every row before backup or mutation:

1. Recompute current taxonomy hash and require equality with every row and `.batch-state.json`.
2. Fetch current product by unique SKU.
3. Recompute `source_fingerprint`.
4. Resolve recorded taxonomy IDs and confirm names/parents equal the proposed path.
5. Reject any proposed `region` or `subregion` containing `|`.

- [ ] **Step 4: Implement transactional apply and deterministic changelog**

Use:

```python
backup = db_path.parent / "backups" / f"products_{timestamp}_pre_beverage_geography.db"
shutil.copy2(db_path, backup)
```

Then one SQLite transaction:

```sql
UPDATE products
SET country=?, region=?, subregion=?, updated_at=?,
    enrichment_source='beverage_geography_validation',
    enrichment_note=?
WHERE sku=?
```

The note is:

```text
Approved geography batch <audit-date>; reason=<reason_codes>; taxonomy=<first 12 hash chars>
```

Append changelog entries to `data/db/product-changelog.json` only after the SQLite transaction commits. Use the existing shape:

```python
{
  "id": str(uuid.uuid4()),
  "product_id": product["id"],
  "sku": product["sku"],
  "changed_at": applied_at,
  "source": "taxonomy_queue",
  "field": field,
  "old_value": old_value or None,
  "new_value": new_value or None,
  "note": note,
}
```

Write the changelog atomically through a sibling temporary file followed by `Path.replace`. Back up the changelog beside the DB backup before appending.
After each successful row, atomically rewrite the automatic CSV with
`application_status=applied` and the exact UTC `applied_at` used for SQLite.
Rejected preflight rows receive `application_status=rejected:<reason>` and a
blank `applied_at`.

- [ ] **Step 5: Add CLI safety**

Arguments:

```text
--batch-dir PATH
--db PATH
--taxonomy-dir PATH
--changelog PATH
--dry-run
--apply
```

Exactly one of `--dry-run` and `--apply` is required. Dry-run runs all preflight checks and prints the SKU/field changes without creating backups or writing files.

- [ ] **Step 6: Run apply tests**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_apply.py -v
```

Expected: all pass.

- [ ] **Step 7: Run production-data dry-run only**

Run:

```bash
.venv/bin/python scripts/apply_beverage_geography.py \
  --batch-dir outputs/beverage-geography-2026-06-11 \
  --dry-run
```

Expected: zero writes. If no rows are approved yet, output `approved rows: 0`.

- [ ] **Step 8: Commit**

```bash
git add scripts/apply_beverage_geography.py tests/geography/test_apply.py
git commit -m "feat: apply approved geography corrections safely"
```

### Task 6: Publish Approved SKUs to Supabase

**Files:**
- Create: `scripts/publish_beverage_geography.py`
- Create: `tests/geography/test_publish.py`

- [ ] **Step 1: Add mocked PostgREST tests**

Create `tests/geography/test_publish.py` with tests that patch `urllib.request.urlopen` and assert:

```python
assert request.method == "PATCH"
assert "/rest/v1/products?sku=eq." in request.full_url
assert json.loads(request.data) == {
    "country": "France",
    "region": "Cognac",
    "subregion": "Grande Champagne",
    "updated_at": applied_at,
}
```

Also test:

- `--dry-run` makes no HTTP request.
- publish requires `application_status=applied`.
- response must contain exactly one matching SKU.
- HTTP failure leaves `publish_status=failed:<HTTP code>`.
- a retry skips `publish_status=verified` rows and retries failed/blank rows.
- no function reads or writes the `sync_state` table.

- [ ] **Step 2: Run and confirm import failure**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_publish.py -v
```

Expected: import failure.

- [ ] **Step 3: Implement the dedicated publisher**

Create `scripts/publish_beverage_geography.py` with:

```python
PATCH_FIELDS = ("country", "region", "subregion", "updated_at")


def patch_and_verify(base_url: str, service_key: str, row: dict) -> dict:
    sku = urllib.parse.quote(row["sku"], safe="")
    url = (
        f"{base_url.rstrip('/')}/rest/v1/products"
        f"?sku=eq.{sku}&select=sku,country,region,subregion,updated_at"
    )
    payload = {
        "country": row["new_country"] or None,
        "region": row["new_region"] or None,
        "subregion": row["new_subregion"] or None,
        "updated_at": row["applied_at"],
    }
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="PATCH",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        records = json.loads(response.read().decode() or "[]")
    if len(records) != 1 or records[0]["sku"] != row["sku"]:
        raise RuntimeError(f"expected one production row for {row['sku']}")
    for field in PATCH_FIELDS:
        if records[0].get(field) != payload[field]:
            raise RuntimeError(f"production mismatch {row['sku']}:{field}")
    return records[0]
```

Load only rows where `reviewer_decision=approve` and `application_status=applied`. Require `SUPABASE_SERVICE_ROLE_KEY`; do not fall back to the public publishable key for a production write. Read `NEXT_PUBLIC_SUPABASE_URL` and the service key from `.env.local` without printing either value.

After each row, atomically rewrite `automatically_corrected_records.csv` with `publish_status=verified` or `failed:<reason>`. Continue through the batch, return exit code `1` when any row failed, and leave verified rows retry-safe.

CLI arguments are:

```text
--batch-dir PATH
--env-file PATH
--dry-run
--publish
```

Exactly one of `--dry-run` and `--publish` is required.

- [ ] **Step 4: Run publisher tests**

Run:

```bash
.venv/bin/python -m pytest tests/geography/test_publish.py -v
```

Expected: all pass.

- [ ] **Step 5: Run production dry-run**

Run:

```bash
.venv/bin/python scripts/publish_beverage_geography.py \
  --batch-dir outputs/beverage-geography-2026-06-11 \
  --dry-run
```

Expected: no HTTP calls and a SKU-scoped payload preview.

- [ ] **Step 6: Commit**

```bash
git add scripts/publish_beverage_geography.py tests/geography/test_publish.py
git commit -m "feat: publish geography by approved SKU"
```

### Task 7: Verify All Destinations and Scope Magento Export

**Files:**
- Modify: `scripts/export-magento-catalog.mjs`
- Create: `scripts/verify_beverage_geography.py`
- Create: `tests/geography/test_verify.py`
- Modify: `tests/magento-catalog-quality.test.mjs`

- [ ] **Step 1: Add Magento export filter test**

Refactor `scripts/export-magento-catalog.mjs` to export:

```javascript
export function buildMagentoRows(products, currentDate, approvedSkus = null) {
  const assessed = products.map(/* current assessment mapping */);
  const readyRows = assessed.filter((row) => (
    row.magento_readiness === 'READY' || row.magento_readiness === 'READY_WITH_WARNING'
  ));
  return readyRows
    .filter((row) => approvedSkus === null || approvedSkus.has(row.sku))
    .map((row) => ({
      sku: row.sku,
      name: row.name,
      country: row.country,
      region: row.region,
      subregion: row.subregion,
      'short_description (EN Store)': row.short_description,
      'description (EN Store)': row.description,
    }));
}
```

Add CLI option:

```text
--approved-batch outputs/beverage-geography-2026-06-11/automatically_corrected_records.csv
```

When present, include only `reviewer_decision=approve` and `application_status=applied`. Without the option, preserve current full-catalog behavior.

Add a Node test proving:

- filtered export includes only approved applied SKU;
- headers have `country`, `region`, `subregion`;
- no `region_wine`;
- no pipe survives in region/subregion.

- [ ] **Step 2: Add parity-verifier tests**

Create `tests/geography/test_verify.py` with these test names:

```text
test_zero_mismatch_requires_all_four_destinations
test_local_mismatch_names_sku_and_field
test_supabase_missing_row_is_failure
test_live_export_mismatch_is_failure
test_magento_pipe_value_is_failure
test_taxonomy_hash_change_is_failure
test_report_is_updated_with_destination_counts
```

Use this concrete comparison test:

```python
from scripts.verify_beverage_geography import compare


def test_local_mismatch_names_sku_and_field():
    expected = {
        "LBD0006CN": {
            "country": "France",
            "region": "Cognac",
            "subregion": "Grande Champagne",
        }
    }
    actual = {
        "LBD0006CN": {
            "country": "France",
            "region": "Cognac | Grande Champagne",
            "subregion": "Grande Champagne",
        }
    }
    assert compare(expected, actual, "local") == [{
        "destination": "local",
        "sku": "LBD0006CN",
        "field": "region",
        "expected": "Cognac",
        "actual": "Cognac | Grande Champagne",
    }]
```

For integration tests, supply the same expected row through all four fixture
loaders, mutate exactly one destination per test, call `verify_batch`, and
assert `result["complete"] is False` plus the exact destination, SKU, and
field mismatch. The report test asserts all four destination labels and
mismatch counts replace the initial `not run` lines.

- [ ] **Step 3: Run tests and confirm failures**

Run:

```bash
node --test tests/magento-catalog-quality.test.mjs
.venv/bin/python -m pytest tests/geography/test_verify.py -v
```

Expected: new tests fail.

- [ ] **Step 4: Implement parity verification**

Create `scripts/verify_beverage_geography.py` with:

```python
FIELDS = ("country", "region", "subregion")


def compare(expected: dict[str, dict], actual: dict[str, dict], destination: str) -> list[dict]:
    mismatches = []
    for sku, row in expected.items():
        if sku not in actual:
            mismatches.append({"destination": destination, "sku": sku, "field": "*", "expected": "row", "actual": "missing"})
            continue
        for field in FIELDS:
            expected_value = row.get(field) or ""
            actual_value = actual[sku].get(field) or ""
            if expected_value != actual_value:
                mismatches.append({
                    "destination": destination, "sku": sku, "field": field,
                    "expected": expected_value, "actual": actual_value,
                })
    return mismatches
```

Expected rows come from applied local SQLite values, but only for approved SKUs in the batch. Load:

- SQLite with one parameterized `IN` query;
- Supabase with URL-encoded `sku=in.(SKU1,SKU2)` style filters in chunks of 100 and `select=sku,country,region,subregion`;
- live JSON from `data/live_products_export.json`;
- Magento CSV from the generated approved-batch export.

Before comparisons, verify the current taxonomy hash equals `.batch-state.json`. Reject any pipe in Magento region or subregion. Update the `Publication Verification` section of `before_after_quality_report.md` atomically with checked row counts, mismatch counts, and explicit SKU/field mismatch lines. Exit `0` only for zero mismatches at all four destinations.

- [ ] **Step 5: Run all focused tests**

Run:

```bash
node --test tests/magento-catalog-quality.test.mjs
.venv/bin/python -m pytest tests/geography -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/export-magento-catalog.mjs scripts/verify_beverage_geography.py tests/geography/test_verify.py tests/magento-catalog-quality.test.mjs
git commit -m "feat: verify geography parity across exports"
```

### Task 8: Execute the Reviewed Production Workflow

**Files:**
- Modify: `outputs/beverage-geography-2026-06-11/automatically_corrected_records.csv`
- Modify: `outputs/beverage-geography-2026-06-11/human_review_queue.csv`
- Modify: `outputs/beverage-geography-2026-06-11/before_after_quality_report.md`
- Modify: `data/db/products.db`
- Modify: `data/db/product-changelog.json`
- Modify: `data/live_products_export.json`
- Generate: `outputs/magento-catalog-2026-06-11/magento_ready_content_geography_2026-06-11.csv`

- [ ] **Step 1: Review automatic candidates**

For mechanical rows, confirm taxonomy IDs, old/new values, and reason code. For every `exact_restructure_review`, require explicit reviewer approval. Set only:

```text
reviewer_decision=approve|reject|defer
reviewer_note=<short reason>
```

Do not manually set application or publish status.

- [ ] **Step 2: Enrich the highest-priority human queue**

Research `HIGH` rows first. Add source URLs, retrieval date, fact summary, proposed basis, contradiction notes, and reviewer decision. Use one official source or two independent reputable sources for a proposed hierarchy change. Evidence-only rows stay in the human queue; they do not migrate into the automatic CSV during this first conservative batch.

For rows where AI assistance is useful, Model A receives product identity and
read-only cited sources and returns candidate `country`, `region`,
`subregion`, `geography_basis`, source URLs, and a short fact summary. Model B
receives Model A's candidate plus the canonical taxonomy path and must return
`agree`, `disagree`, or `insufficient_evidence` with contradiction notes.
Only `agree` with the required citations may be presented to the reviewer;
all other outcomes remain deferred. Neither model receives database,
Supabase, or file-write credentials, and model confidence is not an approval
signal.

- [ ] **Step 3: Freeze and dry-run the approved batch**

Run:

```bash
.venv/bin/python scripts/apply_beverage_geography.py \
  --batch-dir outputs/beverage-geography-2026-06-11 \
  --dry-run
```

Expected: every approved row passes taxonomy and source-fingerprint checks.

- [ ] **Step 4: Apply locally**

Run:

```bash
.venv/bin/python scripts/apply_beverage_geography.py \
  --batch-dir outputs/beverage-geography-2026-06-11 \
  --apply
```

Expected: a timestamped DB/changelog backup, one transaction, and `application_status=applied` only for successful rows.

- [ ] **Step 5: Re-run audit validation without replacing reviewer files**

Run the audit into a temporary directory:

```bash
.venv/bin/python scripts/audit_beverage_geography.py \
  --date 2026-06-11-post-apply \
  --output-dir /tmp/beverage-geography-2026-06-11-post-apply
```

Confirm every applied SKU is now `valid_exact`, `valid_region_only`, or `legitimately_blank`. Record post-application counts in the original report, then remove the temporary directory.

- [ ] **Step 6: Publish approved SKUs**

Run:

```bash
.venv/bin/python scripts/publish_beverage_geography.py \
  --batch-dir outputs/beverage-geography-2026-06-11 \
  --publish
```

Expected: every applied row has `publish_status=verified`. Any failure keeps the workflow incomplete and is retried with the same command after diagnosis.

- [ ] **Step 7: Refresh the live export**

Run:

```bash
.venv/bin/python scripts/refresh_live_export.py
```

Expected: the generated row count matches the products table.

- [ ] **Step 8: Generate the SKU-scoped Magento file**

Run:

```bash
node scripts/export-magento-catalog.mjs 2026-06-11 \
  --approved-batch outputs/beverage-geography-2026-06-11/automatically_corrected_records.csv
```

Expected: the Magento file contains only approved applied rows and independent geography columns.

- [ ] **Step 9: Verify zero mismatches**

Run:

```bash
.venv/bin/python scripts/verify_beverage_geography.py \
  --batch-dir outputs/beverage-geography-2026-06-11 \
  --magento-csv outputs/magento-catalog-2026-06-11/magento_ready_content_geography_2026-06-11.csv
```

Expected: exit `0`; local, Supabase, live JSON, and Magento each report zero mismatches.

- [ ] **Step 10: Run the complete regression suite**

Run:

```bash
.venv/bin/python -m pytest tests/geography tests/test_sync_to_supabase.py -v
node --test tests/magento-catalog-quality.test.mjs
npm run typecheck
```

Expected: all pass.

- [ ] **Step 11: Inspect the final diff for unrelated data churn**

Run:

```bash
git status --short
git diff --stat
git diff -- scripts data/taxonomy tests
```

Confirm no price, stock, description, classification, or unrelated taxonomy files changed.

- [ ] **Step 12: Commit the applied and verified batch**

```bash
git add \
  outputs/beverage-geography-2026-06-11 \
  outputs/magento-catalog-2026-06-11 \
  data/db/products.db \
  data/db/product-changelog.json \
  data/live_products_export.json
git commit -m "data: apply verified beverage geography batch"
```

Do not commit `.env.local`, service-role credentials, or timestamped database backups.

## Completion Gate

Do not call the catalog ready for Magento until all statements are true:

- Every active beverage has a deterministic status.
- No quarantined or ambiguous path was auto-applied.
- Every applied row was explicitly approved.
- Taxonomy hash and source fingerprints passed at apply time.
- SQLite backup and per-field changelog exist.
- Production publication used the dedicated SKU-scoped publisher.
- Live JSON was regenerated after local application.
- Magento output has separate `country`, `region`, `subregion` columns and no pipe values.
- The report shows zero mismatches for every applied SKU across all four destinations.
