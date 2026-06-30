# WNLQ9.B2B Wholesale Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-gated B2B wholesale catalog at `b2b.wnlq9.shop` that mirrors the public catalog but shows only wholesale (`b2b_price`) pricing, in a denser layout, to authenticated trade users.

**Architecture:** A new sibling Next.js app `apps/catalog-b2b` reuses the public catalog's engine (taxonomy, filters, finder, explore, price-format, derivation) via a shared mechanism resolved in Phase 0. It loads a separate, B2B-only data file (`data/b2b_products_export.json`) produced by a new export script. A shared-password middleware gate (HMAC-signed HttpOnly cookie) protects all routes. Deployed as a separate Vercel project. The public app is unchanged except one footer link.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind, Radix, Vitest (TS); Python 3 + sqlite3 (export script); Vercel.

**Spec:** `docs/superpowers/specs/2026-06-29-wnlq9-b2b-catalog-design.md`

**Working branch:** `feat/wnlq9-b2b-catalog` (worktree at `.worktrees/b2b-catalog`).

---

## Verified column names (confirmed against `PRAGMA table_info(products)` + `refresh_live_export.py`)

- Critic data: `score_summary`, `score_max` — NOT `critic_score` (no such column exists).
- Popularity: `popularity_score` exists and is in public `EXPORT_COLS`; safe to include in B2B export for popularity-tier derivation.
- Correct `B2B_EXPORT_COLS` uses `score_summary`, `score_max`, `popularity_score` — not `critic_score`.
- Product detail page 404 mechanism: `dynamicParams = true` + `getProductBySku` returns `null` for a non-B2B SKU (B2B loader only has B2B rows) → `notFound()`. The static params list does NOT control the 404 — the loader does.

---

## File Structure

**New (Python pipeline):**
- `scripts/refresh_b2b_export.py` — generates `data/b2b_products_export.json` (b2b_price-only, filtered). Accepts `--out` + `--db` args so tests can write to tmp paths.
- `scripts/refresh_all_exports.py` — wrapper calling both public + B2B exports.
- `tests/test_b2b_export_invariants.py` — data invariants (hermetic, uses tmp_path), leak guards (both directions), public-leak guard.

**New (B2B app — exact layout decided in Phase 0):**
- `apps/catalog-b2b/` — Next.js app: `package.json`, `next.config.mjs`, `tsconfig.json`, `.vercel/project.json`, `tailwind.config.ts`, `app/`, `components/`, `lib/`, `public/`.
- `apps/catalog-b2b/lib/catalog-data.ts` — B2B data loader + `B2B_PUBLIC_FIELDS` allowlist + derivation (includes `score_summary`, `popularity_score`).
- `apps/catalog-b2b/lib/auth.ts` — cookie sign/verify (HMAC).
- `apps/catalog-b2b/middleware.ts` — auth gate (covers `_next/data`).
- `apps/catalog-b2b/app/login/page.tsx` + `apps/catalog-b2b/app/api/login/route.ts` — password gate.
- `apps/catalog-b2b/components/ProductCardB2B.tsx`, `ProductListB2B.tsx`, `ViewToggle.tsx` — denser UI, reads `score_summary` for critic pill.
- `apps/catalog-b2b/app/robots.ts` (disallow all), layout metadata (noindex). **NO `sitemap.ts`.**
- `apps/catalog-b2b/app/product/[sku]/page.tsx` — required override (reads `b2b_price`, `getProductBySku` → `notFound()` for non-B2B SKUs, `dynamicParams = true`).

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

Run from repo root: `grep -rn "catalog-data\|getAllProducts\|getProductBySku\|toPublicProduct\|PUBLIC_FIELDS" apps/catalog/lib apps/catalog/components apps/catalog/app | sort`
Expected: a list of import sites. Save it as scratch notes.

- [ ] **Step 2:** Confirm the `@/` alias config and Next monorepo settings.

Run from repo root: `cat apps/catalog/tsconfig.json | grep -A5 paths && cat apps/catalog/next.config.mjs`
Expected: see `@/*` → `./*` (or similar) and any `transpilePackages`/`outputFileTracingRoot`.

### Task 0.2: Build a minimal two-app skeleton proving the chosen mechanism

