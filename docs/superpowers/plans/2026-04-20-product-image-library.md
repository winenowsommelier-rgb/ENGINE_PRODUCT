# Product Image Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python ingestion pipeline that transforms the 11,840-row Magento masterfile CSV into a structured `data/db/product-images.json` library with SEO-ready names, a 3-slot image schema ready for future HD uploads, and a back-compat mirror into `products.json`.

**Architecture:** Single driver script (`data/build_product_images.py`) + a pure-functions library (`data/lib/product_naming.py`). TDD: every library function gets a unit test first, then an integration test runs the driver against a fixture CSV, then a final manual run processes the real masterfile and auto-commits the outputs.

**Tech Stack:** Python 3.11+ standard library only (`csv`, `json`, `tempfile`, `os`, `argparse`, `unicodedata`, `subprocess`, `datetime`, `pathlib`). Pytest 8.4.2 (already installed in `.venv/`). No external dependencies.

**Spec:** `docs/superpowers/specs/2026-04-20-product-image-library-design.md`

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `data/lib/__init__.py` | Empty. Makes `data.lib` a Python package. |
| `data/lib/product_naming.py` | Pure functions: website detection, name normalization, slug/title/filename builders, image-struct builder, spec lookup. No I/O. |
| `data/build_product_images.py` | CLI driver. Reads CSV, calls library, writes two JSON outputs, mirrors one field into `products.json`, auto-commits. |
| `tests/__init__.py` | Empty. |
| `tests/conftest.py` | Adds repo root to `sys.path` so tests can `import data.lib.product_naming`. |
| `tests/test_product_naming.py` | ~20 unit tests for the library. |
| `tests/test_build_product_images.py` | Integration test: runs driver on a fixture CSV, asserts output shape + counters. |
| `tests/fixtures/masterfile_sample.csv` | 6-row fixture CSV covering normal / partial / empty / system / unknown-prefix / L-prefix cases. |

### Files that will be generated at runtime (not part of implementation)

- `data/db/product-images.json`
- `data/db/product-images-summary.json`

### Files modified by the driver at runtime

- `data/db/products.json` — only the `image_url` field on matching SKUs is overwritten; every other field is untouched.

---

## Task 1: Scaffold package + test infrastructure

**Files:**
- Create: `data/lib/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Create: `data/lib/product_naming.py` (empty skeleton for now)

- [ ] **Step 1: Create the empty package markers + skeleton**

```bash
mkdir -p "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/lib"
mkdir -p "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/tests"
touch "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/lib/__init__.py"
touch "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/tests/__init__.py"
```

- [ ] **Step 2: Write `tests/conftest.py`**

File: `tests/conftest.py`

```python
"""Put the repo root on sys.path so tests can `import data.lib.product_naming`."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
```

- [ ] **Step 3: Write skeleton `data/lib/product_naming.py`**

File: `data/lib/product_naming.py`

```python
"""Pure functions for product naming, website detection, and image specs.

