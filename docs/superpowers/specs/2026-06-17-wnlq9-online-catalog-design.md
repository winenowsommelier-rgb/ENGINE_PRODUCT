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

### 4.1 Public projection (the margin-leak chokepoint — REQUIRED)
The 49-field source object is **never** sent to the browser. `lib/catalog-data.ts`
exposes a single `toPublicProduct(raw)` serializer that builds the client payload from
an **explicit allowlist** of safe fields (id, sku, name, brand, classification,
attributes, descriptions, image_url, price, currency, stock, score_summary, etc.) —
by whitelist, NOT by deleting fields from the full object. Every client-bound payload
(grid slice, detail page, recommendations) passes through `toPublicProduct`. Fields
like `margin_pct`, `b2b_margin_pct`, and any internal enrichment/cost field are simply
absent from the allowlist and therefore cannot leak. A unit test asserts the projected
object's keys are a subset of the allowlist (§10).

### 4.2 Routing key (validated against real data)
Verified on the actual export: `sku` is present for all 11,436 rows, **unique**, and
contains **zero URL-unsafe characters**. `/product/[sku]` uses `sku` directly as the
route key; the SKU index is the lookup. No slugging needed.

### 4.3 Field shapes (verified — drive rendering & recommender)
- `food_matching` — **comma-separated string** (e.g. `"Grilled red meat, Lamb dishes,
  Aged hard cheese"`). Split on `,` + trim for overlap scoring and chip display.
- `flavor_tags` — **array of strings**.
- `currency` — `THB` for all rows → display as `฿` with thousands separators.
- `image_url` — external host `th.wine-now.com` (Magento media). See §8.

---

## 5. Pages & Layout

### Global frame
- **Header:** `WNLQ9` wordmark (big, bold, left) · nav (Shop · Explore by Map ·
  About · Contact) · search icon · sticky on scroll.
- **Footer:** `WNLQ9` · contact links (LINE/FB/WhatsApp) · About · category links.
- **Sticky mobile contact button:** floating "Contact us" → LINE/FB/WhatsApp.

### 1. Home (`/`)
Large hero (featured product or category) → featured products section → "Shop by
Category" block (the ~7 friendly groups from §10.2-A) → footer band. Calm, lots of
whitespace.
**Featured selection (no fake popularity):** `popularity_score` is 0/11,436, so
"featured" is NOT data-driven. Phase 1 uses a **manual featured-SKU list** in config
(team-editable), falling back to "in-stock products with critic `score_summary`" if
the list is empty. Never labeled "best-selling" / "most popular" — avoids implying BI
data we don't have.

### 2. Shop (`/shop`) — core
- **Trust/clarity bar** at top: "Browse freely · Contact us to order · No online
  payment yet" (§10.2-G).
- Category tabs across the top = the **~7 friendly groups** (Wine · Whisky · Spirits ·
  Sake & Asian · Beer & RTD · Accessories), NOT the 44 raw classifications (§10.2-A).
- Small row of big filters: **Price (tiered brackets, §10.2-B) · Country · Type ·
  In-stock** + **Sort** dropdown.
- **"More filters"** expander → advanced facets (region, grape, body, acidity,
  tannin, flavor tags, food matching, critic score).
- 3-across responsive product grid (large image, name, price) → 2-across → 1-across.
  Each card offers **Quick-view** (§10.2-F).
- Clear pagination. Filters applied server-side/at build before slicing; filter+page
  state URL-encoded for shareable, back-button-safe browsing.

### 3. Product detail (`/product/[sku]`)
Large image left; right column: name, price, key attributes (country/region/grape/
vintage/bottle size/body/acidity/tannin — **`alcohol` omitted, always empty §10.2-D**),
description, food pairing, critic-score badge (only the 1,550 with `score_summary`),
stock status. **Taste visualisations** (TasteWheel / StructuralGauges) render for wines
with taste data (§10.2-E). When **no description exists (40% of products)**, the
**attribute matrix + taste viz become the hero** instead of a bare page (§10.2-C).
Per-product **Inquire on LINE / WhatsApp / Facebook** buttons pre-filling `"I'm
interested in [Name] — [SKU]."` Below: **Recommended together** rail.

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
  existing data. Concrete scoring inputs (field shapes verified in §4.3):
  - same `region` **+3**, same `grape_variety` **+2**, same `country` **+1**
  - `food_matching` overlap (split both on `,`, trim) **+1 per shared item**
  - same `classification` **+1**; **similar price tier** = within ±40% of this
    product's price **+1**
  Return top 4 by score, **in-stock, de-duplicated, excluding the product itself**.
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

**Rendering target — SSG, decided to avoid the serverless cold-start trap.** The
catalog is built **statically at build time** (Next.js SSG / `generateStaticParams`),
NOT per-request SSR. Rationale: on Vercel serverless, a module-level singleton is
per-instance and every cold start would re-parse the 27 MB file — a real cost/latency
risk. SSG parses the file **once at build**, emits static shop pages + 11,436 product
pages, and serves them as static assets. Data updates ship via rebuild (§4), which the
team already triggers — so SSG matches the update model exactly.

- Parse the 27 MB export **once at build**; build SKU/category/region indexes then.
- Shop grid pre-rendered + paginated (24/page); client receives only the current
  slice + thumbnails, never the full file.
- **Images:** `image_url` points at the external Magento host `th.wine-now.com`. Next
  `next/image` requires this host in `images.remotePatterns` (unconfigured remote host
  is a hard runtime failure, not a graceful degrade). Reuse the existing `ProductImage`
  component with lazy-loading + width limits; 110 products without an image get a
  placeholder (§9).
- Build memory: reuse `NODE_OPTIONS=--max-old-space-size=4096`.

