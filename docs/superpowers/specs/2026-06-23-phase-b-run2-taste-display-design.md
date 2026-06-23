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

**In scope (all FREE — source-agnostic value correction + UI):**
1. **Data correction** — a standalone `scripts/correct_taste_display.py` that fixes wrong
   smokiness/sweetness VALUES directly (the bad data spans 8 sources, not the rules — see §3).
   NOT a fix to `infer_smokiness`/`infer_sweetness` + backfill re-run (that would correct
   nothing — see §3). Then refresh export.
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

## 3. Data correction (free, source-agnostic — NOT a rules re-run)

**Provenance reality (verified 2026-06-24 — this overturns the "fix the rules" plan):** the
wrong values were NOT written by Phase A's deterministic `infer_smokiness`/`infer_sweetness`.
Of 69 `smokiness='heavy'`, only **2** are from the `rules` source; the rest span 8 sources —
`ai_brand_library_v3` (32), `reimport` (15), paid `ai_backfill_from_cache` (10),
`phase_c_sonnet_direct` (6)… Of 194 `sweetness='dry'`, only **4** are from `rules`. **Every one
of the 8 smokiness false positives came from a NON-rules source** (reimport / paid AI). So
editing `taste_rules.py` and re-running the deterministic backfill would correct **nothing** —
it's the wrong layer.

**Correct approach: a standalone, source-agnostic correction script** (`scripts/correct_taste_display.py`)
that fixes the wrong *values* directly, regardless of who wrote them. Free, deterministic, no LLM.
Rule-10-light (backup + dry-run + verify-shipped, $0).

### 3.1 Smokiness correction
- **Clear `smokiness` (→ NULL) for any non-whisky row** — require SKU group `Whisky` (not just
  Whisky/Spirits) for a `heavy`/`none` smokiness to stand. Drops The Botanist gins (group
  Spirits/Gin) and "ISLAY FC" (an event).
- **Clear `heavy` for the verified false-positive whiskies that lack peat evidence:** Old
  Pulteney 1989 (LWH0595ES — unpeated Highland, wrong region cell), JW Black Label Islay Origin
  (LWH0625BU — blend), Macleod's 8yr (LWH0392AH). Use an explicit SKU/pattern blocklist, not a
  heuristic.
- **Keep the 61 genuinely-peated whiskies** (Lagavulin, Bowmore 12/15/18/25, Smokehead ×3,
  Talisker 18, Ledaig, Laphroaig, Ardbeg, Six Isles, Scallywag, Lossit…). The correction must
  be ADDITIVE-safe: it only clears the named/grouped false positives, never the verified set.
- **Verified outcome:** 69 → **61 `heavy`** (8 cleared). This is the badge count.

### 3.2 Sweetness correction
- **Clear `dry`/`sweet` for any row NOT in a sweetness-relevant group** — keep only group ∈
  {`Sake & Asian`, dessert/fortified `Wine` — exact groups confirmed in the plan}. This clears
  in one stroke: 56 "Dry Gin" (Spirits), 4 Dry Vermouth, "Dry Orange/Curacao" liqueur, "Dry
  Rye Gin", "Dry Rum", "Dry Creek Vineyard" winery name — none are in the kept groups.
- **Within kept groups, clear the inverted sparkling "Extra Dry"** values (Extra Dry sparkling
  is off-dry/sweeter than Brut, not `dry`) — explicit pattern.
- Keep true sake Karakuchi `dry` and genuine sweet umeshu/nigori/dessert wine.

### 3.3 Optionally also fix `taste_rules.py` (low priority, separate concern)
The rules' Islay-region proxy + bare `\bdry\b` ARE latent bugs, but they wrote only ~2–4 of the
current bad rows, so fixing them is NOT what corrects the display. Treat as an optional cleanup
(its own small commit) — out of the critical path for this spec. If done, add the Rule-5 unit
tests there; but the DISPLAY correctness depends on §3.1/§3.2's value-correction, not this.

**The correction script gets a test** asserting the named false positives are cleared and the
61 peated + real sake are kept (Rule 5 regression guard, run against a fixture DB).

---

## 4. Display

