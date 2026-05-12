# WNLQ9 BI App — Build Prompt
# Paste this entire file into Claude Code when inside the CLAUDE-DATA_WNLQ9-M-REPORT-ALL repo.

---

## Context & Mission

You are building the **WNLQ9 SEO + AEO Data Hub** — the single source of truth for all
traffic, search, and performance data for two Thai e-commerce wine/spirits sites:
- **Wine-Now** — `th.wine-now.com` (GA4 property: `377750759`)
- **LIQ9** — `th.liq9.com` (GA4 property: `377924618`)

**Architecture:**
```
Google APIs (GSC + GA4)
        ↓
THIS BI APP  ←  source of truth for ALL SEO/AEO + traffic data
  Supabase DB + /analytics dashboard + Claude analyst
        ↓  (later, on-demand)
ENGINE_PRODUCT  ←  pulls from this app's Supabase when it needs traffic data
```

This app:
- Pulls GSC + GA4 data into Supabase daily (automated sync)
- Provides a live `/analytics` dashboard
- Exposes a `/api/data` read endpoint so ENGINE_PRODUCT and other apps can consume the data
- Gives Claude direct Supabase access to answer SEO/AEO questions with real data

ENGINE_PRODUCT (separate repo) handles product catalog only and will pull traffic
data from this app's Supabase tables when needed — it never calls Google APIs directly.

---

## Existing Infrastructure (already built in ENGINE_PRODUCT — reuse patterns)

### Google Service Account
```
Email: seo-dashboard@wnlq0-seo.iam.gserviceaccount.com
GCP Project: wnlq0-seo (project number: 1030487865754)
Scopes needed: webmasters.readonly, analytics.readonly, spreadsheets.readonly
```

The service account JSON is stored in env as `GOOGLE_SERVICE_ACCOUNT_JSON`.

### Working API Route Patterns (copy these exact patterns)

**GSC Auth + Query:**
```typescript
import { google } from 'googleapis';

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const credentials = JSON.parse(raw!);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
}

// Site map
const SITE_MAP: Record<string, string> = {
  winenow: 'https://th.wine-now.com/',
  liq9:    'https://th.liq9.com/',
};
```

**GA4 Auth + Query:**
```typescript
const GA4_PROPERTY_MAP: Record<string, string> = {
  winenow: '377750759',   // Primary — full Enhanced E-commerce
  liq9:    '377924618',
};

// Auth
const auth = getAuth(); // same helper as GSC
const token = await auth.getAccessToken();
const base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

// Example: sessions + purchases
const res = await fetch(base, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'bounceRate' },
      { name: 'screenPageViews' },
      { name: 'ecommercePurchases' },
      { name: 'purchaseRevenue' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    limit: 90,
  }),
}).then(r => r.json());
```

**Google Sheets Auth:**
```typescript
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth });
```

### Google Sheets (already populated by Apps Script, readable now)
```
WN GA Sheet:   1jJm5FVGOdbCgPcrb02sUwghl3me0np4J1b5kOCKOGDA
LIQ9 GA Sheet: 19EzmTkLnrxSMauYLHNXze45c-vxT7w2uWucqtT2mVDo
GSC Sheet:     1YG7E0ccwwl1piRhciinXFGVbeOOpJ9ASDJjB2kVE0Ig

Tab names:
  WN/LIQ9 GA:  Monthly Summary | Daily Metrics | Daily by Source |
               Ecommerce Daily | Product Performance | Landing Pages |
               Traffic Overview | Top Pages | Traffic Sources |
               Devices | Countries | Daily Trend
  GSC:         WN GSC 90D | LIQ9 GSC 90D | WN GSC FEED | LIQ9 GSC FEED | GSC Status

WN GA Daily Metrics:  837 rows, 2024-01-01 → 2026-04-16 ✅
LIQ9 Daily Metrics:   836 rows, 2024-01-01 → 2026-04-16 ✅
WN GSC 90D:           25,000 rows (page × query, rolling 90d) ✅
LIQ9 GSC 90D:         17 rows (small site, brand keywords only) ✅
```

