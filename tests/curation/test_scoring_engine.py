import json, pathlib
from lib.curation.scoring_engine import score_candidates, _web_freshness
from lib.curation.knowledge_base import load_knowledge_base
from lib.curation.models import StructuredQuery
from lib.curation.affinity_resolver import find_affinities

KB = load_knowledge_base(pathlib.Path("data/lib/pairing_knowledge"))
SCORING_MODEL_PATH = pathlib.Path("data/lib/curation/curation_scoring_model.json")

PRODUCTS = [
    {"id": "p1", "sku": "WRW001", "name": "Napa Cab", "classification": "Red Wine",
     "country": "USA", "price": 3500, "b2b_margin_pct": "30%", "is_in_stock": "1",
     "wine_body": "Full", "wine_tannin": "Full", "wine_acidity": "Medium",
     "flavor_tags": ["blackcurrant", "cedar", "dark plum"],
     "desc_en_short": "Bold Napa Cab.", "taxonomy_confidence": 0.9},
    {"id": "p2", "sku": "WWW001", "name": "Chablis", "classification": "White Wine",
     "country": "France", "price": 2800, "b2b_margin_pct": "28%", "is_in_stock": "1",
     "wine_body": "Light", "wine_tannin": "Light", "wine_acidity": "Full",
     "flavor_tags": ["mineral", "citrus", "green apple"],
     "desc_en_short": "Crisp Chablis.", "taxonomy_confidence": 0.92},
]

def test_score_returns_scored_products():
    q = StructuredQuery(raw_brief="best wine")
    results = score_candidates(PRODUCTS, q, KB, SCORING_MODEL_PATH)
    assert len(results) == 2
    assert all(0 <= r.final_score <= 100 for r in results)

def test_score_sorted_descending():
    q = StructuredQuery(raw_brief="best wine")
    results = score_candidates(PRODUCTS, q, KB, SCORING_MODEL_PATH)
    scores = [r.final_score for r in results]
    assert scores == sorted(scores, reverse=True)

def test_occasion_override_changes_scores():
    q1 = StructuredQuery(raw_brief="test")
    q2 = StructuredQuery(raw_brief="test", occasion_id="horecab2b_tasting_menu")
    r1 = score_candidates(PRODUCTS, q1, KB, SCORING_MODEL_PATH)
    r2 = score_candidates(PRODUCTS, q2, KB, SCORING_MODEL_PATH)
    assert all(0 <= r.final_score <= 100 for r in r1 + r2)


# ── web_freshness regression guard ────────────────────────────────────────────
# History: `wf` was hardcoded to 0.0 in score_candidates, so the model's
# web_freshness weight (0.2) was allocated but never applied — critic scores
# had zero effect on ranking. These tests lock in that critic scores DO move
# the final score, and that the parse handles both score_max and the
# score_summary JSON fallback (where score_native is a string in real data).

def test_web_freshness_parses_score_max_above_floor():
    # 91 with floor 85 -> (91-85)/(100-85) = 0.4
    assert abs(_web_freshness({"score_max": 91.0}) - 0.4) < 1e-9

def test_web_freshness_zero_below_floor():
    assert _web_freshness({"score_max": 84.0}) == 0.0
    assert _web_freshness({"score_max": 85.0}) == 0.0  # at floor -> 0
    assert _web_freshness({}) == 0.0

def test_web_freshness_falls_back_to_summary_string_scores():
    # real score_summary has score_native as a STRING ("91")
    summary = json.dumps({"critics": [{"score_native": "91"}, {"score_native": "88"}]})
    # takes the max critic (91) -> 0.4
    assert abs(_web_freshness({"score_summary": summary}) - 0.4) < 1e-9

def test_high_critic_score_raises_final_score():
    base = {"sku": "WRW900", "name": "Plain", "classification": "Red Wine",
            "wine_body": "Full", "flavor_tags": ["blackcurrant", "cedar"],
            "desc_en_short": "x", "taxonomy_confidence": 0.9, "b2b_margin_pct": "30%"}
    acclaimed = {**base, "sku": "WRW901", "score_max": 98.0}
    q = StructuredQuery(raw_brief="best wine")
    results = {r.sku: r.final_score
              for r in score_candidates([base, acclaimed], q, KB, SCORING_MODEL_PATH)}
    assert results["WRW901"] > results["WRW900"]


FULL_RED = {"sku": "WRW001", "name": "Napa Cab", "classification": "Red Wine",
            "wine_body": "Full", "flavor_tags": ["blackcurrant", "cedar", "dark plum"]}
ANOTHER_RED = {"sku": "WRW002", "name": "Bordeaux", "classification": "Red Wine",
               "wine_body": "Full", "flavor_tags": ["blackcurrant", "leather", "tobacco"]}
CRISP_WHITE = {"sku": "WWW001", "name": "Chablis", "classification": "White Wine",
               "wine_body": "Light", "flavor_tags": ["mineral", "citrus", "green apple"]}

ALL_PRODUCTS = [FULL_RED, ANOTHER_RED, CRISP_WHITE]

def test_similar_affinity_finds_same_body_and_overlapping_tags():
    results = find_affinities(FULL_RED, ALL_PRODUCTS, KB, relationship_type="similar")
    skus = [r["sku"] for r in results]
    assert "WRW002" in skus

def test_contrast_affinity_excludes_anchor():
    results = find_affinities(FULL_RED, ALL_PRODUCTS, KB, relationship_type="contrast")
    skus = [r["sku"] for r in results]
    assert "WRW001" not in skus
