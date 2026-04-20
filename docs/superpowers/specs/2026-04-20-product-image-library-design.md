# Product Image Library — Design Spec

**Date:** 2026-04-20
**Status:** Approved, pending implementation plan
**Owner:** WNLQ9 / Engine Product team
**Source of truth for:** image URL ingestion, SEO-ready name generation, future HD image upgrade schema

---

## 1. Goal

Ingest the Magento-exported masterfile CSV of **11,840 SKUs** into a new structured library (`data/db/product-images.json`) that provides:

1. A **3-slot image schema** (`thumbnail` / `image` / `image_hd`) that is ready to receive future HD image uploads without schema changes.
2. **SEO-ready display titles** per product, including brand + vintage + size + website suffix.
3. **Filename-safe slugs** (with optional SKU-suffixed filename base) so users can drag-and-drop images into local storage with a stable naming convention.
4. **Explicit status tracking** so the 22 SKUs with no image and the 107 partial rows are visible to any downstream dashboard.
5. A minimal one-field mirror into the existing `products.json` for back-compat.

This is the **beginning of the image upgrade program**. The 3-slot spec defines targets; today all slots hold the same legacy Magento URL. Future HD images will replace slots individually as they become available.

## 2. Scope

**In scope:**
- Reading the full 11,840-row masterfile CSV.
- Producing `data/db/product-images.json` keyed by SKU.
- Producing `data/db/product-images-summary.json` for dashboards.
- Mirroring the 800×800 `image` slot URL into `products.json.image_url` for back-compat.
- A reusable `data/lib/product_naming.py` library of pure functions (SEO slugs, website detection, image specs).
- Unit tests for the naming library and an integration test for the driver.
- Auto-commit of the outputs to git with a structured commit message.

