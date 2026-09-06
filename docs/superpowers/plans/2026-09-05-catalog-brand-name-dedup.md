# Catalog Brand/Name De-duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop repeating the brand name in both the catalog card/PDP title and its own eyebrow/subtitle label, and make the brand label a link into a new `/shop?brand=...` filter.

**Architecture:** One new pure string helper (`stripBrandPrefix`) applied at three render call sites (`ProductCard.tsx`, `QuickView.tsx`, PDP `page.tsx`); one new filter clause added to the existing `matchesFilters()` predicate in `lib/shop-query.ts`, mirroring the existing `country` clause; the brand label becomes a `Link` at those same three sites.

**Tech Stack:** Next.js (App Router) catalog app, TypeScript, Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-05-catalog-brand-name-dedup-design.md`

---

## Before you start

- Confirm you're in the worktree: `pwd` should end in
  `.claude/worktrees/catalog-brand-name-dedup`. All commands below assume
  your shell's cwd is `apps/catalog` inside that worktree (the Next.js app
  root, where `package.json`'s `test` script lives).
- Read the spec at
  `docs/superpowers/specs/2026-09-05-catalog-brand-name-dedup-design.md`
  fully before starting Task 1 — it has the exact slicing semantics and
  worked examples this plan implements verbatim.

---

### Task 1: `stripBrandPrefix` helper + unit tests

**Files:**
- Create: `apps/catalog/lib/product-display.ts`
- Create: `apps/catalog/lib/product-display.test.ts`

This task is pure TDD — no UI changes yet, just the helper and its tests.

- [ ] **Step 1: Write the failing tests**

Create `apps/catalog/lib/product-display.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { stripBrandPrefix } from './product-display';

