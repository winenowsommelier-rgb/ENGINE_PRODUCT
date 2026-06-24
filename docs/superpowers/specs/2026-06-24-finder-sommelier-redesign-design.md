# Find Your Match — Sommelier-Guided Redesign (Design Spec)

**Date:** 2026-06-24
**Status:** Design — awaiting spec review → user review → writing-plans
**Surface:** `apps/catalog` Product Finder (`app/finder/*`, `lib/finder/*`)
**Builds on:** existing finder (category-dynamic quiz + `STYLE_PROFILES` archetype library + `scoring.ts`)

---

## 1. Problem & Goal

The finder today asks **specification-style** questions ("How much tannin?", "Dry or
sweet?", "Junmai or Ginjo?"). A novice doesn't know those terms, so they either bounce
or answer randomly — and the result feels arbitrary. Meanwhile thin categories
(gin/spirits/sake) collapse to 3 generic steps, and some categories borrow the wrong
axes (sparkling uses red-wine body; whisky peat is a region guess).

**Goal:** make the finder behave like a **professional sommelier / shop expert** who
guides a non-expert to the right bottle by asking about the *moment, food, and taste in
plain language*, translating that to technical style behind the scenes, and presenting a
**result that visibly proves the match**. Educated/premium users can opt into an expert
refine where the technical axes live.

**Non-goals:** new browse surface (this is the finder, upgraded); paid enrichment in v1
(deferred — see §8); changing `/shop`.

---

## 2. The Two-Layer Model

### Layer 1 — Default journey (everyone; novice-first; ZERO jargon)
4–6 plain-language questions about moment, food, taste-in-feelings, adventurousness,
budget. Identical *shape* across categories; the wording adapts. Behind the scenes a
pure **"sommelier brain"** maps answers → that category's technical axes → one named
**archetype** from `STYLE_PROFILES`.

Critical: Layer 1 NEVER shows the words tannin / dosage / junmai / VSOP / peat. It shows
feelings: *"smooth & easy", "bold & rich", "fresh & zingy", "not sure — guide me."*

### Layer 2 — "Refine like a sommelier" (opt-in; premium / curious)
A single "Go deeper" affordance reveals the **technical axes** (all the per-category
detail in §5). Every step is optional and carries a one-line *"what's this?"* explainer
(the education/moat layer). Refine answers feed the SAME scoring; they sharpen, never
replace, the Layer-1 result.

### The Result — the hero (same for both paths)
Named archetype + **"Why this fits YOU"** in plain language echoing the user's actual
answers + the expert profile (gauges/region/grapes) + 3 real bottles each with a **fit
%**. Accuracy is *shown*, not asserted.

```
Layer 1 (plain Qs) ──┐
                     ├─► sommelier brain ─► archetype + scored bottles ─► RESULT (hero)
Layer 2 (refine) ────┘            ▲
                                  └── reads STRUCTURED fields (see §6 data contract)
```

---

## 3. Architecture (build on what exists)

| Concern | Today | Change |
|---|---|---|
| Question config | `lib/finder/question-config.ts` (`stepsFor` + `deepDiveStepsFor`) | Rewrite Layer-1 steps to plain language; move technical steps into Layer-2 (`deepDiveStepsFor` already is the opt-in branch — repurpose). |
| Answer model | `lib/finder/answers.ts` | Add plain-language fields (e.g. `tasteFeel`, `foodPairing`) + keep technical fields for Layer 2. |
| Sommelier brain | `lib/finder/style-profiles.ts` (`STYLE_PROFILES`, **17 archetypes**: red×3, white×3, sparkling×2, whisky×4, gin×2, spirits×2, sake×2) + `scoring.ts` | EXTEND archetypes (Rosé, spirits sub-types, sake class); add a plain-answer→archetype resolver; keep deterministic `match()`. |
| Scoring | `lib/finder/scoring.ts` | Fix data wiring (§6): peat off real `smokiness`, drop reliance on sparse fields; add "why it matched" reason strings. |
| Result page | `app/finder/result/page.tsx`, `components/finder/StyleResult.tsx` | Rebuild as the hero: archetype + plain "why" + gauges + fit-scored bottles. |

All `lib/finder/*` is pure data + pure functions (no I/O, no React) and already unit-tested
— keep that property; every mapping is table-driven and testable.

---

## 4. Layer-1 question template (shared shape, per-category wording)

Every category's default journey is built from these slots (skip slots that don't apply):

