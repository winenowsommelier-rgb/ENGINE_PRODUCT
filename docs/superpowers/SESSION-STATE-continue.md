# WNLQ9 Catalog — session state & continue prompt

**As of 2026-06-20. Branch: `feat/wnlq9-catalog`. A parallel data session edits this same repo —
`git add` only your own files, never `-A`.**

Paste the "CONTINUE PROMPT" at the bottom into a fresh session to resume.

## Goal
Make the WNLQ9 public catalog's recommendations **best in class**. The catalog (`apps/catalog/`)
+ Product Finder ("Find Your Match") are built and live-ready.

## What's DONE (built, reviewed, tested, on branch)
- **Catalog storefront** — home, shop (drill-down nav, filters, 10-group SKU taxonomy),
  product pages (ISR), search, contact. Grouping by SKU prefix via `groupForProduct` (fixed a
  bug where 1,431 products were mis-grouped into Wine).
- **Product Finder v1** — adaptive quiz → style profile + matched products; "Find Your Match"
  in nav + home band + shop prompt. 7 categories.
- **Finder Sommelier Upgrade (v2)** — opt-in deep-dive (acidity/tannin/grape/age/
  adventurousness/peat, sommelier voice) + a **navigable discovery-map result** (clickable
  category→country→region→subregion breadcrumb + signature chips + "see all N", all into the
  existing `/shop` filters). 299 tests pass; browser-verified. A whole-feature review caught a
  CRITICAL (the UI `withAnswer` dropped all deep-dive answers → feature was inert) — FIXED +
  guarded with a `never` exhaustiveness check + the missing seam test.

## SPECS approved, NOT yet built
1. **BI-powered recommendations** (`docs/superpowers/specs/2026-06-20-wnlq9-bi-powered-recommendations-design.md`)
   — behavioral "Customers also bought" (co-purchase affinities + sales velocity from the BI
   Marketing Engine), baked at build time. **THE remaining best-in-class lever.** Plan NOT written.
   **BLOCKER (verified live 2026-06-20): the provided BI API key is REJECTED on all protected
   endpoints** (`/health`+key=200 because /health needs no auth; `/products`+key=401, same as no
   key). Header/endpoints/shape all confirmed correct via live OpenAPI — it's a server-side key
   mismatch (deployed Vercel env differs from the key on the API page). Fix + exact resume steps:
   `docs/superpowers/bi-connection-info-request.md` (top ⛔ block). Until a key passes `/products`,
   this build CANNOT start. Catalog reads `process.env.BI_API_KEY` (key never in chat/browser).
2. **Shop by Collection** — NOT yet spec'd. Handoff to design+build in another session:
   `docs/superpowers/handoff-shop-by-collection.md`. (No `collection` field exists — must be
   defined; dual purpose: browsable library + a source of curated sets for the finder.)

## Data enhancements (parallel session, see memory `project_finder_data_enhancements`)
P1/P2 (body/acidity/tannin/taste_profile) + the 10-group taxonomy backfill LANDED — in-stock
wine taste coverage is now ~100%. P3 spirit_style did NOT land (0 rows — phantom). Future:
P6 designation (Grand Cru/XO) + sweetness/oak/appellation enrichment would unlock more finder
questions + the appellation link level.

## Process rules in force
brainstorm→spec→spec-review→plan→plan-review→subagent build (per-task spec+quality review)→
Rule 7 browser verify→whole-feature review. Margin-leak chokepoint (`toPublicProduct`) is
non-negotiable. Every shop/finder link must resolve to a NON-EMPTY set (dead-link trap).
`is_in_stock` is a STRING "1"/"0". Go-live needs a NEW Vercel project (Root Dir=`apps/catalog`)
— see `docs/superpowers/wnlq9-catalog-go-live-runbook.md`.

---

## CONTINUE PROMPT (paste into a fresh session)

Resume the WNLQ9 catalog "best-in-class recommendations" work on branch `feat/wnlq9-catalog`.
Read `docs/superpowers/SESSION-STATE-continue.md` first for full context. A parallel session
edits this repo — `git add` only your own files.

The next step is the **BI-powered recommender** (spec already approved:
`docs/superpowers/specs/2026-06-20-wnlq9-bi-powered-recommendations-design.md`). I am getting
you the BI API key + calibration data via the request in
`docs/superpowers/bi-connection-info-request.md`.

When I confirm the BI key is in `apps/catalog/.env.local` and paste the calibration answers:
1. Verify the live BI API responds (a quick authed `/marts` + one `/products/{sku}/affinities`),
   confirming the real payload shape matches the spec.
2. Set the support-floor (MIN_CO_COUNT) and velocity-normalization constants from the real
   calibration distributions (Rule 3 — don't guess).
3. Write the BI-recs implementation plan (writing-plans skill) → plan review → subagent build.

If the BI key is NOT yet available, instead write the BI-recs plan design-only (no live calls,
no calibration) so it's ready, OR pick up "Shop by Collection"
(`docs/superpowers/handoff-shop-by-collection.md`) — whichever I direct.
