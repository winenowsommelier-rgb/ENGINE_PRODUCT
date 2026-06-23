# Phase B Run 2 — Trustworthy Taste Display (Peat Badge + Scoped Sweetness)

**Date:** 2026-06-23
**Status:** Design v2 (RESHAPED after sommelier + data-quality expert review) — pending
re-review + user approval, then writing-plans.
**Predecessor:** Phase B Run 1 SHIPPED (PR #37/#43). Phase A produced the taste data.

---

## 1. Problem & Goal

Phase A populated `smokiness` (1,970), `sweetness` (279), `body`; `finish`/`intensity` are 0.
None of smokiness/sweetness/finish/intensity is displayed on the product page today.

**v1 of this spec proposed four flat AttrRows. Two expert reviews (Master Sommelier + data
quality) rejected it. Verified against the DB, both were right:**

- **finish/intensity = 0/11,436** — empty. Wiring display rows for them is dead UI
  (spend-without-shipping, Rule 1/4, from the render side). **CUT.**
- **smokiness data has false positives** (verified counts): of 69 `heavy`, **4 are gins**
  (The Botanist Islay Gin — Islay *gin* ≠ peated whisky), **15 are region-only** with no peat
  name cue (unverified; includes Old Pulteney 1989, an unpeated Highland malt with a wrong
  "Islay" region cell). Only **54 are name-cue verified** (Laphroaig/Ardbeg/Lagavulin/peated…).
- **sweetness data is ~66% wrong**: of 194 `dry`, **64 are "Dry Gin"** (a production STYLE name,
  not sweetness), **58 are sparkling "Extra Dry"** (semantically INVERTED — Extra Dry is
  *sweeter* than Brut), **7 Dry Vermouth**. Only ~27 are true sake "Karakuchi".
- **Presentation:** a binary none/heavy "Smokiness" row is *worse than silent* to a whisky
  buyer (peat is a spectrum); flat rows read thin next to the Body/Acidity/Tannin gauge trio;
  sweetness on 279/11,400 products is an inconsistent comparison experience.

**Goal (free, no LLM):** ship something a sommelier would stand behind — fix the data false
positives at the source, then display only the trustworthy signal, in a premium-appropriate
form. Specifically: a **"Peated" badge** for confidently-peated whiskies, and a
**category-scoped Sweetness** indicator once its inference is corrected.

---

## 2. Scope

**In scope (all FREE — deterministic rule fixes + re-run + UI):**
1. **Data fix** — correct `infer_smokiness` and `infer_sweetness` in
   `data/lib/enrichment/taste_rules.py`; re-run the Phase A backfill (NULL-safe? — see §6);
   refresh export.
2. **Peat badge** — a "Peated" / "Heavily Peated" chip on the product page for whiskies whose
   smokiness is a trustworthy `heavy`. Whisky only. Suppress `none`.
3. **Scoped sweetness** — display sweetness ONLY for categories where it's a real purchase
   driver and the corrected data is reliable (sake / dessert-fortified wine), as a small
   Dry↔Sweet indicator, not a universal bare row.

**Out of scope:**
- `finish`, `intensity` — 0 data; not displayed, not wired. Re-introduce only with the PR that
  fills them.
- Paid LLM enrichment (separate Rule-10-gated effort if ever justified).
- The taste deep-dive browse UX (`project_taste_deepdive_browse`) — separate later effort.
- Finder/shop changes — these fields aren't scored/filtered.

---

## 3. Data fix (free, deterministic)

### 3.1 `infer_smokiness` — remove the Islay region proxy
Root cause (`taste_rules.py:41`): `region in _ISLAY` forces `heavy` for ANYTHING in Islay,
including gins and unpeated whiskies with a wrong region cell. The name-cue + heavy-distillery
path is 100% accurate in the data; the bare region proxy is the liability.

**Fix:** drop the `region in _ISLAY → heavy` clause. `heavy` then requires a real cue:
`_PEAT_HEAVY` (distillery/peat words) or `_PEAT_WORD`. The negation guard stays. A whisky with
a region but no cue still falls through to `none` (clause 3). Net: the 4 gins and 15
region-only rows lose their (wrong/unverified) `heavy` → become `none` or NULL; the 54
name-verified `heavy` rows are unchanged.
(Also belt-and-braces: smokiness is already SKU-group-scoped to Whisky/Spirits in the backfill,
but The Botanist resolves to Spirits/Gin — so additionally exclude `type == 'Gin'` from
smokiness inference, or scope to group `Whisky` only for the badge. Decide in the plan.)

### 3.2 `infer_sweetness` — category guard + style-name + Extra-Dry exclusions
Root cause (`taste_rules.py:51`): bare `\bdry\b` with no guard matches "Dry Gin"/"Dry
Vermouth"/"Extra Dry".

**Fix:** before matching `_DRY`, exclude style-name phrases — `dry gin`, `dry vermouth`,
`london dry`, `extra dry` (sparkling). Require a sake/still-wine context for `dry`/`sweet`
to fire (e.g. via `category_type`/group passed in — the function already takes
`category_type` but ignores it). Keep `karakuchi`/`amakuchi`/`nigori`/`umeshu` (sake-native
cues) firing regardless. Re-run → the 64 gin + 58 Extra-Dry + 7 vermouth false positives clear.

**Both fixes get unit tests** that lock the specific false positives (The Botanist→not heavy;
"Gordon's Dry Gin"→not dry; a Prosecco "Extra Dry"→not dry; Lagavulin→heavy; a Karakuchi
sake→dry) — Rule 5 regression guards.

---

## 4. Display

### 4.1 Peat badge
A `PeatedBadge` chip (reuse the existing critic-score/food-chip visual language, NOT an
AttrRow) shown near the product title/details ONLY when `smokiness === 'heavy'` AND the product
is a whisky. Label "Peated" (or "Heavily Peated"). ~54 whiskies show it post-fix. `none`/NULL →
nothing. This turns a weak binary into a positive scannable signal for peat-lovers and never
shows a misleading 2-point scale.

### 4.2 Scoped sweetness
Show a Sweetness indicator ONLY for `category_group ∈ {sake/asian, dessert/fortified wine}`
(decide exact groups in the plan from the taxonomy), rendered as a small Dry↔Sweet marker
(reuse the `StructuralGauges` idiom or a 2-stop pill), not a universal bare row. Hidden for all
other categories even if a value is present. Post-fix data in these groups is reliable.

---

## 5. Components & data flow

```
taste_rules.py (FIX infer_smokiness + infer_sweetness)  ── unit tests (Rule 5)
        │  re-run backfill (free) → products.db → refresh_live_export.py → export JSON
        ▼
apps/catalog product page:
   PeatedBadge (whisky + smokiness='heavy')           ← new small component
   ScopedSweetness (sake/dessert groups only)          ← new small component or gated StructuralGauges axis
```

New units: the two `taste_rules` fixes (+ tests); `PeatedBadge` chip; the scoped-sweetness
display. No paid work. DB write is the free deterministic backfill (Rule-10-light: backup +
verify-shipped, but $0).

---

## 6. Testing & verification

- **Unit (Rule 5 regression):** the data-rule fixes lock the named false positives + true
  positives (§3.3 examples).
- **Backfill re-run safety:** the Phase A backfill is NULL-only (won't overwrite). BUT the fix
  must also CORRECT existing wrong values (the 4 gins / 64 dry-gins already written as
  heavy/dry). So the re-run needs an `--overwrite-source` mode OR a targeted correction step
  that clears Phase-A-sourced values before re-inferring. **Decide in the plan** — this is the
  one real hazard (don't leave the wrong values in place).
- **Rule 1 / 9:** after re-run, query the DB AND export: 0 gins tagged heavy, 0 "Dry Gin"
  tagged dry, Lagavulin still heavy; refresh export; counts match.
- **Rule 7 browser check (the real proof):** Lagavulin (LWH0161BU) shows a "Peated" badge;
  The Botanist gin shows NO peat badge; a Karakuchi sake shows "Dry"; Gordon's Dry Gin shows
  NO sweetness; a non-peated whisky shows no badge.

---

## 7. What ships
~54 whiskies gain a credible "Peated" badge; sake/dessert-wine gain a corrected, scoped
Sweetness indicator; the gin/prosecco false positives are removed from the data for ALL
consumers. finish/intensity untouched (0 data). $0 spent.

---

## 8. Follow-up (NOT this spec)
A separate Rule-10-gated PAID run could fill finish/intensity and a proper multi-level peat
scale (ppm-tier) + sake SMV sweetness — but only if the badge/indicator proves the value.
Note the latent `StructuralGauges.intensity` dormant axis (don't double-surface `intensity`
later). Then the taste deep-dive browse UX is its own effort.