1. **Moment** — everyday / with food / gift / special / just exploring *(shared)*
2. **Food** — what are you eating? (chips: steak, seafood, cheese, spicy, dessert, just sipping) *(drives food-pairing scoring + archetype)*
3. **Taste feel** — the core plain-language axis, worded per category (see §5). Always includes **"Not sure — guide me"** (→ neutral, lets food+moment drive).
4. **Adventurousness** — a classic / a little twist / surprise me *(shared)*
5. **Budget** *(shared)*

Plain "taste feel" tokens map to technical axes by category in the brain. No category
shows more than ~5 default questions.

---

## 5. Per-category design (Layer 1 plain → brain mapping → Layer 2 refine → archetypes)

> Coverage notes are IN-STOCK counts verified 2026-06-24. "Refine" axes only included
> where data supports them; weak axes are toggles or deferred (§8).

### 5.1 Red wine *(strongest data: tannin 2166, body/acidity/variety ~99%)*
- **Layer 1 taste-feel:** "How do you like your reds?" → *Smooth & easy · Balanced & juicy · Bold & rich · Not sure*.
- **Brain mapping:** smooth→Light body/Low tannin · balanced→Medium · bold→Full/Med-High tannin. Food (steak→bold, salmon→light) nudges. → archetypes: Bright & Elegant / Supple Everyday / Bold & Structured.
- **Layer 2 refine:** Acidity · Tannin (firm↔silky) · Red grape · Age · Adventure.

