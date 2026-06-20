# Canonical SKU Taxonomy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SKU prefix the single source of truth for product category across every process, replacing the unreliable `classification` field, via one canonical JSON map consumed by a Python loader and a TypeScript loader.

**Architecture:** A versioned `data/taxonomy/sku_prefix_map.json` holds the 41-prefix → `{group, type}` table + a `letter_fallback`. A pure Python module and a pure TS module both read that JSON and expose identical `resolve(sku)`/`group_for`/`type_for`. A shared fixture drives parity tests. `refresh_live_export.py` (and a one-time backfill) write `category_group` + `category_type` into `live_products_export.json`. The existing `apps/catalog/lib/category-groups.ts` becomes a thin wrapper over the TS loader (breaking change: 4 new groups, ~797 products re-grouped); its consumers migrate to read `category_group`. An audit script lists SKU-vs-classification mismatches for the data team.

**Tech Stack:** Python 3.9 (stdlib `json`; tests via `pytest`, repo-root `conftest.py`), TypeScript/Node (catalog reads JSON via `fs.readFileSync`; tests via `vitest`).

**Spec:** `docs/superpowers/specs/2026-06-20-canonical-sku-taxonomy-design.md` — read §3 (the 41-prefix table), §3.1 (type-level refinements), §4.1 (consumer dispositions) before starting.

**Reference skills:** @superpowers:test-driven-development (every task is RED→GREEN→commit), @superpowers:verification-before-completion (Task 7 browser-verify).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `data/taxonomy/sku_prefix_map.json` | Source of truth: 41 prefixes → `{group,type}` + `letter_fallback` + `version` | 1 |
| `data/lib/taxonomy/__init__.py` | package marker | 2 |
| `data/lib/taxonomy/sku_taxonomy.py` | Python loader: `resolve`, `group_for`, `type_for`, `unmapped_prefixes`, `refine_type` | 2 |
| `tests/test_sku_taxonomy.py` | Python unit + completeness + count invariants | 2 |
| `tests/fixtures/sku_taxonomy_cases.json` | Shared fixture: `sku → {group,type}` (drives Python AND TS parity) | 2 |
| `apps/catalog/lib/sku-taxonomy.ts` | TS loader: same API, reads the same JSON | 3 |
| `apps/catalog/lib/__tests__/sku-taxonomy.test.ts` | TS unit + parity against the shared fixture | 3 |
| `scripts/apply_category_taxonomy.py` | One-time backfill: write `category_group`/`category_type` to the export | 4 |
| `tests/test_apply_category_taxonomy.py` | backfill merge logic | 4 |
| `scripts/refresh_live_export.py` | Add category fields on every refresh (drift-proof) | 5 |
| `scripts/taxonomy_audit.py` | Mismatch report (SKU-derived type vs classification) | 6 |
| `apps/catalog/lib/category-groups.ts` | Re-home onto sku-taxonomy.ts; expand `CategoryGroup` union to 10 | 7 |
| catalog consumers (page/Filters/Footer/shop-query/facets/finder) | Read `category_group`/`category_type` | 7 |

**Type-refinement rules (§3.1), implemented once in `refine_type` (Python) + mirrored in TS:**
- WDW: name matches `port|marsala|madeira|sherry|oloroso|amontillado|fino` (word-ish) → type `Fortified`; else `Sweet/Dessert`.
- LBD: name has `cognac` → `Cognac`; `armagnac` → `Armagnac`; else `Brandy`.
- LWS/LSN: type `Thai Rice Spirit`.
- All other prefixes use their static `type` from the JSON.

---

## Task 1: The canonical JSON map

**Files:**
- Create: `data/taxonomy/sku_prefix_map.json`

- [ ] **Step 1: Create the map file** with all 41 prefixes (from spec §3) + fallback + version. Types reflect §3.1 (WDW/LBD/LWS get a *base* type that `refine_type` may override per-product; the JSON type is the default).