**Out of scope (future work):**
- Downloading / hosting / resizing actual image files.
- A UI for the drag-and-drop upload flow (the filename base is prepared; the UI is a separate project).
- Image validation against the target spec (e.g., checking that today's Magento image is actually 800×800).
- Generating a placeholder image for the 22 missing SKUs.

## 3. Source data

**File:** `data/data mastefile WNLQ9/DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv`
**Row count:** 11,840
**Columns:** `sku, is_in_stock, status, brand, name, vintage, bottle_size, thumbnail, image, small_image`

**Observed distribution:**
- **11,711 rows (99.0%):** all three image slots hold the same URL (Magento exports one image per SKU, duplicated into the three display slots).
- **107 rows (0.9%):** partial — one or more of the three slots is blank or carries a variant URL.
- **22 rows (0.2%):** all three slots empty — no image available.
- **All URLs point to `th.wine-now.com/media/catalog/product/...`** regardless of whether the SKU is a wine, spirit, or accessory.

**49 distinct 3-char SKU prefixes** observed. Examples:

| Category | Prefixes | Count | Website |
|---|---|---|---|
| Wine | WRW, WWW, WSP, WRS, WDW, WOW, WEV, WBS, WNA, WTK | ~9,270 | wine-now |
| Wine personalization | AWN | ~1 | wine-now |
| Wine accessories / glassware | ABA, GWN, GLQ, GDC, GBE, GWA, AWC | ~1,117 | wine-now |
| Spirits / liquor | LWH, LSK, LLQ, LGN, LBE, LTQ, LVK, LRM, LBD, LOT, LSJ, LGP, LWF, LAB, LCC, LWS, LSN, LKS, LRD, LBS, LWL, LAQ | ~2,852 | liq9 |
| Cigars | CIG | 102 | liq9 |
| Mixers / non-alc (per user decision) | NNA, MNA | ~148 | liq9 |
| System products (no SEO suffix) | DEL, ECP, GIF, ANG, FYC, NJV | ~18 | none |

Unknown or low-volume prefixes not classified above should be **logged as warnings** and mapped to `website: null`.

## 4. Output schema

### 4.1 `data/db/product-images.json`

Top-level object with two keys: `_meta` (summary) and `records` (SKU → record).

```json
{
  "_meta": {
    "generated_at": "2026-04-20T10:30:00Z",
    "source_file": "DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv",
    "row_count": 11818,
    "missing_count": 22,
    "partial_filled_count": 107,
    "by_website": { "wine-now": 10553, "liq9": 3101, "none": 164 },
    "unknown_prefixes": []
  },
  "records": {
    "WDW0001AA": {
      "sku": "WDW0001AA",
      "website": "wine-now",
      "name_seo": "Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now",
      "name_slug": "batasiolo-moscato-spumante-dolce-nv-750ml",
      "image_filename_base": "batasiolo-moscato-spumante-dolce-nv-750ml-wdw0001aa",
      "brand": "Batasiolo",
      "vintage": "NV",
      "bottle_size": "750ml",
      "images": {
        "thumbnail": {
          "url": "https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa.jpg",
          "spec": { "width": 240, "height": 240, "format": "JPEG", "quality": 85, "max_kb": 20 },
          "source": "magento-legacy"
        },
        "image": {
          "url": "https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa.jpg",
          "spec": { "width": 800, "height": 800, "format": "JPEG", "quality": 85, "max_kb": 120 },
          "source": "magento-legacy"
        },
        "image_hd": {
          "url": "https://th.wine-now.com/media/catalog/product/w/d/wdw0001aa.jpg",
          "spec": { "width": 2000, "height": 2000, "format": "WebP", "quality": 90, "max_kb": 500 },
          "source": "magento-legacy"
        }
      },
      "image_status": "legacy",
      "is_in_stock": true,
      "last_source": "masterfile-2026FEB",
      "updated_at": "2026-04-20T10:30:00Z"
    }
  }
}
```

### 4.2 Field definitions

| Field | Type | Notes |
|---|---|---|
| `sku` | string | Primary key. |
| `website` | `"wine-now"` / `"liq9"` / `null` | Null for system products (shipping, coupons, gift cards). |
| `name_seo` | string | Display title. `Brand Name Vintage Size \| Website`. |
| `name_slug` | string | ASCII lowercase, hyphenated, diacritics stripped. URL path segment. **No SKU.** |
| `image_filename_base` | string | `slug-sku` (lowercase SKU). Filename stem for drag-and-drop saves, no extension. |
| `brand` | string | Trimmed. |
| `vintage` | string \| null | `"Current vintage"` → null; `"NV"` → `"NV"`; years kept as-is; blank → null. |
| `bottle_size` | string \| null | `"750 ml"` → `"750ml"`; `"1.5 L"` → `"1500ml"`; blank → null. |
| `images` | object \| null | Three sub-slots: `thumbnail`, `image`, `image_hd`. Null when no URL is available. |
| `images.<slot>.url` | string | Current URL (legacy Magento for now). |
| `images.<slot>.spec` | object | Target spec for HD upgrade (width, height, format, quality, max_kb). |
| `images.<slot>.source` | string | `"magento-legacy"` today. `"hd-upload"` after user replacement. |
| `image_status` | `"legacy"` / `"hd"` / `"missing"` / `"placeholder"` | Quick status flag for dashboards. |
| `is_in_stock` | bool | Derived from CSV `is_in_stock == "1"`. |
| `last_source` | string | `"masterfile-2026FEB"` for this batch. |
| `updated_at` | ISO-8601 string | Timestamp of the ingest run. |

### 4.3 `data/db/product-images-summary.json`

Dashboard-friendly summary with the `_meta` fields from `product-images.json` plus any warnings (unknown prefixes, slug collisions). Lightweight — under 5 KB. Allows the dashboard to render counters without parsing the full 11,840-record file.

### 4.4 `products.json` mirror

For each SKU that has an `images` object, set `products.json[sku].image_url = images.image.url` (the 800×800 main slot). Every other field in `products.json` is untouched. SKUs present in `products.json` but absent from the masterfile are also untouched.

## 5. Image size + quality standard (target)

| Slot | Width × Height | Format | Quality | Max weight |
|---|---|---|---|---|
| `thumbnail` | 240 × 240 | JPEG | 85 | ≤ 20 KB |
| `image` | 800 × 800 | JPEG | 85 | ≤ 120 KB |
| `image_hd` | 2000 × 2000 | WebP (JPEG fallback) | 90 | ≤ 500 KB |

**All ratios 1:1 (square)** — bottles render cleanly in any layout (grid, cart, PDP). The spec is a **target**; today's Magento URLs populate all three slots with `source: "magento-legacy"` and may not meet the target weight or dimensions. Future HD uploads will replace slots individually and flip `source` to `"hd-upload"`.

## 6. Architecture

### 6.1 New files

```
data/lib/
└── product_naming.py           # pure functions: to_slug, to_seo_title,
                                #   to_image_filename_base, detect_website,
                                #   normalize_vintage, normalize_bottle_size,
                                #   clean_name, pick_best_url, build_image_struct,
                                #   image_spec; constants IMAGE_SPECS +
                                #   WINE_NOW_PREFIXES + LIQ9_PREFIXES +
                                #   NO_SUFFIX_PREFIXES

data/build_product_images.py    # driver / CLI entry point

data/db/product-images.json         # new DB file
data/db/product-images-summary.json # counters for dashboards

tests/test_product_naming.py         # ~20 unit tests
tests/test_build_product_images.py   # integration test on fixture CSV
```

### 6.2 Modified file

- `data/db/products.json` — only `image_url` per matching record is set. No other fields touched.

### 6.3 CLI

```
python3 data/build_product_images.py \
  [--master <path>] \
  [--output <path>] \
  [--mirror-to-products <path> | --no-mirror] \
  [--no-commit] \
  [--dry-run]
```

All flags optional. Defaults:
- `--master` → `data/data mastefile WNLQ9/DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv`
- `--output` → `data/db/product-images.json`
- `--mirror-to-products` → `data/db/products.json` (on by default; disable with `--no-mirror`)
- `--no-commit` → skip git commit (on by default is commit; flag disables)
- `--dry-run` → print summary, skip all writes and commit

### 6.4 Library contract (public)

```python
IMAGE_SPECS: dict[str, dict]
WINE_NOW_PREFIXES: set[str]
LIQ9_PREFIXES: set[str]
NO_SUFFIX_PREFIXES: set[str]

def detect_website(sku: str) -> str | None
def normalize_vintage(raw: str) -> str | None
def normalize_bottle_size(raw: str) -> str | None
def clean_name(raw: str) -> str
def to_seo_title(brand, name, vintage, size, website) -> str
def to_slug(brand, name, vintage, size) -> str
def to_image_filename_base(brand, name, vintage, size, sku) -> str
def image_spec(slot: str) -> dict
def pick_best_url(thumb, image, small) -> str | None
def build_image_struct(best_url: str | None) -> tuple[dict | None, str]
```

All functions are pure (no I/O, no globals mutated). Each has a direct unit test.

### 6.5 Driver flow

1. Parse CLI args.
2. Read masterfile CSV with `csv.DictReader`.
3. For each row: build a record using library functions; collect into `records` dict.
4. Validate: detect unknown prefixes, slug collisions, missing-image count.
5. Compose `_meta` summary.
6. Write `product-images.json` and `product-images-summary.json` atomically (tmp + rename).
7. Mirror `image.url` into `products.json` (atomic, merge-style — only touches `image_url`).
8. Auto-commit: `git add` the three output files + commit with a structured message. Skip if no diff. Skip entirely if `--no-commit`.
9. Print human-readable summary to stdout.

### 6.6 Safety

- **Atomic writes** via `tempfile` + `os.rename` — mid-script failure cannot corrupt JSON.
- **Products.json is merged, not replaced** — only the `image_url` field is updated; all other per-record data stays exact.
- **Git commit is bounded** — only `git add` the specific output files, never `git add -A`.
- **Empty commits are skipped** — idempotent re-runs don't litter git history.

## 7. Edge cases

| Case | Count | Handling |
|---|---|---|
| All 3 URL columns hold same URL | 11,711 | Fill all 3 slots with that URL. `image_status = "legacy"`. |
| Partial (some slots blank or variant) | 107 | `pick_best_url` prefers `image` > `thumbnail` > `small_image`. Fill all 3 slots with the chosen URL. `image_status = "legacy"`. |
| All 3 URL columns empty | 22 | Write record with `images: null`, `image_status = "missing"`. |
| Blank SKU | rare | Skip row. |
| Unknown SKU prefix | 0 expected, but new ones may appear | Log warning. Record is written with `website: null`, `name_seo` without suffix. Operator updates library constants as needed. |
| SKU collision (two rows, same SKU) | unknown | Last row wins. Log warning with both source row numbers. |
| Slug collision (two SKUs, same slug) | ~4 expected | Both records written (SKU is primary key). Logged in summary so operator can dedupe names if desired. |
| Diacritics in brand / name | many | Stripped in slug via `unicodedata.normalize('NFKD', ...)` → ASCII. Preserved in `name_seo` (display) and `brand`. |

## 8. Testing

### 8.1 Unit tests — `tests/test_product_naming.py`

~20 cases covering every library function: happy path, diacritics, empty values, and every website category.

### 8.2 Integration test — `tests/test_build_product_images.py`

Tiny fixture CSV (~5 rows covering: normal / partial / empty / unknown prefix / gift card). Runs the driver via `subprocess.run` with `--output /tmp/...` and `--no-mirror --no-commit`. Asserts the output structure, counters, and warnings.

### 8.3 Smoke test (manual, after first real run)

- Spot-check 5 records from different prefixes (WDW, LWH, CIG, NNA, AWN, DELIVERY1) in `product-images.json`.
- Fetch 2–3 random URLs to confirm the Magento endpoints are still live.

### 8.4 Run order

```
pytest tests/test_product_naming.py -v       # ~1 s
pytest tests/test_build_product_images.py -v # ~3 s
python3 data/build_product_images.py          # ~5-10 s on the real masterfile
```

## 9. Commit message template

```
data: rebuild product image library from 2026FEB masterfile

- 11,840 rows ingested (wine-now: 10,553 | liq9: 3,101 | system: 164)
- images: legacy=11,711 | partial-filled=107 | missing=22
- slug collisions: 4 (see product-images-summary.json)
- mirrored image_url to 10,232 records in products.json
```

(Counts are illustrative — actual numbers come from the run.)

## 10. Future work (tracked, not part of this spec)

1. **HD upload UI** — drag-and-drop interface that uses `image_filename_base` as the suggested filename.
2. **Image validation pass** — fetch each URL, measure actual dimensions + weight, flag records where the current file does not meet the target spec.
3. **Placeholder images** — generate brand-themed placeholder artwork for the 22 missing SKUs.
4. **HD swap workflow** — when a user uploads a replacement image, update the slot's `url` and flip `source` to `"hd-upload"`; preserve the old URL in history for rollback.
5. **Spec evolution** — when the HD upgrade program progresses, revisit target dimensions (e.g., retina displays may push `image_hd` to 3000×3000).

## 11. Open decisions recorded

Every decision below was made by the user during brainstorming on 2026-04-19 — 2026-04-20.

1. **Scope:** ingest the full 11,840-row catalog, not just the 1,834-row enrichment queue.
2. **Image slot semantics:** structural slots for future HD upgrade; today's single URL fills all 3.
3. **Brand / domain mapping:** trust CSV literally; keep `th.wine-now.com` URLs as-is for all SKUs.
4. **SEO name format:** both slug (filename) and title (display) fields.
5. **Image size + quality standard:** Tier A (conservative / fast-loading) — 240 / 800 / 2000 px, JPEG or WebP.
6. **Website suffix in title:** `... | Wine-Now` or `... | Liq9`; slug stays clean (no brand).
7. **Brand-detection rule:** first-letter W/L rule with adjustments (NNA + MNA → Liq9; AWN + WEV + WTK → Wine-Now; system-product prefixes → no suffix).
8. **Destination:** new `data/db/product-images.json`; mirror only `image_url` into `products.json` for back-compat.
9. **Edge cases:** partial → fill best-available; empty → explicit `image_status: "missing"`.
10. **SKU in filename:** yes — separate `image_filename_base` field suffixed with SKU; `name_slug` stays clean for URLs.
11. **Auto-commit:** on by default with structured message; `--no-commit` opt-out available.
