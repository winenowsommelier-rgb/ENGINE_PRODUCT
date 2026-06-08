from __future__ import annotations
import json
import re
from pathlib import Path
from lib.curation.llm_router import LLMRouter
from lib.curation.models import StructuredQuery

# Regex pre-pass: catch score signals the LLM misses (e.g. "100 points", "95+", "top rated")
_SCORE_PATTERNS = [
    (r'\b100[\s-]*point', 95),   # "100 points", "100-point" → grade A proxy (≥95)
    (r'\b9[5-9][\s-]*point', 95),  # "95 points", "98 points"
    (r'\b9[0-4][\s-]*point', 90),  # "90 points", "93 points"
    (r'\b(\d{2,3})\s*\+\s*point', None),  # "90+ points" → extract number
    (r'\btop[\s-]rated\b', 90),
    (r'\bbest[\s-]of[\s-](?:the[\s-])?year\b', 90),
    (r'\bcant?[\s-]miss\b', 90),   # "can't miss", "cant miss"
    (r'\bmust[\s-](?:buy|have|try)\b', 85),
]


def _regex_score_threshold(brief: str) -> float | None:
    lower = brief.lower()
    best = None
    for pattern, score in _SCORE_PATTERNS:
        m = re.search(pattern, lower)
        if not m:
            continue
        if score is None:
            # extract the explicit number from the match
            digits = re.search(r'\d+', m.group(0))
            score = float(digits.group()) if digits else 90
        if best is None or score > best:
            best = float(score)
    return best

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
    # If LLM missed score signals, the regex pre-pass catches them
    llm_score = data.get("score_threshold")
    regex_score = _regex_score_threshold(brief)
    score_threshold = llm_score if llm_score is not None else regex_score

    return StructuredQuery(
        raw_brief=brief,
        category_filter=data.get("category_filter") or [],
        subcategory_filter=data.get("subcategory_filter") or [],
        country_filter=data.get("country_filter") or [],
        region_filter=data.get("region_filter") or [],
        score_threshold=score_threshold,
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