```json
{
  "version": 1,
  "prefixes": {
    "WRW": {"group": "Wine", "type": "Red Wine"},
    "WWW": {"group": "Wine", "type": "White Wine"},
    "WSP": {"group": "Wine", "type": "Sparkling & Champagne"},
    "WRS": {"group": "Wine", "type": "Rosé Wine"},
    "WDW": {"group": "Wine", "type": "Sweet/Dessert"},
    "WOW": {"group": "Wine", "type": "Orange Wine"},
    "WBS": {"group": "Wine", "type": "Wine Set"},
    "WNA": {"group": "Non-Alcoholic", "type": "De-alcoholised Wine"},
    "LWH": {"group": "Whisky", "type": "Whisky"},
    "LWF": {"group": "Whisky", "type": "Whisky"},
    "LGN": {"group": "Spirits", "type": "Gin"},
    "LVK": {"group": "Spirits", "type": "Vodka"},
    "LTQ": {"group": "Spirits", "type": "Tequila"},
    "LRM": {"group": "Spirits", "type": "Rum"},
    "LBD": {"group": "Spirits", "type": "Brandy"},
    "LGP": {"group": "Spirits", "type": "Grappa"},
    "LCC": {"group": "Spirits", "type": "Cachaça"},
    "LAB": {"group": "Spirits", "type": "Absinthe"},
    "LWS": {"group": "Spirits", "type": "Thai Rice Spirit"},
    "LSN": {"group": "Spirits", "type": "Thai Rice Spirit"},
    "LWL": {"group": "Spirits", "type": "Baijiu"},
    "LAQ": {"group": "Spirits", "type": "Aquavit"},
    "LBS": {"group": "Spirits", "type": "Spirit Set"},
    "LLQ": {"group": "Liqueur", "type": "Liqueur"},
    "LSK": {"group": "Sake & Asian", "type": "Sake / Shochu"},
    "LSJ": {"group": "Sake & Asian", "type": "Shochu"},
    "LOT": {"group": "Sake & Asian", "type": "Umeshu"},
    "LKS": {"group": "Sake & Asian", "type": "Makgeolli"},
    "LBE": {"group": "Beer & RTD", "type": "Beer"},
    "LRD": {"group": "Beer & RTD", "type": "Ready-to-Drink"},
    "NNA": {"group": "Non-Alcoholic", "type": "Mixer / Soft"},
    "MNA": {"group": "Non-Alcoholic", "type": "Tonic / Mineral Water"},
    "CIG": {"group": "Cigars", "type": "Cigar"},
    "WEV": {"group": "Events", "type": "Event"},
    "ABA": {"group": "Accessories", "type": "Bar Tools & Gifts"},
    "GWN": {"group": "Accessories", "type": "Glassware"},
    "GLQ": {"group": "Accessories", "type": "Glassware"},
    "GDC": {"group": "Accessories", "type": "Glassware"},
    "GBE": {"group": "Accessories", "type": "Glassware"},
    "GWA": {"group": "Accessories", "type": "Glassware"},
    "AWC": {"group": "Accessories", "type": "Wine Coolers & Fridges"}
  },
  "letter_fallback": {"W": "Wine", "L": "Spirits", "G": "Accessories", "A": "Accessories", "C": "Cigars"}
}
```

- [ ] **Step 2: Sanity-check it parses and has 41 prefixes**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -c "import json; d=json.load(open('data/taxonomy/sku_prefix_map.json')); print(len(d['prefixes']))"`
Expected: `41`

- [ ] **Step 3: Commit**

```bash
git add data/taxonomy/sku_prefix_map.json
git commit -m "feat(taxonomy): canonical SKU-prefix map (41 prefixes, 10 groups)"
```

---

## Task 2: Python loader (TDD)

**Files:**
- Create: `data/lib/taxonomy/__init__.py` (empty), `data/lib/taxonomy/sku_taxonomy.py`
- Create: `tests/test_sku_taxonomy.py`, `tests/fixtures/sku_taxonomy_cases.json`

- [ ] **Step 1: Write the failing test** (`tests/test_sku_taxonomy.py`)

```python
from data.lib.taxonomy.sku_taxonomy import resolve, group_for, type_for, unmapped_prefixes

def _p(sku, name=""): return {"sku": sku, "name": name}

def test_red_wine_resolves():
    assert resolve(_p("WRW0001")) == {"group": "Wine", "type": "Red Wine"}

def test_longest_prefix_first_wev_beats_w():
    # WEV must be Events, not Wine (letter-fallback W).
    assert group_for("WEV0001") == "Events"

def test_liqueur_own_group():
    assert resolve(_p("LLQ0001")) == {"group": "Liqueur", "type": "Liqueur"}

def test_wdw_fortified_by_name():
    assert resolve(_p("WDW0001", "Cantine Pellegrino Marsala Superiore"))["type"] == "Fortified"

def test_wdw_sweet_default():
    assert resolve(_p("WDW0002", "Massolino Moscato D'Asti"))["type"] == "Sweet/Dessert"

def test_lbd_cognac_by_name():
    assert resolve(_p("LBD0001", "Courvoisier VSOP Cognac"))["type"] == "Cognac"

def test_lws_thai_rice_spirit():
    assert type_for("LWS0001") == "Thai Rice Spirit"

def test_unknown_L_prefix_falls_back_to_spirits():
    assert group_for("LXX0001") == "Spirits"

def test_unknown_N_prefix_is_unknown_not_nonalcoholic():
    # N/M have no letter_fallback — unknown N**/M** => Unknown, not a guess.
    assert group_for("NXX0001") == "Unknown"

