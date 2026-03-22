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

<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
### Beginner quick start

If you are brand new to the project, use this order:

1. `cp .env.example .env.local`
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:3000`
5. Start with the **Overview** workspace, then move to **Catalog workspace**, **Import studio**, and **Taxonomy control**

### Magento upload flow now available in the app

The **Import studio** workspace now includes a CSV upload section for Magento/product-export files.

After you upload a file, the app will:

1. map supported headers such as `sku`, `name`, `price`, `cost`, `product_type`, `region`, `grape`, and `style`
2. normalize the rows into the self-healing import pipeline
3. show blocked vs library-ready rows
4. stage clean rows for the product library before database insertion

The Import Studio now also includes a **Save ready rows to database** action. For that button to work, you need:

- `supabase/schema.sql` applied
- the correct `.env.local` values
- insert/upsert policies that allow the publishable key to write to `import_runs`, `import_run_rows`, `products`, and `flavor_profile`

<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
If package installation is blocked in your environment, launch the dependency-free preview instead:

```bash
python3 scripts/serve_frontend.py
```

Then open <http://localhost:3000/preview/>.

## Frontend modules available now

- **Overview**: immediate launch instructions plus current app readiness.
- **Catalog workspace**: selectable product library with flavor profile radar, render checks, and pairing context.
- **Import studio**: self-healing batch preview with row-by-row corrections, validation issues, and confidence scoring.
- **Taxonomy control**: workbook tab review, audit findings, and visible country registry.
- **Launch frontend**: exact commands and Supabase environment values for the next connection step.

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
- `components/dashboard.tsx` – frontend workspace UI and launch flow.
- `lib/data.ts` – sample product records and raw import rows.
- `lib/taxonomy.ts` – visible global taxonomy workbook structure and audit findings.
- `lib/auto-mapping.ts` – flavor profile assembly and confidence scoring.
- `lib/batch-pipeline.ts` – self-healing normalization and import preview logic.
- `lib/render-validation.ts` – UI safety checks before rendering.
- `lib/supabase/config.ts` – environment-based Supabase project configuration.
- `lib/supabase/client.ts` – lightweight browser config helper for future REST reads.
- `supabase/schema.sql` – database schema for products, taxonomy, and import run tracking.
- `docs/excel-import-process.md` – step-by-step Excel import process.
- `docs/supabase-setup.md` – project-specific Supabase setup instructions.
- `public/templates/winenow-import-template.csv` – starter import template.
- `preview/` – dependency-free static frontend preview.
- `scripts/serve_frontend.py` – local HTTP server for the preview frontend.
