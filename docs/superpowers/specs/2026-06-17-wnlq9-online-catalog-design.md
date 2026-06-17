# WNLQ9 Online Catalog — Phase 1 Design Spec

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan
**Target:** Customer-facing storefront live for the team within 2 days
**Brand:** WNLQ9 (typographic wordmark, big & bold — used as the logo)

---

## 1. Goal & Scope

Build a new, **customer-facing online catalog** ("WNLQ9") that presents all ~11,436
products with their descriptions, attributes, matrices, and visualisations, plus a
"recommended together" section. The catalog is **separate from the existing internal
PIM/curation tool**.

### Phase 1 (this 2-day build) — IN SCOPE
- Browse catalog (Maison-style clean grid)
- Product detail pages
- Category-first navigation with simple filters + "More filters" expander + sort
- Rule-based "Recommended together" rail (hybrid-ready for BI later)
- Global + per-product contact buttons → **LINE, Facebook (Messenger), WhatsApp**
- Map-based "Explore by Map" discovery tool, ported from the existing app as a
  secondary menu item
- Server-side data loading + pagination (never ship the 27 MB file to the browser)

### Phase 2 (LATER) — OUT OF SCOPE
- Add-to-cart → build a list → order summary emailed to customer + order inbox
- Real BI / online co-purchase recommendation data
- Online payment, login/accounts

### YAGNI — explicitly excluded from Phase 1
Cart, order email, payment, auth, real BI co-purchase data. The recommender and data
layer are structured so these slot in cleanly later, but none are built now.

---

## 2. Accessibility Drivers (non-negotiable)

Primary audience includes users aged 40+ with eyesight challenges. Every design
decision serves **easy to read, easy to navigate**:

- Base font **18px** (not 14–16px)
- High contrast: near-black text on white background
- Generous line-height and whitespace (Maison aesthetic)
- Large tap/click targets (≥44px)
- Clear, visible focus outlines for keyboard nav
- Calm neutral palette + a single accent color for buttons/links
- Big, obvious category tabs and filters; advanced facets hidden behind one toggle
- **No** WebGL/map as the primary browse path (map is a secondary, opt-in menu item)

**Visual anchor:** Maison / Shopify theme (Dribbble shot 26843313) — clean, minimal,
airy, large product imagery, simple typographic navigation.

---

## 3. Architecture & Project Setup

A **new standalone Next.js 14 app** at `apps/catalog/` in this repo, fully separate
from the internal tool.

```
ENGINE_PRODUCT/
├── app/, components/, lib/          ← existing INTERNAL tool (UNTOUCHED)
├── data/live_products_export.json   ← shared source of truth (read-only to catalog)
└── apps/catalog/                    ← NEW public storefront
    ├── app/
    │   ├── page.tsx                 (/  — home)
    │   ├── shop/page.tsx            (/shop — core grid)
    │   ├── product/[sku]/page.tsx   (/product/[sku] — detail)
    │   ├── explore-map/page.tsx     (/explore-map — ported map tool)
    │   ├── about/page.tsx
    │   └── contact/page.tsx
    ├── components/                  (storefront UI, fresh Maison style)
    ├── lib/
    │   ├── catalog-data.ts          (server-side loader + indexes)
    │   ├── recommender.ts           (hybrid, pluggable)
    │   └── contact.ts               (deep-link builder)
    ├── package.json
    ├── tailwind.config.ts
    └── (own Vercel deploy)
```

### Bootstrapped (copied) from the existing app — already works against real data
- Tailwind setup + `ProductImage` component (handles the `image_url` field)
- The data-loading pattern from `app/api/products/route.ts`
- The map-based `explore` UI (ported as `/explore-map`)

### Built fresh (Maison style)
Home, shop grid, product detail, filters, recommendations rail, contact buttons.

**Rationale (Rule 11 — build on skeletons):** reuse the proven Next.js + Tailwind +
data infra; build the storefront UI fresh because the existing `explore` UI is a
map-first internal tool, the opposite of the calm Maison grid the audience needs.

---

## 4. Data Flow

- Catalog reads `data/live_products_export.json` **server-side only**.
- At build/startup, load the 27 MB file **once**, parse into a module-level singleton,
  and build in-memory indexes: by SKU, by category/classification, by region.
- Serve **paginated slices** to the browser (e.g. 24/page). The full file is never
  shipped to the client.
- **Update workflow (team-owned):** team edits `products.db` in the internal tool →
  runs existing `scripts/refresh_live_export.py` → redeploy (or scheduled re-pull)
  picks up new prices/stock. **One source of truth** (Rule 9 respected — the export
  is the real source the UI reads).

