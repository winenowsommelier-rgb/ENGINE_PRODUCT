# Linked Sunburst Taste Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the product-page taste wheel interactive so each flavor chip visibly links to its exact wedge (hover on desktop, tap on mobile), with a bold draw-in animation and a serif center readout — fixing the disconnect where users can't tell which wedge is which note.

**Architecture:** Split the catalog `TasteWheel` into a server component (precomputes all SVG geometry at build time) plus a new `"use client"` `TasteWheelInteractive` that owns only highlight state and motion — preserving SSG. `TasteNote` gains a color swatch + intensity bars and an optional focus-callback; absent the callback it stays a presentational `<span>` (so the flat-tag path is unchanged). The internal app gets the same treatment but keeps its `/explore` click navigation.

**Tech Stack:** Next.js (App Router, RSC), React, TypeScript, Vitest + @testing-library/react, hand-rolled SVG (no chart lib), CSS in `globals.css`.

**Spec:** `docs/superpowers/specs/2026-06-21-linked-sunburst-taste-profile-design.md`

---

## File Structure

| File | App | Action | Responsibility |
|------|-----|--------|----------------|
| `apps/catalog/lib/taste-geometry.ts` | catalog | **Create** | Pure geometry: tiers → `Segment[]` + `order[]`. No React. Shared by server wheel + tests. |
| `apps/catalog/components/product/TasteWheelInteractive.tsx` | catalog | **Create** | `"use client"`. Highlight state, dim/hot toggling, center readout, draw-in. |
| `apps/catalog/components/product/TasteWheel.tsx` | catalog | **Modify** | Stays server component. Calls geometry, renders `<TasteWheelInteractive>`. Adds `varietalLabel` prop. |
| `apps/catalog/components/product/TasteNote.tsx` | catalog | **Modify** | Adds swatch + bars; `<button>` only when `onFocusNote` given, else `<span>`. |
| `apps/catalog/app/product/[sku]/page.tsx` | catalog | **Modify** | Line ~272: pass `varietalLabel`. |
| `apps/catalog/app/globals.css` | catalog | **Modify** | New `.taste-note__*`, `.taste-wheel-center`, wedge `.is-hot/.is-dim`, reduced-motion. |
| `apps/catalog/components/__tests__/TasteWheel.test.tsx` | catalog | **Modify** | Extend: segment-id invariant, dup-note ids, empty-ring exclusion. |
| `apps/catalog/lib/__tests__/taste-geometry.test.ts` | catalog | **Create** | Unit-test the pure geometry. |
| `apps/catalog/components/__tests__/TasteWheelInteractive.test.tsx` | catalog | **Create** | Interaction: click chip → wedge active; toggle; Esc clears. |
| `components/product/*` (internal) | internal | **Modify** | Same split, but chip click navigates. Done LAST, after catalog verified. |

**Order:** geometry (pure, testable) → TasteNote (presentational) → TasteWheelInteractive (client) → TasteWheel (wire) → CSS → call site → browser-verify catalog → internal port → browser-verify internal.

---

## Conventions for every task

- Test runner: from `apps/catalog/`, run `npx vitest run <path>` for one file.
- Commit after each task with the message shown.
- Tier colors (catalog): primary `#7c2d3a`, secondary `#8b5a2b`, tertiary `#6c6055`.
- Segment id format is **`${tier}-${index}`** (index-based — never note-based).

---

## Task 1: Pure geometry module

**Files:**
- Create: `apps/catalog/lib/taste-geometry.ts`
- Test: `apps/catalog/lib/__tests__/taste-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/catalog/lib/__tests__/taste-geometry.test.ts
import { describe, it, expect } from 'vitest';
import { buildSegments, type Tiers } from '@/lib/taste-geometry';

const note = (n: string, intensity: 1 | 2 | 3 = 2) => ({ note: n, intensity });

describe('buildSegments', () => {
  it('emits one segment per note with index-based ids', () => {
    const tiers: Tiers = {
      primary: [note('Blackcurrant', 3), note('Plum', 2)],
      secondary: [note('Cedar', 3)],
      tertiary: [],
    };
    const { segments, order } = buildSegments(tiers, 320);
    expect(segments.map(s => s.id)).toEqual(['primary-0', 'primary-1', 'secondary-0']);
    // order matches segment ids (draw-in order), empty tertiary contributes nothing
    expect(order).toEqual(['primary-0', 'primary-1', 'secondary-0']);
    // each segment carries a path + tier color + intensity
    expect(segments[0]).toMatchObject({ tier: 'primary', note: 'Blackcurrant', intensity: 3, color: '#7c2d3a' });
    expect(segments[0].path.startsWith('M ')).toBe(true);
  });

  it('gives duplicate note names within a tier distinct ids', () => {
    const tiers: Tiers = { primary: [note('Spice'), note('Spice')], secondary: [], tertiary: [] };
    const { segments } = buildSegments(tiers, 320);
    expect(segments.map(s => s.id)).toEqual(['primary-0', 'primary-1']);
  });

  it('excludes empty tiers from segments and order', () => {
    const tiers: Tiers = { primary: [note('Cherry')], secondary: [], tertiary: [] };
    const { segments, order } = buildSegments(tiers, 320);
    expect(segments).toHaveLength(1);
    expect(order).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/__tests__/taste-geometry.test.ts`
