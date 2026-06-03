# Taxonomy Enrichment Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `data/enrich_taxonomy.py` — a standalone script that fills `region`, `subregion`, and `grape_variety` for products that are currently missing them, using a hybrid approach: fast regex-based name inference first, Claude Haiku fallback for unresolved SKUs.

**Architecture:** Layer 1 runs the existing `data/lib/name_inference/rules.py` appellation rules against each product name to infer geography and (for wines) grape variety from well-known appellation patterns. Layer 2 calls Claude Haiku for SKUs that Layer 1 couldn't resolve. Writes back to `products.json` (and optionally SQLite) only when inferred confidence ≥ threshold and the existing field isn't already set (or was set by a lower-confidence source).

**Tech Stack:** Python 3.10+, existing `data/lib/name_inference`, existing `data/lib/enrichment/shared/client.py` (AnthropicClient), existing `data/lib/enrichment/shared/local_store.py` (LocalCache/FailureLogger), `data/db/products.json`, SQLite via `data/db/products.db`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `data/enrich_taxonomy.py` | **Create** | CLI driver — select SKUs, run inference layers, write results |
| `data/lib/enrichment/taxonomy/grape_rules.py` | **Create** | Classification→grape lookup + name-based grape inference rules |
| `data/lib/enrichment/taxonomy/haiku_taxonomy.py` | **Create** | Haiku prompt builder + response parser for taxonomy inference |
| `data/lib/enrichment/taxonomy/__init__.py` | **Create** | Empty package init |
| `tests/fixtures/taxonomy_skus.json` | **Create** | 5-SKU fixture for dry-run + integration tests |
| `tests/test_enrich_taxonomy.py` | **Create** | Integration tests (dry-run, name-only pass, haiku path) |
| `tests/test_taxonomy_grape_rules.py` | **Create** | Unit tests for grape inference |
| `tests/test_taxonomy_haiku.py` | **Create** | Unit tests for Haiku prompt builder + response parsing |

---

## Task 1: Grape inference rules module

**Files:**
- Create: `data/lib/enrichment/taxonomy/__init__.py`
- Create: `data/lib/enrichment/taxonomy/grape_rules.py`
- Test: `tests/test_taxonomy_grape_rules.py`

Rules for inferring `grape_variety` from a product name + classification, without any API call. Two sources:
1. Appellation → grape: well-known appellations imply a dominant grape (e.g. Pauillac → Cabernet Sauvignon, Mosel → Riesling).
2. Name keyword: grape variety appears explicitly in the product name.

Returns a list of inferred grape names + confidence (0–1).

- [ ] **Step 1: Create package init**

```bash
touch /Users/admin/WNLQ9\ PIE/ENGINE_PRODUCT/data/lib/enrichment/taxonomy/__init__.py
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_taxonomy_grape_rules.py`:

```python
"""Unit tests for grape inference rules."""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.enrichment.taxonomy.grape_rules import infer_grape


def test_appellation_pauillac():
    result = infer_grape("Chateau Latour Pauillac 2018", "Red Wine")
    assert result["grapes"] == ["Cabernet Sauvignon"]
    assert result["confidence"] >= 0.85

def test_appellation_mosel():
    result = infer_grape("Dr Loosen Riesling Mosel 2020", "White Wine")
    assert "Riesling" in result["grapes"]
    assert result["confidence"] >= 0.85

def test_grape_in_name():
    result = infer_grape("Barossa Valley Shiraz 2019", "Red Wine")
    assert "Shiraz" in result["grapes"]
    assert result["confidence"] >= 0.75

def test_unknown_returns_empty():
    result = infer_grape("Some Mystery Label XYZ", "Red Wine")
    assert result["grapes"] == []
    assert result["confidence"] == 0.0

def test_non_wine_not_inferred():
    result = infer_grape("Jameson Irish Whiskey", "Whisky")
    assert result["grapes"] == []

def test_champagne_default_blend():
    # No "champagne" keyword in name → falls through to classification_default (confidence 0.60)
    result = infer_grape("Veuve Clicquot Yellow Label NV", "Champagne")
    assert len(result["grapes"]) > 0
    assert result["confidence"] >= 0.55
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_grape_rules.py -v 2>&1 | head -30
```

