# Beverage Geography Validation and Enrichment Design

**Date:** 2026-06-11

## Goal

Produce the best validated `country`, `region`, and `subregion` data possible
for active beverage products before Magento import, using conservative,
taxonomy-backed automation. After review, apply approved corrections to the
local SQLite database, production Supabase, the UI-facing live export, and the
Magento export.

The governing process is:

```text
taxonomy integrity gate
-> deterministic product audit
-> evidence-assisted human review
-> approved local application
-> SKU-scoped production parity
```

## Scope

### Included

- Active beverage products in `data/db/products.db`.
- Independent validation of `country`, `region`, and `subregion`.
- Validation of the taxonomy itself before it is trusted for product changes.
- Exact, unambiguous corrections supported by the local taxonomy.
- Human review for missing, conflicting, coarse, or ambiguous geography.
- Cited evidence gathering for review rows without allowing AI to write data.
- Verified publication to local and production data surfaces after approval.

### Excluded

- Accessories, glassware, cigars, events, mineral water, and other
  non-beverage catalog items.
- AI-generated or inferred geography without exact taxonomy evidence.
- Uncited model conclusions or model confidence scores treated as facts.
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

Before auditing products, the taxonomy must pass an integrity gate:

- no orphan region or subregion parent IDs;
- no duplicate normalized name under the same parent;
- no unresolved entity that appears at both region and subregion level for
  the same country;
- no conflicting canonical hierarchy for the same geographic entity;
- every approved alias maps to exactly one canonical entity under a known
  parent;
- taxonomy files have a recorded SHA-256 hash for the audit batch.

Known cross-level conflicts such as `Barossa Valley`, `Mâconnais`,
`Beaujolais`, and `Willamette Valley` must be resolved or explicitly
quarantined before affected products can be auto-corrected. A taxonomy that
passes foreign-key checks but contains competing semantic levels is not
considered valid.

Product text, descriptions, brands, and external research may explain why an
item needs review, but they cannot authorize an automatic correction in this
conservative pass.

## Geography Semantics

Each reviewed product must carry an internal `geography_basis` value so that
identical text does not imply identical meaning across categories:

- `protected_origin`: an appellation, GI, or legally defined origin;
- `production_location`: where the beverage is distilled, brewed, or made;
- `producer_location`: producer or brand base when product origin is not
  defined;
- `multi_region_blend`: product intentionally spans multiple origins;
- `unknown`: evidence is insufficient.

This field is audit metadata and is not part of the Magento export. It is used
to prevent false equivalence, such as treating a gin produced in Cognac and a
Cognac AOC brandy as the same type of geography claim.

Category-aware policy:

- wine and protected-origin spirits prefer `protected_origin`;
- beer, gin, vodka, liqueur, and similar products may use
  `production_location` when no protected origin applies;
- blended whisky, rum, mixed packs, and multi-origin products may legitimately
  stop at country or region and use `multi_region_blend`;
- `producer_location` must never be silently presented as protected origin.

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
known or when category semantics make a deeper level inapplicable. It is
reported as `valid_region_only` or `legitimately_blank`, not automatically
incorrect.

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
- A redundant `subregion == region` value can be cleared when the taxonomy
  confirms that the value exists only as a region under that country.

Every automatic correction must record old values, new values, matched
taxonomy IDs, reason code, confidence `exact`, taxonomy hash, and the
geography basis.

Hierarchy restructuring is a separate `exact_restructure` lane. It includes
moving a value between region and subregion only when:

- the canonical taxonomy has one valid path for the country;
- the current source values still match the audit snapshot;
- the affected taxonomy entity is not quarantined by the integrity gate;
- the correction is reviewed before application.

Exact restructuring is never silently grouped with mechanical normalization.

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
- geography meaning that cannot be classified as protected origin,
  production location, producer location, or multi-region blend;
- any correction that changes more than mechanical normalization or a proven
  approved exact restructure.

## Evidence-Assisted Review

The human review queue may be enriched with research evidence. Evidence is
advisory and cannot directly update products or taxonomy.

Preferred source order:

1. official producer or brand product page;
2. official appellation, GI, regional authority, or government source;
3. official technical sheet or importer document;
4. reputable specialist reference as a secondary source.

For high-value or recently sold products, a proposed hierarchy change requires
either one authoritative official source or two independent reputable sources.
Every candidate must retain source URLs, retrieval date, quoted fact summary,
and which geography basis the evidence supports.

AI support is permitted only for the review lane:

- Model A extracts candidate country, region, subregion, geography basis, and
  cited evidence.
- Model B challenges the candidate, checks parent relationships, and identifies
  contradictions.
- Disagreement, missing citations, or conflicting evidence routes the row to
  human review.
- Neither model receives database write credentials or produces an approved
  correction automatically.
- Model confidence is not used as a database-write threshold.

External WineSensed evidence remains `research_only` according to its existing
usage policy and cannot independently authorize a canonical change.

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
- geography basis;
- taxonomy batch hash;
- source row fingerprint;
- business priority;
- application status.

Before application, this file contains proposed mechanical exact corrections
and separately labeled exact restructures awaiting approval. After review, its
`application_status` records which rows are approved and later applied. It must
not contain ambiguous or evidence-only rows.

### 2. Human Review Queue

`outputs/beverage-geography-YYYY-MM-DD/human_review_queue.csv`

One row per product requiring judgment, containing:

- SKU, name, classification, and current geography;
- issue and reason codes;
- candidate taxonomy paths, when available;
- explanation of why automatic correction was refused;
- current and proposed geography basis;
- evidence source URLs and contradiction notes;
- recent-sales, stock, and revenue priority fields;
- blank reviewer decision and approved replacement fields.

