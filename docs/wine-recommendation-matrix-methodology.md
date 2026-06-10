# Wine Recommendation Matrix Methodology

**Date:** 2026-06-04  
**Status:** Active core-feature methodology  
**Scope:** Wine first; liquor and other categories later

---

## Objective

Build a professional, explainable recommendation core for:

- Product recommendation
- Product relationships
- Direct substitution
- Premium gift selection
- Value alternatives
- Trade-up paths
- Curation and promotion lists

This system must be more reliable than loose text search or generic similarity. It should behave like a staff sommelier using structured product data, professional theory, and business constraints.

---

## Core Principle

Wine recommendation is not one score. It is a matrix of relationship intent.

The same candidate can be:

- a poor direct substitute,
- a good similar-style discovery,
- a strong premium gift,
- or a useful trade-up.

So the engine scores each relationship type separately.

---

## Current Relationship Types

| Type | Purpose | Main question |
|---|---|---|
| `direct_substitute` | Replace an unavailable or skipped product | Will the customer feel this is a fair replacement? |
| `similar_style` | Suggest comparable drinking style | Does it drink similarly? |
| `trade_up` | Recommend a more premium option | Is it a better/more premium version of the same idea? |
| `value_alternative` | Recommend a lower-price option | Does it preserve enough style while saving money? |
| `premium_gift` | Gift and promotion recommendation | Does it look and feel suitable for gifting or promotion? |

---

## Scoring Dimensions

| Dimension | Meaning | Why it matters |
|---|---|---|
| `category` | Red, white, Champagne, sparkling, rose, dessert, etc. | Customers expect category continuity for substitution |
| `grape_family` | Cabernet family, Pinot family, Syrah family, Chardonnay family, etc. | Grape family predicts style and customer expectation |
| `origin` | Subregion, region, country, or classic cross-region affinity | Origin carries prestige, typicity, and substitution risk |
| `structure` | Body, acidity, tannin, sweetness | The most important drinking-shape signal |
| `flavor` | Flavor tag overlap | Useful but less reliable than structure |
| `price` | Price role fit for replacement, value, trade-up, or gift | Prevents wrong commercial expectation |
| `quality` | Validation, confidence, image, and copy | Protects staff trust and customer-facing quality |
| `presentation` | Image, brand, region, validation, premium price | Important for gift and promotion use cases |

---

## Professional Rules

### Direct Substitute

A direct substitute should preserve:

- same or very close category
- same grape/style family when possible
- similar structure
- close price
- same origin when possible

Different origin is allowed only when structure, grape family, and price are strong enough.

### Similar Style

Similar-style recommendations prioritize:

- structure
- flavor
- grape/style family
- category

Price can be wider than a direct substitute because this is discovery, not replacement.

### Trade Up

A trade-up should:

- cost more than the anchor
- keep the same broad style promise
- improve quality, origin prestige, brand perception, or presentation

### Value Alternative

A value alternative should:

- cost less than the anchor
- keep category and structure continuity
- avoid feeling like a downgrade in drinking style

### Premium Gift

A gift recommendation needs:

- strong image/presentation
- recognizable brand or origin
- premium price signal
- validated or high-confidence content
- clear short copy

---

## Constraint Layer

Each relationship type has minimum constraints before scoring is accepted.

Examples:

- Direct substitute must pass minimum category, grape/style, structure, and price fit.
- Premium gift must pass quality, presentation, and price fit.
- Trade-up must pass category, structure, and quality fit.

This prevents a high total score from hiding a fatal mismatch.

---

## Risk Flags

The engine returns risk flags for staff review:

- `out_of_stock`
- `low_confidence`
- `missing_image`
- `missing_copy`
- `wide_structure_gap`
- `different_origin`
- `price_jump`

Risk flags do not always remove a candidate. They tell the staff what to check.

---

## Scorecard Output

Each recommendation includes:

- final score
- confidence band
- fit summary
- relationship reasons
- risk flags
- matrix scores
- weighted contribution by dimension

This is what makes the result auditable.

Example:

```json
{
  "relationship_type": "direct_substitute",
  "score": 91,
  "fit_summary": "Excellent professional fit",
  "reasons": [
    "same category: Red Wine",
    "same grape/style family: syrah_family",
    "same region: Barossa Valley",
    "similar structure across body, acidity, tannin and sweetness",
    "close price replacement"
  ],
  "scorecard": [
    { "dimension": "structure", "score": 1.0, "weight": 20, "contribution": 20 },
    { "dimension": "category", "score": 1.0, "weight": 18, "contribution": 18 }
  ]
}
```

---

## Tuning Process

Use staff review to tune the matrix.

For each rejected recommendation, record one reason:

- wrong style
- wrong price
- wrong origin
- wrong grape
- not premium enough
- too risky for customer-facing use
- weak content
- not available

Then tune:

- weights when the ranking order feels wrong
- constraints when bad candidates pass
- grape families when style grouping is wrong
- classic cross-region affinities when professional substitutions are missing
- quality thresholds when staff cannot trust output

---

## Next Strengthening Steps

1. Add staff feedback logs from approve/skip/replace.
2. Add known-good benchmark pairs for wine.
3. Add known-bad pairs to prevent bad substitutions.
4. Add collection balancing rules: avoid 10 products that are all the same style.
5. Add liquor-specific matrices after wine is stable.
6. Add BI performance as a separate commercial signal, not as a replacement for professional fit.

---

## Implementation Files

- Rule config: `data/lib/recommendation/wine_recommendation_rules.json`
- Engine: `lib/recommendation/wine.ts`
- API: `app/api/recommendations/wine/route.ts`
- UI surface: `components/pages/CurationPage.tsx`