No I/O. No globals mutated. Every function is unit-tested.
"""
from __future__ import annotations
```

- [ ] **Step 4: Verify imports work**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python3 -c "from data.lib import product_naming; print('ok')"`
Expected output: `ok`

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/lib/__init__.py data/lib/product_naming.py tests/__init__.py tests/conftest.py
git commit -m "scaffold: data/lib + tests package skeletons for product image library"
```

---

## Task 2: Library — website-detection constants + `detect_website`

**Files:**
- Modify: `data/lib/product_naming.py`
- Create: `tests/test_product_naming.py`

- [ ] **Step 1: Write the failing tests**

File: `tests/test_product_naming.py`

```python
"""Unit tests for data.lib.product_naming."""
from __future__ import annotations

from data.lib import product_naming as pn


class TestDetectWebsite:
    def test_wine_prefix_returns_wine_now(self):
        assert pn.detect_website("WDW0001AA") == "wine-now"
        assert pn.detect_website("WRW9999ZZ") == "wine-now"

    def test_spirit_prefix_returns_liq9(self):
        assert pn.detect_website("LWH0001AA") == "liq9"
        assert pn.detect_website("LGN0003AD") == "liq9"

    def test_cigars_return_liq9(self):
        assert pn.detect_website("CIG0149BT") == "liq9"

    def test_mixers_return_liq9(self):
        # User-requested reassignment: NNA + MNA -> Liq9
        assert pn.detect_website("NNA0008AA") == "liq9"
        assert pn.detect_website("MNA0041AE") == "liq9"

    def test_wine_personalization_returns_wine_now(self):
        # User-requested reassignment: AWN -> Wine-Now
        assert pn.detect_website("AWN0001AD") == "wine-now"

    def test_system_products_return_none(self):
        # Shipping, coupons, gift cards -> no SEO suffix
        assert pn.detect_website("DELIVERY1") is None
        assert pn.detect_website("ECP10") is None
        assert pn.detect_website("GIF0001") is None

    def test_unknown_prefix_returns_none(self):
        assert pn.detect_website("ZZZ0001") is None

    def test_blank_sku_returns_none(self):
        assert pn.detect_website("") is None
        assert pn.detect_website("AB") is None  # under 3 chars
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v`
Expected: all 8 FAIL with `AttributeError: module 'data.lib.product_naming' has no attribute 'detect_website'`

- [ ] **Step 3: Implement the minimal code**

Append to `data/lib/product_naming.py`:

```python
WINE_NOW_PREFIXES: frozenset[str] = frozenset({
    # Wines
    "WRW", "WWW", "WSP", "WRS", "WDW", "WOW", "WEV", "WBS", "WNA", "WTK",
    # Wine personalization
    "AWN",
    # Wine-side accessories / glassware
    "ABA", "GWN", "GLQ", "GDC", "GBE", "GWA", "AWC",
})

LIQ9_PREFIXES: frozenset[str] = frozenset({
    # Spirits / liquor
    "LWH", "LSK", "LLQ", "LGN", "LBE", "LTQ", "LVK", "LRM", "LBD",
    "LOT", "LSJ", "LGP", "LWF", "LAB", "LCC", "LWS", "LSN", "LKS",
    "LRD", "LBS", "LWL", "LAQ",
    # Cigars
    "CIG",
    # Mixers / non-alc (user-decided routing)
    "NNA", "MNA",
})

# System products: shipping, coupons, gift cards, shipping fees. No SEO suffix.
NO_SUFFIX_PREFIXES: frozenset[str] = frozenset({
    "DEL", "ECP", "GIF", "ANG", "FYC", "NJV",
})


def detect_website(sku: str) -> str | None:
    """Return 'wine-now', 'liq9', or None (system / unknown).

    None is intentional for system products (shipping, coupons, gift cards) —
    those records will have no '| Website' suffix in their SEO title.
    """
    if not sku or len(sku) < 3:
        return None
    prefix = sku[:3]
    if prefix in WINE_NOW_PREFIXES:
        return "wine-now"
    if prefix in LIQ9_PREFIXES:
        return "liq9"
    return None
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/lib/product_naming.py tests/test_product_naming.py
git commit -m "feat(product_naming): add detect_website with prefix constants"
```

---

## Task 3: Library — string normalization helpers

**Files:**
- Modify: `data/lib/product_naming.py`
- Modify: `tests/test_product_naming.py`

These three functions are small and closely related (all take a raw CSV string, return a normalized string or None). One TDD cycle for the trio.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_product_naming.py`:

```python
class TestNormalizeVintage:
    def test_current_vintage_returns_none(self):
        assert pn.normalize_vintage("Current vintage") is None

    def test_nv_returns_nv(self):
        assert pn.normalize_vintage("NV") == "NV"

    def test_year_returns_year(self):
        assert pn.normalize_vintage("2018") == "2018"

    def test_blank_returns_none(self):
        assert pn.normalize_vintage("") is None
        assert pn.normalize_vintage("   ") is None


class TestNormalizeBottleSize:
    def test_ml_strips_space(self):
        assert pn.normalize_bottle_size("750 ml") == "750ml"

    def test_liter_converts_to_ml(self):
        assert pn.normalize_bottle_size("1.5 L") == "1500ml"
        assert pn.normalize_bottle_size("1 L") == "1000ml"

    def test_blank_returns_none(self):
        assert pn.normalize_bottle_size("") is None
        assert pn.normalize_bottle_size("   ") is None


class TestCleanName:
    def test_collapses_double_spaces(self):
        assert pn.clean_name("Batasiolo  Moscato  Spumante Dolce") \
            == "Batasiolo Moscato Spumante Dolce"

    def test_trims_leading_trailing(self):
        assert pn.clean_name("  Batasiolo  ") == "Batasiolo"

    def test_preserves_diacritics(self):
        assert pn.clean_name("Château Pétale Rosé") == "Château Pétale Rosé"
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v -k "TestNormalize or TestCleanName"`
Expected: all fail with `AttributeError`.

- [ ] **Step 3: Implement the three functions**

Append to `data/lib/product_naming.py`:

```python
import re


def normalize_vintage(raw: str) -> str | None:
    """'Current vintage' -> None, 'NV' -> 'NV', year kept, blank -> None."""
    if not raw:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    if cleaned.lower() == "current vintage":
        return None
    return cleaned


def normalize_bottle_size(raw: str) -> str | None:
    """'750 ml' -> '750ml', '1.5 L' -> '1500ml', blank -> None.

    Handles integer + decimal L values. Falls back to the stripped original
    string if parsing fails (so unexpected formats like '3x750ml' pass through).
    """
    if not raw:
        return None
    cleaned = raw.strip()
    if not cleaned:
        return None
    # L / l / Liter / liter -> ml
    match = re.fullmatch(r"([\d.]+)\s*[Ll]", cleaned)
    if match:
        value_l = float(match.group(1))
        return f"{int(round(value_l * 1000))}ml"
    # ml / mL / ML with optional space
    match = re.fullmatch(r"([\d.]+)\s*[mM][lL]", cleaned)
    if match:
        value_ml = float(match.group(1))
        return f"{int(round(value_ml))}ml"
    # Unknown format -> slug-safe pass-through (strip internal spaces only)
    return cleaned.replace(" ", "")


def clean_name(raw: str) -> str:
    """Collapse internal whitespace runs to single spaces, trim ends."""
    if not raw:
        return ""
    return re.sub(r"\s+", " ", raw).strip()
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v`
Expected: 8 previous + new tests all pass.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/lib/product_naming.py tests/test_product_naming.py
git commit -m "feat(product_naming): add normalize_vintage, normalize_bottle_size, clean_name"
```

---

## Task 4: Library — `to_slug` (with diacritics handling)

**Files:**
- Modify: `data/lib/product_naming.py`
- Modify: `tests/test_product_naming.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_product_naming.py`:

```python
class TestToSlug:
    def test_basic_slug(self):
        assert pn.to_slug("Batasiolo", "Moscato Spumante Dolce", "NV", "750 ml") \
            == "batasiolo-moscato-spumante-dolce-nv-750ml"

    def test_strips_diacritics(self):
        assert pn.to_slug(
            "Château la Tour de l'évêque",
            "Pétale de Rose Rosé",
            "2020",
            "750 ml",
        ) == "chateau-la-tour-de-l-eveque-petale-de-rose-rose-2020-750ml"

    def test_drops_current_vintage(self):
        assert pn.to_slug("Coastal Ridge", "Cabernet Sauvignon", "Current vintage", "750 ml") \
            == "coastal-ridge-cabernet-sauvignon-750ml"

    def test_drops_blank_vintage_and_size(self):
        assert pn.to_slug("Vinturi", "Deluxe Red Wine Aerator Set", "", "") \
            == "vinturi-deluxe-red-wine-aerator-set"

    def test_collapses_double_spaces_in_raw_name(self):
        assert pn.to_slug("Batasiolo", "Moscato  Spumante   Dolce", "NV", "750 ml") \
            == "batasiolo-moscato-spumante-dolce-nv-750ml"

    def test_strips_special_chars(self):
        assert pn.to_slug("Moët & Chandon", "Brut Impérial", "NV", "750 ml") \
            == "moet-chandon-brut-imperial-nv-750ml"

    def test_no_leading_trailing_hyphens(self):
        # Even if inputs start/end with punctuation, slug has no leading/trailing dash
        result = pn.to_slug("  -Brand-  ", "!Name!", "NV", "750 ml")
        assert not result.startswith("-")
        assert not result.endswith("-")
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py::TestToSlug -v`
Expected: all 7 fail.

- [ ] **Step 3: Implement `to_slug`**

Append to `data/lib/product_naming.py`:

```python
import unicodedata


def _slugify(text: str) -> str:
    """Lower-case, ASCII-only, hyphen-separated. Used for both slugs + filenames."""
    # Normalize unicode + strip combining marks (diacritics)
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    # Lowercase
    lowered = ascii_only.lower()
    # Replace any run of non-[a-z0-9] with a single hyphen
    hyphenated = re.sub(r"[^a-z0-9]+", "-", lowered)
    # Collapse repeated hyphens, strip leading/trailing
    return hyphenated.strip("-")


def to_slug(brand: str, name: str, vintage: str, size: str) -> str:
    """Produce a URL-safe slug from brand + name + vintage + size.

    Examples:
        to_slug('Batasiolo', 'Moscato Spumante Dolce', 'NV', '750 ml')
            -> 'batasiolo-moscato-spumante-dolce-nv-750ml'

    'Current vintage' and blank values are dropped entirely from the slug.
    """
    tokens = [clean_name(brand), clean_name(name)]
    v = normalize_vintage(vintage)
    if v:
        tokens.append(v)
    s = normalize_bottle_size(size)
    if s:
        tokens.append(s)
    joined = " ".join(t for t in tokens if t)
    return _slugify(joined)
```

- [ ] **Step 4: Run and confirm they pass**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v`
Expected: all previous tests + 7 new ones pass.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/lib/product_naming.py tests/test_product_naming.py
git commit -m "feat(product_naming): add to_slug with diacritics + special-char handling"
```

---

## Task 5: Library — `to_seo_title` + `to_image_filename_base`

**Files:**
- Modify: `data/lib/product_naming.py`
- Modify: `tests/test_product_naming.py`

Both functions build composite strings from the same inputs; one TDD cycle.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_product_naming.py`:

```python
class TestToSeoTitle:
    def test_wine_now_suffix(self):
        assert pn.to_seo_title(
            "Batasiolo", "Moscato Spumante Dolce", "NV", "750 ml", "wine-now",
        ) == "Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now"

    def test_liq9_suffix(self):
        assert pn.to_seo_title(
            "Glenfiddich", "12 Years Old", "", "700 ml", "liq9",
        ) == "Glenfiddich 12 Years Old 700ml | Liq9"

    def test_no_suffix_when_website_is_none(self):
        # System products: no '| Website' tail
        assert pn.to_seo_title(
            "Gift Card", "Gift Card 100 Baht", "", "", None,
        ) == "Gift Card Gift Card 100 Baht"

    def test_drops_current_vintage_and_blank_size(self):
        assert pn.to_seo_title(
            "Vinturi", "Deluxe Aerator", "Current vintage", "", "wine-now",
        ) == "Vinturi Deluxe Aerator | Wine-Now"

    def test_collapses_double_spaces(self):
        assert pn.to_seo_title(
            "Batasiolo", "Moscato  Spumante  Dolce", "NV", "750 ml", "wine-now",
        ) == "Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now"


class TestToImageFilenameBase:
    def test_appends_sku_lowercase(self):
        assert pn.to_image_filename_base(
            "Batasiolo", "Moscato Spumante Dolce", "NV", "750 ml", "WDW0001AA",
        ) == "batasiolo-moscato-spumante-dolce-nv-750ml-wdw0001aa"

    def test_no_extension_included(self):
        result = pn.to_image_filename_base(
            "Batasiolo", "Moscato", "NV", "750 ml", "WDW0001AA",
        )
        assert "." not in result
        assert result.endswith("-wdw0001aa")
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v -k "TestToSeoTitle or TestToImageFilenameBase"`
Expected: all 7 fail.

- [ ] **Step 3: Implement both functions**

Append to `data/lib/product_naming.py`:

```python
_WEBSITE_DISPLAY = {"wine-now": "Wine-Now", "liq9": "Liq9"}


def to_seo_title(
    brand: str, name: str, vintage: str, size: str, website: str | None
) -> str:
    """Produce an SEO-ready display title.

    Example:
        'Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now'

    When website is None, the ' | Website' suffix is omitted (system products).
    """
    tokens = [clean_name(brand), clean_name(name)]
    v = normalize_vintage(vintage)
    if v:
        tokens.append(v)
    s = normalize_bottle_size(size)
    if s:
        tokens.append(s)
    core = " ".join(t for t in tokens if t)
    if website and website in _WEBSITE_DISPLAY:
        return f"{core} | {_WEBSITE_DISPLAY[website]}"
    return core


def to_image_filename_base(
    brand: str, name: str, vintage: str, size: str, sku: str
) -> str:
    """Slug-shaped filename stem including the SKU (no extension)."""
    slug = to_slug(brand, name, vintage, size)
    sku_part = sku.strip().lower()
    return f"{slug}-{sku_part}" if slug else sku_part
```

- [ ] **Step 4: Run and confirm they pass**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v`
Expected: all previous + 7 new tests pass.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/lib/product_naming.py tests/test_product_naming.py
git commit -m "feat(product_naming): add to_seo_title + to_image_filename_base"
```

---

## Task 6: Library — image helpers (`IMAGE_SPECS`, `image_spec`, `pick_best_url`, `build_image_struct`)

**Files:**
- Modify: `data/lib/product_naming.py`
- Modify: `tests/test_product_naming.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_product_naming.py`:

```python
class TestImageSpecs:
    def test_thumbnail_spec(self):
        s = pn.image_spec("thumbnail")
        assert s == {"width": 240, "height": 240, "format": "JPEG", "quality": 85, "max_kb": 20}

    def test_image_spec(self):
        s = pn.image_spec("image")
        assert s["width"] == 800 and s["height"] == 800 and s["format"] == "JPEG"

    def test_image_hd_spec(self):
        s = pn.image_spec("image_hd")
        assert s["width"] == 2000 and s["format"] == "WebP" and s["max_kb"] == 500

    def test_unknown_slot_raises(self):
        import pytest as _pytest
        with _pytest.raises(KeyError):
            pn.image_spec("xxl")


class TestPickBestUrl:
    def test_image_wins_over_others(self):
        assert pn.pick_best_url("a.jpg", "b.jpg", "c.jpg") == "b.jpg"

    def test_thumbnail_fallback(self):
        assert pn.pick_best_url("a.jpg", "", "c.jpg") == "a.jpg"

    def test_small_fallback_last(self):
        assert pn.pick_best_url("", "", "c.jpg") == "c.jpg"

    def test_all_empty_returns_none(self):
        assert pn.pick_best_url("", "", "") is None

    def test_whitespace_treated_as_empty(self):
        assert pn.pick_best_url("   ", "", "  ") is None


class TestBuildImageStruct:
    def test_url_populates_all_three_slots(self):
        images, status = pn.build_image_struct("https://example.com/x.jpg")
        assert status == "legacy"
        assert set(images.keys()) == {"thumbnail", "image", "image_hd"}
        for slot in ("thumbnail", "image", "image_hd"):
            assert images[slot]["url"] == "https://example.com/x.jpg"
            assert images[slot]["source"] == "magento-legacy"
            assert "spec" in images[slot]

    def test_none_returns_missing(self):
        images, status = pn.build_image_struct(None)
        assert images is None and status == "missing"
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v -k "TestImageSpecs or TestPickBestUrl or TestBuildImageStruct"`
Expected: all 11 fail.

- [ ] **Step 3: Implement the four helpers**

Append to `data/lib/product_naming.py`:

```python
IMAGE_SPECS: dict[str, dict[str, int | str]] = {
    "thumbnail": {"width": 240,  "height": 240,  "format": "JPEG", "quality": 85, "max_kb":  20},
    "image":     {"width": 800,  "height": 800,  "format": "JPEG", "quality": 85, "max_kb": 120},
    "image_hd":  {"width": 2000, "height": 2000, "format": "WebP", "quality": 90, "max_kb": 500},
}


def image_spec(slot: str) -> dict[str, int | str]:
    """Return the target spec for a slot. KeyError on unknown slot."""
    return dict(IMAGE_SPECS[slot])  # copy so callers can't mutate our constant


def pick_best_url(thumb: str, image: str, small: str) -> str | None:
    """Priority: image > thumbnail > small_image. Whitespace treated as empty."""
    for candidate in (image, thumb, small):
        if candidate and candidate.strip():
            return candidate.strip()
    return None


def build_image_struct(
    best_url: str | None,
) -> tuple[dict[str, dict] | None, str]:
    """Expand a single URL into the 3-slot structure + return the status.

    Returns (images_dict, status) where status is 'legacy' or 'missing'.
    When best_url is None, images_dict is None and status is 'missing'.
    """
    if not best_url:
        return None, "missing"
    images: dict[str, dict] = {}
    for slot in ("thumbnail", "image", "image_hd"):
        images[slot] = {
            "url": best_url,
            "spec": image_spec(slot),
            "source": "magento-legacy",
        }
    return images, "legacy"
```

- [ ] **Step 4: Run and confirm all library tests pass**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_product_naming.py -v`
Expected: every test passes. Total ~35–40 tests.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/lib/product_naming.py tests/test_product_naming.py
git commit -m "feat(product_naming): add image helpers (specs, pick_best_url, build_image_struct)"
```

---

## Task 7: Driver — CSV → records transform (with integration test fixture)

**Files:**
- Create: `tests/fixtures/masterfile_sample.csv`
- Create: `tests/test_build_product_images.py`
- Create: `data/build_product_images.py`

- [ ] **Step 1: Create the 6-row fixture CSV**

File: `tests/fixtures/masterfile_sample.csv`

```csv
sku,is_in_stock,status,brand,name,vintage,bottle_size,thumbnail,image,small_image
WDW0001AA,1,1,Batasiolo,Batasiolo  Moscato Spumante Dolce,NV,750 ml,https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa.jpg,https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa.jpg,https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa.jpg
LWH0001AA,1,1,Glenfiddich,Glenfiddich  12 Years Old,Current vintage,700 ml,https://th.wine-now.com/media/catalog/product/l/w/lwh0001aa.jpg,https://th.wine-now.com/media/catalog/product/l/w/lwh0001aa.jpg,https://th.wine-now.com/media/catalog/product/l/w/lwh0001aa.jpg
CIG0149BT,0,1,Jose L. Piedra,Jose L. Piedra  Mini,,20 pcs,https://th.wine-now.com/media/catalog/product/c/i/cig0149bt.jpg,,
NNA0008AA,1,1,Monin,Monin  Strawberry,Current vintage,700 ml,,https://th.wine-now.com/media/catalog/product/n/n/nna0008aa.jpg,
DELIVERY1,1,1,,DELIVERY 100,,,,,
ZZZ0001AA,1,1,UnknownBrand,Unknown Product,NV,750 ml,https://example.com/zzz.jpg,https://example.com/zzz.jpg,https://example.com/zzz.jpg
```

- [ ] **Step 2: Write the integration test for the transform only**

File: `tests/test_build_product_images.py`

```python
"""Integration tests for data/build_product_images.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_CSV = REPO_ROOT / "tests" / "fixtures" / "masterfile_sample.csv"
DRIVER = REPO_ROOT / "data" / "build_product_images.py"