def test_blank_sku_is_unknown():
    assert resolve(_p(""))["group"] == "Unknown"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -m pytest tests/test_sku_taxonomy.py -q`
Expected: collection error — `No module named 'data.lib.taxonomy.sku_taxonomy'`

- [ ] **Step 3: Implement the loader** (`data/lib/taxonomy/sku_taxonomy.py`)

```python
"""Canonical SKU-prefix taxonomy — Python loader. SKU is the source of truth.

Reads data/taxonomy/sku_prefix_map.json. resolve(product) -> {group, type}.
Per-product type refinements (§3.1) live in refine_type.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
MAP_PATH = REPO_ROOT / "data" / "taxonomy" / "sku_prefix_map.json"

# §3.1 name-keyword refinements
_FORTIFIED = re.compile(r"\b(port|marsala|madeira|sherry|oloroso|amontillado|fino)\b", re.I)


@lru_cache(maxsize=1)
def _load() -> dict:
    return json.loads(MAP_PATH.read_text())


def _prefix3(sku: str) -> str:
    return (sku or "").upper()[:3]


def refine_type(prefix: str, base_type: str, name: str) -> str:
    """Apply §3.1 per-product type rules. Deterministic, name-keyword based."""
    n = (name or "")
    if prefix == "WDW":
        return "Fortified" if _FORTIFIED.search(n) else "Sweet/Dessert"
    if prefix == "LBD":
        nl = n.lower()
        if "cognac" in nl:
            return "Cognac"
        if "armagnac" in nl:
            return "Armagnac"
        return "Brandy"
    return base_type


def resolve(product: dict) -> dict:
    """Return {'group','type'} for a product. SKU prefix wins; classification ignored."""
    data = _load()
    sku = (product.get("sku") or "").upper()
    if not sku.strip():
        return {"group": "Unknown", "type": "Unknown"}
    p3 = _prefix3(sku)
    entry = data["prefixes"].get(p3)
    if entry is not None:
        return {"group": entry["group"],
                "type": refine_type(p3, entry["type"], product.get("name", ""))}
    # fallback by first letter; N/M (single-prefix families) are NOT in the table
    grp = data["letter_fallback"].get(sku[:1], "Unknown")
    return {"group": grp, "type": "Unknown"}


def group_for(sku: str) -> str:
    return resolve({"sku": sku})["group"]


def type_for(sku: str) -> str:
    return resolve({"sku": sku})["type"]


def unmapped_prefixes(products: list) -> list:
    """3-char prefixes seen in products but absent from the map (audit)."""
    data = _load()
    known = set(data["prefixes"])
    seen = {}
    for p in products:
        p3 = _prefix3((p.get("sku") or ""))
        if p3 and p3 not in known:
            seen[p3] = seen.get(p3, 0) + 1
    return sorted(seen)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -m pytest tests/test_sku_taxonomy.py -q`
Expected: PASS (10 tests)

- [ ] **Step 5: Add the count-invariant + completeness tests** (append to the test file)

```python
import json as _json
from pathlib import Path as _Path

EXPORT = _Path(__file__).resolve().parent.parent / "data" / "live_products_export.json"
EXPECTED_GROUP_COUNTS = {
    "Wine": 6983, "Spirits": 1177, "Accessories": 893, "Whisky": 847,
    "Sake & Asian": 663, "Liqueur": 378, "Beer & RTD": 232,
    "Non-Alcoholic": 151, "Cigars": 102, "Events": 10,
}
DIVERGENT = ["LBE","LKS","LLQ","LOT","LRD","LSJ","LSK","LWF","LWH","WEV","WNA"]

def test_group_counts_match_spec_exactly():
    prods = _json.loads(EXPORT.read_text())
    import collections
    counts = collections.Counter(resolve(p)["group"] for p in prods)
    assert dict(counts) == EXPECTED_GROUP_COUNTS

def test_no_unmapped_prefixes_in_live_data():
    prods = _json.loads(EXPORT.read_text())
    assert unmapped_prefixes(prods) == []

def test_divergent_prefixes_have_explicit_entries():
    # Each diverges from its letter-fallback; a missing entry would silently misroute.
    data = _json.loads((_Path(__file__).resolve().parent.parent / "data" / "taxonomy" / "sku_prefix_map.json").read_text())
    for pre in DIVERGENT:
        assert pre in data["prefixes"], f"{pre} missing — would misroute via letter-fallback"
```

- [ ] **Step 6: Generate the shared parity fixture** (`tests/fixtures/sku_taxonomy_cases.json`) — one real SKU per prefix + the refinement cases, with expected `{group,type}`. Generate it from the data so it's grounded:

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -c "
import json, sys; sys.path.insert(0,'.')
from data.lib.taxonomy.sku_taxonomy import resolve
prods=json.load(open('data/live_products_export.json'))
seen={}; cases=[]
for p in prods:
    pre=(p.get('sku') or '').upper()[:3]
    if pre and pre not in seen:
        seen[pre]=1
        cases.append({'sku':p['sku'],'name':p.get('name',''),'expected':resolve(p)})
# REQUIRED: explicit §3.1 refinement cases so the parity test guards the riskiest
# TS/Python drift surface (default-type-per-prefix alone would NOT exercise these).
def add_case(sku,name):
    cases.append({'sku':sku,'name':name,'expected':resolve({'sku':sku,'name':name})})
add_case('WDW9001','Cantine Pellegrino Marsala Superiore')   # -> Wine/Fortified
add_case('WDW9002','Massolino Moscato D Asti')               # -> Wine/Sweet/Dessert
add_case('LBD9001','Courvoisier VSOP Cognac')                # -> Spirits/Cognac
add_case('LBD9002','Chabot XO Armagnac')                     # -> Spirits/Armagnac
add_case('LBD9003','Vecchia Romagna Brandy')                 # -> Spirits/Brandy
add_case('LWS9001','KAO HOM Chaiyaphum')                     # -> Spirits/Thai Rice Spirit
json.dump({'cases':cases}, open('tests/fixtures/sku_taxonomy_cases.json','w'), ensure_ascii=False, indent=1)
print('wrote', len(cases), 'cases (41 prefixes + 6 refinement cases)')
"
```
Expected: `wrote 47 cases (41 prefixes + 6 refinement cases)`.

- [ ] **Step 7: Run full Python suite, verify GREEN**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -m pytest tests/test_sku_taxonomy.py -q`
Expected: PASS (13 tests)

- [ ] **Step 8: Commit**

```bash
git add data/lib/taxonomy/ tests/test_sku_taxonomy.py tests/fixtures/sku_taxonomy_cases.json
git commit -m "feat(taxonomy): Python loader + count/completeness invariants + parity fixture"
```

---

## Task 3: TypeScript loader (TDD, parity)

**Files:**
- Create: `apps/catalog/lib/sku-taxonomy.ts`, `apps/catalog/lib/__tests__/sku-taxonomy.test.ts`

- [ ] **Step 1: Write the failing test** (mirrors the Python cases + drives the shared fixture)

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolve, groupFor, typeFor } from '../sku-taxonomy';

describe('sku-taxonomy', () => {
  it('resolves red wine', () => {
    expect(resolve({ sku: 'WRW0001', name: '' })).toEqual({ group: 'Wine', type: 'Red Wine' });
  });
  it('WEV beats W (longest-prefix-first)', () => {
    expect(groupFor('WEV0001')).toBe('Events');
  });
  it('Liqueur is its own group', () => {
    expect(groupFor('LLQ0001')).toBe('Liqueur');
  });
  it('WDW fortified by name', () => {
    expect(resolve({ sku: 'WDW1', name: 'Pellegrino Marsala' }).type).toBe('Fortified');
  });
  it('LBD cognac by name', () => {
    expect(resolve({ sku: 'LBD1', name: 'Courvoisier Cognac' }).type).toBe('Cognac');
  });
  it('unknown N prefix is Unknown, not Non-Alcoholic', () => {
    expect(groupFor('NXX0001')).toBe('Unknown');
  });

  // PARITY: every shared fixture case must match exactly (guards TS/Py drift)
  it('matches the shared Python fixture for all prefixes', () => {
    const fx = JSON.parse(readFileSync(
      join(__dirname, '../../../../tests/fixtures/sku_taxonomy_cases.json'), 'utf8'));
    for (const c of fx.cases) {
      expect(resolve({ sku: c.sku, name: c.name })).toEqual(c.expected);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/__tests__/sku-taxonomy.test.ts`
Expected: FAIL — cannot find `../sku-taxonomy`.

- [ ] **Step 3: Implement** (`apps/catalog/lib/sku-taxonomy.ts`) — reads the same JSON at module load; mirror `refine_type` exactly.

```typescript
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const CATEGORY_GROUPS = [
  'Wine', 'Whisky', 'Spirits', 'Sake & Asian', 'Liqueur',
  'Beer & RTD', 'Non-Alcoholic', 'Cigars', 'Events', 'Accessories',
] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number] | 'Unknown';

type Entry = { group: string; type: string };
// Robust multi-candidate resolver — MIRRORS exportPath() in catalog-data.ts.
// cwd is repo root in the SSG/Vercel build, apps/catalog in local dev. Probe both.
function mapPath(): string {
  const candidates = [
    join(process.cwd(), 'data', 'taxonomy', 'sku_prefix_map.json'),             // cwd = repo root
    join(process.cwd(), '..', '..', 'data', 'taxonomy', 'sku_prefix_map.json'), // cwd = apps/catalog
    process.env.CATALOG_TAXONOMY_PATH ?? '',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('sku_prefix_map.json not found in any known location');
  return found;
}
const MAP = JSON.parse(readFileSync(mapPath(), 'utf8'))
  as { prefixes: Record<string, Entry>; letter_fallback: Record<string, string> };

const FORTIFIED = /\b(port|marsala|madeira|sherry|oloroso|amontillado|fino)\b/i;

function refineType(prefix: string, base: string, name: string): string {
  const n = name || '';
  if (prefix === 'WDW') return FORTIFIED.test(n) ? 'Fortified' : 'Sweet/Dessert';
  if (prefix === 'LBD') {
    const nl = n.toLowerCase();
    if (nl.includes('cognac')) return 'Cognac';
    if (nl.includes('armagnac')) return 'Armagnac';
    return 'Brandy';
  }
  return base;
}

export function resolve(product: { sku?: string | null; name?: string | null }): { group: CategoryGroup; type: string } {
  const sku = (product.sku || '').toUpperCase();
  if (!sku.trim()) return { group: 'Unknown', type: 'Unknown' };
  const p3 = sku.slice(0, 3);
  const entry = MAP.prefixes[p3];
  if (entry) return { group: entry.group as CategoryGroup, type: refineType(p3, entry.type, product.name || '') };
  const grp = (MAP.letter_fallback[sku[0]] as CategoryGroup) || 'Unknown';
  return { group: grp, type: 'Unknown' };
}

export const groupFor = (sku: string): CategoryGroup => resolve({ sku }).group;
export const typeFor = (sku: string): string => resolve({ sku }).type;
```

> NOTE: `mapPath()` mirrors `exportPath()` in `catalog-data.ts` (verified: that
> function probes `cwd/data`, `cwd/../../data`, and an env override). This handles
> both local dev (cwd = `apps/catalog`) and the SSG build (cwd = repo root) up
> front, so the build won't fail on path resolution.

- [ ] **Step 4: Run to verify GREEN**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/apps/catalog" && npx vitest run lib/__tests__/sku-taxonomy.test.ts`
Expected: PASS (parity test confirms TS == Python for all 41 prefixes)

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/sku-taxonomy.ts apps/catalog/lib/__tests__/sku-taxonomy.test.ts
git commit -m "feat(taxonomy): TS loader + Python-parity test (reads same JSON)"
```

---

## Task 4: Backfill the current export (one-time, TDD)

**Files:**
- Create: `scripts/apply_category_taxonomy.py`, `tests/test_apply_category_taxonomy.py`

- [ ] **Step 1: Write the failing test**

```python
from scripts.apply_category_taxonomy import add_category_fields

def test_adds_group_and_type():
    p = {"sku": "LWH0001", "name": "Lagavulin", "classification": "Wine product"}
    out = add_category_fields(p)
    assert out["category_group"] == "Whisky"
    assert out["category_type"] == "Whisky"

def test_classification_left_untouched():
    p = {"sku": "ABA0001", "name": "Shelf", "classification": "Wine product"}
    out = add_category_fields(p)
    assert out["category_group"] == "Accessories"
    assert out["classification"] == "Wine product"  # advisory, preserved

def test_does_not_mutate_input():
    p = {"sku": "WRW0001"}
    add_category_fields(p)
    assert "category_group" not in p
```

- [ ] **Step 2: Run, verify FAIL** — `No module named 'scripts.apply_category_taxonomy'`.

- [ ] **Step 3: Implement** (`scripts/apply_category_taxonomy.py`) — backup, add fields via the loader, write compact (match P1–P4 convention).

```python
#!/usr/bin/env python3
"""One-time backfill: write category_group/category_type onto the live export.