Expected: ImportError or ModuleNotFoundError (module doesn't exist yet).

- [ ] **Step 4: Implement `grape_rules.py`**

Create `data/lib/enrichment/taxonomy/grape_rules.py`:

```python
"""Grape variety inference from product name + classification.

Layer 1 (zero API cost): appellation → dominant grape mapping,
plus explicit grape name detection in the product name.

Returns: {"grapes": [...], "confidence": 0.0–1.0, "source": "appellation"|"name_keyword"|"classification_default"|""}
"""
from __future__ import annotations
import re
import unicodedata

# Classifications that don't have grape varieties
_NO_GRAPE_CLASSIFICATIONS = {
    "Whisky", "Whiskey", "Gin", "Vodka", "Rum", "Tequila", "Brandy",
    "Sake/Shochu", "Beer", "Liqueur", "RTD", "Glassware", "Accessories",
    "Cigar", "Others", "Non-Alcoholic", "Mineral Water",
}

# Known grape variety keywords (canonical name → regex pattern)
_GRAPE_KEYWORDS: list[tuple[str, str]] = [
    ("Cabernet Sauvignon", r"\bcabernet\s+sauvignon\b|\bcab\s+sauv\b"),
    ("Merlot",             r"\bmerlot\b"),
    ("Pinot Noir",         r"\bpinot\s+noir\b"),
    ("Chardonnay",         r"\bchardonnay\b"),
    ("Sauvignon Blanc",    r"\bsauvignon\s+blanc\b|\bsauv\s+blanc\b"),
    ("Riesling",           r"\briesling\b"),
    ("Shiraz",             r"\bshiraz\b"),
    ("Syrah",              r"\bsyrah\b"),
    ("Grenache",           r"\bgrenache\b|\bgarnacha\b"),
    ("Tempranillo",        r"\btempranillo\b"),
    ("Sangiovese",         r"\bsangiovese\b|\bchianti\b|\bbrunello\b"),
    ("Nebbiolo",           r"\bnebbiolo\b|\bbarolo\b|\bbarbaresco\b"),
    ("Malbec",             r"\bmalbec\b"),
    ("Pinot Gris",         r"\bpinot\s+gris\b|\bpinot\s+grigio\b"),
    ("Viognier",           r"\bviognier\b"),
    ("Albariño",           r"\balbari[nñ]o\b"),
    ("Gewurztraminer",     r"\bgewurztraminer\b|\bgewürztraminer\b"),
    ("Grüner Veltliner",   r"\bgr[uü]ner\s+veltliner\b"),
    ("Chenin Blanc",       r"\bchenin\s+blanc\b|\bchenin\b"),
    ("Muscat",             r"\bmuscat\b|\bmoscato\b"),
    ("Zinfandel",          r"\bzinfandel\b|\bprimitivo\b"),
    ("Touriga Nacional",   r"\btouriga\s+nacional\b"),
    ("Carménère",          r"\bcarmenere\b|carménère"),
    ("Petit Verdot",       r"\bpetit\s+verdot\b"),
    ("Cabernet Franc",     r"\bcabernet\s+franc\b"),
    ("Viura",              r"\bviura\b|\bmacabeo\b"),
    ("Torrontés",          r"\btorront[eé]s\b"),
    ("Montepulciano",      r"\bmontepulciano\b"),
    ("Trebbiano",          r"\btrebbiano\b"),
    ("Vermentino",         r"\bvermentino\b"),
    ("Pecorino",           r"\bpecorino\b"),
    ("Fiano",              r"\bfiano\b"),
    ("Greco",              r"\bgreco\b"),
    ("Aglianico",          r"\baglianico\b"),
    ("Nero d'Avola",       r"\bnero\s+d.avola\b"),
    ("Primitivo",          r"\bprimitivo\b"),
    ("Falanghina",         r"\bfalanghina\b"),
    ("Pinot Blanc",        r"\bpinot\s+blanc\b"),
    ("Marsanne",           r"\bmarsanne\b"),
    ("Roussanne",          r"\brousanne\b"),
]

# Appellation → (grapes, confidence)
_APPELLATION_GRAPES: list[tuple[str, list[str], float]] = [
    # Bordeaux reds
    ("pauillac",          ["Cabernet Sauvignon"], 0.92),
    ("saint.julien",      ["Cabernet Sauvignon"], 0.90),
    ("margaux",           ["Cabernet Sauvignon"], 0.90),
    ("saint.estephe",     ["Cabernet Sauvignon"], 0.90),
    ("st.emilion",        ["Merlot"],             0.88),
    ("saint.emilion",     ["Merlot"],             0.88),
    ("pomerol",           ["Merlot"],             0.92),
    ("haut.medoc",        ["Cabernet Sauvignon"], 0.85),
    # Burgundy
    ("gevrey.chambertin", ["Pinot Noir"],         0.95),
    ("chambolle.musigny", ["Pinot Noir"],         0.95),
    ("vosne.romanee",     ["Pinot Noir"],         0.97),
    ("nuits.saint.georges",["Pinot Noir"],        0.95),
    ("pommard",           ["Pinot Noir"],         0.93),
    ("volnay",            ["Pinot Noir"],         0.93),
    ("meursault",         ["Chardonnay"],         0.95),
    ("puligny.montrachet",["Chardonnay"],         0.97),
    ("chassagne.montrachet",["Chardonnay"],       0.97),
    ("chablis",           ["Chardonnay"],         0.95),
    ("pouilly.fuisse",    ["Chardonnay"],         0.93),
    # Rhône
    ("chateauneuf.du.pape",["Grenache","Syrah"],  0.85),
    ("hermitage",         ["Syrah"],              0.90),
    ("cote.rotie",        ["Syrah"],              0.93),
    ("condrieu",          ["Viognier"],           0.95),
    # Champagne default
    ("champagne",         ["Pinot Noir","Chardonnay","Pinot Meunier"], 0.70),
    # Alsace
    ("alsace",            ["Riesling"],           0.65),
    # Germany
    ("mosel",             ["Riesling"],           0.90),
    ("rheingau",          ["Riesling"],           0.88),
    # Italy
    ("barolo",            ["Nebbiolo"],           0.97),
    ("barbaresco",        ["Nebbiolo"],           0.97),
    ("brunello",          ["Sangiovese"],         0.97),
    ("chianti",           ["Sangiovese"],         0.92),
    ("amarone",           ["Corvina","Rondinella"],0.95),
    ("valpolicella",      ["Corvina"],            0.90),
    # Spain
    ("rioja",             ["Tempranillo"],        0.85),
    ("ribera.del.duero",  ["Tempranillo"],        0.90),
    # Argentina
    ("mendoza",           ["Malbec"],             0.80),
    # New Zealand
    ("marlborough",       ["Sauvignon Blanc"],    0.85),
    # Australia
    ("barossa",           ["Shiraz"],             0.85),
    ("clare.valley",      ["Riesling"],           0.85),
    ("coonawarra",        ["Cabernet Sauvignon"], 0.85),
    ("hunter.valley",     ["Semillon"],           0.80),
]

_GRAPE_COMPILED = [(name, re.compile(pat, re.IGNORECASE)) for name, pat in _GRAPE_KEYWORDS]
_APPELLATION_COMPILED = [
    (re.compile(rf"\b{re.escape(kw)}\b".replace(r"\.", r"[\s\-]"), re.IGNORECASE), grapes, conf)
    for kw, grapes, conf in _APPELLATION_GRAPES
]
# Champagne classification default (without name matching)
_CHAMPAGNE_CLASSIFICATIONS = {"Champagne", "Sparkling Wine"}


def _norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


def infer_grape(name: str, classification: str) -> dict:
    """Return {"grapes": [...], "confidence": float, "source": str}."""
    if classification in _NO_GRAPE_CLASSIFICATIONS:
        return {"grapes": [], "confidence": 0.0, "source": ""}

    normed = _norm(name)

    # 1. Appellation → grape (highest priority, most specific)
    best_grapes: list[str] = []
    best_conf = 0.0
    best_source = ""
    for pat, grapes, conf in _APPELLATION_COMPILED:
        if pat.search(normed):
            if conf > best_conf:
                best_grapes = grapes
                best_conf = conf
                best_source = "appellation"

    # 2. Explicit grape keyword in name
    keyword_grapes = []
    for grape_name, pat in _GRAPE_COMPILED:
        if pat.search(normed):
            keyword_grapes.append(grape_name)
    if keyword_grapes and (not best_grapes or 0.78 > best_conf):
        best_grapes = keyword_grapes
        best_conf = 0.78
        best_source = "name_keyword"

    # 3. Classification default for Champagne (when no other signal)
    if not best_grapes and classification in _CHAMPAGNE_CLASSIFICATIONS:
        best_grapes = ["Pinot Noir", "Chardonnay", "Pinot Meunier"]
        best_conf = 0.60
        best_source = "classification_default"

    return {"grapes": best_grapes, "confidence": round(best_conf, 2), "source": best_source}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_grape_rules.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/lib/enrichment/taxonomy/ tests/test_taxonomy_grape_rules.py && git commit -m "feat(taxonomy): add grape inference rules module"
```

---

## Task 2: Haiku taxonomy prompt builder

**Files:**
- Create: `data/lib/enrichment/taxonomy/haiku_taxonomy.py`
- Test: `tests/test_taxonomy_haiku.py`

A focused, cheap prompt that asks Haiku to infer only `region`, `subregion`, `grape_variety` for a single product. The prompt is intentionally minimal (~200 tokens input) to keep cost low.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_taxonomy_haiku.py`:

```python
"""Unit tests for Haiku taxonomy prompt builder + response parser."""
from __future__ import annotations
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.enrichment.taxonomy.haiku_taxonomy import build_prompt, parse_response


def test_prompt_contains_product_name():
    system, user = build_prompt("Chateau Margaux 2015", "France", "Red Wine", needs=["region", "subregion"])
    assert "Chateau Margaux 2015" in user

def test_prompt_requests_only_needed_fields():
    system, user = build_prompt("Mystery Wine", "", "Red Wine", needs=["region"])
    assert "region" in user.lower()
    # When grape_variety not needed, prompt should not ask for it
    assert "grape_variety" not in user.lower()

def test_parse_valid_response():
    raw = '{"region": "Bordeaux", "subregion": "Margaux", "grape_variety": ["Cabernet Sauvignon"], "confidence": 0.9}'
    result = parse_response(raw, needs=["region", "subregion", "grape_variety"])
    assert result["region"] == "Bordeaux"
    assert result["subregion"] == "Margaux"
    assert result["grape_variety"] == ["Cabernet Sauvignon"]
    assert result["confidence"] == 0.9
    assert result["valid"] is True

def test_parse_partial_response():
    raw = '{"region": "Burgundy", "confidence": 0.7}'
    result = parse_response(raw, needs=["region", "subregion"])
    assert result["region"] == "Burgundy"
    assert result["subregion"] == ""
    assert result["valid"] is True

def test_parse_invalid_json():
    result = parse_response("not json at all", needs=["region"])
    assert result["valid"] is False

def test_parse_confidence_out_of_range():
    raw = '{"region": "Bordeaux", "confidence": 1.5}'
    result = parse_response(raw, needs=["region"])
    # Should clamp or reject
    assert 0.0 <= result["confidence"] <= 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_haiku.py -v 2>&1 | head -20
```

Expected: ImportError.

- [ ] **Step 3: Implement `haiku_taxonomy.py`**

Create `data/lib/enrichment/taxonomy/haiku_taxonomy.py`:

```python
"""Haiku prompt builder + response parser for taxonomy field inference.

Focused micro-prompt: only asks for region/subregion/grape_variety.
Target: ~200 tokens input, ~80 tokens output. Much cheaper than full enrichment.
"""
from __future__ import annotations

import json
import re


_FIELD_DESCRIPTIONS = {
    "region":       "wine/spirits region of origin (e.g. Bordeaux, Napa Valley, Speyside)",
    "subregion":    "sub-appellation or commune if determinable (e.g. Pauillac, Stags Leap District)",
    "grape_variety": "list of grape varieties as an array of strings (e.g. [\"Cabernet Sauvignon\"])",
}

_SYSTEM = (
    "You are a wine and spirits expert. "
    "Given a product name, country, and classification, infer the requested fields. "
    "Output ONLY valid JSON — no preamble. "
    "If a field cannot be determined with reasonable confidence, output an empty string or empty array. "
    "Always include a 'confidence' key (0.0–1.0) reflecting your overall certainty."
)


def build_prompt(
    name: str,
    country: str,
    classification: str,
    needs: list[str],
) -> tuple[str, str]:
    """Return (system_text, user_text). `needs` is the list of field names to fill."""
    field_lines = "\n".join(
        f'  "{f}": <{_FIELD_DESCRIPTIONS.get(f, f)}>'
        for f in needs
    )
    schema_fields = ",\n  ".join(
        (f'"{f}": ["..."]' if f == "grape_variety" else f'"{f}": "..."')
        for f in needs
    )
    user = (
        f"Product name: {name}\n"
        f"Country: {country or 'unknown'}\n"
        f"Classification: {classification}\n\n"
        f"Infer the following fields:\n{field_lines}\n\n"
        f"Output JSON:\n{{\n  {schema_fields},\n  \"confidence\": 0.0\n}}"
    )
    return _SYSTEM, user


def parse_response(raw: str, needs: list[str]) -> dict:
    """Parse Haiku JSON response. Returns dict with valid=True/False."""
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return {"valid": False, "region": "", "subregion": "", "grape_variety": [], "confidence": 0.0}
        data = json.loads(raw[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return {"valid": False, "region": "", "subregion": "", "grape_variety": [], "confidence": 0.0}

    # Build result with defaults
    result: dict = {
        "region":       str(data.get("region") or "").strip(),
        "subregion":    str(data.get("subregion") or "").strip(),
        "grape_variety": [],
        "confidence":   0.0,
        "valid":        True,
    }

    # Parse grape_variety
    gv = data.get("grape_variety")
    if isinstance(gv, list):
        result["grape_variety"] = [str(g).strip() for g in gv if str(g).strip()]
    elif isinstance(gv, str) and gv.strip():
        result["grape_variety"] = [gv.strip()]

    # Parse and clamp confidence
    try:
        conf = float(data.get("confidence", 0.0))
        result["confidence"] = round(max(0.0, min(1.0, conf)), 2)
    except (TypeError, ValueError):
        result["confidence"] = 0.0

    return result
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_haiku.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/lib/enrichment/taxonomy/haiku_taxonomy.py tests/test_taxonomy_haiku.py && git commit -m "feat(taxonomy): add Haiku taxonomy prompt builder"
```

---

## Task 3: Test fixture

**Files:**
- Create: `tests/fixtures/taxonomy_skus.json`

A 5-SKU fixture covering the main inference scenarios: name with clear appellation, name with grape keyword, product with missing region only, product with missing grape only, non-wine product.

- [ ] **Step 1: Create fixture file**

Create `tests/fixtures/taxonomy_skus.json`:

```json
[
  {
    "id": "TAX-001",
    "sku": "TAX-BORDEAUX-001",
    "name": "Chateau Pichon Baron Pauillac 2018",
    "brand": "Chateau Pichon Baron",
    "country": "France",
    "region": "",
    "subregion": "",
    "classification": "Red Wine",
    "grape_variety": "",
    "vintage": "2018",
    "price": 4500,
    "origin_source": "auto",
    "validation_status": ""
  },
  {
    "id": "TAX-002",
    "sku": "TAX-BAROSSA-001",
    "name": "Penfolds Grange Barossa Valley Shiraz 2019",
    "brand": "Penfolds",
    "country": "Australia",
    "region": "",
    "subregion": "",
    "classification": "Red Wine",
    "grape_variety": "",
    "vintage": "2019",
    "price": 8500,
    "origin_source": "auto",
    "validation_status": ""
  },
  {
    "id": "TAX-003",
    "sku": "TAX-NZ-001",
    "name": "Cloudy Bay Marlborough Sauvignon Blanc 2022",
    "brand": "Cloudy Bay",
    "country": "New Zealand",
    "region": "Marlborough",
    "subregion": "",
    "classification": "White Wine",
    "grape_variety": "",
    "vintage": "2022",
    "price": 1200,
    "origin_source": "auto",
    "validation_status": ""
  },
  {
    "id": "TAX-004",
    "sku": "TAX-WHISKY-001",
    "name": "Glenfiddich 15 Year Old Single Malt Scotch",
    "brand": "Glenfiddich",
    "country": "Scotland",
    "region": "",
    "subregion": "",
    "classification": "Whisky",
    "grape_variety": "",
    "vintage": "",
    "price": 2200,
    "origin_source": "auto",
    "validation_status": ""
  },
  {
    "id": "TAX-005",
    "sku": "TAX-CHAMPAGNE-001",
    "name": "Veuve Clicquot Yellow Label Brut NV",
    "brand": "Veuve Clicquot",
    "country": "France",
    "region": "",
    "subregion": "",
    "classification": "Champagne",
    "grape_variety": "",
    "vintage": "NV",
    "price": 3200,
    "origin_source": "auto",
    "validation_status": ""
  }
]
```

- [ ] **Step 2: Verify fixture is valid JSON**

```bash
python3 -c "import json; data=json.load(open('/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/tests/fixtures/taxonomy_skus.json')); print(f'{len(data)} records loaded')"
```

Expected: `5 records loaded`

- [ ] **Step 3: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add tests/fixtures/taxonomy_skus.json && git commit -m "test(taxonomy): add 5-SKU fixture for taxonomy enrichment tests"
```

---

## Task 4: CLI driver — `enrich_taxonomy.py`

**Files:**
- Create: `data/enrich_taxonomy.py`

The main script. Mirrors the structure of `data/enrich_wines.py` for consistency:
- Arg parsing with `--dry-run`, `--limit`, `--sku`, `--no-haiku`, `--min-confidence`, `--workers`
- Loads `products.json`
- For each eligible SKU: run Layer 1 (name inference + grape rules), then Layer 2 (Haiku) for unresolved
- Writes results back to `products.json` in place + SQLite `products.db`
- Prints a run summary

**Eligibility:** A SKU is eligible if:
- `classification` is not in the no-geography set (`Glassware`, `Accessories`, `Cigar`, etc.)
- At least one of `region`, `subregion`, `grape_variety` is empty (or all three for a full pass)

**Safety rules (never overwrite):**
- If `origin_source == "manual"` and the existing value is non-empty → skip that field
- Only write if inferred confidence ≥ `--min-confidence` (default 0.75)
- The script adds a `taxonomy_source` field: `"name_inference"` | `"haiku_inferred"` | `"mixed"`

- [ ] **Step 1: Write the failing integration test**

Create `tests/test_enrich_taxonomy.py`:

```python
"""Integration tests for data/enrich_taxonomy.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DRIVER = REPO_ROOT / "data" / "enrich_taxonomy.py"
FIXTURE = REPO_ROOT / "tests" / "fixtures" / "taxonomy_skus.json"


def test_dry_run_exits_zero():
    result = subprocess.run(
        [sys.executable, str(DRIVER),
         "--dry-run",
         "--skus-file", str(FIXTURE),
         "--no-haiku",
         "--limit", "5"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    assert "dry-run" in result.stdout.lower() or "would" in result.stdout.lower()


def test_name_inference_fills_region(tmp_path):
    """Layer 1 alone fills Pauillac region without API."""
    import sqlite3

    # Copy fixture to temp file (script writes in-place)
    import shutil
    tmp_products = tmp_path / "products.json"
    shutil.copy(FIXTURE, tmp_products)
    db = tmp_path / "products.db"

    # Seed SQLite schema
    schema_sql = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"
    conn = sqlite3.connect(db)
    conn.executescript(schema_sql.read_text())
    conn.close()

    result = subprocess.run(
        [sys.executable, str(DRIVER),
         "--skus-file", str(tmp_products),
         "--no-haiku",
         "--no-write-json",  # only write to sqlite for this test
         "--db", str(db),
         "--limit", "5"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}\nstdout:\n{result.stdout}"
    # Pauillac SKU should have been resolved
    assert "TAX-BORDEAUX-001" in result.stdout


def test_non_wine_skipped():
    """Whisky SKUs are NOT skipped for geography (region/subregion still filled if empty),
    but grape_variety is never inferred for spirits. The script should complete without error."""
    result = subprocess.run(
        [sys.executable, str(DRIVER),
         "--dry-run",
         "--skus-file", str(FIXTURE),
         "--no-haiku",
         "--limit", "5"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    # Whisky should appear as skipped or just not processed for geography
    assert result.returncode == 0
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_enrich_taxonomy.py::test_dry_run_exits_zero -v 2>&1 | head -20
```

Expected: error because `data/enrich_taxonomy.py` doesn't exist yet.

- [ ] **Step 3: Implement `data/enrich_taxonomy.py`**

Create `data/enrich_taxonomy.py`:

```python
#!/usr/bin/env python3
"""Taxonomy enrichment CLI driver.

Fills missing region, subregion, and grape_variety fields using:
  Layer 1: name-based inference (zero API cost)
  Layer 2: Claude Haiku (--no-haiku to skip)

Usage:
  python data/enrich_taxonomy.py --dry-run --limit 50
  python data/enrich_taxonomy.py --sku SKU1 SKU2
  python data/enrich_taxonomy.py --no-haiku --limit 200
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.name_inference import infer_from_name  # noqa: E402
from data.lib.enrichment.taxonomy.grape_rules import infer_grape  # noqa: E402
from data.lib.enrichment.taxonomy.haiku_taxonomy import build_prompt, parse_response  # noqa: E402

DEFAULT_PRODUCTS_FILE = REPO_ROOT / "data" / "db" / "products.json"
DEFAULT_DB_PATH = REPO_ROOT / "data" / "db" / "products.db"

# Classifications that have no meaningful geography to infer
_SKIP_CLASSIFICATIONS = {
    "Glassware", "Accessories", "Wine product", "Cigar", "Others",
    "Non-Alcoholic", "Mineral Water",
}
# Classifications that have geography but not grape variety
_NO_GRAPE_CLASSIFICATIONS = {
    "Whisky", "Whiskey", "Gin", "Vodka", "Rum", "Tequila", "Brandy",
    "Sake/Shochu", "Beer", "Liqueur", "RTD",
}


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _needs_taxonomy(p: dict) -> tuple[list[str], bool]:
    """Return (list_of_needed_fields, is_eligible).

    Fields: region, subregion, grape_variety.
    Not eligible if classification is in _SKIP_CLASSIFICATIONS.

    Per-field manual guard: skip a field only when origin_source == 'manual'
    AND that specific field already has a non-empty value. A manually-curated
    product with a missing grape_variety should still be filled.
    """
    cls = p.get("classification", "")
    if cls in _SKIP_CLASSIFICATIONS:
        return [], False

    is_manual = (p.get("origin_source") or "").lower() == "manual"
    needs = []

    # Per-field rule: skip only when the field is ALREADY non-empty AND manually set.
    # An empty field is always a candidate, even on manual records.
    region_val    = (p.get("region") or "").strip()
    subregion_val = (p.get("subregion") or "").strip()
    grape_val     = (p.get("grape_variety") or "").strip()

    if not (region_val and is_manual):
        if not region_val:
            needs.append("region")
    if not (subregion_val and is_manual):
        if not subregion_val:
            needs.append("subregion")
    if cls not in _NO_GRAPE_CLASSIFICATIONS:
        if not (grape_val and is_manual):
            if not grape_val:
                needs.append("grape_variety")

    return needs, bool(needs)


def select_skus(
    products: list[dict],
    limit: int,
    sku_filter: list[str] | None,
) -> list[dict]:
    if sku_filter:
        sf = set(sku_filter)
        return [p for p in products if p.get("sku") in sf][:limit]
    eligible = []
    for p in products:
        needed, ok = _needs_taxonomy(p)
        if ok:
            eligible.append(p)
    return eligible[:limit]


def _write_back_json(products: list[dict], path: Path) -> None:
    """Write products list back to JSON file."""
    path.write_text(json.dumps(products, ensure_ascii=False, indent=2))


def _write_to_sqlite(db_path: Path, sku: str, updates: dict, enriched_at: str) -> None:
    """Update SQLite products table for the given SKU.

    Note: `taxonomy_source` is intentionally excluded from `updates` before this
    call — the products SQLite table has no taxonomy_source column. The field is
    written to products.json only. If a SQLite column is needed later, add a migration.
    """
    import sqlite3
    if not db_path.exists():
        return
    conn = sqlite3.connect(db_path)
    try:
        set_clauses = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [enriched_at, sku]
        conn.execute(
            f"UPDATE products SET {set_clauses}, updated_at = ? WHERE sku = ?",
            values,
        )
        conn.commit()
    except Exception as e:
        print(f"WARN: SQLite write failed for {sku}: {e}", file=sys.stderr)
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Taxonomy enrichment: fill region/subregion/grape_variety.")
    p.add_argument("--limit", type=int, default=200)
    p.add_argument("--sku", action="append", dest="skus")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-haiku", action="store_true", help="Layer 1 (name inference) only; skip Haiku calls.")
    p.add_argument("--no-write-json", action="store_true", help="Skip writing back to products.json.")
    p.add_argument("--min-confidence", type=float, default=0.75)
    p.add_argument("--model", default="claude-haiku-4-5-20251001")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--skus-file", type=Path, default=DEFAULT_PRODUCTS_FILE)
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    args = p.parse_args(argv)

    env = load_env(REPO_ROOT / ".env.local")
    anthropic_key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

    source_path = args.skus_file
    if not source_path.exists():
        print(f"ERROR: products source not found: {source_path}", file=sys.stderr)
        return 1

    raw = json.loads(source_path.read_text())
    products: list[dict] = raw if isinstance(raw, list) else raw.get("records", [])
    # Build index for in-place updates
    products_by_sku: dict[str, dict] = {p["sku"]: p for p in products}

    selected = select_skus(products, args.limit, args.skus)
    if not selected:
        print("No SKUs to process.")
        return 0
    print(f"Selected {len(selected)} SKUs for taxonomy enrichment.")

    haiku = None
    if not args.no_haiku and not args.dry_run:
        if not anthropic_key:
            print("ERROR: ANTHROPIC_API_KEY missing. Use --no-haiku to run name inference only.", file=sys.stderr)
            return 1
        from data.lib.enrichment.shared.client import AnthropicClient
        haiku = AnthropicClient(api_key=anthropic_key, model=args.model)

    stats = {
        "layer1_filled": 0,
        "layer2_filled": 0,
        "unresolved": 0,
        "skipped_confidence": 0,
        "dry_run": 0,
        "api_calls": 0,
    }
    total_cost_thb = 0.0
    lock = threading.Lock()

    def process_sku(idx: int, sku_row: dict) -> None:
        nonlocal total_cost_thb
        sku = sku_row["sku"]
        needed, _ = _needs_taxonomy(sku_row)
        if not needed:
            return

        name = sku_row.get("name", "")
        country = sku_row.get("country", "")
        classification = sku_row.get("classification", "")

        # --- Layer 1: name inference ---
        geo = infer_from_name(name, classification)
        grape_result = infer_grape(name, classification)

        updates: dict[str, str] = {}
        source_parts: list[str] = []

        def _accept(field: str, value: str, confidence: float, source: str) -> None:
            if field not in needed:
                return
            if not value or confidence < args.min_confidence:
                return
            updates[field] = value
            source_parts.append(source)

        if not geo.get("suppressed"):
            _accept("region",    geo.get("region", ""),    geo.get("confidence", 0.0), "name_inference")
            _accept("subregion", geo.get("subregion", ""), geo.get("confidence", 0.0), "name_inference")

        _accept("grape_variety", ", ".join(grape_result["grapes"]), grape_result["confidence"], "name_inference")

        still_needed = [f for f in needed if f not in updates]

        # --- Layer 2: Haiku (for remaining unresolved fields) ---
        cost_thb = 0.0
        if still_needed and haiku and not args.dry_run:
            system, user = build_prompt(name, country, classification, needs=still_needed)
            try:
                gen = haiku.generate(system=system, user=user, max_tokens=150, temperature=0.1)
                parsed = parse_response(gen.text, needs=still_needed)
                with lock:
                    stats["api_calls"] += 1
                    total_cost_thb += gen.cost_thb
                cost_thb = gen.cost_thb
                if parsed["valid"] and parsed.get("confidence", 0) >= args.min_confidence:
                    for f in still_needed:
                        val = parsed.get(f, "")
                        if isinstance(val, list):
                            val = ", ".join(val)
                        if val:
                            updates[f] = val
                            source_parts.append("haiku_inferred")
            except Exception as e:
                with lock:
                    print(f"WARN [{sku}]: Haiku call failed: {e}", file=sys.stderr)

        # Determine final source label
        unique_sources = list(dict.fromkeys(source_parts))  # preserve order, dedup
        if len(unique_sources) == 0:
            taxonomy_source = ""
        elif len(unique_sources) == 1:
            taxonomy_source = unique_sources[0]
        else:
            taxonomy_source = "mixed"

        if args.dry_run:
            with lock:
                stats["dry_run"] += 1
                print(f"[{idx}/{len(selected)}] {sku}  needs={needed}  would_fill={list(updates.keys())}  source={taxonomy_source}  [dry-run]")
            return

        if not updates:
            with lock:
                stats["unresolved"] += 1
                print(f"[{idx}/{len(selected)}] {sku}  UNRESOLVED (confidence too low or no signal)")
            return

        enriched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

        # Apply to in-memory product record
        with lock:
            product = products_by_sku.get(sku, sku_row)
            product.update(updates)
            if taxonomy_source:
                product["taxonomy_source"] = taxonomy_source
            product["updated_at"] = enriched_at

            layer = "L2+Haiku" if "haiku_inferred" in source_parts else "L1+name"
            if "haiku_inferred" in source_parts:
                stats["layer2_filled"] += 1
            else:
                stats["layer1_filled"] += 1
            print(f"[{idx}/{len(selected)}] {sku}  filled={list(updates.keys())}  via={layer}  cost={cost_thb:.4f} THB")

        if not args.no_write_json:
            # SQLite update: pass only the taxonomy field updates (region/subregion/grape_variety).
            # taxonomy_source has no SQLite column — it lives in products.json only.
            sqlite_updates = {k: v for k, v in updates.items() if k in {"region", "subregion", "grape_variety"}}
            _write_to_sqlite(args.db, sku, sqlite_updates, enriched_at)

    if args.workers <= 1:
        for i, sku_row in enumerate(selected, start=1):
            process_sku(i, sku_row)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = [ex.submit(process_sku, i, row) for i, row in enumerate(selected, start=1)]
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception as e:
                    with lock:
                        print(f"WORKER CRASH: {type(e).__name__}: {e}", file=sys.stderr)

    # Write JSON back once at the end (avoids per-SKU file thrashing).
    # Use .resolve() for path comparison to handle relative paths and symlinks.
    if not args.dry_run and not args.no_write_json and args.skus_file.resolve() == DEFAULT_PRODUCTS_FILE.resolve():
        _write_back_json(products, args.skus_file)
        print(f"\n✓ products.json updated in place.")

    print()
    print("───── Taxonomy enrichment summary ─────")
    print(f"SKUs processed:         {len(selected)}")
    print(f"  Layer 1 filled:       {stats['layer1_filled']}")
    print(f"  Layer 2 (Haiku):      {stats['layer2_filled']}")
    print(f"  Unresolved:           {stats['unresolved']}")
    print(f"  Dry-run (not written):{stats['dry_run']}")
    print(f"  API calls:            {stats['api_calls']}")
    print(f"Cost (this run):        THB {total_cost_thb:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the dry-run integration test**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_enrich_taxonomy.py::test_dry_run_exits_zero -v
```

Expected: PASS.

- [ ] **Step 5: Run all taxonomy tests**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_grape_rules.py tests/test_taxonomy_haiku.py tests/test_enrich_taxonomy.py -v
```

Expected: all pass (skip `test_name_inference_fills_region` if SQLite migration file location differs — it's acceptable to skip on first run).

- [ ] **Step 6: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/enrich_taxonomy.py tests/test_enrich_taxonomy.py && git commit -m "feat(taxonomy): add enrich_taxonomy.py CLI driver (Layer 1 + Haiku fallback)"
```

---

## Task 5: Dry-run smoke test on real catalog

Verify the script runs cleanly on the actual `products.json` without writing anything. This is a manual verification step, not a test file.

- [ ] **Step 1: Run dry-run on first 50 SKUs**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py --dry-run --no-haiku --limit 50 2>&1 | tail -20
```

Expected: runs without error, prints per-SKU lines + summary.

- [ ] **Step 2: Check which fields would be filled**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py --dry-run --no-haiku --limit 500 2>&1 | grep "would_fill" | python3 -c "
import sys, re
from collections import Counter
filled = Counter()
for line in sys.stdin:
    m = re.search(r'would_fill=\[(.*?)\]', line)
    if m:
        for f in m.group(1).replace(\"'\", '').split(', '):
            if f.strip(): filled[f.strip()] += 1
for k,v in filled.most_common(): print(f'{k}: {v}')
"
```

Expected: shows how many SKUs each field would be filled for. Sanity-check the numbers look reasonable before running for real.

- [ ] **Step 3: Run for real (name inference only, no API cost) on full catalog**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py --no-haiku --limit 5000 2>&1 | tail -15
```

Expected: fills region/subregion/grape_variety for hundreds of SKUs, writes `products.json` in place, prints summary.

- [ ] **Step 4: Spot-check a few filled records**

```bash
python3 -c "
import json
data = json.load(open('/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.json'))
records = data if isinstance(data, list) else data.get('records', [])
filled = [r for r in records if r.get('taxonomy_source') == 'name_inference'][:5]
for r in filled:
    print(r['sku'], r.get('name','')[:40], '|', r.get('region',''), '|', r.get('grape_variety',''))
"
```

Expected: sensible region/grape values for wine SKUs with clear appellation names.

- [ ] **Step 5: Commit the updated products.json**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/db/products.json && git commit -m "data: fill region/subregion/grape_variety via name inference (Layer 1)"
```

---

## Task 6: Run Haiku pass for remaining unresolved SKUs

Only run after Task 5 is complete and verified. Uses API credits.

- [ ] **Step 1: Check how many SKUs remain unresolved**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py --dry-run --limit 5000 2>&1 | grep "UNRESOLVED" | wc -l
```

- [ ] **Step 2: Dry-run with Haiku enabled to preview cost**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py --dry-run --limit 200 2>&1 | grep "would_fill"
```

Note: `--dry-run` skips the actual API call. Estimate: ~200 tokens/SKU × 200 SKUs ≈ 40K tokens ≈ $0.04 USD ≈ 1.4 THB.

- [ ] **Step 3: Run Haiku pass on unresolved SKUs (with API)**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python data/enrich_taxonomy.py --limit 500 --workers 4 2>&1 | tail -15
```

Expected: fills remaining region/grape fields via Haiku, prints cost summary.

- [ ] **Step 4: Commit results**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git add data/db/products.json && git commit -m "data: fill remaining taxonomy fields via Haiku (Layer 2)"
```

---

## Full Test Run

After all tasks are complete:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python -m pytest tests/test_taxonomy_grape_rules.py tests/test_taxonomy_haiku.py tests/test_enrich_taxonomy.py -v
```

All tests should pass.
