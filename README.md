# WineNow Flavor Intelligence System

WineNow is a Next.js 14 starter for managing wine and liquor product intelligence across taxonomy, flavor DNA, AI enrichment, and batch import workflows.

## What changed in this version

- global taxonomy workbook audit based on the shared sheet structure
- self-healing batch processing preview for inconsistent import rows
- render-safe validation checks before charting/export
- expanded Supabase schema for taxonomy registries and import runs
- wired the provided Supabase project URL + publishable key into safe environment-based config
- documented Excel import workflow plus a starter CSV template

## Getting started

```bash
cp .env.example .env.local
npm install
npm run dev
```

Then open <http://localhost:3000>.

## Supabase project setup

The app is prepared for this Supabase project:

- Project URL: `https://xfcvliyxxguhihehqwkg.supabase.co`
- Publishable key: configured through `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Direct DB URL template: `postgresql://postgres:[YOUR-PASSWORD]@db.xfcvliyxxguhihehqwkg.supabase.co:5432/postgres`

Apply the schema with either:

```bash
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

or the Supabase SQL editor. See `docs/supabase-setup.md` for the full flow.

## Core files

- `app/page.tsx` – application entry point
- `components/dashboard.tsx` – primary dashboard UI with taxonomy audit and batch validation
- `lib/data.ts` – sample product records and raw import rows
- `lib/taxonomy.ts` – visible global taxonomy workbook structure and audit findings
- `lib/auto-mapping.ts` – flavor profile assembly and confidence scoring
- `lib/batch-pipeline.ts` – self-healing normalization and import preview logic
- `lib/render-validation.ts` – UI safety checks before rendering
- `lib/supabase/config.ts` – environment-based Supabase project configuration
- `lib/supabase/client.ts` – browser-safe Supabase client
- `supabase/schema.sql` – database schema for products, taxonomy, and import run tracking
- `docs/excel-import-process.md` – step-by-step Excel import process
- `docs/supabase-setup.md` – project-specific Supabase setup instructions
- `public/templates/winenow-import-template.csv` – starter import template
