# SEO + AEO Data Hub — Design Spec
**Date:** 2026-04-19
**Project:** WNLQ9 PIE / ENGINE_PRODUCT
**Sites:** Wine-Now (th.wine-now.com) · LIQ9 (th.liq9.com)
**Status:** Approved — ready for implementation

---

## Vision

Claude becomes the central intelligence layer for all SEO and AEO work across Wine-Now and LIQ9. All website traffic and performance data (GA4, GSC, Google Sheets) is parsed into Supabase daily. A visual dashboard gives at-a-glance monitoring. Claude queries the same database to answer questions, detect anomalies, generate content briefs, and produce reports — all grounded in real numbers.

---

## Scope — Phase 1 (this implementation)

- Daily sync: GSC + GA4 → Supabase (both sites)
- 10-table schema with full data lifecycle management
- `/analytics` dashboard page (Next.js, reads from Supabase)
- Claude query interface (`/api/claude-analyst` + direct Supabase access)

### Out of scope for Phase 1 (planned Phase 2–4)
- AEO monitor (AI assistant response tracking)
- Content decay detector + content calendar engine
- Competitor SERP tracking
- Core Web Vitals / PageSpeed integration
- Automated weekly reports + alert system
- Full revenue attribution per keyword
- Internal link map + schema markup audit

---

## Architecture

```
Google APIs (GSC + GA4)
        │
        ▼
/api/sync  (POST, daily Vercel Cron 07:00 ICT)
        │
        ▼
Supabase DB  ◄──── lifecycle cleanup (weekly cron)
        │
   ┌────┴────┐
   ▼         ▼
/analytics   Claude Analyst
(dashboard)  (/api/claude-analyst + direct DB)
```

**Key principle:** Google APIs are write-once per day. Everything else reads from Supabase. No live Google API calls from the dashboard or Claude.

---

## Database Schema

All tables share these common columns:
- `site` — `'winenow'` or `'liq9'`
- `synced_at` — timestamp of the sync run that wrote this row
- `data_state` — `'raw'` | `'processed'` | `'archived'`

### GSC Tables

**`gsc_daily`**
Aggregated daily totals per site. One row per site per date.
```sql
CREATE TABLE gsc_daily (
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
```

**`gsc_keywords`**
Top 100 keywords per site per daily snapshot. Supports position trend queries.
```sql
CREATE TABLE gsc_keywords (
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
```

**`gsc_pages`**
Top 50 pages per site per daily snapshot.
```sql
CREATE TABLE gsc_pages (
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
```

### GA4 Tables

**`ga4_daily`**
Daily aggregate per site. One row per site per date.
```sql
CREATE TABLE ga4_daily (
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
```

**`ga4_by_source`**
Daily breakdown by traffic channel.
```sql
CREATE TABLE ga4_by_source (
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
```

**`ga4_ecommerce`**
Daily purchase funnel per site.
```sql
CREATE TABLE ga4_ecommerce (
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
```

### Intelligence Tables

**`content_signals`**
Rebuilt daily from GSC data. Powers the "pages to update" dashboard panel and Claude opportunity queries.
```sql
CREATE TABLE content_signals (
  id                  bigserial PRIMARY KEY,
  site                text NOT NULL,
  page                text NOT NULL,
  avg_position_7d     numeric(5,1),
  avg_position_30d    numeric(5,1),
  position_delta      numeric(5,1),  -- 30d vs 7d (positive = dropping)
  avg_ctr_7d          numeric(5,2),
  avg_ctr_30d         numeric(5,2),
  impressions_30d     integer,
  clicks_30d          integer,
  decay_score         numeric(5,2),  -- 0-100, higher = more decay
  opportunity_score   numeric(5,2),  -- 0-100, higher = better opportunity
  last_rebuilt        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, page)
);
```

