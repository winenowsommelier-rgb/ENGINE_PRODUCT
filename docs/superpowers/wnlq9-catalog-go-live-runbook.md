# WNLQ9 Catalog — Go-Live Runbook

**Date:** 2026-06-20
**Goal:** Take the public WNLQ9 catalog (incl. the Product Finder) from
`feat/wnlq9-catalog` to a live, public Vercel site — safely, without disrupting the
internal PIM or the active parallel data session.

**Who does what:** Steps marked **[YOU]** are Vercel-dashboard / account actions only you
can do. Steps marked **[CLAUDE]** are git/build/verify actions Claude can run on request.

> **STATUS UPDATE — verified live via Vercel API 2026-06-20 (supersedes the older reality
> check below):** The `wnlq9-catalog` Vercel project **already exists**
> (`prj_a9miruiNzapADFoKYdahw402RMl5`, team `winenowsommelier-rgbs-projects`) and
> **auto-deploys from GitHub** on push to `feat/wnlq9-catalog`. The latest deployment is
> **READY** and verified working:
> - `/finder` → 200, full render (7 categories, "Find Your Match" nav, 10-group footer).
> - `/shop?group=Wine` → 58 products, **0 margin leaks**.
> - Both build "landmines" (prebuild search-index + monorepo data read) **passed in the real
>   Vercel build** — the deployment is READY, proving they work in prod.
>
> So Phase 2 (create project) + Phase 3 (build landmines) are **DONE**. **4 things remain,
> all [YOU] dashboard actions Claude cannot do (account/secret/domain settings):**
> 1. **🔴 Deployment Protection is ON** → the site requires Vercel login (not public).
>    Settings → Deployment Protection → disable for Production. **This is the ONE thing
>    blocking "public".**
> 2. **🟡 Contact env vars unset** → footer LINE/Facebook/WhatsApp link to `#`. Set
>    `LINE_OFFICIAL_URL`, `WHATSAPP_NUMBER`, `FB_MESSENGER_PAGE` in Settings → Environment
>    Variables, then redeploy.
> 3. **🟡 Production domain** → currently a `*.vercel.app` preview alias; `project.live:false`.
>    Assign the WNLQ9 domain in Settings → Domains to make it "main".
> 4. **🟡 Production target** → deploying from `feat/wnlq9-catalog`; merge to `main` (coordinate
>    with the parallel session) for a stable production branch, or set the project's production
>    branch to `feat/wnlq9-catalog` deliberately.
> Internal-PIM project (`new.mgfdev.com`) and `wnlq9-bi-api` are untouched. The OLD reality
> check below is superseded.

> **Reality check (verified 2026-06-20):**
> - The catalog has **no Vercel project yet**. The only Vercel project deploys the
>   *internal PIM* from the repo root (`vercel.json` = `{"framework":"nextjs"}`).
> - `feat/wnlq9-catalog` is **~100 commits ahead of main** and the working tree is
>   **dirty with another session's in-flight data work** (incl. `live_products_export.json`).
> - `data/live_products_export.json` is **git-tracked** → it ships to Vercel at build ✓.
> - `.vercelignore` strips `scripts/` and `*.py` — a **risk** for the catalog's
>   `prebuild` (see Step 4, must-verify).

---

## Phase 0 — Pre-flight (do NOT skip)

- [ ] **[YOU] Confirm the parallel data session is finished** and its enrichment
  (P2 taste_profile, P3 spirit_style) is final. The catalog builds from
  `live_products_export.json`; launching mid-enrichment ships half-done data.
  **Do not proceed past here while that session is actively writing the export.**
- [ ] **[YOU] Decide the data snapshot:** the catalog will show whatever is committed in
  `live_products_export.json` at merge time. Confirm that's the data you want public.
