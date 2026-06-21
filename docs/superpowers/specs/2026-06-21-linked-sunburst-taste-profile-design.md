# Linked Sunburst Taste Profile — Design Spec

**Date:** 2026-06-21
**Status:** Implemented (2026-06-22) — catalog + internal. Verified in browser on
SKU `WRW2106AC` (full 3-tier) and `WRW2107AC` (missing-tertiary edge case);
catalog build green (232/232 SSG pages, `/product/[sku]` still SSG); internal
typecheck green; chip↔wedge link, draw-in, Esc-clear, reduced-motion, and the
internal `/explore` chip navigation all confirmed. Center text themed to each
app's sans body type (per user review).
**Components:** `TasteWheel.tsx`, `TasteNote.tsx` (catalog + internal copies)

---

## 1. Problem

On the product page, the taste-profile section shows a 3-ring sunburst wheel
above three rows of flavor chips (Primary / Secondary / Tertiary). A user
cannot tell **which wedge corresponds to which chip**. The only visual tie is a
3px tier-colored left border shared by all three chips in a tier — so
"Blackcurrant" the chip and its wedge in the wheel have no individuating link.

The sunburst is also at the known readability ceiling for radial hierarchies
(3 levels is the documented "outer rings become unreadable" threshold). The fix
is to make the chip↔wedge relationship **explicit and interactive** rather than
adding a 4th encoding.

## 2. Goal

When the user hovers (desktop) or taps (mobile) a chip **or** a wedge, its pair
highlights, everything else dims, and the wheel's center names the focused note,
its tier, and its intensity. At rest, the center shows the wine's varietal name.
Chips additionally carry an always-visible color swatch + intensity bars so tier
and strength read without interaction.

Aesthetic direction: **bold & dynamic** — wedges pop/scale on focus, rings
draw in on load (staggered), serif center readout. Restrained enough for a wine
catalog; `prefers-reduced-motion` disables the motion but keeps the link.

## 3. Scope

Both copies of the component are updated to stay in visual sync:

| File | App | Notes |
|------|-----|-------|
| `apps/catalog/components/product/TasteWheel.tsx` | Public catalog | Non-interactive chips today (server component) |
| `apps/catalog/components/product/TasteNote.tsx` | Public catalog | Plain `<span>`, no nav |
| `components/product/TasteWheel.tsx` | Internal PIM | `"use client"` already |
| `components/product/TasteNote.tsx` | Internal PIM | Navigating `<button>` → `/explore` (PRESERVE) |

**Out of scope:** `StructuralGauges`, `TasteChipCard` (internal, uses
`tier="flat"`), the `/explore` route, the taste-adapter data shape, any data
pipeline or DB write. This is a pure presentation change.

## 4. Architecture — the server/client split

### 4.1 The constraint
The catalog `TasteWheel` is intentionally a **server component** (its header
comment documents dropping `"use client"` as an SSG win). Adding hover/tap state
requires client JS. We must not regress catalog SSG by making the whole subtree
client-rendered and re-running geometry math in the browser.

### 4.2 The split
- **`TasteWheel.tsx` stays a server component.** It computes ALL geometry at
  build time: for each tier/note it derives the wedge `path` string, the
  fill-opacity, a stable `id` (`${tier}-${index}`), and the ordered list of ids
  for the draw-in stagger. It emits a flat `segments` array + the tier metadata.
- **New `TasteWheelInteractive.tsx` (`"use client"`)** receives the precomputed
  `segments`, `tiers`, and `varietalLabel` as plain serializable props. It owns
  ONLY: hover/tap highlight state, the dim/hot class toggling, the center
  readout text, and the load animation. No data fetching, no geometry math,
  minimal client bundle.
- The server `TasteWheel` renders `<TasteWheelInteractive .../>` passing the
  precomputed props. SSG still renders the full markup; client JS only hydrates
  the interaction layer.

> The internal copy is already `"use client"`, so it can keep the geometry
> inline OR adopt the same split for parity. **Decision:** adopt the same split
> in both for one shared mental model. The internal `TasteWheelInteractive` is
> identical except its chips render the navigating `TasteNote` button.

