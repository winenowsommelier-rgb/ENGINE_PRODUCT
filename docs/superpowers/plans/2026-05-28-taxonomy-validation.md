# Taxonomy Validation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `data/enrich_taxonomy.py` with Layer 0 (Wikidata), Layer 3 (Sonnet web-search for S1/S2 brands), per-field provenance tracking, and `taxonomy_validation_status` flagging.

**Architecture:** Four new modules + wiring into the existing CLI driver. Wikidata is downloaded once and cached as a local JSON file. Sonnet validates only S1/S2 brand-tier SKUs where confidence is uncertain. Every filled field gets a `taxonomy_provenance` entry recording its source and confidence.

**Tech Stack:** Python 3.10+, `urllib.request` (SPARQL — no new deps), existing `AnthropicClient`, `data/brand_description_library.csv` for brand tier lookup.

**Spec:** `docs/superpowers/specs/2026-05-28-taxonomy-validation-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `data/build_wikidata_appellations.py` | **Create** | One-time SPARQL downloader |
| `data/lib/enrichment/taxonomy/wikidata_appellations.json` | **Generate** | Cached reference (~2K records) |
| `data/lib/enrichment/taxonomy/wikidata_lookup.py` | **Create** | Lookup: name → region/subregion from Wikidata cache |
| `data/lib/enrichment/taxonomy/sonnet_validator.py` | **Create** | Sonnet web-search validator for S1/S2 SKUs |
| `data/enrich_taxonomy.py` | **Modify** | Wire Layer 0 + Layer 3 + provenance + flags |
| `tests/test_taxonomy_wikidata.py` | **Create** | Unit tests for wikidata_lookup |
| `tests/test_taxonomy_sonnet_validator.py` | **Create** | Unit tests for sonnet_validator (mock API) |

---

## Task A: Wikidata downloader + lookup module

**Files:**
- Create: `data/build_wikidata_appellations.py`
- Create: `data/lib/enrichment/taxonomy/wikidata_lookup.py`
- Generate: `data/lib/enrichment/taxonomy/wikidata_appellations.json`
- Test: `tests/test_taxonomy_wikidata.py`

The Wikidata SPARQL endpoint (`https://query.wikidata.org/sparql`) returns wine appellations with their country, region, and subregion. We download this once and cache it locally. The lookup module does fuzzy name matching against the cached data.

### Step A1: Write failing tests

Create `tests/test_taxonomy_wikidata.py`:

```python
"""Unit tests for Wikidata appellation lookup."""
from __future__ import annotations
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Stub the JSON file with a minimal fixture so tests don't need network
_FIXTURE = [
    {"name": "Pauillac", "country": "France", "region": "Bordeaux", "subregion": "Pauillac", "wikidata_id": "Q83481"},
    {"name": "Marlborough", "country": "New Zealand", "region": "Marlborough", "subregion": "", "wikidata_id": "Q1234"},
    {"name": "Barossa Valley", "country": "Australia", "region": "South Australia", "subregion": "Barossa Valley", "wikidata_id": "Q5678"},
]

import data.lib.enrichment.taxonomy.wikidata_lookup as wl


def setup_function(fn):
    """Patch the loaded appellations with our fixture."""
    wl._APPELLATIONS = _FIXTURE
    wl._build_index()


def test_exact_appellation_match():
    result = wl.lookup("Chateau Latour Pauillac 2018", "Red Wine")
    assert result["region"] == "Bordeaux"
    assert result["subregion"] == "Pauillac"
    assert result["confidence"] >= 0.85
    assert result["wikidata_id"] == "Q83481"


def test_marlborough_match():
    result = wl.lookup("Cloudy Bay Marlborough Sauvignon Blanc", "White Wine")
    assert result["region"] == "Marlborough"
    assert result["confidence"] >= 0.85


def test_no_match_returns_empty():
    result = wl.lookup("Mystery Brand XYZ 2022", "Red Wine")
    assert result["region"] == ""
    assert result["confidence"] == 0.0


def test_non_wine_not_blocked():
    """Wikidata lookup should run for spirits too (geography still relevant)."""
    result = wl.lookup("Glenfiddich Speyside Scotch", "Whisky")
    # No match expected for this fixture, but should not crash
    assert "region" in result


def test_source_label():
    result = wl.lookup("Chateau Latour Pauillac 2018", "Red Wine")
    if result["region"]:
        assert result["source"] == "wikidata"
```

