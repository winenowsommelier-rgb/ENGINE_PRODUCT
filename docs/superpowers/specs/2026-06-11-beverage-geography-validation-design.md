# Beverage Geography Validation and Enrichment Design

**Date:** 2026-06-11

## Goal

Produce the best validated `country`, `region`, and `subregion` data possible
for active beverage products before Magento import, using conservative,
taxonomy-backed automation. After review, apply approved corrections to the
local SQLite database, production Supabase, the UI-facing live export, and the
Magento export.

## Scope

### Included

- Active beverage products in `data/db/products.db`.
- Independent validation of `country`, `region`, and `subregion`.
- Exact, unambiguous corrections supported by the local taxonomy.
- Human review for missing, conflicting, coarse, or ambiguous geography.
- Verified publication to local and production data surfaces after approval.

### Excluded

- Accessories, glassware, cigars, events, mineral water, and other
  non-beverage catalog items.
- AI-generated or inferred geography without exact taxonomy evidence.
- Price, stock, descriptions, classification, appellation, and other
  non-geography updates.
- Direct Magento upload. This workflow produces the corrected Magento export;
  Magento import remains a separate controlled action.

## Source of Truth

The product source is:

- `data/db/products.db`, table `products`

The taxonomy source is:

- `data/taxonomy/countries.json`
- `data/taxonomy/regions.json`
- `data/taxonomy/subregions.json`

Each taxonomy relationship must be validated as:

```text
country.id <- region.country_id
region.id <- subregion.region_id
```

Product text, descriptions, brands, and external research may explain why an
item needs review, but they cannot authorize an automatic correction in this
conservative pass.

## Beverage Selection

The existing category and SKU-prefix logic in
`scripts/lib/magento-catalog-quality.mjs` will be reused and tested. A product
is included only when:

- `COALESCE(is_active, 1) = 1`, and
- it is classified as a beverage by the shared `isBeverage()` rule.

The generated reports must include the exact included and excluded counts.

## Validation Rules

Each included product receives one geography status and one or more reason
codes.

### Valid

The current values exactly match a taxonomy path:

```text
country -> region -> subregion
```

A blank subregion may still be valid when only region-level geography is
known. It is reported as incomplete, not automatically incorrect.

### Auto-Correct

Automatic correction is allowed only when the existing values resolve to one
unambiguous taxonomy path through exact normalized matching. Normalization may
only handle mechanical differences:

- surrounding whitespace;
- repeated internal whitespace;
- case differences;
- Unicode normalization;
- an approved explicit alias stored in the taxonomy or audit code.

Examples:

- Canonical spelling or capitalization differs, but the normalized value has
  exactly one taxonomy match under the same parent.
- `region` and `subregion` contain a known reversed hierarchy and there is
  exactly one valid taxonomy path for the current country.
- A redundant `subregion == region` value can be cleared when the taxonomy
  confirms that the value is a region and not a child subregion.

Every automatic correction must record old values, new values, matched
taxonomy IDs, reason code, and confidence `exact`.

### Human Review

No automatic database update is permitted for:

- missing country or region;
- a value absent from taxonomy;
- multiple possible taxonomy matches;
- country-region parent mismatch;
- region-subregion parent mismatch;
- coarse geographic values that may have multiple valid children;
- brand, title, description, or producer evidence without an exact taxonomy
  match;
- disputed category geography, such as production location versus protected
  origin;
- any correction that changes more than mechanical normalization or a proven
  hierarchy reversal.

## Outputs

Only these three user-facing reporting outputs will be generated:

### 1. Automatically Corrected Records

`outputs/beverage-geography-YYYY-MM-DD/automatically_corrected_records.csv`

One row per proposed exact correction, containing:

- SKU and product name;
- old and proposed `country`, `region`, and `subregion`;
- matched taxonomy IDs;
- reason code;
- exact-match evidence;
- business priority;
- application status.

This file is the approved write batch after human review. It must not contain
ambiguous rows.

### 2. Human Review Queue

`outputs/beverage-geography-YYYY-MM-DD/human_review_queue.csv`

One row per product requiring judgment, containing:

- SKU, name, classification, and current geography;
- issue and reason codes;
- candidate taxonomy paths, when available;
- explanation of why automatic correction was refused;
- recent-sales, stock, and revenue priority fields;
- blank reviewer decision and approved replacement fields.

