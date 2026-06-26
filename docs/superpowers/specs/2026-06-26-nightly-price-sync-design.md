# Nightly Price Sync — Design Spec
**Date:** 2026-06-26  
**Status:** Approved for implementation

## Goal
Automatically pull price, cost, and stock data from the "MReport Masterfile" Google Sheet tab every night at 02:00 AM Bangkok time, write it into Supabase `products`, regenerate the catalog live export JSON, trigger a Vercel redeploy, and send a Gmail summary.

---

## Architecture

```
Google Sheets "MReport Masterfile" (11,855 rows)
        │  gspread + Google Service Account
        ▼
GitHub Actions cron  (19:00 UTC = 02:00 AM Bangkok, daily)
        │
        ├─ 1. scripts/nightly_price_sync.py
        │       • Fetch sheet via Sheets API
        │       • Parse: sku, cost, price, special_price, B2B,
        │                is_in_stock, custom_stock_status,
        │                WN Stock, Consign Stock
        │       • Recompute all margins (never trust sheet formulas)
        │       • UPSERT into Supabase products (price cols only)
        │       • Return summary counts
        │
        ├─ 2. scripts/refresh_live_export_supabase.py
        │       • SELECT all public-safe columns from Supabase
        │       • Write data/live_products_export.json
        │       • Commit & push JSON to repo (it is git-ignored locally
        │         but the Action checks it in from the runner)
        │
        ├─ 3. curl Vercel deploy hook → triggers catalog rebuild
        │
        └─ 4. Send Gmail summary to winenowsommelier@gmail.com
                • N rows updated, N skipped (no change), N errors
                • Vercel deploy triggered ✓/✗
                • Run duration
```

---

## Data Mapping: Sheet → Supabase

| Sheet column | Supabase column | Notes |
|---|---|---|
| `sku` | `sku` | JOIN key |
| `cost` | `cost` | numeric |
| `price` | `price` | numeric |
| `special_price` | `special_price` | numeric, nullable |
| `B2B` | `b2b_price` | numeric, nullable |
| `is_in_stock` | `is_in_stock` | text "0"/"1" |
| `custom_stock_status` | `custom_stock_status` | text, nullable |
| `WN Stock` | `wn_stock` | integer |
| `Consign Stock` | `consign` | text (internal only) |
| *computed* | `margin_thb` | price - cost |
| *computed* | `margin_pct` | (price-cost)/price * 100, 2dp |
| *computed* | `b2b_margin_thb` | b2b - cost |
| *computed* | `b2b_margin_pct` | (b2b-cost)/b2b * 100, 2dp |
| *computed* | `b2b_discount_pct` | (price-b2b)/price * 100, 1dp |
| *computed* | `sp_discount_pct` | (price-sp)/price * 100, 1dp |

**Rule:** Sheet formula columns (Margin THB, Margin %, etc.) are IGNORED — always recomputed from raw inputs to prevent drift.

---

## Files Created

```
scripts/nightly_price_sync.py          # Main sync: Sheets → Supabase
scripts/refresh_live_export_supabase.py # Supabase → live_products_export.json
.github/workflows/nightly-price-sync.yml # Cron job
```

---

## GitHub Actions Secrets Required

| Secret name | Value source |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON from `.env.local` |
| `SUPABASE_URL` | `https://dsyplzckfezcxiuikkfm.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | From `.env.local` |
| `GMAIL_APP_PASSWORD` | Gmail App Password (stored in GitHub Secrets only — never commit) |
| `VERCEL_DEPLOY_HOOK_URL` | Vercel deploy hook URL |

---

## Schedule
- **Cron:** `0 19 * * *` (UTC) = 02:00 AM Bangkok (UTC+7)
- **Estimated runtime:** 2–4 minutes
- **GitHub Actions free tier usage:** ~90 min/month of 2,000 free minutes (~4%)

---

## Safety Rules
1. Only price/cost/stock columns are touched — enriched fields (description, taste, country, etc.) are never overwritten
2. Margins are always recomputed from raw cost+price — sheet formula columns ignored
3. `consign` is written to Supabase but excluded from the live export (margin-leak guard)
4. Script exits non-zero on any Supabase write error → Action fails → no partial deploys
5. Dry-run mode (`--dry-run`) prints what would change without writing anything
