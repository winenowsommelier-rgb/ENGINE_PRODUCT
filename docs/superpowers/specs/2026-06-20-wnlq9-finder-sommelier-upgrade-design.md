# WNLQ9 Product Finder — Sommelier Upgrade (v2) Design Spec

**Date:** 2026-06-20
**Status:** Draft (design), pending spec review + implementation plan
**Builds on:** the shipped Finder v1 (`apps/catalog/lib/finder/`, spec
`2026-06-18-wnlq9-product-finder-design.md`). This is an ADDITIVE upgrade — v1's modules,
scoring, and pages remain; v2 deepens the quiz and transforms the result page.

**Goal:** Make the finder feel like a real **sommelier interview** and turn its result into a
**navigable discovery map** — without hurting completion for the 40+ audience.

---

## 1. Why (what v1 left on the table)

V1 asks ~5 questions (category, occasion, budget, body, flavor) and returns a style card +
a product grid. But the P1/P2/P3 enrichment landed, so the data is now **far richer than v1
exploits** — verified on in-stock Red Wine (2,200):

| Field | Coverage | v1 uses it? |
|---|---|---|
| `wine_body` | 100% | ✅ |
| `wine_acidity` | 100% | ❌ |
| `wine_tannin` | 100% | ❌ |
| `taste_profile` (tiered notes) | 100% | partial |
| `grape_variety` | 98% | ❌ (scoring only via archetype) |
| `vintage` | 99% | ❌ |
| `region` | 100% | filter only |
| `subregion` | 72% | ❌ |
| `country` | 100% | filter only |
| `food_matching` | 87% | ✅ (food step) |

**Deliberately NOT asked** (0% populated — asking would be fake precision, project Rule 3):
`sweetness`, `oak`/élevage, `alcohol`, `organic/biodynamic`, `appellation`. These are
candidates for a future enrichment pass, not v2 questions/links.

---

## 2. Quiz philosophy — Adaptive Depth (approved)

**Short by default, deep on request.** A casual shopper finishes the tight core; an
enthusiast opts into the full sommelier interview. This respects accessibility (most users
get ~5 steps) while monetizing the rich data for those who want precision.

```
CORE PATH (everyone, ~5 steps — unchanged from v1 shape)
  1 Category · 2 Occasion (+food sub-step) · 3 Budget · 4 Body/Weight · 5 Flavor leaning
       │
       ▼  RESULT  ——or——  “Refine like a sommelier →”  (opt-in branch)
                                   │
  SOMMELIER DEEP-DIVE (opt-in, per category, data-backed)
   WINE:    6 Acidity · 7 Tannin(reds) · 8 Grape leaning · 9 Age/vintage · 10 Adventurousness
   WHISKY:  Cask character · Peat level · Age statement · Adventurousness
   GIN:     Classic↔Contemporary + botanical lean
   SPIRITS: Type + Origin + sipping vs mixing
   SAKE:    Style + Dry↔Rich
```

- Every deep-dive question maps to a field that is **actually populated** for that category.
  Thin-data categories (gin/spirits/sake) get a **shorter** deep-dive — the config declares
  fewer steps; v1's floor-tier minimum-results guarantee still applies.
- "No preference / Surprise me" remains on every taste step (contributes 0).
- The deep-dive answers extend the same `Answers` object (new optional fields) and the same
  URL codec — the result stays shareable/back-safe.

---

## 3. Sommelier voice (approved)

Each attribute is phrased as a sensory question with a plain-English hint, never bare jargon.
The on-screen wording is the contract; the token→attribute mapping is behind the scenes.

| Field | Question | Token → on-screen LABEL |
|---|---|---|
| `wine_acidity` | "How should it feel in your mouth? *(acidity = freshness)*" | crisp→Bright & mouth-watering · balanced→Balanced · soft→Soft & round |
| `wine_tannin` | "How much structure do you enjoy? *(tannin = grippy, like strong tea)*" | silky→Silky & smooth · firm→Firm & structured · any→No preference |
| `grape_variety` | "Any grape you already love — or surprise you?" | varietal-family tokens · surprise→Surprise me |
| `vintage` (age) | "Fresh and lively, or with some age on it?" | young→Young & vibrant · mature→Mature & developed · any→Either |
| adventurousness | "Stick with the classics, or discover something off the beaten path?" | classic→Classic & reliable · twist→A little adventurous · discovery→Show me something new |

