# Taxonomy Validation Pipeline — Design Spec

**Date:** 2026-05-28  
**Status:** Approved  
**Author:** Claude (engineering session)  
**Supersedes:** Implied extension of `2026-05-27-taxonomy-enrichment.md` plan

---

## Problem

The existing 2-layer taxonomy pipeline (`enrich_taxonomy.py`) fills `region`, `subregion`, and `grape_variety` using:
- Layer 1: regex name inference (151 SKUs filled, zero cost)
- Layer 2: Claude Haiku fallback (cheap but unvalidated against real-world sources)

Neither layer cross-checks against external, authoritative data. The user correctly identified that the masterfile (manually maintained) cannot be trusted 100%, and wants a final validation step against online/authoritative sources for high-value SKUs. Specifically: **will the data be correct and validated?**

---

## Solution: 4-Layer Validated Pipeline

### Layer 0 — Wikidata appellation reference (free, offline)
- Download ~2,000 wine appellation/region records from Wikidata via SPARQL (one-time, cached locally as JSON)
- Before Layer 1, attempt a lookup: product name + classification → known appellation → `{country, region, subregion}` from community-curated geographic data
- Source label: `"wikidata"`
- Confidence: 0.85–0.95 (Wikidata is human-curated and well-audited for major appellations)

### Layer 1 — Name inference rules (existing, free)
- Unchanged: regex appellation patterns in `data/lib/name_inference/rules.py` + grape keyword matching in `grape_rules.py`
- Source label: `"name_inference"`

### Layer 2 — Claude Haiku (existing, cheap)
- Unchanged: fills remaining unresolved fields via structured micro-prompt
- Source label: `"haiku_inferred"`

### Layer 3 — Sonnet web-search validation (new, targeted)
- Triggered ONLY for high-value SKUs (S1/S2 brand tier) where Haiku confidence < 0.85
- Calls Claude Sonnet with `web_search` tool to validate/correct the Haiku output against live producer/appellation websites
- Source label: `"sonnet_validated"`
- SKUs where Sonnet also has confidence < 0.85 → flagged `taxonomy_validation_status = "needs_review"` for human inspection

### Provenance tracking
Each SKU gets a new `taxonomy_provenance` JSON field (stored in products.json, not SQLite):
```json
{
  "region": {"source": "wikidata", "confidence": 0.91, "url": "https://www.wikidata.org/wiki/Q..."},
  "subregion": {"source": "name_inference", "confidence": 0.85},
  "grape_variety": {"source": "sonnet_validated", "confidence": 0.93, "url": "https://..."}
}
```

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `data/build_wikidata_appellations.py` | One-time SPARQL downloader — writes `wikidata_appellations.json` |
| `data/lib/enrichment/taxonomy/wikidata_appellations.json` | Cached reference data (~2K records) |
| `data/lib/enrichment/taxonomy/wikidata_lookup.py` | Lookup module: `lookup(name, classification) → dict` |
| `data/lib/enrichment/taxonomy/sonnet_validator.py` | Sonnet web-search validator: `validate(sku_data, fields_to_validate) → dict` |

### Modified Files

| File | Change |
|------|--------|
| `data/enrich_taxonomy.py` | Add `--layer0`, `--layer3`, `--sonnet-limit` flags; wire Layer 0 before Layer 1; wire Layer 3 after Layer 2 for eligible SKUs; write `taxonomy_provenance` + `taxonomy_validation_status` |

---

## Data Contracts

### `wikidata_lookup.lookup(name, classification)`
Returns:
```python
{
  "region": str,        # "" if not found
  "subregion": str,     # "" if not found  
  "confidence": float,  # 0.0 if not found
  "wikidata_id": str,   # e.g. "Q83481" or ""
  "source": "wikidata"  # or ""
}
```

### `sonnet_validator.validate(sku_data, fields_to_validate)`
Input: `sku_data = {sku, name, country, classification, region, subregion, grape_variety}`, `fields_to_validate = ["region", "grape_variety"]`
Returns:
```python
{
  "region": str,           # corrected or confirmed value
  "subregion": str,
  "grape_variety": str,
  "confidence": float,
  "source": "sonnet_validated",
  "citations": [str],      # URLs used to validate
  "valid": bool,
}
```

---

## Brand Tier Logic

S1/S2 determination (matching existing wine enrichment logic):
- S1: brand has ≥ 10 SKUs in brand_description_library.csv
- S2: brand has 3–9 SKUs

Only S1+S2 brands trigger Layer 3. This caps Sonnet spend to ~200–400 SKUs max.

---

## `needs_review` Flagging

A SKU is flagged `taxonomy_validation_status = "needs_review"` when:
- It went through Layer 3 (Sonnet) AND Sonnet confidence < 0.85, OR
- It went through Layer 2 (Haiku) AND Haiku confidence < 0.75 AND it is S1/S2 brand

These SKUs are skipped for write-back — fields remain empty, allowing manual review.

---

## CLI Flags Added to `enrich_taxonomy.py`

| Flag | Default | Purpose |
|------|---------|---------|
| `--layer0 / --no-layer0` | enabled | Run Wikidata lookup |
| `--layer3 / --no-layer3` | enabled | Run Sonnet validation for S1/S2 |
| `--sonnet-limit` | 100 | Cap on Sonnet calls per run |
| `--sonnet-model` | `claude-sonnet-4-6` | Model for Layer 3 |
| `--brand-library` | auto | Path to brand_description_library.csv |

---

## Quality Promise

After the full 4-layer pass:
- **Layer 0 fills** (Wikidata): high confidence, community-audited geographic data
- **Layer 1 fills** (name rules): deterministic, no hallucination risk
- **Layer 2 fills** (Haiku): fast inference, acceptable for mid-tier SKUs
- **Layer 3 fills** (Sonnet + web): cross-checked against live producer/appellation sources for S1/S2
- **needs_review queue**: any remaining uncertainty flagged for human eyes

This gives the user a credible answer: "yes, high-value SKUs are validated against real online sources."

---

## Out of Scope

- Wine-Searcher scraping (blocks automation)
- Vivino API (no structured data)
- Ahrefs tools (project policy: Google APIs only)
- Full-catalog Sonnet validation (cost-prohibitive; S1/S2 only)