Rows are sorted by recent sales, then stock, then remaining backlog.

### 3. Before/After Quality Report

`outputs/beverage-geography-YYYY-MM-DD/before_after_quality_report.md`

The report contains:

- included beverage count;
- exact-valid count;
- exact auto-correction count;
- human-review count;
- missing country, region, and subregion counts;
- invalid parent relationship counts;
- values absent from taxonomy;
- duplicated region/subregion counts;
- before and projected-after coverage percentages;
- post-application counts after the batch is written;
- local, production, live-export, and Magento verification results.

Supporting machine-readable files may be used internally by tests or scripts,
but they are not additional user-facing outputs.

## Review and Write Workflow

The workflow has two distinct phases.

### Phase 1: Audit Only

1. Read SQLite and taxonomy files without writing.
2. Generate the three outputs.
3. Verify that every auto-correction is exact and unambiguous.
4. Present the correction count and review queue for approval.

No local or production data changes occur in this phase.

### Phase 2: Approved Application

1. Back up `data/db/products.db`.
2. Apply only rows approved in `automatically_corrected_records.csv`.
3. Update `country`, `region`, `subregion`, `updated_at`,
   `enrichment_source`, and `enrichment_note`.
4. Record before/after changes in the existing product changelog when the
   local database API supports it.
5. Re-run the audit and confirm that applied rows now validate exactly.
6. Refresh `data/live_products_export.json`.
7. Push changed rows to Supabase.
8. Regenerate the Magento content/geography export with independent
   `country`, `region`, and `subregion` columns.

If any publication or verification step fails, the workflow stops and reports
the incomplete destination. It must not claim completion based only on local
SQLite changes.

## Production Publication

Production publication uses:

```bash
python3 scripts/sync_to_supabase.py
```

The implementation plan must first inspect the script's CLI and sync-state
behavior. It must ensure the approved rows receive a fresh `updated_at` so
they are included in the delta, and it must avoid a full catalog sync unless
explicitly required.

The UI-facing local export is refreshed with:

```bash
.venv/bin/python scripts/refresh_live_export.py
```

The final Magento export is regenerated with:

```bash
node scripts/export-magento-catalog.mjs 2026-06-11
```

## Verification Gates

Completion requires all four destinations to agree for every applied SKU.

### Local SQLite

Query applied SKUs directly and verify the approved independent fields.

### Production Supabase

Fetch applied SKUs from the production `products` table and compare
`country`, `region`, and `subregion` to SQLite.

### UI-Facing Export

Read `data/live_products_export.json` and compare the same fields for every
applied SKU.

### Magento Export

Read the regenerated CSV and verify:

- headers contain `country`, `region`, and `subregion`;
- no `region_wine` header exists;
- no `region` or `subregion` value contains `|`;
- applied SKUs match SQLite and Supabase exactly.

The before/after report records row counts and any mismatched SKUs for each
destination. A zero-mismatch result is required before declaring the work
complete.

## Safety and Recovery

- Phase 1 is read-only.
- Phase 2 begins with a timestamped SQLite backup.
- Only approved SKUs and geography columns may be updated.
- The apply script supports dry-run and rejects duplicate SKUs.
- Unknown taxonomy IDs or changed source values abort that row rather than
  overwriting newer data.
- Production sync failures are retained as explicit failures in the report.
- Existing unrelated worktree changes are not modified or committed.

## Testing

Tests must cover:

- beverage inclusion and non-beverage exclusion;
- exact valid taxonomy paths;
- exact canonical normalization;
- ambiguous matches routed to review;
- country-region mismatch;
- region-subregion mismatch;
- hierarchy reversal only when unique;
- redundant `region == subregion` clearing only when taxonomy proves it;
- dry-run produces no database changes;
- approved apply updates only geography and audit columns;
- generated outputs have unique SKUs and required reason fields;
- local, production, live-export, and Magento comparison logic reports
  mismatches accurately.

## Success Criteria

The work is complete only when:

1. All active beverages are classified as valid, exact auto-correctable, or
   human review.
2. No ambiguous correction is applied automatically.
3. The three requested outputs are generated.
4. Approved corrections are present in local SQLite.
5. The same corrections are verified in production Supabase.
6. The UI-facing export contains the corrected values.
7. The Magento export contains separate, matching `country`, `region`, and
   `subregion` values with no combined geography field.
8. The before/after report shows zero mismatches across applied SKUs.
