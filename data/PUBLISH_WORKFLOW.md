# Publish Workflow

This is the stable path for pushing finished enrichment into the live Product Engine.

## Source File

Use:

- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/product_engine_upload_live_records_only.csv`

This file contains only rows that already have live Product Engine IDs matched.

## Publish Script

Run:

```bash
python3 "/Users/admin/Documents/CODEX Projects/research_jobs/push_live_records_to_product_engine.py"
```

Optional:

```bash
python3 "/Users/admin/Documents/CODEX Projects/research_jobs/push_live_records_to_product_engine.py" --dry-run
python3 "/Users/admin/Documents/CODEX Projects/research_jobs/push_live_records_to_product_engine.py" --batch-size 25
```

## Current Known Constraint

The live Product Engine bulk patch path currently fails on these two fields:

- `research_validation`
- `research_confidence_level`

These fields should remain in CSV outputs for internal tracking, but they are intentionally excluded from the live publish script until the backend accepts them.

## Recommended Rhythm

1. Complete a research batch.
2. Rebuild the upload outputs.
3. Publish live-ready rows with the push script.
4. Review updates in Product Engine.
5. Continue the next batch.
