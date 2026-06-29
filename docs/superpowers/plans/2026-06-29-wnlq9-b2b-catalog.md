# WNLQ9.B2B Wholesale Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-gated B2B wholesale catalog at `b2b.wnlq9.shop` that mirrors the public catalog but shows only wholesale (`b2b_price`) pricing, in a denser layout, to authenticated trade users.

**Architecture:** A new sibling Next.js app `apps/catalog-b2b` reuses the public catalog's engine (taxonomy, filters, finder, explore, price-format, derivation) via a shared mechanism resolved in Phase 0. It loads a separate, B2B-only data file (`data/b2b_products_export.json`) produced by a new export script. A shared-password middleware gate (HMAC-signed HttpOnly cookie) protects all routes. Deployed as a separate Vercel project. The public app is unchanged except one footer link.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind, Radix, Vitest (TS); Python 3 + sqlite3 (export script); Vercel.

**Spec:** `docs/superpowers/specs/2026-06-29-wnlq9-b2b-catalog-design.md`

**Working branch:** `feat/wnlq9-b2b-catalog-spec` (continue here, or branch `feat/wnlq9-b2b-catalog` off it).

---

## File Structure

**New (Python pipeline):**
- `scripts/refresh_b2b_export.py` — generates `data/b2b_products_export.json` (b2b_price-only, filtered).
- `scripts/refresh_all_exports.py` — wrapper running both public + B2B exports.
- `tests/test_b2b_export_invariants.py` — data invariants + leak guards (both directions) + staleness.

**New (B2B app — exact layout decided in Phase 0):**
- `apps/catalog-b2b/` — Next.js app: `package.json`, `next.config.mjs`, `tsconfig.json`, `.vercel/project.json`, `tailwind.config.ts`, `app/`, `components/`, `lib/`, `public/`.
- `apps/catalog-b2b/lib/catalog-data.ts` — B2B data loader + `B2B_PUBLIC_FIELDS` allowlist + derivation.
- `apps/catalog-b2b/lib/auth.ts` — cookie sign/verify (HMAC).
- `apps/catalog-b2b/middleware.ts` — auth gate.
- `apps/catalog-b2b/app/login/page.tsx` + `apps/catalog-b2b/app/api/login/route.ts` — password gate.
- `apps/catalog-b2b/components/ProductCardB2B.tsx`, `ProductListB2B.tsx`, `ViewToggle.tsx` — denser UI.
- `apps/catalog-b2b/app/robots.ts` (disallow all), layout metadata (noindex). NO `sitemap.ts`.

**Shared engine (Phase 0 decides: `packages/catalog-core` package vs. per-app alias override).**

**Modified (public app — single change):**
- `apps/catalog/components/Footer.tsx` — add "B2B" link → `https://b2b.wnlq9.shop`.

---

## Phase 0 — GATING SPIKE: cross-app shared imports

**Why first:** Every later task depends on HOW `apps/catalog-b2b` reaches the engine. Reused finder/explore/detail code internally imports `@/lib/catalog-data`, which resolves to the PUBLIC loader. We must make that alias resolve to the B2B loader (with B2B allowlist + B2B data file) without breaking the public app's build. Output: a documented decision + a proven-building minimal skeleton.

### Task 0.1: Reconnaissance of shared-code coupling

**Files:**
- Read only: `apps/catalog/lib/catalog-data.ts`, `apps/catalog/tsconfig.json`, `apps/catalog/next.config.mjs`, `apps/catalog/lib/finder/*`, `apps/catalog/lib/explore*`, `apps/catalog/components/ProductCard.tsx`, `apps/catalog/app/product/[sku]/page.tsx`.

- [ ] **Step 1:** Enumerate every module the B2B app must reuse and grep each for `@/lib/catalog-data`, `getAllProducts`, `getProductBySku`, `PUBLIC_FIELDS`, `toPublicProduct`. Record which reused modules hard-depend on the data loader.

Run: `cd "apps/catalog" && grep -rn "catalog-data\|getAllProducts\|getProductBySku\|toPublicProduct\|PUBLIC_FIELDS" lib components app | sort`
Expected: a list of import sites. Save it to the plan's scratch notes.

- [ ] **Step 2:** Confirm the `@/` alias config and Next monorepo settings.

Run: `cd "apps/catalog" && cat tsconfig.json | grep -A5 paths && cat next.config.mjs`
Expected: see `@/*` → `./*` (or similar) and any `transpilePackages`/`outputFileTracingRoot`.

### Task 0.2: Build a minimal two-app skeleton proving the chosen mechanism