### 5.2 White wine *(acidity/body/variety ~99%; sweetness 94% but 86% Dry)*
- **Layer 1 taste-feel:** "What sounds good?" → *Crisp & refreshing · Smooth & rounded · Rich & creamy · Not sure*.
- **Brain:** crisp→High acidity/Light · rounded→Medium · rich→Full/oak. → Crisp & Zesty / Aromatic & Balanced / Rich & Textured.
- **Layer 2 refine:** White grape · Sweetness (*"find an off-dry/sweet one"* — demoted, it's the minority) · Age.

### 5.3 Rosé *(NEW; 182 in-stock, full taste data)*
- **Layer 1:** Moment → Food → "Crisp & dry or fruity & soft?" → Flavours.
- **Brain:** dry→Provence-style (Dry, High acidity) · fruity→New-World (Off-Dry). → NEW archetypes: *The Crisp Dry Rosé* · *The Fruity Easy Rosé*.
- **Layer 2 refine:** Body.

### 5.4 Sparkling *(dosage 395 pop but 86% Brut)*
- **Layer 1 taste-feel:** "What's the vibe?" → *Light & fun (Prosecco-style) · Fine & classic (Champagne-style) · Not sure*.
- **Brain:** style/method leads (origin + `category_type`), dosage as nudge. → Fresh & Festive / Fine Traditional-Method.
- **Layer 2 refine:** Dosage (Brut→Demi-Sec) · Grape · Vintage/NV.

### 5.5 Whisky *(region Speyside96/Islay27 & age164 strong; smokiness 408 but 93% "none")*
- **Layer 1 taste-feel:** "What's your style?" → *Smooth & mellow · Rich & warming · Smoky · Not sure*. (Smoky is a feel, not a level.)
- **Brain:** smooth→unpeated/Speyside/Irish · rich→Bourbon/sherried · smoky→`smokiness='heavy'` (the real 30). Origin question stays (Scotch/Japanese/Bourbon/Irish/World — clean). → Peated & Coastal / Refined Japanese / Sweet & Bold Bourbon / Smooth Irish.
- **Layer 2 refine:** Peaty? (binary toggle, real `smokiness`) · Cask (text-match sherry/bourbon/port) · Age · Region.

### 5.6 Gin *(305; flavor_tags 166, body 120)*
- **Layer 1 taste-feel:** "Classic or modern?" → *Classic & junipery · Modern & aromatic · Not sure* + "How will you drink it?" (G&T / Martini / Negroni / sipping).
- **Brain:** classic→London Dry · modern→contemporary botanical; serve nudges style. → Classic London Dry / Contemporary Botanical.
- **Layer 2 refine:** Botanical leaning (citrus/floral/herbal/spice via flavor_tags).

### 5.7 Spirits — branch by type *(Rum114, Tequila101, Vodka76, Brandy68, Cognac15)*
- **Layer 1:** "What kind?" (type) → then ONE plain type-specific feel:
  - Rum → *light & mixable · dark & aged · spiced* (age/grade markers strong in text: 96/114)
  - Tequila → *bright (blanco) · smooth (reposado) · sipping (añejo)* (88/101)
  - Brandy/Cognac → *easy · premium (VSOP) · luxury (XO)* (Cognac 14/15)
  - Vodka → *neutral · flavoured*
- **Brain:** maps the feel to type-specific text/grade markers. → Clean & Versatile Vodka / Warm Aged Spirit (+ add per-type archetypes).
- **Layer 2 refine:** Age/grade (reposado/VSOP/XO) · Adventure.

### 5.8 Sake & Asian *(sub-type clean: Sake/Shochu/Umeshu; class 286 in text; sweetness only 69 → deferred)*
- **Layer 1:** "What are you after?" → sub-type (rice sake / shochu / plum umeshu) → "Light & delicate or rich & full?" (maps to class signal, plain).
- **Brain:** delicate→Ginjo/Daiginjo (text) · rich→Junmai/Honjozo; umeshu→sweet archetype. → Crisp & Dry / Fragrant & Fruity (+ class-aware).
- **Layer 2 refine:** Serve (chilled/warm) · **Dry↔Sweet KEPT as an opt-in refine only**
  (see §6.2 — it removes from the Layer-1 default but preserves the existing scoring path).
- **Deferred (§8):** sweetness + SMV become a real *Layer-1* axis after paid enrichment.

---

## 6. Data contract & scoring fixes (the "accuracy" backbone)

The result is only as credible as the fields the brain reads. Fixes required:

1. **Whisky peat:** score off `smokiness` (real, 408 in-stock) — NOT `region==Islay`
   (current `peatScore()` keys on `norm(region)==='islay'`). **VERIFIED buildable
   2026-06-24:** `smokiness` is in `EXPORT_COLS` (refresh_live_export.py:57), in the
   `PublicProduct` type (`lib/types.ts:60`), and present on all 847 whisky export rows.
   Binary in v1 (none vs heavy); graded after enrichment.
2. **Sake sweetness — RESOLVE the conflict with shipped code, do NOT silently delete.**
   `scoring.ts` ALREADY scores sake on `taste_profile.axes.sweetness.value` via
   `sakeSweetness()` (lines 33-43) + `SWEETNESS_TARGET` (line 31), keyed by `axis1`
   ('dry'/'sweet'); the `crisp-dry-sake`/`fragrant-sweet-sake` archetypes `match()` on
   that same `axis1`. This path is sparse (~74% return null) but already degrades
   gracefully (null → 0 neutral). **Decision:** remove Dry↔Sweet from the **Layer-1
   default** (a novice can't answer it and it's mostly blank), but **KEEP the existing
   `sakeSweetness()` scoring + the two archetypes, reachable via the Layer-2 refine**
   (`axis1` is written only when the user opts into the refine). Net: no orphaned code,
   no lost archetypes; sake's Layer-1 leads on sub-type + class. (NOTE for §6.3: this
   nested `taste_profile.axes.sweetness` is a DIFFERENT field from the flat `sweetness`
   column the product-page gauge uses — do not conflate them.)
3. **`variety` is base-material/class, NOT grape** (per taste-audit memo). The grape
   refine must read variety cautiously: it holds grape for wine but base material for
   spirits. Gate grape steps to wine categories only.