def run_driver(tmp_path: Path, extra_args: list[str] = None) -> dict:
    """Run the driver on the fixture, return parsed product-images.json."""
    output = tmp_path / "product-images.json"
    args = [
        sys.executable, str(DRIVER),
        "--master", str(FIXTURE_CSV),
        "--output", str(output),
        "--no-mirror",
        "--no-commit",
    ]
    if extra_args:
        args.extend(extra_args)
    result = subprocess.run(args, capture_output=True, text=True, cwd=REPO_ROOT)
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    return json.loads(output.read_text())


class TestTransform:
    def test_record_count_and_meta(self, tmp_path):
        data = run_driver(tmp_path)
        # 6 fixture rows, all have non-blank SKU
        assert data["_meta"]["row_count"] == 6
        assert data["_meta"]["missing_count"] == 1  # DELIVERY1 has no image
        # CIG has only thumbnail; NNA has only image; DELIVERY1 empty -> 2 partial-filled
        assert data["_meta"]["partial_filled_count"] == 2

    def test_wine_record(self, tmp_path):
        data = run_driver(tmp_path)
        rec = data["records"]["WDW0001AA"]
        assert rec["website"] == "wine-now"
        assert rec["name_seo"] == "Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now"
        assert rec["name_slug"] == "batasiolo-moscato-spumante-dolce-nv-750ml"
        assert rec["image_filename_base"].endswith("-wdw0001aa")
        assert rec["vintage"] == "NV"
        assert rec["bottle_size"] == "750ml"
        assert rec["image_status"] == "legacy"
        assert rec["images"]["image"]["url"].endswith("wdw0001aa.jpg")

    def test_liq9_record(self, tmp_path):
        data = run_driver(tmp_path)
        rec = data["records"]["LWH0001AA"]
        assert rec["website"] == "liq9"
        assert rec["name_seo"] == "Glenfiddich 12 Years Old 700ml | Liq9"
        assert rec["vintage"] is None  # Current vintage dropped

    def test_system_record_no_suffix(self, tmp_path):
        data = run_driver(tmp_path)
        rec = data["records"]["DELIVERY1"]
        assert rec["website"] is None
        assert "|" not in rec["name_seo"]
        assert rec["images"] is None
        assert rec["image_status"] == "missing"

    def test_unknown_prefix_logged(self, tmp_path):
        data = run_driver(tmp_path)
        assert "ZZZ" in data["_meta"]["unknown_prefixes"]
        rec = data["records"]["ZZZ0001AA"]
        assert rec["website"] is None

    def test_partial_fill_uses_best_available(self, tmp_path):
        data = run_driver(tmp_path)
        # CIG0149BT has only thumbnail populated -> all 3 slots should hold it
        rec = data["records"]["CIG0149BT"]
        assert rec["image_status"] == "legacy"
        url = rec["images"]["image"]["url"]
        assert url.endswith("cig0149bt.jpg")
        # All 3 slots match
        assert rec["images"]["thumbnail"]["url"] == url
        assert rec["images"]["image_hd"]["url"] == url
