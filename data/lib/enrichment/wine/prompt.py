"""Prompt builder + hashing for wine enrichment.

Pure functions. Builds (system, user, prompt_hash). prompt_hash is the
sha256 of (PROMPT_TEMPLATE_VERSION + system_text); it does NOT include
the per-SKU user_text — that goes into evidence_hash separately. Together
they form the cache key (sku, prompt_hash, evidence_hash).
"""
from __future__ import annotations

import hashlib

from data.lib.enrichment.wine import taxonomies
from data.lib.enrichment.wine.evidence import Evidence
from data.lib.enrichment.shared.taxonomies.food_pairing import FoodTaxonomy

PROMPT_TEMPLATE_VERSION = "1.0.0"


def _system_prompt(food_tax: FoodTaxonomy) -> str:
    body_enum = " | ".join(taxonomies.BODY_VALUES)
    acid_enum = " | ".join(taxonomies.ACIDITY_VALUES)
    tannin_enum = " | ".join(taxonomies.TANNIN_VALUES)
    blend_enum = " | ".join(taxonomies.BLEND_TYPES)
    prod_enum = " | ".join(taxonomies.PRODUCTION_STYLES)

    return f"""You are an expert sommelier writing structured taxonomy data for a premium Thai online retailer (Wine-Now). Write in third-party expert voice — NEVER use "we" or "our". Output ONLY valid JSON matching the schema below; no preamble.

CONTROLLED VOCABULARY (use ONLY these exact values):
- wine_body: {body_enum}
- wine_acidity: {acid_enum}
- wine_tannin: {tannin_enum}
- grape_blend_type: {blend_enum}
- wine_production_style (multiselect): {prod_enum}
- food_matching: pick 3-6 labels. Use ONLY the bare label text (the part inside the quotes, without the surrounding quote characters) — e.g. write `Grilled red meat`, NOT `"Grilled red meat"` and NOT `"Grilled red meat [examples: steak; pairs with Full red]"`.

OUTPUT JSON SCHEMA:
{{
  "wine_body": "...",
  "wine_acidity": "...",
  "wine_tannin": "...",
  "grape_variety": ["..."],
  "grape_blend_type": "...",
  "wine_production_style": ["..."],
  "flavor_tags": ["5 to 10 short tasting notes"],
  "food_matching": ["3 to 6 labels from taxonomy"],
  "desc_en_short": "<=160 char hook",
  "full_description": "<p>200-800 char HTML (only p/br/strong/em/ul/li)</p>",
  "confidence": 0.0-1.0,
  "confidence_notes": "...",
  "citations": {{
    "winesensed_record_ids": ["..."],
    "brand_library_match": "...",
    "grape_source": "products.grape_variety",
    "critic_scores": ["James Suckling: 95", "..."]
  }}
}}

WINESENSED LICENSE RULE (critical):
- Winesensed records (when shown below) are STRUCTURAL grounding ONLY.
- Cite IDs in citations.winesensed_record_ids when they anchored a choice.
- DO NOT quote, paraphrase, or restate Winesensed review text in flavor_tags,
  desc_en_short, or full_description.
- DO NOT attribute opinions to specific Winesensed reviewers.
- All customer-facing prose must be wholly original, from your own wine knowledge.

CRITIC SCORES RULE:
- Use scores (when shown) as calibration anchors — higher scores → more premium language.
- DO NOT invent scores. DO NOT reproduce any critic's tasting-note prose.
- Cite which scores anchored your judgement in citations.critic_scores.

FOOD PAIRING TAXONOMY:
{food_tax.prompt_block()}

Honesty: if evidence is thin, lower confidence (<0.7) and say so in confidence_notes."""


def _user_message(evidence: Evidence) -> str:
    facts = evidence.facts
    lines = [
        "# Product facts",
        f"SKU: {evidence.sku}",
        f"Name: {facts['name']}",
        f"Brand: {facts['brand']}",
        f"Country: {facts['country']}  •  Region: {facts['region']}",
    ]
    if facts.get("subregion"):
        lines.append(f"Subregion: {facts['subregion']}")
    lines.append(f"Classification: {facts['classification']}")
    lines.append(f"Grape variety (raw): {facts['grape_variety_raw']}")
    lines.append(f"Vintage: {facts['vintage']}  •  Size: {facts['bottle_size']}  •  Price: {facts['price']} THB")
    if facts.get("alcohol"):
        lines.append(f"Alcohol: {facts['alcohol']}")

    lines.append("\n# Evidence — Winesensed real-world tasting notes (STRUCTURAL GROUNDING; do not quote)")
    if evidence.winesensed_matches:
        for m in evidence.winesensed_matches:
            yr = f" ({m.year})" if m.year else ""
            lines.append(f"[{m.record_id}]{yr} {m.grape}, {m.region} (rating {m.rating}, match={m.match_type})")
            lines.append(f"  review-excerpt-for-grounding-only: {m.review_text}")
    else:
        lines.append("(no Winesensed matches)")

    lines.append("\n# Evidence — Brand library")
    if evidence.brand_description and (evidence.brand_description.desc_short or evidence.brand_description.desc_full):
        bd = evidence.brand_description
        lines.append(f"{bd.name} (tier {bd.tier}):")
        if bd.desc_short:
            lines.append(f"  Short: {bd.desc_short}")
        if bd.desc_full:
            lines.append(f"  Full: {bd.desc_full[:600]}")
    else:
        lines.append("(no brand library entry)")

    lines.append("\n# Evidence — Taxonomy heuristic")
    lines.append(evidence.heuristic_profile)

    lines.append("\n# Evidence — Expert critic scores")
    if evidence.critic_scores:
        for s in evidence.critic_scores:
            yr = f" ({s.tasting_year})" if s.tasting_year else ""
            vt = f" [vintage {s.vintage}]" if s.vintage else ""
            lines.append(f"{s.critic}: {s.score}/{int(s.score_max)}{yr}{vt}")
        lines.append("(Calibration only — do NOT invent scores; do NOT reproduce critic prose; cite which scores anchored your judgement in citations.critic_scores.)")
    else:
        lines.append("(no critic scores recorded)")

    lines.append("\n# Your task")
    lines.append("Produce the matrix JSON for this SKU per the schema in the system prompt.")
    lines.append("Cite which evidence anchored each major choice in `citations`.")
    lines.append("If evidence conflicts, state the conflict in `confidence_notes` and lower confidence.")
    lines.append("Output ONLY JSON, no preamble.")
    return "\n".join(lines)


def build_prompt(evidence: Evidence, food_tax: FoodTaxonomy) -> tuple[str, str, str]:
    """Returns (system_text, user_text, prompt_hash)."""
    system = _system_prompt(food_tax)
    user = _user_message(evidence)
    hash_input = f"{PROMPT_TEMPLATE_VERSION}\n{system}"
    prompt_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()
    return system, user, prompt_hash