4. **Legacy un-audited values exist in the export** (Extra-Dry→Dry inversion ~56
   sparkling; smokiness false-negatives e.g. Talisker/Ledaig tagged "none"). The brain
   must not over-trust sparse/legacy fields; the taste-data audit (separate spec) is the
   upstream fix. v1 design degrades gracefully (missing/legacy value → neutral score).
5. **`scoring.ts` `ginStyleBump` (line ~266) joins `classification` into its text blob**
   — Rule 12 says classification is a useless TYPE dupe. Replace with name/desc only in
   that function (low risk but fix). NOTE: the spirits *type* map already reads
   `category_type` via `typeForProduct` (Rule-12-clean) — the old `SPIRITS_TYPE_TO_CLASS`
   offender in CLAUDE.md/memory was ALREADY migrated; do not "re-fix" it.
6. **"Why it matched" reasons:** scoring emits, per result, the 1–2 strongest contributing
   signals as plain strings (e.g. "matches your "bold & rich" + steak") for the result card.

---

## 7. The Result page (hero) — `StyleResult.tsx`

Renders, for the resolved archetype:
- **Name + tagline** (e.g. "The Bold & Structured Red").
- **"Why this fits you"** — generated from the user's actual Layer-1 answers + the
  archetype's `expertNote`/`foodGuidance`. Plain language, second person.
- **Expert profile** — gauges (body/acidity/tannin or category-appropriate), typical
  grapes/regions from `definingAttributes`.
- **3 matching bottles**, each with a **fit %** (normalized score) + its own one-line "why".
- **"Refine like a sommelier"** CTA (enters Layer 2 and re-resolves).
- Educated users who used Layer 2 see the same card, enriched with their chosen axes.

---

## 8. Deferred — paid enrichment fast-follow (separate Rule-10 gated effort)

Ranked by finder impact. NOT in v1. Logged so v1 designs the gaps as "coming soon", not
silently broken:
1. **Sake sweetness + SMV / 日本酒度** (biggest gap; unlocks a real sake taste axis).
2. **Graded whisky smokiness** (none→light→heavy; today binary).
3. **Structured cask/finish + age-statement fields** (whisky; today prose-only).
4. **Spirits age-grade field** (reposado/VSOP/XO; today text-match).

---

## 9. Testing

- Pure-function unit tests for every brain mapping (plain token → axis → archetype),
  extending the existing `lib/finder/__tests__/*`.
- A **coverage test** per category: every Layer-1 answer combination resolves to a real
  archetype with ≥1 in-stock bottle (no dead ends) — analogous to existing
  `chip-coverage.test.ts`.
- A **no-jargon test**: Layer-1 option labels contain none of a banned-term list
  (tannin/dosage/junmai/VSOP/peat/acidity…).
- Scoring regression: peat scores off `smokiness`; grape gated to wine; classification
  not read for flavour.
- **Rule 7 browser verification:** run each category end-to-end in the dev catalog
  (port 3100) — novice path + refine path + result renders with bottles + fit %.

---

## 10. Open questions for plan stage
- Exact archetype set to ADD (spirits per-type, sake class-aware) — enumerate in plan.
- Fit-% normalization formula — but see §11.9: ship **banded labels**, not a raw %.
- Whether "Refine" re-runs from scratch or layers onto Layer-1 answers (proposed: layers on).

---

## 11. Expert-review corrections (3-lens panel, 2026-06-24 — OVERRIDES earlier items)

A sommelier + product/UX + data-engineering panel reviewed §1–10. Findings below are
**verified against the live export** and **supersede** the conflicting earlier text.

### Must-fix — wrong recommendations (taste logic / dead data)