**Decision rule (Rule 11 — recommend, then build):** Default to **`packages/catalog-core`** (a workspace package holding the engine with the data loader injected/parameterized) UNLESS Task 0.1 shows the coupling is shallow enough that a per-app `@/lib/catalog-data` alias override is clean. Document the choice + reasoning in the plan before proceeding.

**Files (if package approach):**
- Create: `packages/catalog-core/package.json`, `packages/catalog-core/src/index.ts` (re-exports engine), `packages/catalog-core/src/data.ts` (loader takes export-path + allowlist as params).
- Modify: root `package.json` (workspaces), `apps/catalog/next.config.mjs` (`transpilePackages: ['catalog-core']`).

- [ ] **Step 1:** Scaffold `apps/catalog-b2b` as a throwaway-minimal Next app (one page that calls the shared `getAllProducts` pointed at a 3-row fixture JSON) + wire the chosen mechanism.

- [ ] **Step 2: Verify BOTH apps build.** This is the gate.

Run: `cd "apps/catalog" && NODE_OPTIONS='--max-old-space-size=4096' npx next build` then `cd "../catalog-b2b" && NODE_OPTIONS='--max-old-space-size=4096' npx next build`
Expected: both builds succeed; B2B page renders the 3 fixture rows; public build unaffected.

- [ ] **Step 3:** If the chosen mechanism fails to build, switch to the alternative and repeat. Do NOT proceed to Phase 1 until both apps build with shared imports working.

- [ ] **Step 4: Commit** the skeleton + the documented decision.

```bash
git add packages apps/catalog-b2b apps/catalog/next.config.mjs package.json docs/superpowers/plans/2026-06-29-wnlq9-b2b-catalog.md
git commit -m "feat(b2b): phase-0 spike — shared engine import mechanism proven (both apps build)"
```

---

## Phase 1 — Data pipeline (TDD)

### Task 1.1: B2B export script

**Files:**
- Create: `scripts/refresh_b2b_export.py`
- Test: `tests/test_b2b_export_invariants.py`
- Reference (pattern): `scripts/refresh_live_export.py`

- [ ] **Step 1: Write the failing test** (`tests/test_b2b_export_invariants.py`):

```python
import json, sqlite3, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DB = REPO / "data" / "db" / "products.db"
OUT = REPO / "data" / "b2b_products_export.json"

FORBIDDEN = {"cost", "margin_pct", "b2b_margin_pct", "b2b_margin_thb",
             "price", "special_price", "sp_discount_pct", "b2b_discount_pct"}

def _gen():
    subprocess.run([sys.executable, str(REPO / "scripts" / "refresh_b2b_export.py")], check=True)
    return json.loads(OUT.read_text())

def test_rowcount_matches_db_b2b_price_not_null():
    records = _gen()
    con = sqlite3.connect(DB)
    (n,) = con.execute("SELECT COUNT(*) FROM products WHERE b2b_price IS NOT NULL").fetchone()
    assert len(records) == n

def test_every_row_has_numeric_b2b_price():
    for r in _gen():
        assert isinstance(r.get("b2b_price"), (int, float))

def test_no_forbidden_fields_present():
    for r in _gen():
        assert FORBIDDEN.isdisjoint(r.keys()), f"leaked: {FORBIDDEN & set(r.keys())}"

def test_export_not_stale():
    _gen()
    assert OUT.stat().st_mtime >= DB.stat().st_mtime
```

- [ ] **Step 2: Run, verify it fails.**

Run: `.venv/bin/python -m pytest tests/test_b2b_export_invariants.py -v`
Expected: FAIL (script does not exist / no such file).

- [ ] **Step 3: Write `scripts/refresh_b2b_export.py`.** Start from a **minimal explicit column list** (do NOT copy `EXPORT_COLS`). Include only display columns + `b2b_price`. Filter `WHERE b2b_price IS NOT NULL`. Write `data/b2b_products_export.json`. Mirror `refresh_live_export.py`'s connection/serialization style.

