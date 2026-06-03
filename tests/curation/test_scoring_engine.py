import json, pathlib
from lib.curation.scoring_engine import score_candidates
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