**11.1 Red taste-feel is mis-mapped — decouple body from tannin (overrides §5.1).**
"Smooth & easy → Light body / Low tannin" is backwards: *smooth* = soft tannin, **medium-
full** body (Merlot/Grenache/ripe New-World) = the *Supple Everyday* archetype — NOT the
light, high-acid *Bright & Elegant* Pinot. Re-cut the three plain rungs as body-and-grip
ascending, each to its correct archetype:
- **"Light & delicate"** → Bright & Elegant (Light body, High acidity, Low tannin; Pinot/Gamay)
- **"Smooth & easygoing"** → Supple Everyday (Medium-Full body, **soft** tannin, fruit-forward)
- **"Bold & rich"** → Bold & Structured (Full body, Med-High tannin)
Body and tannin are SEPARATE axes in the brain; never collapse them. Resolver must NOT
intersect Light-body AND Low-tannin (only 10 in-stock reds are Low tannin → near dead end);
map the feel to body primarily, tannin as a soft nudge.

**11.2 Sake Layer-1 re-led on aroma + serve, not grade-as-body (overrides §5.8).**
"delicate→Ginjo, rich→Junmai" conflates *polishing grade* (aroma/refinement) with body and
is partly reversed. Lead sake Layer-1 on the two axes a novice can actually answer and the
data supports:
- **Aroma:** *"Fragrant & fruity"* (ginjo/daiginjo) vs *"Clean & rice-driven"* (junmai/honjozo)
- **Serve temperature:** *chilled* vs *warm* — PROMOTE from Layer-2 to Layer-1 (the single
  most useful novice sake question; delicate ginjo=chilled, robust junmai/honjozo=can warm).
Read grade from the **structured `variety` field** (see 11.4), not a fabricated light/rich.

**11.3 Rosé must NOT lead on sweetness — it's 0/95 populated (overrides §5.3). VERIFIED.**
Every in-stock rosé has `sweetness=NULL`; acidity & body are 91/95. The "dry ↔ fruity"
question maps to a dead field → "fruity & soft" returns **zero bottles**. Re-lead rosé on
**body/acidity** (*"crisp & light"* vs *"soft & rounded"*) + flavour chips. Drop the
sweetness axis until enriched (§8).

**11.4 Sake class = read structured `variety`, NOT text-match (overrides §5.8/§6.2). VERIFIED.**
`variety` already holds the class for 266/315 in-stock sake (Junmai Ginjo 78, Junmai 70,
Junmai Daiginjo 48, Honjozo 27, Daiginjo 11…). Text-matching the blob has a substring bug
(`ginjo` ⊂ `daiginjo`) and false-tags umeshu. The brain reads `variety` for sake class.

### Must-fix — conversion path (product)

**11.5 Add an explicit BUY path to the result (gap in §7).** Each of the 3 bottles needs a
primary **Add-to-Cart / Buy** affordance; the result's primary CTA is purchase, not
"Refine." Without it the conversion moment is undefined.

**11.6 Cross-category entry for true novices (gap in §3/§4).** Category-first (§5 assumes
red/white/whisky chosen) excludes the novice who says "something nice for dinner." Add a
Q0 path: *moment + food → suggest a category* (or "help me choose"). Category-first stays
available for users who self-segment.

