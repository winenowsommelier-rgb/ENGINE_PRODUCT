# Critic-Score Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the critic scores already stored on every product (`score_max` + `score_summary`) as a polished two-form badge — a segmented "data strip" on the product detail panel and a compact inline score chip in the product list grid.

**Architecture:** One pure, React-free parse helper (`lib/explore/critic-score.ts`) turns the `score_summary` JSON string into a typed, sorted result with a lead critic identified. One presentational component (`CriticScoreBadge.tsx`) renders `variant="detail"` or `variant="compact"` from that result, theme-aware, render-nothing when unscored. Two integration edits wire it into the detail panel and the list-grid tile. No DB/API/loader changes.

**Tech Stack:** TypeScript, React (Next.js), Tailwind, lucide-react. Parse helper verified with a standalone `tsx` script (root PIM app has no React test runner).

**Spec:** `docs/superpowers/specs/2026-06-20-critic-score-badge-design.md`

---

## Decisions locked from brainstorming

- **Build both forms this pass.** Detail = segmented strip; compact = inline score chip wired into the **list grid** (`ProductsPage.tsx`).
- **Grid layout reality:** the grid is a **list-row layout** (`ProductImage size="sm"` + name/SKU + badges row), NOT a card grid. So the compact form is an **inline chip in the existing badges row** (`ProductsPage.tsx:585`, beside classification/tier chips), NOT a pill pinned over the thumbnail. This fits the surrounding chips and avoids cramming an overlay onto a 40px thumbnail.
- **Static, full a11y.** No click-through (no source URLs in current data). `aria-label` + `title` carry the full critic list.
- **Gold accent** `#A16207`-family, matching existing `wine_classification` amber chips. Tabular numbers. Lead cell = the critic whose score equals `score_max` (epsilon-tolerant match).

## File Structure

- `lib/explore/critic-score.ts` — **new.** Pure parse helper + types. No React import. The only place `score_summary` JSON is parsed. Single responsibility: string → `ParsedCriticScores | null`.
- `components/product/CriticScoreBadge.tsx` — **new.** Presentational component, both variants, theme-aware, returns `null` when no scores.
- `components/product/ProductDetailPanel.tsx` — **modify.** Insert `<CriticScoreBadge variant="detail">` after the stats grid in Card 1.
- `components/pages/ProductsPage.tsx` — **modify.** Insert `<CriticScoreBadge variant="compact">` into the badges row (~line 585).
- `scripts/check_critic_badge_parse.ts` — **new.** Standalone `tsx` assertions for the parse helper.

---

## Task 1: Parse helper (`lib/explore/critic-score.ts`)

**Files:**
- Create: `lib/explore/critic-score.ts`
- Test: `scripts/check_critic_badge_parse.ts`

- [ ] **Step 1: Write the failing test script**

Create `scripts/check_critic_badge_parse.ts`:

```ts
import { parseCriticScores } from "../lib/explore/critic-score";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { console.error("FAIL:", name); failures++; }
  else console.log("ok:", name);
}

const good = JSON.stringify({
  critics: [
    { abbr: "JS", critic: "James Suckling", score_native: "100", score_value: 100 },
    { abbr: "WA", critic: "Wine Advocate", score_native: "99", score_value: 99 },
    { abbr: "WS", critic: "Wine Spectator", score_native: "95", score_value: 95 },
  ],
  community: [], medals: [], rows_total: 3,
});

// valid → parsed, sorted, lead identified
const r = parseCriticScores(100, good);
check("valid parses", r !== null);
check("critics length 3", r!.critics.length === 3);
check("sorted desc", r!.critics[0].score_value >= r!.critics[1].score_value);
check("lead is score_max match", r!.lead.abbr === "JS" && r!.lead.score_value === 100);
check("overflow count = 2", r!.overflow === 2);
check("aria-label full", r!.ariaLabel.includes("James Suckling 100") && r!.ariaLabel.includes("Wine Spectator 95"));

// epsilon-tolerant lead match (float 100.0 vs 100)
check("float lead match", parseCriticScores(100.0, good)!.lead.abbr === "JS");

// malformed JSON → null
check("malformed → null", parseCriticScores(90, "{not json") === null);

// empty critics → null
check("empty critics → null", parseCriticScores(90, JSON.stringify({ critics: [], community: [], medals: [] })) === null);

// no score_max → null
check("null scoreMax → null", parseCriticScores(null, good) === null);

// scoreMax present but matches no critic → falls back to critics[0] as lead
const noMatch = parseCriticScores(101, good);
check("fallback lead = critics[0]", noMatch !== null && noMatch.lead.abbr === "JS");

// respects maxCritics cap
check("maxCritics cap", parseCriticScores(100, good, 2)!.critics.length === 2);

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("\nALL PASS");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node_modules/.bin/tsx scripts/check_critic_badge_parse.ts`
Expected: FAIL — `Cannot find module '../lib/explore/critic-score'`.

