# Enrichment Failure Remediation — Design Spec

**Date:** 2026-05-21
**Author:** diagnostic findings from Task 8 of [2026-05-21 local-first SQLite plan](../plans/2026-05-21-local-first-sqlite-enrichment.md)
**Status:** Proposed — awaiting approval before implementation
**Prerequisites:** Local-first SQLite migration MUST be merged first (this spec depends on the `enrichment_failures` capture introduced there).

## Problem

The Tier-1 validation batch on 2026-05-21 produced a **40-52% validation-failure rate**, with **0 product writes** to Supabase. After the local-first SQLite migration captured the failures locally, 4 out of 4 failures had the identical root cause.

## Diagnostic findings

Sampled rows from `enrichment_failures` (post-migration smoke run, 10 SKUs Tier-1):

| sku | failure_type | issue (first line) |
|---|---|---|
| WRW1086AC | validation_retry | `food_matching dropped (not in taxonomy): 'Grilled red meat (e.g. steak, ribeye, T-bone, beef short ribs; pairs with Full red / Medium-Full red)'` |
| WRW1087AC | validation_retry | Same pattern — different food labels, all annotated with parens |
| WRW2064AC | validation_retry | Same pattern |
| WRW5736FP | validation_retry | Same pattern |

**100% of failures have the same shape:** Haiku returns `food_matching` labels with the parenthetical description appended. Every label gets dropped → count=0 → validator rejects (count not in [3, 6]).

## Root cause