### Supabase Project
```
URL: https://xfcvliyxxguhihehqwkg.supabase.co
Publishable key: sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel
DB URL: postgresql://postgres:fTK5pLSs_SASqxt@db.xfcvliyxxguhihehqwkg.supabase.co:5432/postgres
```
*Note: You will need `SUPABASE_SERVICE_ROLE_KEY` from the Supabase dashboard for server-side writes.*

---

## What to Build — Phase 1

### 1. Database Schema (run in Supabase SQL editor)

```sql
-- GSC daily aggregate
CREATE TABLE IF NOT EXISTS gsc_daily (
  id            bigserial PRIMARY KEY,
  site          text NOT NULL,
  date          date NOT NULL,
  clicks        integer NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  avg_ctr       numeric(5,2) NOT NULL DEFAULT 0,
  avg_position  numeric(5,1) NOT NULL DEFAULT 0,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  data_state    text NOT NULL DEFAULT 'raw',
  UNIQUE (site, date)
);

-- GSC top keywords snapshot (top 100 per site per day)
CREATE TABLE IF NOT EXISTS gsc_keywords (
  id            bigserial PRIMARY KEY,
  site          text NOT NULL,
  snapshot_date date NOT NULL,
  keyword       text NOT NULL,
  clicks        integer NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  ctr           numeric(5,2) NOT NULL DEFAULT 0,
  position      numeric(5,1) NOT NULL DEFAULT 0,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  data_state    text NOT NULL DEFAULT 'raw',
  UNIQUE (site, snapshot_date, keyword)
);

-- GSC top pages snapshot (top 50 per site per day)
CREATE TABLE IF NOT EXISTS gsc_pages (
  id            bigserial PRIMARY KEY,
  site          text NOT NULL,
  snapshot_date date NOT NULL,
  page          text NOT NULL,
  clicks        integer NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  ctr           numeric(5,2) NOT NULL DEFAULT 0,
  position      numeric(5,1) NOT NULL DEFAULT 0,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  data_state    text NOT NULL DEFAULT 'raw',
  UNIQUE (site, snapshot_date, page)
);

-- GA4 daily aggregate
CREATE TABLE IF NOT EXISTS ga4_daily (
  id                    bigserial PRIMARY KEY,
  site                  text NOT NULL,
  date                  date NOT NULL,
  sessions              integer NOT NULL DEFAULT 0,
  users                 integer NOT NULL DEFAULT 0,
  new_users             integer NOT NULL DEFAULT 0,
  page_views            integer NOT NULL DEFAULT 0,
  bounce_rate           numeric(5,2) NOT NULL DEFAULT 0,
  avg_session_duration  integer NOT NULL DEFAULT 0,
  purchases             integer NOT NULL DEFAULT 0,
  revenue               numeric(12,2) NOT NULL DEFAULT 0,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  data_state            text NOT NULL DEFAULT 'raw',
  UNIQUE (site, date)
);

-- GA4 daily by channel
CREATE TABLE IF NOT EXISTS ga4_by_source (
  id           bigserial PRIMARY KEY,
  site         text NOT NULL,
  date         date NOT NULL,
  channel      text NOT NULL,
  source       text,
  medium       text,
  sessions     integer NOT NULL DEFAULT 0,
  users        integer NOT NULL DEFAULT 0,
  conversions  integer NOT NULL DEFAULT 0,
  revenue      numeric(12,2) NOT NULL DEFAULT 0,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  data_state   text NOT NULL DEFAULT 'raw',
  UNIQUE (site, date, channel)
);

-- GA4 ecommerce daily
CREATE TABLE IF NOT EXISTS ga4_ecommerce (
  id                    bigserial PRIMARY KEY,
  site                  text NOT NULL,
  date                  date NOT NULL,
  purchases             integer NOT NULL DEFAULT 0,
  revenue               numeric(12,2) NOT NULL DEFAULT 0,
  add_to_carts          integer NOT NULL DEFAULT 0,
  checkouts             integer NOT NULL DEFAULT 0,
  cart_to_purchase_pct  numeric(5,2) NOT NULL DEFAULT 0,
  avg_order_value       numeric(10,2) NOT NULL DEFAULT 0,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  data_state            text NOT NULL DEFAULT 'raw',
  UNIQUE (site, date)
);

-- Content opportunity signals (rebuilt daily from GSC data)
CREATE TABLE IF NOT EXISTS content_signals (
  id                  bigserial PRIMARY KEY,
  site                text NOT NULL,
  page                text NOT NULL,
  avg_position_7d     numeric(5,1),
  avg_position_30d    numeric(5,1),
  position_delta      numeric(5,1),
  avg_ctr_7d          numeric(5,2),
  avg_ctr_30d         numeric(5,2),
  impressions_30d     integer,
  clicks_30d          integer,
  decay_score         numeric(5,2),       -- 0-100, higher = losing ground
  opportunity_score   numeric(5,2),       -- 0-100, higher = quick win potential
  last_rebuilt        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, page)
);

-- Daily full data snapshot for Claude context
CREATE TABLE IF NOT EXISTS data_snapshots (
  id            bigserial PRIMARY KEY,
  site          text NOT NULL DEFAULT 'all',
  snapshot_date date NOT NULL,
  payload       jsonb NOT NULL,
  compressed    boolean NOT NULL DEFAULT false,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, snapshot_date)
);

-- Sync run log
CREATE TABLE IF NOT EXISTS sync_log (
  id            bigserial PRIMARY KEY,
  run_id        uuid NOT NULL DEFAULT gen_random_uuid(),
  site          text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  rows_written  integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'running',
  error_msg     text,
  duration_ms   integer
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_gsc_daily_site_date ON gsc_daily(site, date DESC);
CREATE INDEX IF NOT EXISTS idx_ga4_daily_site_date ON ga4_daily(site, date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_keywords_site_date ON gsc_keywords(site, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_content_signals_opportunity ON content_signals(site, opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_site_started ON sync_log(site, started_at DESC);
```