Rows are sorted by recent sales, then stock, then remaining backlog.

### 3. Before/After Quality Report

`outputs/beverage-geography-YYYY-MM-DD/before_after_quality_report.md`

The report contains:

- included beverage count;
- exact-valid count;
- exact mechanical correction count;
- exact restructure count;
- human-review count;
- legitimately blank count;
- taxonomy integrity failures and quarantined entities;
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

The workflow has five stages. Stages 1 through 3 are read-only.

### Stage 1: Taxonomy Integrity Gate

1. Read taxonomy files without writing.
2. Calculate taxonomy hashes.
3. Detect orphan parents, same-parent duplicates, cross-level conflicts, and
   ambiguous aliases.
4. Produce a quarantine list for unresolved entities.
5. Stop automatic product correction for any quarantined path.

### Stage 2: Deterministic Product Audit

1. Read SQLite and the validated taxonomy without writing.
2. Classify every active beverage as:
   - `valid_exact`;
   - `valid_region_only`;
   - `legitimately_blank`;
   - `exact_mechanical_correction`;
   - `exact_restructure_review`;
   - `evidence_review`;
   - `taxonomy_blocked`.
3. Generate the three requested outputs.
4. Verify that all exact corrections are unambiguous and reproducible.

### Stage 3: Evidence-Assisted Human Review

1. Prioritize rows by recent sales, stock, and revenue.
2. Gather cited evidence for missing, conflicting, or semantic cases.
3. Run second-model challenge only where it adds value.
4. Record reviewer approval, rejection, or defer decision.
5. Freeze the approved batch with taxonomy hash and source fingerprints.

No local or production data changes occur in Stages 1 through 3.

### Stage 4: Approved Local Application

1. Back up `data/db/products.db`.
2. Verify the taxonomy hash and source fingerprints have not changed.
3. Apply only approved rows in `automatically_corrected_records.csv`.
4. Update `country`, `region`, `subregion`, `updated_at`,
   `enrichment_source`, and `enrichment_note`.
5. Record one product changelog row per changed field.
6. Re-run the audit and confirm that applied rows now validate exactly.

### Stage 5: SKU-Scoped Production Parity

1. Publish only approved SKUs and only `country`, `region`, `subregion`, and
   required audit timestamps to Supabase.
2. Verify Supabase values before advancing any publish checkpoint.
3. Refresh `data/live_products_export.json`.
4. Regenerate the Magento content/geography export with independent
   `country`, `region`, and `subregion` columns.
5. Compare every approved SKU across all destinations.

If any publication or verification step fails, the workflow stops and reports
the incomplete destination. It must not claim completion based only on local
SQLite changes.

## Production Publication

The generic `scripts/sync_to_supabase.py` product sync is not the publication
mechanism for this workflow. Its current delta selection requires
`enrichment_confidence IS NOT NULL`, which can omit geography-corrected
products, and it can include unrelated product changes.

Implementation must provide a dedicated SKU-scoped geography publisher that:

- reads only the frozen approved batch;
- patches by stable product ID or unique SKU;
- sends only `country`, `region`, `subregion`, and `updated_at`;
- verifies the returned production values per SKU;
- records successes and failures without advancing past failed rows;
- supports dry-run and safe retry;
- does not modify general sync state.

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

The taxonomy hash used for application must also match the hash recorded in
the audited batch.

## Safety and Recovery

- Stages 1 through 3 are read-only.
- Stage 4 begins with a timestamped SQLite backup.
- Only approved SKUs and geography columns may be updated.
- The apply script supports dry-run and rejects duplicate SKUs.
- Each approved row includes a fingerprint of original geography values;
  changed source rows are rejected instead of overwritten.
- Unknown taxonomy IDs or changed source values abort that row rather than
  overwriting newer data.
- Quarantined taxonomy paths can never enter the automatic correction batch.
- Production sync failures are retained as explicit failures in the report.
- The production publisher is SKU-scoped and does not advance general sync
  state.
- Existing unrelated worktree changes are not modified or committed.

## Testing

Tests must cover:

- beverage inclusion and non-beverage exclusion;
- exact valid taxonomy paths;
- taxonomy orphan, duplicate, cross-level conflict, alias ambiguity, and hash
  checks;
- exact canonical normalization;
- ambiguous matches routed to review;
- geography basis classification;
- legitimate region-only and blank outcomes;
- country-region mismatch;
- region-subregion mismatch;
- exact restructure only when canonical and approved;
- redundant `region == subregion` clearing only when taxonomy proves it;
- quarantined taxonomy paths never auto-correct;
- stale source fingerprints and taxonomy hashes abort application;
- dry-run produces no database changes;
- approved apply updates only geography and audit columns;
- SKU-scoped publisher sends no unrelated product fields;
- partial production failure is retryable and cannot be reported as complete;
- generated outputs have unique SKUs and required reason fields;
- local, production, live-export, and Magento comparison logic reports
  mismatches accurately.

## Success Criteria

The work is complete only when:

1. All active beverages are classified as valid, exact auto-correctable, or
   human review, with explicit legitimate-blank and taxonomy-blocked states.
2. No ambiguous correction is applied automatically.
3. The taxonomy integrity gate passes or affected paths are quarantined.
4. The three requested outputs are generated.
5. Approved corrections are present in local SQLite.
6. The same corrections are verified in production Supabase using the
   SKU-scoped publisher.
7. The UI-facing export contains the corrected values.
8. The Magento export contains separate, matching `country`, `region`, and
   `subregion` values with no combined geography field.
9. The before/after report shows zero mismatches across applied SKUs.
