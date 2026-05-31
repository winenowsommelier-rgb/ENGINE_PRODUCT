from unittest.mock import patch, MagicMock
from lib.curation.rationale_writer import write_rationales
from lib.curation.models import ScoredProduct, StructuredQuery

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