---

### 2. Environment Variables

Add to `.env.local`:
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xfcvliyxxguhihehqwkg.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel
SUPABASE_SERVICE_ROLE_KEY=<get from Supabase dashboard → Settings → API>

# Google (same service account as ENGINE_PRODUCT)
GOOGLE_SERVICE_ACCOUNT_JSON='<paste full JSON>'

# Sync security
CRON_SECRET=<generate: openssl rand -hex 32>

# App
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

---

### 3. Daily Sync Route — `app/api/sync/route.ts`

Build `POST /api/sync` that:

1. Checks `Authorization: Bearer $CRON_SECRET` header (return 401 if missing/wrong)
2. Reads `?site=winenow|liq9` param (if absent, syncs both sequentially)
3. For each site:
   a. Check `sync_log` — skip if today already has `status = 'ok'` (unless `?refresh=true`)
   b. Insert `sync_log` row with `status = 'running'`
   c. Pull GSC: call GSC API for last 30 days → upsert `gsc_daily`, `gsc_keywords` (top 100), `gsc_pages` (top 50)
   d. Pull GA4: call GA4 API for last 30 days → upsert `ga4_daily`, `ga4_by_source`, `ga4_ecommerce`
   e. Rebuild `content_signals`:
      - For each page in `gsc_pages` (last 30 days):
        - `avg_position_7d` = avg position from `gsc_pages` snapshots in last 7 days
        - `avg_position_30d` = avg position from last 30 days
        - `position_delta` = avg_position_7d - avg_position_30d (positive = dropping)
        - `opportunity_score` = calculated from: impressions > 500 AND position 5–20 AND ctr < 2%
        - `decay_score` = calculated from position_delta > 2 AND impressions_30d > 200
   f. Upsert today's `data_snapshots` (call `/api/data-center` from ENGINE_PRODUCT or build inline)
   g. Update `sync_log` with `status = 'ok'`, `rows_written`, `duration_ms`
