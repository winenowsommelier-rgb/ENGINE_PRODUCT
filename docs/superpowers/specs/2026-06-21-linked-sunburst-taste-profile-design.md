# Linked Sunburst Taste Profile — Design Spec

**Date:** 2026-06-21
**Status:** Approved design, pre-implementation
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

### 4.3 Why not just make TasteWheel `"use client"`?
That would re-run the wedge-path trig in every visitor's browser and pull the
whole tier list into the client bundle for ~3,689 SSG pages. The split keeps the
expensive, static part on the server and ships only the ~interaction reducer.

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
- Catalog `TasteNote` renders a `<button type="button">` now (was `<span>`) so
  it is keyboard-focusable and tappable, BUT it does **not** navigate — its
  `onClick`/`onMouseEnter`/`onMouseLeave` call `onFocusNote`. (No `useRouter`,
  no `/explore` — the grep invariant in its header comment still holds.)
- Internal `TasteNote` KEEPS its `/explore` navigation on click. Highlight is
  driven by hover only there, OR we add a small affordance: hover highlights +
  click still navigates. **Decision:** internal click = navigate (unchanged);
  hover = highlight. This preserves the existing "find similar" behavior.
- Visual additions (both): a color swatch (`tier` color, opacity ramped by
  intensity) and 1–3 intensity bars, rendered as child spans. Driven by CSS
  using existing `data-intensity` / `data-tier` attributes plus new
  `.taste-note__swatch` / `.taste-note__bars` elements.

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

### 5.3 `TasteWheel` (server, catalog) — new prop
```
interface TasteWheelProps {
  tiers: Tiers;
  size?: number;                // default 240
  varietalLabel?: string;       // NEW: shown in idle center
}
```
Call site [page.tsx:272] passes
`varietalLabel={product.grape_variety || product.name}`.

## 6. Interaction model

| Input | Desktop | Mobile / touch |
|-------|---------|----------------|
| hover chip/wedge | focus that pair | (no hover) |
| tap/click chip/wedge | toggle-lock focus | toggle-lock focus |
| tap empty space / Esc | clear | clear |

- Focus state: focused wedge gets `.hot` (scale 1.07 + drop-shadow); all other
  wedges get `.dim` (opacity ~0.22). Focused chip gets `.active`; siblings get
  `.faded`. Center shows tier label + note (serif) + intensity word.
- Idle state: center shows `varietalLabel` (serif) + faint "hover · tap to
  explore" hint. No dimming.
- Keyboard: chips are buttons → Tab to them, Enter/Space toggles focus, Esc
  clears. Wheel `<svg>` wedges get `role="button"` + `tabindex` OR (simpler,
  preferred) we make wedges focusable-by-proxy: keyboard users drive everything
  through the chips, wedges are pointer-only. **Decision:** chips are the
  keyboard path; wedges are pointer-enhancement. Each wedge has an
  `<title>`/aria so SR users hear it, but the chip list is the accessible
  source of truth.

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

## 10. Testing

- **Unit (catalog `TasteWheel.test.tsx` — extend existing):**
  - geometry: N notes → N `<path>` segments with stable ids (regression guard
    on the existing no-dead-segment intent).
  - empty tertiary → no tertiary segments, no crash.
  - each chip has a `segmentId` matching exactly one wedge id (the invariant
    that fixes the original bug: every chip links to one and only one wedge).
- **Interaction (jsdom / testing-library):** clicking a chip sets `aria`/class
  state on the matching wedge; clicking again clears; Esc clears.
- **a11y:** chips are buttons with accessible names incl. intensity; reduced-
  motion path asserted (no animation classes when the media query matches —
  test via mocked matchMedia).

## 11. Verification (CLAUDE.md Rule 7 — non-negotiable)

UI change → browser walkthrough required before "done":
1. `cd apps/catalog && npm run dev`
2. Open a real product URL that has a full taste profile (3 tiers).
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