### 4.1 Peat badge
A `PeatedBadge` chip (reuse the existing critic-score/food-chip visual language, NOT an
AttrRow) shown near the product title/details ONLY when `smokiness === 'heavy'` AND the product
is a whisky. Label "Peated" (or "Heavily Peated"). **61 whiskies** show it post-fix. `none`/NULL
→ nothing. This turns a weak binary into a positive scannable signal for peat-lovers and never
shows a misleading 2-point scale.

### 4.2 Scoped sweetness
Show a Sweetness indicator ONLY for `category_group ∈ {sake/asian, dessert/fortified wine}`
(decide exact groups in the plan from the taxonomy), rendered as a small Dry↔Sweet marker
(reuse the `StructuralGauges` idiom or a 2-stop pill), not a universal bare row. Hidden for all
other categories even if a value is present. Post-fix data in these groups is reliable.

---

## 5. Components & data flow

```
scripts/correct_taste_display.py (source-agnostic value correction)  ── unit tests (Rule 5)
        │  backup → dry-run → apply → products.db → refresh_live_export.py → export JSON
        ▼
apps/catalog product page:
   PeatedBadge (whisky + smokiness='heavy')           ← new small component
   ScopedSweetness (sake/dessert groups only)          ← new small component or gated StructuralGauges axis
```

New units: `correct_taste_display.py` (+ test); `PeatedBadge` chip; the scoped-sweetness
display. No paid work. DB write is the free deterministic backfill (Rule-10-light: backup +
verify-shipped, but $0).

---

## 6. Testing & verification

- **Unit (Rule 5 regression):** the data-rule fixes lock the named false positives + true
  positives (§3.1/§3.2 examples), incl. Bowmore/Smokehead/Talisker→heavy (the false-negative
  guard) and the gin/winery-name/Extra-Dry→cleared cases.
- **THE LOAD-BEARING HAZARD — the correction must be a precise, reversible value-edit.**
  `correct_taste_display.py` deliberately OVERWRITES wrong non-NULL values (unlike the NULL-only
  Phase A backfill, which is why a backfill re-run can't fix this). Because it overwrites, it must
  be surgical:
  1. Operate on an explicit, enumerated target set — non-whisky-group smokiness rows + the named
     false-positive SKUs (§3.1); non-sweetness-group + Extra-Dry sweetness rows (§3.2). NEVER a
     blanket `UPDATE … WHERE smokiness='heavy'`.
  2. **`--dry-run` first** printing every row it would change (before→after) for eyeball; backup
     the DB before `--apply` (Rule 10); idempotent (re-running changes nothing).
  3. It is source-AGNOSTIC by design (the bad data spans 8 sources) — it keys on the row's group
     + the SKU/pattern blocklist, NOT on `enrichment_source`.
- **Rule 1 / 9 (verify-shipped, both directions):** after the correction, query the DB AND export and
  assert BOTH: (a) **0 false positives** — 0 gins `heavy`, 0 "Dry Gin"/"Dry Creek"/Extra-Dry
  `dry`; AND (b) **0 false negatives** — Lagavulin, **Bowmore, Smokehead, Talisker 18** still
  `heavy`; total peated = 61. Refresh export; DB==export.
- **Rule 7 browser check (the real proof):** Lagavulin (LWH0161BU) AND a Bowmore show a "Peated"
  badge; The Botanist gin shows NO badge; a Karakuchi sake shows "Dry"; Gordon's Dry Gin shows
  NO sweetness; a non-peated whisky shows no badge.

---

## 7. What ships
**61** whiskies gain a credible "Peated" badge; sake/dessert-wine gain a corrected, scoped
Sweetness indicator; the gin/prosecco/winery-name false positives are corrected in the data for
ALL consumers (source-agnostic). finish/intensity untouched (0 data). $0 spent.

---

## 8. Follow-up (NOT this spec)
A separate Rule-10-gated PAID run could fill finish/intensity and a proper multi-level peat
scale (ppm-tier) + sake SMV sweetness — but only if the badge/indicator proves the value.
Note the latent `StructuralGauges.intensity` dormant axis (don't double-surface `intensity`
later). Then the taste deep-dive browse UX is its own effort.