```python
"""Regenerate data/b2b_products_export.json from data/db/products.db.

B2B wholesale catalog source. Wholesale price ONLY — never exports retail price,
discount %, cost, or any margin field. Filtered to products that HAVE a b2b_price.
See docs/superpowers/specs/2026-06-29-wnlq9-b2b-catalog-design.md.
"""
import json, sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DB = REPO_ROOT / "data" / "db" / "products.db"
OUT = REPO_ROOT / "data" / "b2b_products_export.json"

# Minimal explicit allowlist — NOT a copy of EXPORT_COLS (which carries margin/cost).
# Wholesale price only; no retail price / special_price / discount / margin / cost.
B2B_EXPORT_COLS = [
    "sku", "name", "brand", "variety", "vintage",
    "country", "region", "subregion", "appellation",
    "classification", "designation",
    "body", "acidity", "tannin", "sweetness", "intensity", "smokiness", "finish",
    "flavor_tags", "food_matching", "food_matching_detail",
    "bottle_size", "currency", "image_url",
    "is_in_stock", "wn_stock", "custom_stock_status", "quantity_in_stock",
    "critic_score",  # keep critic pill
    "b2b_price",
]

def main() -> int:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    existing = {r[1] for r in con.execute("PRAGMA table_info(products)")}
    cols = [c for c in B2B_EXPORT_COLS if c in existing]
    assert "b2b_price" in cols, "b2b_price missing from products table"
    rows = con.execute(
        f"SELECT {','.join(cols)} FROM products WHERE b2b_price IS NOT NULL"
    ).fetchall()
    records = [{k: r[k] for k in cols if r[k] is not None} for r in rows]
    OUT.write_text(json.dumps(records, ensure_ascii=False))
    print(f"Wrote {len(records)} B2B products to {OUT}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `.venv/bin/python -m pytest tests/test_b2b_export_invariants.py -v`
Expected: 4 PASS. (If `critic_score`/`image_url` column names differ, adjust `B2B_EXPORT_COLS` to match `PRAGMA table_info`; the public `EXPORT_COLS` and `PUBLIC_FIELDS` are the reference for real column names.)

- [ ] **Step 5: Verify the data actually landed (CLAUDE.md Rule 1).**

Run: `.venv/bin/python -c "import json; d=json.load(open('data/b2b_products_export.json')); print(len(d), 'rows'); print('sample b2b_price:', d[0]['b2b_price']); print('has forbidden:', set(d[0]) & {'cost','margin_pct','b2b_margin_pct','price'})"`
Expected: ~7,267 rows; a numeric `b2b_price`; empty forbidden set.

- [ ] **Step 6: Commit.**

```bash
git add scripts/refresh_b2b_export.py tests/test_b2b_export_invariants.py
git commit -m "feat(b2b): export script + invariant tests (b2b_price only, no leaks)"
```

### Task 1.2: Dual-regeneration wrapper + public-leak regression guard

**Files:**
- Create: `scripts/refresh_all_exports.py`
- Modify: `tests/test_b2b_export_invariants.py` (add public-leak guard)

- [ ] **Step 1: Add the public-leak guard test** asserting the public export still has NO `b2b_price`:

```python
def test_public_export_has_no_b2b_price():
    pub = json.loads((REPO / "data" / "live_products_export.json").read_text())
    sample = pub if isinstance(pub, list) else list(pub.values())
    assert all("b2b_price" not in r for r in sample[:500])
```

- [ ] **Step 2: Run, verify it passes** (public export already lacks b2b_price).

Run: `.venv/bin/python -m pytest tests/test_b2b_export_invariants.py::test_public_export_has_no_b2b_price -v`
Expected: PASS.

- [ ] **Step 3: Write `scripts/refresh_all_exports.py`** that calls `refresh_live_export.main()` then `refresh_b2b_export.main()`.

- [ ] **Step 4: Run it; verify both files regenerate.**

Run: `.venv/bin/python scripts/refresh_all_exports.py && ls -la data/live_products_export.json data/b2b_products_export.json`
Expected: both written, recent mtimes.

- [ ] **Step 5: Commit.**

```bash
git add scripts/refresh_all_exports.py tests/test_b2b_export_invariants.py
git commit -m "feat(b2b): refresh_all_exports wrapper + public-leak regression guard"
```

---

## Phase 2 — B2B data layer (TDD)

### Task 2.1: `B2B_PUBLIC_FIELDS` allowlist + loader + derivation

**Files:**
- Create: `apps/catalog-b2b/lib/catalog-data.ts`
- Reference: `apps/catalog/lib/catalog-data.ts` (PUBLIC_FIELDS, toPublicProduct, derivation of category_group/category_type/popularity_tier/flavor_tags_canonical)
- Test: `apps/catalog-b2b/lib/catalog-data.test.ts`

- [ ] **Step 1: Write failing test** — assert `B2B_PUBLIC_FIELDS` includes `b2b_price`, EXCLUDES `price`/`special_price`/`b2b_discount_pct`/`margin_pct`/`cost`; assert `toPublicProductB2B` on a raw row copies `b2b_price`, drops forbidden keys, and derives `category_group`/`category_type`.

- [ ] **Step 2: Run, verify fail.** Run: `cd apps/catalog-b2b && npx vitest run lib/catalog-data.test.ts` → FAIL.

- [ ] **Step 3: Implement** `catalog-data.ts`: copy the public allowlist pattern but swap `price`→`b2b_price`, drop retail/discount keys, keep the `satisfies` drift guard, and reuse (import from shared engine) the derivation helpers for category/popularity/flavor. Loader reads `data/b2b_products_export.json`.

- [ ] **Step 4: Run, verify pass.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/catalog-b2b/lib/catalog-data.ts apps/catalog-b2b/lib/catalog-data.test.ts
git commit -m "feat(b2b): B2B data loader + allowlist (b2b_price only) + derived fields"
```