### Data reality (from inspection of the export, 11,436 products, 49 fields)
| Field | Populated | Note |
|---|---|---|
| `price` | 11,436 / 11,436 | always present |
| `image_url` | 11,326 / 11,436 | placeholder for the rest |
| `is_in_stock` | 11,338 / 11,436 | show OOS clearly, contact still active |
| `desc_en_short` | 5,786 / 11,436 | hide block if missing |
| `full_description` | 6,912 / 11,436 | hide block if missing |
| `flavor_tags` | 5,786 / 11,436 | hide if missing |
| `food_matching` | 5,783 / 11,436 | feeds recommender |
| `score_summary` | 1,550 / 11,436 | critic badge only when present |
| `margin_pct` / `b2b_margin_pct` | 4,234 | INTERNAL — **never render publicly** |
| `popularity_score`, `popularity_orders_90d` | **0 / 11,436** | BI not ready → rule-based recs at launch |

**Critical:** margin/B2B fields must NEVER be exposed in the public catalog.

---

## 5. Pages & Layout

### Global frame
- **Header:** `WNLQ9` wordmark (big, bold, left) · nav (Shop · Explore by Map ·
  About · Contact) · search icon · sticky on scroll.
- **Footer:** `WNLQ9` · contact links (LINE/FB/WhatsApp) · About · category links.
- **Sticky mobile contact button:** floating "Contact us" → LINE/FB/WhatsApp.

### 1. Home (`/`)
Large hero (featured product or category) → featured/popular products section →
"Shop by Category" block → footer band. Calm, lots of whitespace.

### 2. Shop (`/shop`) — core
- Category tabs across the top (Wine · Spirits · …)
- Small row of big filters: **Price · Country · Type · In-stock** + **Sort** dropdown
- **"More filters"** expander → advanced facets (region, grape, body, acidity,
  tannin, flavor tags, food matching, critic score)
- 3-across responsive product grid (large image, name, price) → 2-across → 1-across
- Clear pagination

### 3. Product detail (`/product/[sku]`)
Large image left; right column: name, price, key attributes (country/region/grape/
vintage/body/acidity/tannin), description, food pairing, critic-score badge (only the
1,550 with `score_summary`), stock status. Per-product **Inquire on LINE / WhatsApp /
Facebook** buttons pre-filling `"I'm interested in [Name] — [SKU]."` Below:
**Recommended together** rail.

### 4. Explore by Map (`/explore-map`)
Existing map discovery tool, ported as-is, reached from the menu (secondary path).

### 5. About / Contact
Simple static pages with the contact buttons.

---

## 6. Recommendation Engine (hybrid)

`lib/recommender.ts` — single public function:

```
getRecommendations(product, allProducts) -> ~4 products
```

- **Launch (rule-based):** score every other product against the current one using
  existing data — same region/grape (strong), overlapping `food_matching`,
  complementary type, similar price tier. Return top 4, **in-stock, de-duplicated**.
  Framed as **"You might also like"** (attribute-based) — NOT implying real purchase
  data. Respects the rule against faking populated BI fields.
- **Later (BI swap):** add a `coPurchaseStrategy` read first inside the same function,
  falling back to rules when co-purchase data is absent. **No UI change** — identical
  rail. Config swap, not rewrite.
- **Isolated & unit-testable:** given product + dataset, returns sensible, in-stock,
  non-duplicate recs.

---

## 7. Contact Mechanics

`lib/contact.ts` builds three deep links from **env-configured** handles
(`apps/catalog/.env`, not hard-coded — team can change without a code edit):

- **LINE:** `https://line.me/R/...` (official account)
- **WhatsApp:** `https://wa.me/<number>?text=<prefilled>`
- **Facebook:** `https://m.me/<page>` (Messenger)

- **Per-product** buttons pre-fill `"I'm interested in [Name] — [SKU]"`.
- **Global** buttons (header/footer/sticky) open a general inquiry.
- All open in a new tab.

---

## 8. Performance

- Parse the 27 MB export **once** server-side; cache array + indexes in a module-level
  singleton. Never sent whole to the browser.
- Shop grid server-rendered and paginated (24/page); client receives only the current
  slice + thumbnails.
- Images via existing `ProductImage` with lazy-loading + width limits.
- Build memory: reuse `NODE_OPTIONS=--max-old-space-size=4096`.

---

## 9. Error Handling

- Defensive rendering: any missing/null field hides its block rather than crashing.
  No description → hide; no image → placeholder; no critic score → no badge.
  **A product never fails to render because a field is null.**
- Unknown SKU on `/product/[sku]` → clean 404 with a link back to Shop.
- Out-of-stock products still display, clearly marked, contact buttons active.

---

## 10. Testing (per project rules)

- **Unit:** recommender (4 valid, in-stock, non-duplicate recs); contact-link builder
  (correct pre-filled deep links).
- **Data invariant (Rule 6 pattern):** catalog loader exposes every in-stock product
  from the export; price/image render for products that have them; **margin/B2B fields
  never appear in any public response.**
- **Browser verification (Rule 7 — mandatory before "done"):** start dev server, click
  the real journey — home → shop → filter/sort → "More filters" → product detail →
  each contact button (verify pre-filled LINE/WhatsApp/FB message) → map page.
  "It compiles" is not done; a working UI is the only proof.

---

## 11. Open Items for Phase 2
- Cart → list → order-summary email (customer + order inbox)
- Real BI / online co-purchase data populating `popularity_orders_90d`
- Online payment, accounts