4. Return JSON summary of what was synced

**Error handling:** Each step (c, d, e, f) wrapped in try/catch. Failure sets `status = 'partial'`
and logs `error_msg` but does NOT abort remaining steps.

---

### 4. Vercel Cron — `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/sync",
      "schedule": "0 0 * * *"
    }
  ]
}
```

Runs 00:00 UTC = 07:00 ICT daily.

---

### 5. Dashboard Page — `app/analytics/page.tsx`

New page at `/analytics`. Server Component. All data from Supabase (zero live Google API calls).

**Sections to build:**

**A. Header**
- Site switcher: [Wine-Now] [LIQ9] [Both]
- Period switcher: [7d] [30d] [90d]
- Last sync timestamp + status dot from `sync_log`

**B. KPI Cards (row of 5)**
Query: `gsc_daily` + `ga4_daily` summed for selected period + site
- Organic Clicks (vs prior period %)
- Impressions (vs prior period %)
- Sessions (vs prior period %)
- Purchases (vs prior period %)
- Revenue in THB (vs prior period %)

**C. Traffic Trend Chart**
Query: `gsc_daily` + `ga4_daily` joined by date for selected period
Dual-line chart: GSC organic clicks (left axis) + GA4 sessions (right axis)

**D. Channel Mix**
Query: `ga4_by_source` grouped by channel for selected period
Horizontal bar chart: Organic / Direct / Referral / Social / Other

**E. Top Keywords Table**
Query: `gsc_keywords` WHERE snapshot_date = today (or latest available)
Columns: Keyword · Position · Clicks · Impressions · CTR
Add: 7-day position trend arrow (compare today vs 7 days ago)

**F. Pages to Update** ← most important panel
Query: `content_signals WHERE opportunity_score > 50 ORDER BY opportunity_score DESC LIMIT 10`
Columns: Page · Impressions (30d) · Current Position · CTR · Suggested Action
Action label logic:
- position > 10 AND impressions > 1000 → "Improve title & meta"
- position 5–10 AND ctr < 2% → "A/B test title"
- position_delta > 3 → "Content needs refresh"
- impressions > 5000 AND clicks < 100 → "Critical: low CTR"

**G. E-commerce Funnel**
Query: `ga4_ecommerce` summed for period
Stats: Add-to-carts → Checkouts → Purchases → Revenue
Show: cart-to-purchase %, AOV

**H. Sync Status**
Query: `sync_log ORDER BY started_at DESC LIMIT 14` (last 7 runs per site)
Table: Site · Date · Status · Rows written · Duration

---

### 6. Claude Analyst Route — `app/api/claude-analyst/route.ts`

`POST /api/claude-analyst` accepts `{ question: string, site?: string, days?: number }`.

Build pre-built query functions the route uses:

```typescript
// Query functions (use Supabase service role client)
async function getTrafficTrend(site: string, days: number)
  // Returns: gsc_daily + ga4_daily joined by date for last N days

async function getKeywordMovers(site: string, days: number)
  // Returns: keywords where position changed most vs N days ago
  // Compare latest gsc_keywords snapshot vs snapshot from N days ago

async function getPagesToUpdate(site: string)
  // Returns: content_signals WHERE opportunity_score > 50 ORDER BY opportunity_score DESC

async function getAnomalies(site: string, targetDate: string)
  // Returns: for targetDate, compare each metric vs 7-day prior average
  // Flag any metric > 2 standard deviations from mean as anomaly

async function compareWeeks(site: string, week1End: string, week2End: string)
  // Returns: week-over-week diff for all metrics in gsc_daily + ga4_daily

async function getContentDecay(site: string)
  // Returns: content_signals WHERE decay_score > 60 ORDER BY decay_score DESC

async function getRevenueByChannel(site: string, month: string)
  // Returns: ga4_by_source WHERE date LIKE '${month}%' grouped by channel
  //          joined with ga4_ecommerce for revenue totals
