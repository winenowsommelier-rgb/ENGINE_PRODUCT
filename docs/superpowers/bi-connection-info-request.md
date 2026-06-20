# BI API — connection info request (paste into the BI session)

> **⛔ BLOCKER (verified 2026-06-20): the provided key is REJECTED on all protected endpoints.**
> Tested the key `CWNhpzx0…` (from the API & Data Access page) live:
> - `GET /health` + key → **200** (but `/health` requires NO auth, so this proves nothing).
> - `GET /products` + key → **401**, identical to sending NO key at all.
> - Header name confirmed correct (`X-API-Key`, per the live OpenAPI `securitySchemes`),
>   header confirmed transmitted (raw request trace). All endpoints exist
>   (`/products/{sku}/affinities`, `/marts`, `/products/{sku}/performance` are in the live spec).
> **Conclusion: the key value does not match what the deployed Vercel server checks against**
> (likely the server's env var differs / rotated; the page's curl example only hits `/health`,
> which never validates keys — so it looked valid but was never tested on a protected route).
>
> **To unblock, in the BI session, do ONE of:**
> 1. Run `curl -H 'X-API-Key: <key>' https://wnlq9-bi-api.vercel.app/products` (a PROTECTED route,
>    NOT /health). If it 401s, the page's key is stale.
> 2. Read the deployed Vercel project's API-key env var (e.g. `API_KEY`/`WNLQ9_API_KEY`/`BI_API_KEYS`)
>    — that's the value the server actually accepts — and provide THAT, or update Vercel's env to
>    match the page + redeploy.
> 3. If keys are per-consumer (`/health` showed `api_key_count:1`, `password_configured:true`),
>    provision a key for the catalog.
> Put the WORKING key in `apps/catalog/.env.local` as `BI_API_KEY=…` (gitignored; never in chat).
> Until a key passes `/products`, the BI recommender build cannot start.

---

To wire the WNLQ9 catalog's BI-powered recommender, I need the following from the BI
Marketing Engine. **Do NOT paste secret values into the catalog chat** — instead put the
key in an env file (see §A) and answer the non-secret questions (§B–§D) in text.

## A. The API key (the one thing that blocks live calls)
The BI API at `https://wnlq9-bi-api.vercel.app` returns `401 Authentication required —
provide X-API-Key header`. I need the key available to the code WITHOUT it appearing in chat:
- Put the current key in `apps/catalog/.env.local` as:  `BI_API_KEY=<value>`
  (`.env.local` is gitignored — confirm it is — so it never commits)
- Tell me only: **"key is in apps/catalog/.env.local"** + the **issue date** (it rotates every
  30 days per the .env.example — I need to know when it expires).
- Confirm the **exact header name**: `X-API-Key` (vs `Authorization: Bearer`). The MKT_ENGINE
  biClient uses a `headers` object — tell me which header it sets.

## B. Endpoint contracts (confirm against the live API — I have the repo's view, need reality)
For 2–3 sample SKUs (one wine e.g. a Bordeaux red, one whisky), paste the RAW JSON response of:
1. `GET /products/{sku}/affinities` — I expect `{ pairs: [ { sku, lift, co_count }, … ] }`.
   **Confirm:** the exact top-level key (`pairs`?), the inner field names (`sku`/`lift`/`co_count`?),
   and whether `sku` there is a real catalog SKU that matches our export.
2. `GET /products/{sku}/performance` — I expect monthly rows. **Confirm:** the field names
   (`month_start`, `sales_thb`, `qty_ordered`?) and the shape (array of months? object?).
3. `GET /marts` — just the list of mart names available (for context).

## C. Calibration data (so the support-floor + velocity weights aren't guesses — Rule 3)
1. **co_count distribution** across all affinity pairs: min / p25 / median / p75 / p90 / max,
   and how many pairs have co_count ≥ 2, ≥ 3, ≥ 5. (Sets the support floor MIN_CO_COUNT.)
2. **trailing-12m qty (velocity) distribution** across SKUs: min / median / p90 / max.
   (Sets the velocity-booster normalization.)
3. **Coverage:** of our ~11,436 catalog SKUs, roughly how many have ANY affinity data?
   how many have performance data? (Tells us how often the recommender falls back to content.)

## D. Operational
1. **Rate limits / throttling** on the API (so the fetch script paces itself).
2. Is there a **bulk** endpoint, or only per-SKU? (Per-SKU × ~5,655 in-stock SKUs = the fetch
   script's loop size — confirm that's acceptable, or if there's a batch/export route.)
3. SKU format: does the BI API key on the SAME `sku` string our export uses (e.g. `WRW2117AC`),
   or a different id we'd need to map?

## Why this is needed (for context)
The catalog is static (SSG); the plan is to fetch BI signals at BUILD time into a committed
`data/bi_signals.json` (key never ships to the browser/Vercel — read via `process.env.BI_API_KEY`
in a build script that reuses MKT_ENGINE's biClient). Spec:
`docs/superpowers/specs/2026-06-20-wnlq9-bi-powered-recommendations-design.md`.