- [ ] **[CLAUDE] Verify the export is committed & clean** (Rule 1 — query the destination):
  `git status --short data/live_products_export.json` → must be **clean** (committed).
  If dirty, the parallel session must commit it first (Claude will NOT commit another
  session's file).
- [ ] **[CLAUDE] Full catalog test suite green:** `cd apps/catalog && npx vitest run`
  → expect all pass (was 261/261). Plus `npm run typecheck` clean (ignore pre-existing
  `lib/__tests__` jest-global errors only).

---

## Phase 1 — Land the code on `main`

- [ ] **[YOU] Confirm merge timing** with the parallel session — merging pulls ALL ~100
  commits (catalog + finder + drilldown + whatever data work is committed) into `main`.
- [ ] **[CLAUDE] Ensure a clean tree for the merge.** The parallel session's uncommitted
  internal-tool files must be committed or stashed *by that session* — Claude will not
  touch them. The merge needs a clean `feat/wnlq9-catalog`.
- [ ] **[CLAUDE] Merge** (via `superpowers:finishing-a-development-branch`, option 1 or a PR):
  `git checkout main && git pull && git merge feat/wnlq9-catalog`
- [ ] **[CLAUDE] Re-run tests on the merged result** before anything deploys.

> If you prefer review-before-public, do a **PR** instead of a local merge (option 2) and
> have Vercel deploy a **preview** from the PR branch first (Phase 2 works on any branch).

---

## Phase 2 — Create the catalog's Vercel project  **[YOU — dashboard]**

This is the step that has **never been done** and is what actually makes it public.
Keep the existing internal-PIM project untouched (deletion is irreversible).

- [ ] **New Vercel project** → import the same git repo.
- [ ] **Root Directory = `apps/catalog`** (THIS is the key setting — points Vercel at the
  catalog, not the repo root). Framework auto-detects Next.js.
- [ ] **Build command:** leave default (`next build`) — the catalog's `package.json` already
  defines `build: NODE_OPTIONS='--max-old-space-size=4096' next build` and a
  `prebuild: node scripts/gen-search-index.mjs`. Vercel honors the npm `prebuild` hook.
- [ ] **Environment variables** (Production + Preview) — public contact handles, NOT secrets
  (read by `lib/contact-env.ts`; a blank value just hides that contact button, no crash):
  - `LINE_OFFICIAL_URL`  = e.g. `https://line.me/R/ti/p/@wnlq9`
  - `WHATSAPP_NUMBER`    = digits only w/ country code, no `+` (e.g. `66812345678`)
  - `FB_MESSENGER_PAGE`  = handle only, the part after `m.me/` (e.g. `wnlq9`)
- [ ] **Do NOT set a custom Output/Install dir** — defaults work for a Next.js app at the
  root directory.

---

## Phase 3 — First build: verify the two known landmines  **[YOU watch build log; CLAUDE can pre-check locally]**

- [ ] **Landmine A — `.vercelignore` vs the catalog's `prebuild`.** The repo-root
  `.vercelignore` strips `scripts/`. The catalog's prebuild runs
  `apps/catalog/scripts/gen-search-index.mjs`. **Verify the first build's log shows the
  prebuild ran and wrote `public/search-index.json`.** If the build fails with
  "gen-search-index not found" or search is empty in prod:
  - Fix: add `apps/catalog/.vercelignore` that does NOT ignore `scripts/`, OR adjust the
    root `.vercelignore` so its `scripts/` rule doesn't match `apps/catalog/scripts/`.
  - **[CLAUDE]** can implement whichever fix once the failure is confirmed.
- [ ] **Landmine B — build-time data read.** The catalog reads
  `../../data/live_products_export.json` at build (relative to `apps/catalog`). With Root
  Directory = `apps/catalog`, confirm Vercel still includes the repo-root `data/` in the
  build context. **Verify the build log shows products loaded (no "export not found").**
  The path prober (`exportPath()` / `CATALOG_DATA_PATH`) checks multiple locations; if it
  still fails, set env `CATALOG_DATA_PATH` to the absolute build path, or commit a copy
  under `apps/catalog/data/`. (Export is git-tracked, so it IS in the repo — this is about
  the monorepo build context, not the file existing.)
- [ ] **[YOU] Build succeeds** → Vercel gives a `*.vercel.app` preview URL.

---

## Phase 4 — Verify in production (Rule 7 — mandatory before announcing)  **[YOU + CLAUDE]**

On the live `*.vercel.app` URL (not localhost), walk the real journey:

- [ ] Home renders; **"Find Your Match"** in nav + the home band + the burgundy CTA work.
- [ ] `/shop` — category tabs, filters, sort, pagination; a whisky shows under **Whisky**
  (not Wine — the grouping fix), product images load from `th.wine-now.com`.
- [ ] `/product/[sku]` — a real product page renders; breadcrumb shows the right category;
  contact buttons open LINE/WhatsApp/FB with the prefilled message.
- [ ] **`/finder`** — run **all 7 categories** to a non-empty result; the style profile +
  products render; a **gin** run shows gins (no rum); a **Scotch+Smoky** run surfaces
  Islay/peated whisky; the "Closest matches" label appears on a starved query.
- [ ] **[CLAUDE] Margin-leak check on the LIVE site:**
  `curl -s "https://<live-url>/finder/result?cat=red&a1=bold&occ=gift" | grep -ci "margin\|b2b\|enrichment\|popularity"` → **must be 0**.
  Repeat on `/shop` and a `/product/[sku]` page.
- [ ] Search (header) returns results and links to product pages.

---

## Phase 5 — Make it the public "main" site  **[YOU — dashboard]**

- [ ] **Assign the primary WNLQ9 domain** to the NEW catalog project (this is how it
  becomes "main" — by domain, not by deleting the PIM project).
- [ ] **Optional:** move the internal-PIM project to a side domain (e.g. `admin.` /
  `internal.`). Don't delete it — it holds the PIM's deploy history/env/domain binding.
- [ ] Confirm the domain resolves to the catalog and HTTPS is valid.

---

## Ongoing — the update model (after launch)

Per catalog spec §8.3 / project Rule 9 — **the UI reads `live_products_export.json`, not the DB:**
1. Team edits `products.db` in the internal tool.
2. Run `.venv/bin/python scripts/refresh_live_export.py` (Python; `.vercelignore` strips
   `*.py`, so it runs **locally**, never on Vercel — correct).
3. **Commit the updated `live_products_export.json` + push.**
4. Vercel auto-rebuilds the static catalog. Updates = commit + push. (Prices/stock may be
   up to one rebuild stale — acceptable for a contact-to-order flow.)

Data enhancements P1–P6 (finder spec §8) need **no catalog code change** — better data →
better results after a rebuild.

---

## Rollback
- A bad deploy: **[YOU]** in Vercel → Deployments → promote the previous good build
  (instant; Vercel keeps history).
- A bad data push: revert the `live_products_export.json` commit and push; Vercel rebuilds.
- The internal PIM is unaffected throughout (separate project).

---

## One-line status of blockers (as of 2026-06-20)
1. Parallel data session still has the export uncommitted — **wait for it / confirm final.**
2. Branch not merged to main — **Phase 1.**
3. No catalog Vercel project / domain — **Phase 2 & 5 (your dashboard actions).**
None are code defects; the catalog + finder are built, tested, and locally verified.