SKU-derived (data/taxonomy). classification is left untouched (advisory).
"""
from __future__ import annotations
import argparse, json, shutil, sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from data.lib.taxonomy.sku_taxonomy import resolve  # noqa: E402

DEFAULT_EXPORT = REPO_ROOT / "data" / "live_products_export.json"


def add_category_fields(product: dict) -> dict:
    out = dict(product)
    r = resolve(product)
    out["category_group"] = r["group"]
    out["category_type"] = r["type"]
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    products = json.loads(args.export.read_text())
    updated = [add_category_fields(x) for x in products]
    import collections
    counts = collections.Counter(x["category_group"] for x in updated)
    print("group counts:", dict(counts.most_common()))
    if args.dry_run:
        print("--dry-run: nothing written."); return 0
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = args.export.with_suffix(args.export.suffix + f".bak-pre-taxonomy-{ts}")
    shutil.copy2(args.export, backup)
    print("Backup:", backup)
    args.export.write_text(json.dumps(updated, ensure_ascii=False))
    print("Wrote category_group/category_type to", args.export)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run, verify GREEN** — `pytest tests/test_apply_category_taxonomy.py -q` → PASS (3).

- [ ] **Step 5: Dry-run against real data, eyeball counts**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python scripts/apply_category_taxonomy.py --dry-run`
Expected: counts match spec §3 (Wine 6983, Spirits 1177, … Events 10). NO "Wine product" group, NO "Unknown".

- [ ] **Step 6: Apply for real**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python scripts/apply_category_taxonomy.py`
Expected: backup printed; fields written.

- [ ] **Step 7: VERIFY in the export (Rule 1 — fresh read, not the script's count)**

Run:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -c "
import json, collections
prods=json.load(open('data/live_products_export.json'))
print('total:', len(prods))
print('have category_group:', sum(1 for p in prods if p.get('category_group')))
print('effective Wine product:', sum(1 for p in prods if p.get('category_group')=='Wine product'))
print('Unknown group:', sum(1 for p in prods if p.get('category_group')=='Unknown'))
print(dict(collections.Counter(p['category_group'] for p in prods).most_common()))
"
```
Expected: all 11,436 have `category_group`; 0 "Wine product"; 0 "Unknown"; counts == §3.

- [ ] **Step 8: Run the Python count-invariant test (now reads the backfilled export)** — `pytest tests/test_sku_taxonomy.py::test_group_counts_match_spec_exactly -q` → PASS.

- [ ] **Step 9: Commit (code + data separately)**

```bash
git add scripts/apply_category_taxonomy.py tests/test_apply_category_taxonomy.py
git commit -m "feat(taxonomy): one-time backfill of category_group/category_type"
git add data/live_products_export.json
git commit -m "data(taxonomy): backfill category_group/category_type on 11,436 products"
```

---

## Task 5: Drift-proof the refresh pipeline

**Files:**
- Modify: `scripts/refresh_live_export.py` (record-build loop, ~line 100-120)

- [ ] **Step 1: Add a failing integration test** (`tests/test_refresh_export_canonical.py` already exists for P4 — add a case there)

```python
def test_refresh_writes_category_fields(tmp_path):
    db = tmp_path / "products.db"; out = tmp_path / "export.json"
    _make_db(db)  # reuse the existing helper; ensure a row has sku 'LWH0001'
    import scripts.refresh_live_export as refresh
    assert refresh.main(["--db", str(db), "--out", str(out)]) == 0
    rows = {r["sku"]: r for r in json.loads(out.read_text())}
    assert rows["A2"]["category_group"]  # every row gets a group
```
(Adjust to the existing fixture SKUs; ensure at least one is a recognizable prefix.)

- [ ] **Step 2: Run, verify FAIL** (no `category_group` written yet).

- [ ] **Step 3: Implement** — in the record loop (after the P4 `flavor_tags_canonical` block, before `records.append(rec)`), add:

```python
        # Canonical taxonomy: SKU-derived group/type on every refresh.
        from data.lib.taxonomy.sku_taxonomy import resolve as _resolve  # top-level import preferred
        _r = _resolve(rec)
        rec["category_group"] = _r["group"]
        rec["category_type"] = _r["type"]
```
(Hoist the import to the module top alongside the existing taxonomy/vocab imports; guard like the P4 import so a refresh never hard-fails if the map is briefly missing.)

- [ ] **Step 4: Run, verify GREEN** — `pytest tests/test_refresh_export_canonical.py -q` → PASS.

- [ ] **Step 5: Add a tally line** in the refresh summary (mirror the P4 `flavor_tags_canonical` print): `print(f"  category_group set: {sum(1 for r in records if r.get('category_group'))}")`.

- [ ] **Step 6: Commit**

```bash
git add scripts/refresh_live_export.py tests/test_refresh_export_canonical.py
git commit -m "feat(taxonomy): refresh pipeline re-derives category_group/type every run"
```

---

## Task 6: Mismatch audit report (no spend, advisory)

**Files:**
- Create: `scripts/taxonomy_audit.py`

- [ ] **Step 1: Implement** — list products where SKU-derived type disagrees with `classification` (the cleanup list for the data team). No test needed beyond a smoke run (it's a read-only report; @superpowers:test-driven-development exception: reporting script).

```python
#!/usr/bin/env python3
"""Advisory report: products whose SKU-derived category disagrees with the
Magento `classification` field. Code never trusts classification; this is a
human cleanup list. No spend, read-only."""
from __future__ import annotations
import json, sys, collections
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path: sys.path.insert(0, str(REPO_ROOT))
from data.lib.taxonomy.sku_taxonomy import resolve, unmapped_prefixes

prods = json.loads((REPO_ROOT / "data" / "live_products_export.json").read_text())
wine_product = [p for p in prods if (p.get("classification") or "") == "Wine product"]
print(f"'Wine product' rows reclassified by SKU: {len(wine_product)}")
by_group = collections.Counter(resolve(p)["group"] for p in wine_product)
print("  -> now correctly:", dict(by_group.most_common()))
unmapped = unmapped_prefixes(prods)
print(f"unmapped prefixes (need explicit map entries): {unmapped or 'none'}")
```

- [ ] **Step 2: Run it, confirm it reports** (the ~1,509 "Wine product" rows now spread across real groups; 0 unmapped).

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python scripts/taxonomy_audit.py`
Expected: prints the reclassification breakdown; `unmapped prefixes: none`.

- [ ] **Step 3: Commit** — `git add scripts/taxonomy_audit.py && git commit -m "feat(taxonomy): SKU-vs-classification mismatch audit report"`

---

## Task 7: Migrate the catalog (breaking change → 10 groups)

> This is the breaking migration (spec §2/§4.1). `CategoryGroup` gains 4 values (Cigars, Events, Non-Alcoholic, Liqueur); consumers must read `category_group` from the product data instead of deriving from `classification`. Do this consumer-by-consumer; the app must build green at the end.

**Files:**
- Modify: `apps/catalog/lib/category-groups.ts` (re-home onto sku-taxonomy.ts)
- Modify: `apps/catalog/lib/catalog-data.ts` + `apps/catalog/lib/types.ts` (allowlist, Step 0)
- Modify: `apps/catalog/app/page.tsx`, `apps/catalog/app/product/[sku]/page.tsx`, `apps/catalog/components/Footer.tsx`, `apps/catalog/components/Filters.tsx`, `apps/catalog/lib/shop-query.ts`, `apps/catalog/lib/shop-facets.ts`, `apps/catalog/lib/facets.ts`, `apps/catalog/lib/finder/category-map.ts`, **`apps/catalog/lib/recommender.ts`** (spec §4.1 VERIFY: its "same `classification` +1" rule and classification bucketing → switch to `category_type` so same-type scoring is correct)

> **SCOPE — this plan migrates the CATALOG (TypeScript) consumers only.** The
> Python consumers in spec §4.1 are a separate follow-up plan, EXCEPT one that is
> correctness-critical and must be done with this work:
> - **`lib/curation/hard_filter.py` (MIGRATE, do in this plan as Task 7b below)** —
>   it hard-filters by `classification`; left unmigrated it would wrongly
>   include/exclude the 1,509 mislabeled rows in curation runs.
> - **Deferred to a follow-up plan (flagged, not silently dropped):**
>   `pairing_resolver.py`, `affinity_resolver.py`, `rationale_writer.py`,
>   `scripts/derive_spirit_style.py`, `data/enrich_wines.py`, `app/api/products/**`.
>   Each must eventually MIGRATE or be confirmed display-only per §4.1; none is
>   blocked by leaving it for now (they read the same export, which now carries
>   `category_group`/`category_type` for them to adopt).

- [ ] **Step 0: Expose the category fields through the allowlist chokepoint (BLOCKING — without this the fields are stripped before any consumer sees them).** `apps/catalog/lib/catalog-data.ts` projects every product through `toPublicProduct()`, copying ONLY keys in `PUBLIC_FIELDS` (lines 13-20). Add `'category_group','category_type'` to `PUBLIC_FIELDS`, AND add `category_group?: string;` + `category_type?: string;` to `PublicProduct` in `apps/catalog/lib/types.ts` (the `_AssertFieldsAreKnown` drift guard at types lines 24-26 / catalog-data line 25 will fail to compile if you add to one but not the other — that's the guard working). Run `cd apps/catalog && npx tsc --noEmit` → expect no error. **Decision recorded:** consumers read the export-provided `category_group`/`category_type` (written by Tasks 4/5), NOT a runtime `resolve()` call — keeps the catalog reading one source (the export) and matches every other enrichment field (flavor_tags_canonical, taste_profile). The `groupForProduct(p)` shim (Step 1) is for any caller that still wants to derive from SKU directly, but the primary path is the allowlisted field.

- [ ] **Step 1: Re-home `category-groups.ts`** — re-export `CATEGORY_GROUPS`, `CategoryGroup`, `resolve`, `groupFor` from `sku-taxonomy.ts`. Keep `groupForProduct(p)` as a back-compat shim that returns `resolve(p).group` (SKU-derived; works even without the export field). Delete the SKU_PREFIX_TO_GROUP / CLASSIFICATION_TO_GROUP tables (their truth now lives in the JSON). **`ACCESSORY_SUBCATEGORY` (used by `shop-query.ts:116` + `facets.ts:52` via `accessoryCategoryForSku`) — see W5 handling in Step 1a; do NOT just delete it.** **Fix the LOT→Bar Tools bug in passing: LOT is now Sake & Asian/Umeshu via the map, so REMOVE the `['LOT', ...]` row from any retained `ACCESSORY_SUBCATEGORY` table — it must no longer be treated as an accessory.**

- [ ] **Step 1a: Reconcile accessory sub-categories (value mapping, not just "move it").** The old `ACCESSORY_SUBCATEGORY` emits strings like `Wine Fridges & Coolers` / `Bar Tools & Gifts`; the new JSON `category_type` for accessory prefixes emits `Wine Coolers & Fridges` / `Bar Tools & Gifts` / `Glassware`. If `accessoryCategoryForSku` is kept, its returned values MUST match whatever `shop-query.ts`/`facets.ts` compare against, or the Accessories drill-down silently returns empty. Choose ONE: (a) point the accessory drilldown at `category_type` and update its expected-value strings to the JSON's types; or (b) keep `accessoryCategoryForSku` but re-derive it from `category_type` with an explicit old→new value map. Add/adjust the relevant test in `category-groups.test.ts` to assert the chosen values. Verify the Accessories filter returns non-empty in Step 7.

- [ ] **Step 2: Verify existing catalog tests still pass / update them** — `cd apps/catalog && npx vitest run lib/__tests__/category-groups.test.ts`. Update expectations to the 10-group model (e.g. CIG → Cigars, NNA → Non-Alcoholic). Expected: GREEN after updates.

- [ ] **Step 3: Migrate each consumer to read `category_group`/`category_type`** from the product (the loader output is already on every product after Task 4/5). For each file, replace `classification`-based category logic with `product.category_group` / `product.category_type`. Per §4.1 dispositions. Run `npx vitest run` after each file.

- [ ] **Step 4: Typecheck the whole catalog** — `cd apps/catalog && npx tsc --noEmit`. Expected: no errors (the `CategoryGroup` union change surfaces any missed consumer here).

- [ ] **Step 5: Full catalog test suite** — `cd apps/catalog && npm run test`. Expected: all green.

- [ ] **Step 6: Production build (verifies the JSON path resolves in build context)** — `cd apps/catalog && npm run build`. Expected: SSG build succeeds; if the `sku-taxonomy.ts` JSON read fails, apply the robust-path fallback noted in Task 3 Step 3.

- [ ] **Step 7: Browser-verify (Rule 7 — REQUIRED, @superpowers:verification-before-completion)** — `npm run start`, open the shop:
  - Top nav / filters show the 10 groups (or the agreed presentation — at minimum no crash, correct grouping).
  - A previously-"Wine product" whisky (e.g. Johnnie Walker, SKU `LWH*`) now appears under **Whisky**, not Wine.
  - A bar tool (`ABA*`) appears under **Accessories**, not as wine.
  - The Type filter populates from `category_type`.
  "It compiles" is not done — confirm in the browser.

- [ ] **Step 8: Margin-leak gate still clean** (taxonomy fields are safe, but confirm the build didn't regress) — `grep -rl "margin_pct\|b2b_margin" apps/catalog/.next || echo CLEAN` → `CLEAN`.

- [ ] **Step 9: Commit**

```bash
git add apps/catalog
git commit -m "feat(catalog): migrate category nav/filters/finder to SKU-derived category_group (10 groups)"
```

---

## Task 7b: Migrate curation `hard_filter.py` (correctness-critical, TDD)

> `lib/curation/hard_filter.py:26-29` filters candidates by substring-matching
> `query.category_filter` against `classification`. With 1,509 mislabeled rows,
> curation runs silently include/exclude the wrong products. Switch to
> `category_group`/`category_type`.

**Files:**
- Modify: `lib/curation/hard_filter.py`
- Test: `tests/curation/` (add/extend the hard_filter test)

- [ ] **Step 1: Write the failing test** — a whisky row classified "Wine product" must pass a `category_filter=["Whisky"]` and be excluded by `category_filter=["Wine"]`.

```python
def test_hard_filter_uses_category_group_not_classification():
    from lib.curation.hard_filter import hard_filter
    from lib.curation.models import StructuredQuery  # adjust import to actual
    wh = {"sku":"LWH0001","classification":"Wine product","category_group":"Whisky",
          "is_in_stock":"1","price":1000}
    # NOTE: StructuredQuery requires raw_brief (positional, no default — see models.py:7-9).
    q = StructuredQuery(raw_brief="test", category_filter=["Whisky"])   # adjust to actual signature
    assert wh in hard_filter([wh], q)
    q2 = StructuredQuery(raw_brief="test", category_filter=["Wine"])
    assert wh not in hard_filter([wh], q2)
```
(Inspect `lib/curation/models.py` for the real `StructuredQuery` constructor before writing.)

- [ ] **Step 2: Run, verify FAIL** (current code matches on classification "Wine product" → wrong result).

- [ ] **Step 3: Implement** — replace lines 26-29 category block:

```python
        if query.category_filter:
            grp = p.get("category_group", "")
            typ = p.get("category_type", "")
            hay = f"{grp} {typ}".lower()
            if not any(f.lower() in hay for f in query.category_filter):
                continue
```
(Falls back gracefully: if `category_group` is absent on a record, the match simply fails closed — acceptable, since every export row now has it. Do NOT read `classification` here anymore.)

- [ ] **Step 4: Run, verify GREEN** — `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python -m pytest tests/curation -q` → PASS.

- [ ] **Step 5: Commit** — `git add lib/curation/hard_filter.py tests/curation && git commit -m "fix(curation): hard_filter category gate uses category_group, not classification"`

---

## Done criteria
- [ ] `data/taxonomy/sku_prefix_map.json` is the only place the prefix→category mapping lives.
- [ ] Python + TS loaders pass identical parity fixtures (no drift).
- [ ] `live_products_export.json`: every row has `category_group`/`category_type`; 0 "Wine product"; 0 "Unknown"; counts == spec §3.
- [ ] `refresh_live_export.py` re-derives the fields every run (drift-proof).
- [ ] Catalog builds, all tests green, browser-verified: misclassified items now appear in their correct group.
- [ ] `category_group`/`category_type` are in `PUBLIC_FIELDS` + `PublicProduct` (reach the browser).
- [ ] `classification` is never read for category logic in the catalog OR `hard_filter.py` (only displayed / audited).
- [ ] Curation `hard_filter` gates on `category_group`/`category_type` (Task 7b).
- [ ] Remaining Python consumers (pairing/affinity/rationale/derive_spirit_style/enrich/api) flagged as a follow-up plan, not silently left.
- [ ] Audit report available for the data team.