**Decision rule (Rule 11 — recommend, then build):** Default to **`packages/catalog-core`** (a workspace package holding the engine with the data loader injected/parameterized) UNLESS Task 0.1 shows the coupling is shallow enough that a per-app `@/lib/catalog-data` alias override is clean. Document the choice + reasoning before proceeding.

**Files (if package approach):**
- Create: `packages/catalog-core/package.json`, `packages/catalog-core/src/index.ts` (re-exports engine), `packages/catalog-core/src/data.ts` (loader takes export-path + allowlist as params).
- Modify: root `package.json` (workspaces), `apps/catalog/next.config.mjs` (`transpilePackages: ['catalog-core']`).

- [ ] **Step 1:** Scaffold `apps/catalog-b2b` as a throwaway-minimal Next app (one page that calls the shared `getAllProducts` pointed at a 3-row fixture JSON) + wire the chosen mechanism.

- [ ] **Step 2: Verify BOTH apps build.** This is the gate.

Run from repo root:
```bash
(cd apps/catalog && NODE_OPTIONS='--max-old-space-size=4096' npx next build)
(cd apps/catalog-b2b && NODE_OPTIONS='--max-old-space-size=4096' npx next build)
```
Expected: both builds succeed; B2B page renders the 3 fixture rows; public build unaffected.

- [ ] **Step 3:** If the chosen mechanism fails to build, switch to the alternative and repeat. Do NOT proceed to Phase 1 until both apps build with shared imports working.

- [ ] **Step 4: Commit** the skeleton + the documented decision. Use conditional git add based on what was created:

```bash
# Add only what exists (package approach: add packages/; alias approach: skip it)
git add apps/catalog-b2b apps/catalog/next.config.mjs package.json \
  docs/superpowers/plans/2026-06-29-wnlq9-b2b-catalog.md
# If packages/catalog-core was created:
# git add packages/catalog-core
git commit -m "feat(b2b): phase-0 spike — shared engine import mechanism proven (both apps build)"
```

---

## Phase 1 — Data pipeline (TDD)

### Task 1.1: B2B export script (hermetic tests)

**Files:**
- Create: `scripts/refresh_b2b_export.py`
- Test: `tests/test_b2b_export_invariants.py`
- Reference (pattern): `scripts/refresh_live_export.py` (has `argparse` + `main(argv)` pattern)

- [ ] **Step 1: Write the failing test** (`tests/test_b2b_export_invariants.py`).

The test uses `--out` to write to `tmp_path` (hermetic — never touches real export during testing). A single session-scoped fixture generates the output once per test run.

```python
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
DB = REPO / "data" / "db" / "products.db"
SCRIPT = REPO / "scripts" / "refresh_b2b_export.py"

FORBIDDEN = {
    "cost", "margin_pct", "b2b_margin_pct", "b2b_margin_thb",
    "price", "special_price", "sp_discount_pct", "b2b_discount_pct",
}


@pytest.fixture(scope="session")
def b2b_export(tmp_path_factory):
    """Generate the B2B export once per session into a temp file."""
    out = tmp_path_factory.mktemp("export") / "b2b_products_export.json"
    subprocess.run(
        [sys.executable, str(SCRIPT), "--out", str(out)],
        check=True,
    )
    return json.loads(out.read_text())


def test_rowcount_matches_db(b2b_export):
    con = sqlite3.connect(DB)
    (n,) = con.execute(
        "SELECT COUNT(*) FROM products WHERE b2b_price IS NOT NULL"
    ).fetchone()
    assert len(b2b_export) == n


def test_every_row_has_numeric_b2b_price(b2b_export):
    for r in b2b_export:
        assert isinstance(r.get("b2b_price"), (int, float)), f"bad row: {r.get('sku')}"


def test_no_forbidden_fields(b2b_export):
    for r in b2b_export:
        leaked = FORBIDDEN & set(r.keys())
        assert not leaked, f"leaked fields in {r.get('sku')}: {leaked}"


def test_has_score_summary_column(b2b_export):
    """Critic pill requires score_summary; verify at least one row carries it."""
    has_score = [r for r in b2b_export if r.get("score_summary")]
    assert has_score, "No rows have score_summary — critic pill will be empty"


def test_public_export_has_no_b2b_price():
    """Public export must NEVER contain b2b_price (pipeline isolation guard)."""
    pub = json.loads((REPO / "data" / "live_products_export.json").read_text())
    sample = pub if isinstance(pub, list) else list(pub.values())
    for r in sample[:500]:
        assert "b2b_price" not in r, "b2b_price leaked into public export!"
```

