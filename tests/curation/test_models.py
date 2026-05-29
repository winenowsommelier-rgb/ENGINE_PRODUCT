from lib.curation.models import StructuredQuery, PairingScore, ScoredProduct


def test_structured_query_defaults():
    q = StructuredQuery(raw_brief="Best USA wine")
    assert q.category_filter == []
    assert q.country_filter == []
    assert q.in_stock_only is True
    assert q.output_size == 12


def test_pairing_score_total_penalty():
    ps = PairingScore(
        rule_matched=False,
        pairing_boost=0.0,
        bridge_bonus=0.0,
        regional_bonus=0.0,
        intensity_ok=True,
        contraindication_triggered=True,
        contraindication_penalty=-0.40,
        avoid_tag_count=2,
        avoid_tag_penalty=-0.10,
        matched_rule_ids=[],
    )
    assert ps.total_penalty == -0.50


def test_scored_product_final_score_clamped():
    sp = ScoredProduct(sku="WRW001", name="Test Wine", raw_score=1.25, rationale="")
    assert sp.final_score == 100