**`data_snapshots`**
Full JSON snapshot of `/api/data-center` response stored daily. Used by Claude for historical context comparisons.
```sql
CREATE TABLE data_snapshots (
  id           bigserial PRIMARY KEY,
  site         text NOT NULL DEFAULT 'all',
  snapshot_date date NOT NULL,
  payload      jsonb NOT NULL,
  compressed   boolean NOT NULL DEFAULT false,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, snapshot_date)
);
```

### System Tables

**`sync_log`**
One row per sync run per site. The source of truth for "did everything sync correctly?"
```sql
CREATE TABLE sync_log (
  id            bigserial PRIMARY KEY,
  run_id        uuid NOT NULL DEFAULT gen_random_uuid(),
  site          text NOT NULL,
  started_at    timestamptz NOT NULL,
  completed_at  timestamptz,
  rows_written  integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'running',  -- 'running'|'ok'|'partial'|'error'
  error_msg     text,
  duration_ms   integer
);
```

### Data Lifecycle Rules

Enforced by a weekly cleanup cron (Sunday 02:00 ICT):

| Table | Active window | Action after window |
|-------|--------------|-------------------|
| `gsc_keywords` | 90 days | `data_state = 'archived'` |
| `gsc_pages` | 90 days | `data_state = 'archived'` |
| `ga4_by_source` | 1 year | `data_state = 'archived'` |
| `gsc_daily` | 2 years | `data_state = 'archived'` |
| `ga4_daily` | 2 years | `data_state = 'archived'` |
| `ga4_ecommerce` | 2 years | `data_state = 'archived'` |
| `data_snapshots` | 30 days (full) | `compressed = true` (weekly thereafter) |
| `sync_log` | 90 days | `DELETE` |

Archived rows remain queryable by Claude. Dashboard queries add `WHERE data_state != 'archived'` by default.

---

## Sync Pipeline

### Route: `POST /api/sync`

**Query params:**
- `?site=winenow` — sync one site only
- `?site=liq9` — sync one site only
- *(no param)* — sync both sites sequentially
- `?refresh=true` — force re-sync even if today's log shows success

**Auth:** Requires `Authorization: Bearer $CRON_SECRET` header. Vercel Cron sends this automatically. Manual calls from Claude Code pass it explicitly.

**Execution sequence per site:**

```
1. Check sync_log — if today's run completed 'ok', skip (unless refresh=true)
2. Insert sync_log row (status = 'running')
3. Fetch GSC data via /api/gsc?site=X&days=30
   → upsert gsc_daily (last 30 days)
   → upsert gsc_keywords (today's snapshot, top 100)
   → upsert gsc_pages (today's snapshot, top 50)
4. Fetch GA4 data via /api/ga4?site=X&days=30
   → upsert ga4_daily (last 30 days)
   → upsert ga4_by_source (last 30 days)
   → upsert ga4_ecommerce (last 30 days, from conversions array)
5. Rebuild content_signals (DELETE + re-insert for this site)
6. Snapshot /api/data-center → insert data_snapshots
7. Update sync_log (status = 'ok', rows_written, duration_ms)
8. (Sunday only) Run lifecycle cleanup
```

**Error handling:**
- Each step (GSC, GA4, content_signals, snapshot) is wrapped independently with try/catch
- Failed steps set `status = 'partial'` and log the error in `error_msg`
- The run continues even if individual steps fail — partial data is better than no data

### Vercel Cron Configuration (`vercel.json`)

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

Runs at 00:00 UTC = 07:00 ICT daily.

---

## Dashboard UI — `/analytics`

New page in the existing Next.js app. All data from Supabase (zero live Google API calls). Built with existing Next.js Server Components + Supabase client patterns.

### Layout

```
Header: [Wine-Now] [LIQ9] [Both]    Period: [7d] [30d] [90d]    Last sync: 07:02 ✅

Row 1 — KPI Cards (5 cards):
  Organic Clicks | Impressions | Sessions | Purchases | Revenue

Row 2 — Charts (2 columns):
  Traffic Trend (line: GSC clicks + GA4 sessions, 30d)
  Channel Mix (bar: Organic / Direct / Referral / Social)

Row 3 — Tables (2 columns):
  Top Keywords (position, clicks, CTR, 7d trend arrow)
  Pages to Update (opportunity_score, impressions, current CTR, target action)

Row 4 — E-commerce + Sync Status:
  Purchase Funnel (add-to-cart → checkout → purchase conversion)
  Sync Log (last 7 runs, status per site)
```

