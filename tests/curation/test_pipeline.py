import json as _json2, pathlib as _pathlib2
from unittest.mock import patch, MagicMock
from lib.curation.rationale_writer import write_rationales
from lib.curation.models import ScoredProduct, StructuredQuery
from lib.curation.pipeline import run_curation

PRODUCTS_RAW = [
    {"sku": "WRW001", "name": "Napa Cab", "classification": "Red Wine",
     "wine_body": "Full", "flavor_tags": ["blackcurrant", "cedar"],
     "desc_en_short": "Bold Napa Cab."},
]

SCORED = [ScoredProduct(sku="WRW001", name="Napa Cab", raw_score=0.85, rationale="")]

def test_write_rationales_fills_rationale_field():
    q = StructuredQuery(raw_brief="Best USA wine")
    with patch("lib.curation.llm_router.httpx.post") as mock_post:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": {"content": "SKU: WRW001 | NOTE: Bold Napa Cab with blackcurrant and cedar — structured and cellar-worthy."}}
        )
        results = write_rationales(SCORED, PRODUCTS_RAW, q)
    assert results[0].rationale != ""
    assert len(results[0].rationale) > 10


BRIEF_JSON = _json2.dumps({
    "category_filter": ["Red Wine"], "country_filter": ["USA"],
    "score_threshold": None, "pairing_context": None,
    "in_stock_only": True, "output_size": 3,
    "occasion_id": None, "audience": ["internal"],
    "subcategory_filter": [], "region_filter": [],
    "price_min_thb": None, "price_max_thb": None,
    "prefer_high_margin": False, "course_position": None,
    "menu_tier": None,
})
RATIONALE_LINE = "SKU: WRW001 | NOTE: Structured Napa Cab with dark fruit and cedar."

def test_run_curation_returns_ranked_list():
    with patch("lib.curation.llm_router.httpx.post") as mock_post:
        mock_post.side_effect = [
            MagicMock(status_code=200, json=lambda: {"message": {"content": BRIEF_JSON}}),
            MagicMock(status_code=200, json=lambda: {"message": {"content": RATIONALE_LINE}}),
        ]
        result = run_curation("Best USA red wine", products_path=_pathlib2.Path("data/db/products.json"))
    assert "products" in result
    assert len(result["products"]) > 0
    assert "score" in result["products"][0]
    assert "rationale" in result["products"][0]