Expected: FAIL — cannot resolve `@/lib/taste-geometry`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/catalog/lib/taste-geometry.ts
//
// Pure geometry for the taste wheel. No React, no DOM — so it runs at build
// time inside the server TasteWheel AND under vitest directly. Emits a flat
// Segment[] (one per note) plus the draw-in order, which the client interactive
// layer consumes as plain serializable props (keeps trig out of the client bundle).

export interface Note { note: string; intensity: 1 | 2 | 3; }
export interface Tiers { primary: Note[]; secondary: Note[]; tertiary: Note[]; }

export interface Segment {
  id: string;            // `${tier}-${index}` — index-based, dup-note safe
  tier: keyof Tiers;
  note: string;
  intensity: 1 | 2 | 3;
  path: string;          // SVG path `d`
  fillOpacity: number;
  color: string;
}

const TIER_COLORS: Record<keyof Tiers, string> = {
  primary: '#7c2d3a',
  secondary: '#8b5a2b',
  tertiary: '#6c6055',
};

const RINGS: Array<{ key: keyof Tiers; rOuter: number; rInner: number }> = [
  { key: 'primary', rOuter: 0.98, rInner: 0.66 },
  { key: 'secondary', rOuter: 0.64, rInner: 0.40 },
  { key: 'tertiary', rOuter: 0.38, rInner: 0.16 },
];

// Exposed so the interactive layer can place faint placeholder rings for empty
// tiers at exactly the radii their wedges would occupy (spec §9).
export const RING_GEOMETRY: Record<keyof Tiers, { rOuter: number; rInner: number }> = {
  primary: { rOuter: 0.98, rInner: 0.66 },
  secondary: { rOuter: 0.64, rInner: 0.40 },
  tertiary: { rOuter: 0.38, rInner: 0.16 },
};

