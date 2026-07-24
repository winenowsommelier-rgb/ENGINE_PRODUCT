# Drive Export v2 — AI-Accessible Data Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Google Drive data folder into a clean, self-describing, correctly-sized source (in-stock-only, freshness-tiered, manifest-indexed, auto-pruned) that any Claude/ChatGPT Project, NotebookLM notebook, or ad-hoc chat session can consume.

**Architecture:** One new orchestrator (`export_drive_bundle.py`) reads a single in-memory snapshot of `data/live_products_export.json`, applies a central `is_in_stock=='1'` filter (6,206 SKUs), hands the filtered list to refactored generators that **group by `category_group`/`category_type` (never raw `classification` — Rule 12)**, writes freshness tiers (`live/` daily CSVs; `catalog/`/`slim/`/`notebooklm/` on-change JSON/text), builds a `MANIFEST.json`, hash-gates uploads against a local `.last_manifest.json`, pushes to Drive, re-fetches the manifest to verify, and auto-prunes stale files.

**Tech Stack:** Python 3 (stdlib: `json`, `csv`, `hashlib`, `sqlite3`, `pathlib`, `argparse`); Google Drive OAuth client (`google-api-python-client`, existing creds/token); `pytest`; existing `data.lib.taxonomy.sku_taxonomy.resolve`.

**Spec:** `docs/superpowers/specs/2026-07-23-drive-export-v2-design.md` (approved).

---

## Ground rules for the implementing engineer (read before Task 1)

You know Python but nothing about this codebase. Non-negotiables:

- **Rule 12 (the single most important constraint):** NEVER branch on, group by, or route on the raw `classification` field. It is stale free-text. The canonical category is `category_group` / `category_type`, already present as fields in every record of `data/live_products_export.json` (re-derived from the SKU prefix at export time). Group ONLY on those.
- **Rule 1 / Rule 6:** "done" requires proof the data landed in the destination (a re-fetch of the pushed `MANIFEST.json`), not log lines. Rule 10: `--dry-run` and a watched first run before the cron takes over.
- **$0 API spend.** This project calls no paid LLM. If you find yourself about to call Anthropic/OpenAI, stop — you've misread the plan.
- **Do not modify `products.db` or `data/live_products_export.json` writing logic** beyond the one allowlist addition in Task 1. The bundle READS the export; it never writes the DB.
- **The venv Python is** `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python3`. All `pytest`/script runs use it. From repo root you can use `.venv/bin/python3` and `.venv/bin/pytest`.
- **Commit after every green step.** Small commits. Conventional-commit messages.
- **These are NEW files mostly** — you are building a new orchestrator + a new module, and doing a surgical refactor of two existing generators. Follow existing patterns in `scripts/` (module-level `ROOT`, `main()`, print-progress style).

### Files this plan creates or modifies

| Path | Create/Modify | Responsibility |
|---|---|---|
| `scripts/lib/drive_bundle/__init__.py` | Create | Package marker for the new bundle helpers. |
| `scripts/lib/drive_bundle/instock.py` | Create | The single in-stock filter (`is_in_stock=='1'`). |
| `scripts/lib/drive_bundle/grouping.py` | Create | Rule-12-correct category-group router + Wine sub-split → filename map. Shared by all tiers. |
| `scripts/lib/drive_bundle/live_csv.py` | Create | Writes `inventory_live.csv` + `pricing_promotions_live.csv`. |
| `scripts/lib/drive_bundle/archive.py` | Create | Writes thin `products_all_archive.jsonl` (all 11,934). |
| `scripts/lib/drive_bundle/manifest.py` | Create | sha256 hashing, manifest build, `.last_manifest.json` load/save, hash-gate. |
| `scripts/lib/drive_bundle/readme.py` | Create | Renders `README.md` orientation file. |
| `scripts/export_ai_knowledge_base.py` | Modify | Expose `generate(items, out_dir)` grouping on `category_group`/`category_type`; `__main__` calls it with full list + legacy dir. |
| `scripts/export_ai_knowledge_base_slim.py` | Modify | Same refactor for slim + notebooklm; drop cross-generator TSV/prompt copy. |
| `scripts/sync_ai_knowledge_base_to_drive.py` | Modify | Add `download_file(service, file_id)` (`get_media`) + `prune_folder(...)` (`files().delete`) helpers; keep existing upload/list. |
| `scripts/export_drive_bundle.py` | Create | The orchestrator: lock → snapshot-read → filter → generate tiers → shared artifacts → manifest → hash-gated push → re-fetch verify → prune. |
| `scripts/refresh_live_export.py` | Modify | Add `product_url` to `EXPORT_COLS` (empty-tolerant). |
| `scripts/scheduled_sync.sh` | Modify | One-line: call `export_drive_bundle.py` instead of `sync_ai_knowledge_base_to_drive.py`. |
| `docs/ai-knowledge-base/system_prompt.md` | Verify exists | Hand-maintained static asset the orchestrator copies (do NOT generate). |
| `tests/test_drive_bundle_instock.py` | Create | Unit: in-stock filter. |
| `tests/test_drive_bundle_grouping.py` | Create | Unit: grouping + Wine sub-split + Unknown catch-all. |
| `tests/test_drive_bundle_live_csv.py` | Create | Unit: live CSV columns/rows. |
| `tests/test_drive_bundle_manifest.py` | Create | Unit: hashing + hash-gate + first-run behavior. |
| `tests/test_drive_bundle_zero_drop_invariant.py` | Create | Integration (Rule 6): every in-stock SKU in exactly one file per tier. |

**Rationale for the `scripts/lib/drive_bundle/` package:** the orchestrator would otherwise become a 500+ line file doing filtering, grouping, CSV writing, hashing, manifest, and Drive I/O. Splitting by responsibility keeps each unit independently testable (the zero-drop invariant test imports `grouping.py` directly) and under the 500-line rule.

---

## Task 0: Baseline — confirm the world matches the spec's facts

Before writing code, verify the denominators the whole plan rests on. If any number is wrong, STOP and surface it — the spec's invariants depend on these.

- [ ] **Step 1: Confirm the export exists and the key fields are present**

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/python3 - <<'PY'
import json
data = json.load(open('data/live_products_export.json'))
items = data if isinstance(data, list) else data.get('products', [])
print('total', len(items))
sample = items[0]
for f in ('sku','is_in_stock','category_group','category_type','classification','country','price','special_price','sp_discount_pct','custom_stock_status','wn_stock'):
    print(f'  has {f}:', f in sample)
PY
```
Expected: `total 11934` (±small drift is fine); `has category_group: True`, `has category_type: True`, `has is_in_stock: True`. If `category_group`/`category_type` are missing, the export predates the taxonomy re-derivation — STOP and run `.venv/bin/python3 scripts/refresh_live_export.py` first, then re-check.

- [ ] **Step 2: Confirm the in-stock denominator and zero-Unknown claim**

Run:
```bash
.venv/bin/python3 - <<'PY'
import json
from collections import Counter
data = json.load(open('data/live_products_export.json'))
items = data if isinstance(data, list) else data.get('products', [])
instock = [p for p in items if str(p.get('is_in_stock')) == '1']
print('in_stock', len(instock))
print('groups', Counter(p.get('category_group') or 'Unknown' for p in instock))
print('blank_classification_instock', sum(1 for p in instock if not (p.get('classification') or '').strip()))
PY
```
Expected: `in_stock 6206` (spec's number; small drift acceptable — record the actual number, the tests read live counts, not a hardcode). `groups` should show real group names with **0 (or a tiny handful of) `Unknown`**. Record the actual in-stock count for use in later verification.

- [ ] **Step 3: Confirm `system_prompt.md` exists (static asset)**

Run: `ls -la "docs/ai-knowledge-base/system_prompt.md"`
Expected: file exists. If missing, STOP — the orchestrator copies it; it is not generated. (If it genuinely does not exist, surface to the user; do not fabricate one.)

No commit (read-only baseline).

---

## Task 1: Add `product_url` to the export allowlist

**Files:**
- Modify: `scripts/refresh_live_export.py` (the `EXPORT_COLS` list, ~line 51-105)

The column does not exist in the DB yet. The allowlist reader must tolerate a missing column (it already warns-and-skips columns absent from the table — see the "WARN: skipping columns not in products table" note at line 76-78). Adding it now means the day the user adds the DB column + URLs, it flows through with zero code change.

- [ ] **Step 1: Add the column to the allowlist**

In `scripts/refresh_live_export.py`, add `"product_url"` to `EXPORT_COLS`. Place it next to `image_url` (line 70, `"color", "image_url",`) since it's the same kind of per-SKU URL:

```python
    "color", "image_url", "product_url",
