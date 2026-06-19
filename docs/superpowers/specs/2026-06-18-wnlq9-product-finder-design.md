# WNLQ9 Product Finder — Design Spec

**Date:** 2026-06-18
**Status:** Draft (design), pending spec review + implementation plan
**Depends on:** the WNLQ9 catalog app (`apps/catalog/`) being scaffolded
(see `2026-06-17-wnlq9-online-catalog-design.md`). The finder is a feature *inside*
that app and reuses its `toPublicProduct` projection and `recommender.ts`.

---

## 1. Goal & Scope

A guided, step-by-step **Product Finder** ("style quiz") inside the public WNLQ9
catalog. The user answers a short, adaptive series of questions; the finder returns:

1. **A style profile** first — a teachable, reusable archetype (e.g. *"The Bold &
   Structured Red"*) with an expert note, defining attributes, and food/occasion
   guidance. This is the primary, "product-expert" output and a **reusable team
   artifact**.
2. **Matched products** second — the in-stock bottles that best fit that style and
   the user's budget, shown below the profile.

Serves both customers (self-serve discovery) and the team (run it, copy the
shareable result URL, send a customer their style + bottles).

### IN SCOPE (Phase 1)
- Adaptive, config-driven question flow (one engine, per-category question sets)
- 7 Step-1 categories (below); steps adapt per category (min 3, max 6 + 1 conditional)
- Tiered scoring with a **minimum-results guarantee** (never dead-ends)
- Curated style-profile archetype library (config, deterministic, team-editable)
- Conditional **food-pairing** sub-step when occasion = "With food"
- Shareable, back-button-safe result via URL-encoded answers
- Unit tests (scoring, archetype resolution, URL codec) + browser verification

### OUT OF SCOPE (Phase 2 / other sessions)
- LLM-generated bespoke profile copy (config archetypes only at launch)
- An internal team-only scoring-breakdown view (shareable URL covers team use)
- The parallel **data enhancements** (§8) — the finder ships against today's data
- Rosé as a dedicated quiz path (demoted to a filter inside Wine — see §3)

### YAGNI — explicitly excluded
Per-session API calls, accounts, saving quiz history, A/B question variants.

---

## 2. Data Reality (verified against `data/live_products_export.json`, 11,436 products)

> **In-stock is the STRING `"1"`, not a boolean** (project memory: *is_in_stock is a
> STRING gotcha*). `is_in_stock` holds `"0"` / `"1"` / null; a truthiness check treats
> the OOS string `"0"` as in-stock and is **backwards**. All counts below and the §5
> pre-filter use `is_in_stock === "1"` (the catalog's `isInStock()` normalizer).

True **in-stock** counts and coverage **over the in-stock population** per finder
category (verified with the correct string check):

| Category | In-stock | `wine_body` | `taste_profile` | `flavor_tags` | `region` | `country` |
|---|---|---|---|---|---|---|
| Red Wine | 2,200 | 85% | 76% | 87% | ~100% | ~100% |
| White Wine | 744 | 86% | 80% | 89% | ~100% | ~100% |
| Sparkling & Champagne | 417 | 89% | 70% | 91% | ~100% | ~100% |
| Whisky | 253 | 22% | 62% | 87% | 100% | 100% |
| Gin | 99 | 71% | 78% | 82% | ~96% | — |
| Other Spirits | 244 | 20% | 48% | 76% | ~95% | ~95% |
| Sake & Asian | 272 | 7% | 71% | 74% | ~97% | — |
| ~~Rosé~~ | ~90 | **5%** | **0%** | 33% | ~100% | — |

**Read carefully:** coverage among true in-stock items is *higher* than the raw
catalog (e.g. 85% body on in-stock Red Wine), but the **pools are smaller** (Gin = 99,
not 207). Both facts shape the engine: deep-taste scoring is viable for wine, but the
**minimum-results guarantee (§5) will fire often** in the small/floor-tier-heavy
categories (Gin, Other Spirits, Sake). Still no hard-filter on a sparse attribute.

**Field-shape facts that drive the engine (verified):**
- `wine_body` is a **5-level ordinal string** — exactly these values:
  `Light · Medium-Light · Medium · Medium-Full · Full` (+ empty). NOT a free
  "light/bold" — scoring maps onto these exact strings with **ordinal distance**, not
  exact-match. The ladder index array in §5 has **5 entries**.
- `wine_acidity` / `wine_tannin`: same ordinal family (`Medium`, `Medium-High`,
  `High`, `Medium-Full`, `Light`, `Low`, …).
- `flavor_tags` is an **array but has 5,521 distinct values** (long-tail, messy) →
  **NOT usable as a chip source.**
- `taste_profile` is a dict (`{schema_version, structure:'tiered', tiers:{primary,
  secondary,tertiary}}`, each note `{note, intensity}`) with only **71 distinct
  canonical notes** (Minerality, Earth, Oak, Spice, Black Cherry…) → **this is the
  chip source.**
- Whisky **`country`** cleanly separates origin: Scotland 398 / USA 81 / Japan 80 /
  Ireland 31. Whisky **`region`** distinguishes style: **Islay (44)** = peat/smoke
  signal; Speyside (159)/Highland (88) = smooth. The `flavor_tags` "Smoke" tag appears
  on only **49/629** whiskies → **do NOT key smokiness on the tag; key it on
  `region`=Islay** (covers the peat signal far more reliably than the sparse tag).
- `food_matching` is a **comma-separated string** on 5,783 products (reused from the
  catalog recommender; split on `,` + trim).
- `is_in_stock`, `price`, `classification` present for ~100%.

**Implication:** 40–95% of items in some categories lack the deep fields a taste
question asks about. The engine **must score gracefully and never hard-filter on a
sparse attribute** (project Rules 3 & 9). See §5 scoring + minimum-results guarantee.

---

## 3. The Flow (config-driven, adaptive)

```
STEP 1  Category        (always)
        Red · White · Sparkling & Champagne · Whisky · Gin · Other Spirits · Sake & Asian
        (Rosé demoted to a one-click filter inside Wine — 5% body data, too thin to quiz)

STEP 2  Occasion        (shared)  Everyday · With food · Gift · Special/cellar · Just exploring
        └─ if "With food":  CONDITIONAL  "What are you eating?"  (optional, chips)
                            red meat · seafood · cheese · spicy · poultry · dessert …
STEP 3  Budget          (shared)  <฿1k · ฿1–3k · ฿3–7k · ฿7–15k · ฿15k+  (reuses catalog brackets)
STEP 4  Taste axis 1    (adaptive — table below)
STEP 5  Taste axis 2    (adaptive — table below)
STEP 6  Flavor leanings (optional)  chips from the 71 canonical taste_profile notes, scoped to category

      →  /finder/result   :  Style profile (top)  +  matched products (below)

Every step: progress bar · Back button · a "No preference / Surprise me" choice that
contributes 0 to scoring (neither filters nor scores) — nothing ever dead-ends.
Steps are declared per-category in config; thin categories declare fewer (min 3).
```

### The `Answers` contract (consumed by §5 scoring, §6 archetypes, §7 result, §8 codec)

This is the single shared contract every downstream piece depends on. Defined once in
`lib/finder/answers.ts`:

```ts
type FinderCategory =
  'red' | 'white' | 'sparkling' | 'whisky' | 'gin' | 'spirits' | 'sake';
type Budget = 0 | 1 | 2 | 3 | 4;     // <฿1k · ฿1–3k · ฿3–7k · ฿7–15k · ฿15k+
type Occasion = 'everyday' | 'food' | 'gift' | 'special' | 'exploring';

interface Answers {
  category: FinderCategory;          // STEP 1 (required)
  occasion?: Occasion;               // STEP 2
  food?: string[];                   // conditional sub-step (occasion==='food')
  budget?: Budget;                   // STEP 3
  axis1?: string;                    // STEP 4 — category-specific token (see config)
  axis2?: string;                    // STEP 5 — category-specific token
  flavorChips?: string[];            // STEP 6 — canonical taste_profile notes (≤5)
}
// Any unset / "No preference" field is `undefined` and contributes 0 (§5).
```

`axis1`/`axis2` carry **opaque tokens** the per-category config defines (e.g. red
`axis1 ∈ {light,medium,bold}`, whisky `axis1 ∈ {scotch,japanese,bourbon,irish,world}`).
`question-config.ts` owns the token→option mapping AND the token→scoring mapping, so
§5 never hard-codes per-category strings.

### Adaptive axes per category (verified data signals)

The three wine categories (**red, white, sparkling**) are **separate config entries**
that **share one axis-definition template** (body + acidity/fruit). They are not one
category — listed together below only because their axes are identical in shape.

| Category | Step 4 | Step 5 | Primary signal | Notes |
|---|---|---|---|---|
| Red / White / Sparkling (3 entries) | Body `Light→Full` (ordinal) | Acidity / Fruit→Earthy | `wine_body`, `wine_acidity`, `taste_profile` | scores, never filters |
| **Whisky** | **Origin** Scotch/Japanese/Bourbon/Irish/World | **Smoky→Smooth** (Islay vs Speyside/Highland) | `country` + `region` | NOT `wine_body`, NOT "Smoke" tag |
| Gin | Classic/London Dry → Contemporary/botanical | (origin, optional) | `flavor_tags` + `region` | 48% taste coverage |
| Other Spirits | Pick spirit type (Vodka/Rum/Tequila/Brandy/Mezcal…) | Origin/style | `classification` + `country` | floor-tier heavy |
| Sake & Asian | Style (Sake/Shochu/Umeshu) | Dry → Sweet | `classification` + `taste_profile` | floor-tier heavy |

---

## 4. Architecture & File Layout

```
apps/catalog/
├── app/finder/
│   ├── page.tsx              /finder        intro + Step 1 (category)
│   ├── [step]/page.tsx       /finder/2..6   adaptive question steps
│   └── result/page.tsx       /finder/result style profile + matched products
├── lib/finder/
│   ├── question-config.ts    per-category question definitions (the adaptive engine's data)
│   ├── style-profiles.ts     curated archetype library (the reusable team artifact)
│   ├── scoring.ts            pure scoreProducts(answers, products) → ranked[]  (unit-tested)
│   └── answers.ts            URL <-> answers codec (shareable, back-safe state)
├── lib/recommender.ts        (catalog's existing recommender — reused for "more like this")
└── components/finder/
    ├── StepShell.tsx         progress bar + Back + "No preference" affordance
    ├── ChoiceCards.tsx       big tap targets (≥44px — accessibility, 40+ audience)
    └── StyleResult.tsx       archetype card + matched-product grid
```

**Principles**
- **Data-driven engine:** `question-config.ts` declares each category's steps/options.
  Adding or tuning a category is a config edit, not new control flow.
- **Pure scoring:** `scoring.ts` takes answers + product list, returns a ranked list.
  No I/O, no React — unit-testable in isolation.
- **Reuses the catalog's safety rails:** every product shown passes through the
  catalog's `toPublicProduct` allowlist (no margin/B2B leak — catalog spec §4.1).

---

## 5. Scoring Engine (the core)

`scoreProducts(answers, products) → ranked[]` — pure, additive, tiered.

```
PRE-FILTER (hard, safe):  classification ∈ chosen-category's class set  AND  in-stock  AND  in budget tier
   • category membership uses the catalog's group→classification map (lib/category-groups.ts),
     NOT raw equality — classification has 44 messy values (Whisky vs Whiskey, pipe-delimited
     "Red Wine|Fruit Wine", etc.). The finder defines a FinderCategory→classifications[] map
     that reuses/extends that catalog map; pipe-delimited values are split and matched on any part.
     Raw-equality here would dead-end on exactly those messy rows.
   • in-stock = is_in_stock === "1" (string — isInStock() normalizer; "0"/null are OOS).
   • budget is a coarse bracket the user chose — safe to filter.

TIER 1 — deep taste (highest weight; MISSING attribute = 0, never filters)
  Body axis      ordinal ladder over [Light, Medium-Light, Medium, Medium-Full, Full]:
                 exact +4 · ±1 step +2 · ±2 steps +1 · else/missing 0
  Acidity/Tannin same ordinal ladder: exact +3 · ±1 +1 · missing 0
  Flavor chips   +2 per canonical taste_profile note matched
                 (also fuzzy-map the product's flavor_tags into the 71-note set)

TIER 2 — origin / varietal
  country match +2 · region match +2 · grape_variety match +2 · classification refine +1

TIER 3 — floor / context (always available)
  occasion weighting:  gift/special → +2 if score_summary present (critic-rated)
                       everyday → +1 if in lower budget tiers (value lean)
  food_matching overlap (when food step answered): +1 per shared item
                       (split food_matching on ',' + trim — same as catalog recommender)

RANK:    sort by score desc, tie-break by score_summary present then price asc
DEDUPE:  by sku
GUARANTEE (minimum results): if fewer than 4 products clear a minimum quality score,
         relax to TIER-3 floor only and label the rail honestly:
         "Closest matches in your budget." → NEVER returns an empty result.
```

**Ordinal ladder is mandatory, not exact-match** — because the real vocabularies are
`Medium-Full`, `Medium-High`, etc. Exact-match would discard near-matches and starve
results. The ladder is defined as an index array per scale field in `scoring.ts`.

**"No preference / Surprise me"** on any step sets that answer to null → the
corresponding scoring block is skipped (adds 0). It neither filters nor scores.

---

## 6. Style Profiles (the reusable artifact)

`style-profiles.ts` — curated archetype library, deterministic resolution.

```ts
interface StyleProfile {
  id: string;                       // 'bold-structured-red'
  category: FinderCategory;
  name: string;                     // 'The Bold & Structured Red'
  tagline: string;                  // one line
  expertNote: string;               // 2–3 sentences, sommelier voice
  definingAttributes: {
    body?: string; acidity?: string; tannin?: string;
    typicalGrapes?: string[]; typicalRegions?: string[];
  };
  foodGuidance: string;             // 'Red meat, aged hard cheese'
  occasionFit: string[];            // ['dinner','special']
  match: (answers: Answers) => number;  // deterministic score; highest wins
}
```

- ~3–5 archetypes per category (~30 total), hand-authored, team-editable.
- The user's answers resolve to the **single highest-scoring archetype** (deterministic
  → unit-testable). The archetype's `definingAttributes` also **seed the product
  scoring** so the profile and the products below it are consistent.
- This file *is* the team artifact: readable, reusable for marketing/segmentation.
- **Phase-2 hook:** an optional LLM pass could later rewrite `expertNote` per session;
  the archetype resolution stays the deterministic spine. Not built now.

---

## 7. Result Page, Sharing, Errors

- **Result page** reads the `Answers` object from the query string. **URL schema**
  (owned by `answers.ts`, one param per `Answers` field, lossless round-trip):

  | Param | From | Encoding |
  |---|---|---|
  | `cat` | `category` (required) | one token: `red\|white\|sparkling\|whisky\|gin\|spirits\|sake` |
  | `occ` | `occasion` | one token: `everyday\|food\|gift\|special\|exploring` |
  | `food` | `food[]` | comma-joined tokens, URL-encoded (e.g. `food=redmeat,cheese`) |
  | `b` | `budget` | single digit `0..4` |
  | `a1` | `axis1` | one config token |
  | `a2` | `axis2` | one config token |
  | `fl` | `flavorChips[]` | comma-joined canonical-note slugs (≤5) |

  Example: `/finder/result?cat=red&occ=food&food=redmeat,cheese&b=2&a1=bold&a2=earthy&fl=oak,leather`.
  `decodeAnswers(searchParams) → Answers` and `encodeAnswers(Answers) → string` are
  inverse; unknown params ignored, malformed values dropped to `undefined` (degrade,
  never throw). Result page: archetype card on top (name · expert note · defining
  attributes · food/occasion), matched-product grid below (catalog cards + quick-view),
  then "Refine answers" / "Start over".
- **Shareable / back-safe:** the URL fully encodes `Answers` (round-trip tested, §9).
  A team member runs it and sends the link; the customer sees the same result.
- **Error handling (catalog Rule 9 pattern):** invalid/partial params → fall back to
  the floor tier or redirect to `/finder`; a missing field hides its block; the page
  never crashes and the result rail is never empty (guarantee, §5).

---

## 8. Parallel Data-Enhancement Plan (separate session — NOT in this build)

The finder ships against **today's** data; these sharpen results later and run in a
**parallel session**. The UI needs **zero changes** after each lands — just a rebuild
(catalog Rule 9: refresh `live_products_export.json`). Priority order:

| # | Enhancement | Field(s) | Today | Finder impact | Cost class | Gate |
|---|---|---|---|---|---|---|
| **P4** | Normalize `flavor_tags` → canonical 71-note set | `flavor_tags` | 5,521 messy | Clean flavor matching across both fields | **Rule-based, no API** | **Safe to start now, in parallel** |
| **P1** | Backfill body/acidity/tannin on wines | `wine_body`,`wine_acidity`,`wine_tannin` | ~55% wines | Powers Steps 4–5 for the 3 biggest categories — **highest leverage** | Paid LLM | **Rule 10 pre-flight** (backup → 5-SKU canary → cost estimate → user sign-off → verify in export) |
| **P2** | Backfill `taste_profile` notes on wines | `taste_profile` | 49% wines | Powers Step-6 chips + flavor scoring | Paid LLM | Rule 10 pre-flight |
| **P3** | Derive `spirit_style` tag (Peated/Sherried/Bourbon-cask…) | *new field* | 0% | Lets whisky/spirits quiz as richly as wine | Mostly rule-based + light LLM | Canary if any API |

**Sequencing recommendation:** start **P4** now (no cost, pure win); queue **P1** as the
first paid run *after* its canary and your sign-off. P1/P2/P5-class paid runs MUST NOT
be launched in parallel without the Rule 10 gate. (P5 — backfill `food_matching` — is a
lower-priority paid item supporting the food step; listed for completeness.)

---

## 9. Testing (per project rules)

- **Unit — `scoring.ts`:** ordinal-ladder distances correct (5-level body ladder);
  **minimum-4 guarantee** holds on a starved query (assert against a small category
  like Gin); **only in-stock returned — assert `is_in_stock === "1"`** explicitly
  (a truthy check would pass while shipping OOS `"0"` rows — the string gotcha);
  no duplicate skus; "No preference"/`undefined` answer contributes 0; pre-filter
  category membership matches via the group→classification map, not raw equality.
- **Unit — `style-profiles.ts`:** archetype resolution is deterministic for a given
  answer set; every category has ≥1 reachable archetype.
- **Unit — `answers.ts`:** URL ⇄ answers round-trip is lossless; partial/invalid params
  degrade safely.
- **Data invariant (Rule 6):** every product the finder returns passes through
  `toPublicProduct` — **no margin/B2B field ever appears** in a finder response.
- **Browser verification (Rule 7 — mandatory before "done"):** dev server up; walk
  **all 8 categories** end-to-end (including a "No preference" path and a "With food"
  path) to a **non-empty** result — all **7 categories** (Red, White, Sparkling &
  Champagne, Whisky, Gin, Other Spirits, Sake & Asian); confirm the style card +
  product grid render and the result URL is shareable/back-safe. "It compiles" is
  not done.

---

## 10. Open Items / Phase 2
- LLM-rewritten `expertNote` per session (archetype spine stays deterministic).
- Internal scoring-breakdown view for the team (if the shareable URL proves insufficient).
- Saving / emailing a finder result (ties into the catalog's Phase-2 cart/order flow).
- Data enhancements P1–P5 (§8) landing and re-rendering the finder via rebuild.
```