### 4.3 Why not just make TasteWheel `"use client"`? (W4 — corrected rationale)
The goal of the split is to **keep the geometry code and tier data out of the
client bundle**, shipping only the small interaction layer. If `TasteWheel`
itself were `"use client"`, the wedge-path trig function and the per-product
tier list would be serialized into the client bundle/hydration payload for
every product page. The split lets the server component do the one-time
geometry and hand `TasteWheelInteractive` plain precomputed props, so the client
ships only the highlight reducer + event handlers. (This is a bundle-size /
payload argument, not a "re-run trig N times" argument — for SSG the static HTML
is built once regardless.)

## 5. Component contracts

### 5.1 `TasteNote` (both apps) — new props
```
export interface TasteNoteProps {
  note: string;
  tier: Tier;                 // 'primary' | 'secondary' | 'tertiary' | 'flat'
  intensity: 1 | 2 | 3;
  segmentId?: string;         // NEW: ties chip to its wedge (e.g. "primary-0")
  active?: boolean;           // NEW: highlighted (focused) state
  faded?: boolean;            // NEW: a sibling is focused → de-emphasize
  onFocusNote?: (id?: string) => void;   // NEW: hover/tap callback (undefined = clear)
  className?: string;
}
```
- Catalog `TasteNote` renders a `<button type="button">` now (was `<span>`)
  **only when `onFocusNote` is provided**, so it is keyboard-focusable and
  tappable. It does **not** navigate — its `onClick`/`onMouseEnter`/
  `onMouseLeave` call `onFocusNote`. No `useRouter` import, no `router.push`
  call, no `/explore` string in code.
  - **Invariant (corrected, C2):** the real guard is *code-level*, not a bare
    grep. The catalog header comments legitimately contain the words
    `useRouter` and `/explore` (explaining why they were removed), so a naive
    `grep useRouter` is already non-empty today. The enforceable invariant is:
    **no `import { useRouter }`, no `router.push(`, and no `'/explore'` string
    literal in JSX or a handler** under the catalog `components/product/`.
    Any CI check must exclude comment lines (or grep for the import/call forms).
- **`tier="flat"` / no `onFocusNote` (W1):** when `TasteNote` receives no
  `onFocusNote` (the `TasteChipCard` flat path), it renders a **non-interactive
  `<span>`** exactly as today — no button, no focus, no behavior change. The
  new props are all optional; absent `onFocusNote` = legacy presentational
  chip. This keeps `TasteChipCard` genuinely out of scope.
- Internal `TasteNote` KEEPS its `/explore` navigation on click (unchanged).
  Highlight there is driven by **hover only**; click still navigates. See §6
  for how this branches the interaction model per app.
- Visual additions (both): a color swatch (`tier` color, opacity ramped by
  intensity) and 1–3 intensity bars, rendered as child spans. Driven by CSS
  using existing `data-intensity` / `data-tier` attributes plus new
  `.taste-note__swatch` / `.taste-note__bars` elements. These render on the
  presentational `<span>` form too (swatch/bars are not interactive).

### 5.2 `TasteWheelInteractive` (new, both apps)
```
interface Segment {
  id: string;            // "primary-0"
  tier: 'primary'|'secondary'|'tertiary';
  note: string;
  intensity: 1|2|3;
  path: string;          // precomputed SVG path d
  fillOpacity: number;
  color: string;
}
interface Props {
  segments: Segment[];
  tiers: Tiers;                  // for chip rows / empty-tier handling
  varietalLabel?: string;       // idle center text; falls back to a generic label
  size: number;
  order: string[];              // segment ids in draw-in order
}
```

### 5.3 `TasteWheel` (both apps) — new prop + call-site plumbing (C1)
```
interface TasteWheelProps {
  tiers: Tiers;
  size?: number;                // default 240
  varietalLabel?: string;       // NEW: shown in idle center; OPTIONAL
}
```
`varietalLabel` is **optional**. When absent, the idle center falls back to a
generic label (see §6). Plumbing differs per app — the call site does NOT pass
it today; both edits below are required work:

- **Catalog** — edit [page.tsx:272], currently `{tiers ? <TasteWheel tiers={tiers} /> : null}`,
  to `{tiers ? <TasteWheel tiers={tiers} varietalLabel={product.grape_variety || product.name} /> : null}`.
  Both fields are confirmed present on `product` in `page.tsx` scope.
- **Internal** — `TasteProfileSection.tsx` receives only `{ profile, productId }`;
  it has **no varietal/grape/name field** in scope. Two options:
  1. (Preferred, smallest) Accept the generic fallback internally — pass nothing,
     idle center shows the generic label. No upstream plumbing.
  2. Thread a `varietalLabel` prop down from whatever renders
     `TasteProfileSection` (a larger change touching that parent).
  **Decision:** Option 1 — internal idle center uses the generic fallback. The
  internal app is a PIM where the product name is already on the page; the
  varietal-in-center flourish is a catalog nicety. Revisit only if requested.

## 6. Interaction model

The model **branches by app** (W2), because the catalog chip is a non-navigating
focus toggle while the internal chip navigates to `/explore`.

### 6a. Catalog (chips do not navigate)
| Input | Desktop | Mobile / touch |
|-------|---------|----------------|
| hover chip/wedge | focus that pair | (no hover) |
| tap/click chip/wedge | toggle-lock focus | toggle-lock focus |
| tap empty space / Esc | clear | clear |

### 6b. Internal (chip click navigates to `/explore` — preserved)
| Input | Desktop | Mobile / touch |
|-------|---------|----------------|
| hover chip/wedge | focus that pair | (no hover) |
| **click chip** | navigate to `/explore` (unchanged) | navigate to `/explore` |
| tap/click **wedge** | toggle-lock focus | toggle-lock focus |

> Internal mobile focus path (W2): since a chip tap navigates, **the wedge is
> the focus control on touch** — tapping a wedge highlights its chip. The chip
> list still works as a navigation list. This is acceptable because the
> internal app's primary chip action has always been "find similar," not
> "inspect this note"; the wheel-tap gives touch users the inspect path. If a
> dedicated touch inspect-without-navigate is later wanted, add a long-press;
> out of scope now.

- Focus state: focused wedge gets `.hot` (scale 1.07 + drop-shadow); all other
  wedges get `.dim` (opacity ~0.22). Focused chip gets `.active`; siblings get
  `.faded`. Center shows tier label + note (serif) + intensity word.
- Idle state (both): center shows `varietalLabel` when provided (serif), else
  the generic fallback `Aroma profile` / `Tasting notes`, plus a faint
  "hover · tap to explore" hint. No dimming.

### 6c. Keyboard & a11y (W3 — resolved, no contradiction)
- **Chips are the single keyboard/SR path.** Catalog: chip `<button>` → Tab,
  Enter/Space toggles focus, Esc clears. Internal: chip `<button>` → Tab,
  Enter activates navigation (its existing behavior).
- **Wedges are pointer-only decoration.** They get **NO `role="button"` and NO
  `tabindex`** (avoids the "announced actionable but not keyboard-operable"
  trap). The `<svg>` carries `role="img"` + `aria-label` as today; individual
  wedges are `aria-hidden="true"` since every wedge is already represented by an
  accessible chip. The chip list is the accessible source of truth; the wheel
  is a visual enhancement of it.

## 7. Motion (bold & dynamic)

- **Draw-in on mount:** wedges start `scale(.4)`, `opacity 0`; stagger in by
  segment order (~55ms apart) to full size. CSS transition with a slight
  overshoot easing.
- **Focus pop:** `.hot` wedge transitions to `scale(1.07)` + drop-shadow over
  ~280ms with overshoot. Chips lift `translateY(-2px)` + colored shadow.
- **`prefers-reduced-motion: reduce`:** no draw-in (wedges render in place at
  full opacity), no scale pop (focus shows via opacity/stroke only), no chip
  lift. The link/dim still works — motion is enhancement, not the mechanism.
- All animation uses `transform`/`opacity` only (no width/height/layout) to
  avoid CLS, per the perf rules.

## 8. Styling