```

- [ ] **Step 2: Run the refresh and confirm it does not crash on the missing column**

Run:
```bash
.venv/bin/python3 scripts/refresh_live_export.py
```
Expected: completes successfully. It will print a WARN that `product_url` is not in the products table and skip it — that is the intended empty-tolerant behavior. The export still regenerates.

- [ ] **Step 3: Confirm the export still loads and row count is unchanged**

Run:
```bash
.venv/bin/python3 - <<'PY'
import json
data = json.load(open('data/live_products_export.json'))
items = data if isinstance(data, list) else data.get('products', [])
print('total', len(items))
print('product_url present in record:', 'product_url' in items[0])
PY
```
Expected: `total` unchanged from Task 0. `product_url present` may be `False` (column absent in DB) — that is fine; the live-CSV/catalog writers will emit an empty value via `.get('product_url', '')`.

- [ ] **Step 4: Commit**

```bash
git add scripts/refresh_live_export.py
git commit -m "feat(export): add product_url to EXPORT_COLS allowlist (empty-tolerant until source lands)"
```

---

## Task 2: The in-stock filter (`scripts/lib/drive_bundle/instock.py`)

**Files:**
- Create: `scripts/lib/drive_bundle/__init__.py` (empty)
- Create: `scripts/lib/drive_bundle/instock.py`
- Test: `tests/test_drive_bundle_instock.py`

The single place the `is_in_stock=='1'` rule lives. Everything downstream consumes its output. Per spec §2: the filter is `is_in_stock=='1'` ONLY — the 3 archived-but-in-stock SKUs pass, and we do not special-case them.

- [ ] **Step 1: Write the failing test**

Create `tests/test_drive_bundle_instock.py`:
```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.instock import filter_in_stock


def test_keeps_only_string_one():
    items = [
        {'sku': 'A', 'is_in_stock': '1'},
        {'sku': 'B', 'is_in_stock': '0'},
        {'sku': 'C', 'is_in_stock': None},
        {'sku': 'D'},  # missing key
    ]
    out = filter_in_stock(items)
    assert [p['sku'] for p in out] == ['A']


def test_coerces_non_string_one():
    # DB flag is TEXT '1', but be defensive if an int 1 slips in.
    items = [{'sku': 'A', 'is_in_stock': 1}, {'sku': 'B', 'is_in_stock': '1'}]
    out = filter_in_stock(items)
    assert {p['sku'] for p in out} == {'A', 'B'}


def test_archived_but_in_stock_passes():
    # spec §2: 3 archived (custom_stock_status='CATALOG') SKUs are is_in_stock='1'
    # and MUST pass the filter — not special-cased.
    items = [{'sku': 'A', 'is_in_stock': '1', 'custom_stock_status': 'CATALOG'}]
    out = filter_in_stock(items)
    assert [p['sku'] for p in out] == ['A']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_drive_bundle_instock.py -v`
Expected: FAIL — `ModuleNotFoundError: scripts.lib.drive_bundle.instock`.

- [ ] **Step 3: Create the package + implementation**

Create `scripts/lib/drive_bundle/__init__.py` (empty file).

Create `scripts/lib/drive_bundle/instock.py`:
```python
"""Central in-stock filter for the Drive export bundle.

The ONLY definition of "sellable" for this bundle: is_in_stock == '1'
(canonical per scripts/refresh_live_export.py). Archived-but-in-stock SKUs
(custom_stock_status='CATALOG' with is_in_stock='1') intentionally pass — they
are technically sellable and are not special-cased (see spec sec 2).
"""
from __future__ import annotations


def filter_in_stock(items: list[dict]) -> list[dict]:
    """Return only records whose is_in_stock flag equals '1'."""
    return [p for p in items if str(p.get('is_in_stock')) == '1']
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_drive_bundle_instock.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/drive_bundle/__init__.py scripts/lib/drive_bundle/instock.py tests/test_drive_bundle_instock.py
git commit -m "feat(drive-bundle): central is_in_stock=='1' filter with tests"
```

---

## Task 3: The Rule-12 grouping router (`scripts/lib/drive_bundle/grouping.py`)

**Files:**
- Create: `scripts/lib/drive_bundle/grouping.py`
- Test: `tests/test_drive_bundle_grouping.py`

This is the heart of the Rule-12 fix. It maps each record to exactly one output filename **using `category_group` (+ a Wine sub-split by `category_type`/country)**, with an `Unknown` catch-all so no SKU is ever dropped. This module is shared by all three tiers so the zero-drop guarantee is proven once.

**Design of the filename map** (from spec §4 taxonomy). The function `file_for(record) -> str` returns a bare filename stem (no extension, no `products_` prefix handling — callers add prefix/extension). Rules, in order:

1. If `category_group` is falsy/unknown → `unknown`.
2. If `category_group == 'Wine'`, sub-split:
   - `category_type` in Red-Wine set → `wine_red_france` / `wine_red_italy` / `wine_red_world` by `country`.
   - `category_type` in White-Wine set → `wine_white_france` / `wine_white_world` by `country`.
   - `category_type` in Sparkling set → `wine_sparkling`. **The canonical value is the single string `'Sparkling & Champagne'`** (verified 448 in-stock / 930 catalog-wide; `'Sparkling Wine'` and `'Champagne'` occur 0 times — do NOT use them).
   - everything else under Wine (`'Rosé Wine'`, `'Sweet/Dessert'`, `'Fortified'`, `'Orange Wine'`, `'Wine Set'`) → `wine_other`.
3. Otherwise map `category_group` → one of: `whisky`, `spirits`, `liqueur`, `sake_asian`, `beer_rtd`, `non_alcoholic`, `accessories`, `cigars`.

> **IMPORTANT — verify the real `category_type` / `category_group` string values before hardcoding sets.** The exact strings come from `data.lib.taxonomy.sku_taxonomy`. Step 1 below dumps them so your sets match reality (e.g. is it `'Sake & Asian'` or `'Sake/Asian'`? `'Beer & RTD'`?). The sparkling/other-wine strings above were verified against the live export — but re-confirm in Step 1, and **the actual dumped string always wins over any literal in this plan (including the test literals below)**. A wrong wine `category_type` string does NOT drop the SKU (it falls to `wine_other`), so the zero-drop invariant test will NOT catch it — the ONLY guard is matching these strings exactly. Do NOT guess.

- [ ] **Step 1: Discover the exact group/type strings (read-only, informs the code)**

Run:
```bash
.venv/bin/python3 - <<'PY'
import json
from collections import Counter, defaultdict
data = json.load(open('data/live_products_export.json'))
items = [p for p in (data if isinstance(data, list) else data['products']) if str(p.get('is_in_stock'))=='1']
print('=== category_group counts (in-stock) ===')
for g, n in Counter(p.get('category_group') or 'Unknown' for p in items).most_common():
    print(f'  {g!r}: {n}')
print('=== category_type within Wine ===')
wine = [p for p in items if p.get('category_group') == 'Wine']
for t, n in Counter(p.get('category_type') or 'Unknown' for p in wine).most_common():
    print(f'  {t!r}: {n}')
PY
```
Record the exact strings. Use them verbatim in the sets below. If a group name differs from the spec's label (spec used display-ish names), the ACTUAL string from this dump wins.

- [ ] **Step 2: Write the failing test**

Create `tests/test_drive_bundle_grouping.py`. Use the real strings from Step 1 where noted:
```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.grouping import file_for, ALL_FILE_STEMS


def test_unknown_group_falls_through():
    assert file_for({'category_group': None}) == 'unknown'
    assert file_for({'category_group': ''}) == 'unknown'
    assert file_for({}) == 'unknown'


def test_red_wine_country_split():
    base = {'category_group': 'Wine', 'category_type': 'Red Wine'}
    assert file_for({**base, 'country': 'France'}) == 'wine_red_france'
    assert file_for({**base, 'country': 'Italy'}) == 'wine_red_italy'
    assert file_for({**base, 'country': 'Australia'}) == 'wine_red_world'
    assert file_for({**base, 'country': None}) == 'wine_red_world'


def test_white_wine_country_split():
    base = {'category_group': 'Wine', 'category_type': 'White Wine'}
    assert file_for({**base, 'country': 'France'}) == 'wine_white_france'
    assert file_for({**base, 'country': 'Chile'}) == 'wine_white_world'


