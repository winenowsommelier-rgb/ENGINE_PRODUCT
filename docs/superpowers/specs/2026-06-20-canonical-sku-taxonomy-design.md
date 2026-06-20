# Canonical SKU Taxonomy — Design Spec

**Date:** 2026-06-20
**Status:** Approved (design), pending implementation plan
**Author:** brainstorming session with the user (data/ecommerce/sommelier lens)

---

## 1. Goal & Core Principle

Every process in this project (catalog, finder, enrichment pipelines, internal
API, curation engine) decides "what is this product?" today by reading the
`classification` field — which is **unreliable**: ~1,509 rows are dumped into a
junk label `"Wine product"` (only ~84 are real wine), and that label is smeared
across every product family (214 whiskies, 102 gins, 434 bar-accessories, etc.,
all mislabeled "Wine product"). Category logic is also **duplicated** in several
places (`apps/catalog/lib/category-groups.ts`, `scripts/derive_spirit_style.py`,
finder split keys, internal API routes) with no single source of truth, so the
copies drift.

**The principle, enforced everywhere:**

> **SKU prefix is the source of truth for what a product is. `classification` is
> advisory and is NEVER trusted by category logic.**

This is verified against the live data: `sku` is present for all 11,436 rows,
unique, URL-safe, and its leading-letter prefix reliably encodes the product
family (the import wrote correct SKUs even when it mislabeled `classification`).

### In scope (this spec)
- One canonical prefix→`{group, type}` map + fallback rules.
- Thin Python and TypeScript loaders that both read that one map.
- Two new export fields (`category_group`, `category_type`) written by the
  refresh pipeline and a one-time backfill.
- A mismatch-audit report (advisory cleanup list for the data team).
- Swapping catalog/finder reads from `classification` → `category_group`.

### Out of scope (explicit follow-ups, NOT this spec)
- `appellation ⊆ region/subregion` modeling — **`appellation` is 0/11,436 in the
  export** (empty), so this is a separate data-modeling project, not part of
  making SKU authoritative.
- Rewriting/correcting the Magento `classification` source field.
- The broader "premium/professional experience" adjustments — separate brainstorms.
- Multi-bottle "Set" handling (WBS/LBS) beyond category assignment.

### YAGNI
No config system, no per-tenant taxonomy, no UI for editing the map (it is a
small versioned JSON edited by hand + PR). No correction of the source
`classification` field. No new enrichment spend — this is pure rule-based
re-categorization.

---

## 2. Architecture

A **single canonical artifact** plus **two thin loaders** (one per language),
with zero category logic duplicated.

```
data/taxonomy/sku_prefix_map.json          ← SINGLE SOURCE OF TRUTH (41 prefixes)
        │
        ├── data/lib/taxonomy/sku_taxonomy.py     (Python loader)
        │       used by: refresh_live_export.py, enrichment scripts,
        │                derive_spirit_style.py, backfill_*, curation engine
        │
        └── apps/catalog/lib/sku-taxonomy.ts      (TS loader, reads same JSON at build)
                used by: catalog shop/nav/filters, product-finder
                apps/catalog/lib/category-groups.ts → thin re-export of sku-taxonomy.ts
```

**Why this shape:** add a prefix once, every process updates. No fourth copy to
drift (the exact problem being fixed). The existing `category-groups.ts` becomes
a re-export so current catalog/finder imports keep working unchanged.

### Map file shape

```json
{
  "version": 1,
  "prefixes": {
    "WRW": { "group": "Wine",          "type": "Red Wine" },
    "LGN": { "group": "Spirits",       "type": "Gin" },
    "LGP": { "group": "Spirits",       "type": "Grappa" },
    "LOT": { "group": "Sake & Asian",  "type": "Umeshu" },
    "WEV": { "group": "Events",        "type": "Event" },
    "CIG": { "group": "Cigars",        "type": "Cigar" }
  },
  "letter_fallback": {
    "W": "Wine", "L": "Spirits", "G": "Accessories",
    "A": "Accessories", "C": "Cigars", "N": "Non-Alcoholic", "M": "Non-Alcoholic"
  }
}
```

### Resolution rule (both loaders, identical)
1. Uppercase the SKU.
2. Match the **3-character prefix** against `prefixes` (longest-prefix-first —
   `WEV` → Events must beat the `W` → Wine letter-fallback).
3. If no 3-char match, use `letter_fallback` on the first character **and `log()`
   the unmapped 3-char prefix** (never silent — feeds the audit report).
4. A product with no/blank SKU → group `"Unknown"`, logged.

### Loader API (parity across languages)
- `group_for(sku) -> str`
- `type_for(sku) -> str`
- `resolve(product) -> {group, type}`  (reads `product.sku`)
- `unmapped_prefixes(products) -> list[str]`  (for the audit)

---

## 3. The Validated Category Model (all 41 prefixes → 10 groups)

Counts are live (sum = 11,436).