```

- [ ] **Step 3: Run and confirm the integration test fails** (driver doesn't exist yet)

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_build_product_images.py -v`
Expected: all tests ERROR/FAIL with `FileNotFoundError` or `can't open file 'data/build_product_images.py'`.

- [ ] **Step 4: Write the minimal driver — transform + write output only**

File: `data/build_product_images.py`

```python
#!/usr/bin/env python3
"""Build data/db/product-images.json from the 2026FEB masterfile CSV.

See docs/superpowers/specs/2026-04-20-product-image-library-design.md
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

# Make 'data.lib.product_naming' importable when run as a script
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib import product_naming as pn  # noqa: E402


DEFAULT_MASTER = (
    REPO_ROOT / "data" / "data mastefile WNLQ9"
    / "DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv"
)
DEFAULT_OUTPUT = REPO_ROOT / "data" / "db" / "product-images.json"
DEFAULT_SUMMARY = REPO_ROOT / "data" / "db" / "product-images-summary.json"
DEFAULT_PRODUCTS = REPO_ROOT / "data" / "db" / "products.json"
SOURCE_TAG = "masterfile-2026FEB"


def build_records(csv_path: Path) -> tuple[dict, dict]:
    """Read CSV, produce (records_dict, meta_dict). No I/O side effects besides reading."""
    records: dict[str, dict] = {}
    by_website: Counter[str] = Counter()
    unknown_prefixes: set[str] = set()
    missing_count = 0
    partial_filled_count = 0
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sku = (row.get("sku") or "").strip()
            if not sku:
                continue

            website = pn.detect_website(sku)
            if website is None and sku[:3] not in pn.NO_SUFFIX_PREFIXES and len(sku) >= 3:
                unknown_prefixes.add(sku[:3])

            thumb = row.get("thumbnail", "") or ""
            img = row.get("image", "") or ""
            small = row.get("small_image", "") or ""
            best_url = pn.pick_best_url(thumb, img, small)

            # Track partial-fill rows: any slot blank but at least one URL present
            slots_present = sum(1 for u in (thumb, img, small) if u and u.strip())
            if 0 < slots_present < 3:
                partial_filled_count += 1

            images, status = pn.build_image_struct(best_url)
            if status == "missing":
                missing_count += 1

            brand = (row.get("brand") or "").strip()
            name = row.get("name") or ""
            vintage_raw = row.get("vintage") or ""
            size_raw = row.get("bottle_size") or ""

            records[sku] = {
                "sku": sku,
                "website": website,
                "name_seo": pn.to_seo_title(brand, name, vintage_raw, size_raw, website),
                "name_slug": pn.to_slug(brand, name, vintage_raw, size_raw),
                "image_filename_base": pn.to_image_filename_base(brand, name, vintage_raw, size_raw, sku),
                "brand": brand,
                "vintage": pn.normalize_vintage(vintage_raw),
                "bottle_size": pn.normalize_bottle_size(size_raw),
                "images": images,
                "image_status": status,
                "is_in_stock": (row.get("is_in_stock") or "").strip() == "1",
                "last_source": SOURCE_TAG,
                "updated_at": generated_at,
            }
            by_website[website or "none"] += 1

    meta = {
        "generated_at": generated_at,
        "source_file": csv_path.name,
        "row_count": len(records),
        "missing_count": missing_count,
        "partial_filled_count": partial_filled_count,
        "by_website": dict(by_website),
        "unknown_prefixes": sorted(unknown_prefixes),
    }
    return records, meta


def atomic_write_json(path: Path, data: dict) -> None:
    """Write JSON via tmp-file + os.rename so partial failures don't corrupt."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=str(path.parent), delete=False, suffix=".tmp", encoding="utf-8"
    ) as tmp:
        json.dump(data, tmp, indent=2, ensure_ascii=False)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build product image library from masterfile CSV.")
    p.add_argument("--master", type=Path, default=DEFAULT_MASTER)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    p.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    p.add_argument("--mirror-to-products", type=Path, default=DEFAULT_PRODUCTS)
    p.add_argument("--no-mirror", action="store_true")
    p.add_argument("--no-commit", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.master.exists():
        print(f"ERROR: masterfile not found: {args.master}", file=sys.stderr)
        return 1
    records, meta = build_records(args.master)
    output_data = {"_meta": meta, "records": records}

    if args.dry_run:
        print(f"[dry-run] would write {len(records)} records to {args.output}")
        return 0

    atomic_write_json(args.output, output_data)
    print(f"Wrote {len(records)} records to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run the integration tests and confirm they pass**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_build_product_images.py -v`