**11.7 Design the all-neutral ("not sure" on everything) path (gap in §4).** Define an
explicit per-category **"crowd-pleaser" archetype** + an honest "why" ("a popular, easy
choice most people enjoy") for when every taste signal is neutral. Never render a specific
"Why this fits YOU" taste claim that the data did not actually drive (honesty guard).

### Important — accuracy & graceful degradation

**11.8 Whisky smokiness has FALSE-NEGATIVES on flagship peated drams (refines §6.1+§6.4).
VERIFIED:** Talisker 10/14/8 = `none`, Ledaig (Batch 4 / Provenance) = `none` — all
genuinely smoky. The binary "smoky" toggle will WRONGLY exclude icons and mis-file them as
"smooth." v1 mitigation: treat smokiness as a *positive-only* signal ("heavy" → boost smoky
intent) and DO NOT use `none` to actively exclude from smoky or assert "smooth"; pair with a
name allow-list for known peated distilleries (Talisker/Ledaig/Laphroaig/Ardbeg/Lagavulin).
Full fix = graded re-enrichment (§8.2). Also: whisky `region` is cross-contaminated
(Ledaig tagged region "Talisker"; a Talisker tagged "Islay") — never fall back to region.

**11.9 Fit % → banded labels, not a raw number (overrides §7/§10).** A precise % on sparse/
legacy data invites scrutiny the data can't survive (and a 58% top-match reads as "bad").
Show **bands** ("Great match / Strong match / Good match") with a defined floor; never show
a band driven entirely by neutral answers as "Great."

**11.10 Sparkling Extra-Dry inversion is 84 rows, not ~56 (corrects §6.4). VERIFIED scale.**
"Extra Dry" (off-dry) and "Extra Brut" (driest) both collapse to `sweetness="Dry"`. The
dosage refine must not over-trust this field; treat it as coarse until audited.

**11.11 Re-baseline ALL §5 coverage numbers to IN-STOCK before the §9 coverage test.**
Several §5 counts are TOTAL not in-stock (Gin 305→**169**, Rosé 182→**95**), overstating
depth. The finder filters to in-stock; the coverage test must assert ≥3 in-stock bottles
per plausible answer using in-stock numbers.

### Scope — phase the build (product YAGNI; sequence, don't drop)

**11.12 Ship in two phases to validate the loop before scaling 8×.**
- **Phase 1 (prove the funnel):** red, white, whisky (strongest data) — full Layer-1 plain
  journey + corrected mappings + result with BUY path + all-neutral handling + banded fit.
  This proves novice→result→cart converts.
- **Phase 2 (scale the model):** rosé, sparkling, gin, spirits-by-type, sake + the Layer-2
  "Refine like a sommelier" + per-bottle reason strings. Builds on a proven core.
Layer-2 refine and per-bottle `why` strings (§6.6) are Phase 2 — not on the novice path.

### Smaller expert notes (apply in plan)
- Tequila plain labels: blanco="crisp & agave-forward" (not "bright"); add a **serve cue**
  (margarita/cocktail→blanco/reposado; sipping→añejo). Same serve-cue pattern for gin
  (Negroni→classic/bolder, not floral).
- Sparkling: don't imply Prosecco = low quality; the real novice axis is dry-vs-soft, and
  the sweet-sparkling (Asti/Moscato) buyer currently has no distinct archetype (honest gap).
- White: "smooth & rounded" should lean Viognier/Chenin/oaked-Chardonnay, not steely dry
  Riesling (high-acid/off-dry surprises the rounded-seeker).
- Food chips must be **category-scoped** (salmon→light red OR rounded white, never "bold").

### Language (gap)
**11.13** Confirm Layer-1 copy language (Thai / EN / both) at plan stage — "plain language"
for a Thai mobile audience is undermined if it ships EN-only. Also add: progress indicator,
edit-an-answer without restart, "see more like this" → /shop, and a shareable result URL
(LINE/WhatsApp). Out-of-stock/empty-state fallback on the result is required, not optional.

---

## 12. LOCKED decisions (user sign-off 2026-06-24 — drive the plan)

- **Phasing:** Build **Phase 1 = Red + White + Whisky** (≥99% data coverage) to prove the
  novice→result→cart loop end-to-end. Structure every question/archetype/mapping as DATA
  (config tables) so **Phase 2 (rosé, sparkling, gin, spirits-by-type, sake + Layer-2
  refine) is purely additive** — drop in a category config, no rewrite.
- **Language:** **English-first, with inline Thai labels** where the existing finder copy
  already carries them (`question-config.ts` already has Thai). Do NOT build an i18n
  framework (separate project; YAGNI here). Keep all copy in the config so a future
  translation pass touches one place.
- **Conversion essentials are IN Phase 1** (not deferred): Add-to-Cart on each result
  bottle, cross-category entry for novices, all-neutral "crowd-pleaser" path, banded match
  labels (not raw %), out-of-stock/empty-state fallback, edit-an-answer, progress
  indicator, "see more like this" → /shop.
- **Process:** proceed through writing-plans → implement Phase 1 → Rule-7 browser
  verification → code review → ship, iterating to a verified working result.