All new visuals live in each app's `globals.css` under the existing
`.taste-wheel*` / `.taste-note*` namespace. New classes:
`.taste-note__swatch`, `.taste-note__bars`, `.taste-note.is-active`,
`.taste-note.is-faded`, `.taste-wheel-center`, `.taste-wheel__wedge.is-hot`,
`.taste-wheel__wedge.is-dim`. Tier colors stay the existing tokens
(catalog primary `#7c2d3a`, internal primary `#c64633`, secondary `#8b5a2b`,
tertiary `#6c6055`). No new color tokens.

## 9. Edge cases

- **Missing tier** (low-evidence SKUs with no tertiary): tier block skipped in
  chip list (existing behavior preserved); the empty ring renders as the
  existing faint stroke circle. No focusable segments for that tier.
- **Single-note tier:** wedge is a full ring; still highlightable.
- **No tiers at all:** component renders nothing new vs today (caller already
  guards `tiers ? <TasteWheel/> : null` at the catalog call site).
- **Long note names** in center: center text wraps / clamps to the inner-circle
  width; max 2 lines, the inner radius is sized so 2 lines fit.
- **Empty rings & the draw-in (I3):** a tier with no notes renders the existing
  faint stroke circle, which is **not** a segment and is **excluded from
  `order[]`** — the stagger only animates real wedges. Hovering a single-note
  full-ring wedge focuses normally (center shows that note); there is no special
  case for full rings.

## 10. Testing

- **Unit (extend existing `apps/catalog/components/__tests__/TasteWheel.test.tsx`
  — I1; it imports from `@/components/product/TasteWheel`):**
  - geometry: N notes → N `<path>` segments with stable ids (regression guard
    on the existing no-dead-segment intent).
  - empty tertiary → no tertiary segments, no crash; the empty ring's faint
    stroke circle is **excluded from `order[]`** so the draw-in never targets a
    non-segment (I3).
  - each chip has a `segmentId` matching exactly one wedge id (the invariant
    that fixes the original bug: every chip links to one and only one wedge).
    Ids are **index-based** (`${tier}-${index}`), NOT note-based — this is
    deliberate so two notes with the same name in one tier still get distinct
    ids. Do not "simplify" to `${tier}-${note}` (I2). Add a test with a
    duplicate note name in a tier asserting two distinct segment ids.
- **Interaction (jsdom / testing-library):** clicking a chip sets `aria`/class
  state on the matching wedge; clicking again clears; Esc clears.
- **a11y:** chips are buttons with accessible names incl. intensity; reduced-
  motion path asserted (no animation classes when the media query matches —
  test via mocked matchMedia).

## 11. Verification (CLAUDE.md Rule 7 — non-negotiable)

UI change → browser walkthrough required before "done":
0. **Precondition:** `NEXT_PUBLIC_TASTE_PROFILE_ENABLED=true` must be set in the
   internal app's env, or `TasteProfileSection` returns `null` and the section
   silently renders nothing (the catalog page renders the wheel directly and is
   not gated, but verify the same flag for the internal walkthrough). Confirm the
   section is visible before testing interaction.
1. `cd apps/catalog && npm run dev`
2. Open a real product URL that has a full 3-tier taste profile. **Pin a
   specific known-good SKU** during the walkthrough (pick one from
   `data/live_products_export.json` where `taste_profile.tiers` has all three of
   primary/secondary/tertiary populated) and record it in the implementation
   notes so the walkthrough is reproducible.
3. Desktop: hover each tier's chips → confirm correct wedge pops + center names
   it; hover wedges → confirm correct chip activates.
4. Resize to 375px: confirm tap-to-lock works, tap-away clears, no layout shift,
   no horizontal scroll.
5. Toggle OS reduce-motion → confirm link still works, animations gone.
6. Spot-check a SKU with a missing tertiary tier → no crash, no orphan UI.
7. Internal app: confirm chip **click still navigates to `/explore`** while
   hover highlights (the preserved behavior).

Only after this walkthrough is the work reported complete.

## 12. Non-goals / YAGNI

- No new chart library (stay hand-rolled SVG — it's ~40 lines of trig).
- No drill-down/zoom, no tooltips beyond the center readout.
- No data/schema changes; `varietalLabel` reuses fields already on the product.
- No animation config system — the timings are constants in CSS.