> **CRITICAL — labels ≠ filter values.** The labels above are what the USER sees. They are
> NOT the values stored in the data or accepted by `/shop` filters. The real component
> scales (verified) are **ordinal, 5–8 levels**, with NO "Firm"/"crisp"/"soft" values:
> - `wine_body`: `Light · Medium-Light · Medium · Medium-Full · Full`
> - `wine_acidity`: `Medium-Light · Medium · Medium-Full · Medium-High · High` (+ rare `Full`)
> - `wine_tannin`: `Low · Light · Medium-Light · Medium · Medium-Full · Medium-High · High` (+ rare `Full`)
>
> So a token maps to a **set of scale values** for scoring/linking, never to its label:
>
> | Token | maps to scale values (for shop links + scoring buckets) |
> |---|---|
> | body `bold` | `Full`, `Medium-Full` |
> | body `medium` | `Medium`, `Medium-Light` |
> | body `light` | `Light`, `Medium-Light` |
> | acidity `crisp` | `High`, `Medium-High` |
> | acidity `balanced` | `Medium`, `Medium-Full` |
> | acidity `soft` | `Medium-Light`, `Medium` |
> | tannin `firm` | `High`, `Medium-High`, `Medium-Full` |
> | tannin `silky` | `Low`, `Light`, `Medium-Light` |
>
> Scoring uses the ordinal-ladder distance (as v1 body does). **Shop links** built from a
> token use the token's PRIMARY scale value (e.g. `bold`→`body=Full`, `firm`→`tannin=High`)
> — since `/shop` filters are single-value exact-match. This token→scale-value map lives in
> ONE place (`lib/finder/scales.ts` or within `question-config.ts`), shared by scoring and
> link-building so they never drift.

