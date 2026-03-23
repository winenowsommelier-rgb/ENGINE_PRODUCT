# WineNow Flavor Intelligence System

WineNow is a Next.js 14 frontend for reviewing wine and liquor product intelligence across catalog, flavor DNA, taxonomy quality, and self-healing batch imports.

## Frontend access

Run the Next.js frontend directly from the repo root when package installation is available:

```bash
cp .env.example .env.local
npm install
npm run dev
```

Then open <http://localhost:3000>. The default dev script now binds to `0.0.0.0:3000`, so the app is reachable from local browsers, forwarded ports, and remote workspaces.

### Beginner quick start

If you are brand new to the project, use this order:

1. `cp .env.example .env.local`
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:3000`
5. Start with the **Import** page, then move to **Processing Review**, **Taxonomy Queue**, **Products**, and **Override Import**

### Magento upload flow

The **Import** page includes a CSV upload section for Magento/product-export files.

After you upload a file, the app will:

1. map supported headers such as `sku`, `name`, `price`, `cost`, `product_type`, `region`, `grape`, and `style`
2. normalize the rows into the self-healing import pipeline
3. show blocked vs library-ready rows
4. stage clean rows for the product library before database insertion

The Import page also includes a **Save ready rows to database** action. For that button to work, you need:

- the correct `.env.local` values
- insert/upsert policies that allow the publishable key to write to `import_runs`, `import_run_rows`, `products`, and `flavor_profile`

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

- `app/page.tsx` – application entry point.
- `components/dashboard.tsx` – sidebar shell and page routing.
- `components/pages/` – individual page components (Import, ProcessingReview, TaxonomyQueue, Products, OverrideImport, Settings).
- `lib/data.ts` – sample product records and raw import rows.
- `lib/taxonomy/maps.ts` – taxonomy data maps (country, region, grape aliases).
- `lib/taxonomy/service.ts` – normalization, suggestion, and scoring logic.
- `lib/auto-mapping.ts` – flavor profile assembly and confidence scoring.
- `lib/batch-processor.ts` – self-healing normalization and import preview logic.
- `lib/db/client.ts` – JSON file database for local working data.
- `lib/render-validation.ts` – UI safety checks before rendering.
- `lib/supabase/config.ts` – environment-based Supabase project configuration.
- `lib/supabase/client.ts` – Supabase REST helpers for sync.
- `supabase/schema.sql` – database schema for products, taxonomy, and import run tracking.
- `docs/excel-import-process.md` – step-by-step Excel import process.
- `docs/supabase-setup.md` – project-specific Supabase setup instructions.
- `public/templates/winenow-import-template.csv` – starter import template.