Run to verify fail:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_wikidata.py -v 2>&1 | head -20
```

Expected: ImportError.

### Step A2: Implement `wikidata_lookup.py`

Create `data/lib/enrichment/taxonomy/wikidata_lookup.py`:

```python
"""Wikidata appellation lookup for taxonomy enrichment.

Loads a pre-built JSON cache of wine appellations (built by
data/build_wikidata_appellations.py). Performs fuzzy token matching
against product names to infer region/subregion.

No network calls at runtime — purely offline lookup.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Optional

_CACHE_FILE = Path(__file__).parent / "wikidata_appellations.json"

# Loaded at import time; can be monkey-patched in tests.
_APPELLATIONS: list[dict] = []
# Index: normalised token → list of appellation dicts
_INDEX: dict[str, list[dict]] = {}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9\s]", " ", s.lower()).strip()


def _tokenize(s: str) -> list[str]:
    return [t for t in _norm(s).split() if len(t) >= 3]


def _build_index() -> None:
    _INDEX.clear()
    for appellation in _APPELLATIONS:
        name = appellation.get("name", "")
        for token in _tokenize(name):
            _INDEX.setdefault(token, []).append(appellation)


def _load() -> None:
    global _APPELLATIONS
    if not _CACHE_FILE.exists():
        _APPELLATIONS = []
        _build_index()
        return
    try:
        _APPELLATIONS = json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        _APPELLATIONS = []
    _build_index()


_load()


def lookup(name: str, classification: str) -> dict:
    """Return best Wikidata match for the product name.

    Returns:
        {
          "region": str, "subregion": str, "country": str,
          "confidence": float, "wikidata_id": str, "source": str
        }
    """
    empty = {"region": "", "subregion": "", "country": "", "confidence": 0.0, "wikidata_id": "", "source": ""}
    if not _APPELLATIONS:
        return empty

    name_tokens = set(_tokenize(name))
    best: Optional[dict] = None
    best_score = 0

    for token in name_tokens:
        for appellation in _INDEX.get(token, []):
            app_name_tokens = set(_tokenize(appellation["name"]))
            if not app_name_tokens:
                continue
            # Score = fraction of appellation tokens found in product name
            overlap = len(app_name_tokens & name_tokens)
            score = overlap / len(app_name_tokens)
            if score > best_score:
                best_score = score
                best = appellation

    if best is None or best_score < 0.7:
        return empty

    # Confidence: scale 0.85–0.95 based on match quality
    confidence = round(min(0.95, 0.85 + (best_score - 0.7) * 0.5), 2)

    return {
        "region":      best.get("region", ""),
        "subregion":   best.get("subregion", ""),
        "country":     best.get("country", ""),
        "confidence":  confidence,
        "wikidata_id": best.get("wikidata_id", ""),
        "source":      "wikidata",
    }
```

### Step A3: Run tests to verify they pass

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_wikidata.py -v
```

Expected: 5 tests PASS (with empty cache file, `no_match` tests pass; with fixture monkey-patch, match tests pass).

### Step A4: Implement `build_wikidata_appellations.py`

Create `data/build_wikidata_appellations.py`:

```python
#!/usr/bin/env python3
"""One-time downloader: fetch wine appellations from Wikidata SPARQL.

Writes data/lib/enrichment/taxonomy/wikidata_appellations.json.

