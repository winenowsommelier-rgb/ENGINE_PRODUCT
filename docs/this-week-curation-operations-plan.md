# This-Week Curation and Relationship Operations Plan

**Date:** 2026-06-04  
**Target window:** June 4-7, 2026  
**Status:** Immediate build and usage plan  
**Priority:** Higher than future ecommerce work for this week

---

## Objective

Make the current operation layer usable this week for product recommendations, item relationships, and curated product lists.

The near-term goal is not a full public shop. The goal is:

> Staff can ask for a curated set, understand why products were recommended, approve or skip items, export or reuse the result, and trust the product relationships shown in product detail.

---

## What Exists Today

### Curation Engine

Route:

- `POST /api/curation`
- UI: `/curation`

Current flow:

1. Operator enters a natural-language brief.
2. Brief parser converts it to structured filters.
3. Hard filter selects candidate products from `data/db/products.json`.
4. Scoring engine ranks candidates.
5. Rationale writer creates one-line expert notes.
6. UI shows ranked products and lets staff approve or skip locally in the page state.

Current strengths:

- Local product data path exists.
- Pairing knowledge base exists.
- Rule-based scoring exists.
- Approve/skip UI exists.
- Tests are passing: `24 passed` for `tests/curation`.

Current blockers for this week:

- Approved/skipped decisions are not persisted.
- Export collection is marked as future work.
- Result cards show too little product context: no image, price, stock, region, margin, or relationship explanation.
- Natural-language curation depends on Ollama being available.
- No run history, so staff cannot reuse a prior curation.

### Metadata Discovery

Route:

- `GET /api/curation/discover`

Purpose:

- Fast product discovery without an LLM.
- Filters by classification, country, region, brand, grape, price, wine axes, flavor tags, style tags, and grade.

Current strengths:

- Cheap and fast.
- Good fit for staff lookup and operational search.

Current blockers:

- No dedicated UI yet.
- Supabase-only data source; if Supabase config is unavailable it may return empty results rather than a clear local fallback.
- Not yet connected to curation result approval.

### Product Relationships

Current relationship sources:

| Source | Current implementation | Purpose |
|---|---|---|
| BI affinities | `data/bi-product-affinities.json` + product detail panel | Products bought together or by same customers |
| Comparable products | `app/api/products/[id]/route.ts` | Same brand/category/country/region/SKU family/price band |
| Precomputed similarity | `app/api/products/[id]/similar/route.ts` | Supabase `product_similar` table |
| On-the-fly similarity | `app/api/similar/[id]/route.ts` | Brand, category, region, price band, SKU family, taste axes |
| Python affinity rules | `lib/curation/affinity_resolver.py` | Similar, overlap, and contrast relationships from rule files |

Current strengths:

- Multiple relationship types exist.
- Product detail panel already displays BI affinities and comparable products.
- On-the-fly similarity gives fallback relationship logic.

Current blockers:

- Relationship sources are split across different APIs and components.
- Some routes are Supabase-only.
- Staff sees some match reasons, but not one consistent relationship explanation.
- Product detail "More like this" rail silently disappears when no precomputed similarity exists.

---

## This-Week Operating Workflow

Use this workflow until the public shop work begins.

### Daily Curation Workflow

1. Open `/curation`.
2. Use one of the standard brief formats below.
3. Run curation.
4. Review candidate count and resolved filters.
5. Approve strong recommendations.
6. Skip weak or off-context items.
7. Export approved list or save as a named collection.
8. Use product detail relationships to replace weak picks.
9. Record final list source and purpose.

### Standard Brief Formats

Use specific, structured briefs for reliable results.

Examples:

- `Top 12 Australian red wines for customer browse, in stock, 1000 to 3000 THB`
- `Top 10 Champagne and sparkling wines for celebration, premium tier, in stock`
- `Best whisky pairing with Thai food, top 12, prefer high margin`
- `White wines for seafood pairing, France or Italy, under 2500 THB`
- `B2B restaurant list for steak menu, full-bodied red wine, 2000 to 6000 THB`

Avoid vague briefs like:

- `best products`
- `good wine`
- `nice collection`

### Review Criteria

Approve when:

- Product fits the brief.
- Product has usable image and short description.
- Price and stock make sense for the request.
- Region/category/taste fields support the recommendation.
- Rationale is specific and not generic.

Skip when:

- Product is out of context.
- Product has weak or missing detail.
- Recommendation is only high because of brand/category but does not match occasion.
- Contraindication is shown.
- Price or stock makes it unsuitable.

---

## Immediate Development Priorities

### Priority 1: Persist Curation Runs

Add local JSON-backed storage first.

Files:

- `data/db/curation-runs.json`
- `data/db/curation-collections.json`

Required run fields:

- `id`
- `brief`
- `resolved_query`
- `candidate_count`
- `products`
- `approved_skus`
- `skipped_skus`
- `created_at`
- `updated_at`
- `operator_note`

Required collection fields:

- `id`
- `name`
- `purpose`
- `source_run_id`
- `approved_items`
- `status`
- `created_at`
- `updated_at`

UI changes:

- Add "Save Run".
- Add "Save Approved as Collection".
- Add "Run History".
- Add "Load Previous Run".