**Whisky deep-dive wording** (data-backed — `spirit_style` IS populated, 1,274 rows from the
P3 backfill): Cask character (sherried/rich vs bourbon-cask/vanilla → `spirit_style`) · Peat
level (none→heavy → `region`=Islay + `flavor_tags`, reusing v1's smoky scorer) · Age
statement (→ vintage/name) · Adventurousness (classic distilleries → world/craft via
country). Whisky deep-dive steps gate on these fields being present; absent → fewer steps.

---

## 4. New `Answers` fields + scoring (additive)

```ts
// extends v1 Answers — all optional, all from the opt-in deep-dive
interface Answers {
  // … v1 fields (category, occasion, food, budget, axis1, axis2, flavorChips) …
  acidity?: string;          // crisp | balanced | soft
  tannin?: string;           // silky | firm | any
  grape?: string;            // varietal-family token | surprise
  age?: string;              // young | mature | any
  adventure?: string;        // classic | twist | discovery
  // whisky/spirits deep-dive tokens reuse axis-style fields or add: cask?, peat?
}
```

**Scoring (extends `finder/scoring.ts`, same tiered model, ordinal ladders where applicable):**
- **Acidity / Tannin**: ordinal-ladder distance on the real value scales (same pattern as
  body) — exact +3 / ±1 +1 / missing 0. NEVER hard-filter (sparse outside wine).
- **Grape**: +2 if `grape_variety` (a comma-joined blend string, 346 distinct values)
  CONTAINS any substring in the chosen family's token set; `surprise` → 0. The family→token
  map is explicit config (substring, ci) — e.g. `cabernet→["cabernet"]`,
  `pinot-noir→["pinot noir"]`, `syrah-shiraz→["syrah","shiraz"]`, `sangiovese→["sangiovese"]`,
  `tempranillo→["tempranillo","rioja"]`, `merlot→["merlot"]`, `grenache→["grenache","garnacha"]`.
  Shop links reuse the same primary token (`grape=Cabernet` — substring filter, catches blends).
- **Age**: parse `vintage` into young/mature. **Verified value shapes (in-stock red):**
  `"Current vintage"` (any casing) = **1,079 — the DOMINANT value** → treat as **young**;
  `"YYYY [**VINTAGE MAY CHANGE]"` = 631 → strip suffix, use the year; bare `"YYYY"` = 471 →
  use the year; `""/N/V` = none. A year is **mature** if (currentYear − year) ≥ ~8, else
  young (threshold = config tunable, Rule 3). `young` answer +1 on young; `mature` +1 on
  mature; `any`/unparseable → 0. (Handling only `[**VINTAGE MAY CHANGE]`, as the first draft
  did, would mis-bucket the "Current vintage" majority into 0 — killing the age signal.)
- **Adventurousness**: maps to **region familiarity**. `classic` → +2 if the product's
  `region` is in the FAMOUS_REGIONS set; `discovery` → +2 if NOT in it; `twist`/`any` → 0.
  FAMOUS_REGIONS is explicit config, **every entry validated to exist in the `region` field**
  (counts verified): `Bordeaux`(783) · `Burgundy`(565) · `Champagne`(509) · `Tuscany`(457) ·
  `Piedmont`(323) · `Mendoza`(194) · `Napa Valley`(123) · `Marlborough`(117) · `Rioja`(80) ·
  `Mosel`(39) · `Douro`(24). NOTE: `Barossa Valley` is a **subregion**, NOT a region (0 in the
  region field) — so it is EXCLUDED from this region-keyed set (the exact zero-match trap to
  avoid). Rule 3 tunable; re-validate against the real `region` distribution at build.
- All additive, all degrade to 0 when unanswered (deep-dive is opt-in) → **core-only runs
  score exactly as v1**. The `degraded` flag is still computed from the taste tiers only.

---

## 5. The result as a navigable discovery map (approved — the centerpiece)

The result page (`/finder/result`) gains a **scoped, fully-clickable** section. Every link is
a `/shop?…` URL the catalog **already supports** (verified: `shop-query.ts` filters on
`group, class, country, region, subregion, grape, body, acidity, tannin, price`) — so this is
**links only, no new shop code**.

```
YOUR STYLE   The Bold & Structured Red
             Full body · firm tannin · earthy · adventurous

WHERE IT'S CLASSICALLY FOUND   (each level → a live /shop filter link)
   Red Wine ›  France ›  Bordeaux ›  Médoc          (appellation omitted — 0% data)
   e.g. /shop?group=Wine&class=Red%20Wine&country=France&region=Bordeaux&subregion=Médoc

BROWSE BY YOUR STYLE'S SIGNATURE   (chips → pre-filtered shop sets)
   [Full-bodied reds ↗] [Firm-tannin ↗] [Cabernet family ↗] [Bordeaux ↗]
   e.g. /shop?group=Wine&class=Red%20Wine&body=Full   /shop?...&tannin=High   /shop?...&grape=Cabernet
   (chip VALUES are scale tokens — body=Full, tannin=High — NOT labels "Firm"; see §3 map)

YOUR TOP MATCHES   (the existing ranked grid, with per-bottle "why" reasons)
   🍷 Château X — "Firm tannin & cassis — your structured profile."  · Customers also bought
   See all N wines in your style ↗   → /shop with the full style filter set, sorted by match
```

**Design rules (the honest-scope guard):**
- Geo scope = the style's **typical/classic** origin (from the resolved archetype's
  `typicalRegions`/`typicalGrapes`), labeled **"classically found in"** — NOT a literal
  filter of the user's answers (a bold red isn't only Bordeaux).
- **CRITICAL — resolve each origin value to the field it actually lives in.** An archetype
  `typicalRegions` entry is NOT always a `region` value (verified): `Bordeaux`→region (783),
  `Napa Valley`→region (123) AND subregion (153), but `Médoc`/`Beaujolais`→**subregion**,
  `Barossa Valley`→**subregion** (and the literal `"Barossa"` exists in NEITHER field → 0
  matches). Whisky/gin archetype origins are often **country**-level (`Japan`, `Ireland`) or
  **non-data labels** (`Worldwide`, `Cognac`, `Jalisco`) that exact-match no field.
  → A shared resolver `resolveOriginField(value)` checks, in order, exact-match against
  `region`, then `subregion`, then `country`; returns `{field, value}` or null. The link uses
  that field (`region=`|`subregion=`|`country=`); **a value matching no field is dropped, not
  linked** (no dead links). Archetype origin strings SHOULD be normalized to real data values
  (e.g. `"Barossa"`→`"Barossa Valley"`) as part of this work — validate every archetype's
  `typicalRegions` against the export.
