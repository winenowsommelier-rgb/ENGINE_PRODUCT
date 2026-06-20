from __future__ import annotations
import json
from pathlib import Path
from lib.curation.models import StructuredQuery, ScoredProduct
from lib.curation.knowledge_base import PairingKnowledgeBase
from lib.curation.pairing_resolver import resolve_pairing

_PRESTIGE_MAP = {"A": 1.0, "B": 0.7, "C": 0.4}
_MARGIN_P10 = 10.0
_MARGIN_P90 = 40.0


def _parse_margin(raw: str | None) -> float:
    if not raw:
        return 0.0
    try:
        return float(str(raw).replace("%", "").strip())
    except ValueError:
        return 0.0


def _normalise_margin(pct: float) -> float:
    if _MARGIN_P90 == _MARGIN_P10:
        return 0.5
    return max(0.0, min(1.0, (pct - _MARGIN_P10) / (_MARGIN_P90 - _MARGIN_P10)))


def _taxonomy_quality(product: dict) -> float:
    fields = ["desc_en_short", "flavor_tags", "region"]
    taste_present = bool(product.get("wine_body")) or bool(product.get("taste_profile"))
    score = sum(1 for f in fields if product.get(f)) / len(fields)
    return (score + (1.0 if taste_present else 0.0)) / 2.0


def _brand_prestige(product: dict) -> float:
    tier = product.get("expert_confidence_tier")
    if tier and tier in _PRESTIGE_MAP:
        return _PRESTIGE_MAP[tier]
    # enrichment_quality_grade (A/B/C) is the best available prestige proxy
    grade = product.get("enrichment_quality_grade")
    if grade and grade in _PRESTIGE_MAP:
        return _PRESTIGE_MAP[grade]
    return min(1.0, float(product.get("taxonomy_confidence") or 0.5))


_WF_FLOOR = 85.0  # scores below this get 0 freshness — minimum credible critic threshold


def _web_freshness(product: dict) -> float:
    raw = product.get("score_max")
    if not raw:
        # Try parsing from score_summary JSON
        summary = product.get("score_summary")
        if summary:
            try:
                data = json.loads(summary)
                critics = data.get("critics", [])
                if critics:
                    raw = max(float(c.get("score_native", 0) or 0) for c in critics)
            except (json.JSONDecodeError, ValueError, TypeError):
                pass
    if not raw:
        return 0.0
    score = float(raw)
    if score < _WF_FLOOR:
        return 0.0
    return min(1.0, (score - _WF_FLOOR) / (100.0 - _WF_FLOOR))


def _taste_match(product: dict, query: StructuredQuery, kb: PairingKnowledgeBase, avoid_tag_rate: float = -0.05) -> float:
    if not query.pairing_context:
        return 0.5
    ps = resolve_pairing(query, product, kb, avoid_tag_rate=avoid_tag_rate)
    return 1.0 if ps.rule_matched else 0.2


def score_candidates(
    candidates: list[dict],
    query: StructuredQuery,
    kb: PairingKnowledgeBase,
    scoring_model_path: Path,
) -> list[ScoredProduct]:
    model = json.loads(scoring_model_path.read_text())
    weights = model["weights"]
    bonuses = model["bonuses"]
    penalties = model["penalties"]

    if query.occasion_id and query.occasion_id in kb.occasion_index:
        overrides = kb.occasion_index[query.occasion_id].get("scoring_weight_overrides", {})
        if overrides:
            weights = dict(weights)
            for key in ("brand_prestige", "taste_match", "margin_signal", "web_freshness"):
                if key in overrides:
                    weights[key] = overrides[key]

    avoid_tag_rate = float(penalties.get("avoid_tag", -0.05))

    results = []
    for p in candidates:
        ps = resolve_pairing(query, p, kb, avoid_tag_rate=avoid_tag_rate)
        tm = _taste_match(p, query, kb, avoid_tag_rate=avoid_tag_rate)
        tq = _taxonomy_quality(p)
        bp = _brand_prestige(p)
        ms = _normalise_margin(_parse_margin(p.get("b2b_margin_pct") or p.get("margin_pct")))
        wf = _web_freshness(p)

        weighted = (
            tm * weights["taste_match"] +
            tq * weights["taxonomy_quality"] +
            bp * weights["brand_prestige"] +
            ms * weights["margin_signal"] +
            wf * weights["web_freshness"]
        )

        raw = (
            weighted
            + ps.pairing_boost
            + ps.bridge_bonus
            + ps.regional_bonus
            + (bonuses["intensity_match"] if ps.intensity_ok else 0.0)
            + ps.contraindication_penalty
            + ps.avoid_tag_penalty
        )

        results.append(ScoredProduct(
            sku=p.get("sku", ""),
            name=p.get("name", ""),
            raw_score=raw,
            rationale="",
            pairing_score=ps,
            matched_rule_ids=ps.matched_rule_ids,
        ))

    results.sort(key=lambda x: x.final_score, reverse=True)
    return results
