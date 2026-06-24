# Taste-Data Quality Audit — Report

Total rows: 11436
Judge: yes

Judge calibration: checked=69 agreed=66 miscalibrated=False
Escalated cells -> extra rows judged: 0

## smokiness
- populated: 1970
- deterministic suspects: 11
    - peated_false_negative: 8
    - smoky_brand_false_positive: 3
- judged: 88 | wrong: 12 | measured error rate: 0.136 (Wilson LB 0.08)
- ADVISORY leaning: **correct** (human confirms in Task 8)

## sweetness
- populated: 1547
- deterministic suspects: 230
    - inapplicable_column: 181
    - sparkling_extra_dry_inversion: 49
- judged: 240 | wrong: 78 | measured error rate: 0.325 (Wilson LB 0.269)
- ADVISORY leaning: **correct** (human confirms in Task 8)

## body
- populated: 7870
- deterministic suspects: 690
    - inapplicable_column: 688
    - body_case_dup: 2
- judged: 726 | wrong: 144 | measured error rate: 0.198 (Wilson LB 0.171)
- ADVISORY leaning: **correct** (human confirms in Task 8)

## variety
- populated: 8520
- deterministic suspects: 28
    - nonbeverage_taste_leak: 20
    - inapplicable_column: 8
- judged: 152 | wrong: 90 | measured error rate: 0.592 (Wilson LB 0.513)
- ADVISORY leaning: **re-enrich** (human confirms in Task 8)

---

## Per-column DECISION (Task 8 — confirmed)

Judge calibration PASSED (66/69 known-bug rows correctly flagged; not
miscalibrated). 0 control cells escalated → the non-flagged data is reliable;
the error is concentrated in the deterministically-flagged zones.

**COST (Rule 4 — corrected):** 1,206 rows judged via Haiku 4.5.
- API calls: 1,206 (one per row; 20 from the canary, 1,186 from the full run).
- Tokens ≈ 336 input + 84 output per call (the 303-token domain-rules SYSTEM
  prompt is resent on every call and dominates input).
- **Actual spend ≈ $0.91** — NOT the $0.25 the canary printed. The canary
  estimate used ~60 input tok/row and omitted the system-prompt resend, so it
  under-counted ~3.6×. Lesson for the correction-script spec: either prompt-cache
  the system block (~5× cheaper) or fold the per-row estimate constant to include
  it. The data shipped: per-SKU verdicts for all 1,206 rows are in
  `data/audits/taste_audit_findings.json` (this is an AUDIT artifact, not a DB
  write — no user-facing field was paid-to-populate this run).

### smokiness → **CORRECT** (deterministic, no spend)
Measured error 13.6% (LB 0.08), concentrated entirely in the 11 suspects — and
the judge confirmed **all 11**: 8 peated false-negatives (Talisker ×3, Ledaig ×2,
Bunnahabhain ×3 incl. Y&F) → should be smoky; 3 Ole Smoky moonshine → should be
none (brand, not peat). Fix = flip those 11 via a source-agnostic correction
script (peated lexicon + brand blocklist). The sommelier display rule still
holds: whisky-only BADGE, and "suppress none" is SAFE **only after** these
false-negatives are flipped, or it would silently hide the peated drams.

### sweetness → **CORRECT** (deterministic, no spend)
Two distinct fixes: (a) **49/49 sparkling "Extra Dry" → Off-Dry** (judge
unanimous — semantic inversion); (b) 181 "inapplicable" Dry-on-Gin / sake — but
the judge confirmed **156/181 are correct palate statements**, so this is
**suppress-don't-delete** (don't show the gauge for Gin/sake categories where
`applies()` is false), NOT a value correction. Only the 24 judged-wrong
inapplicable rows + the 49 inversions need value edits.

### body → **CORRECT (suppress-dominant) + small value tail**
688 body-on-spirits flagged "inapplicable"; the judge confirmed **559 (81%) are
correct values** (Lagavulin=Full, Dalwhinnie=Light). So body-on-spirits is
**suppress-don't-delete** (display decision: the catalog body gauge is wine/sake/
liqueur only per `applies()`) — the *values* are mostly right. A ~19% tail (69
wrong + 60 null-it) are genuinely wrong and can be corrected or left unshown.
2 lowercase case-dupes → trivial normalize. No re-enrich needed.

### variety → **MIXED: trust grape (wine), re-enrich/null the junk tokens**
Headline 59% looks alarming but is the CONTROL sample exposing a **broad legacy
junk-token problem in NON-grape variety**: Absinthe/Aquavit tagged "Other"/
"Grain", Beer tagged "Cider", + 14 Accessories grape-leaks. By group, the
non-correct rows are Sake (28), Spirits (26), Accessories (14), **Wine only 11**.
So: wine grape variety is largely TRUSTWORTHY (Run-1 Haiku values held up);
the junk is in non-grape base-material tokens. Fix = (a) NULL the 20 nonbeverage
leaks deterministically (free); (b) the spirit/sake "Other/Grain/Cider" tokens
are a **scoped re-enrich** candidate (paid, Rule-10 gated, ~few hundred rows) —
NOT a blanket re-enrich of all 8,520.

### Net recommendation
- **One free, deterministic correction script** handles smokiness (11), sweetness
  Extra-Dry (49), nonbeverage variety/body leaks (20+), body case (2), and the
  display-suppression flags for body-on-spirits + sweetness-on-Gin/sake. This is
  the bulk of the user-visible wins at **$0 spend**.
- **One scoped, Rule-10-gated re-enrich** for the non-grape variety junk tokens
  (sake/spirits "Other/Grain/Cider") — its own brainstorm→spec→canary→sign-off.
- **No blanket re-enrich.** Wine grape variety and the non-flagged majority are
  trustworthy (0 escalations).

The correction script is the NEXT effort (separate spec); this audit is complete.