In [data/lib/enrichment/shared/taxonomies/food_pairing.py:36](../../../data/lib/enrichment/shared/taxonomies/food_pairing.py#L36), the taxonomy is rendered as:

```python
lines.append(f"  - {c.label} (e.g. {c.examples}; pairs with {hint})")
```

So the prompt shows:
```
Red Meat:
  - Grilled red meat (e.g. steak, ribeye, T-bone, beef short ribs; pairs with Full red / Medium-Full red)
  - Lamb dishes (e.g. rack of lamb, lamb shank, kofta; pairs with Full red / Medium-Full red)
  ...
```

The prompt instruction at [data/lib/enrichment/wine/prompt.py:34](../../../data/lib/enrichment/wine/prompt.py#L34) says:

> `food_matching: pick 3-6 EXACT labels from FOOD PAIRING TAXONOMY below`

To Haiku, "EXACT label" is ambiguous. The annotated line LOOKS like the label. The validator at [data/lib/enrichment/wine/validator.py:111-122](../../../data/lib/enrichment/wine/validator.py#L111-L122) does case-insensitive exact match against `FoodCategory.label` only — it has no fuzzy/prefix matching.

The retry-with-issue-list at [data/enrich_wines.py:284](../../../data/enrich_wines.py#L284) tells Haiku the labels were "not in taxonomy" but doesn't re-emphasize what the bare labels are — so Haiku regenerates with the same pattern.

## Why this wasn't caught before

- The original 2026-05-21 morning batch (50 SKUs) had the same failure mode but the failures were never written anywhere — `enrichment_cache` only stores successes, and the validator's issue list went to stdout but wasn't persisted.
- The 4 SKUs across the morning batch and the post-migration smoke run all have the same parenthetical-label pattern. This is not flaky; it's a deterministic prompt-rendering bug.

## Proposed fix — two-layer defense

### Layer 1 (primary): change the renderer to make labels unambiguous

Edit [data/lib/enrichment/shared/taxonomies/food_pairing.py:36](../../../data/lib/enrichment/shared/taxonomies/food_pairing.py#L36):

**Before:**
```python
lines.append(f"  - {c.label} (e.g. {c.examples}; pairs with {hint})")
```

**After:**
```python
lines.append(f'  - "{c.label}"  [examples: {c.examples}; pairs with {hint}]')
```

Key changes:
- Wrap the label in **double quotes** so Haiku visually distinguishes the label string from the gloss.
- Replace `(e.g. ...; pairs with ...)` with `[examples: ...; pairs with ...]` so the gloss is clearly a sidebar, not part of the label.

Combined with a strengthened prompt instruction (see below), this makes the bare label visually distinct.

### Layer 1b: strengthen the prompt instruction

In [data/lib/enrichment/wine/prompt.py:34](../../../data/lib/enrichment/wine/prompt.py#L34):

**Before:**
```
- food_matching: pick 3-6 EXACT labels from FOOD PAIRING TAXONOMY below
```

**After:**
```
- food_matching: pick 3-6 labels. Use ONLY the QUOTED label string (e.g. "Grilled red meat"), NEVER the bracketed examples/pairing gloss.
```

### Layer 2 (defensive): validator strips parenthetical/bracketed suffix before matching

Even with Layer 1, future taxonomy renderers might leak. Make the validator robust. Edit [data/lib/enrichment/wine/validator.py:111-122](../../../data/lib/enrichment/wine/validator.py#L111-L122):

Add a normalization helper:
```python
import re
_PAREN_OR_BRACKET_SUFFIX = re.compile(r"\s*[\(\[].*?[\)\]]\s*$")

def _strip_label_gloss(s: str) -> str:
    """Remove a trailing (...) or [...] gloss from a label string."""
    return _PAREN_OR_BRACKET_SUFFIX.sub("", s).strip()
```

In the food_matching loop, try the stripped version as a fallback match:
```python
for f in food_in:
    if f in food_labels:
        food_valid.append(f)
        continue
    stripped = _strip_label_gloss(f)
    if stripped in food_labels:
        food_valid.append(stripped)
        issues.append(f"food_matching repaired (stripped gloss): {f!r} -> {stripped!r}")
        repaired_count += 1
        continue
    ci_match = next((l for l in food_labels if l.lower() == stripped.lower()), None)
    if ci_match:
        food_valid.append(ci_match)
        issues.append(f"food_matching repaired (case+gloss): {f!r} -> {ci_match!r}")
        repaired_count += 1
        continue
    issues.append(f"food_matching dropped (not in taxonomy): {f!r}")
    repaired_count += 1
```

This is the belt-and-suspenders layer — even if Haiku ignores the prompt and emits glossed labels, the validator repairs them.

## Implementation plan (separate from this spec)

A new plan file will be written: `docs/superpowers/plans/2026-05-21-enrichment-failure-fix.md`. Estimated 3 tasks:

1. **Update renderer + prompt** — `food_pairing.py:36` + `prompt.py:34`. Add a unit test in `tests/test_wine_enrichment_taxonomies.py` asserting the rendered block contains quoted labels and bracketed glosses.
2. **Strengthen validator** — add `_strip_label_gloss` + fallback match path. Add 3 unit tests in `tests/test_wine_enrichment_validator.py`:
   - exact match still works
   - parenthetical gloss stripped & matched
   - bracketed gloss stripped & matched
3. **Re-run 10-SKU smoke test** — expected: 0 failures on the same SKUs that failed before. Compare costs (expect API calls to drop from 14 → 10 since no retries needed). Document in `data/exports/`.

## Expected impact

- **Failure rate**: 40-52% → < 5% (validation will pass on first try for ~all SKUs)
- **API cost per SKU**: THB 0.325 → THB 0.15-0.17 (no retry overhead)
- **Full Tier 1 (1,708 SKUs) cost**: THB 615 → ~THB 260 (~$7.50)
- **Full Tier 1+2 (5,090 SKUs)**: THB 1,830 → ~THB 800 (~$23)
- **Direct write rate**: 0% → estimated 30-60% (most SKUs will reach 0.85 threshold once validation passes; the rest go to CSV for human review as designed)

## Risk + rollback

- Renderer/prompt changes are pure-string output; well-tested by the existing 8 prompt tests + 10 validator tests.
- Validator change is additive (new fallback path); won't reject anything currently accepted.
- Rollback: revert the 1 commit. The local-first SQLite migration is unaffected.

## Out of scope

- Tightening the food taxonomy itself (different problem, no signal it's needed)
- Changing the AI model from Haiku 4.5 (cost is fine once retries drop)
- Lowering the 0.85 write threshold (let's see what real direct-write rates look like after the fix; may not need to lower)