def test_sparkling_and_other_wine():
    # Canonical value is the SINGLE string 'Sparkling & Champagne' (verified).
    assert file_for({'category_group': 'Wine', 'category_type': 'Sparkling & Champagne'}) == 'wine_sparkling'
    # Anything else under Wine -> wine_other
    assert file_for({'category_group': 'Wine', 'category_type': 'Rosé Wine'}) == 'wine_other'
    assert file_for({'category_group': 'Wine', 'category_type': 'Sweet/Dessert'}) == 'wine_other'


def test_non_wine_groups_map_to_single_files():
    # Left side = REAL category_group strings from Step 1.
    assert file_for({'category_group': 'Whisky'}) == 'whisky'
    assert file_for({'category_group': 'Spirits'}) == 'spirits'
    assert file_for({'category_group': 'Liqueur'}) == 'liqueur'
    assert file_for({'category_group': 'Cigars'}) == 'cigars'


def test_every_stem_is_registered():
    # ALL_FILE_STEMS is the closed set the manifest/prune logic trusts.
    assert 'unknown' in ALL_FILE_STEMS
    assert 'wine_red_world' in ALL_FILE_STEMS
    assert file_for({'category_group': 'Whisky'}) in ALL_FILE_STEMS
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_drive_bundle_grouping.py -v`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `grouping.py`**

Create `scripts/lib/drive_bundle/grouping.py`. **Replace the placeholder sets/map with the exact strings you recorded in Step 1.**
```python
"""Rule-12-correct file router for the Drive export bundle.

Groups a product record to exactly ONE output filename stem using
category_group / category_type (derived from the SKU prefix), NEVER the raw
`classification` free-text field (spec sec 3, project Rule 12). Every record
resolves to a stem; unmapped groups fall through to 'unknown' so no SKU is
ever dropped.

The exact category_group / category_type string values were verified against
data/live_products_export.json (see plan Task 3 Step 1). If the taxonomy adds a
new group, it lands in 'unknown' until added here — the zero-drop invariant
test will still pass (unknown is a real file), and the row-count warning will
flag the surprise.
"""
from __future__ import annotations

# --- category_type sets within the Wine group (use REAL strings from Step 1) ---
RED_WINE_TYPES = {'Red Wine'}
WHITE_WINE_TYPES = {'White Wine'}
# Verified canonical value is the SINGLE string 'Sparkling & Champagne'
# (448 in-stock). NOT 'Sparkling Wine'/'Champagne' — those never occur. Confirm
# in Step 1 and use whatever the dump shows.
SPARKLING_TYPES = {'Sparkling & Champagne'}
# Everything else under Wine ('Rosé Wine', 'Sweet/Dessert', 'Fortified',
# 'Orange Wine', 'Wine Set') falls through to 'wine_other' — no explicit set needed.

# --- non-Wine category_group -> single file stem (use REAL group strings) ---
GROUP_TO_STEM = {
    'Whisky': 'whisky',
    'Spirits': 'spirits',
    'Liqueur': 'liqueur',
    'Sake & Asian': 'sake_asian',       # <-- confirm exact string in Step 1
    'Beer & RTD': 'beer_rtd',           # <-- confirm exact string in Step 1
    'Non-Alcoholic': 'non_alcoholic',   # <-- confirm exact string in Step 1
    'Accessories': 'accessories',
    'Cigars': 'cigars',
}

# Closed set of every stem the router can emit — the manifest & prune logic
# trust this. Keep in sync with the logic below.
ALL_FILE_STEMS = {
    'wine_red_france', 'wine_red_italy', 'wine_red_world',
    'wine_white_france', 'wine_white_world',
    'wine_sparkling', 'wine_other',
    *GROUP_TO_STEM.values(),
    'unknown',
}


def file_for(record: dict) -> str:
    """Return the bare filename stem (no prefix/extension) for one record."""
    group = (record.get('category_group') or '').strip()
    if not group:
        return 'unknown'

    if group == 'Wine':
        ctype = (record.get('category_type') or '').strip()
        country = (record.get('country') or '').strip()
        if ctype in RED_WINE_TYPES:
            if country == 'France':
                return 'wine_red_france'
            if country == 'Italy':
                return 'wine_red_italy'
            return 'wine_red_world'
        if ctype in WHITE_WINE_TYPES:
            return 'wine_white_france' if country == 'France' else 'wine_white_world'
        if ctype in SPARKLING_TYPES:
            return 'wine_sparkling'
        return 'wine_other'

    return GROUP_TO_STEM.get(group, 'unknown')


def group_records(items: list[dict]) -> dict[str, list[dict]]:
    """Bucket records by file stem. Empty stems are omitted (a file with zero
    rows is not written), EXCEPT callers that need the closed set use
    ALL_FILE_STEMS directly."""
    out: dict[str, list[dict]] = {}
    for rec in items:
        out.setdefault(file_for(rec), []).append(rec)
    return out
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_drive_bundle_grouping.py -v`
Expected: PASS. If a non-wine test fails, your `GROUP_TO_STEM` key doesn't match the real string from Step 1 — fix the key, not the test.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/drive_bundle/grouping.py tests/test_drive_bundle_grouping.py
git commit -m "feat(drive-bundle): Rule-12 category_group router + Wine sub-split (never classification)"
```

---

## Task 4: Live CSV writer (`scripts/lib/drive_bundle/live_csv.py`)

**Files:**
- Create: `scripts/lib/drive_bundle/live_csv.py`
- Test: `tests/test_drive_bundle_live_csv.py`

Writes the two daily flat feeds. Columns are fixed by spec §4. `product_url` emitted empty until the source lands. No promo-validity column (does not exist — spec §4).

- [ ] **Step 1: Write the failing test**

Create `tests/test_drive_bundle_live_csv.py`:
```python
import sys, os, csv
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.live_csv import write_live_csvs, INVENTORY_COLS, PRICING_COLS


def test_writes_both_files_with_fixed_columns(tmp_path):
    items = [
        {'sku': 'A', 'name': 'Wine A', 'is_in_stock': '1',
         'custom_stock_status': '', 'wn_stock': '', 'category_group': 'Wine',
         'category_type': 'Red Wine', 'price': 500, 'special_price': 450,
         'sp_discount_pct': 10, 'currency': 'THB'},
    ]
    write_live_csvs(items, str(tmp_path))
    inv = list(csv.DictReader(open(tmp_path / 'inventory_live.csv')))
    pri = list(csv.DictReader(open(tmp_path / 'pricing_promotions_live.csv')))
    assert list(inv[0].keys()) == INVENTORY_COLS
    assert list(pri[0].keys()) == PRICING_COLS
    assert inv[0]['sku'] == 'A'
    assert pri[0]['price'] == '500'


def test_product_url_empty_when_absent(tmp_path):
    items = [{'sku': 'A', 'is_in_stock': '1'}]
    write_live_csvs(items, str(tmp_path))
    inv = list(csv.DictReader(open(tmp_path / 'inventory_live.csv')))
    assert inv[0]['product_url'] == ''


def test_row_count_matches_input(tmp_path):
    items = [{'sku': str(i), 'is_in_stock': '1'} for i in range(50)]
    write_live_csvs(items, str(tmp_path))
    inv = list(csv.DictReader(open(tmp_path / 'inventory_live.csv')))
    assert len(inv) == 50
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_drive_bundle_live_csv.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `live_csv.py`**

Create `scripts/lib/drive_bundle/live_csv.py`:
```python
"""Daily live commercial feeds: inventory + pricing/promotions.

Flat CSVs, cheap to diff and push. Columns are fixed (spec sec 4). product_url
is emitted empty until the user supplies real URLs (auto-populates then). There
is NO promo-validity column — the DB has no such field (do not invent one).
"""
from __future__ import annotations

import csv
import os

INVENTORY_COLS = [
    'sku', 'name', 'is_in_stock', 'custom_stock_status', 'wn_stock',
    'category_group', 'category_type', 'product_url',
]
PRICING_COLS = [
    'sku', 'price', 'special_price', 'sp_discount_pct', 'currency', 'product_url',
]


def _write(path: str, cols: list[str], items: list[dict]) -> None:
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        for p in items:
            w.writerow({c: ('' if p.get(c) is None else p.get(c)) for c in cols})


