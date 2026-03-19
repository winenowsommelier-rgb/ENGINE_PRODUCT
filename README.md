# WineNow Flavor Intelligence System

WineNow is a Next.js 14 starter for managing wine and liquor product intelligence across taxonomy, flavor DNA, AI enrichment, and batch import workflows.

## Included in this scaffold

- Premium dark-mode dashboard for product library operations
- Product table with confidence scoring and inline merchandising context
- Flavor radar panel backed by configurable DNA mapping logic
- Batch upload pipeline preview with validation and export checkpoints
- Supabase SQL schema for products, flavor profiles, pairings, and DNA tables

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

## Core files

- `app/page.tsx` – application entry point
- `components/dashboard.tsx` – primary dashboard UI
- `lib/data.ts` – sample product records and taxonomy fixtures
- `lib/auto-mapping.ts` – flavor profile assembly and confidence scoring
- `lib/batch-pipeline.ts` – pipeline preview logic
- `supabase/schema.sql` – database schema for Supabase / PostgreSQL
