# Enrichment Failure Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 40-52% wine enrichment validation-failure rate caused by Haiku copying the full annotated food-taxonomy line (label + parenthetical gloss) into `food_matching` outputs.

**Architecture:** Two-layer defense — (1) change how the food taxonomy is rendered in the system prompt so labels are visually unambiguous, and (2) make the validator defensively strip parenthetical/bracketed glosses before matching. Plus an end-to-end smoke test that verifies the fix on the same SKUs that failed before.

**Tech Stack:** Pure Python 3.11 stdlib (re module for the validator strip) — zero new dependencies. Existing pytest 8.4.2 + AnthropicClient + SQLite layers from the 2026-05-21 local-first migration.

**Spec:** [docs/superpowers/specs/2026-05-21-enrichment-failure-remediation.md](../specs/2026-05-21-enrichment-failure-remediation.md)

**Prior work (foundation):** [docs/superpowers/plans/2026-05-21-local-first-sqlite-enrichment.md](2026-05-21-local-first-sqlite-enrichment.md) (already merged to main; commit `a49718c`)

---

## File Structure

### Files to modify

| Path | Change |
|---|---|
| `data/lib/enrichment/shared/taxonomies/food_pairing.py:36` | Change render format: wrap label in double quotes; replace `(e.g. ...)` with `[examples: ...]` so the gloss is clearly a sidebar. |
| `data/lib/enrichment/wine/prompt.py:34` | Strengthen the `food_matching` instruction to say "Use ONLY the QUOTED label string … NEVER the bracketed examples/pairing gloss." |
| `data/lib/enrichment/wine/validator.py:106-126` | Add a `_strip_label_gloss` helper + fallback match path so glossed labels are repaired-not-dropped. |
| `tests/test_wine_enrichment_taxonomies.py` | Append 1 test asserting the rendered prompt block uses quoted labels + bracketed glosses. |
| `tests/test_wine_enrichment_validator.py` | Append 3 tests covering exact-match-still-works, paren-stripped match, bracket-stripped match. |

### Files NOT touched

- `data/enrich_wines.py`, `data/lib/enrichment/wine/local_router.py`, `data/lib/enrichment/shared/local_store.py`, `scripts/sync_to_supabase.py` — the local-first storage layer is unchanged.
- The food taxonomy JSON (`data/db/food-pairing-taxonomy.json`) — labels themselves are correct; only the renderer is wrong.
- The 4 captured failure rows in `data/db/products.db:enrichment_failures` — they stay as historical evidence and as test fixtures for the smoke run.

### Files generated at runtime (not part of implementation)

- New rows in `data/exports/wine-enrichment-{timestamp}.csv` and `data/db/products.db` from the smoke test in Task 4.

---

## Execution order

```
Task 1: Validator defensive layer (NO API calls — pure logic test)
    ↓
Task 2: Renderer + prompt-instruction change (NO API calls — pure string test)
    ↓
Task 3: 10-SKU smoke test on the SAME SKUs that failed before
                 (~$0.05; verifies real-world impact)
```

Task 1 is intentionally first because the validator change is the highest-leverage safety net — even if the prompt change underperforms, the validator will repair the output.

---

## Task 1: Validator defensive gloss-strip layer

**Files:**
- Modify: `data/lib/enrichment/wine/validator.py:106-126`
- Test: `tests/test_wine_enrichment_validator.py` (append 3 tests)

- [ ] **Step 1.1: Read current validator behavior**

Open `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/lib/enrichment/wine/validator.py` lines 106-126 to understand the existing `food_matching` validation block — what matches exactly, what triggers the "dropped (not in taxonomy)" issue.

- [ ] **Step 1.2: Write the failing tests**

Append to `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/tests/test_wine_enrichment_validator.py`:

```python
def test_food_matching_strips_parenthetical_gloss():
    """If Haiku returns 'Grilled red meat (e.g. steak, ribeye; pairs with Full red)',
    the validator should strip the gloss and match the bare label."""
    from data.lib.enrichment.wine.validator import validate
    from data.lib.enrichment.shared.taxonomies.food_pairing import load_default
    from data.lib.enrichment.wine.evidence import Evidence

    food_tax = load_default()
    response = {
        "wine_body": "Full", "wine_acidity": "Medium", "wine_tannin": "Medium",
        "grape_variety": ["Cabernet Sauvignon"], "grape_blend_type": "Single Varietal",
        "wine_production_style": [],
        "flavor_tags": ["dark fruit", "cedar", "tobacco", "spice", "vanilla"],
        "food_matching": [
            "Grilled red meat (e.g. steak, ribeye; pairs with Full red)",
            "Lamb dishes (e.g. rack of lamb; pairs with Full red)",
            "Aged hard cheese (e.g. parmesan, manchego; pairs with Full red)",
        ],
        "desc_en_short": "Bold Cab", "full_description": "<p>" + "X" * 300 + "</p>",
        "confidence": 0.9,
        "citations": {"winesensed_record_ids": [], "brand_library_match": None,
                      "grape_source": "products.grape_variety", "critic_scores": []},
    }
    evidence = Evidence(
        sku="WTEST", facts={}, winesensed_matches=[], brand_description=None,
        heuristic_profile="", critic_scores=[], evidence_hash="eh", quality_tier="A",
    )
    result = validate(response, evidence, food_tax)
    assert result.outcome != "rejected", f"validator rejected glossed labels: {result.issues}"
    assert result.repaired_json["food_matching"] == [
        "Grilled red meat", "Lamb dishes", "Aged hard cheese",
    ]


def test_food_matching_strips_bracketed_gloss():
    """If the new renderer's bracketed gloss leaks through, validator strips it too."""
    from data.lib.enrichment.wine.validator import validate
    from data.lib.enrichment.shared.taxonomies.food_pairing import load_default
    from data.lib.enrichment.wine.evidence import Evidence

    food_tax = load_default()
    response = {
        "wine_body": "Full", "wine_acidity": "Medium", "wine_tannin": "Medium",
        "grape_variety": ["Cabernet Sauvignon"], "grape_blend_type": "Single Varietal",
        "wine_production_style": [],
        "flavor_tags": ["dark fruit", "cedar", "tobacco", "spice", "vanilla"],
        "food_matching": [
            "Grilled red meat [examples: steak, ribeye; pairs with Full red]",
            "Lamb dishes [examples: rack of lamb]",
            "Aged hard cheese [examples: parmesan]",
        ],
        "desc_en_short": "Bold Cab", "full_description": "<p>" + "X" * 300 + "</p>",
        "confidence": 0.9,
        "citations": {"winesensed_record_ids": [], "brand_library_match": None,
                      "grape_source": "products.grape_variety", "critic_scores": []},
    }
    evidence = Evidence(
        sku="WTEST", facts={}, winesensed_matches=[], brand_description=None,
        heuristic_profile="", critic_scores=[], evidence_hash="eh", quality_tier="A",
    )
    result = validate(response, evidence, food_tax)
    assert result.outcome != "rejected", f"validator rejected glossed labels: {result.issues}"
    assert result.repaired_json["food_matching"] == [
        "Grilled red meat", "Lamb dishes", "Aged hard cheese",
    ]


def test_food_matching_exact_match_still_works():
    """Bare labels (no gloss) still match exactly — no regression."""
    from data.lib.enrichment.wine.validator import validate
    from data.lib.enrichment.shared.taxonomies.food_pairing import load_default
    from data.lib.enrichment.wine.evidence import Evidence

    food_tax = load_default()
    response = {
        "wine_body": "Full", "wine_acidity": "Medium", "wine_tannin": "Medium",
        "grape_variety": ["Cabernet Sauvignon"], "grape_blend_type": "Single Varietal",
        "wine_production_style": [],
        "flavor_tags": ["dark fruit", "cedar", "tobacco", "spice", "vanilla"],
        "food_matching": ["Grilled red meat", "Lamb dishes", "Aged hard cheese"],
        "desc_en_short": "Bold Cab", "full_description": "<p>" + "X" * 300 + "</p>",
        "confidence": 0.9,
        "citations": {"winesensed_record_ids": [], "brand_library_match": None,
                      "grape_source": "products.grape_variety", "critic_scores": []},
    }
    evidence = Evidence(
        sku="WTEST", facts={}, winesensed_matches=[], brand_description=None,
        heuristic_profile="", critic_scores=[], evidence_hash="eh", quality_tier="A",
    )
    result = validate(response, evidence, food_tax)
    assert result.outcome == "passed"
    assert result.repaired_json["food_matching"] == [
        "Grilled red meat", "Lamb dishes", "Aged hard cheese",
    ]
```

