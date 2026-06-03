from __future__ import annotations
import json
from pathlib import Path
from lib.curation.llm_router import LLMRouter
from lib.curation.models import StructuredQuery

_SYSTEM_PROMPT = """\
You are a structured query extractor for a wine and spirits curation engine.
Given a natural-language curation brief, extract a JSON object with these keys:
- category_filter: list of beverage categories (e.g. ["Wine", "Whisky", "Gin"])
- subcategory_filter: list (e.g. ["Red", "White", "Single Malt"])
- country_filter: list of countries
- region_filter: list of regions
- score_threshold: number or null (minimum score/rating points)
- price_min_thb: number or null
- price_max_thb: number or null
- prefer_high_margin: boolean
- in_stock_only: boolean (default true)
- pairing_context: string or null (food, cuisine, or dish)
- course_position: string or null (aperitif/first_course/main_course/dessert/digestif)
- occasion_id: string or null (business_dinner/celebration/everyday/gift/horecab2b_tasting_menu)
- menu_tier: string or null (everyday/mid-range/premium/prestige)
- output_size: integer (default 12)
- audience: list (internal/customer/b2b)

Return ONLY the JSON object, no other text.\
"""


def parse_brief(brief: str, config_path: Path | None = None) -> StructuredQuery:
    router = LLMRouter(config_path=config_path)
    prompt = f"{_SYSTEM_PROMPT}\n\nBrief: {brief}"
    raw = router.complete(prompt, tier="production")
    text = raw.strip()
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text.strip())
    except json.JSONDecodeError:
        data = {}
    return StructuredQuery(
        raw_brief=brief,
        category_filter=data.get("category_filter") or [],
        subcategory_filter=data.get("subcategory_filter") or [],
        country_filter=data.get("country_filter") or [],
        region_filter=data.get("region_filter") or [],
        score_threshold=data.get("score_threshold"),
        price_min_thb=data.get("price_min_thb"),
        price_max_thb=data.get("price_max_thb"),
        prefer_high_margin=bool(data.get("prefer_high_margin", False)),
        in_stock_only=bool(data.get("in_stock_only", True)),
        pairing_context=data.get("pairing_context"),
        course_position=data.get("course_position"),
        occasion_id=data.get("occasion_id"),
        menu_tier=data.get("menu_tier"),
        output_size=int(data.get("output_size") or 12),
        audience=data.get("audience") or [],
    )
