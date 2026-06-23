# Phase B Run 2 — Taste-Attribute Display (Design Spec)

**Date:** 2026-06-23
**Status:** Design — pending spec review + user approval, then writing-plans
**Predecessor:** Phase B Run 1 (paid variety+body) SHIPPED & MERGED (PR #37/#43).
See memory `project_phase_a_enrichment_promotion`, `project_universal_attributes_enrichment`.

---

## 1. Problem & Goal

Phase A/B populated several universal taste columns, but the catalog product page
**displays none of them**: `smokiness` (1,970 rows from Phase A), `sweetness` (279),
`finish` (0), `intensity` (0) are loaded into the catalog data but rendered nowhere.

**Critical finding (verified against code — this re-scopes the effort):** the original
"Run 2 = paid enrichment of finish/intensity/smokiness for display" premise is FALSE on two
counts:
1. **Nothing displays these fields.** `app/product/[sku]/page.tsx` renders AttrRows for
   Country/Region/Subregion/Variety/Vintage/Bottle-size/Body/Acidity/Tannin (lines 276-284)
   and a Taste-profile section using `StructuralGauges` (body/acidity/tannin) + `TasteWheel`
   (note-level data). `finish`/`intensity`/`smokiness` flat columns appear in NONE of them.
   (The `intensity` in `taste-geometry.ts` is per-flavor-note wedge sizing — a different
   concept, not the flat column.)
2. **Enriching before displaying = spend-without-shipping** (Rule 1/4). So paid enrichment is
   premature until a display consumes the fields.

**Goal (UI-first, FREE):** add a product-page display for these attributes using the data we
ALREADY have. Paid enrichment of `finish`/`intensity` is explicitly DEFERRED — the UI proves
the value first; if the data looks valuable but sparse, that becomes the evidence-based trigger
for a *separately Rule-10-gated* paid run later.

---

## 2. Scope

**In scope (free, render-only):**
- Add four taste AttrRows to the product-page Details `<dl>`: **Smokiness, Sweetness, Finish,
  Intensity** — each shown ONLY when present AND informative.
- A small, testable display formatter + a "meaningful value" filter.

**Out of scope:**
- Paid LLM enrichment (finish/intensity stay 0 — rows wired but dormant until future data).
- The taste **deep-dive browse UX** (memory `project_taste_deepdive_browse`) — a separate
  post-data effort; do NOT bundle.
- A new gauge/visual panel (premature with today's thin data).
- Finder/shop changes — these fields are not scored/filtered (verified in Run 1).
- DB / export / pipeline changes — pure render layer; no money, no data write.

---

## 3. The "meaningful value" rule

Render each attribute only when present AND informative:
- **`smokiness`**: show ONLY if value is not `none`/empty. (1,901 of 1,970 are `none` — a
  "Smokiness: none" row on 1,901 products is noise.) So ~69 `heavy` whiskies/spirits show it.
- **`sweetness`, `finish`, `intensity`**: show whenever present (any non-empty value is
  informative). Today: ~279 sweetness rows; finish/intensity = 0 (dormant).

**Display formatting:** DB stores lowercase tokens (`heavy`, `dry`); title-case for display
(`Heavy`, `Dry`). Title-case each token defensively if a value is ever multi-token.

---

## 4. Components & data flow

```
live_products_export.json  (already carries smokiness/sweetness/finish/intensity —
   confirmed in PublicProduct type + PUBLIC_FIELDS allowlist + the export JSON)
        │  page loads `product` (PublicProduct)
        ▼
app/product/[sku]/page.tsx — Details <dl>, after the Tannin AttrRow (line 284):
   <TasteAttrRow label="Smokiness" value={product.smokiness} hideValues={['none']} />
   <TasteAttrRow label="Sweetness" value={product.sweetness} />
   <TasteAttrRow label="Finish"    value={product.finish} />
   <TasteAttrRow label="Intensity" value={product.intensity} />
```

**New units:**
- `formatTasteValue(value)` — a pure function in a testable lib file (e.g.
  `apps/catalog/lib/format-taste.ts`): returns the title-cased display string, or null if
  empty. Unit-tested.
- `TasteAttrRow` — a thin wrapper over the existing `AttrRow`, inline in `page.tsx` next to
  `AttrRow` (matches the existing pattern): returns null if value empty OR in `hideValues`,
  else renders `<AttrRow label={label} value={formatTasteValue(value)} />`.

**No DB, no export, no pipeline, no money.** Only `page.tsx` + the formatter + its test change.

---

## 5. Error handling & edge cases

- **Unexpected value** (e.g. `medium`): title-cased and shown — display-only, no allowlist
  needed; data is validated upstream.
- **Null/undefined/empty**: hidden (filter + existing AttrRow null-on-empty).
- **`hideValues` match** (`smokiness='none'`): hidden.
- No new failure modes — a missing field just omits its row, like every other AttrRow.

---

## 6. Testing

- **Unit** (`apps/catalog/lib/__tests__/format-taste.test.ts` — match the existing test
  convention; the 25 catalog tests live in `lib/__tests__/`, NOT a sibling file):
  `'heavy'`→"Heavy"; `'dry'`→"Dry"; `'sweet'`→"Sweet"; `''`/null→null; a **hyphenated** token
  `'medium-high'`→"Medium-High" (hyphen-aware casing — StructuralGauges scales use hyphenated
  tokens and a future paid run may emit them). And the filter: `smokiness='none'`→hidden,
  `smokiness='heavy'`→shown.
- **Rule 7 — browser check (the real proof):** start the catalog dev server (port 3100), open:
  - a peaty whisky (Lagavulin, **LWH0161BU**, smokiness=`heavy`) → shows "Smokiness: Heavy"
  - a non-peaty whisky (smokiness=`none`) → NO smokiness row
  - a **dry** product (sweetness=`dry`) → shows "Sweetness: Dry"
  - a **sweet** product (sweetness=`sweet`) → shows "Sweetness: Sweet" (both live sweetness
    values, not just `dry`)
  - confirm **no Finish/Intensity row appears** on any product today (0 data → dormant rows
    must stay absent, never render an empty/garbage value)
  Confirm the rows render correctly and the page doesn't crash.

---

## 7. What ships

Today, free: ~69 products gain a "Smokiness: Heavy" row; ~279 gain a Sweetness row; Finish/
Intensity rows are wired and will auto-appear if a future paid run fills them. No spend.

---

## 8. Follow-up (NOT this spec)

If the UI shows the attributes are valuable but coverage is thin, that is the trigger to scope
a **separate, Rule-10-gated paid Run** for `finish`/`intensity` (and possibly extend
`smokiness` beyond whisky/spirits). Reuse the Run-1 scripts — but note (memory) field identity
is hardcoded ~6 sites there; parameterize THEN, per Rule 11. Then the taste deep-dive browse
UX is its own later effort.

**Latent collision to resolve when `intensity` gets paid data (review [INFO]):**
`StructuralGauges.tsx` already defines an `intensity` axis in `SCALE_DEFINITIONS`
(`['Low','Medium','Medium-High','High']`), but `toStructural` never emits it today (only
body/acidity/tannin), so it's dormant — no live conflict now. When a future paid run fills the
flat `intensity` column, decide ONE display surface: the AttrRow added here, OR the
StructuralGauges gauge — not both, or the same column renders in two places inconsistently.