Expected: all 6 pass.

- [ ] **Step 6: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add tests/fixtures tests/test_build_product_images.py data/build_product_images.py
git commit -m "feat(build_product_images): CSV transform + atomic output write"
```

---

## Task 8: Driver — validation + summary JSON + SKU/slug collision tracking

**Files:**
- Modify: `data/build_product_images.py`
- Modify: `tests/test_build_product_images.py`
- Extend: `tests/fixtures/masterfile_sample.csv` (add collision cases)

- [ ] **Step 1: Add collision rows to the fixture**

Append these 2 lines to `tests/fixtures/masterfile_sample.csv` (between the existing rows is fine too, but end-of-file keeps diff small):

```csv
WDW0001AA,1,1,Batasiolo,Batasiolo  Moscato Spumante Dolce,NV,750 ml,https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa_dup.jpg,https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa_dup.jpg,https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa_dup.jpg
WDW0099AA,1,1,Batasiolo,Batasiolo  Moscato Spumante Dolce,NV,750 ml,https://th.wine-now.com/media/catalog/product/w/d/wdw0099aa.jpg,https://th.wine-now.com/media/catalog/product/w/d/wdw0099aa.jpg,https://th.wine-now.com/media/catalog/product/w/d/wdw0099aa.jpg
```

First line duplicates SKU `WDW0001AA` (SKU collision). Second line has a different SKU but the **same slug** as `WDW0001AA` (slug collision).

- [ ] **Step 2: Write failing tests for validation + update the stale row_count assertion**

**First:** update the Task 7 assertion whose expectation changes when the fixture grows. In `tests/test_build_product_images.py`, **replace the existing `TestTransform.test_record_count_and_meta` method body** with:

```python
    def test_record_count_and_meta(self, tmp_path):
        data = run_driver(tmp_path)
        # 8 raw fixture rows; WDW0001AA is duplicated -> 7 unique SKUs written
        # (last-row-wins for collisions — the duplicate is also tracked in
        # warnings.sku_collisions, see TestValidation below.)
        assert data["_meta"]["row_count"] == 7
        assert data["_meta"]["missing_count"] == 1  # DELIVERY1 has no image
        # CIG has only thumbnail; NNA has only image; DELIVERY1 empty -> 2 partial-filled
        assert data["_meta"]["partial_filled_count"] == 2
```

**Then:** append the new TestValidation class to `tests/test_build_product_images.py`:

```python
class TestValidation:
    def test_sku_collision_recorded(self, tmp_path):
        data = run_driver(tmp_path)
        summary_path = tmp_path / "product-images-summary.json"
        # Driver should also write a summary when given --summary path
        summary = json.loads(summary_path.read_text())
        sku_coll = summary.get("warnings", {}).get("sku_collisions", [])
        assert any(c["sku"] == "WDW0001AA" for c in sku_coll)

    def test_slug_collision_recorded(self, tmp_path):
        data = run_driver(tmp_path)
        summary_path = tmp_path / "product-images-summary.json"
        summary = json.loads(summary_path.read_text())
        slug_coll = summary.get("warnings", {}).get("slug_collisions", [])
        # WDW0001AA + WDW0099AA share the slug
        hits = [c for c in slug_coll
                if c["slug"] == "batasiolo-moscato-spumante-dolce-nv-750ml"]
        assert hits and set(hits[0]["skus"]) == {"WDW0001AA", "WDW0099AA"}

    def test_summary_has_meta_counters(self, tmp_path):
        run_driver(tmp_path)
        summary = json.loads((tmp_path / "product-images-summary.json").read_text())
        assert "row_count" in summary
        assert "missing_count" in summary
        assert "by_website" in summary

    def test_duplicate_sku_last_row_wins(self, tmp_path):
        # Fixture row order places the '_dup.jpg' URL as the second WDW0001AA occurrence.
        # build_records processes rows top-to-bottom; the last row for a given SKU wins.
        data = run_driver(tmp_path)
        url = data["records"]["WDW0001AA"]["images"]["image"]["url"]
        assert url.endswith("wdw0001aa_dup.jpg")
```

Also update `run_driver` to pass the summary path:

```python
def run_driver(tmp_path: Path, extra_args: list[str] = None) -> dict:
    output = tmp_path / "product-images.json"
    summary = tmp_path / "product-images-summary.json"
    args = [
        sys.executable, str(DRIVER),
        "--master", str(FIXTURE_CSV),
        "--output", str(output),
        "--summary", str(summary),
        "--no-mirror",
        "--no-commit",
    ]
    if extra_args:
        args.extend(extra_args)
    result = subprocess.run(args, capture_output=True, text=True, cwd=REPO_ROOT)
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    return json.loads(output.read_text())
```

- [ ] **Step 3: Run and confirm they fail**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_build_product_images.py::TestValidation -v`
Expected: FileNotFoundError (summary file) or KeyError on warnings.

- [ ] **Step 4: Implement collision detection + summary writer**

In `data/build_product_images.py`, update `build_records` to also return warnings, and add a summary-writing path.

Replace the inside of `build_records` loop and return statement:

```python
def build_records(csv_path: Path) -> tuple[dict, dict, dict]:
    """Read CSV; return (records, meta, warnings)."""
    records: dict[str, dict] = {}
    by_website: Counter[str] = Counter()
    unknown_prefixes: set[str] = set()
    sku_collisions: list[dict] = []
    slug_to_skus: dict[str, list[str]] = defaultdict(list)
    seen_skus: dict[str, int] = {}  # sku -> first-seen row number
    missing_count = 0
    partial_filled_count = 0
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row_num, row in enumerate(reader, start=2):  # 1 = header
            sku = (row.get("sku") or "").strip()
            if not sku:
                continue

            if sku in seen_skus:
                sku_collisions.append({
                    "sku": sku,
                    "first_row": seen_skus[sku],
                    "duplicate_row": row_num,
                })
            else:
                seen_skus[sku] = row_num

            website = pn.detect_website(sku)
            if website is None and sku[:3] not in pn.NO_SUFFIX_PREFIXES and len(sku) >= 3:
                unknown_prefixes.add(sku[:3])

            thumb = row.get("thumbnail", "") or ""
            img = row.get("image", "") or ""
            small = row.get("small_image", "") or ""
            best_url = pn.pick_best_url(thumb, img, small)

            slots_present = sum(1 for u in (thumb, img, small) if u and u.strip())
            if 0 < slots_present < 3:
                partial_filled_count += 1

            images, status = pn.build_image_struct(best_url)
            if status == "missing":
                missing_count += 1

            brand = (row.get("brand") or "").strip()
            name = row.get("name") or ""
            vintage_raw = row.get("vintage") or ""
            size_raw = row.get("bottle_size") or ""

            slug = pn.to_slug(brand, name, vintage_raw, size_raw)
            if slug:
                slug_to_skus[slug].append(sku)

            records[sku] = {
                "sku": sku,
                "website": website,
                "name_seo": pn.to_seo_title(brand, name, vintage_raw, size_raw, website),
                "name_slug": slug,
                "image_filename_base": pn.to_image_filename_base(brand, name, vintage_raw, size_raw, sku),
                "brand": brand,
                "vintage": pn.normalize_vintage(vintage_raw),
                "bottle_size": pn.normalize_bottle_size(size_raw),
                "images": images,
                "image_status": status,
                "is_in_stock": (row.get("is_in_stock") or "").strip() == "1",
                "last_source": SOURCE_TAG,
                "updated_at": generated_at,
            }
            by_website[website or "none"] += 1

    slug_collisions = [
        {"slug": s, "skus": sorted(skus)}
        for s, skus in slug_to_skus.items()
        if len(skus) > 1
    ]

    meta = {
        "generated_at": generated_at,
        "source_file": csv_path.name,
        "row_count": len(records),
        "missing_count": missing_count,
        "partial_filled_count": partial_filled_count,
        "by_website": dict(by_website),
        "unknown_prefixes": sorted(unknown_prefixes),
    }
    warnings = {
        "sku_collisions": sku_collisions,
        "slug_collisions": slug_collisions,
    }
    return records, meta, warnings
```

Update `main` to unpack the new return and write the summary file:

```python
def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.master.exists():
        print(f"ERROR: masterfile not found: {args.master}", file=sys.stderr)
        return 1
    records, meta, warnings = build_records(args.master)
    output_data = {"_meta": meta, "records": records}
    summary_data = {**meta, "warnings": warnings}

    # Emit stderr lines for any operator-visible issues (stays in CI logs)
    if warnings["sku_collisions"]:
        print(
            f"WARNING: {len(warnings['sku_collisions'])} SKU collisions (see summary)",
            file=sys.stderr,
        )
    if warnings["slug_collisions"]:
        print(
            f"WARNING: {len(warnings['slug_collisions'])} slug collisions (see summary)",
            file=sys.stderr,
        )
    if meta["unknown_prefixes"]:
        print(
            f"WARNING: unknown SKU prefixes: {meta['unknown_prefixes']}",
            file=sys.stderr,
        )

    if args.dry_run:
        print(f"[dry-run] would write {len(records)} records to {args.output}")
        print(f"[dry-run] would write summary to {args.summary}")
        return 0

    atomic_write_json(args.output, output_data)
    atomic_write_json(args.summary, summary_data)
    print(f"Wrote {len(records)} records to {args.output}")
    print(f"Wrote summary to {args.summary}")
    return 0
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_build_product_images.py -v`
Expected: all tests (old + new validation tests) pass.

- [ ] **Step 6: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/build_product_images.py tests/test_build_product_images.py tests/fixtures/masterfile_sample.csv
git commit -m "feat(build_product_images): collision detection + summary JSON"
```

---

## Task 9: Driver — products.json mirror (atomic, merge-only)

**Files:**
- Modify: `data/build_product_images.py`
- Modify: `tests/test_build_product_images.py`

**Note on `products.json` shape:** The spec describes the mirror semantically as `products.json[sku].image_url = ...`, but on disk the file is a **JSON array of product dicts**, not a dict keyed by SKU. The implementation below iterates the list and matches by `sku` — that is the correct shape.

- [ ] **Step 1: Write failing mirror tests**

Append to `tests/test_build_product_images.py`:

```python
class TestMirror:
    def test_mirror_updates_only_image_url(self, tmp_path):
        # Seed a fake products.json with 2 rows
        fake_products = tmp_path / "fake-products.json"
        fake_products.write_text(json.dumps([
            {"sku": "WDW0001AA", "name": "Foo", "image_url": None, "price": 1000},
            {"sku": "UNRELATED", "name": "Bar", "image_url": "keep-me", "price": 500},
        ]))
        output = tmp_path / "product-images.json"
        summary = tmp_path / "product-images-summary.json"
        result = subprocess.run(
            [sys.executable, str(DRIVER),
             "--master", str(FIXTURE_CSV),
             "--output", str(output),
             "--summary", str(summary),
             "--mirror-to-products", str(fake_products),
             "--no-commit"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        assert result.returncode == 0, result.stderr
        mirrored = json.loads(fake_products.read_text())
        by_sku = {r["sku"]: r for r in mirrored}
        # Matching SKU: image_url set, everything else identical
        assert by_sku["WDW0001AA"]["image_url"].endswith("wdw0001aa.jpg")
        assert by_sku["WDW0001AA"]["name"] == "Foo"
        assert by_sku["WDW0001AA"]["price"] == 1000
        # Unrelated SKU: untouched
        assert by_sku["UNRELATED"]["image_url"] == "keep-me"
        assert by_sku["UNRELATED"]["price"] == 500

    def test_no_mirror_flag_skips(self, tmp_path):
        fake_products = tmp_path / "fake-products.json"
        original = [{"sku": "WDW0001AA", "image_url": "original"}]
        fake_products.write_text(json.dumps(original))
        output = tmp_path / "product-images.json"
        summary = tmp_path / "product-images-summary.json"
        subprocess.run(
            [sys.executable, str(DRIVER),
             "--master", str(FIXTURE_CSV),
             "--output", str(output),
             "--summary", str(summary),
             "--mirror-to-products", str(fake_products),
             "--no-mirror", "--no-commit"],
            check=True, cwd=REPO_ROOT,
        )
        assert json.loads(fake_products.read_text()) == original
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_build_product_images.py::TestMirror -v`
Expected: test_mirror_updates_only_image_url fails (no mirror yet); test_no_mirror_flag_skips passes trivially.

- [ ] **Step 3: Implement the mirror**

Add the mirror function to `data/build_product_images.py` (place above `main`):

```python
def mirror_image_url_to_products(
    products_path: Path, records: dict[str, dict]
) -> int:
    """Overwrite only the `image_url` field per matching SKU. Returns count updated.

    All other fields on each record are untouched. Records in products.json whose
    SKU is not in the image library are untouched. Atomic write.
    """
    if not products_path.exists():
        print(
            f"WARNING: products.json not found at {products_path}, skipping mirror",
            file=sys.stderr,
        )
        return 0
    products: list[dict] = json.loads(products_path.read_text(encoding="utf-8"))
    updated = 0
    for row in products:
        sku = row.get("sku")
        if not sku:
            continue
        rec = records.get(sku)
        if not rec or not rec.get("images"):
            continue
        row["image_url"] = rec["images"]["image"]["url"]
        updated += 1
    atomic_write_json(products_path, products)
    return updated
```

**Note:** `atomic_write_json` currently dumps a dict. Update it to accept any JSON-serializable value:

```python
def atomic_write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=str(path.parent), delete=False, suffix=".tmp", encoding="utf-8"
    ) as tmp:
        json.dump(data, tmp, indent=2, ensure_ascii=False)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)