**Note on the Evidence fixture:** The existing `tests/test_wine_enrichment_validator.py` defines a `_empty_evidence()` helper. **Use it** instead of constructing `Evidence(...)` inline — the dataclass types `winesensed_matches` and `critic_scores` as `tuple[...]` (not list), and reusing the helper stays consistent with the rest of the test file. Concretely, replace the inline `evidence = Evidence(...)` block in each test with `evidence = _empty_evidence(sku="WTEST", quality_tier="A")` (adjust the helper's signature if needed).

- [ ] **Step 1.3: Run tests to verify they fail**

```bash
.venv/bin/pytest tests/test_wine_enrichment_validator.py::test_food_matching_strips_parenthetical_gloss tests/test_wine_enrichment_validator.py::test_food_matching_strips_bracketed_gloss tests/test_wine_enrichment_validator.py::test_food_matching_exact_match_still_works -v
```
Expected: 2 FAIL (gloss-strip tests reject the input because validator drops everything), 1 PASS (exact-match works today).

- [ ] **Step 1.4: Add the gloss-strip helper + fallback match path**

Edit `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/lib/enrichment/wine/validator.py`.

Near the top of the file (around the existing `HTML_TAG_RE` regex), add:

```python
_LABEL_GLOSS_RE = re.compile(r"\s*[\(\[].*?[\)\]]\s*$")


def _strip_label_gloss(s: str) -> str:
    """Remove a trailing (...) or [...] gloss from a food-pairing label."""
    return _LABEL_GLOSS_RE.sub("", str(s)).strip()
```

Then in the `food_matching` validation block (lines 106-126), replace the current per-label loop with this richer one:

```python
food_in = repaired.get("food_matching") or []
if not isinstance(food_in, list):
    return ValidationResult("rejected", repaired, ["food_matching must be a list"], can_retry=True)
food_labels = food_tax.labels
food_valid = []
for f in food_in:
    f_str = str(f)
    # 1. exact match
    if f_str in food_labels:
        food_valid.append(f_str)
        continue
    # 2. strip gloss and match
    stripped = _strip_label_gloss(f_str)
    if stripped in food_labels:
        food_valid.append(stripped)
        issues.append(f"food_matching repaired (stripped gloss): {f!r} -> {stripped!r}")
        repaired_count += 1
        continue
    # 3. case-insensitive match on stripped value
    ci_match = next((l for l in food_labels if l.lower() == stripped.lower()), None)
    if ci_match:
        food_valid.append(ci_match)
        issues.append(f"food_matching repaired (case+gloss): {f!r} -> {ci_match!r}")
        repaired_count += 1
        continue
    issues.append(f"food_matching dropped (not in taxonomy): {f!r}")
    repaired_count += 1
if len(food_valid) < 3 or len(food_valid) > 6:
    issues.append(f"food_matching count {len(food_valid)} not in [3, 6]")
    return ValidationResult("rejected", repaired, issues, can_retry=True)
repaired["food_matching"] = food_valid
```

- [ ] **Step 1.5: Run targeted tests to verify they pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_validator.py -v
```
Expected: 13/13 pass (10 existing + 3 new).

- [ ] **Step 1.6: Run full suite to confirm no regression**

```bash
.venv/bin/pytest tests/ 2>&1 | tail -3
```
Expected: 150/150 pass (147 prior + 3 new).

- [ ] **Step 1.7: Commit**

```bash
git add data/lib/enrichment/wine/validator.py tests/test_wine_enrichment_validator.py
git commit -m "fix(enrichment): validator strips parenthetical/bracketed gloss before matching food labels

When Haiku copies the full annotated taxonomy line (e.g. 'Grilled red meat
(e.g. steak; pairs with Full red)') into food_matching, the exact-match
loop previously dropped every label and triggered count<3 rejection. Now
the validator falls through to a gloss-stripped match before giving up.

This is the defensive layer; the renderer/prompt fix in the next commit
addresses the upstream cause."
```

---

## Task 2: Renderer + prompt-instruction change

**Files:**
- Modify: `data/lib/enrichment/shared/taxonomies/food_pairing.py:36`
- Modify: `data/lib/enrichment/wine/prompt.py:34`
- Test: `tests/test_wine_enrichment_taxonomies.py` (append 1 test)

- [ ] **Step 2.1: Write the failing test**

Append to `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/tests/test_wine_enrichment_taxonomies.py`:

```python
def test_food_taxonomy_prompt_block_wraps_label_in_quotes():
    """The rendered prompt block must visually distinguish the bare label
    from the descriptive gloss so Haiku doesn't copy the whole line.
    Labels are wrapped in double quotes; glosses use [brackets] (not parens)."""
    from data.lib.enrichment.shared.taxonomies.food_pairing import load_default

    block = load_default().prompt_block()
    # Spot-check the 'Grilled red meat' entry (Red Meat group)
    assert '"Grilled red meat"' in block
    # Old (e.g. ...; pairs with ...) form should be GONE
    assert "Grilled red meat (e.g." not in block
    # New bracketed form should be present
    assert "[examples:" in block
    assert "pairs with" in block  # still mentions the wine-style hint
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
.venv/bin/pytest tests/test_wine_enrichment_taxonomies.py::test_food_taxonomy_prompt_block_wraps_label_in_quotes -v
```
Expected: FAIL — the current renderer outputs `Grilled red meat (e.g. ...)`, not `"Grilled red meat"`.

- [ ] **Step 2.3: Change the renderer**

Edit `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/lib/enrichment/shared/taxonomies/food_pairing.py` line 36.

**Before:**
```python
lines.append(f"  - {c.label} (e.g. {c.examples}; pairs with {hint})")
```

**After:**
```python
lines.append(f'  - "{c.label}"  [examples: {c.examples}; pairs with {hint}]')
```

- [ ] **Step 2.4: Run taxonomy tests**

```bash
.venv/bin/pytest tests/test_wine_enrichment_taxonomies.py -v
```
Expected: 15/15 pass (14 existing + 1 new). If any existing test asserts the OLD render format, it will fail — read the failure, update the existing test to the NEW format (the new format is what we want, not what the test was pinned to).

- [ ] **Step 2.5: Strengthen the prompt instruction**

Edit `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/lib/enrichment/wine/prompt.py` line 34.

**Before:**
```python
- food_matching: pick 3-6 EXACT labels from FOOD PAIRING TAXONOMY below
```

**After:**
```python
- food_matching: pick 3-6 labels. Use ONLY the QUOTED label string (e.g. "Grilled red meat"), NEVER the bracketed examples/pairing gloss.
```

- [ ] **Step 2.6: Verify prompt tests still pass**

The prompt hash changes because the system prompt text changed. The existing `tests/test_wine_enrichment_prompt.py` tests hash STABILITY (same evidence → same hash; different SKUs same evidence → same hash) but does NOT pin the hash to a literal value, so this is a green run.

```bash
.venv/bin/pytest tests/test_wine_enrichment_prompt.py -v
```
Expected: all existing prompt tests pass unchanged.

- [ ] **Step 2.7: Run full suite**

```bash
.venv/bin/pytest tests/ 2>&1 | tail -3
```
Expected: 151/151 pass (150 from Task 1 + 1 new taxonomy test).

- [ ] **Step 2.8: Commit**

```bash
git add data/lib/enrichment/shared/taxonomies/food_pairing.py \
        data/lib/enrichment/wine/prompt.py \
        tests/test_wine_enrichment_taxonomies.py \
        tests/test_wine_enrichment_prompt.py
git commit -m "fix(enrichment): make food-taxonomy labels visually unambiguous in prompt

Wrap labels in double quotes and move gloss to brackets so Haiku can
distinguish the bare label from the descriptive sidebar. Prompt
instruction updated to explicitly say 'use ONLY the QUOTED label'.

Combined with the validator's defensive gloss-strip (prior commit),
this addresses the upstream cause of the 40-52% validation-failure
rate observed in the 2026-05-21 Tier-1 batch."
```

---

## Task 3: 10-SKU smoke test verifying the fix

**Files:** No source changes. Operational verification only. (~$0.05 in API costs.)

- [ ] **Step 3.1: Re-seed the local DB to clear stale state**

Optional — only if `data/db/products.db` is in a confusing state from earlier runs. Otherwise skip.

```bash
sqlite3 data/db/products.db "SELECT COUNT(*) FROM enrichment_cache; SELECT COUNT(*) FROM enrichment_failures"
```
If the counts from the earlier smoke run (6 cache rows, 8 failures) are still acceptable as baseline, proceed without re-seeding.

- [ ] **Step 3.2: Run the 10-SKU Tier-1 batch — same SKUs that failed before**

```bash
.venv/bin/python data/enrich_wines.py --tier 1 --limit 10 --priority popularity 2>&1 | tee data/exports/enrich-smoke-task3-postfix.log
```

The `--priority popularity` flag picks the same top-10 SKUs the original smoke run hit (WRW1086AC, WRW1087AC, WRW2064AC, WRW5736FP, and 6 others). With the fix in place, the previously-failed 4 should now pass validation.

**However:** because the OLD cache rows for the 6 successful SKUs already exist (from the pre-fix smoke run), those 6 will hit the cache and skip the API. To verify the fix on the 4 failed SKUs, you have two choices:
- **(a)** Accept that 6 are cache hits, watch the remaining 4: expect 0 validation failures, 4 API calls (down from 8 — no retries needed).
- **(b)** Force a fresh run by superseding the existing cache rows for the 4 failed SKUs:
  ```bash
  sqlite3 data/db/products.db "UPDATE enrichment_cache SET superseded_at=CURRENT_TIMESTAMP WHERE sku IN ('WRW1086AC','WRW1087AC','WRW2064AC','WRW5736FP') AND superseded_at IS NULL"
  ```
  Then the run will re-call the API for those 4 with the new prompt.

Option (a) is sufficient to verify the fix. Use (b) only if you want a cleaner test.

- [ ] **Step 3.3: Inspect the SQLite state**

```bash
sqlite3 data/db/products.db <<'SQL'
SELECT '=== new failures (post-fix) ===';
SELECT sku, failure_type FROM enrichment_failures WHERE created_at > '2026-05-21T11:00:00Z';
SELECT '=== validation_status of post-fix cache rows ===';
SELECT sku, validation_status, confidence FROM enrichment_cache WHERE created_at > '2026-05-21T11:00:00Z' ORDER BY created_at;
SQL
```

Replace `'2026-05-21T11:00:00Z'` with a timestamp shortly before you started the smoke run. Expected:
- 0 new failures, OR
- Any new failures have a DIFFERENT root cause (not food_matching gloss) — that's a finding to investigate but not a regression.
- Cache rows with `validation_status='passed'` (or `'repaired'` if the validator's new fallback path stripped a gloss to recover).

- [ ] **Step 3.4: Compare metrics — was the fix successful?**

Read the `data/exports/enrich-smoke-task3-postfix.log` summary footer. Compare to the pre-fix smoke run:

| Metric | Pre-fix (Task 7 of prior plan) | Post-fix target |
|---|---|---|
| Cache hits | 0 | 6 (from prior run) |
| API calls | 14 (10 + 4 retries) | 4 (no retries) |
| Validation failures | 4 (40%) | 0 |
| Direct local writes | 0 | varies — see below |
| Cost | THB 3.25 | < THB 1.50 |

**Direct local writes** depend on the final confidence score. Math: `ai_conf × tier_multiplier × validator_multiplier`. Tier-B multiplier = 0.90, `passed` validator multiplier = 1.00. So at AI conf 0.85 → final 0.765, at 0.95 → 0.855. Any SKU returning AI conf ≥ 0.945 will clear the 0.85 threshold. **Expect 0-2 direct writes** for these 10 Tier-B SKUs (the morning batch showed AI conf 0.65-0.92). Substantial direct writes will appear in the full Tier 1 run from Tier-A evidence (S1 brands with rich Winesensed matches).

- [ ] **Step 3.5: Document findings in a follow-up commit**

```bash
git add docs/superpowers/  # only if you added a new findings doc
git commit --allow-empty -m "test(enrichment): post-fix smoke verifies food-label gloss fix

10-SKU Tier-1 smoke run after the food-label-gloss fix. Compared to
the pre-fix smoke run:

- Validation failures: 4 → [actual]
- API calls: 14 → [actual]
- Cost: THB 3.25 → THB [actual]

[Brief note on whether direct writes appeared and whether any new
failure modes surfaced.]"
```

`--allow-empty` because there may be no file changes — the commit is documentary.

---

## Pre-flight checklist before scaling

After all 3 tasks complete, before running full Tier 1 (~1,708 SKUs):

- [ ] All 151 tests pass: `.venv/bin/pytest tests/ -v`
- [ ] Smoke run shows 0 food-label-gloss failures
- [ ] Cost per SKU dropped from THB 0.36 to ~THB 0.15-0.17 (no retry overhead)
- [ ] No new failure modes surfaced (check `enrichment_failures` for new patterns)

Then the full-tier run (operational, NOT part of this plan):

```bash
.venv/bin/python data/enrich_wines.py --tier 1 --priority popularity
# review enrichment_failures + products with high confidence
.venv/bin/python scripts/sync_to_supabase.py --dry-run
# eyeball the deltas
.venv/bin/python scripts/sync_to_supabase.py
# proceed to Tier 2
.venv/bin/python data/enrich_wines.py --tier 2 --priority popularity
.venv/bin/python scripts/sync_to_supabase.py
```

---

## Notes on TDD discipline

- Task 1 and Task 2 start with the failing test (Step .2 always).
- Each task ends with a commit (last step always).
- Run `.venv/bin/pytest tests/` after every task to catch regressions early.
- Task 3 is operational verification (no source changes; commit is documentary).

## Notes on cost

- Task 1 = $0 (pure logic test)
- Task 2 = $0 (pure string test)
- Task 3 = ~$0.02 (4 fresh API calls × $0.005 each, no retries expected)
- **Total plan execution = ~$0.02, ~30 minutes of focused work**
- Pays for itself many times over — full Tier 1 cost drops from ~$17.50 to ~$7.50 (~$10 saved), full Tier 1+2 from ~$52 to ~$23 (~$29 saved).