---

## Phase 3 — Auth gate (TDD; HIGH-SCRUTINY)

### Task 3.1: Cookie sign/verify

**Files:**
- Create: `apps/catalog-b2b/lib/auth.ts`
- Test: `apps/catalog-b2b/lib/auth.test.ts`

- [ ] **Step 1: Write failing test:** `verifyToken(signToken())` is true; tampered token false; token signed with a different secret false; token with stale `B2B_AUTH_VERSION` false.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `signToken`/`verifyToken` using Node `crypto` HMAC over `{version, issuedAt}` with `B2B_AUTH_SECRET`. Constant-time compare (`crypto.timingSafeEqual`). No raw password in the token.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

### Task 3.2: Login route + page

**Files:**
- Create: `apps/catalog-b2b/app/api/login/route.ts`, `apps/catalog-b2b/app/login/page.tsx`
- Test: `apps/catalog-b2b/app/api/login/route.test.ts`

- [ ] **Step 1: Write failing test:** POST correct password → 200 + `Set-Cookie` (HttpOnly, Secure, SameSite=Lax); wrong password → 401, no cookie; uses `crypto.timingSafeEqual` vs `B2B_PASSWORD` env.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** route handler (constant-time compare, set signed cookie via `lib/auth`, generic error, no password logging) + a minimal `/login` page form posting to it.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

### Task 3.3: Middleware gate (matcher precision is the boundary)

**Files:**
- Create: `apps/catalog-b2b/middleware.ts`
- Test: `apps/catalog-b2b/middleware.test.ts`

- [ ] **Step 1: Write failing test:** request to `/` without cookie → 302 `/login`; with valid cookie → pass; request to `/login` and `/api/login` without cookie → pass; **request to a `/_next/data/...json` path without cookie → 302** (matcher must protect data routes); static asset path (`/_next/static/...`, `/favicon.ico`) → pass.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** middleware: `matcher` excludes `/login`, `/api/login`, `/_next/static`, `/_next/image`, `/favicon.ico`, icons — but INCLUDES `/_next/data`. Verify cookie via `lib/auth`; redirect to `/login` on miss.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

---

## Phase 4 — UI: branding, denser grid, list toggle (TDD where logic exists; browser-verify visuals)

### Task 4.1: Branding (WNLQ9 + B2B badge) + noindex/robots

**Files:**
- Create: `apps/catalog-b2b/app/robots.ts` (disallow `/`), B2B `Header`/`Footer`/`layout.tsx` metadata (`noindex, nofollow`, title "WNLQ9 B2B — Wholesale Catalogue"), `WNLQ9` + `B2B` pill badge.
- Explicitly DO NOT create `app/sitemap.ts`.

- [ ] **Step 1:** Implement robots.ts + layout metadata; add the `B2B` pill badge to header/hero/footer wordmark.
- [ ] **Step 2: Test** robots route returns disallow-all; layout metadata has `robots: { index: false }`.
- [ ] **Step 3: Commit.**

### Task 4.2: `ProductCardB2B` — b2b_price only, denser, keep critic pill

**Files:**
- Create: `apps/catalog-b2b/components/ProductCardB2B.tsx`
- Test: `apps/catalog-b2b/components/ProductCardB2B.test.tsx`
- Reference: `apps/catalog/components/ProductCard.tsx`

- [ ] **Step 1: Write failing test:** renders `฿{b2b_price}` (formatted), renders critic pill when score present, renders stock badge, and does NOT render any strikethrough/sale element (no retail field exists). Guard: passing a product without `price` must not render `฿NaN`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** card reading `b2b_price` (reuse shared `formatPrice`). No sale/strikethrough logic. Keep critic pill + stock badges.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 4.3: Denser grid + `ProductListB2B` + `ViewToggle`

**Files:**
- Create: `apps/catalog-b2b/components/ProductListB2B.tsx`, `apps/catalog-b2b/components/ViewToggle.tsx`
- Modify: B2B shop page grid to `grid-cols-3 sm:grid-cols-4 lg:grid-cols-6` and host the toggle.
- Test: `apps/catalog-b2b/components/ProductListB2B.test.tsx`