```

Update `main` to call the mirror:

```python
def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.master.exists():
        print(f"ERROR: masterfile not found: {args.master}", file=sys.stderr)
        return 1
    records, meta, warnings = build_records(args.master)
    output_data = {"_meta": meta, "records": records}
    summary_data = {**meta, "warnings": warnings}

    # Warnings to stderr
    if warnings["sku_collisions"]:
        print(f"WARNING: {len(warnings['sku_collisions'])} SKU collisions (see summary)", file=sys.stderr)
    if warnings["slug_collisions"]:
        print(f"WARNING: {len(warnings['slug_collisions'])} slug collisions (see summary)", file=sys.stderr)
    if meta["unknown_prefixes"]:
        print(f"WARNING: unknown SKU prefixes: {meta['unknown_prefixes']}", file=sys.stderr)

    if args.dry_run:
        print(f"[dry-run] would write {len(records)} records to {args.output}")
        print(f"[dry-run] would write summary to {args.summary}")
        if not args.no_mirror:
            print(f"[dry-run] would mirror image_url into {args.mirror_to_products}")
        return 0

    atomic_write_json(args.output, output_data)
    atomic_write_json(args.summary, summary_data)
    print(f"Wrote {len(records)} records to {args.output}")
    print(f"Wrote summary to {args.summary}")

    if not args.no_mirror:
        updated = mirror_image_url_to_products(args.mirror_to_products, records)
        print(f"Mirrored image_url to {updated} records in {args.mirror_to_products}")

    return 0
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_build_product_images.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/build_product_images.py tests/test_build_product_images.py
git commit -m "feat(build_product_images): mirror image_url into products.json atomically"
```

---

## Task 10: Driver — auto-commit logic

**Files:**
- Modify: `data/build_product_images.py`
- Modify: `tests/test_build_product_images.py`

- [ ] **Step 1: Write failing test for auto-commit**

Append to `tests/test_build_product_images.py`:

```python
class TestAutoCommit:
    def test_no_commit_flag_skips_git(self, tmp_path):
        """When --no-commit is set, git operations must not run."""
        # The fixture-based test already uses --no-commit throughout, so if git
        # were ever invoked unexpectedly it would fail in prior tests. Here we
        # assert the driver prints no 'Committed' line when --no-commit is set.
        output = tmp_path / "product-images.json"
        summary = tmp_path / "product-images-summary.json"
        result = subprocess.run(
            [sys.executable, str(DRIVER),
             "--master", str(FIXTURE_CSV),
             "--output", str(output),
             "--summary", str(summary),
             "--no-mirror", "--no-commit"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        assert result.returncode == 0
        assert "Committed" not in result.stdout
        assert "git" not in result.stdout.lower()
```

*(We do not write a positive auto-commit test — it would pollute the repo's git history. The manual run in Task 12 is the positive verification.)*

- [ ] **Step 2: Run and confirm it passes trivially** (auto-commit isn't built yet; nothing prints "Committed")

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_build_product_images.py::TestAutoCommit -v`
Expected: pass.

- [ ] **Step 3: Implement auto-commit**

Add to `data/build_product_images.py` (above `main`; `import subprocess` was added to the top-of-file imports in Task 7 already):

```python
def auto_commit(files: list[Path], meta: dict, warnings: dict, mirror_count: int | None) -> bool:
    """git add + commit the specified files. Skip if no diff. Returns True if committed."""
    # Stage only the specified files
    subprocess.run(["git", "add", "--"] + [str(f) for f in files], check=True, cwd=REPO_ROOT)
    # Abort if nothing is staged
    diff = subprocess.run(
        ["git", "diff", "--cached", "--quiet"],
        cwd=REPO_ROOT,
    )
    if diff.returncode == 0:
        print("No output changes to commit.")
        return False

    by_ws = meta.get("by_website", {})
    by_ws_str = " | ".join(f"{k}: {v}" for k, v in by_ws.items()) or "(none)"
    lines = [
        "data: rebuild product image library from 2026FEB masterfile",
        "",
        f"- {meta['row_count']} rows ingested ({by_ws_str})",
        f"- images: legacy={meta['row_count'] - meta['missing_count']} | "
        f"partial-filled={meta['partial_filled_count']} | missing={meta['missing_count']}",
    ]
    if warnings.get("slug_collisions"):
        lines.append(f"- slug collisions: {len(warnings['slug_collisions'])} (see product-images-summary.json)")
    if warnings.get("sku_collisions"):
        lines.append(f"- sku collisions: {len(warnings['sku_collisions'])} (see product-images-summary.json)")
    if mirror_count is not None:
        lines.append(f"- mirrored image_url to {mirror_count} records in products.json")

    msg = "\n".join(lines)
    subprocess.run(["git", "commit", "-m", msg], check=True, cwd=REPO_ROOT)
    print("Committed outputs.")
    return True
```

Update `main`:

```python
def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.master.exists():
        print(f"ERROR: masterfile not found: {args.master}", file=sys.stderr)
        return 1
    records, meta, warnings = build_records(args.master)
    output_data = {"_meta": meta, "records": records}
    summary_data = {**meta, "warnings": warnings}

    if warnings["sku_collisions"]:
        print(f"WARNING: {len(warnings['sku_collisions'])} SKU collisions (see summary)", file=sys.stderr)
    if warnings["slug_collisions"]:
        print(f"WARNING: {len(warnings['slug_collisions'])} slug collisions (see summary)", file=sys.stderr)
    if meta["unknown_prefixes"]:
        print(f"WARNING: unknown SKU prefixes: {meta['unknown_prefixes']}", file=sys.stderr)

    if args.dry_run:
        print(f"[dry-run] would write {len(records)} records to {args.output}")
        print(f"[dry-run] would write summary to {args.summary}")
        if not args.no_mirror:
            print(f"[dry-run] would mirror image_url into {args.mirror_to_products}")
        if not args.no_commit:
            print("[dry-run] would auto-commit outputs")
        return 0

    atomic_write_json(args.output, output_data)
    atomic_write_json(args.summary, summary_data)
    print(f"Wrote {len(records)} records to {args.output}")
    print(f"Wrote summary to {args.summary}")

    mirror_count: int | None = None
    if not args.no_mirror:
        mirror_count = mirror_image_url_to_products(args.mirror_to_products, records)
        print(f"Mirrored image_url to {mirror_count} records in {args.mirror_to_products}")

    if not args.no_commit:
        files = [args.output, args.summary]
        if not args.no_mirror:
            files.append(args.mirror_to_products)
        auto_commit(files, meta, warnings, mirror_count)

    return 0
```

- [ ] **Step 4: Run the full test suite**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/ -v`
Expected: every test passes. All tests in the suite use `--no-commit`, so the git commands are never invoked from tests.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/build_product_images.py tests/test_build_product_images.py
git commit -m "feat(build_product_images): auto-commit outputs with structured message"
```

---

## Task 11: Driver — human-readable stdout summary + `--dry-run` polish

**Files:**
- Modify: `data/build_product_images.py`
- Modify: `tests/test_build_product_images.py`

- [ ] **Step 1: Write failing test for the human summary line**

Append to `tests/test_build_product_images.py`:

```python
class TestStdoutSummary:
    def test_stdout_has_by_website_line(self, tmp_path):
        output = tmp_path / "product-images.json"
        summary = tmp_path / "product-images-summary.json"
        result = subprocess.run(
            [sys.executable, str(DRIVER),
             "--master", str(FIXTURE_CSV),
             "--output", str(output),
             "--summary", str(summary),
             "--no-mirror", "--no-commit"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        # The 'by website' breakdown should appear in stdout
        assert "wine-now" in result.stdout.lower() or "liq9" in result.stdout.lower()

    def test_dry_run_writes_nothing(self, tmp_path):
        output = tmp_path / "product-images.json"
        summary = tmp_path / "product-images-summary.json"
        subprocess.run(
            [sys.executable, str(DRIVER),
             "--master", str(FIXTURE_CSV),
             "--output", str(output),
             "--summary", str(summary),
             "--no-mirror", "--no-commit", "--dry-run"],
            check=True, cwd=REPO_ROOT,
        )
        assert not output.exists()
        assert not summary.exists()
```

- [ ] **Step 2: Run and confirm the first fails, second passes**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/test_build_product_images.py::TestStdoutSummary -v`
Expected: one pass (dry-run), one fail (no 'by website' stdout line yet).

- [ ] **Step 3: Add the stdout summary block**

In `data/build_product_images.py` `main`, before the final `return 0`, add:

```python
    # Human-readable summary at the end
    print("")
    print("───── Summary ─────")
    print(f"Read {meta['row_count']} records from {args.master.name}")
    by_ws = meta["by_website"]
    print("  " + " | ".join(f"{k}: {v}" for k, v in by_ws.items()))
    print(
        f"Images: legacy={meta['row_count'] - meta['missing_count']} | "
        f"partial-filled={meta['partial_filled_count']} | missing={meta['missing_count']}"
    )
    if warnings["slug_collisions"]:
        print(f"Slug collisions: {len(warnings['slug_collisions'])} (see product-images-summary.json)")
    if warnings["sku_collisions"]:
        print(f"SKU collisions: {len(warnings['sku_collisions'])} (see product-images-summary.json)")
    if meta["unknown_prefixes"]:
        print(f"Unknown SKU prefixes: {meta['unknown_prefixes']}")
```

- [ ] **Step 4: Run the full test suite**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/ -v`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
git add data/build_product_images.py tests/test_build_product_images.py
git commit -m "feat(build_product_images): human-readable stdout summary + dry-run polish"
```

---

## Task 12: Manual run against real masterfile + smoke check

**Files:** none modified; this is a real-world verification + first real commit of the outputs.

- [ ] **Step 1: Dry-run first**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python3 data/build_product_images.py --dry-run`
Expected:
- No file writes.
- Prints "would write ~11,840 records to data/db/product-images.json".
- Prints `by_website` line with wine-now / liq9 / none counts.
- Prints `unknown SKU prefixes: [...]` if any unexpected prefixes exist.
- Returns exit code 0.

- [ ] **Step 2: If unknown prefixes appear, investigate**

If the dry-run flags unknown SKU prefixes, **stop** and check each one against the spec's Section 3 table. Add legitimate prefixes to `WINE_NOW_PREFIXES`, `LIQ9_PREFIXES`, or `NO_SUFFIX_PREFIXES` in `data/lib/product_naming.py`, add a unit test, and commit before proceeding.

- [ ] **Step 3: Full run (will auto-commit)**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python3 data/build_product_images.py`
Expected:
- `data/db/product-images.json` created (~8–15 MB JSON).
- `data/db/product-images-summary.json` created (under 50 KB).
- `data/db/products.json` updated (only `image_url` fields).
- Git commit created with the structured message shown in the spec.

- [ ] **Step 4: Smoke-check 6 spot records**

Run a quick Python inspection:

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/python3 -c "
import json
data = json.load(open('data/db/product-images.json'))
for sku in ['WDW0001AA', 'LWH0001AA', 'CIG0149BT', 'NNA0008AA', 'AWN0001AD', 'DELIVERY1']:
    rec = data['records'].get(sku)
    if not rec:
        print(f'{sku}: MISSING from output')
        continue
    print(f'{sku}: website={rec[\"website\"]} | seo={rec[\"name_seo\"][:60]!r} | status={rec[\"image_status\"]}')
"
```

Expected (roughly):
```
WDW0001AA: website=wine-now | seo='Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now' | status=legacy
LWH0001AA: website=liq9     | seo='Glenfiddich 12 Years Old 700ml | Liq9' | status=legacy
CIG0149BT: website=liq9     | seo='Jose L. Piedra Mini ...' | status=legacy
NNA0008AA: website=liq9     | seo='Monin Strawberry ...' | status=legacy
AWN0001AD: website=wine-now | seo='19 Crimes Personalized Label ... | Wine-Now' | status=legacy
DELIVERY1: website=None     | seo='... DELIVERY ...' | status=missing
```

If any record has the **wrong website** (e.g. a spirit flagged as wine-now), adjust the constants, re-run, and commit the fix. Spot-check 2–3 real Magento URLs in a browser to confirm they still load.

- [ ] **Step 5: Verify git log**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git log -1 --stat`
Expected: the commit touches exactly three files: `data/db/product-images.json`, `data/db/product-images-summary.json`, `data/db/products.json`. Commit message follows the template from Section 9 of the spec.

- [ ] **Step 6: No additional commit needed.** Task 12 has no code changes; the auto-commit in Step 3 is the record.

---

## Task 13: Final test sweep

- [ ] **Step 1: Run full suite**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/pytest tests/ -v`
Expected: every test in `tests/test_product_naming.py` and `tests/test_build_product_images.py` passes. Total ≥ 40 tests.

- [ ] **Step 2: Run the driver once more with `--dry-run`**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && .venv/bin/python3 data/build_product_images.py --dry-run`
Expected: same summary as Task 12 Step 1; no new file writes.

- [ ] **Step 3: Confirm clean git state**

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && git status`
Expected: clean working tree (all source + output changes already committed).

- [ ] **Step 4:** No commit needed; task is a verification sweep.

---

## Notes for the executing engineer

1. **Stay on `main`** — the user auto-commits features directly to main (existing history shows this pattern). No feature branch needed.
2. **Use `.venv/bin/python3` and `.venv/bin/pytest`** — the system Python may lack pytest.
3. **Never use `git add -A`** — the auto-commit feature deliberately uses `git add --` with explicit paths. The existing working tree already has dozens of unstaged files; blanket adds would commit unrelated work.
4. **TDD discipline** — write the failing test, run it to confirm failure, then minimal code, then confirm pass, then commit. Don't skip the "confirm it fails" step.
5. **If an unknown SKU prefix is flagged** in Task 12 Step 1, loop back to Task 2 Step 3 to extend the constants + add a test before the real run.
6. **No external deps** — everything is standard library. If a task tempts you to add a dependency (e.g., `python-slugify`), stop and use the plain `unicodedata` + `re` approach in Task 4.
