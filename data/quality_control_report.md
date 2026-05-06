# Quality Control Report

QC is now a required workflow gate before publish-ready batches are treated as final.

## Summary

- `product_master`: `{'short_length': 77, 'full_length': 63, 'template_language': 3, 'missing_sources': 4, 'verified_without_note': 14, 'completed_rows': 119}`
- `country_taxonomy`: `{'expert_reviewed_countries': 51}`
- `live_upload`: `{'weak_publish_rationale': 12, 'live_upload_rows': 48}`

## Issue Counts By Type

- `length_violation_full`: 63
- `length_violation_short`: 77
- `missing_sources`: 4
- `missing_validation_rationale`: 14
- `template_language_leak`: 3
- `weak_publish_rationale`: 12

## Next Actions

- Fix `high` severity items before publishing the next batch.
- Fix recurring template-language or length issues during batch merge, not at the end of the project.
- Re-run this script after each meaningful merge wave.