- [ ] **Step 3: Implement the helper**

Create `lib/explore/critic-score.ts`:

```ts
// Pure parse helper for the critic-score badge. NO React import.
// Turns the score_summary JSON string into a typed, sorted, lead-identified result.

export interface CriticEntry {
  abbr: string;        // "JS"
  critic: string;      // "James Suckling"
  score_native: string;// "100"  (display string)
  score_value: number; // 100    (for math)
}

export interface ParsedCriticScores {
  critics: CriticEntry[]; // sorted desc, capped at maxCritics
  lead: CriticEntry;      // the score_max critic (or critics[0] fallback)
  overflow: number;       // count of critics beyond the lead (for "+N")
  ariaLabel: string;      // "Critic scores: James Suckling 100, Wine Advocate 99, ..."
}

const EPS = 0.001;

/**
 * @param scoreMax     products.score_max (number) — gate; null/undefined → no badge
 * @param scoreSummary products.score_summary (JSON string) — parsed here, safely
 * @param maxCritics   cap on rendered critics (default 4); lead always included
 * @returns ParsedCriticScores, or null when there is nothing to render
 */
export function parseCriticScores(
  scoreMax: number | null | undefined,
  scoreSummary: string | null | undefined,
  maxCritics = 4,
): ParsedCriticScores | null {
  if (scoreMax === null || scoreMax === undefined) return null;
  if (!scoreSummary) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(scoreSummary);
  } catch {
    return null; // malformed JSON must never throw / blank a card
  }

  const critics = Array.isArray((raw as { critics?: unknown })?.critics)
    ? ((raw as { critics: unknown[] }).critics.filter(
        (c): c is CriticEntry =>
          !!c && typeof c === "object" &&
          typeof (c as CriticEntry).abbr === "string" &&
          typeof (c as CriticEntry).score_value === "number",
      ))
    : [];

  if (critics.length === 0) return null;

  // Loader guarantees desc order, but don't trust it — sort defensively.
  const sorted = [...critics].sort((a, b) => b.score_value - a.score_value);

  const lead =
    sorted.find((c) => Math.abs(c.score_value - scoreMax) < EPS) ?? sorted[0];

  const capped = sorted.slice(0, Math.max(1, maxCritics));

  const ariaLabel =
    "Critic scores: " +
    sorted.map((c) => `${c.critic} ${c.score_native}`).join(", ");

  return { critics: capped, lead, overflow: sorted.length - 1, ariaLabel };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node_modules/.bin/tsx scripts/check_critic_badge_parse.ts`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` (or `npm run typecheck`)
Expected: no new errors in `lib/explore/critic-score.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/explore/critic-score.ts scripts/check_critic_badge_parse.ts
git commit -m "feat(critic-badge): pure parse helper for score_summary + tsx assertions"
```

---

## Task 2: Badge component (`CriticScoreBadge.tsx`)

**Files:**
- Create: `components/product/CriticScoreBadge.tsx`

Tailwind tokens reused from existing code: dark surface `bg-white/5` / `bg-white/[0.03]`, hairline `border-white/10`, gold `amber-500/15` + `amber-300` + `amber-500/25` (already used by `wine_classification` chip at `ProductDetailPanel.tsx:335`). Light theme mirrors the stat-tile pattern (`bg-slate-100`, `text-slate-800`).

- [ ] **Step 1: Implement the component**

Create `components/product/CriticScoreBadge.tsx`:

```tsx
import { parseCriticScores } from "@/lib/explore/critic-score";