### 8.1 Search (Phase 1 scope)
The header search is **client-side over a prebuilt lightweight index** (sku + name +
brand + region, projected via `toPublicProduct`) generated at build time. Substring +
case-insensitive match, results shown as a dropdown linking to product pages. No
server, no fuzzy ranking in Phase 1 (defer fuzzy to later). If this risks the 2-day
deadline, the search icon degrades to "defer to Phase 2" — flagged at planning.
Note: this index (sku+name+brand+region only, ~11.4k rows, est. ~1–2 MB) is the **one**
allowlisted full-dataset payload sent to the client — an intentional exception to the
"never ship the full file" rule (the 27 MB source with all 49 fields is still never
shipped). If the index proves too large, fall back to a server search route.

### 8.2 Deploy & env
- `data/live_products_export.json` lives at repo root, two levels above `apps/catalog/`.
  The Vercel project for the catalog must include it in the build context (root-relative
  read at build time, not runtime). Confirm the monorepo build root in `vercel.json`.
- Env vars in `apps/catalog/.env` (and Vercel project settings): `LINE_OFFICIAL_URL`,
  `WHATSAPP_NUMBER`, `FB_MESSENGER_PAGE`. No secrets — public contact handles only.
- Update trigger: rebuild on data change (manual redeploy now; scheduled daily re-pull
  is the documented refresh SLA). Catalog may show prices/stock up to one rebuild stale
  — acceptable for a contact-to-buy flow.

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

## 10.1 i18n, currency & SEO

- **Currency:** all prices `THB` → render `฿` with thousands separators (e.g.
  `฿1,250`). Single `formatPrice()` helper.
- **Language:** UI copy is English in Phase 1 (incl. "You might also like",
  "I'm interested in [Name] — [SKU]"). Thai-language UI is deferred; flagged here so
  it's a conscious choice, not an oversight, given the THB/Thai market.
- **SEO:** per-product `<title>` + meta description + OpenGraph image from the product,
  and a generated sitemap. Low effort under SSG; included since this is a public store.

## 10.2 Design & Data-Shape Adjustments (expert + designer review, verified on data)

These came from reviewing the spec against the **actual** export distribution. All
seven are IN Phase-1 scope.

### A. Category grouping (44 → ~7) — REQUIRED, biggest usability lever
The export has **44 distinct `classification` values** (incl. messy ones: `Wine
product`, `Red Wine|Fruit Wine`, `Sake` vs `Sake/Shochu`, `Whisky` vs `Whiskey`,
`Others`, `Events`, `Cigar`). 44 tabs is the opposite of calm-for-40+. A config map
`lib/category-groups.ts` collapses them into **~7 friendly top-level groups**:
- **Wine** — Red/White/Rosé/Sparkling/Champagne/Dessert/Orange/Port/Fruit/Korean/Thai
- **Whisky** — Whisky + Whiskey
- **Spirits** — Gin/Vodka/Rum/Tequila/Brandy/Mezcal/Cognac/Pisco/Absinthe/Baijiu…
- **Sake & Asian** — Sake/Shochu/Umeshu
- **Beer & RTD** — Beer/Ready to Drink/Non-Alcoholic/Mineral Water
- **Accessories** — Glassware/Cigar/Events/Others
Pipe-delimited values (`Red Wine|Fruit Wine`) are split and mapped to the first match.
Top nav shows the ~7 groups; the group→classifications map also feeds the "Type" filter.

### B. Tiered price filter (NOT a slider) — REQUIRED
Price range is **฿40 → ฿2,460,999** (60,000×; p50 ฿1,600, p90 ฿7,000). A linear slider
is unusable and inaccessible. Use **preset brackets** from real percentiles:
`Under ฿1,000 · ฿1,000–3,000 · ฿3,000–7,000 · ฿7,000–15,000 · ฿15,000+`. Tap targets,
not drag.

### C. Attribute-first product pages — REQUIRED
**4,524 products (40%) have NO description at all.** "Hide the block" leaves bare pages.
Instead, when description is absent, the **structured attribute matrix becomes the hero**
(region · grape · vintage · bottle size · body/acidity/tannin · food pairing · flavor
tags). Showcases the "matrix & visualisation" goal and never shows an empty page.

### D. Drop always-empty fields
`alcohol` is **0/11,436** — remove from the detail layout entirely (no perpetually-blank
row). `popularity_*` already handled (§6). Confirmed-present attributes to lean on:
brand 11,334 · region 10,219 · bottle_size 10,312 · vintage 9,163 · grape 6,772.

### E. Taste visualisations (port existing components) — differentiator
Reuse the internal app's `components/product/TasteWheel.tsx`,
`StructuralGauges.tsx`, `TasteProfileSection.tsx` (verified to exist) on the public
product page. Data is richly structured — `taste_profile` is tiered notes with
intensity, `wine_body/acidity/tannin` are populated for **~4,438** wines. Renders only
when data is present (defensive per §9). This is a genuine edge over a plain Shopify
store and is **already built** — port, don't rebuild.

### F. Grid quick-view
"Quick look" on a grid card opens product essentials (image, name, price, key
attributes, contact button) in a modal **without leaving the grid** — reduces
navigation/orientation load for older users who lose their place. Reuses the detail
components.

### G. Trust/clarity bar
A thin strip near the top: **"Browse freely · Contact us to order · No online payment
yet."** Removes confusion about the missing checkout and sets the contact-to-order
expectation — directly serves the Phase-1 model.

## 11. Open Items for Phase 2
- Cart → list → order-summary email (customer + order inbox)
- Real BI / online co-purchase data populating `popularity_orders_90d`
- Online payment, accounts