function describeWedge(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(rO, a0);
  const [x2, y2] = p(rO, a1);
  const [x3, y3] = p(rI, a1);
  const [x4, y4] = p(rI, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${rO} ${rO} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rI} ${rI} 0 ${large} 0 ${x4} ${y4} Z`;
}

export function buildSegments(tiers: Tiers, size: number): { segments: Segment[]; order: string[] } {
  const cx = size / 2, cy = size / 2, R = size / 2 - 6;
  const segments: Segment[] = [];
  for (const ring of RINGS) {
    const notes = tiers[ring.key] ?? [];
    const total = notes.reduce((s, n) => s + n.intensity, 0) || 1;
    let angle = -Math.PI / 2;
    notes.forEach((n, i) => {
      const sweep = (n.intensity / total) * Math.PI * 2;
      segments.push({
        id: `${ring.key}-${i}`,
        tier: ring.key,
        note: n.note,
        intensity: n.intensity,
        path: describeWedge(cx, cy, R * ring.rOuter, R * ring.rInner, angle, angle + sweep),
        fillOpacity: 0.42 + (n.intensity / 3) * 0.55,
        color: TIER_COLORS[ring.key],
      });
      angle += sweep;
    });
  }
  return { segments, order: segments.map(s => s.id) };
}

export { TIER_COLORS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/__tests__/taste-geometry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/taste-geometry.ts apps/catalog/lib/__tests__/taste-geometry.test.ts
git commit -m "feat(catalog): pure taste-wheel geometry module (segments + draw-in order)"
```

---

## Task 2: TasteNote — swatch, bars, optional focus callback

**Files:**
- Modify: `apps/catalog/components/product/TasteNote.tsx`
- Test: `apps/catalog/components/__tests__/TasteWheelInteractive.test.tsx` (created Task 4; TasteNote covered indirectly + one direct test here)

- [ ] **Step 1: Write the failing test** (new file for TasteNote-specific behavior)

```tsx
// apps/catalog/components/__tests__/TasteNote.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TasteNote } from '@/components/product/TasteNote';

describe('TasteNote', () => {
  it('renders a non-interactive span when no onFocusNote is given', () => {
    render(<TasteNote note="Cedar" tier="flat" intensity={2} />);
    const el = screen.getByText('Cedar');
    expect(el.tagName).toBe('SPAN');
  });

  it('renders a button when a callback is given; click toggles, hover focuses', () => {
    const onFocus = vi.fn();
    const onToggle = vi.fn();
    render(<TasteNote note="Cedar" tier="secondary" intensity={3} segmentId="secondary-0" onFocusNote={onFocus} onToggleNote={onToggle} />);
    const el = screen.getByRole('button', { name: /Cedar/i });
    el.click();
    expect(onToggle).toHaveBeenCalledWith('secondary-0');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run components/__tests__/TasteNote.test.tsx`
Expected: FAIL — `onFocusNote`/`segmentId` not on props; everything renders as span.

- [ ] **Step 3: Implement**

Replace `apps/catalog/components/product/TasteNote.tsx` with:

```tsx
// components/product/TasteNote.tsx
//
// Presentational by default (a <span>), exactly as the public catalog needs for
// the flat-tag path. When the linked-sunburst wheel passes `onFocusNote`, it
// upgrades to a focusable <button> that drives chip<->wedge highlight — it still
// does NOT navigate (no useRouter import, no router.push, no '/explore' literal;
// the words appearing in THIS comment are documentation, not code).

export type Tier = 'primary' | 'secondary' | 'tertiary' | 'flat';

export interface TasteNoteProps {
  note: string;
  tier: Tier;
  intensity: 1 | 2 | 3;
  segmentId?: string;
  active?: boolean;
  faded?: boolean;
  onFocusNote?: (id?: string) => void;   // hover: enter -> id, leave -> undefined
  onToggleNote?: (id: string) => void;   // click: lock/unlock this id
  className?: string;
}

function Decoration({ tier, intensity }: { tier: Tier; intensity: 1 | 2 | 3 }) {
  // swatch opacity ramps with intensity; bars count = intensity (CSS reads data-intensity)
  return (
    <>
      <span className="taste-note__swatch" aria-hidden="true" />
      <span className="taste-note__bars" aria-hidden="true">
        <i /><i /><i />
      </span>
    </>
  );
}

export function TasteNote({ note, tier, intensity, segmentId, active, faded, onFocusNote, onToggleNote, className }: TasteNoteProps) {
  const cls = `${className ?? 'taste-note'}${active ? ' is-active' : ''}${faded ? ' is-faded' : ''}`;

  // Interactive only when a handler is given. The flat-tag path passes neither →
  // a plain non-interactive <span>, unchanged from before.
  const interactive = !!onFocusNote || !!onToggleNote;
  if (!interactive) {
    return (
      <span data-intensity={intensity} data-tier={tier} className={cls}>
        <Decoration tier={tier} intensity={intensity} />
        {note}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-intensity={intensity}
      data-tier={tier}
      className={cls}
      aria-pressed={!!active}
      aria-label={`${note}, ${tier} note, intensity ${intensity}`}
      onClick={(e) => { e.stopPropagation(); if (segmentId) onToggleNote?.(segmentId); }}
      onMouseEnter={() => onFocusNote?.(segmentId)}
      onMouseLeave={() => onFocusNote?.(undefined)}
    >
      <Decoration tier={tier} intensity={intensity} />
      {note}
    </button>
  );
}
```

> NOTE: click → `onToggleNote(id)` (lock); hover enter/leave → `onFocusNote(id|undefined)`
> (transient). Two callbacks keep the two semantics unambiguous. `e.stopPropagation()`
> stops the chip click from bubbling to the wheel's clear-on-background handler.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/catalog && npx vitest run components/__tests__/TasteNote.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify the no-navigation invariant (spec C2, code-level)**

Run (excludes comment lines):
```bash
cd apps/catalog && ! grep -nE "import .*useRouter|router\.push|'/explore'|\"/explore\"" components/product/TasteNote.tsx
```
Expected: command succeeds (no matches) — exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/components/product/TasteNote.tsx apps/catalog/components/__tests__/TasteNote.test.tsx
git commit -m "feat(catalog): TasteNote gains swatch+bars and optional focus callback (still non-navigating)"
```

---

## Task 3: TasteWheelInteractive (client) — the highlight + motion layer

**Files:**
- Create: `apps/catalog/components/product/TasteWheelInteractive.tsx`
- Test: `apps/catalog/components/__tests__/TasteWheelInteractive.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/catalog/components/__tests__/TasteWheelInteractive.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TasteWheelInteractive } from '@/components/product/TasteWheelInteractive';
import { buildSegments, type Tiers } from '@/lib/taste-geometry';

const tiers: Tiers = {
  primary: [{ note: 'Blackcurrant', intensity: 3 }, { note: 'Plum', intensity: 2 }],
  secondary: [{ note: 'Cedar', intensity: 3 }],
  tertiary: [],
};

function setup() {
  const { segments, order } = buildSegments(tiers, 320);
  render(<TasteWheelInteractive segments={segments} tiers={tiers} order={order} size={320} varietalLabel="Cabernet Sauvignon" />);
}

