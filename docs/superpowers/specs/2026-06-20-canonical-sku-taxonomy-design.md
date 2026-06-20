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
drift (the exact problem being fixed).

**⚠️ This is a BREAKING migration, not a transparent re-export.** The existing
`apps/catalog/lib/category-groups.ts` defines only **6** groups
(`CATEGORY_GROUPS` = Wine, Whisky, Spirits, Sake & Asian, Beer & RTD,
Accessories). This spec introduces **4 new top-level groups** — Cigars, Events,
Non-Alcoholic, Liqueur — so the `CategoryGroup` union type changes, and
**~797 products change group** vs. the current code:

| Prefix | n | Current TS group | New (this spec) |
|---|---|---|---|
| LLQ | 378 | Spirits | Liqueur |
| LOT | 127 | Spirits | Sake & Asian |
| NNA | 138 | Beer & RTD | Non-Alcoholic |
| CIG | 102 | Accessories | Cigars |
| LWF | 18 | Spirits | Whisky |
| MNA | 10 | (unmapped) | Non-Alcoholic |
| WEV | 10 | Accessories | Events |
| LKS | 6 | Spirits | Sake & Asian |
| LRD | 5 | Spirits | Beer & RTD |
| WNA | 3 | Wine | Non-Alcoholic |

So `category-groups.ts` cannot be a drop-in re-export. The implementation plan
MUST treat this as a typed breaking change and migrate every consumer of the
old `CategoryGroup` union (nav, filters, footer, facets, finder category-map)
to the 10-group model — see §4.1 for the full consumer inventory and dispositions.
The accessory drill-down (recently pinned in `category-groups.ts`
`ACCESSORY_SUBCATEGORY`) must also be reconciled: it currently lists
`LOT → "Bar Tools & Gifts"`, which is **wrong** (LOT is Umeshu — verified, see §3).

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
    "A": "Accessories", "C": "Cigars"
  }
  // NOTE: no "N"/"M" fallback — those letters are backed by a single prefix each
  // (NNA, MNA), so an UNKNOWN N**/M** resolves to "Unknown" + audit rather than a
  // confident Non-Alcoholic guess. The known NNA/MNA have explicit 3-char entries.
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
| **Spirits** | 1,177 | LGN Gin · LVK Vodka · LTQ Tequila · LRM Rum · LBD Brandy · LGP Grappa · LCC Cachaça · LAB Absinthe · LWS/LSN White Spirits · LWL Baijiu · LAQ Aquavit · LBS Spirit Set |
| **Accessories** | 893 | ABA Bar Tools & Gifts · GWN/GLQ/GDC/GBE/GWA Glassware · AWC Wine Coolers/Fridges |
| **Whisky** | 847 | LWH · LWF |
| **Sake & Asian** | 663 | LSK Sake/Shochu · LSJ Shochu · LOT Umeshu · LKS Makgeolli |
| **Liqueur** | 378 | LLQ Liqueur |
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
- **LLQ Liqueur (378)** → its own top-level **Liqueur** group (user decision:
  Baileys/limoncello etc. are distinct from base spirits). This is the 10th group
  and is a divergence from the existing TS code, which places Liqueur under Spirits.

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

## 4.1 `classification` consumer inventory & dispositions

`classification` is read widely (grep: ~400+ TS hits across the catalog, ~100+
Python hits — many are types/comments, but the logic consumers below are the
ones that matter). Each must get an explicit disposition in the implementation
plan. **MIGRATE** = switch to `category_group`/`category_type`; **VERIFY** =
inspect, likely migrate; **LEAVE** = may keep reading advisory `classification`.

| Consumer | Disposition | Why |
|---|---|---|
| `apps/catalog/lib/category-groups.ts` | **MIGRATE** (source) | Becomes the canonical TS loader; the 6→10 group breaking change lives here |
| catalog `page.tsx` / `Filters.tsx` / `Footer.tsx` / `shop-query.ts` / facets | **MIGRATE** | Top-nav + Type filter must read `category_group`/`category_type` |
| `apps/catalog/lib/finder/category-map.ts` + finder scoring/split keys | **MIGRATE** | Finder category gating must use SKU-derived group, not classification |
| `apps/catalog/lib/recommender.ts` | **VERIFY** | "same classification +1" rule — switch to `category_type` for correct same-type scoring |
| `lib/curation/hard_filter.py` | **MIGRATE** (correctness-critical) | Hard category filters on classification would wrongly include/exclude the 1,509 mislabeled rows |
| `lib/curation/pairing_resolver.py` / `affinity_resolver.py` / `rationale_writer.py` | **VERIFY** | Category-dependent pairing/rationale — migrate where category drives logic |
| `scripts/derive_spirit_style.py` | **MIGRATE** | Already SKU-routed; formalize on the shared loader |
| `data/enrich_wines.py` + enrichment scripts | **VERIFY** | Wine-gating should use `category_group == "Wine"` not classification |
| internal API routes (`app/api/products/**`) | **VERIFY** | Surface `category_group`/`category_type`; keep classification as advisory passthrough |
| anything displaying classification as a label only | **LEAVE** | Advisory display is fine; just never branch on it |

The plan must walk this list file-by-file; no consumer is "done" until it either
migrated or is confirmed display-only.

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
  in a sane group (`L`→Spirits) and appears in the audit report for explicit
  mapping. Never silent, never a crash. **Letter-fallback only covers letters
  with an established family** — `W`→Wine, `L`→Spirits, `G`/`A`/`C`→Accessories/
  Cigars. For `N`/`M` (each backed by a single prefix today), an unknown
  `N**`/`M**` resolves to **`Unknown` + audit**, NOT a confident Non-Alcoholic
  guess (Rule 3 — don't let a one-row fallback silently misfile future SKUs).
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
  no row's effective category is "Wine product"; group counts **match §3 exactly**
  (SKU resolution is deterministic — assert equality, not tolerance, so an
  omitted prefix entry that shifts a group's count is caught).
- **Completeness obligation (asserted in tests):** the JSON MUST contain an
  explicit 3-char entry for every prefix whose group ≠ its first-letter fallback
  group (the 11 divergent prefixes: LBE, LKS, LLQ, LOT, LRD, LSJ, LSK, LWF, LWH,
  WEV, WNA). A test asserts each resolves to its §3 group — guarding the
  silent-misroute failure mode (e.g. a missing `LWF` entry would drop malts into
  Spirits via "L", or a missing `LLQ` entry would drop liqueurs into Spirits).
- **Browser verification (Rule 7 — catalog is a UI change):** after the catalog
  swaps `classification` → `category_group`, start the dev server and confirm the
  shop nav renders all 10 groups, the Type filter populates from `category_type`,
  and a previously-"Wine product" item (e.g. a whisky, a bar tool) now appears in
  its correct group. "It compiles" is not done.

---

## 6. Open Items / Follow-ups (separate specs)
- ~~Liqueur placement~~ — RESOLVED: LLQ is its own top-level group (10th).
- **`appellation ⊆ region/subregion`** — field is empty in the export; model +
  populate as its own project.
- **Magento `classification` cleanup** — optionally feed the mismatch report back
  to correct the source field.
- **Storefront nav layout** for 10 groups (prominence of small groups) — catalog
  UI concern, decided in the catalog work, not here.
- **Other premium/professional-experience adjustments** — to be brainstormed.
