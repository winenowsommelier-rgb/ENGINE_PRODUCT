# Geography Reconciliation Summary

## Live Baseline

- Country gaps: `215`
- Region gaps: `2230`
- Subregion gaps: `9391`

## Country Lane

- Old candidate rows: `81`
- Current live overlap: `7`
- Status: `stale_except_current_overlap`

Interpretation:
- The previous country pack is mostly obsolete after the main-process update.
- Only the current live-overlap row should still be treated as actionable.

## Region Lane

- Old candidate rows: `36`
- Current live overlap: `9`
- Publish-safe `yes`: `0`
- Publish-safe `no`: `9`
- Status: `still_usable`

Interpretation:
- The region pack still aligns with the updated live region gap set and remains useful.

## Subregion Lane

- Old triage rows: `2500`
- Old `clear_fill_merge_now`: `292`
- Current live overlap from that old clear-fill set: `257`
- Status: `stale_clear_fill_set`

Interpretation:
- The prior clear-fill assumption was based on pre-normalization compound region values.
- Subregion merge-now candidates should be rebuilt from the new live baseline.
