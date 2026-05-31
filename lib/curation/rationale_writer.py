from __future__ import annotations
from pathlib import Path
from lib.curation.llm_router import LLMRouter
from lib.curation.models import ScoredProduct, StructuredQuery

_RATIONALE_PROMPT = """\
You are a master sommelier writing one-line expert tasting notes for a curated product list.
For each product, write a single sentence (max 25 words) in an expert, confident sommelier voice.
Focus on: key flavour characteristics, style, and why it fits the curation context.
Do NOT mention scores or prices. Do NOT use generic phrases like "a great wine" or "excellent choice".

Curation context: {context}
Pairing context: {pairing}

Products:
{products}

Return one line per product in the exact format:
SKU: [sku] | NOTE: [one sentence rationale]
"""


def write_rationales(
    scored: list[ScoredProduct],
    products_raw: list[dict],
    query: StructuredQuery,
    config_path: Path | None = None,
    top_n: int = 12,
) -> list[ScoredProduct]:
    top = scored[:top_n]
    raw_by_sku = {p["sku"]: p for p in products_raw}

    product_lines = []
    for sp in top:
        p = raw_by_sku.get(sp.sku, {})
        tags = ", ".join(p.get("flavor_tags") or [])
        body = p.get("wine_body") or ""
        product_lines.append(
            f"SKU: {sp.sku} | Name: {sp.name} | Style: {p.get('classification','')} "
            f"| Body/Profile: {body} | Flavours: {tags} | Desc: {p.get('desc_en_short','')}"
        )

    prompt = _RATIONALE_PROMPT.format(
        context=query.raw_brief,
        pairing=query.pairing_context or "none",
        products="\n".join(product_lines),
    )

    router = LLMRouter(config_path=config_path)
    raw_response = router.complete(prompt, tier="production")

    rationale_map: dict[str, str] = {}
    for line in raw_response.splitlines():
        line = line.strip()
        if line.startswith("SKU:") and "| NOTE:" in line:
            parts = line.split("| NOTE:", 1)
            sku_part = parts[0].replace("SKU:", "").strip()
            note_part = parts[1].strip()
            rationale_map[sku_part] = note_part

    updated = []
    for sp in top:
        note = rationale_map.get(sp.sku, sp.rationale)
        updated.append(ScoredProduct(
            sku=sp.sku, name=sp.name, raw_score=sp.raw_score,
            rationale=note, pairing_score=sp.pairing_score,
            web_signal=sp.web_signal, matched_rule_ids=sp.matched_rule_ids,
        ))
    return updated + scored[top_n:]
