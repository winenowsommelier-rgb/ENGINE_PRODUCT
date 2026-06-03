from __future__ import annotations
import json
import time
from pathlib import Path
from lib.curation.brief_parser import parse_brief
from lib.curation.hard_filter import hard_filter
from lib.curation.scoring_engine import score_candidates
from lib.curation.rationale_writer import write_rationales
from lib.curation.knowledge_base import load_knowledge_base

_KB_CACHE = None
_KB_PATH = Path("data/lib/pairing_knowledge")
_SCORING_MODEL_PATH = Path("data/lib/curation/curation_scoring_model.json")


def _get_kb():
    global _KB_CACHE
    if _KB_CACHE is None:
        _KB_CACHE = load_knowledge_base(_KB_PATH)
    return _KB_CACHE


def run_curation(
    brief: str,
    products_path: Path | None = None,
    config_path: Path | None = None,
    top_n: int | None = None,
) -> dict:
    t0 = time.time()
    if products_path is None:
        products_path = Path("data/db/products.json")

    products = json.loads(products_path.read_text())
    if isinstance(products, dict):
        products = list(products.values())

    kb = _get_kb()

    query = parse_brief(brief, config_path=config_path)
    if top_n:
        query.output_size = top_n

    candidates = hard_filter(products, query)
    scored = score_candidates(candidates, query, kb, _SCORING_MODEL_PATH)

    top = scored[:query.output_size]
    top = write_rationales(top, candidates, query, config_path=config_path)

    elapsed = round(time.time() - t0, 2)

    return {
        "brief": brief,
        "resolved_query": {
            "category_filter": query.category_filter,
            "country_filter": query.country_filter,
            "pairing_context": query.pairing_context,
            "in_stock_only": query.in_stock_only,
            "output_size": query.output_size,
        },
        "candidate_count": len(candidates),
        "products": [
            {
                "rank": i + 1,
                "sku": sp.sku,
                "name": sp.name,
                "score": sp.final_score,
                "rationale": sp.rationale,
                "contraindication": sp.pairing_score.contraindication_triggered if sp.pairing_score else False,
                "matched_rules": sp.matched_rule_ids,
            }
            for i, sp in enumerate(top)
        ],
        "run_time_s": elapsed,
        "llm_cost_usd": 0.0,
    }