```

Claude system prompt should include:
- Schema summary (all 8 tables and their columns)
- Latest `sync_log` status
- Latest `data_snapshots` payload as context
- Instructions to call query functions and return data-grounded answers

---

## Implementation Order

1. **Run SQL schema** in Supabase SQL editor
2. **Add env vars** to `.env.local`
3. **Build `/api/sync`** — test manually with `curl -X POST localhost:3000/api/sync -H "Authorization: Bearer $CRON_SECRET"`
4. **Verify data** — check all 8 tables have rows after first sync
5. **Build `/analytics` page** — sections B through H in order
6. **Build `/api/claude-analyst`** — add query functions + Claude integration
7. **Add `vercel.json` cron** — deploy and verify first automated run
8. **Test end-to-end** — ask Claude "why did traffic drop last Tuesday?" and verify it answers from DB

---

## Success Criteria

- [ ] `/api/sync` runs and populates all tables for both sites
- [ ] `sync_log` correctly records success/partial/error
- [ ] `/analytics` page loads < 2s (Supabase only, no Google API calls)
- [ ] "Pages to update" panel shows correct opportunity-scored pages
- [ ] Claude answers all 7 query types with real DB data
- [ ] Vercel Cron runs daily at 07:00 ICT without manual intervention

---

## Phase 2 (build after Phase 1 is stable)

- **AEO Monitor:** Daily query to ChatGPT/Perplexity/Gemini — "best wine shop Thailand" — store responses, detect brand mentions, sentiment
- **Content Decay Alerts:** Pages losing 3+ positions over 30 days → Slack/LINE notification
- **Content Calendar Engine:** Claude analyses keyword gaps + seasonal GSC trends → generates monthly content plan
- **Competitor SERP Tracker:** Track competitor positions for top 20 keywords weekly
- **Automated Monday Report:** Claude generates weekly digest, stores in `data_snapshots`
- **Core Web Vitals:** PageSpeed Insights API → store LCP/CLS/FID per page weekly

---

## Public Read API — `app/api/data/route.ts`

Build `GET /api/data` so ENGINE_PRODUCT and any other consumer can pull
pre-aggregated data without touching Google APIs or Supabase directly.

```
GET /api/data?site=winenow&days=30    ← traffic summary for one site
GET /api/data?site=liq9&days=30
GET /api/data?type=pages&site=winenow ← pages to update (opportunity list)
GET /api/data?type=keywords&site=winenow ← top keywords
GET /api/data?type=sync               ← last sync status for all sources
```

Response shape (always JSON, always from Supabase — never live Google API):
```json
{
  "generatedAt": "2026-04-19T07:15:00Z",
  "site": "winenow",
  "period": { "days": 30 },
  "gsc": {
    "clicks": 22448, "impressions": 569734,
    "avgPosition": 2.8, "avgCtr": 3.9,
    "topKeywords": [...],
    "topPages": [...]
  },
  "ga4": {
    "sessions": 36723, "users": 27146,
    "bounceRate": 47.3, "purchases": 96, "revenue": 284000
  },
  "pagesToUpdate": [
    { "page": "/blog/jack-daniels.html", "impressions": 21741,
      "position": 4.3, "ctr": 1.3, "opportunityScore": 87 }
  ],
  "syncStatus": { "lastSync": "2026-04-19T07:02:00Z", "status": "ok" }
}
```

This endpoint is how ENGINE_PRODUCT will eventually consume traffic data.
No auth required for read (or add `API_READ_KEY` env var if you want to restrict it).

---

## Notes

- Both apps share the same Supabase project (different tables, no conflict)
- Both apps use the same Google service account (`seo-dashboard@wnlq0-seo.iam.gserviceaccount.com`)
- The Google Sheets Apps Script continues running daily in parallel — feeds Sheets for spreadsheet use, Supabase pipeline is the authoritative source for the BI app
- WN Ecommerce data in Sheets is sparse (old wrong property ID). This Supabase pipeline uses correct property `377750759` from day one — will have accurate purchase/revenue data immediately
- ENGINE_PRODUCT pulls from `/api/data` (this app) — never calls Google APIs itself