- [ ] **Step 1: Write failing test:** list row renders thumb + name + brand + region + critic + `฿{b2b_price}`; ViewToggle switches between grid and list and persists choice (e.g. URL param or localStorage).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** list view + toggle; wire into shop page with the 3/4/6 grid.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 4.4: Product detail page shows b2b_price (required override)

**Files:**
- Create/override: `apps/catalog-b2b/app/product/[sku]/page.tsx`
- Test: `apps/catalog-b2b/app/product/[sku]/page.test.tsx`

- [ ] **Step 1: Write failing test:** detail page for a B2B SKU shows `฿{b2b_price}` and no retail/sale element; `generateStaticParams` is sourced from the B2B export; a SKU absent from the B2B export yields `notFound()` (404), with NO retail fallback.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** detail page reading `b2b_price`; `generateStaticParams` from B2B `getAllProducts`; `notFound()` for missing SKU.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

---

## Phase 5 — Public site footer link (single change)

### Task 5.1: Add "B2B" link to public Footer

**Files:**
- Modify: `apps/catalog/components/Footer.tsx` (Info column)
- Test: `apps/catalog/components/Footer.test.tsx` (if a test file exists; else add a minimal one)

- [ ] **Step 1: Write failing test:** Footer renders a link with text "B2B" pointing to `https://b2b.wnlq9.shop`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the single link in the Info column.
- [ ] **Step 4: Run, verify pass; run full public test suite to confirm no regression.**

Run: `cd apps/catalog && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit.**

---

## Phase 6 — Full build, browser verification (Rule 7), deploy prep

### Task 6.1: Generate real data + build both apps

- [ ] **Step 1:** `.venv/bin/python scripts/refresh_all_exports.py`
- [ ] **Step 2:** `cd apps/catalog && NODE_OPTIONS='--max-old-space-size=4096' npx next build` → success.
- [ ] **Step 3:** `cd apps/catalog-b2b && NODE_OPTIONS='--max-old-space-size=4096' npx next build` → success.

### Task 6.2: Browser walkthrough (CLAUDE.md Rule 7) — use the `verify` skill

- [ ] **Step 1:** Start B2B dev server (`cd apps/catalog-b2b && PORT=3200 npx next dev`).
- [ ] **Step 2:** Visit `/` → redirected to `/login`. Confirm gate.
- [ ] **Step 3:** Enter wrong password → rejected. Enter correct (`B2B_PASSWORD`) → unlocked.
- [ ] **Step 4:** Confirm: WNLQ9+B2B badge; grid is 6-wide on desktop; Grid|List toggle works; cards show `฿{b2b_price}` (no strikethrough); critic pill present; ~7,267 products.
- [ ] **Step 5:** Open a product detail page → shows b2b_price. Hit a known non-B2B SKU URL directly → 404 (no retail fallback).
- [ ] **Step 6:** Confirm `view-source`/network: no `margin`, `cost`, retail `price`, or `b2b_discount_pct` in any payload.

### Task 6.3: Deploy artifacts

- [ ] **Step 1:** Create `apps/catalog-b2b/.vercel/project.json` for a NEW Vercel project `wnlq9-b2b` (do not reuse the public project id).
- [ ] **Step 2:** Document deploy steps in the spec's Deploy-Time Tasks: Vercel Root Dir = `apps/catalog-b2b`; env vars `B2B_PASSWORD`, `B2B_AUTH_SECRET`, `B2B_AUTH_VERSION` + contact vars; add `b2b.wnlq9.shop` DNS CNAME; verify `.vercelignore` does not strip `apps/catalog-b2b/scripts` or repo-root `data/`.
- [ ] **Step 3:** Final commit + open PR.

```bash
git commit -am "chore(b2b): vercel project config + deploy notes"
```

---

## Notes for the implementer

- **Verify column names** against `PRAGMA table_info(products)` and the public `EXPORT_COLS`/`PUBLIC_FIELDS` before trusting the `B2B_EXPORT_COLS` list above — adjust if `critic_score`/`image_url` differ.
- **Rule 9:** after ANY future DB write, run `scripts/refresh_all_exports.py`, not just the public one.
- **Shared DB caveat (memory):** products.db can be replaced by a parallel process between turns — keep the export script idempotent and re-run before building.
- **Catalog worktree caveat (memory):** the main checkout is shared; consider an isolated worktree for the B2B app work.
- **Never** add `b2b_price`/`margin`/`cost` to the PUBLIC `EXPORT_COLS` or `PUBLIC_FIELDS`.
