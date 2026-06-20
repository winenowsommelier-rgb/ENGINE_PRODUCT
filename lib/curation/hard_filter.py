from __future__ import annotations
from lib.curation.models import StructuredQuery

# Grade order for score_threshold mapping (A=95+, B=85+, C=70+)
_GRADE_SCORE = {"A": 95, "B": 85, "C": 70, "D": 0}
_SCORE_TO_MIN_GRADE = [(95, "A"), (85, "B"), (70, "C"), (0, "D")]


def _grade_passes_threshold(grade: str | None, threshold: float) -> bool:
    """Return True if enrichment_quality_grade implies score >= threshold.

    score_max is unpopulated in this catalogue. We map critic-score thresholds
    to enrichment_quality_grade as a proxy: A≥95, B≥85, C≥70.
    """
    if not grade:
        return threshold <= 70  # ungraded products pass low thresholds only
    grade_score = _GRADE_SCORE.get(str(grade).upper(), 0)
    return grade_score >= threshold


def hard_filter(products: list[dict], query: StructuredQuery) -> list[dict]:
    result = []
    for p in products:
        if query.in_stock_only and str(p.get("is_in_stock", "0")) != "1":
            continue
        if query.category_filter:
            # Gate on SKU-derived category_group/category_type, NOT the
            # unreliable `classification` field (mislabels ~1,509 rows
            # "Wine product"). See test_category_filter_uses_category_group_not_classification.
            grp = p.get("category_group", "")
            typ = p.get("category_type", "")
            hay = f"{grp} {typ}".lower()
            if not any(f.lower() in hay for f in query.category_filter):
                continue
        if query.country_filter:
            country = p.get("country", "")
            if not any(f.lower() == country.lower() for f in query.country_filter):
                continue
        if query.region_filter:
            region = p.get("region", "")
            if not any(f.lower() in region.lower() for f in query.region_filter):
                continue
        price = float(p.get("price") or 0)
        if query.price_min_thb is not None and price < query.price_min_thb:
            continue
        if query.price_max_thb is not None and price > query.price_max_thb:
            continue
        if query.score_threshold is not None:
            # Prefer actual critic score when available, fall back to grade proxy
            actual_score = p.get("score_max")
            if actual_score not in (None, "", 0):
                if float(actual_score) < query.score_threshold:
                    continue
            else:
                if not _grade_passes_threshold(p.get("enrichment_quality_grade"), query.score_threshold):
                    continue
        result.append(p)
    return result