### Priority 2: Upgrade Curation Result Cards

Each curation result card should show:

- Image
- SKU
- Product name
- Brand
- Category
- Country / region
- Price
- Stock state
- Score
- Rationale
- Matched rules
- Contraindication warning
- Main match reasons
- Link/open product detail

This makes recommendations usable by staff without switching pages repeatedly.

### Priority 3: Add Export

Add export options from approved items:

- CSV
- Markdown
- Copyable customer-facing list
- Copyable internal proposal list

CSV columns:

- rank
- sku
- name
- brand
- category
- country
- region
- price
- score
- rationale
- matched_rules
- approval_status

Markdown format:

```md
## Collection Name

1. Product Name — SKU
   - Price:
   - Region:
   - Why it fits:
```

### Priority 4: Relationship Explanation Layer

Create one relationship explanation object that can be reused across product detail, curation, and future public pages.

Recommended shape:

```ts
type ProductRelationship = {
  source: 'bi_affinity' | 'comparable' | 'similarity' | 'curation_affinity';
  relationship_type: 'same_order' | 'same_customer' | 'similar' | 'overlap' | 'contrast' | 'variant' | 'same_region' | 'same_style';
  target_product_id?: string;
  target_sku: string;
  target_name: string;
  score: number;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
};
```

Staff-facing explanation examples:

- `Same brand + same region + same price tier`
- `Customers who bought this also bought this`
- `Same full-bodied red profile with dark fruit flavor overlap`
- `Contrast pairing: smoke and weight vs bright acidity`

### Priority 5: Add Discovery UI

Create an internal discovery panel beside or under the curation form.

Modes:

- Natural-language curation
- Fast metadata discovery

Discovery controls:

- Category
- Country
- Region
- Brand
- Grape/style
- Price min/max
- Body
- Acidity
- Tannin
- Flavor
- Grade
- Limit

Why:

- Staff can use discovery even when Ollama is not running.
- Discovery results can become manual curation candidates.

### Priority 6: Improve Ollama Failure Handling

When `/api/curation` fails because Ollama is unavailable, the UI should show:

- Clear reason.
- How to start Ollama.
- Option to switch to metadata discovery.

Message:

```txt
Natural-language curation needs Ollama running locally.
Start Ollama, or use Fast Discovery mode for rule-only search.
```

---

## Recommendation Logic Matrix

Use this matrix to explain recommendations internally.

| Logic | Good for | Data used | Needs this week |
|---|---|---|---|
| Curation score | Ranked list for brief | filters, taste, taxonomy, brand, margin, pairing rules | More visible score breakdown |
| Pairing rules | Food and occasion recommendations | food taxonomy, beverage axes, contraindications | Show pairing explanation |
| BI affinity | Cross-sell and bundle ideas | historical order/customer behavior | Display source and rate clearly |
| Comparable products | Substitutes and alternatives | brand, category, region, price band | Already visible, needs stronger UI |
| Similarity | "More like this" rails | taste profile and product_similar | Add fallback if precomputed table empty |
| Affinity resolver | Similar/overlap/contrast sets | flavor tags and product affinity rules | Expose in API/UI |

---

## Suggested Page Structure for This Week

Upgrade `/curation` into an internal command center.

Sections:

1. Brief input
2. Fast discovery filters
3. Resolved query summary
4. Ranked recommendation cards
5. Score and rule explanation
6. Approve / skip / replace actions
7. Approved collection tray
8. Export / save actions
9. Run history

This does not need to be beautiful yet. It needs to be reliable, clear, and fast.

---

## Build Order

### Day 1: Persistence and Export

- Add curation run storage.
- Add collection storage.
- Add save approved collection.
- Add CSV/Markdown export.

### Day 2: Result Card Upgrade

- Add product context to curation results.
- Add image, price, region, stock, brand, and category.
- Add product detail open action.
- Add clear contraindication display.

### Day 3: Relationship Explanations

- Normalize relationship explanation shape.
- Add relationship summary utility.
- Show relationship reasons in product detail and curation replacement flow.

### Day 4: Discovery UI and Fallback

- Add fast discovery UI.
- Add local fallback if Supabase is unavailable.
- Add Ollama failure guidance.

### Day 5: Staff QA Pass

- Run curation on 5 real business cases.
- Save collections.
- Review recommendation quality.
- Tune scoring weights if needed.

---

## This-Week Acceptance Criteria

By the end of this week, staff should be able to:

- Run a natural-language curation.
- Use fast discovery without LLM.
- See why each item was recommended.
- Approve and skip items.
- Save a run.
- Save approved items as a collection.
- Export approved items.
- Open product details from a recommendation.
- See relationship reasons for comparable and affinity products.
- Recover gracefully if Ollama or Supabase is unavailable.

---

## Keep in Parallel, Not Primary This Week

Do not block this week's work on:

- Full ecommerce.
- Public `/shop` UI.
- Direct checkout.
- Payment integration.
- Customer accounts.
- Full SEO/AEO page generation.

Those remain in `docs/public-browse-commerce-roadmap.md`.

This week's priority is operations: curation, relationship trust, recommendation workflow, and staff usability.

