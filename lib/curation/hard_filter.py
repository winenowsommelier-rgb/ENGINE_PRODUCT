from __future__ import annotations
from lib.curation.models import StructuredQuery


def hard_filter(products: list[dict], query: StructuredQuery) -> list[dict]:
    result = []
    for p in products:
        if query.in_stock_only and str(p.get("is_in_stock", "0")) != "1":
            continue
        if query.category_filter:
            cls = p.get("classification", "")
            if not any(f.lower() in cls.lower() for f in query.category_filter):
                continue
        if query.country_filter:
            country = p.get("country", "")
            if not any(f.lower() == country.lower() for f in query.country_filter):
                continue
        if query.region_filter:
            region = p.get("region", "")
            if not any(f.lower() in region.lower() for f in query.region_filter):
                continue
        price = float(p.get("price", 0))
        if query.price_min_thb is not None and price < query.price_min_thb:
            continue
        if query.price_max_thb is not None and price > query.price_max_thb:
            continue
        result.append(p)
    return result