export interface CriticScoreBadgeProps {
  scoreMax?: number | null;
  scoreSummary?: string | null;
  variant: "detail" | "compact";
  theme?: "dark" | "light";
  maxCritics?: number;
}

export function CriticScoreBadge({
  scoreMax,
  scoreSummary,
  variant,
  theme = "dark",
  maxCritics = 4,
}: CriticScoreBadgeProps) {
  const parsed = parseCriticScores(scoreMax, scoreSummary, maxCritics);
  if (!parsed) return null; // render-nothing contract
  const light = theme === "light";

  if (variant === "compact") {
    // Inline chip for the list-grid badges row. Lead score + abbr + "+N".
    return (
      <span
        aria-label={parsed.ariaLabel}
        title={parsed.ariaLabel}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums border ${
          light
            ? "bg-amber-50 text-amber-800 border-amber-200"
            : "bg-amber-500/15 text-amber-300 border-amber-500/25"
        }`}
      >
        <span className="font-bold">{parsed.lead.score_native}</span>
        <span className="opacity-80">{parsed.lead.abbr}</span>
        {parsed.overflow > 0 && (
          <span className={light ? "text-amber-600" : "text-amber-300/70"}>
            +{parsed.overflow}
          </span>
        )}
      </span>
    );
  }

  // variant === "detail" — segmented data strip.
  return (
    <div aria-label={parsed.ariaLabel}>
      <p
        className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
          light ? "text-slate-500" : "text-slate-500"
        }`}
      >
        Critic Scores
      </p>
      <div
        className={`inline-flex items-stretch rounded-[10px] overflow-hidden tabular-nums border ${
          light ? "bg-white border-slate-200" : "bg-white/[0.03] border-white/10"
        }`}
      >
        {parsed.critics.map((c, i) => {
          const isLead = c.abbr === parsed.lead.abbr && c.score_value === parsed.lead.score_value;
          const divider = light ? "border-slate-200" : "border-white/[0.08]";
          const leadBg = isLead
            ? light
              ? "bg-gradient-to-b from-amber-50 to-white"
              : "bg-gradient-to-b from-amber-500/[0.16] to-amber-500/[0.05]"
            : "";
          return (
            <div
              key={`${c.abbr}-${i}`}
              className={`flex flex-col gap-0.5 px-3.5 py-2 min-w-[54px] ${leadBg} ${
                i < parsed.critics.length - 1 ? `border-r ${divider}` : ""
              }`}
            >
              <span
                className={`text-[9px] font-bold uppercase tracking-wide ${
                  isLead
                    ? light ? "text-amber-700" : "text-amber-300"
                    : light ? "text-slate-400" : "text-slate-500"
                }`}
              >
                {c.abbr}
              </span>
              <span
                className={`text-base font-bold leading-none ${
                  isLead
                    ? light ? "text-amber-800" : "text-amber-100"
                    : light ? "text-slate-800" : "text-slate-100"
                }`}
              >
                {c.score_native}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (Confirms the `@/lib/explore/critic-score` import path resolves and JSX is valid.)

- [ ] **Step 3: Commit**

```bash
git add components/product/CriticScoreBadge.tsx
git commit -m "feat(critic-badge): two-variant CriticScoreBadge component (detail strip + compact chip)"
```

---

## Task 3: Wire into the detail panel

**Files:**
- Modify: `components/product/ProductDetailPanel.tsx`

The detail panel's Card 1 ends with the stats grid then `<ConfBar>` (~lines 342-389). Insert the badge between the stats grid block and the `<ConfBar>` wrapper, or immediately after the `ConfBar` `<div className="mt-3">` — pick the spot directly after the `</div>` that closes the stats grid, before the `ConfBar` wrapper, so scores sit with the other headline facts.

- [ ] **Step 1: Add the import**

At the top of `ProductDetailPanel.tsx`, with the other component imports:

```tsx
import { CriticScoreBadge } from "@/components/product/CriticScoreBadge";
```

- [ ] **Step 2: Insert the badge after the stats grid**

Find the closing of the stats grid `<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4"> ... </div>` (the block that ends right before `<div className="mt-3"><ConfBar .../></div>`). Immediately after that grid's closing `</div>`, add:

```tsx
        <div className="mt-4">
          <CriticScoreBadge
            variant="detail"
            scoreMax={typeof product.score_max === "number" ? product.score_max : null}
            scoreSummary={product.score_summary ?? null}
            theme={theme}
          />
        </div>
```

(Renders nothing for unscored products, so no empty gap appears.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/product/ProductDetailPanel.tsx
git commit -m "feat(critic-badge): show detail score strip in ProductDetailPanel"
```

---

## Task 4: Wire into the list-grid tile

**Files:**
- Modify: `components/pages/ProductsPage.tsx`

Target: the badges row at ~line 585 (`<div className="flex items-center gap-1.5 mt-1.5">` containing `classificationBadge`, tier chip, variants chip). Add the compact badge as the first child so the score leads the chip row.

`Product` in this file is a record-like type; `score_max` / `score_summary` may not be declared on it. Read them defensively via `String()`/`Number()` guards consistent with the file's existing style (it uses `String(p.sku ?? '')` etc.).

- [ ] **Step 1: Add the import**

With the other imports at the top of `ProductsPage.tsx`:

```tsx
import { CriticScoreBadge } from "@/components/product/CriticScoreBadge";
```

- [ ] **Step 2: Insert the compact badge into the badges row**

Inside `<div className="flex items-center gap-1.5 mt-1.5">` (line ~585), as the FIRST child, before `{classificationBadge(...)}`:

```tsx
                  <CriticScoreBadge
                    variant="compact"
                    theme="dark"
                    scoreMax={
                      p.score_max != null && p.score_max !== ""
                        ? Number(p.score_max)
                        : null
                    }
                    scoreSummary={p.score_summary != null ? String(p.score_summary) : null}
                  />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. If `Product` type rejects `p.score_max`/`p.score_summary`, add them as optional fields to the local `Product` type (`score_max?: number | string | null; score_summary?: string | null;`) — match how other optional product fields are declared in this file.

- [ ] **Step 4: Commit**

```bash
git add components/pages/ProductsPage.tsx
git commit -m "feat(critic-badge): show compact score chip in product list grid"
```

---

## Task 5: Browser verification (Rule 7 — the real proof)

**No code.** This is the mandatory UI proof. Do not claim done until screenshots confirm render.

- [ ] **Step 1: Start dev server**

Run: `npm run dev:vscode` (background). Wait for `Ready`.

- [ ] **Step 2: Verify the list-grid compact chip**

Open `http://localhost:3000` → the products page. Confirm:
- A scored product (e.g. search/scroll to `Dominus Estate 2016`, SKU `WRW2301BN`) shows a gold compact chip in its badges row reading the lead score + abbr (+N).
- An UNSCORED product shows NO chip and NO empty gap / layout shift in the badges row.
- Screenshot.

- [ ] **Step 3: Verify the detail strip (both themes)**

Click a scored product to open `ProductDetailPanel`. Confirm:
- The "Critic Scores" segmented strip renders after the stats grid.
- The gold lead cell is the critic whose score = `score_max` (for `WRW1766AE`: JS 100 leads; for `WRW2301BN`: WA 100 leads).
- Numbers are aligned (tabular). If a light-theme surface is reachable, confirm legibility; otherwise note dark-only verified.
- Open an unscored product → NO "Critic Scores" block, no empty gap.
- Screenshot detail (scored) + detail (unscored).

- [ ] **Step 4: Report**

Paste the parse-script `ALL PASS`, the typecheck result, and the screenshots/observations. If any state renders wrong, fix before claiming done (no fake-green).

---

## Notes for the implementer

- The parse helper is the only place JSON is parsed — both variants and any future surface reuse it. Do not inline a second `JSON.parse`.
- `score_summary` is a **string** in the data even though `ExploreProduct` types it `string`. Always pass it through, let the helper parse.
- Coverage caveat to surface (not hide): only ~1,550 of 11,436 products are scored, so most tiles show no chip — that's correct, not a bug.
- Do NOT touch the loader, DB, or `refresh_live_export.py`. Render-only.
