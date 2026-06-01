# Validate Supplier List (`/validate`)

Drop a supplier CSV → get a taxonomy-validated CSV back. Reachable from the
dashboard sidebar ("Validate List") or directly at `/validate`.

## What it does

For every row in the uploaded CSV:

1. **Detects supplier columns** automatically (suppliers all name them
   differently): `name`, `brand`, `country`, `region`, `sub-region`, `sku`,
   `classification`, `grape`, `vintage`, `price`.
2. **Normalizes the item name** by matching it to an existing product in
   `data/db/products.json` (exact SKU → exact name → high-confidence fuzzy +
   brand agreement). If there's no confident match it **composes** a clean name
   instead of guessing.
3. **Validates geography** hierarchy-aware against the master taxonomy
   (`data/taxonomy/{countries,regions,subregions}.json`): country → region
   (must belong to that country) → sub-region (must belong to that region).
4. **Validates brand** against the brand set seen in the product database
   (producer is intentionally not validated — the product schema does not
   populate it).
5. **Routes unknowns to review.** Anything not in the taxonomy becomes an
   evidence-backed **proposal** (optionally researched online via Claude),
   filed to `data/db/taxonomy-proposals.json`. Canonical taxonomy is **never**
   auto-written from an upload — a human approves first.

## Row statuses (`overall_status`)

| status | meaning |
|---|---|
| `matched` | confidently linked to an existing product; clean geography |
| `validated` | new but every supplied value is valid |
| `corrected` | matched after fixing case/accents/alias (canonical value filled in) |
| `needs_review` | a plausible-but-unconfirmed fuzzy name match — confirm the candidate |
| `pending_new_taxonomy` | an unknown country/region/sub-region/brand was proposed |

## API

`POST /api/validate-upload`

```jsonc
// body
{ "csv": "raw,csv,text...", "research": true, "download": false }
// or
{ "rows": [ { ... } ], "headers": ["name","country", ...] }
```

- `research` (default `true`): research unknown taxonomy online before
  proposing. Degrades gracefully to `needs_research` when `ANTHROPIC_API_KEY`
  is not set.
- `download: true`: returns a `text/csv` attachment instead of JSON.

JSON response: `{ detectedColumns, summary, total, results, csv, proposals }`.

## Code

- `lib/validation/upload-pipeline.ts` — column detection, name matching,
  geography/brand validation, CSV in/out. Reuses `lib/validation/engine.ts`
  and `lib/taxonomy/service.ts`.
- `lib/validation/taxonomy-research.ts` — online research + local proposal queue.
- `app/api/validate-upload/route.ts` — endpoint.
- `app/validate/` — drop-zone UI.

## Safety notes

- Fuzzy name matches are deliberately conservative (distinct châteaux/houses
  won't collapse into one another). Mid-confidence matches are surfaced as
  `needs_review` candidates, not silently rewritten.
- Unknown taxonomy is proposed, never committed to the canonical library
  without human approval.