def write_live_csvs(items: list[dict], out_dir: str) -> dict[str, int]:
    """Write both live CSVs to out_dir. Returns {filename: row_count}."""
    os.makedirs(out_dir, exist_ok=True)
    inv_path = os.path.join(out_dir, 'inventory_live.csv')
    pri_path = os.path.join(out_dir, 'pricing_promotions_live.csv')
    _write(inv_path, INVENTORY_COLS, items)
    _write(pri_path, PRICING_COLS, items)
    return {'inventory_live.csv': len(items), 'pricing_promotions_live.csv': len(items)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_drive_bundle_live_csv.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/drive_bundle/live_csv.py tests/test_drive_bundle_live_csv.py
git commit -m "feat(drive-bundle): live inventory + pricing CSV writers (product_url empty-tolerant)"
```

---

## Task 5: Thin archive writer (`scripts/lib/drive_bundle/archive.py`)

**Files:**
- Create: `scripts/lib/drive_bundle/archive.py`
- Test: extend `tests/test_drive_bundle_live_csv.py` is wrong scope — add a tiny test file `tests/test_drive_bundle_archive.py`

Writes `products_all_archive.jsonl` — all 11,934 rows, a thin field set, one JSON object per line (JSONL streams well and diffs line-by-line). Reference-only; recommendations still draw from in-stock. Goes in `catalog/`, on-change refresh.

- [ ] **Step 1: Write the failing test**

Create `tests/test_drive_bundle_archive.py`:
```python
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.archive import write_archive_jsonl, ARCHIVE_COLS


def test_writes_one_line_per_record(tmp_path):
    items = [{'sku': str(i), 'name': f'P{i}', 'is_in_stock': '1' if i % 2 else '0',
              'category_group': 'Wine', 'price': i} for i in range(5)]
    path = write_archive_jsonl(items, str(tmp_path))
    lines = open(path).read().strip().splitlines()
    assert len(lines) == 5
    first = json.loads(lines[0])
    assert set(first.keys()) <= set(ARCHIVE_COLS)
    assert first['sku'] == '0'


def test_includes_all_rows_not_just_instock(tmp_path):
    items = [{'sku': 'IN', 'is_in_stock': '1'}, {'sku': 'OUT', 'is_in_stock': '0'}]
    path = write_archive_jsonl(items, str(tmp_path))
    skus = {json.loads(l)['sku'] for l in open(path)}
    assert skus == {'IN', 'OUT'}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_drive_bundle_archive.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `archive.py`**

Create `scripts/lib/drive_bundle/archive.py`:
```python
"""Thin full-catalog archive (ALL SKUs, in-stock or not) as JSONL.

Reference layer so nothing is lost when the live/catalog tiers are in-stock-only.
Thin field set keeps it small; recommendations never draw from here.
"""
from __future__ import annotations

import json
import os

ARCHIVE_COLS = [
    'sku', 'name', 'brand', 'category_group', 'category_type',
    'country', 'region', 'vintage', 'price', 'is_in_stock',
    'custom_stock_status', 'product_url',
]


def _thin(rec: dict) -> dict:
    return {c: rec.get(c) for c in ARCHIVE_COLS if rec.get(c) not in (None, '')}


def write_archive_jsonl(items: list[dict], out_dir: str) -> str:
    """Write products_all_archive.jsonl (one record per line). Returns path."""
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'products_all_archive.jsonl')
    with open(path, 'w') as f:
        for rec in items:
            f.write(json.dumps(_thin(rec), ensure_ascii=False))
            f.write('\n')
    return path
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_drive_bundle_archive.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/drive_bundle/archive.py tests/test_drive_bundle_archive.py
git commit -m "feat(drive-bundle): thin full-catalog archive JSONL writer (all SKUs)"
```

---

## Task 6: Manifest + hashing + hash-gate (`scripts/lib/drive_bundle/manifest.py`)

**Files:**
- Create: `scripts/lib/drive_bundle/manifest.py`
- Test: `tests/test_drive_bundle_manifest.py`

Responsibilities: sha256 a file's bytes; build the `MANIFEST.json` structure (enumerated from files actually on disk — spec §11); load/save the local `.last_manifest.json`; decide per-file whether it changed (hash-gate). `live/` + manifest always upload; catalog/slim/notebooklm gate on hash. First run / absent cache → everything treated as changed.

- [ ] **Step 1: Write the failing test**

Create `tests/test_drive_bundle_manifest.py`:
```python
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.manifest import (
    sha256_file, build_manifest, load_last_manifest, should_upload,
)


def test_sha256_changes_with_content(tmp_path):
    p = tmp_path / 'f.txt'
    p.write_text('a')
    h1 = sha256_file(str(p))
    p.write_text('b')
    h2 = sha256_file(str(p))
    assert h1 != h2 and len(h1) == 64


def test_first_run_uploads_everything():
    # No prior manifest -> every catalog/slim/notebooklm file is "changed".
    assert should_upload('catalog/products_whisky.json', 'newhash', prior=None) is True


def test_unchanged_hash_skips_static_tier():
    prior = {'files': [{'path': 'catalog/x.json', 'sha256': 'abc'}]}
    assert should_upload('catalog/x.json', 'abc', prior=prior) is False
    assert should_upload('catalog/x.json', 'def', prior=prior) is True


def test_live_and_manifest_always_upload():
    prior = {'files': [{'path': 'live/inventory_live.csv', 'sha256': 'abc'}]}
    # live/ files always upload regardless of hash match
    assert should_upload('live/inventory_live.csv', 'abc', prior=prior) is True
    assert should_upload('MANIFEST.json', 'abc', prior=prior) is True


def test_build_manifest_enumerates_disk(tmp_path):
    (tmp_path / 'live').mkdir()
    f = tmp_path / 'live' / 'inventory_live.csv'
    f.write_text('sku\nA\n')
    manifest = build_manifest(
        root=str(tmp_path),
        files=[('live/inventory_live.csv', 'live', 1)],
        total_in_stock=6206, total_all=11934, generated_at='2026-07-24T03:00:00+07:00',
        prior=None,
    )
    entry = manifest['files'][0]
    assert entry['path'] == 'live/inventory_live.csv'
    assert entry['rows'] == 1
    assert entry['tier'] == 'live'
    assert len(entry['sha256']) == 64
    assert entry['bytes'] == f.stat().st_size
    assert manifest['total_skus_in_stock'] == 6206
    assert 'source_registry.csv' in manifest['reserved_future']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_drive_bundle_manifest.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `manifest.py`**

Create `scripts/lib/drive_bundle/manifest.py`:
```python
"""Manifest construction, content hashing, and hash-gating for the bundle.

The local .last_manifest.json is the SINGLE source of truth for change
detection (never the Drive copy — spec sec 6). live/ files and MANIFEST.json
always upload; catalog/slim/notebooklm gate on sha256. Absent prior manifest
(first run / deleted cache) => every file counts as changed (full upload).
"""
from __future__ import annotations

import hashlib
import json
import os

# Spec sec 11: a no-change run uploads only live/ + MANIFEST.json. README is
# hash-gated (it changes only when the counts/date it embeds change, which is
# when catalog changes anyway), so it is NOT in the always-upload set.
ALWAYS_UPLOAD_PREFIXES = ('live/',)
ALWAYS_UPLOAD_EXACT = ('MANIFEST.json',)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def _prior_hash(path: str, prior: dict | None) -> str | None:
    if not prior:
        return None
    for e in prior.get('files', []):
        if e.get('path') == path:
            return e.get('sha256')
    return None


def should_upload(path: str, new_hash: str, prior: dict | None) -> bool:
    """True if this file must be (re)uploaded this run."""
    if path in ALWAYS_UPLOAD_EXACT:
        return True
    if any(path.startswith(p) for p in ALWAYS_UPLOAD_PREFIXES):
        return True
    return _prior_hash(path, prior) != new_hash


def _prior_updated_at(path: str, prior: dict | None) -> str | None:
    if not prior:
        return None
    for e in prior.get('files', []):
        if e.get('path') == path:
            return e.get('updated_at')
    return None


def build_manifest(root: str, files: list[tuple[str, str, int]],
                   total_in_stock: int, total_all: int,
                   generated_at: str, prior: dict | None) -> dict:
    """Build the MANIFEST.json dict.

    files: list of (relative_path, tier, row_count). Each file must exist on
    disk under `root`. bytes + sha256 are read from disk (spec sec 11: manifest
    is enumerated from files actually on disk). updated_at carries forward from
    prior when the hash is unchanged, else = generated_at.
    """
    entries = []
    catalog_hashes = []
    for rel, tier, rows in sorted(files):
        abspath = os.path.join(root, rel)
        h = sha256_file(abspath)
        changed = should_upload(rel, h, prior)
        updated_at = generated_at if changed else (_prior_updated_at(rel, prior) or generated_at)
        entries.append({
            'path': rel, 'purpose': _purpose(rel), 'tier': tier,
            'rows': rows, 'bytes': os.path.getsize(abspath),
            'sha256': h, 'updated_at': updated_at,
        })
        if tier == 'catalog':
            catalog_hashes.append(h)

    catalog_version = hashlib.sha256(''.join(sorted(catalog_hashes)).encode()).hexdigest()
    return {
        'generated_at': generated_at,
        'catalog_version': catalog_version,
        'total_skus_in_stock': total_in_stock,
        'total_skus_all': total_all,
        'freshness': {'live': 'daily', 'catalog': 'on-change',
                      'slim': 'on-change', 'notebooklm': 'on-change'},
        'files': entries,
        'reserved_future': ['source_registry.csv'],
        'usage_notes': ('Read live/ for availability & price. Read catalog/ for '
                        'tasting notes & pairing. Never recommend a SKU absent '
                        'from live/inventory_live.csv.'),
    }


def _purpose(rel: str) -> str:
    name = os.path.basename(rel)
    if name == 'inventory_live.csv':
        return 'Current stock status per in-stock SKU'
    if name == 'pricing_promotions_live.csv':
        return 'Current price & promo per in-stock SKU'
    if name == 'products_all_archive.jsonl':
        return 'Thin reference record for ALL SKUs (in-stock or not)'
    if name.startswith('products_'):
        return 'Full product detail for a category'
    if name == 'product_index_compact.tsv':
        return 'Compact SKU index — search first'
    if name.startswith('system_prompt'):
        return 'AI persona / usage instructions'
    return name


def load_last_manifest(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None  # treat a corrupt cache as first-run


def save_last_manifest(path: str, manifest: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_drive_bundle_manifest.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/drive_bundle/manifest.py tests/test_drive_bundle_manifest.py
git commit -m "feat(drive-bundle): manifest builder + sha256 hash-gate (live always, static on-change)"
```

---

## Task 7: README renderer (`scripts/lib/drive_bundle/readme.py`)

**Files:**
- Create: `scripts/lib/drive_bundle/readme.py`
- Test: none (pure string template; covered indirectly by the orchestrator smoke test in Task 11)

A short plain-language orientation file so a human or NotebookLM skimming the folder is oriented without parsing JSON (spec §5). Kept trivial — YAGNI.

- [ ] **Step 1: Implement `readme.py`**

Create `scripts/lib/drive_bundle/readme.py`:
```python
"""Render README.md — human/LLM orientation for the Drive folder (spec sec 5)."""
from __future__ import annotations


def render_readme(total_in_stock: int, total_all: int) -> str:
    # NOTE: deliberately does NOT embed a per-run timestamp — that would change
    # the README's hash every run and defeat its hash-gate. Freshness lives in
    # MANIFEST.json (generated_at). README content changes only when counts do.
    return f"""# WN/LIQ9 AI Data Sources

In-stock SKUs: {total_in_stock:,}  |  Total catalogued: {total_all:,}
See MANIFEST.json for generation time and per-file freshness.

## How to use these files

1. **Read `MANIFEST.json` first** — it lists every file, its purpose, freshness,
   row count and hash.
2. **`live/`** (refreshed DAILY) — current commercial truth:
   - `inventory_live.csv` — what is in stock right now.
   - `pricing_promotions_live.csv` — current price & any sale.
   **Never recommend a SKU that is absent from `inventory_live.csv`.**
3. **`catalog/`** (refreshed on change) — full product detail: tasting notes,
   pairing, origin. Category-split JSON + a compact TSV index. Search the TSV
   first, then open the matching category file.
4. **`slim/`** — smaller JSON for Claude/ChatGPT Projects (size-capped).
5. **`notebooklm/`** — plain-text sources for Google NotebookLM.

Live commercial data (price/stock) is deliberately separate from static product
facts, so prices can update daily without re-uploading the heavy detail files.
"""
```

- [ ] **Step 2: Sanity-check it imports and renders**

Run:
```bash
.venv/bin/python3 -c "from scripts.lib.drive_bundle.readme import render_readme; print(render_readme(6206, 11934)[:120])"
```
Expected: prints the first lines of the README. (Run from repo root.)

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/drive_bundle/readme.py
git commit -m "feat(drive-bundle): README orientation renderer"
```

---

## Task 8: Refactor the catalog generator to group by category_group (Rule 12)

**Files:**
- Modify: `scripts/export_ai_knowledge_base.py`

This is the mandatory Rule-12 refactor (spec §3). Expose `generate(items, out_dir)` that groups via `scripts.lib.drive_bundle.grouping`, writes `products_<stem>.json` + `product_index_compact.tsv`, and drops NO record (`unknown` catches the blanks/dirty). Preserve `__main__` behavior: it calls `generate()` with the FULL unfiltered list and the legacy `docs/ai-knowledge-base` dir.

- [ ] **Step 1: Write the failing test (zero-drop for this generator's `generate`)**

Add to a new `tests/test_drive_bundle_generate_catalog.py`:
```python
import sys, os, json, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.export_ai_knowledge_base import generate


def test_generate_drops_no_record_and_uses_stems(tmp_path):
    items = [
        {'sku': 'A', 'category_group': 'Wine', 'category_type': 'Red Wine', 'country': 'France', 'name': 'RA'},
        {'sku': 'B', 'category_group': 'Whisky', 'name': 'WB'},
        {'sku': 'C', 'category_group': '', 'classification': 'Mineral Water', 'name': 'MC'},  # -> unknown
    ]
    generate(items, str(tmp_path))
    seen = set()
    for path in glob.glob(str(tmp_path / 'products_*.json')):
        payload = json.load(open(path))
        for p in payload['products']:
            seen.add(p['sku'])
    assert seen == {'A', 'B', 'C'}  # zero dropped, incl. the blank-group one
    assert os.path.exists(tmp_path / 'products_unknown.json')  # catch-all written
    assert os.path.exists(tmp_path / 'products_wine_red_france.json')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_drive_bundle_generate_catalog.py -v`
Expected: FAIL — `generate` does not exist / still classification-based.

- [ ] **Step 3: Refactor `export_ai_knowledge_base.py`**

Replace the `GROUP_MAP`-based grouping. Keep `KEEP`, `clean`, `write_json`, and the `product_index_compact.tsv` writer. Introduce `generate(items, out_dir)` and route `main()` through it. Concretely:

1. At the top, add the import (adjust `sys.path` like the other bundle modules do, since this script runs standalone):
```python
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.lib.drive_bundle.grouping import group_records
```
2. Delete `GROUP_MAP` (lines ~26-68) — it is the Rule-12 offender.
3. Replace the "category JSON files" block (lines ~172-207, the `groups`/red/white/`if group is None: continue` logic) and wrap the index writers into a `generate()`:
```python
def generate(items, out_dir):
    """Write category JSON + compact TSV for `items` into out_dir.

    Groups by category_group/category_type via grouping.group_records (Rule 12);
    NEVER by classification. No record is dropped — unmapped groups land in
    products_unknown.json.
    """
    os.makedirs(out_dir, exist_ok=True)

    # compact TSV index (kept: it is category-agnostic)
    _write_compact_tsv(items, out_dir)

    total_bytes = 0
    buckets = group_records([clean(i) for i in items])
    # NOTE: clean() must preserve category_group/category_type/country so the
    # router can see them — verify KEEP includes them (Step 4).
    for stem, records in sorted(buckets.items()):
        path = os.path.join(out_dir, f'products_{stem}.json')
        total_bytes += write_json(path, records, f"{stem.replace('_', ' ')} ({len(records)} products)")
    return total_bytes
```
4. Factor the existing `product_index_compact.tsv` writer (lines ~151-168) into `_write_compact_tsv(items, out_dir)`. **Change its `Class` column** to emit `category_type` (not raw `classification`) so the index is Rule-12-clean too; keep the header label but source from `category_type`.
5. Make `main()`:
```python
def main():
    with open(SRC) as f:
        data = json.load(f)
    items = data if isinstance(data, list) else data.get('products', data.get('items', []))
    generate(items, OUT)   # full unfiltered list -> legacy dir
    print('Done.')
```
   **Drop the human-readable `product_index.md` writer** (lines ~104-149). It buckets/orders by raw `classification` + `bev_order` — a Rule-12 smell we do not want to carry forward, and the bundle does not use it (the compact TSV is the index). Removing it also deletes the last `classification`-based grouping in this file. If a future need for a human index arises, rebuild it on `category_type`. After this task, `grep -n "classification" scripts/export_ai_knowledge_base.py` should show only the `KEEP`-list membership / per-record passthrough, never a grouping or ordering branch.

- [ ] **Step 4: Ensure `clean()` preserves the routing fields**

Add `'category_group'` and `'category_type'` to the `KEEP` list (line 15-24) — they are absent. `'country'` is ALREADY in `KEEP` (line 17), so leave it. Without `category_group`/`category_type` surviving `clean()`, `group_records` sees `unknown` for everything and the country sub-split breaks. This is the single most likely bug — double-check the two group fields are added.

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_drive_bundle_generate_catalog.py -v`
Expected: PASS.

- [ ] **Step 6: Run the standalone generator end-to-end (no drop against real data)**

Run:
```bash
.venv/bin/python3 scripts/export_ai_knowledge_base.py
.venv/bin/python3 - <<'PY'
import json, glob
seen = set()
for f in glob.glob('docs/ai-knowledge-base/products_*.json'):
    for p in json.load(open(f))['products']:
        seen.add(p['sku'])
full = json.load(open('data/live_products_export.json'))
items = full if isinstance(full, list) else full['products']
allsku = {p['sku'] for p in items}
print('in files:', len(seen), 'in export:', len(allsku), 'missing:', len(allsku - seen))
PY
```
Expected: `missing: 0` — the whole catalog (all SKUs, since `main()` passes the full list) lands in some file. This proves the drop bug is gone.

- [ ] **Step 7: Commit**

```bash
git add scripts/export_ai_knowledge_base.py tests/test_drive_bundle_generate_catalog.py
git commit -m "refactor(kb): group catalog by category_group/type (Rule 12); generate(items,out_dir); zero-drop"
```

---

## Task 9: Refactor the slim/notebooklm generator (Rule 12) + drop cross-generator copy

**Files:**
- Modify: `scripts/export_ai_knowledge_base_slim.py`

Same refactor for slim + NotebookLM. Expose `generate(items, out_dir)` (slim JSON) and `generate_notebooklm(items, out_dir)` (plain text) — or a single `generate(items, slim_dir, nlm_dir)`; pick one and keep it simple. Remove the `shutil.copy2` of the TSV and `system_prompt.md` from `docs/ai-knowledge-base/` (lines ~222-231) — the orchestrator owns shared-artifact copying now (Task 11). Group via the shared router.

- [ ] **Step 1: Write the failing test**

Create `tests/test_drive_bundle_generate_slim.py`:
```python
import sys, os, json, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.export_ai_knowledge_base_slim import generate_slim, generate_notebooklm


def test_slim_groups_by_stem_zero_drop(tmp_path):
    items = [
        {'sku': 'A', 'category_group': 'Wine', 'category_type': 'White Wine', 'country': 'France', 'name': 'WA'},
        {'sku': 'B', 'category_group': 'Spirits', 'category_type': 'Gin', 'name': 'GB'},
        {'sku': 'C', 'category_group': '', 'name': 'UC'},  # unknown
    ]
    generate_slim(items, str(tmp_path))
    seen = set()
    for f in glob.glob(str(tmp_path / 'products_*.json')):
        for p in json.load(open(f))['products']:
            seen.add(p['sku'])
    assert seen == {'A', 'B', 'C'}
    assert os.path.exists(tmp_path / 'products_wine_white_france.json')


def test_notebooklm_writes_txt_zero_drop(tmp_path):
    items = [{'sku': 'A', 'category_group': 'Whisky', 'name': 'WA'},
             {'sku': 'B', 'category_group': '', 'name': 'UB'}]
    generate_notebooklm(items, str(tmp_path))
    txt = ''.join(open(f).read() for f in glob.glob(str(tmp_path / 'products_*.txt')))
    assert 'A' in txt and 'B' in txt
    assert os.path.exists(tmp_path / 'products_unknown.txt')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_drive_bundle_generate_slim.py -v`
Expected: FAIL.

- [ ] **Step 3: Refactor `export_ai_knowledge_base_slim.py`**

1. Add the `sys.path` + `from scripts.lib.drive_bundle.grouping import group_records` import (as in Task 8).
2. Delete `GROUP_MAP` and `build_groups` (the classification logic).
3. Ensure `KEEP_SLIM` includes `'category_group'`, `'category_type'`, `'country'` (country IS present; add the two group fields) so the router sees them.
4. Replace `main()`'s slim block with:
```python
def generate_slim(items, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for stem, records in sorted(group_records([clean_slim(i) for i in items]).items()):
        path = os.path.join(out_dir, f'products_{stem}.json')
        total += write_slim_json(path, records, stem.replace('_', ' '))
    return total
```
5. Replace the NotebookLM block with:
```python
def generate_notebooklm(items, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for stem, records in sorted(group_records([clean_slim(i) for i in items]).items()):
        path = os.path.join(out_dir, f'products_{stem}.txt')
        total += write_notebooklm_txt(path, records, stem.replace('_', ' ').title())
    # keep the plain-text product_index.txt writer here (it is category-agnostic),
    # but source its Type column from category_type, NOT classification.
    _write_nlm_index(items, out_dir)
    return total
```
6. **Delete the `shutil.copy2` blocks** (TSV + `system_prompt.md`, lines ~222-231) and the inline `system_prompt.txt` writer IF you move prompt-copying to the orchestrator. Simpler: leave the `system_prompt.txt` *content* generation out of the generator entirely — the orchestrator copies the static `system_prompt.md`/`.txt` (Task 11). Remove the cross-directory read of `docs/ai-knowledge-base/product_index_compact.tsv`; the orchestrator will place the TSV into slim/nlm.
7. `main()` calls `generate_slim(items, SLIM)` and `generate_notebooklm(items, NLM)` with the full list.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_drive_bundle_generate_slim.py -v`
Expected: PASS.

- [ ] **Step 5: Run standalone + confirm no cross-generator dependency remains**

Run:
```bash
.venv/bin/python3 scripts/export_ai_knowledge_base_slim.py
grep -n "ai-knowledge-base/product_index_compact.tsv\|shutil.copy2" scripts/export_ai_knowledge_base_slim.py || echo "OK: no cross-generator copy"
```
Expected: script runs; grep prints `OK: no cross-generator copy`.

- [ ] **Step 6: Commit**

```bash
git add scripts/export_ai_knowledge_base_slim.py tests/test_drive_bundle_generate_slim.py
git commit -m "refactor(kb-slim): Rule-12 grouping; generate_slim/generate_notebooklm; drop cross-generator copy"
```

---

## Task 10: Extend the Drive client — download (get_media) + prune (delete)

**Files:**
- Modify: `scripts/sync_ai_knowledge_base_to_drive.py`

Add two net-new helpers to the existing client (keep `get_drive_service`, `list_drive_files`, `upload_file`, `get_or_create_subfolder`). These are pure additions — do not change existing functions.

- [ ] **Step 1: Add `download_file` (get_media) for re-fetch verification**

Append to `scripts/sync_ai_knowledge_base_to_drive.py`:
```python
def download_file(service, file_id):
    """Download a Drive file's bytes by ID (for re-fetch verification)."""
    from googleapiclient.http import MediaIoBaseDownload
    import io
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()
```

- [ ] **Step 2: Add `prune_folder` (delete) with the two safety rails**

```python
def prune_folder(service, folder_id, keep_filenames, label,
                 do_prune=False, abort_fraction=0.40):
    """Trash files in folder_id that are NOT in keep_filenames.

    Safety rails (spec sec 6):
      - do_prune=False -> report-only: prints STALE (would delete) and touches nothing.
      - abort-on-anomaly: if keep set is empty, or stale would exceed abort_fraction
        of existing files, refuse to prune this folder and warn.
    Returns list of stale filenames (reported or trashed).
    """
    existing = list_drive_files(service, folder_id)  # {name: id}
    stale = [name for name in existing if name not in keep_filenames]
    if not stale:
        print(f"  [{label}] no stale files")
        return []

    if not keep_filenames:
        print(f"  [{label}] REFUSING to prune: manifest for this folder is EMPTY")
        return stale
    frac = len(stale) / max(len(existing), 1)
    if frac > abort_fraction:
        print(f"  [{label}] REFUSING to prune: {len(stale)}/{len(existing)} "
              f"({frac:.0%}) exceeds {abort_fraction:.0%} guard")
        return stale

    if not do_prune:
        for name in sorted(stale):
            print(f"  [{label}] STALE (would delete): {name}")
        return stale

    for name in sorted(stale):
        service.files().delete(fileId=existing[name]).execute()  # trashes (30-day recoverable)
        print(f"  [{label}] TRASHED: {name}")
    return stale
```

- [ ] **Step 3: Smoke-check the module still imports (no live Drive call)**

Run:
```bash
.venv/bin/python3 -c "import scripts.sync_ai_knowledge_base_to_drive as m; assert hasattr(m,'download_file') and hasattr(m,'prune_folder'); print('OK')"
```
Expected: `OK`. (No network — just import + attribute check.)

- [ ] **Step 4: Commit**

```bash
git add scripts/sync_ai_knowledge_base_to_drive.py
git commit -m "feat(drive): add download_file (get_media) + prune_folder (delete) with safety rails"
```

---

## Task 11: The orchestrator (`scripts/export_drive_bundle.py`)

**Files:**
- Create: `scripts/export_drive_bundle.py`

The conductor. Order (spec §3/§6): acquire lockfile → read export ONCE into memory → filter in-stock → build local tier dirs under a work root → generate live CSVs + catalog/slim/notebooklm (in-stock) + thin archive (all) → copy shared artifacts (TSV into slim/nlm, static `system_prompt.md`/`.txt`) → build MANIFEST + README → hash-gate → push (unless `--dry-run`) → re-fetch verify → prune (if `--prune`) → save `.last_manifest.json` only on success.

Build it incrementally with a `--dry-run` that never touches Drive, so every step below is testable offline.

- [ ] **Step 1: Scaffold with lock + snapshot-read + local build, `--dry-run` only**

Create `scripts/export_drive_bundle.py` with argument parsing (`--dry-run`, `--prune`), the lockfile, the single snapshot read, and local generation into a work dir (`docs/drive-bundle/` mirroring the Drive layout: `live/`, `catalog/`, `slim/`, `notebooklm/`). Wire in the modules from Tasks 2-9. For `system_prompt` copying: `shutil.copy2('docs/ai-knowledge-base/system_prompt.md', slim_dir)` and write/copy the `.txt` into `notebooklm/`.

Key skeleton (fill in fully):
```python
#!/usr/bin/env python3
"""Drive Export v2 orchestrator. See docs/superpowers/specs/2026-07-23-drive-export-v2-design.md."""
from __future__ import annotations
import argparse, json, os, shutil, sys, time
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from scripts.lib.drive_bundle.instock import filter_in_stock
from scripts.lib.drive_bundle.live_csv import write_live_csvs
from scripts.lib.drive_bundle.archive import write_archive_jsonl
from scripts.lib.drive_bundle import manifest as M
from scripts.lib.drive_bundle.readme import render_readme
from scripts import export_ai_knowledge_base as kb
from scripts import export_ai_knowledge_base_slim as kbslim

SRC = os.path.join(ROOT, 'data', 'live_products_export.json')
WORK = os.path.join(ROOT, 'docs', 'drive-bundle')
LAST_MANIFEST = os.path.expanduser('~/.config/wnlq9/.last_manifest.json')
LOCKFILE = os.path.expanduser('~/.config/wnlq9/drive_bundle.lock')
STATIC_PROMPT_MD = os.path.join(ROOT, 'docs', 'ai-knowledge-base', 'system_prompt.md')
PARENT_FOLDER_ID = '1jI0O-5sYTekqpOQBET7I_rw4XTIeaKdK'
BKK = timezone(timedelta(hours=7))


def now_iso():   # passed in, since Date.now-style calls are fine in a script
    return datetime.now(BKK).replace(microsecond=0).isoformat()


def acquire_lock():
    os.makedirs(os.path.dirname(LOCKFILE), exist_ok=True)
    try:
        fd = os.open(LOCKFILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode()); os.close(fd)
        return True
    except FileExistsError:
        print(f"ERROR: lock held ({LOCKFILE}); another run in progress."); return False


def release_lock():
    try: os.remove(LOCKFILE)
    except OSError: pass
```

Then `main()`: parse args → `acquire_lock()` (exit 1 if held) → try/finally `release_lock()`. Inside: read `SRC` once → `all_items`; `instock = filter_in_stock(all_items)`; row-count sanity (warn if in-stock dropped >20% vs prior manifest's `total_skus_in_stock`); rebuild `WORK` dirs; call generators with `instock` into `catalog/`, `slim/`, `notebooklm/`; `write_archive_jsonl(all_items, catalog_dir)`; `write_live_csvs(instock, live_dir)`; copy shared TSV from `catalog/` into `slim/` and `notebooklm/`; copy `STATIC_PROMPT_MD` into `slim/`, and the `.txt` into `notebooklm/`.

- [ ] **Step 2: Enumerate files → build manifest + README → save nothing yet**

After generation, walk `WORK` to build the `files` list `[(rel_path, tier, rows), ...]`. Determine `rows` per file: CSV = line count − 1; `.jsonl` = line count; `products_*.json` = `len(json.load()['products'])`; TSV = line count − 1; prompt files = 0. `prior = M.load_last_manifest(LAST_MANIFEST)`. `manifest = M.build_manifest(WORK, files, len(instock), len(all_items), now_iso(), prior)`. Write `MANIFEST.json` + `README.md` into `WORK`.

- [ ] **Step 3: Run `--dry-run` and eyeball the bundle (Rule 10 canary)**

Run:
```bash
.venv/bin/python3 scripts/export_drive_bundle.py --dry-run
.venv/bin/python3 - <<'PY'
import json, glob, os
root='docs/drive-bundle'
m=json.load(open(os.path.join(root,'MANIFEST.json')))
print('in_stock', m['total_skus_in_stock'], 'all', m['total_skus_all'], 'files', len(m['files']))
for e in m['files'][:6]:
    print(' ', e['tier'], e['path'], e['rows'], e['bytes'])
# zero-drop spot check across catalog
seen=set()
for f in glob.glob(os.path.join(root,'catalog','products_*.json')):
    for p in json.load(open(f))['products']: seen.add(p['sku'])
inv=[l.split(',')[0] for l in open(os.path.join(root,'live','inventory_live.csv')).read().splitlines()[1:]]
print('catalog skus', len(seen), 'inventory rows', len(inv), 'inv-not-in-catalog', len(set(inv)-seen))
PY
```
Expected: `total_skus_in_stock` ≈ your Task 0 number (~6,206); `inv-not-in-catalog 0`. Manifest lists ~15 catalog files + live + slim + nlm. NO Drive call happened. If `inv-not-in-catalog` > 0, the grouping dropped a SKU — fix before proceeding (this is the invariant Task 12 formalizes).

- [ ] **Step 4: Commit the offline orchestrator**

```bash
git add scripts/export_drive_bundle.py
git commit -m "feat(drive-bundle): orchestrator local build + manifest + --dry-run canary"
```

- [ ] **Step 5: Add the Drive push (hash-gated), re-fetch verify, and prune**

Extend `main()` (only when NOT `--dry-run`): `service = get_drive_service()`; ensure subfolders `live/catalog/slim/notebooklm` exist (`get_or_create_subfolder`); for each manifest file, `M.should_upload(...)` decides upload vs skip (`MANIFEST.json` + `live/*` always upload; `README.md` is hash-gated like the static tiers). Print a per-file table: `UPLOAD/skip  path  rows  bytes`.

Then **re-fetch verify** (Rule 1/6): re-list the root, find the uploaded `MANIFEST.json` id, `download_file(service, id)`, parse, assert `total_skus_in_stock == len(instock)` and file count matches — with up to 3 retries + short `time.sleep` backoff for read-after-write lag. On mismatch after retries → print FAIL, `release_lock()`, `sys.exit(1)`.

Then **prune** each folder: `prune_folder(service, folder_id, keep_filenames_for_that_folder, label, do_prune=args.prune)`. Root folder's keep-set = `{'MANIFEST.json','README.md'}` plus subfolder names are folders (not files) so they are excluded from `list_drive_files` file listing — verify `list_drive_files` only returns non-folder files; if it also returns folders, filter them out in the prune keep logic. **This is what sweeps the old flat-root `products_*.json` + `wines_red_*` files.**

Finally, **only on full success**: `M.save_last_manifest(LAST_MANIFEST, manifest)`.

- [ ] **Step 6: Guard the prune keep-set against trashing subfolders**

Run this check while writing Step 5 — confirm `list_drive_files` returns only files (its query has no folder filter). If it returns subfolders too, they'd be "stale" at root and get trashed. Add `and mimeType != 'application/vnd.google-apps.folder'` to the query in `list_drive_files`, OR exclude folder names from the root keep computation. Document which you chose in a code comment. (Prefer editing `list_drive_files`'s query — it's the safer, single-point fix. Note this is a change to an existing function; keep it minimal.)

- [ ] **Step 7: Commit the push + verify + prune**

```bash
git add scripts/export_drive_bundle.py scripts/sync_ai_knowledge_base_to_drive.py
git commit -m "feat(drive-bundle): hash-gated push + re-fetch verify + opt-in prune"
```

---

## Task 12: The zero-drop invariant test (Rule 6, all tiers)

**Files:**
- Create: `tests/test_drive_bundle_zero_drop_invariant.py`

The canonical Rule-6 end-to-end invariant. Runs the real generators on the real in-stock set and asserts: every in-stock SKU appears in `inventory_live.csv` AND in exactly one file per tier. This is the regression guard against the old `if group is None: continue` drop.

- [ ] **Step 1: Write the invariant test**

Create `tests/test_drive_bundle_zero_drop_invariant.py`:
```python
import sys, os, json, glob, csv
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.instock import filter_in_stock
from scripts.lib.drive_bundle.live_csv import write_live_csvs
from scripts.export_ai_knowledge_base import generate as gen_catalog
from scripts.export_ai_knowledge_base_slim import generate_slim, generate_notebooklm

EXPORT = os.path.join(os.path.dirname(__file__), '..', 'data', 'live_products_export.json')


def _load_instock():
    data = json.load(open(EXPORT))
    items = data if isinstance(data, list) else data.get('products', [])
    return filter_in_stock(items)


def test_every_instock_sku_in_live_and_exactly_one_file_per_tier(tmp_path):
    instock = _load_instock()
    assert len(instock) > 5000, "sanity: expected thousands of in-stock SKUs"
    expected = {p['sku'] for p in instock}

    # live
    live = tmp_path / 'live'
    write_live_csvs(instock, str(live))
    inv = {r['sku'] for r in csv.DictReader(open(live / 'inventory_live.csv'))}
    assert inv == expected

    # each tier: exactly one file per SKU, zero dropped
    for gen, out, pattern in [
        (gen_catalog,       tmp_path / 'catalog',    'products_*.json'),
        (generate_slim,     tmp_path / 'slim',       'products_*.json'),
        (generate_notebooklm, tmp_path / 'nlm',      'products_*.txt'),
    ]:
        os.makedirs(out, exist_ok=True)
        gen(instock, str(out))
        placement = {}
        for path in glob.glob(str(out / pattern)):
            if path.endswith('.json'):
                skus = [p['sku'] for p in json.load(open(path))['products']]
            else:
                skus = [ln.split('SKU: ', 1)[1].strip()
                        for ln in open(path) if ln.startswith('SKU: ')]
            for s in skus:
                placement.setdefault(s, []).append(os.path.basename(path))
        dropped = expected - set(placement)
        dupes = {s: f for s, f in placement.items() if len(f) > 1}
        assert not dropped, f"{out.name}: {len(dropped)} in-stock SKUs in ZERO files: {list(dropped)[:5]}"
        assert not dupes, f"{out.name}: SKUs in >1 file: {list(dupes.items())[:5]}"


def test_sparkling_file_is_not_empty(tmp_path):
    # Guards the mis-file class of bug the zero-drop test can't catch: a wrong
    # sparkling category_type string routes SKUs to wine_other, leaving
    # products_wine_sparkling.json empty. Spec sizes it at ~448 in-stock.
    instock = _load_instock()
    gen_catalog(instock, str(tmp_path))
    spark = tmp_path / 'products_wine_sparkling.json'
    assert spark.exists(), "no sparkling file — category_type string mismatch?"
    assert len(json.load(open(spark))['products']) > 100, \
        "sparkling file suspiciously small — check SPARKLING_TYPES matches real category_type"
```

- [ ] **Step 2: Run it**

Run: `.venv/bin/pytest tests/test_drive_bundle_zero_drop_invariant.py -v`
Expected: PASS. If `dropped` fires, a real in-stock SKU has a `category_group` your router doesn't map — it should have fallen to `unknown` (which IS a file), so a failure here means `unknown` isn't being written or `clean()`/`clean_slim()` stripped `category_group`. Fix the generator, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/test_drive_bundle_zero_drop_invariant.py
git commit -m "test(drive-bundle): Rule-6 zero-drop invariant across live + all 3 tiers"
```

---

## Task 13: Wire into the nightly schedule

**Files:**
- Modify: `scripts/scheduled_sync.sh` (Step 3 block, lines 35-41)

One-line swap: call the orchestrator instead of the old sync script. Keep `--prune` OFF for the first scheduled runs (spec §6: enable only after the first watched run). Add a comment noting how to enable prune.

- [ ] **Step 1: Edit Step 3 of `scheduled_sync.sh`**

Replace:
```bash
# Step 3: Sync AI knowledge base files to Google Drive
log "Step 3: Syncing AI knowledge base to Google Drive"
if "$PYTHON" scripts/sync_ai_knowledge_base_to_drive.py >> "$LOG" 2>&1; then
  log "Drive sync OK"
else
  log "ERROR: Drive sync failed"
fi
```
with:
```bash
# Step 3: Build & sync the Drive export bundle (in-stock, tiered, manifest, verify).
# Prune is intentionally OFF until the first watched run is confirmed; then add
# --prune here to auto-trash stale files (see drive-export-v2 spec sec 6).
log "Step 3: Building & syncing Drive export bundle"
if "$PYTHON" scripts/export_drive_bundle.py >> "$LOG" 2>&1; then
  log "Drive bundle sync OK"
else
  log "ERROR: Drive bundle sync failed"
fi
```

- [ ] **Step 2: Syntax-check the script**

Run: `bash -n scripts/scheduled_sync.sh && echo "OK"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add scripts/scheduled_sync.sh
git commit -m "chore(sync): route nightly Drive step through export_drive_bundle.py (prune off for first runs)"
```

---

## Task 14: Full suite + first live watched run (Rule 1/10 — proof it shipped)

**Files:** none (verification only)

- [ ] **Step 1: Run the whole bundle test suite**

Run: `.venv/bin/pytest tests/test_drive_bundle_*.py -v`
Expected: ALL PASS.

- [ ] **Step 2: Final `--dry-run` review**

Run: `.venv/bin/python3 scripts/export_drive_bundle.py --dry-run` and eyeball the printed manifest summary + one file per tier. Confirm in-stock count and ~15 catalog files.

- [ ] **Step 3: First real push (watched, NO prune)**

Run: `.venv/bin/python3 scripts/export_drive_bundle.py`
Expected: per-file upload table prints; **Drive re-fetch verify prints PASS**; exit 0. Then open `https://drive.google.com/drive/folders/1jI0O-5sYTekqpOQBET7I_rw4XTIeaKdK` and confirm `MANIFEST.json`, `README.md`, and `live/`/`catalog/`/`slim/`/`notebooklm/` subfolders exist with files. Since prune is off, old flat-root files will still be present alongside — that is expected on this run. Report the STALE-would-delete list to the user.

- [ ] **Step 4: Second run confirms hash-gate (no-change day)**

Run: `.venv/bin/python3 scripts/export_drive_bundle.py` again immediately.
Expected: `live/` + `MANIFEST.json` upload; catalog/slim/notebooklm print `skip` (unchanged by hash). This proves the on-change tier works.

- [ ] **Step 5: (After user eyeballs the stale list) enable prune once, watched**

Only after the user confirms the STALE list is correct: run `.venv/bin/python3 scripts/export_drive_bundle.py --prune`, confirm old flat-root + `wines_red_*` files are trashed, folder is clean. Then the user (or you, on request) adds `--prune` to `scheduled_sync.sh` Step 3.

- [ ] **Step 6: Report to the user (Rule 4 style, adapted — $0 spend)**

Report: total files on Drive, in-stock SKU count in `inventory_live.csv`, catalog file count, the verify-PASS confirmation, typical daily upload size (~1.7MB), and that $0 was spent. This is the "what shipped to users" proof.

---

## Notes on skills & references

- @Rule 12 — the grouping refactor (Tasks 3, 8, 9) is the whole reason `classification` is banished; if any reviewer sees a `classification ==` branch reintroduced, that's a hard fail.
- @Rule 6 — Task 12 is the canonical invariant; run it after any change to grouping or `clean()`.
- @Rule 1/10 — Task 14 (dry-run canary → watched first run → re-fetch verify) is non-negotiable before the cron owns it.
- The three `clean()`/`clean_slim()` field-preservation checks (Task 8 Step 4, Task 9 Step 3) are the single most likely source of a silent mis-grouping — verify them explicitly.
