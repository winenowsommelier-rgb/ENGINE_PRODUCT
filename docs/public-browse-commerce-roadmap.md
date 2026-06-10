# Public Browse, Detail, and Commerce Roadmap

**Date:** 2026-06-04  
**Status:** Planning baseline  
**Primary goal:** Build a commercial-grade public web app where users can browse products, understand each item through high-quality context, and later reserve or buy through a lightweight ecommerce flow.

---

## Product Direction

The app should become two connected products:

1. **Public catalog experience** for customers.
   - Fast browse and search.
   - Clear product detail pages.
   - Helpful product context, taste, origin, pairing, similar products, and confidence-backed content.
   - No internal workflow noise.

2. **Admin content operation layer** for the team.
   - Easy product editing.
   - Public-readiness queues.
   - AI-assisted description drafting.
   - Quality checks before publish.
   - Future order and reservation management.

The current phase should prioritize browse quality and product-detail clarity. Ecommerce should be designed now, but activated progressively.

---

## Core Experience Principles

- **Commercial, not database-like:** users should browse by need, taste, price, occasion, region, and style, not only by SKU fields.
- **Fast first interaction:** category pages, search, and product cards should load quickly and work well on mobile.
- **Detail pages teach and guide:** each product should explain what it is, why it matters, what it tastes like, and when to choose it.
- **Quality-gated publishing:** only products that pass public-readiness rules should receive full public detail treatment.
- **Admin work should be queue-based:** the team should see exactly what to fix next instead of searching manually.
- **Ecommerce-ready, not ecommerce-heavy:** start with reservation/request commerce before full payment checkout.

---

## Recommended Commerce Mode

Use a **reserve-first commerce model** first.

This is the best fit for wine and spirits because price, stock, vintage, allocation, age restrictions, delivery constraints, and B2B/B2C handling may vary.

### Phase Commerce Modes

| Mode | User action | Backend result | When to use |
|---|---|---|---|
| Browse only | View product details | Analytics event | Current phase |
| Save / shortlist | Save item or compare | User session list | After public detail is stable |
| Reserve request | Add product and submit contact/order intent | Reservation record for admin review | First commerce launch |
| Assisted checkout | Admin confirms stock, price, delivery, then sends payment link/invoice | Confirmed order | After operations workflow is tested |
| Direct checkout | User pays online immediately | Paid order | Later, when inventory/payment/tax/delivery rules are stable |

Recommended first commercial target:

> User browses products, opens rich detail, adds products to a reservation cart, submits contact details, and admin confirms availability from an order summary dashboard.

---

## Public Browse Scope

### Browse Pages

Build customer-facing pages separate from the current admin cockpit:

- `/shop`
- `/shop/wine`
- `/shop/spirits`
- `/shop/beer`
- `/shop/sake`
- `/shop/accessories`
- `/shop/product/[slug-or-sku]`
- `/shop/search`
- `/shop/regions/[slug]`
- `/shop/brands/[slug]`

### Browse Controls

Expected filters:

- Category
- Brand
- Country
- Region
- Subregion / appellation
- Grape / style
- Price range
- Body
- Sweetness
- Acidity
- Tannin
- Flavor tags
- Food pairing
- Occasion
- In stock / available to reserve
- Public-ready only

Expected sorting:

- Recommended
- Popular
- Newest
- Price low to high
- Price high to low
- Highest confidence
- Best content quality

### Product Cards

Each card should show:

- Image
- Product name
- Brand
- Category
- Country / region
- Bottle size / vintage when relevant
- Price or availability state
- Short description
- Main taste tags
- Reserve / view detail action

Cards must not expose internal validation language.

---

## Product Detail Scope

Each public detail page should include:

1. Product hero
   - Image, name, brand, category, vintage, bottle size, price, availability.

2. Editorial description
   - Short description.
   - Full public description.
   - Avoid AI/template language.
   - Avoid one-line name-only descriptions.

3. Taste profile
   - Body, acidity, tannin, sweetness, oak.
   - Flavor tags.
   - Structured taste visualization.

4. Origin and context
   - Country, region, subregion, appellation.
   - Short region or producer context where available.

5. Pairing and occasion
   - Food pairing.
   - Occasion recommendations.
   - Serving notes where relevant.

6. Similar products
   - Same region/style.
   - Same price band.
   - Similar taste profile.
   - Better-value alternatives.

7. Trust and freshness
   - Public-friendly information quality state.
   - Last reviewed date if available.
   - Hide internal confidence numbers unless needed.

---

## Public Readiness Rule

Create a separate `public_ready` concept. Do not reuse the current internal `validated` status as-is.

A product is public-ready when it has:

- Product name
- SKU
- Brand when applicable
- Category/classification
- Price or clear availability state
- Product image
- Image alt text
- Country when applicable
- Region when applicable
- Short description
- Full description with useful public copy
- No template-language leaks
- No name-only full description
- Quality score above threshold
- `validation_status = validated`
- `overall_confidence >= 0.8`
- No high-severity QC blocker

Recommended full-description threshold:

- Minimum: 150 characters for public detail.
- Preferred: 300-700 characters for SEO/AEO and user guidance.
- Accessories can use a different rule if specs are more important than editorial text.

### Readiness States

| State | Meaning |
|---|---|
| `public_ready` | Safe for full public detail |
| `needs_copy` | Data is mostly good, copy is weak |
| `needs_taxonomy` | Missing category/origin/style structure |
| `needs_image` | Missing image or alt text |
| `needs_review` | Confidence or validation is not sufficient |
| `blocked` | Serious conflict, missing identity, or QC issue |

---

## Admin Content Workbench

The admin side should focus on queues and editing.

### Required Queues

- Public-ready products
- High-priority products needing copy
- High-priority products needing taxonomy
- Products missing image alt text
- Products with name-only full descriptions
- GA/sales priority products not public-ready
- New supplier products pending review
- Recently edited products awaiting approval

### Product Editor

The editor should support:

- Edit product identity fields.
- Edit short and full descriptions.
- Edit taste fields.
- Edit origin fields.
- Edit image URL and alt text.
- Preview public detail page.
- Save draft.
- Approve for public.
- Revert or review changes.

### AI-Assisted Drafting

AI should help draft, but admin should approve:

- Full description draft.
- Short description rewrite.
- Region context.
- Pairing suggestions.
- Flavor tag cleanup.
- Similar product rationale.

AI output must be checked against source fields and never publish automatically.

---

## Ecommerce Data Model

Prepare these domain objects even if full checkout comes later.

### Store

Represents storefront/business channel.

Fields:

- `id`
- `code`
- `name`
- `market`
- `currency`
- `status`
- `settings`

### Public Product

Public-facing product projection derived from the PIM product.

Fields:

- `id`
- `product_id`
- `sku`
- `slug`
- `name`
- `brand`
- `category`
- `country`
- `region`
- `price`
- `currency`
- `image_url`
- `short_description`
- `full_description`
- `public_status`
- `public_ready`
- `published_at`

### Inventory Snapshot

Current commercial availability.

Fields:

- `id`
- `sku`
- `store_id`
- `quantity_available`
- `availability_status`
- `source`
- `synced_at`

### Cart

Temporary user basket.

Fields:

- `id`
- `session_id`
- `customer_id`
- `store_id`
- `status`
- `currency`
- `subtotal`
- `created_at`
- `updated_at`

### Cart Item

Product selected by user.

Fields:

- `id`
- `cart_id`
- `sku`
- `product_id`
- `name_snapshot`
- `price_snapshot`
- `quantity`
- `availability_snapshot`

### Reservation

First recommended commerce object.

Fields:

- `id`
- `reservation_number`
- `cart_id`
- `customer_name`
- `customer_email`
- `customer_phone`
- `preferred_contact_method`
- `delivery_or_pickup_preference`
- `status`
- `admin_note`
- `created_at`
- `expires_at`

### Order

Confirmed commercial record after admin review or direct checkout.

Fields:

- `id`
- `order_number`
- `reservation_id`
- `customer_id`
- `status`
- `payment_status`
- `fulfillment_status`
- `currency`
- `subtotal`
- `discount_total`
- `tax_total`
- `shipping_total`
- `grand_total`
- `created_at`
- `confirmed_at`

### Order Item

Confirmed order line.

Fields:

- `id`
- `order_id`
- `sku`
- `product_id`
- `name_snapshot`
- `price_snapshot`
- `quantity`
- `line_total`

### Order Event

Timeline for admin and future customer service.

Fields:

- `id`
- `order_id`
- `event_type`
- `actor`
- `note`
- `created_at`

---

## Backend Order Summary

Admin order dashboard should show:

- New reservations
- Pending confirmation
- Confirmed orders
- Payment pending
- Ready for pickup/delivery
- Completed
- Cancelled/expired

Each order summary should include:

- Customer details
- Product list
- Quantity
- Price snapshot
- Stock snapshot
- Availability risk
- Admin note
- Contact action
- Status timeline
- Convert reservation to order
- Mark payment sent
- Mark payment received
- Mark fulfilled

---

## API Shape

Initial public APIs:

- `GET /api/public/products`
- `GET /api/public/products/[slugOrSku]`
- `GET /api/public/facets`
- `GET /api/public/search`
- `POST /api/public/cart`
- `PATCH /api/public/cart/[id]`
- `POST /api/public/reservations`

Admin APIs:

- `GET /api/admin/public-readiness`
- `GET /api/admin/content-queue`
- `PATCH /api/admin/products/[id]/content`
- `POST /api/admin/products/[id]/approve-public`
- `GET /api/admin/reservations`
- `PATCH /api/admin/reservations/[id]`
- `POST /api/admin/reservations/[id]/convert-to-order`
- `GET /api/admin/orders`
- `PATCH /api/admin/orders/[id]`

Implementation note: keep public routes read-optimized and hide internal fields.

---

## Open-Source Leverage

Use open-source projects for patterns and acceleration, but do not copy code blindly. Review license, maintenance status, dependency weight, and fit before adopting.

### Recommended Now

Use the current Next.js app as the base and build a lightweight storefront module:

- Public routes in the existing app.
- Shared product detail components.
- Supabase/local JSON fallback for data.
- Custom public-readiness projection.
- Reservation-first commerce data model.

This is fastest and safest for the current phase because the catalog and enrichment logic already live here.

### Recommended Future Commerce Engine

**Medusa** is the best future candidate if we need a real commerce backend.

Reasons:

- Open-source TypeScript/Node commerce framework.
- Official Next.js starter.
- Handles carts, products, orders, customers, currencies, sales channels, and more.
- Supports payment integrations such as Stripe and PayPal through its starter/plugin ecosystem.
- Has workflow and admin-extension concepts that can support custom wine/spirits operations.

Use Medusa when we need:

- Full checkout.
- Payment provider abstraction.
- Promotions.
- Customer accounts.
- Multi-region pricing.
- Order management.
- More formal inventory handling.

### Alternative Options

| Option | Best for | Notes |
|---|---|---|
| Vercel Commerce / Vercel Shop | Storefront UI and Next.js App Router patterns | Actively maintained around Shopify; useful as design/code-pattern reference |
| Vendure | TypeScript, GraphQL, plugin-heavy commerce backend | Strong if we want GraphQL APIs and a separate commerce admin |
| Saleor | GraphQL-first composable commerce | Strong if we want cloud/composable enterprise commerce and webhook-heavy integrations |
| Custom lightweight commerce | Reservation-first flow | Best for immediate speed and control |

Decision:

> Build custom lightweight reservation commerce first. Keep a commerce adapter boundary so Medusa or another engine can replace the backend later without rebuilding the public browsing UI.

---

## Architecture Decision

### Current Phase Architecture

```
Product data / enrichment / taxonomy
        ↓
Public readiness projection
        ↓
Public browse + product detail UI
        ↓
Reservation cart
        ↓
Admin reservation dashboard
```

### Future Commerce Architecture

```
Public browse UI
        ↓
Commerce adapter
        ↓
Custom reservation backend OR Medusa/Vendure/Saleor
        ↓
Payment / inventory / order operations
```

The frontend should call an internal commerce adapter, not a specific platform directly.

Example:

- `lib/commerce/products.ts`
- `lib/commerce/cart.ts`
- `lib/commerce/reservations.ts`
- `lib/commerce/orders.ts`
- `lib/commerce/provider.ts`

Provider modes:

- `local-reservation`
- `medusa`
- `vendure`
- `saleor`

Start with `local-reservation`.

---

## Build Roadmap

### Sprint 1: Readiness and Data Foundation

- Add public-readiness model.
- Fix full-description field mapping.
- Fix validation local fallback.
- Fix segment counting.
- Add `public_ready` API.
- Add content quality reasons per product.

### Sprint 2: Public Browse

- Add `/shop` shell.
- Build public product card.
- Add category browse pages.
- Add search and filters.
- Hide internal/admin fields.
- Add mobile-first layout.

### Sprint 3: Product Detail

- Build public product detail page.
- Reuse existing `ProductDetailPanel` where practical, but simplify for customers.
- Add editorial description block.
- Add origin/context block.
- Add taste/profile block.
- Add similar products.
- Add reserve CTA placeholder.

### Sprint 4: Admin Content Workbench

- Add public-readiness matrix.
- Add content queues.
- Add product content editor.
- Add public preview.
- Add approve-for-public action.

### Sprint 5: Reservation Commerce

- Add cart model.
- Add reservation model.
- Add reservation submit flow.
- Add admin reservation dashboard.
- Add order summary view.
- Add status timeline.

### Sprint 6: Full Ecommerce Evaluation

- Decide whether to stay custom or introduce Medusa/Vendure/Saleor.
- If using Medusa, map PIM product projection to Medusa products and variants.
- Add payment provider selection.
- Add customer accounts if needed.

---

## Quality Gates

Before a product appears in full public detail:

- Public-ready state is true.
- Description is useful and human-readable.
- Image loads.
- Price/availability is clear.
- Taxonomy context is not misleading.
- Similar-products logic does not recommend broken/hidden products.

Before reservation commerce launches:

- Cart cannot reserve hidden products.
- Cart stores price and availability snapshots.
- Reservation has expiration.
- Admin can confirm, cancel, and convert.
- Audit/event timeline is saved.
- User receives confirmation messaging.

Before direct checkout launches:

- Inventory rules are reliable.
- Payment provider is selected.
- Refund/cancel process exists.
- Age/legal/compliance copy is finalized.
- Delivery/pickup rules are clear.

---

## Source References

- Vercel Next.js Commerce template: https://vercel.com/templates/nextjs/nextjs-commerce
- Vercel Shop docs: https://www.vercel.shop/docs
- Medusa storefront development docs: https://docs.medusajs.com/learn/storefront-development
- Medusa Next.js Commerce template: https://medusajs.com/nextjs-commerce/
- Medusa framework overview: https://medusajs.com/framework/
- Vendure architecture docs: https://docs.vendure.io/current/core/developer-guide/overview
- Saleor open-source commerce overview: https://saleor.io/open-source