| Group | n | Prefixes → type |
|---|---|---|
| **Wine** | 6,983 | WRW Red · WWW White · WSP Sparkling/Champagne · WRS Rosé · WDW Dessert/Port · WOW Orange · WBS Wine Set |
| **Spirits** | 1,555 | LGN Gin · LVK Vodka · LTQ Tequila · LRM Rum · LBD Brandy · LGP Grappa · LCC Cachaça · LAB Absinthe · LWS/LSN White Spirits · LWL Baijiu · LAQ Aquavit · LBS Spirit Set · **LLQ Liqueur** |
| **Accessories** | 893 | ABA Bar Tools & Gifts · GWN/GLQ/GDC/GBE/GWA Glassware · AWC Wine Coolers/Fridges |
| **Whisky** | 847 | LWH · LWF |
| **Sake & Asian** | 663 | LSK Sake/Shochu · LSJ Shochu · LOT Umeshu · LKS Makgeolli |
| **Beer & RTD** | 232 | LBE Beer · LRD Ready-to-Drink |
| **Non-Alcoholic** | 151 | NNA Mixer/Soft · MNA Tonic/Mineral Water · WNA De-alcoholised Wine |
| **Cigars** | 102 | CIG |
| **Events** | 10 | WEV |

**Decisions captured during brainstorming:**
- **Cigars** and **Events** are their own top-level groups (not under Accessories).
- **WNA** (de-alcoholised wine) → **Non-Alcoholic** (not Wine).
- **Baijiu (LWL)** → Spirits; **Makgeolli (LKS)** → Sake & Asian (split by alcohol type).
- **LGP Grappa**, **LCC Cachaça**, **LAB Absinthe** stay in Spirits but carry a
  specific `type`; `spirit_style` (P3) augments `type`, not replaces it.
- **LLQ Liqueur (378)** → Spirits group, `type=Liqueur`. *(Open item for user
  review: confirm Liqueur belongs under Spirits vs. its own group.)*

**Two-level model:** `group` drives top-nav; `type` drives the "Type" filter,
finder facets, and pairs with `spirit_style`. Both come from the one map.

**Catalog presentation note (separate concern):** the data model has all 10
groups; the storefront nav decides prominence — small groups (Events 10, Cigars
102) may live in a "More"/footer menu rather than a prime tab, per the catalog's
accessibility driver. The taxonomy does not dictate nav layout.

### "Wine product" fix (falls out for free)
Because category logic stops reading `classification`, every "Wine product" row
resolves to its real group/type via SKU. A Dometic shelf (`ABA`) → Accessories;
Johnnie Walker (`LWH`) → Whisky. The `classification` field is left untouched as
an advisory audit trail.

---

## 4. Data Flow & Error Handling

### Write path
- `refresh_live_export.py` calls `resolve(product)` per row and writes
  `category_group` + `category_type` into `live_products_export.json` (alongside
  the untouched advisory `classification`).
- A one-time backfill writes these fields onto the **current** export so the fix
  is live before the next DB refresh (Rule 9 — the export is what the UI reads).
- Catalog/finder read `category_group` / `category_type`, never `classification`.

### Error handling
- **Unknown 3-char prefix** → letter-fallback **+ logged**. A future `LXX` lands
  in a sane group and appears in the audit report for explicit mapping. Never
  silent, never a crash.
- **Blank/missing SKU** → group `"Unknown"`, logged. (Currently 0 such rows;
  guard anyway.)
- **Mismatch audit** — `scripts/taxonomy_audit.py` (no spend): lists every
  product whose SKU-derived type disagrees with its `classification` (the ~1,509
  "Wine product" rows + any others). This is a cleanup list for the data team;
  code never trusts classification regardless.

### Verification (Rule 1 — verify, don't infer)
After backfill, a count query confirms:
- 0 products have an *effective* category of "Wine product".
- Every product has a non-empty `category_group`.
- Per-group counts match §3 (Wine ≈ 6,983, etc.).
- 0 unmapped 3-char prefixes remain (the audit log is empty for prefixes).

---

## 5. Testing

- **Unit — Python + TS, shared fixtures:** all 41 prefixes resolve to their §3
  `{group, type}`; longest-prefix-first (`WEV`→Events beats `W`→Wine);
  unknown prefix → fallback + logged; blank SKU → Unknown.
- **Parity test:** Python and TS loaders return identical `resolve()` results for
  the same SKU set (guards against the two-copies-drift being eliminated). A
  shared fixture file of `[sku → expected {group,type}]` drives both suites.
- **Data invariant (Rule 6):** every export row has a non-empty `category_group`;
  no row's effective category is "Wine product"; group counts within tolerance
  of §3.
- **Browser verification (Rule 7 — catalog is a UI change):** after the catalog
  swaps `classification` → `category_group`, start the dev server and confirm the
  shop nav renders all 10 groups, the Type filter populates from `category_type`,
  and a previously-"Wine product" item (e.g. a whisky, a bar tool) now appears in
  its correct group. "It compiles" is not done.

---

## 6. Open Items / Follow-ups (separate specs)
- **Liqueur placement** — confirm LLQ under Spirits vs. its own group (user review).
- **`appellation ⊆ region/subregion`** — field is empty in the export; model +
  populate as its own project.
- **Magento `classification` cleanup** — optionally feed the mismatch report back
  to correct the source field.
- **Storefront nav layout** for 10 groups (prominence of small groups) — catalog
  UI concern, decided in the catalog work, not here.
- **Other premium/professional-experience adjustments** — to be brainstormed.