- The **"See all N in your style ↗"** catch-all links to the broader style filter
  (body/tannin/etc., no region constraint) so nothing is hidden behind the geo scope.
- Only link levels with data: `category → country → region → subregion`. **Never link
  appellation** (0%). A subregion link is omitted when the archetype has no subregion.
- The link builder reuses the catalog's exact param names (one shared helper, e.g.
  `lib/finder/shop-links.ts`), so finder links and the shop stay in lockstep.
- Per-bottle "why" reason = a short string derived from which signals matched (structured,
  not LLM) — e.g. "Firm tannin & cassis — your structured profile."

---

## 6. Architecture (small, additive)

```
apps/catalog/lib/finder/
  question-config.ts   ← ADD per-category deep-dive steps (optional, data-gated)
  answers.ts           ← ADD optional fields + URL codec params (acidity,tannin,grape,age,adventure…)
  scoring.ts           ← ADD acidity/tannin ladders, grape, age, adventurousness terms
  style-profiles.ts    ← archetypes gain typicalRegions/typicalGrapes used by the map (mostly present)
  shop-links.ts        ← NEW: build /shop?… URLs from a style/scope (reuses catalog param names)
components/finder/
  StyleResult.tsx      ← ADD geo breadcrumb links + signature chips + "see all N" + per-bottle reasons
  StepShell.tsx        ← ADD the "Refine like a sommelier →" branch affordance after the core
```

- Pure modules stay pure/unit-tested. The deep-dive is config-driven (adding a question =
  config edit). The map is a pure URL builder + presentational rendering.
- **No new data dependency** — uses fields already in `live_products_export.json`. (Composes
  cleanly with the BI-recs spec: that adds "Customers also bought" to the matches grid; this
  adds the scoped map + reasons. Independent, non-conflicting.)

---

## 7. Error handling
- Deep-dive skipped entirely → result = v1 behavior + the new map (map needs only the
  resolved style, which core answers already produce).
- Archetype with no `typicalRegions` → geo breadcrumb shows only the levels it has
  (category always; country/region/subregion as available); never a broken link.
- A shop-link that would yield zero products still resolves to a valid (empty-state) shop
  page — the catalog already handles empty filter results gracefully.

---

## 8. Testing (per project rules)
- **Unit — scoring:** acidity/tannin ordinal ladders correct; grape-family +2; age parsing
  handles `[**VINTAGE MAY CHANGE]`; adventurousness region-familiarity mapping; **a
  core-only Answers object scores byte-for-byte like v1** (deep-dive additive).
- **Unit — `shop-links.ts`:** builds correct `/shop?…` params for each scope level and chip;
  omits appellation always; omits subregion when absent; URL-encodes values (e.g. `Médoc`).
- **Unit — `question-config`:** each category's deep-dive only contains data-backed steps;
  thin categories declare fewer; core path unchanged.
- **Data invariant (Rule 6):** result + all linked sets still go through `toPublicProduct` —
  no margin/internal leak; the map links carry only public filter params.
- **Browser (Rule 7):** opt into the deep-dive for wine → all new questions render in
  sommelier voice; result shows the geo breadcrumb + chips + "see all N", and **clicking each
  lands on the correctly-filtered shop**; appellation never appears; core-only path still
  works for all 7 categories.

---

## 9. Out of scope / future
- Enrich `sweetness`, `oak`, `alcohol`, `appellation`, `organic` → would unlock more
  deep-dive questions AND the appellation link level. (Future paid/rule-based pass.)
- LLM-written per-bottle reasons / expert notes (structured strings now; LLM later).
- Saving a style profile to revisit (needs accounts — deferred).
