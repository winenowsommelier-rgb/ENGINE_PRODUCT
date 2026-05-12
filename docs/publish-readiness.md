# Publish Readiness Workflow

Use the **Publish Readiness** page as the daily operating view before any live Product Engine publish.

## What It Combines

- Program progress from `data/process_dashboard_snapshot.json`
- QC issue totals from `data/quality_control_summary.json`
- Fast-lane SKU priority from `data/next_fast_lane_queue.csv`
- GA product demand from `data/ga_priority_products.csv`
- Geography publish preview from `data/product_engine_geography_publish_batch.csv`
- Local product readiness from `data/db/products.json`

## Daily Rhythm

1. Open **Operations → Publish Readiness**.
2. Clear the top QC blockers shown in **Quality Gate**.
3. Work the first ready or near-ready rows in **Fast-Lane Queue**.
4. Publish rows listed in **Current Geography Publish Preview** after QC is acceptable.
5. Verify the Product Engine update and keep the publish log current.

## Readiness Rule

A product is treated as ready when it is:

- `validation_status = validated`
- has a full description
- has country and region
- has `overall_confidence >= 0.8`

Rows that fail one of those checks stay visible with the first blocker reason.
