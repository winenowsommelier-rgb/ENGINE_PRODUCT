# Lane 3 Cleanup Notes

Scope: producer and brand cleanup only, based on `producer_evidence_library.csv` plus the brand/producer taxonomy outputs in `research_jobs/progress_outputs/`.

What this proposal targets:
- Truncated producer names with wrappers such as `By`
- Producer names polluted by cuvée, gift pack, collection, or trademark text
- Brand entities that are really product lines or vineyard-level strings
- Apparent appellation-as-brand cases that should be normalized before downstream use

Confidence guide:
- `0.95-0.99`: very strong cleanup candidate with obvious normalization
- `0.85-0.94`: strong candidate, usually a wrapper or product-suffix cleanup
- `<0.85`: useful cleanup candidate, but should be checked against catalog context before automated overwrite

Notes on lower-confidence items:
- `Pomerol By` may be a misparsed label or a private-label construct, so it is intentionally left at lower confidence.
- `Diageo Special Release Collection` should almost certainly be normalized further, but the exact house-range naming may vary by catalog policy.

No other files were changed.