- [ ] **Step 2: Run, verify it fails.**

Run from repo root: `.venv/bin/python -m pytest tests/test_b2b_export_invariants.py -v`
Expected: FAIL — `ModuleNotFoundError` or `FileNotFoundError` for the script.

- [ ] **Step 3: Write `scripts/refresh_b2b_export.py`.**

Start from a **minimal explicit column list** — do NOT copy `EXPORT_COLS` (which carries `margin_pct`/`b2b_margin_pct`/`cost`). Use `score_summary`/`score_max` (not `critic_score` — that column doesn't exist). Accept `--out` arg for testability. Include `popularity_score` so the B2B data layer can derive `popularity_tier`.

```python
"""Regenerate data/b2b_products_export.json from data/db/products.db.

B2B wholesale catalog — wholesale price ONLY. Never exports retail price,
discount %, cost, or any margin field. Filtered to products with b2b_price.
See docs/superpowers/specs/2026-06-29-wnlq9-b2b-catalog-design.md.
"""
import argparse
import json
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "b2b_products_export.json"

# Minimal explicit allowlist — NOT a copy of EXPORT_COLS (which carries margin/cost).
# Uses score_summary/score_max (NOT critic_score — that column does not exist).
# Includes popularity_score for popularity_tier derivation in the app layer.
# Wholesale price only: no retail price / special_price / discount / margin / cost.
B2B_EXPORT_COLS = [
    "sku", "name", "brand", "variety", "vintage",
    "country", "region", "subregion", "appellation",
    "classification", "designation",
    "body", "acidity", "tannin", "sweetness", "intensity", "smokiness", "finish",
    "flavor_tags", "food_matching", "food_matching_detail",
    "bottle_size", "currency", "image_url",
    "is_in_stock", "wn_stock", "custom_stock_status", "quantity_in_stock",
    "score_summary", "score_max",   # critic pill (score_summary is the correct column)
    "popularity_score",              # for popularity_tier derivation
    "b2b_price",
]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    existing = {r[1] for r in con.execute("PRAGMA table_info(products)")}
    cols = [c for c in B2B_EXPORT_COLS if c in existing]
    assert "b2b_price" in cols, "b2b_price missing from products table"
    rows = con.execute(
        f"SELECT {','.join(cols)} FROM products WHERE b2b_price IS NOT NULL"
    ).fetchall()
    records = [{k: r[k] for k in cols if r[k] is not None} for r in rows]
    args.out.write_text(json.dumps(records, ensure_ascii=False))
    print(f"Wrote {len(records)} B2B products → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests, verify pass.**

Run from repo root: `.venv/bin/python -m pytest tests/test_b2b_export_invariants.py -v`
Expected: 5 PASS. If `test_has_score_summary_column` fails, check: `SELECT COUNT(*) FROM products WHERE score_summary IS NOT NULL`.

- [ ] **Step 5: Verify the data landed in the real output file (CLAUDE.md Rule 1).**

Run: `.venv/bin/python scripts/refresh_b2b_export.py` (writes real `data/b2b_products_export.json`)
Then: `.venv/bin/python -c "import json; d=json.load(open('data/b2b_products_export.json')); print(len(d), 'rows'); print('b2b_price:', d[0]['b2b_price']); print('forbidden:', set(d[0]) & {'cost','margin_pct','b2b_margin_pct','price'})"`
Expected: ~7,267 rows; a numeric `b2b_price`; empty forbidden set.

- [ ] **Step 6: Commit.**

```bash
git add scripts/refresh_b2b_export.py tests/test_b2b_export_invariants.py
git commit -m "feat(b2b): export script + invariant tests (b2b_price only, no leaks, hermetic)"
```

### Task 1.2: Dual-regeneration wrapper

**Files:**
- Create: `scripts/refresh_all_exports.py`

- [ ] **Step 1: Write `scripts/refresh_all_exports.py`.** Must import both scripts explicitly with `sys.path` setup:

```python
"""Run both public and B2B export regenerations in sequence.

After any bulk DB write, run this instead of refresh_live_export.py alone.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import refresh_live_export
import refresh_b2b_export


def main() -> int:
    print("=== Refreshing public export ===")
    rc = refresh_live_export.main(argv=None)
    if rc != 0:
        return rc
    print("=== Refreshing B2B export ===")
    return refresh_b2b_export.main(argv=None)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run it; verify both files regenerate.**

Run: `.venv/bin/python scripts/refresh_all_exports.py && ls -la data/live_products_export.json data/b2b_products_export.json`
Expected: both files written with recent timestamps. Both scripts print their row count.

- [ ] **Step 3: Commit.**

```bash
git add scripts/refresh_all_exports.py
git commit -m "feat(b2b): refresh_all_exports wrapper (Rule-9 dual-regen)"
```

---

## Phase 2 — B2B data layer (TDD)

### Task 2.1: `B2B_PUBLIC_FIELDS` allowlist + loader + derivation

**Files:**
- Create: `apps/catalog-b2b/lib/catalog-data.ts`
- Reference: `apps/catalog/lib/catalog-data.ts` — copy its `toPublicProduct` pattern, derivation of `category_group`/`category_type`/`popularity_tier`/`flavor_tags_canonical`, and `satisfies` drift guard. Swap `price` → `b2b_price`, drop retail/discount keys.
- Test: `apps/catalog-b2b/lib/catalog-data.test.ts`

- [ ] **Step 1: Write failing test** — assert `B2B_PUBLIC_FIELDS` includes `b2b_price` and `score_summary`; EXCLUDES `price`/`special_price`/`b2b_discount_pct`/`margin_pct`/`cost`/`popularity_score` (raw score must not reach client); assert `toPublicProductB2B` on a raw row copies `b2b_price`, drops forbidden keys, derives `category_group`/`category_type`, and derives `popularity_tier` from `popularity_score`.

- [ ] **Step 2: Run, verify fail.**

Run from `apps/catalog-b2b`: `npx vitest run lib/catalog-data.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `catalog-data.ts`. Key points:
- `B2B_PUBLIC_FIELDS` includes `b2b_price`, `score_summary`, `score_max` — NOT `price`/`special_price`/`sp_discount_pct`/`b2b_discount_pct`/`popularity_score`.
- `toPublicProductB2B` runs the same category/popularity/flavor derivation as the public loader (import from shared engine or copy the derivation). `popularity_score` is consumed to produce `popularity_tier` but is then dropped from the output.
- Loader reads `data/b2b_products_export.json` (relative to repo root, same probe logic as public).
- Keep the `satisfies` TypeScript drift guard.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/catalog-b2b/lib/catalog-data.ts apps/catalog-b2b/lib/catalog-data.test.ts
git commit -m "feat(b2b): B2B data loader + allowlist (b2b_price + score_summary; no retail/margin)"
```

---

## Phase 3 — Auth gate (TDD; HIGH-SCRUTINY)

### Task 3.1: Cookie sign/verify

**Files:**
- Create: `apps/catalog-b2b/lib/auth.ts`
- Test: `apps/catalog-b2b/lib/auth.test.ts`

- [ ] **Step 1: Write failing test:** `verifyToken(signToken())` is true; tampered token is false; token signed with a different secret is false; token with stale `B2B_AUTH_VERSION` is false.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `signToken`/`verifyToken` using Node `crypto` HMAC over `{version, issuedAt}` with `B2B_AUTH_SECRET`. Constant-time compare (`crypto.timingSafeEqual`). No raw password in the token.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/catalog-b2b/lib/auth.ts apps/catalog-b2b/lib/auth.test.ts
git commit -m "feat(b2b): HMAC cookie sign/verify"
```

### Task 3.2: Login route + page

**Files:**
- Create: `apps/catalog-b2b/app/api/login/route.ts`, `apps/catalog-b2b/app/login/page.tsx`
- Test: `apps/catalog-b2b/app/api/login/route.test.ts`

- [ ] **Step 1: Write failing test:** POST correct password → 200 + `Set-Cookie` header containing `b2b_auth` (HttpOnly, Secure, SameSite=Lax); wrong password → 401, no `Set-Cookie`; does NOT put raw password in cookie or logs.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** route handler (constant-time compare via `crypto.timingSafeEqual` against `B2B_PASSWORD` env, set signed cookie via `lib/auth`, generic "Invalid password" error — not "wrong password" vs "user not found", no password logging) + minimal `/login` page form posting to `/api/login`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/catalog-b2b/app/api/login apps/catalog-b2b/app/login
git commit -m "feat(b2b): login route + page (constant-time, HttpOnly cookie)"
```

### Task 3.3: Middleware gate — `_next/data` is the critical matcher

**Files:**
- Create: `apps/catalog-b2b/middleware.ts`
- Test: `apps/catalog-b2b/middleware.test.ts`

- [ ] **Step 1: Write failing test** covering all boundary cases:
  - `/` without cookie → 302 to `/login`
  - `/shop` without cookie → 302 to `/login`
  - `/_next/data/BUILD_ID/shop.json` without cookie → 302 to `/login` (**this is the critical one — RSC/data route must be gated**)
  - `/` with valid signed cookie → pass (200/next)
  - `/login` without cookie → pass
  - `/api/login` without cookie → pass
  - `/_next/static/chunks/main.js` without cookie → pass
  - `/_next/image?url=...` without cookie → pass
  - `/favicon.ico` without cookie → pass

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** middleware. The matcher must:
  - **Include** `/_next/data/:path*` (data routes are gated).
  - **Exclude** `/_next/static/:path*`, `/_next/image`, `/favicon.ico`, `/login`, `/api/login`, `/icons/:path*`.
  - Verify cookie via `lib/auth`; redirect unauthenticated requests to `/login`.

- [ ] **Step 4: Run, verify pass — every case.**

- [ ] **Step 5: Commit.**

```bash
git add apps/catalog-b2b/middleware.ts apps/catalog-b2b/middleware.test.ts
git commit -m "feat(b2b): auth middleware (gates _next/data; exempts statics/login)"
```

---

## Phase 4 — UI: branding, denser grid, list toggle

### Task 4.1: Branding + noindex + robots

**Files:**
- Create: `apps/catalog-b2b/app/robots.ts`, B2B header/hero/footer components with `WNLQ9` + `B2B` pill badge, `apps/catalog-b2b/app/layout.tsx` (metadata: `robots: { index: false, follow: false }`, title "WNLQ9 B2B — Wholesale Catalogue").
- Explicitly **DO NOT create** `apps/catalog-b2b/app/sitemap.ts`.

- [ ] **Step 1: Implement** `robots.ts` returning `{ rules: { userAgent: '*', disallow: '/' } }` + layout metadata `robots: { index: false, follow: false }` + the B2B badge in header/hero/footer.

- [ ] **Step 2: Test** robots route; layout metadata contains `noindex`.

- [ ] **Step 3: Commit.**

```bash
git add apps/catalog-b2b/app/robots.ts apps/catalog-b2b/app/layout.tsx \
  apps/catalog-b2b/components/Header.tsx apps/catalog-b2b/components/Footer.tsx
git commit -m "feat(b2b): branding (WNLQ9+B2B badge), noindex, robots disallow-all, no sitemap"
```

### Task 4.2: `ProductCardB2B` — b2b_price + score_summary for critic pill

**Files:**
- Create: `apps/catalog-b2b/components/ProductCardB2B.tsx`
- Test: `apps/catalog-b2b/components/ProductCardB2B.test.tsx`
- Reference: `apps/catalog/components/ProductCard.tsx`

- [ ] **Step 1: Write failing test:**
  - Renders `฿{b2b_price}` (formatted via shared `formatPrice`).
  - Renders critic pill when `score_summary` is present (NOT `critic_score` — that column doesn't exist).
  - Does NOT render any strikethrough/sale element (no `price`/`special_price` field exists in the B2B bundle).
  - Passing a product without a `price` field must NOT render `฿NaN` or `฿undefined`.
  - Renders stock badge (Express / Archive) correctly.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — reads `b2b_price` (not `price`), reads `score_summary` for the critic pill (not `critic_score`). No sale/strikethrough/discount logic.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/catalog-b2b/components/ProductCardB2B.tsx \
  apps/catalog-b2b/components/ProductCardB2B.test.tsx
git commit -m "feat(b2b): ProductCardB2B (b2b_price + score_summary critic pill, no sale logic)"
```

### Task 4.3: Denser grid + `ProductListB2B` + `ViewToggle`

**Files:**
- Create: `apps/catalog-b2b/components/ProductListB2B.tsx`, `apps/catalog-b2b/components/ViewToggle.tsx`
- Modify: B2B shop page grid → `grid-cols-3 sm:grid-cols-4 lg:grid-cols-6`.
- Test: `apps/catalog-b2b/components/ProductListB2B.test.tsx`

- [ ] **Step 1: Write failing test:** list row renders thumb + name + brand + region + `score_summary` (critic) + `฿{b2b_price}`; `ViewToggle` switches between grid and list; chosen view persists (URL search param `?view=list|grid` preferred over localStorage for SSR).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** list view + toggle + wire into shop page.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/catalog-b2b/components/ProductListB2B.tsx \
  apps/catalog-b2b/components/ViewToggle.tsx \
  apps/catalog-b2b/components/ProductListB2B.test.tsx
git commit -m "feat(b2b): denser 3/4/6 grid + list view + toggle"
```

### Task 4.4: Product detail page — b2b_price + correct 404 mechanism

**Files:**
- Create: `apps/catalog-b2b/app/product/[sku]/page.tsx`
- Test: `apps/catalog-b2b/app/product/[sku]/page.test.tsx`

**Important — 404 mechanism:** The 404 for a non-B2B SKU does NOT come from `generateStaticParams`. The page keeps `dynamicParams = true` (so direct URLs are attempted). The 404 fires because `getProductBySku(sku)` returns `null` (the B2B loader has no data for non-B2B SKUs) → `notFound()`. The test must assert this path explicitly.

- [ ] **Step 1: Write failing test:**
  - Detail page for a B2B SKU renders `฿{b2b_price}` using `score_summary` for critic display; no retail price / sale element.
  - `getProductBySku` for a SKU absent from the B2B export returns `null`.
  - When `getProductBySku` returns `null`, page calls `notFound()` (no retail fallback).
  - `dynamicParams = true` is exported.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `getProductBySku` from B2B `lib/catalog-data`; `notFound()` on null; render `b2b_price`; `score_summary` for critic; `dynamicParams = true`. `generateStaticParams` pre-renders a cap of in-stock B2B products with images and `score_summary` (cap at ~200 most-popular B2B products).

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**

```bash
git add "apps/catalog-b2b/app/product/[sku]"
git commit -m "feat(b2b): product detail page (b2b_price, notFound via null loader, dynamicParams)"
```

---

## Phase 5 — Public site footer link (single change)

### Task 5.1: Add "B2B" link to public Footer

**Files:**
- Modify: `apps/catalog/components/Footer.tsx` (Info column — same column as About / Contact)
- Test: `apps/catalog/components/Footer.test.tsx` (create if absent)

- [ ] **Step 1: Write failing test:** Footer renders a link with text "B2B" and `href="https://b2b.wnlq9.shop"`.

- [ ] **Step 2: Run, verify fail.**

Run from repo root: `cd apps/catalog && npx vitest run components/Footer.test.tsx`

- [ ] **Step 3: Implement** — add one `<a>` or `<Link>` entry to the Info column nav array in `Footer.tsx`.

- [ ] **Step 4: Run tests + full public test suite.**

```bash
cd apps/catalog && npx vitest run
```
Expected: all pass. This confirms no regression in the public app.

- [ ] **Step 5: Commit.**

```bash
git add apps/catalog/components/Footer.tsx apps/catalog/components/Footer.test.tsx
git commit -m "feat(b2b): add B2B link to public footer (→ b2b.wnlq9.shop)"
```

---

## Phase 6 — Full build, bundle-leak check, browser verification, deploy prep

### Task 6.1: Generate real data + build both apps

- [ ] **Step 1: Regenerate both exports.**

Run: `.venv/bin/python scripts/refresh_all_exports.py`
Expected: both files written, row counts printed.

- [ ] **Step 2: Build public app.**

Run: `(cd apps/catalog && NODE_OPTIONS='--max-old-space-size=4096' npx next build)`
Expected: success, no type errors.

- [ ] **Step 3: Build B2B app.**

Run: `(cd apps/catalog-b2b && NODE_OPTIONS='--max-old-space-size=4096' npx next build)`
Expected: success, no type errors.

### Task 6.2: Bundle-leak check (automated; CLAUDE.md Rule 6 — the subtle isolation direction)

The spec calls this "the subtle one": margin/cost must not leak into the B2B JS bundle even though the raw export carries them. Verify with a grep over the built output:

- [ ] **Step 1: Run bundle-leak grep.**

```bash
grep -r "margin_pct\|b2b_margin\|\"cost\"\|\"price\"" apps/catalog-b2b/.next/static/chunks/ 2>/dev/null | grep -v ".next/static/chunks/webpack" | head -20
```
Expected: NO matches (or only innocuous false-positives from framework internals — verify any matches are not product data). If `margin_pct` appears in a product-data chunk, the `B2B_PUBLIC_FIELDS` allowlist has a gap — fix before continuing.

### Task 6.3: Browser walkthrough (CLAUDE.md Rule 7) — use the `verify` skill

- [ ] **Step 1:** Start B2B dev server. Run: `(cd apps/catalog-b2b && PORT=3200 npx next dev)`

- [ ] **Step 2:** Visit `http://localhost:3200/` → must redirect to `/login`. Confirm gate.

- [ ] **Step 3:** Enter wrong password → rejected (generic error, no hints). Enter correct (`B2B_PASSWORD` env) → unlocked, redirected to shop.

- [ ] **Step 4:** Confirm visually:
  - `WNLQ9` + `B2B` badge in header/hero/footer.
  - Grid is 6 columns wide on desktop.
  - Grid|List toggle works; list view shows name + brand + region + critic + price per row.
  - Cards show `฿{b2b_price}` — NO strikethrough, NO "−X%" discount badge.
  - Critic score pill visible on rated products.
  - ~7,267 products total.

- [ ] **Step 5:** Open a product detail page → shows `฿{b2b_price}`. Open DevTools Network tab; find the RSC / page data response; confirm it contains `b2b_price` and does NOT contain `margin`, `cost`, or `price` as product fields.

- [ ] **Step 6:** Navigate to a SKU that exists in the public catalog but NOT the B2B export (a SKU with `b2b_price IS NULL` in the DB): `http://localhost:3200/product/{that-sku}` → must return a 404 page. No retail price displayed.

- [ ] **Step 7:** Confirm robots: `curl http://localhost:3200/robots.txt` → `Disallow: /`. Confirm no `sitemap.xml` is served.

### Task 6.4: Deploy artifacts

- [ ] **Step 1:** Create `apps/catalog-b2b/.vercel/project.json` for a NEW Vercel project named `wnlq9-b2b`. Do not copy the public project's ID from `apps/catalog/.vercel/project.json`.

- [ ] **Step 2:** Confirm `.vercelignore` at repo root does NOT strip `apps/catalog-b2b/` or `data/` (the B2B build needs `data/b2b_products_export.json`).

- [ ] **Step 3:** Document Vercel dashboard steps (add to PR description or spec):
  - Root Directory: `apps/catalog-b2b`
  - Env vars: `B2B_PASSWORD`, `B2B_AUTH_SECRET`, `B2B_AUTH_VERSION=1`, plus contact vars.
  - DNS: add `b2b.wnlq9.shop` CNAME pointing to Vercel.
  - Deployment protection: OFF (cookie gate is the protection, not Vercel's built-in one).

- [ ] **Step 4: Final commit + open PR.**

```bash
git add apps/catalog-b2b/.vercel/project.json
git commit -m "chore(b2b): vercel project config + deploy notes"
gh pr create --title "feat(b2b): WNLQ9.B2B wholesale catalog" \
  --body "Implements the design spec at docs/superpowers/specs/2026-06-29-wnlq9-b2b-catalog-design.md"
```

---

## Notes for the implementer

- **Column names:** `score_summary` / `score_max` for critic data (verified — `critic_score` does not exist). `popularity_score` for tier derivation (consumed in `toPublicProductB2B`, dropped from output).
- **404 mechanism:** comes from `getProductBySku → null → notFound()`, NOT from `generateStaticParams`. `dynamicParams = true` is intentional.
- **Rule 9:** after ANY future DB write, run `scripts/refresh_all_exports.py` (not just public).
- **Shared DB caveat:** `products.db` can be replaced by a parallel process between turns — re-run the export before building.
- **Worktree:** work in `.worktrees/b2b-catalog` on branch `feat/wnlq9-b2b-catalog`.
- **Never** add `b2b_price`/`margin`/`cost` to the public `EXPORT_COLS` or `PUBLIC_FIELDS`.
- **`b2b_discount_pct` is deliberately excluded** — it lets a viewer back-compute retail (`retail = b2b_price / (1 − disc)`), violating the "wholesale price only" decision.