Usage:
    python data/build_wikidata_appellations.py
    python data/build_wikidata_appellations.py --limit 500  # for testing
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT_FILE = Path(__file__).resolve().parent / "lib/enrichment/taxonomy/wikidata_appellations.json"

SPARQL_QUERY = """
SELECT DISTINCT ?appellation ?appellationLabel ?country ?countryLabel ?region ?regionLabel ?subregion ?subregionLabel WHERE {
  ?appellation wdt:P31/wdt:P279* wd:Q56122 .   # instance of wine appellation (or subclass)
  OPTIONAL { ?appellation wdt:P17 ?country . }
  OPTIONAL { ?appellation wdt:P131 ?region . }
  OPTIONAL { ?appellation wdt:P131 ?subregion .
             ?subregion wdt:P31/wdt:P279* wd:Q56122 . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 3000
"""


def run_sparql(query: str) -> list[dict]:
    url = "https://query.wikidata.org/sparql"
    params = urllib.parse.urlencode({"query": query, "format": "json"})
    full_url = f"{url}?{params}"
    req = urllib.request.Request(
        full_url,
        headers={"User-Agent": "WineNowTaxonomyBot/1.0 (winenowsommelier@gmail.com)"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("results", {}).get("bindings", [])


def parse_binding(b: dict) -> dict:
    def val(key: str) -> str:
        return b.get(key, {}).get("value", "")

    wikidata_id = val("appellation").split("/")[-1] if val("appellation") else ""
    return {
        "name":        val("appellationLabel"),
        "country":     val("countryLabel"),
        "region":      val("regionLabel"),
        "subregion":   val("subregionLabel"),
        "wikidata_id": wikidata_id,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=3000)
    args = ap.parse_args()

    print(f"Querying Wikidata SPARQL for wine appellations (limit {args.limit})...")
    try:
        bindings = run_sparql(SPARQL_QUERY)
    except Exception as e:
        print(f"ERROR: SPARQL query failed: {e}")
        print("Wikidata may be temporarily unavailable. Try again later.")
        raise SystemExit(1)

    records = []
    seen = set()
    for b in bindings[:args.limit]:
        r = parse_binding(b)
        if not r["name"] or r["name"] in seen:
            continue
        seen.add(r["name"])
        records.append(r)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ Wrote {len(records)} appellations to {OUT_FILE}")


if __name__ == "__main__":
    main()
```

### Step A5: Run the downloader

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/build_wikidata_appellations.py
```

Expected: "✓ Wrote NNN appellations to ..." (likely 300–2000 records).

If Wikidata is unavailable, create a minimal stub:
```bash
echo "[]" > "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/lib/enrichment/taxonomy/wikidata_appellations.json"
```
The lookup module handles empty cache gracefully (returns no match, pipeline continues).

### Step A6: Verify lookup works on real data

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python3 -c "
from data.lib.enrichment.taxonomy.wikidata_lookup import lookup
tests = [
    ('Chateau Petrus Pomerol 2015', 'Red Wine'),
    ('Dr Loosen Mosel Riesling 2020', 'White Wine'),
    ('Glenfiddich 15 Year Speyside', 'Whisky'),
]
for name, cls in tests:
    r = lookup(name, cls)
    print(f'{name[:40]:40s} → region={r[\"region\"]!r:20s} conf={r[\"confidence\"]:.2f}')
"
```

### Step A7: Re-run wikidata tests with real cache

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_wikidata.py -v
```

### Step A8: Commit

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/build_wikidata_appellations.py data/lib/enrichment/taxonomy/wikidata_lookup.py data/lib/enrichment/taxonomy/wikidata_appellations.json tests/test_taxonomy_wikidata.py && git commit -m "feat(taxonomy): add Wikidata Layer 0 — appellation lookup + downloader"
```

---

## Task B: Sonnet web-search validator

**Files:**
- Create: `data/lib/enrichment/taxonomy/sonnet_validator.py`
- Test: `tests/test_taxonomy_sonnet_validator.py`

Sonnet with `web_search` validates Haiku-filled fields for S1/S2 brand tier SKUs where confidence is uncertain. Reads brand tier from `brand_description_library.csv`. Only called when: (a) brand is S1 or S2, AND (b) the Haiku-filled value has confidence < 0.85.

### Step B1: Write failing tests

Create `tests/test_taxonomy_sonnet_validator.py`:

```python
"""Unit tests for sonnet_validator — uses mocked AnthropicClient."""
from __future__ import annotations
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.enrichment.taxonomy.sonnet_validator import (
    get_brand_tier,
    should_validate,
    parse_validation_response,
)


def test_brand_tier_s1(tmp_path):
    csv_content = "entity_name,product_count\nPenfolds,50\nSmall Brand,2\n"
    csv_file = tmp_path / "brands.csv"
    csv_file.write_text(csv_content)
    assert get_brand_tier("Penfolds", str(csv_file)) == "S1"
    assert get_brand_tier("Small Brand", str(csv_file)) == "S3"


def test_brand_tier_unknown(tmp_path):
    csv_file = tmp_path / "brands.csv"
    csv_file.write_text("entity_name,product_count\n")
    assert get_brand_tier("Unknown Brand", str(csv_file)) == "unknown"


def test_should_validate_s1_low_confidence():
    assert should_validate("S1", 0.70) is True


def test_should_validate_s1_high_confidence():
    assert should_validate("S1", 0.90) is False


def test_should_validate_s2_low_confidence():
    assert should_validate("S2", 0.80) is True


def test_should_validate_s3_never():
    assert should_validate("S3", 0.50) is False


def test_parse_valid_response():
    raw = '{"region": "Burgundy", "subregion": "Gevrey-Chambertin", "grape_variety": "Pinot Noir", "confidence": 0.95, "citations": ["https://example.com"]}'
    result = parse_validation_response(raw, ["region", "subregion", "grape_variety"])
    assert result["region"] == "Burgundy"
    assert result["confidence"] == 0.95
    assert result["valid"] is True
    assert "https://example.com" in result["citations"]


def test_parse_invalid_json():
    result = parse_validation_response("not json", ["region"])
    assert result["valid"] is False
    assert result["confidence"] == 0.0
```

Run to verify fail:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_sonnet_validator.py -v 2>&1 | head -20
```

### Step B2: Implement `sonnet_validator.py`

Create `data/lib/enrichment/taxonomy/sonnet_validator.py`:

```python
"""Sonnet web-search validator for taxonomy fields.

Called only for S1/S2 brand-tier SKUs where Haiku confidence < 0.85.
Uses Claude Sonnet with web_search to cross-check region/subregion/grape_variety
against live producer and appellation authority sources.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Optional

_DEFAULT_BRAND_LIBRARY = (
    Path(__file__).resolve().parents[4] / "data" / "brand_description_library.csv"
)

# Cache brand tier lookups for the session
_BRAND_TIER_CACHE: dict[str, str] = {}


def get_brand_tier(brand_name: str, library_path: str | Path = _DEFAULT_BRAND_LIBRARY) -> str:
    """Return 'S1', 'S2', 'S3', or 'unknown' for a brand name."""
    key = f"{library_path}:{brand_name}"
    if key in _BRAND_TIER_CACHE:
        return _BRAND_TIER_CACHE[key]

    path = Path(library_path)
    if not path.exists():
        _BRAND_TIER_CACHE[key] = "unknown"
        return "unknown"

    brand_lower = brand_name.lower().strip()
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("entity_name", "").lower().strip() == brand_lower:
                try:
                    count = int(row.get("product_count", "0"))
                except ValueError:
                    count = 0
                if count >= 10:
                    tier = "S1"
                elif count >= 3:
                    tier = "S2"
                else:
                    tier = "S3"
                _BRAND_TIER_CACHE[key] = tier
                return tier

    _BRAND_TIER_CACHE[key] = "unknown"
    return "unknown"


def should_validate(brand_tier: str, haiku_confidence: float) -> bool:
    """Return True if this SKU should be passed to Sonnet for validation."""
    if brand_tier not in ("S1", "S2"):
        return False
    return haiku_confidence < 0.85


_SYSTEM = """You are a wine and spirits taxonomy expert with access to web search.
Your task: verify and correct region, subregion, and/or grape_variety for a specific product.
Search for the producer's official website, Wine-Searcher, or appellation authority pages.
Output ONLY valid JSON — no preamble or explanation.
"""


def build_validation_prompt(sku_data: dict, fields_to_validate: list[str]) -> tuple[str, str]:
    """Build (system, user) for a Sonnet validation call."""
    name = sku_data.get("name", "")
    country = sku_data.get("country", "")
    classification = sku_data.get("classification", "")
    current_vals = {f: sku_data.get(f, "") for f in fields_to_validate}

    fields_str = "\n".join(f"  - {f}: currently '{current_vals.get(f, '')}'" for f in fields_to_validate)
    schema_fields = ",\n  ".join(
        (f'"{f}": ["..."]' if f == "grape_variety" else f'"{f}": "..."')
        for f in fields_to_validate
    )

    user = (
        f"Product: {name}\n"
        f"Country: {country}\n"
        f"Classification: {classification}\n\n"
        f"Please verify these fields using web search:\n{fields_str}\n\n"
        f"Search for the producer's official website or appellation authority.\n"
        f"Correct any errors. Output JSON:\n"
        f"{{\n  {schema_fields},\n"
        f'  "confidence": 0.0,\n'
        f'  "citations": ["url1", ...]\n'
        f"}}"
    )
    return _SYSTEM, user


def parse_validation_response(raw: str, fields: list[str]) -> dict:
    """Parse Sonnet JSON response. Returns dict with valid=True/False."""
    empty = {"valid": False, "region": "", "subregion": "", "grape_variety": "", "confidence": 0.0, "citations": []}
    if not raw:
        return empty
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return empty
        data = json.loads(raw[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return empty

    result: dict = {
        "region":        str(data.get("region") or "").strip(),
        "subregion":     str(data.get("subregion") or "").strip(),
        "grape_variety": "",
        "confidence":    0.0,
        "citations":     [],
        "valid":         True,
        "source":        "sonnet_validated",
    }

    gv = data.get("grape_variety")
    if isinstance(gv, list):
        result["grape_variety"] = ", ".join(str(g).strip() for g in gv if str(g).strip())
    elif isinstance(gv, str):
        result["grape_variety"] = gv.strip()

    try:
        conf = float(data.get("confidence", 0.0))
        result["confidence"] = round(max(0.0, min(1.0, conf)), 2)
    except (TypeError, ValueError):
        result["confidence"] = 0.0

    cites = data.get("citations", [])
    if isinstance(cites, list):
        result["citations"] = [str(c) for c in cites if c]

    return result


def validate(
    client,  # AnthropicClient instance
    sku_data: dict,
    fields_to_validate: list[str],
) -> dict:
    """Call Sonnet to validate taxonomy fields for one SKU.

    Returns parse_validation_response output.
    """
    system, user = build_validation_prompt(sku_data, fields_to_validate)
    try:
        gen = client.generate(
            system=system,
            user=user,
            max_tokens=400,
            temperature=0.1,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
        )
        return {**parse_validation_response(gen.text, fields_to_validate), "cost_thb": gen.cost_thb}
    except Exception as e:
        return {"valid": False, "confidence": 0.0, "error": str(e), "cost_thb": 0.0,
                "region": "", "subregion": "", "grape_variety": "", "citations": []}
```

### Step B3: Run tests to verify they pass

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_sonnet_validator.py -v
```

Expected: all 8 tests PASS.

### Step B4: Commit

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/lib/enrichment/taxonomy/sonnet_validator.py tests/test_taxonomy_sonnet_validator.py && git commit -m "feat(taxonomy): add Sonnet web-search validator (Layer 3) for S1/S2 brands"
```

---

## Task C: Wire Layer 0 + Layer 3 into `enrich_taxonomy.py`

**Files:**
- Modify: `data/enrich_taxonomy.py`

Add:
1. `--layer0/--no-layer0` flag — run Wikidata lookup before Layer 1
2. `--layer3/--no-layer3` flag — run Sonnet validation for S1/S2 SKUs after Layer 2
3. `--sonnet-limit N` — cap on Sonnet calls per run (default 100)
4. `--sonnet-model` — Sonnet model ID
5. `--brand-library` — path to brand CSV
6. `taxonomy_provenance` per-field dict written to products.json
7. `taxonomy_validation_status = "needs_review"` for low-confidence results

### Step C1: Read current enrich_taxonomy.py

Before editing, confirm the exact current content:
```bash
wc -l "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/enrich_taxonomy.py"
```

### Step C2: Write updated `enrich_taxonomy.py`

The updated file keeps ALL existing logic and adds the new layers. Key changes:

**New imports at top (after existing imports):**
```python
from data.lib.enrichment.taxonomy.wikidata_lookup import lookup as wikidata_lookup  # noqa: E402
from data.lib.enrichment.taxonomy.sonnet_validator import (  # noqa: E402
    get_brand_tier, should_validate, validate as sonnet_validate,
)
```

**New CLI args (in `main()`):**
```python
p.add_argument("--no-layer0", action="store_true", help="Skip Wikidata lookup (Layer 0)")
p.add_argument("--no-layer3", action="store_true", help="Skip Sonnet validation (Layer 3)")
p.add_argument("--sonnet-limit", type=int, default=100, help="Max Sonnet calls per run")
p.add_argument("--sonnet-model", default="claude-sonnet-4-6", help="Sonnet model for Layer 3")
p.add_argument("--brand-library", type=Path, default=None, help="Path to brand_description_library.csv")
```

**New stats keys:**
```python
stats = {
    ...existing...,
    "layer0": 0,
    "layer3": 0,
    "needs_review": 0,
    "sonnet_calls": 0,
}
```

**New `process_sku` logic — insert Layer 0 before Layer 1:**
```python
# ── Layer 0: Wikidata lookup ─────────────────────────────────────────
if not args.no_layer0:
    wd = wikidata_lookup(name, classification)
    if wd.get("region") and wd.get("confidence", 0) >= args.min_confidence:
        if "region" in needed:
            updates["region"] = wd["region"]
            provenance["region"] = {"source": "wikidata", "confidence": wd["confidence"],
                                     "wikidata_id": wd.get("wikidata_id", "")}
            layer0_contributed = True
        if "subregion" in needed and wd.get("subregion"):
            updates["subregion"] = wd["subregion"]
            provenance["subregion"] = {"source": "wikidata", "confidence": wd["confidence"],
                                        "wikidata_id": wd.get("wikidata_id", "")}
            layer0_contributed = True
```

**Layer 3 — insert after Layer 2:**
```python
# ── Layer 3: Sonnet web-search validation ───────────────────────────
if not args.no_layer3 and sonnet_client and not args.dry_run:
    brand = prod.get("brand", "")
    brand_tier = get_brand_tier(brand, args.brand_library or _DEFAULT_BRAND_LIBRARY)
    haiku_conf = ...  # confidence from Layer 2 parsed response
    if should_validate(brand_tier, haiku_conf):
        with db_lock:
            if stats["sonnet_calls"] >= args.sonnet_limit:
                pass  # cap reached
            else:
                stats["sonnet_calls"] += 1
                # (release lock before API call)
        # ... make validate() call, update updates, provenance, cost
```

**`taxonomy_validation_status` logic:**
```python
final_confidence = max(
    (provenance.get(f, {}).get("confidence", 0.0) for f in updates),
    default=0.0,
)
if final_confidence < 0.85 and brand_tier in ("S1", "S2"):
    validation_status = "needs_review"
else:
    validation_status = "ok"
```

**Summary output additions:**
```python
print(f"  Layer 0 (Wikidata):   {stats['layer0']}")
print(f"  Layer 3 (Sonnet):     {stats['layer3']}")
print(f"  Needs review:         {stats['needs_review']}")
print(f"  Sonnet calls:         {stats['sonnet_calls']}")
```

### Step C3: Full test suite passes

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_grape_rules.py tests/test_taxonomy_haiku.py tests/test_taxonomy_wikidata.py tests/test_taxonomy_sonnet_validator.py tests/test_enrich_taxonomy.py -v
```

Expected: all tests PASS.

### Step C4: Dry-run smoke test on real catalog

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py --dry-run --no-haiku --limit 50 2>&1 | tail -20
```

Expected: runs without error, shows Layer 0 hits in output.

### Step C5: Commit

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/enrich_taxonomy.py && git commit -m "feat(taxonomy): wire Layer 0 (Wikidata) + Layer 3 (Sonnet) + provenance tracking"
```

---

## Task D: Run full 4-layer pipeline on catalog

This task is operator-run (spends real API credit). Follow Rule 10 from CLAUDE.md.

### Step D1: Backup

```bash
cp "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.json" \
   "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.json.bak-pre-taxonomy-validation-$(date +%Y%m%d-%H%M%S)"
```

### Step D2: Canary run (5 SKUs, all layers, no write)

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py \
  --dry-run --limit 5 2>&1
```

Verify: Layer 0 hits, Layer 2 Haiku calls estimated, Layer 3 Sonnet for S1/S2.

### Step D3: Full Layer 0 + Layer 1 pass (free, no API)

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py \
  --no-haiku --no-layer3 --limit 11436 2>&1 | tail -15
```

Expected: fills more SKUs than original Layer 1 pass (Wikidata adds coverage).

### Step D4: Haiku pass for remaining unresolved (Layer 2)

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py \
  --no-layer3 --limit 5000 --workers 8 2>&1 | tail -15
```

Show cost summary. Verify cost matches pre-run estimate (~72 THB / $2 USD).

### Step D5: Sonnet validation pass for S1/S2 (Layer 3, targeted)

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py \
  --no-haiku --sonnet-limit 50 --limit 500 2>&1 | tail -15
```

Start with `--sonnet-limit 50` to validate cost. Scale up after confirming.

### Step D6: Verify data landed

```bash
python3 -c "
import json
data = json.load(open('/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.json'))
records = data if isinstance(data, list) else data.get('records', [])
filled_region = sum(1 for r in records if (r.get('region') or '').strip())
filled_grape = sum(1 for r in records if (r.get('grape_variety') or '').strip())
needs_review = sum(1 for r in records if r.get('taxonomy_validation_status') == 'needs_review')
total = len(records)
print(f'Total: {total}')
print(f'Region filled: {filled_region} ({filled_region/total*100:.1f}%)')
print(f'Grape variety filled: {filled_grape} ({filled_grape/total*100:.1f}%)')
print(f'Needs review: {needs_review}')
"
```

### Step D7: Commit

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/db/products.json && git commit -m "data: full 4-layer taxonomy validation pass complete"
```

---

## Full Test Run

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest \
  tests/test_taxonomy_grape_rules.py \
  tests/test_taxonomy_haiku.py \
  tests/test_taxonomy_wikidata.py \
  tests/test_taxonomy_sonnet_validator.py \
  tests/test_enrich_taxonomy.py \
  -v
```

All tests should pass.