### Pages to Update Panel

Queries `content_signals WHERE opportunity_score > 60 AND site = $site ORDER BY opportunity_score DESC LIMIT 10`.

Shows: page URL · impressions (30d) · current position · current CTR · suggested action label (`"Improve title"` / `"Add content"` / `"Build links"`).

This directly answers *"which pages should I update this week?"* without requiring Claude.

---

## Claude Query Interface

### Route: `POST /api/claude-analyst`

Accepts `{ question: string, site?: string, days?: number }`.

Claude receives:
1. System prompt with full schema description + today's `claudeContext` from latest `data_snapshots`
2. Current `sync_log` status (so it knows data freshness)
3. Tool definitions for pre-built Supabase query functions

### Pre-built Query Functions

| Function | SQL pattern | Example question answered |
|----------|------------|--------------------------|
| `getTrafficTrend(site, days)` | `gsc_daily` + `ga4_daily` time-series | "Show me last 30 days traffic" |
| `getKeywordMovers(site, days)` | Compare `gsc_keywords` snapshots N days apart | "Which keywords improved this month?" |
| `getPagesToUpdate(site)` | `content_signals` by opportunity_score | "What should I update this week?" |
| `getAnomalies(site, date)` | Compare date vs 7-day avg, flag >2σ | "Why did traffic drop Tuesday?" |
| `compareWeeks(site, w1, w2)` | Week-over-week diff all metrics | "How did last week compare to prior?" |
| `getContentDecay(site)` | `content_signals WHERE decay_score > 60` | "Which pages are losing ground?" |
| `getRevenueByChannel(site, month)` | `ga4_by_source` + `ga4_ecommerce` join | "Which channel drives most purchases?" |

### Access Modes

**1. Chat panel on `/analytics` page**
Inline question box. Claude answers with text + optional inline mini-chart. Suitable for quick questions.

**2. Claude Code (this session)**
Claude calls Supabase directly via the existing `SUPABASE_DB_URL` connection. No API route needed. Full SQL access for deep analysis, brief generation, and report writing.

**3. Scheduled reports (Phase 2)**
Every Monday 08:00 ICT: Claude auto-generates a weekly digest and inserts it into `data_snapshots` for reference.

---

## Environment Variables Required

```bash
# Already configured
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_DB_URL=...
GOOGLE_SERVICE_ACCOUNT_JSON=...

# New — add to .env.local + Vercel dashboard
CRON_SECRET=<random-32-char-string>   # secures /api/sync from public access
SUPABASE_SERVICE_ROLE_KEY=...          # allows server-side upserts (not just reads)
```

---

## Phased Roadmap

| Phase | Scope | When |
|-------|-------|------|
| **1 — Core** | Schema + sync pipeline + dashboard + Claude query interface | Now |
| **2 — Intelligence** | AEO monitor, content decay detector, content calendar, anomaly alerts | Week 2 |
| **3 — Technical SEO** | Core Web Vitals, index health, internal link map, schema audit | Week 3–4 |
| **4 — Business Intelligence** | Revenue attribution per keyword, product↔content linkage, automated reports | Month 2 |

---

## Success Criteria (Phase 1)

- [ ] `/api/sync` runs daily at 07:00 ICT and writes to all 8 data tables
- [ ] `sync_log` correctly records success/partial/error for every run
- [ ] `/analytics` page loads in < 2s from Supabase (no Google API calls)
- [ ] "Pages to update" panel shows correct opportunity-scored pages
- [ ] Claude can answer all 7 pre-built query types with real Supabase data
- [ ] Data lifecycle cleanup runs weekly without manual intervention
- [ ] Manual `POST /api/sync?refresh=true` works from Claude Code session