describe('TasteWheelInteractive', () => {
  it('idle center shows the varietal label', () => {
    setup();
    expect(screen.getByText('Cabernet Sauvignon')).toBeInTheDocument();
  });

  it('clicking a chip activates exactly its matching wedge and names it in the center', () => {
    setup();
    const chip = screen.getByRole('button', { name: /Blackcurrant/i });
    fireEvent.click(chip);
    // chip is active
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    // exactly one wedge is hot, and it is the matching one
    const hot = document.querySelectorAll('path.is-hot');
    expect(hot).toHaveLength(1);
    expect(hot[0].getAttribute('data-id')).toBe('primary-0');
    // center now names it
    expect(screen.getByText('Blackcurrant')).toBeInTheDocument();
  });

  it('clicking the same chip again clears (toggle)', () => {
    setup();
    const chip = screen.getByRole('button', { name: /Blackcurrant/i });
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(document.querySelectorAll('path.is-hot')).toHaveLength(0);
    expect(screen.getByText('Cabernet Sauvignon')).toBeInTheDocument();
  });

  it('Escape clears a locked selection (spec §6c)', () => {
    setup();
    const chip = screen.getByRole('button', { name: /Blackcurrant/i });
    fireEvent.click(chip);                 // lock
    expect(document.querySelectorAll('path.is-hot')).toHaveLength(1);
    fireEvent.keyDown(chip, { key: 'Escape' });  // bubbles to the wheel root
    expect(document.querySelectorAll('path.is-hot')).toHaveLength(0);
    expect(screen.getByText('Cabernet Sauvignon')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/catalog && npx vitest run components/__tests__/TasteWheelInteractive.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// components/product/TasteWheelInteractive.tsx
"use client";

import { useState, useCallback } from 'react';
import { TasteNote } from './TasteNote';
import { RING_GEOMETRY, type Segment, type Tiers } from '@/lib/taste-geometry';

interface Props {
  segments: Segment[];
  tiers: Tiers;
  order: string[];
  size: number;
  varietalLabel?: string;
}

const TIER_LABEL: Record<string, string> = { primary: 'Primary', secondary: 'Secondary', tertiary: 'Tertiary' };
const INTENSITY_WORD: Record<number, string> = { 1: 'Subtle', 2: 'Medium', 3: 'Pronounced' };

export function TasteWheelInteractive({ segments, tiers, order, size, varietalLabel }: Props) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 6;
  // `locked` = a tap-selected id (sticky); `hover` = transient pointer focus.
  const [locked, setLocked] = useState<string | undefined>();
  const [hover, setHover] = useState<string | undefined>();
  const focused = hover ?? locked;

  const toggleLock = useCallback((id: string) => {
    setLocked(prev => (prev === id ? undefined : id));
    setHover(undefined);
  }, []);

  const clear = useCallback(() => { setLocked(undefined); setHover(undefined); }, []);

  const focusedSeg = segments.find(s => s.id === focused);

  return (
    <div
      className="taste-wheel"
      onClick={() => { if (locked) clear(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && (locked || hover)) clear(); }}
    >
      <div className="taste-wheel__svgwrap">
        <svg
          viewBox={`0 0 ${size} ${size}`} width={size} height={size}
          className="taste-wheel__svg"
          role="img" aria-label="Taste profile wheel"
        >
          {/* Empty tiers: faint placeholder ring (spec §9) — NOT a segment, never
              in order[], never focusable. RING_GEOMETRY mirrors taste-geometry's
              RINGS so the placeholder sits exactly where that tier's wedges would. */}
          {(['primary', 'secondary', 'tertiary'] as const).map(t => {
            if ((tiers[t] ?? []).length > 0) return null;
            const ring = RING_GEOMETRY[t];
            const rMid = R * (ring.rOuter + ring.rInner) / 2;
            return (
              <circle key={`empty-${t}`} cx={cx} cy={cy} r={rMid}
                fill="none" stroke="#ece7df" strokeWidth={R * (ring.rOuter - ring.rInner)}
                aria-hidden="true" />
            );
          })}
          {segments.map((s, i) => {
            const isHot = focused === s.id;
            const isDim = focused != null && !isHot;
            return (
              <path
                key={s.id}
                data-id={s.id}
                d={s.path}
                fill={s.color}
                fillOpacity={s.fillOpacity}
                stroke="#fff"
                strokeWidth={2.5}
                className={`taste-wheel__wedge${isHot ? ' is-hot' : ''}${isDim ? ' is-dim' : ''}`}
                style={{ ['--draw-delay' as string]: `${90 + order.indexOf(s.id) * 55}ms` }}
                aria-hidden="true"
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(undefined)}
                onClick={(e) => { e.stopPropagation(); toggleLock(s.id); }}
              />
            );
          })}
          <circle cx={cx} cy={cy} r={R * 0.15} fill="#faf8f4" stroke="#e3ddcf" />
        </svg>
        <div className="taste-wheel-center" aria-live="polite">
          {focusedSeg ? (
            <>
              <span className="taste-wheel-center__tier" style={{ color: focusedSeg.color }}>{TIER_LABEL[focusedSeg.tier]}</span>
              <span className="taste-wheel-center__note">{focusedSeg.note}</span>
              <span className="taste-wheel-center__sub">{INTENSITY_WORD[focusedSeg.intensity]} intensity</span>
            </>
          ) : (
            <>
              <span className="taste-wheel-center__note is-idle">{varietalLabel ?? 'Tasting notes'}</span>
              <span className="taste-wheel-center__sub">hover · tap to explore</span>
            </>
          )}
        </div>
      </div>

      <div className="taste-wheel-legend">
        {(['primary', 'secondary', 'tertiary'] as const).map(tier => {
          const notes = tiers[tier] ?? [];
          if (notes.length === 0) return null;
          return (
            <div key={tier} className={`taste-wheel-legend-row taste-wheel-legend-${tier}`}>
              <span className="taste-wheel-legend-label">{TIER_LABEL[tier]}</span>
              <div className="taste-notes-row">
                {notes.map((n, i) => {
                  const id = `${tier}-${i}`;
                  return (
                    <TasteNote
                      key={id}
                      note={n.note}
                      tier={tier}
                      intensity={n.intensity}
                      segmentId={id}
                      active={focused === id}
                      faded={focused != null && focused !== id}
                      onFocusNote={(maybeId) => setHover(maybeId)}   // hover enter/leave
                      onToggleNote={(toggleId) => toggleLock(toggleId)} // click locks/unlocks
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

> The two-callback `TasteNote` from Task 2 (`onFocusNote` for hover,
> `onToggleNote` for click) makes the click-lock vs hover-focus split clean —
> the test in Step 1 asserts the observable behavior (click activates, click
> again clears), which is the real contract.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/catalog && npx vitest run components/__tests__/TasteWheelInteractive.test.tsx`
Expected: PASS (4 tests, including Escape-clears).

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/components/product/TasteWheelInteractive.tsx apps/catalog/components/__tests__/TasteWheelInteractive.test.tsx apps/catalog/components/product/TasteNote.tsx
git commit -m "feat(catalog): TasteWheelInteractive — linked chip<->wedge highlight + center readout"
```

---

## Task 4: Wire the server TasteWheel to the interactive layer

**Files:**
- Modify: `apps/catalog/components/product/TasteWheel.tsx`
- Modify: `apps/catalog/components/__tests__/TasteWheel.test.tsx`

- [ ] **Step 0: Enumerate importers of `Note`/`Tiers` from TasteWheel before changing its export shape**

The rewrite changes how `TasteWheel.tsx` declares `Note`/`Tiers` (re-exports `Tiers`
from the geometry module). Confirm no importer breaks:

```bash
cd apps/catalog && grep -rn "from '@/components/product/TasteWheel'\|from './TasteWheel'\|from '../product/TasteWheel'" . --include=*.ts --include=*.tsx | grep -v node_modules
```

For each hit, confirm it imports only `TasteWheel`, `Note`, or `Tiers` — all still
exported with identical shapes (`Note = { note: string; intensity: 1|2|3 }`,
`Tiers = { primary; secondary; tertiary }`). If anything imports a symbol the
rewrite drops, keep that export. The catalog page imports only `TasteWheel`
(value), so it is unaffected.

- [ ] **Step 1: Extend the existing test**

Add to `apps/catalog/components/__tests__/TasteWheel.test.tsx`:

```tsx
  it('each chip has a wedge with a matching data-id (no orphan chip)', () => {
    const tiers: Tiers = {
      primary: [note('Blackcurrant', 3), note('Plum', 2)],
      secondary: [note('Cedar')],
      tertiary: [],
    };
    const { container } = render(<TasteWheel tiers={tiers} varietalLabel="Cab" />);
    const wedgeIds = [...container.querySelectorAll('path[data-id]')].map(p => p.getAttribute('data-id'));
    expect(wedgeIds).toEqual(['primary-0', 'primary-1', 'secondary-0']);
    // varietal label shows in idle center
    expect(screen.getByText('Cab')).toBeInTheDocument();
  });
```

(Keep the two existing tests — empty-tier-hides-header and all-three-headers — they still hold.)

- [ ] **Step 2: Run to verify the new test fails**

Run: `cd apps/catalog && npx vitest run components/__tests__/TasteWheel.test.tsx`
Expected: FAIL on the new test — `varietalLabel` prop ignored / wedges have no `data-id` yet.

- [ ] **Step 3: Rewrite TasteWheel as a thin server wrapper**

```tsx
// components/product/TasteWheel.tsx
//
// SERVER COMPONENT (no "use client"). Computes wedge geometry at build time via
// the pure taste-geometry module, then hands plain serializable props to the
// "use client" TasteWheelInteractive, which owns interaction + motion. This
// keeps the trig and tier data OUT of the client bundle (SSG-friendly).

import { buildSegments, type Tiers } from '@/lib/taste-geometry';
import { TasteWheelInteractive } from './TasteWheelInteractive';

export type { Tiers } from '@/lib/taste-geometry';
export interface Note { note: string; intensity: 1 | 2 | 3; }

interface TasteWheelProps {
  tiers: Tiers;
  size?: number;            // default 240 in current callers; wheel renders at this size
  varietalLabel?: string;   // idle center label (catalog passes grape/name)
}

export function TasteWheel({ tiers, size = 240, varietalLabel }: TasteWheelProps) {
  const { segments, order } = buildSegments(tiers, size);
  return (
    <TasteWheelInteractive
      segments={segments}
      tiers={tiers}
      order={order}
      size={size}
      varietalLabel={varietalLabel}
    />
  );
}
```

> The current default `size` is 240 (preserved). The mockup used 320; the wheel
> scales with `size`, so 240 is fine — do not change caller sizing in this task.

- [ ] **Step 4: Run the full TasteWheel test file**

Run: `cd apps/catalog && npx vitest run components/__tests__/TasteWheel.test.tsx`
Expected: PASS (all tests, including the two pre-existing legend tests and the new data-id test).

- [ ] **Step 5: Typecheck**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no errors. (If `Note`/`Tiers` re-export collides with an import elsewhere, fix the import site.)

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/components/product/TasteWheel.tsx apps/catalog/components/__tests__/TasteWheel.test.tsx
git commit -m "feat(catalog): TasteWheel becomes server wrapper over interactive layer (preserves SSG)"
```

---

## Task 5: Styling (swatch, bars, center, wedge motion, reduced-motion)

**Files:**
- Modify: `apps/catalog/app/globals.css`

- [ ] **Step 1: Replace the `.taste-note` block and add new rules**

Find the existing `.taste-note { ... }` block (around line 205) and the
`.taste-note[data-intensity='3']` / `[data-intensity='2']` rules. Replace that
whole group with:

```css
/* Per-tier color token — MUST be set or every `var(--tier-color, …)` below falls
   back to gray and the swatch/bars lose their tier color (the whole point of the
   chip<->wheel tie). Driven by the data-tier attribute the components already emit. */
.taste-note[data-tier='primary']   { --tier-color: #7c2d3a; }
.taste-note[data-tier='secondary'] { --tier-color: #8b5a2b; }
.taste-note[data-tier='tertiary']  { --tier-color: #6c6055; }
.taste-note[data-tier='flat']      { --tier-color: hsl(var(--border)); }

/* Note chip — presentational <span> OR focus <button>. A color swatch + intensity
   bars now carry tier & strength so the link to the wheel reads at rest; hover/tap
   highlights the chip and its wedge together. */
.taste-note {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 1.5px solid hsl(var(--border));
  background: #fff;
  color: hsl(var(--foreground));
  border-radius: 999px;
  padding: 0.4rem 0.85rem 0.4rem 0.65rem;
  font-size: 0.9rem;
  line-height: 1.4;
  white-space: nowrap;
  cursor: default;
  transition: transform .2s cubic-bezier(.34,1.4,.5,1), border-color .2s, background .2s, box-shadow .2s;
}
button.taste-note { cursor: pointer; }
button.taste-note:hover,
button.taste-note:focus-visible {
  transform: translateY(-2px);
  border-color: var(--tier-color, currentColor);
  box-shadow: 0 6px 16px -8px var(--tier-color, rgba(0,0,0,.3));
}
.taste-note.is-active {
  border-color: var(--tier-color, currentColor);
  background: color-mix(in srgb, var(--tier-color, hsl(var(--secondary))) 12%, #fff);
  transform: translateY(-2px);
}
.taste-note.is-faded { opacity: .4; }

.taste-note__swatch {
  width: 11px; height: 11px; border-radius: 4px; flex: 0 0 auto;
  background: var(--tier-color, hsl(var(--border)));
}
.taste-note[data-intensity='1'] .taste-note__swatch { opacity: .56; }
.taste-note[data-intensity='2'] .taste-note__swatch { opacity: .78; }
.taste-note[data-intensity='3'] .taste-note__swatch { opacity: 1; }

.taste-note__bars { display: inline-flex; gap: 2px; align-items: flex-end; }
.taste-note__bars i {
  width: 3px; border-radius: 2px; background: var(--tier-color, currentColor); opacity: .22;
}
.taste-note__bars i:nth-child(1) { height: 7px; }
.taste-note__bars i:nth-child(2) { height: 10px; }
.taste-note__bars i:nth-child(3) { height: 13px; }
.taste-note[data-intensity='1'] .taste-note__bars i:nth-child(-n+1),
.taste-note[data-intensity='2'] .taste-note__bars i:nth-child(-n+2),
.taste-note[data-intensity='3'] .taste-note__bars i:nth-child(-n+3) { opacity: 1; }

/* Wheel center readout + wrapper for absolute positioning. */
.taste-wheel__svgwrap { position: relative; display: flex; justify-content: center; }
.taste-wheel-center {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; pointer-events: none;
}
.taste-wheel-center__tier {
  font-size: 0.62rem; letter-spacing: .14em; text-transform: uppercase; font-weight: 600;
}
.taste-wheel-center__note {
  font-family: var(--font-serif, 'Cormorant Garamond', Georgia, serif);
  font-size: 1.25rem; font-weight: 600; line-height: 1.05; max-width: 8rem;
}
.taste-wheel-center__note.is-idle { font-style: italic; font-weight: 500; font-size: 1rem; color: hsl(var(--muted-foreground)); }
.taste-wheel-center__sub { font-size: 0.62rem; color: hsl(var(--muted-foreground)); margin-top: .2rem; letter-spacing: .04em; }

/* Wedge interaction + draw-in. */
.taste-wheel__wedge {
  cursor: pointer;
  transform-box: fill-box; transform-origin: center;
  transition: transform .28s cubic-bezier(.34,1.4,.5,1), opacity .25s, filter .25s;
  animation: taste-wedge-in .42s both;
  animation-delay: var(--draw-delay, 0ms);
}
.taste-wheel__wedge.is-dim { opacity: .22; }
.taste-wheel__wedge.is-hot { transform: scale(1.07); filter: drop-shadow(0 4px 10px rgba(0,0,0,.30)); }
@keyframes taste-wedge-in {
  from { transform: scale(.4); opacity: 0; }
  to   { transform: scale(1);  opacity: 1; }
}

/* Motion is enhancement, never the mechanism — kill it under reduced-motion,
   keep the chip<->wedge link fully functional. */
@media (prefers-reduced-motion: reduce) {
  .taste-wheel__wedge { animation: none; transition: opacity .15s; }
  .taste-wheel__wedge.is-hot { transform: none; }
  button.taste-note, .taste-note.is-active { transform: none; }
  button.taste-note { transition: border-color .15s, background .15s; }
}
```

> If `--font-serif` is not defined in the catalog, the center note falls back to
> `'Cormorant Garamond', Georgia, serif`. Check `globals.css`/layout for an
> existing serif token first; if the catalog has no Cormorant loaded, the Georgia
> fallback is acceptable (verify visually in Task 7).

> **Reduced-motion testing (spec §10 reconciliation):** the spec's §10 mentions a
> "mocked matchMedia" reduced-motion unit test. We deliberately DROP that unit
> test: reduced-motion here is pure CSS (`@media (prefers-reduced-motion: reduce)`),
> which jsdom cannot evaluate (no layout, no `matchMedia` by default). There is no
> JS branch on the media query to assert. Reduced-motion is instead verified in the
> browser at Task 7 Step 6. If a guard is wanted, add a CSS-presence assertion in a
> follow-up; not blocking.

- [ ] **Step 2: Build to verify CSS is valid / Tailwind compiles**

Run: `cd apps/catalog && npm run build`
Expected: build succeeds (no CSS or type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/app/globals.css
git commit -m "style(catalog): taste-note swatch/bars + wheel center + wedge motion (reduced-motion safe)"
```

---

## Task 6: Pass varietalLabel from the product page

**Files:**
- Modify: `apps/catalog/app/product/[sku]/page.tsx` (line ~272)

- [ ] **Step 1: Edit the call site**

Change:
```tsx
{tiers ? <TasteWheel tiers={tiers} /> : null}
```
to:
```tsx
{tiers ? <TasteWheel tiers={tiers} varietalLabel={product.grape_variety || product.name} /> : null}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no errors (both fields exist on `product`).

- [ ] **Step 3: Commit**

```bash
git add "apps/catalog/app/product/[sku]/page.tsx"
git commit -m "feat(catalog): show varietal name in idle taste-wheel center"
```

---

## Task 7: Browser verification — catalog (Rule 7, REQUIRED)

**No code unless a defect is found.** This task is the proof the UI works.

- [ ] **Step 1: Refresh the live export if stale** (Rule 9)

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && ls -la data/live_products_export.json`
If older than recent edits to products.db, run `.venv/bin/python scripts/refresh_live_export.py`. (Read-only browse doesn't need it, but note the age.)

- [ ] **Step 2: Pick a known-good SKU**

Find a SKU whose `taste_profile.tiers` has all of primary/secondary/tertiary populated:
```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && python3 - <<'PY'
import json
d=json.load(open('data/live_products_export.json'))
rows=d if isinstance(d,list) else d.get('products',d)
for p in rows:
    tp=(p.get('taste_profile') or {}); t=(tp.get('tiers') or {})
    if t.get('primary') and t.get('secondary') and t.get('tertiary'):
        print(p.get('sku'), '|', p.get('name')); break
PY
```
Record the SKU in this checkbox for reproducibility: **SKU = ____**

- [ ] **Step 3: Start dev server & open the product page**

Run: `cd apps/catalog && npm run dev` → open `http://localhost:3000/product/<SKU>`.

- [ ] **Step 4: Desktop walkthrough**
  - Hover each tier's chips → the matching wedge pops/glows, others dim, center names the note + tier + intensity. ✔/�’
  - Hover wedges → the matching chip activates. ✔/✗
  - Rings visibly draw in on load (reload to re-watch). ✔/✗
  - Idle center shows the varietal name. ✔/✗

- [ ] **Step 5: Mobile walkthrough (DevTools 375px)**
  - Tap a chip → locks focus (wedge hot, center named). Tap again or tap empty space → clears. ✔/✗
  - No horizontal scroll, no layout shift. ✔/✗

- [ ] **Step 6: Reduced-motion**
  - OS/DevTools "emulate prefers-reduced-motion: reduce" → no draw-in, no pop; hover/tap link still works. ✔/✗

- [ ] **Step 7: Missing-tertiary SKU**
  - Find a SKU with only primary+secondary; confirm no crash, no orphan tertiary header, empty ring renders faint. ✔/✗

- [ ] **Step 8: Commit any defect fixes** (only if needed), message `fix(catalog): <defect>`.

If all boxes pass, write a one-line confirmation in the PR/notes: "Catalog taste wheel verified in browser at desktop + 375px + reduced-motion."

---

## Task 8: Internal app port (catalog verified first)

**Do NOT start until Task 7 passes.** Mirror the catalog split into the internal
copies, with ONE difference: the internal chip click navigates to `/explore`.

**Files:**
- Create: `lib/taste-geometry.ts` (internal — or import path the internal app uses; mirror catalog, primary color `#c64633` per the internal token)
- Create: `components/product/TasteWheelInteractive.tsx` (internal)
- Modify: `components/product/TasteWheel.tsx` (internal → server-style wrapper; note it currently has `"use client"` — keep it client OR split like catalog; simplest is to keep the wrapper client since the internal app already ships client here)
- Modify: `components/product/TasteNote.tsx` (internal — keep `useRouter` + `/explore` click; ADD swatch/bars + hover highlight via a hover callback prop; click still navigates)

- [ ] **Step 0: Discover the internal app's toolchain** (this task is gated behind
  catalog success, so do the lookups now rather than assuming):

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
cat package.json | grep -A3 '"scripts"'        # test + typecheck commands
cat tsconfig.json | grep -A3 '"paths"'          # does '@/' resolve at repo root?
grep -rn "TasteWheel\|TasteProfileSection" components/ app/ --include=*.tsx | grep -v node_modules
```
Record: internal test runner = ____, typecheck cmd = ____, `@/` alias resolves? = ____.
Use relative imports in the internal copies if `@/` does NOT resolve at repo root.

- [ ] **Step 1: Mirror geometry** with internal tier colors (`primary #c64633`). If the internal app can import the catalog module, prefer that; otherwise copy and change the one color constant. Add a parity test asserting internal primary color `#c64633`.

- [ ] **Step 2: Port TasteWheelInteractive** identical to catalog EXCEPT it renders the internal `TasteNote` (navigating). Highlight is hover-driven on desktop; on touch, tapping a **wedge** drives focus (chip tap navigates) — per spec §6b.

- [ ] **Step 3: Update internal TasteNote** — keep the navigating `<button>` + `useRouter`; add `<Decoration>` (swatch/bars) and an optional `onHoverNote?` that the wheel uses for highlight. Do not remove navigation.

- [ ] **Step 4: Run internal tests** (whatever the internal app uses) + `tsc --noEmit` at repo root.

Run: `cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npx tsc --noEmit` (or the internal app's typecheck script).
Expected: no errors.

- [ ] **Step 5: Browser-verify internal (Rule 7)** — start the internal app, open a product with a full taste profile (ensure `NEXT_PUBLIC_TASTE_PROFILE_ENABLED=true`), confirm:
  - hover highlights chip↔wedge; **chip click still navigates to `/explore`**; wheel renders. ✔/✗

- [ ] **Step 6: Commit**

```bash
git add lib/taste-geometry.ts components/product/TasteWheelInteractive.tsx components/product/TasteWheel.tsx components/product/TasteNote.tsx
git commit -m "feat(internal): port linked-sunburst taste wheel (chip click keeps /explore nav)"
```

---

## Task 9: Final sweep

- [ ] **Step 1: Full catalog test + build**

Run: `cd apps/catalog && npx vitest run && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 2: Confirm no-navigation invariant on catalog (code-level)**

Run:
```bash
cd apps/catalog && ! grep -rnE "import .*useRouter|router\.push|'/explore'|\"/explore\"" components/product/ --include=*.tsx | grep -v '^\s*//' | grep .
```
Expected: no code matches (comment lines excluded).

- [ ] **Step 3: Update the spec status**

Mark the spec `Status: Implemented` and note the verified SKU.

```bash
git add docs/superpowers/specs/2026-06-21-linked-sunburst-taste-profile-design.md
git commit -m "docs: mark linked-sunburst taste profile spec implemented"
```

---

## Done criteria

- All vitest suites green; `npm run build` succeeds in `apps/catalog`.
- Catalog browser walkthrough passed at desktop + 375px + reduced-motion + missing-tertiary SKU.
- Internal app: hover highlights, chip click still navigates to `/explore`.
- Code-level no-navigation invariant holds for catalog `components/product/`.
- Spec marked Implemented with the verified SKU recorded.
