# Suggested Update Block — Schema Reference

This document defines the JSON patch format that the Sommelier AI outputs at the end of every reply.
Admins review these blocks and apply approved changes to the product database.

---

## Schema

```json
{
  "sku": "string — the WN/LIQ9 SKU code, e.g. WRW2106AC",
  "field": "string — the field name to update (see Field Reference below)",
  "current_value": "any — the value currently in the catalog, or null if empty",
  "suggested_value": "any — the recommended replacement value",
  "reason": "string — why this change is suggested",
  "confidence": "high | medium | low",
  "source": "string — publication, URL, or method used"
}
```

The AI outputs an array of these objects. Multiple updates for the same SKU are allowed.

---

## Field Reference

| Field | Type | Example |
|-------|------|---------|
| `name` | string | `"Château Margaux 2018"` |
| `brand` | string | `"Château Margaux"` |
| `grape_variety` | string | `"Cabernet Sauvignon, Merlot, Petit Verdot"` |
| `vintage` | string | `"2018"` |
| `country` | string | `"France"` |
| `region` | string | `"Bordeaux"` |
| `subregion` | string | `"Margaux"` |
| `appellation` | string | `"Margaux AOC"` |
| `wine_body` | string | `"Full"` — one of: Light / Medium-Light / Medium / Medium-Full / Full |
| `wine_acidity` | string | `"High"` — one of: Low / Medium-Low / Medium / Medium-High / High |
| `wine_tannin` | string | `"High"` — one of: Low / Medium-Low / Medium / Medium-High / High |
| `alcohol` | string | `"13.5%"` |
| `flavor_tags` | array of strings | `["Blackcurrant", "Cedar", "Violet", "Tobacco"]` |
| `food_matching` | string | `"Grilled red meat, Lamb dishes, Aged hard cheese"` |
| `pairing_rationale` | string | `"High tannins cut through rich fat; acidity brightens lamb"` |
| `desc_en_short` | string | Short 1–2 sentence description (max ~200 chars) |
| `full_description` | string | Full HTML description paragraph |
| `score_max` | number | `95` — critic score (Decanter, Wine Spectator, etc.) |
| `score_summary` | string | `"95 pts — Wine Spectator 2023: complex, age-worthy"` |

---

## Confidence Levels

| Level | Meaning |
|-------|---------|
| `high` | Directly sourced from a named publication, official producer page, or appellation authority |
| `medium` | Inferred from established regional/varietal conventions; plausible but not directly verified |
| `low` | Speculative or inferred from analogous products; flag for manual review before applying |

---

## How admins apply updates

1. Review the suggested update block at the end of the AI reply
2. Decide which updates to accept
3. Reply **"apply updates"** to confirm all, or list specific SKUs to apply selectively
4. The AI will confirm what it applied (in this session, updates are advisory — use the batch import script for permanent DB writes)

### Batch import script (future)
When you're ready to build it:
- Input: an array of approved update objects (this schema)
- Script reads `products.db`, applies each field update, then runs `scripts/refresh_live_export.py`
- Follows Rule 1 of CLAUDE.md: verifies the field is populated in the export after writing

---

## Example update block

```json
[
  {
    "sku": "LWH0634BU",
    "field": "score_summary",
    "current_value": null,
    "suggested_value": "92 pts — Whisky Advocate 2023: elegant Speyside, vanilla and oak-forward",
    "reason": "Score found on Whisky Advocate online for Cardhu 12 Year Old",
    "confidence": "high",
    "source": "Whisky Advocate — whiskeyadvocate.com"
  },
  {
    "sku": "LWH0634BU",
    "field": "score_max",
    "current_value": null,
    "suggested_value": 92,
    "reason": "Same source as score_summary",
    "confidence": "high",
    "source": "Whisky Advocate — whiskeyadvocate.com"
  }
]
```
