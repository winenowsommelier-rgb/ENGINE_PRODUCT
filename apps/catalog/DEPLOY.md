# WNLQ9 Catalog — Vercel Deploy Runbook

Concise runbook for deploying the customer-facing storefront (`apps/catalog/`) to
Vercel as a **new, separate project**. You deploy this yourself — these are the
exact settings and the update workflow.

> Leave any existing internal Vercel project untouched. This is a NEW project.
> Assign the primary domain to this new project once it builds green.

---

## 1. Critical: Root Directory must be the REPO ROOT (not `apps/catalog`)

The build reads the product data from **`data/live_products_export.json` at the
repo root**. The data loader (`apps/catalog/lib/catalog-data.ts → exportPath()`)
resolves the file by probing several locations:

```
<cwd>/data/live_products_export.json                 # cwd = repo root  ✅
<cwd>/../../data/live_products_export.json            # cwd = apps/catalog
$CATALOG_DATA_PATH                                    # explicit override
```

If the Root Directory is set to `apps/catalog`, Vercel clones only that subtree
into the build context and `data/` is **not present** — the build throws
`live_products_export.json not found in any known location` and fails. Setting
Root Directory = repo root keeps `data/` in the build context.

### Vercel Project Settings

| Setting | Value |
|---|---|
| **Root Directory** | `./` (repo root — **NOT** `apps/catalog`) |
| **Framework Preset** | Next.js |
| **Build Command** | `cd apps/catalog && npm install && npm run build` |
| **Output Directory** | `apps/catalog/.next` |
| **Install Command** | (leave default / empty — install runs inside Build Command) |
| **Node.js Version** | 20.x (or 18.x) |

The Build Command `cd`s into `apps/catalog`, installs deps, and runs
`npm run build`. The build's `prebuild` step (`scripts/gen-search-index.mjs`)
generates `public/search-index.json`, then `next build` runs with
`NODE_OPTIONS='--max-old-space-size=4096'` (already set in `package.json`).

---

## 2. Environment Variables (set in Vercel → Settings → Environment Variables)

These are **public contact handles, not secrets**. If a value is unset, that
contact button simply does not render — the storefront degrades gracefully (no
broken links, no crash). See `apps/catalog/.env.example`.

| Variable | Format / Example | Notes |
|---|---|---|
| `LINE_OFFICIAL_URL` | Full URL, e.g. `https://line.me/R/ti/p/@wnlq9` | LINE official account link |
| `WHATSAPP_NUMBER` | Digits only, country code, **no `+`**, e.g. `66812345678` | International format |
| `FB_MESSENGER_PAGE` | Page handle only (part after `m.me/`), e.g. `wnlq9` | Facebook Messenger |

Set them for **Production** (and Preview if you want them on preview deploys).
Contact buttons omit any unconfigured channel.

---

## 3. Images

The remote image host is already allowlisted in `apps/catalog/next.config.js`:

```js
images: {
  unoptimized: true,
  remotePatterns: [
    { protocol: 'https', hostname: 'th.wine-now.com', pathname: '/media/**' },
  ],
}
```

`unoptimized: true` means images are served directly from `th.wine-now.com` (no
Vercel Image Optimization billing / no extra config needed). If product images
ever move to a new host, add it to `remotePatterns`.

---

## 4. Rendering model (ISR) — why builds are fast

Product pages use **Incremental Static Regeneration**:

- **`generateStaticParams`** pre-renders only ~200 high-value SKUs at build time
  (curated featured SKUs + in-stock, image-bearing, critic-reviewed products).
  This keeps the build to a couple of minutes instead of ~17 min for all ~11,436.
- **`dynamicParams = true`** — any SKU not pre-rendered is generated **on first
  request** and then cached (ISR on-demand). Unknown SKUs return a 404.
- **`revalidate = 3600`** — cached pages regenerate at most once an hour, so data
  updates surface automatically without a full rebuild.

Home, `/about`, `/contact`, `/explore-map` are static; `/shop` is server-rendered
on demand (it reads `searchParams`).

---

## 5. Data update workflow

When the catalog data changes:

1. Team edits `products.db` (repo root) as usual.
2. Regenerate the UI-facing export (this is the file the storefront reads):
   ```bash
   .venv/bin/python scripts/refresh_live_export.py
   ```
   (run from the **repo root**)
3. Commit the updated `data/live_products_export.json`:
   ```bash
   git add data/live_products_export.json
   git commit -m "data: refresh live products export"
   git push
   ```
4. Vercel auto-rebuilds on push. New build picks up the updated data.

> Two paths to fresh data:
> - **Push a new export** → full rebuild, all pages reflect the new data.
> - **ISR hourly revalidation** → already-cached pages refresh within an hour even
>   without a push (within the deployed build's data snapshot).

---

## 6. First deploy checklist

- [ ] New Vercel project created (separate from the internal one).
- [ ] Root Directory = repo root (`./`), **not** `apps/catalog`.
- [ ] Build Command = `cd apps/catalog && npm install && npm run build`.
- [ ] Output Directory = `apps/catalog/.next`.
- [ ] Env vars set (`LINE_OFFICIAL_URL`, `WHATSAPP_NUMBER`, `FB_MESSENGER_PAGE`).
- [ ] Build succeeds; deployment is green.
- [ ] Spot-check: `/`, `/shop`, a `/product/<sku>`, and a bad SKU → 404.
- [ ] Assign the primary domain to this project.
