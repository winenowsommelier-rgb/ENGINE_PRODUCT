# Research Library

The Research Library stores external wine datasets separately from production product records.

## WineSensed

Source:

- Paper: `https://arxiv.org/abs/2308.16900`
- Dataset: `https://huggingface.co/datasets/Dakhoo/L2T-NeurIPS-2023`

License boundary:

- Dataset license: `CC BY-NC-ND 4.0`
- App usage: `research_only`
- Do not publish source reviews, source images, or direct derived copy to customer-facing product pages.

## Import Flow

Download a static JSONL file into `data/research/`:

```bash
mkdir -p data/research
curl -L "https://huggingface.co/datasets/Dakhoo/L2T-NeurIPS-2023/resolve/main/metadata/wt_session/wt_session.jsonl" \
  -o data/research/winesensed_wt_session.jsonl
```

Import a bounded sample into the local research database:

```bash
npm run import:winesensed -- --limit 5000
npm run research:geo-evidence
```

Outputs:

- `data/db/external-winesensed-records.json`
- `data/db/external-winesensed-summary.json`
- `data/db/external-winesensed-geography-evidence.json`

## App Surface

Open **Catalog → Research Library**.

The page shows:

- research-only license warning
- authority validation queue for products with missing geography
- imported row counts
- region/subregion/appellation evidence review queue
- coverage for reviews, country, region, grape, and rating
- top countries, grapes, and regions
- searchable review/taxonomy sample table

## Integration Rule

WineSensed data may inform taxonomy patterns, flavor benchmarks, and QA checks. It must not overwrite PIM-owned product fields directly.

For geography work, the evidence builder:

- matches observed WineSensed geography strings against canonical `region`, `subregion`, and `appellation` entities
- applies conservative aliases such as `Toscana → Tuscany` and `Piemonte → Piedmont`
- flags unmatched rows as `needs_classification`
- suggests whether an unmatched value looks like a region, subregion, or appellation

## Geography Curation States

Use these states before changing canonical taxonomy or product records:

- `new` — evidence exists but no reviewer decision yet
- `needs_research` — needs confirmation from stronger sources
- `confirmed_region` — can become or map to a region after source review
- `confirmed_subregion` — can become or map to a subregion after source review
- `confirmed_appellation` — can become or map to an appellation/origin after source review
- `rejected_generic` — keep out of canonical geography, usually broad labels such as national wine designations
- `promoted` — already added to canonical taxonomy or mapped to an existing canonical entry

Safe sequence:

```text
External evidence
→ Research Library curation state
→ confirmed canonical taxonomy entry
→ product/item matching
→ batch update
→ QC
→ publish
```

Do not update product `country`, `region`, `subregion`, or `appellation` directly from WineSensed evidence.

## Authority Validation Queue

The authority queue is the safe working area for missing product geography. It scans wine-like products with missing `region`, `subregion`, or `appellation`, then attaches nearby WineSensed signals as research hints.

API:

```bash
curl "http://localhost:3000/api/research-library/authority-validation?status=new&limit=80"
```

Use `missing_field=region`, `missing_field=subregion`, or `missing_field=appellation` to keep review batches focused. The app defaults to region gaps first because region is the parent foundation for the later hierarchy.

Use `sales_tier=S1`, `sales_tier=S2`, or `sales_tier=S3` to process the queue by sales priority. If an explicit sales tier is not present on a product, the app derives it from GA priority and local `sold_qty` / `sold_orders` signals:

- `S1` — high GA priority or strongest sales movement
- `S2` — medium GA priority or any observed sales movement
- `S3` — remaining long-tail products

To export the current sales-tier breakdown:

```bash
npm run research:authority-tier-report -- --field=region --status=new
```

Outputs:

- `data/reports/authority-region-new-by-sales-tier.json`
- `data/reports/authority-region-new-by-sales-tier.csv`

SKU suffix tier reporting is still available for operational slicing:

```bash
npm run research:authority-tier-report -- --field=region --status=new --tier=sku
```

Decision states:

- `new` — candidate has not been reviewed
- `needs_authority_source` — WineSensed is not enough; find a producer, regulatory, appellation, or trusted trade source
- `source_found` — source exists but the canonical value has not been approved
- `approved_for_taxonomy` — value can be added or mapped in canonical taxonomy
- `approved_for_product_update` — value can be used for a product update after taxonomy exists
- `rejected` — do not use this value
- `published` — update has moved through the later product/publish process

Validation rule:

```text
Missing product geography
→ WineSensed signal as hint
→ authority source URL and reviewer note
→ approved taxonomy value
→ taxonomy promotion
→ product canonicalization preview
→ bulk patch / QC / publish readiness
```

The queue intentionally stores decisions in `data/db/authority-validation-decisions.json` and does not write product fields. This keeps uncertain research separate from customer-facing data until it is validated.

## Authority Product Update Preview

After a reviewer marks a row as `approved_for_product_update`, use the product update preview:

```bash
curl "http://localhost:3000/api/research-library/authority-product-candidates"
```

This endpoint is read-only. A row is only marked ready when:

- the decision has `validated_field` and `validated_value`
- at least one authority URL is attached
- confidence is `medium` or `high`
- the product field is still blank, or already matches the same normalized value
- the validated value already exists in canonical taxonomy

Blocked rows stay visible with blocker reasons. Ready rows include a `bulk_patch_payload`, but they still require final review and must be sent through `/api/products/bulk-patch` with `X-Source: enrichment`.

## Product Candidate Gate

After curation rows are confirmed or promoted, use the product canonicalization preview before any item update:

```bash
curl http://localhost:3000/api/research-library/geography-candidates
```

This endpoint is read-only. It only proposes a product update when:

- the evidence row is `confirmed_*` or `promoted`
- the target field is known from the curation status
- the product country matches the observed country
- the product already contains the observed value or canonical value
- the proposed change is a canonicalization, not a blank-field fill

Approved rows should then go through `/api/products/bulk-patch` with `X-Source: enrichment`, followed by validation and publish readiness checks.