describe('stripBrandPrefix', () => {
  it('strips a clean single-space prefix', () => {
    expect(stripBrandPrefix('Ardbeg 10 Years (700 ml)', 'Ardbeg')).toBe(
      '10 Years (700 ml)',
    );
  });

  it('strips a multi-word brand prefix', () => {
    expect(
      stripBrandPrefix('Coastal Ridge Cabernet Sauvignon', 'Coastal Ridge'),
    ).toBe('Cabernet Sauvignon');
  });

  it('strips a brand containing internal punctuation', () => {
    expect(
      stripBrandPrefix(
        'Max Ferd. Richter Estate Riesling',
        'Max Ferd. Richter',
      ),
    ).toBe('Estate Riesling');
  });

  it('collapses a double space left after the removed brand prefix', () => {
    // Real data shape: brand_lookup.json entries frequently have two spaces
    // between brand and the rest of the name.
    expect(
      stripBrandPrefix(
        'Talenti  Brunello di Montalcino "Piero" DOCG',
        'Talenti',
      ),
    ).toBe('Brunello di Montalcino "Piero" DOCG');
  });

  it('returns the name unchanged when it does not start with the brand', () => {
    // Real pair: brand is the parent house, name is a sub-label range name.
    expect(
      stripBrandPrefix('Tournon Victoria Shiraz', 'M. Chapoutier'),
    ).toBe('Tournon Victoria Shiraz');
  });

  it('does not strip on a mid-word false-positive prefix match', () => {
    // Word-boundary guard: "Ace" is a literal string-prefix of "Acevedo" but
    // not a whole-word prefix, so nothing should be stripped.
    expect(
      stripBrandPrefix('Acevedo Winery Malbec', 'Ace'),
    ).toBe('Acevedo Winery Malbec');
  });

  it('returns the name unchanged on a case-only mismatch (exact match only)', () => {
    // Real pair from the data: name is all-caps, brand is title-case.
    // Spec decision: no case/punctuation normalization, so this stays
    // un-deduped rather than risk false positives elsewhere.
    expect(stripBrandPrefix('VIK Milla Cala', 'Vik')).toBe('VIK Milla Cala');
  });

  it('returns the original name when name === brand exactly', () => {
    expect(stripBrandPrefix('Talenti', 'Talenti')).toBe('Talenti');
  });

  it('returns the original name when name is brand plus only trailing whitespace', () => {
    expect(stripBrandPrefix('Talenti   ', 'Talenti')).toBe('Talenti   ');
  });

  it('returns the name unchanged when brand is undefined', () => {
    expect(stripBrandPrefix('Some Wine Name', undefined)).toBe(
      'Some Wine Name',
    );
  });

  it('returns the name unchanged when brand is an empty/whitespace-only string', () => {
    expect(stripBrandPrefix('Some Wine Name', '   ')).toBe('Some Wine Name');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- product-display` (from `apps/catalog/`)
Expected: FAIL — `Cannot find module './product-display'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `apps/catalog/lib/product-display.ts`:

```typescript
/**
 * stripBrandPrefix — remove a redundant leading brand name from a product's
 * full display name, so a UI that already shows the brand as its own label
 * (card subtitle, PDP eyebrow) doesn't repeat it inside the title too.
 *
 * Exact, case-sensitive prefix match only (no normalization) — see
 * docs/superpowers/specs/2026-09-05-catalog-brand-name-dedup-design.md for
 * the data audit behind this decision: ~90.5% of the catalog is a clean
 * prefix match; the remaining ~9.5% (case/punctuation mismatches, or names
 * that don't restate the brand at all, e.g. a parent house vs. a sub-label)
 * intentionally keep showing both fields untouched rather than risk a wrong
 * strip.
 *
 * Includes a word-boundary guard: a brand that is a literal string-prefix of
 * the name's first word but not a whole-word prefix (e.g. brand "Ace"
 * against name "Acevedo Winery Malbec") must NOT be stripped.
 */
export function stripBrandPrefix(name: string, brand: string | undefined): string {
  if (!brand || brand.trim() === '') return name;
  if (!name.startsWith(brand)) return name;

  const boundaryChar = name[brand.length];
  const isWordBoundary =
    boundaryChar === undefined || /[^\p{L}\p{N}]/u.test(boundaryChar);
  if (!isWordBoundary) return name;

  const remainder = name.slice(brand.length).replace(/^\s+/, '');
  return remainder === '' ? name : remainder;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- product-display` (from `apps/catalog/`)
Expected: PASS — all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/product-display.ts apps/catalog/lib/product-display.test.ts
git commit -m "feat(catalog): add stripBrandPrefix helper for card/PDP titles

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Apply `stripBrandPrefix` to `ProductCard.tsx`

**Files:**
- Modify: `apps/catalog/components/ProductCard.tsx:12` (import), `:118` (subtitle line, unchanged, for context), `:236-238` (title render)

- [ ] **Step 1: Add the import**

In `apps/catalog/components/ProductCard.tsx`, add to the existing import block (near the other `@/lib/*` imports, e.g. right after the `resolveSale` import at line 11):

```typescript
import { stripBrandPrefix } from '@/lib/product-display';
```

- [ ] **Step 2: Compute the display name and use it in the title**

Find this block (around line 118):

```typescript
  const subtitle = product.brand || product.region;
```

Add a line right after it:

```typescript
  const subtitle = product.brand || product.region;
  const displayName = stripBrandPrefix(product.name, product.brand);
```

Then find the title render (around line 236-238):

```tsx
            <h3 className="line-clamp-2 text-lg font-medium leading-snug text-foreground">
              {product.name}
            </h3>
```

Change `{product.name}` to `{displayName}`:

```tsx
            <h3 className="line-clamp-2 text-lg font-medium leading-snug text-foreground">
              {displayName}
            </h3>
```

**Do not** change the `aria-label={`Quick look at ${product.name}`}` on the
quick-look button (line 219) or the `alt={product.name}` on the image (line
152) — those stay on the full, canonical name intentionally (accessibility
labels and alt text should describe the complete product, not the
shortened display title).

- [ ] **Step 3: Manual sanity check (no automated test for this component yet)**

This component has no existing test file (grep confirms no
`ProductCard.test.tsx`), so there's nothing to run here — verification
happens visually in Task 6. Just re-read your diff and confirm you only
changed the two lines above.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/components/ProductCard.tsx
git commit -m "feat(catalog): shorten ProductCard title by stripping brand prefix

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Apply `stripBrandPrefix` to `QuickView.tsx`

**Files:**
- Modify: `apps/catalog/components/QuickView.tsx:16` (import), `:72` (subtitle, unchanged, for context), `:102-104` (title render)

Same pattern as Task 2, applied to the "quick look" modal (flagged during
brainstorming as sharing the identical bug, even though it wasn't in the
original screenshots).

- [ ] **Step 1: Add the import**

In `apps/catalog/components/QuickView.tsx`, add to the import block (after the `stripToText` import at line 15):

```typescript
import { stripBrandPrefix } from '@/lib/product-display';
```

- [ ] **Step 2: Compute the display name and use it in the title**

Find (around line 72):

```typescript
  const subtitle = product.brand || product.region;
```

Add right after:

```typescript
  const subtitle = product.brand || product.region;
  const displayName = stripBrandPrefix(product.name, product.brand);
```

Find the title render (around line 102-104):

```tsx
              <DialogTitle className="text-2xl font-semibold leading-snug text-foreground">
                {product.name}
              </DialogTitle>
```

Change to:

```tsx
              <DialogTitle className="text-2xl font-semibold leading-snug text-foreground">
                {displayName}
              </DialogTitle>
```

**Do not** change `alt={product.name}` on the image (line 88), or the
`sr-only` `DialogDescription` fallback text (`` `${product.name} — quick
preview}` ``, line 142) — both intentionally use the full canonical name.

- [ ] **Step 3: Manual sanity check**

No existing test file for `QuickView.tsx` either — re-read your diff,
confirm only the two lines changed. Automated coverage lives entirely in
`stripBrandPrefix`'s own unit tests (Task 1); the component-level
verification is the manual browser pass in Task 6.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/components/QuickView.tsx
git commit -m "feat(catalog): shorten QuickView title by stripping brand prefix

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Apply `stripBrandPrefix` to the PDP + make the brand eyebrow a link

**Files:**
- Modify: `apps/catalog/app/product/[sku]/page.tsx:18` (import), `:396-403` (eyebrow + title)

This task also makes the brand eyebrow clickable, since the PDP is the
first of the two link sites (Task 5 does the card).

- [ ] **Step 1: Add the import**

In `apps/catalog/app/product/[sku]/page.tsx`, add to the `@/lib/*` import block (e.g. right after `import { buildContactLinks } from '@/lib/contact';` at line 18):

```typescript
import { stripBrandPrefix } from '@/lib/product-display';
```

`Link` is already imported at line 2 (`import Link from 'next/link';`) — no new import needed for that.

- [ ] **Step 2: Replace the brand eyebrow + title block**

Find this block (around line 396-403):

```tsx
            {product.brand ? (
              <p className="pr-20 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {product.brand}
              </p>
            ) : null}
            <h1 className="pr-20 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              {product.name}
            </h1>
```

Replace with:

```tsx
            {product.brand ? (
              <Link
                href={`/shop?brand=${encodeURIComponent(product.brand)}`}
                className="pr-20 text-sm font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
              >
                {product.brand}
              </Link>
            ) : null}
            <h1 className="pr-20 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              {stripBrandPrefix(product.name, product.brand)}
            </h1>
```

**Do not** change any other use of `product.name` on this page — the
breadcrumb, `generateMetadata`'s `<title>`/description, the
`ViewItemTracker` GA4 payload, `buildContactLinks`'s prefill text, the
`JsonLd` structured data, or `TasteWheel`'s varietal-label fallback. Per
the spec, these are SEO/analytics/integration surfaces that must keep the
full canonical name.

- [ ] **Step 3: Manual sanity check**

Grep to confirm you didn't accidentally touch another `product.name`
occurrence on this page:

Run: `grep -n "product.name" "app/product/[sku]/page.tsx"`
Expected: every other line still says `product.name` (breadcrumb, JSON-LD,
etc.) — only the `<h1>` line now reads
`stripBrandPrefix(product.name, product.brand)`.

- [ ] **Step 4: Commit**

```bash
git add "apps/catalog/app/product/[sku]/page.tsx"
git commit -m "feat(catalog): shorten PDP title and link brand eyebrow to /shop filter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Add the `brand` filter clause + link the card subtitle

**Files:**
- Modify: `apps/catalog/lib/shop-query.ts:24` (doc comment), `:190-191` (add clause after `country`)
- Modify: `apps/catalog/components/ProductCard.tsx` (subtitle → link)
- Test: `apps/catalog/lib/shop-query.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to the end of `apps/catalog/lib/shop-query.test.ts` (after the existing sake/shochu `describe` block):

```typescript
describe('matchesFilters brand', () => {
  it('brand param filters by exact (case-insensitive) brand match', () => {
    const prodWithBrand = (name: string, brand: string) =>
      ({ sku: 'X', name, brand, country: 'France' }) as any;
    expect(
      matchesFilters(prodWithBrand('Talenti Brunello', 'Talenti'), {
        brand: 'Talenti',
      }),
    ).toBe(true);
    expect(
      matchesFilters(prodWithBrand('Talenti Brunello', 'Talenti'), {
        brand: 'talenti',
      }),
    ).toBe(true);
    expect(
      matchesFilters(prodWithBrand('Talenti Brunello', 'Talenti'), {
        brand: 'Ardbeg',
      }),
    ).toBe(false);
    expect(matchesFilters(prodWithBrand('Talenti Brunello', 'Talenti'), {})).toBe(
      true,
    );
  });

  it('brand param excludes products with no brand at all', () => {
    const prodNoBrand = { sku: 'X', name: 'Mystery Bottle', country: 'France' } as any;
    expect(matchesFilters(prodNoBrand, { brand: 'Talenti' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- shop-query` (from `apps/catalog/`)
Expected: the two new tests FAIL (brand filter has no effect yet, so
`matchesFilters` returns `true` for the `brand: 'Ardbeg'` case that should
be `false`).

- [ ] **Step 3: Add the filter clause**

In `apps/catalog/lib/shop-query.ts`, find the `country` clause (around line 190-191):

```typescript
  const country = norm(firstParam(params.country));
  if (country && norm(p.country) !== country) return false;
```

Add a `brand` clause right after it:

```typescript
  const country = norm(firstParam(params.country));
  if (country && norm(p.country) !== country) return false;

  const brand = norm(firstParam(params.brand));
  if (brand && norm(p.brand) !== brand) return false;
```

Also update the doc comment near the top of the file (around line 24, right after the `country` line in the "Filter semantics" list) to document the new param:

```typescript
 *   country   → exact (case-insensitive) match on country
 *   brand     → exact (case-insensitive) match on brand. Reachable today only
 *               by clicking a brand name on a card/PDP (?brand=...); there is
 *               no facet checkbox for it in Filters.tsx (out of scope, see
 *               docs/superpowers/specs/2026-09-05-catalog-brand-name-dedup-design.md).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- shop-query` (from `apps/catalog/`)
Expected: PASS — all tests in `shop-query.test.ts` green, including the two new ones.

- [ ] **Step 5: Link the card subtitle to the brand filter**

In `apps/catalog/components/ProductCard.tsx`, find the subtitle render (around line 239-243):

```tsx
            {subtitle ? (
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
```

The subtitle falls back to `product.region` when there's no brand
(`subtitle = product.brand || product.region`), so it must only become a
link when it's actually showing the brand. Replace with:

```tsx
            {subtitle ? (
              product.brand ? (
                <Link
                  href={`/shop?brand=${encodeURIComponent(product.brand)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  {subtitle}
                </Link>
              ) : (
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {subtitle}
                </p>
              )
            ) : null}
```

The `onClick={(e) => e.stopPropagation()}` is required because this
subtitle sits **inside** the card's own `<Link href={/product/${sku}}>`
(see the component doc comment at the top of the file, lines 26-30, which
already documents this exact pattern for the quick-look button). Without
it, clicking the brand name would also trigger the outer card link's
navigation to the product page.

`Link` is already imported in this file (line 4) — no new import needed.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test` (from `apps/catalog/`)
Expected: PASS — no test files broken by this change.

- [ ] **Step 7: Commit**

```bash
git add apps/catalog/lib/shop-query.ts apps/catalog/lib/shop-query.test.ts apps/catalog/components/ProductCard.tsx
git commit -m "feat(catalog): add brand filter to shop query, link card subtitle to it

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Manual browser verification (Rule 7 — required, not optional)

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (from `apps/catalog/`; per project memory, the catalog
dev server runs on **port 3100**, not 3212 — if you get a "Cannot find
module" 500 error, run `rm -rf .next` first and restart)

- [ ] **Step 2: Verify the shop grid**

Open `http://localhost:3100/shop` in a browser. Confirm:
- Cards for brands with a clean prefix match (e.g. search/scroll to find a
  Talenti, Ardbeg, or AnCnoc product) show a **shortened title** that no
  longer repeats the brand, with the brand still visible as the subtitle
  line above/below it.
- A product whose brand does NOT prefix its name (if findable in the live
  catalog — check a few from a house/négociant brand like "M. Chapoutier")
  still shows both the full brand subtitle and the full, untouched title.
- No card shows a blank or garbled title (regression check for the
  word-boundary edge case).

- [ ] **Step 3: Verify the brand link navigates and filters correctly**

Click a brand subtitle on any card (not the card body itself — confirm the
click does NOT navigate to the product page, only the brand link's own
href).
Confirm the URL becomes `http://localhost:3100/shop?brand=<BrandName>`
(URL-encoded, e.g. `%20` for spaces if the brand has multiple words) and
the grid now shows only that brand's products.

- [ ] **Step 4: Verify the "quick look" modal**

From `/shop`, click the "Quick look" (eye icon) button on a card. Confirm
the modal title is also shortened the same way as the card, and the
subtitle inside the modal is unchanged.

- [ ] **Step 5: Verify the PDP**

Navigate to any product detail page (click through from the grid, or visit
`/product/<SKU>` directly for a SKU you saw on the grid). Confirm:
- The brand eyebrow above the `<h1>` is now a clickable link (hover shows
  underline).
- Clicking it navigates to `/shop?brand=<BrandName>` filtered correctly.
- The `<h1>` title is shortened the same way as the card.
- The page `<title>` (browser tab) and the breadcrumb still show the FULL
  product name (open dev tools / view page source on `<title>` to confirm
  — this is the "don't touch SEO surfaces" invariant from the spec).

- [ ] **Step 6: No commit for this task** — it's verification only. If any
  step above surfaces a bug, fix it as part of the relevant earlier task
  (amend via a new commit, not `--amend`, per project git rules) and
  re-verify.

---

### Task 7: Run the full build to catch cross-file issues

**Files:** none (verification only)

- [ ] **Step 1: Run the production build**

Run: `npm run build` (from `apps/catalog/`)
Expected: build succeeds with no TypeScript errors. This catches anything
the dev server's incremental compiler might not (per project memory:
"Gate on build, not just tests" — cross-branch/cross-file issues only
surface in a full build).

- [ ] **Step 2: If the build fails**, fix the reported errors before
  proceeding — do not skip this step or declare the feature done with a
  failing build.

---

## Done criteria

- [ ] All new/modified unit tests pass (`npm test`)
- [ ] Production build succeeds (`npm run build`)
- [ ] Manual browser walkthrough (Task 6) completed with no visual
      regressions
- [ ] No changes to any file under `data/` or any SEO/analytics/JSON-LD
      surface
- [ ] All commits made incrementally per task (not one giant commit)
