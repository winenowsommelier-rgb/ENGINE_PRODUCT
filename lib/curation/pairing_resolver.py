from __future__ import annotations
from lib.curation.models import StructuredQuery, PairingScore
from lib.curation.knowledge_base import PairingKnowledgeBase

_INTENSITY_ORDER = ["light", "medium", "full", "powerful"]


def _resolve_food_signals(context: str, kb: PairingKnowledgeBase) -> list[str]:
    ctx = context.lower().strip()
    for dish in kb.dishes:
        if dish["dish_id"].replace("_", " ") in ctx or dish["label"].lower() in ctx:
            return dish["flavor_signals"]
    for cuisine in kb.cuisines:
        if cuisine["label"].lower() in ctx or cuisine["cuisine_id"] in ctx:
            return cuisine["dominant_signals"]
    return []


def _beverage_intensity(product: dict, kb: PairingKnowledgeBase) -> str | None:
    cls = product.get("classification", "")
    cat_map = kb.intensity_index.get(cls)
    if not cat_map:
        return None
    tiers = []
    if "wine_body" in product and "wine_body" in cat_map:
        t = cat_map["wine_body"].get(product["wine_body"])
        if t:
            tiers.append(t)
    tp = product.get("taste_profile") or {}
    axes = tp.get("axes", {})
    for axis_key, tier_map in cat_map.items():
        if axis_key in axes:
            val = axes[axis_key].get("value")
            t = tier_map.get(val)
            if t:
                tiers.append(t)
    if not tiers:
        return None
    return max(tiers, key=lambda x: _INTENSITY_ORDER.index(x) if x in _INTENSITY_ORDER else 0)


def resolve_pairing(
    query: StructuredQuery,
    candidate: dict,
    kb: PairingKnowledgeBase,
    avoid_tag_rate: float = -0.05,
) -> PairingScore:
    if not query.pairing_context:
        return PairingScore(
            rule_matched=False, pairing_boost=0.0, bridge_bonus=0.0,
            regional_bonus=0.0, intensity_ok=True,
            contraindication_triggered=False, contraindication_penalty=0.0,
            avoid_tag_count=0, avoid_tag_penalty=0.0, matched_rule_ids=[],
        )

    food_signals = _resolve_food_signals(query.pairing_context, kb)
    cls = candidate.get("classification", "")
    flavor_tags = [t.lower() for t in (candidate.get("flavor_tags") or [])]
    country = (candidate.get("country") or "").lower()
    matched_rule_ids = []

    pairing_boost = 0.0
    avoid_tags_hit: list[str] = []
    for rule in kb.food_beverage_rules:
        if not any(sig in food_signals for sig in rule.get("food_signals", [])):
            continue
        bev_cat = rule.get("beverage_category", "")
        if bev_cat.lower() not in cls.lower():
            continue
        rec_axes = rule.get("recommended_axes", {})
        tp = candidate.get("taste_profile") or {}
        axes = tp.get("axes", {})
        axis_hits = 0
        for axis_key, spec in rec_axes.items():
            prod_val = candidate.get(axis_key) or (axes.get(axis_key) or {}).get("value")
            if prod_val and prod_val in spec.get("values", []):
                axis_hits += 1
        if axis_hits > 0 or not rec_axes:
            pairing_boost = max(pairing_boost, rule.get("score_boost", 0.0))
            matched_rule_ids.append(rule["rule_id"])
        avoid_tags_hit += [t for t in rule.get("avoid_flavor_tags", []) if t.lower() in flavor_tags]

    bridge_bonus = 0.0
    ctx_lower = query.pairing_context.lower()

    def _tags_overlap(rule_tags: list[str], prod_tags: list[str]) -> bool:
        """Match if any rule tag is a substring of any product tag or vice-versa."""
        for rt in rule_tags:
            rt_l = rt.lower()
            for pt in prod_tags:
                if rt_l == pt or rt_l in pt or pt in rt_l:
                    return True
        return False

    # Direct ingredient mention in context
    for entry in kb.bridge_ingredient_rules:
        if entry["ingredient"] in ctx_lower:
            if _tags_overlap(entry["matching_flavor_tags"], flavor_tags):
                bridge_bonus = 0.10
                break

    # Bridge via specific dish match
    if bridge_bonus == 0.0:
        for dish in kb.dishes:
            if dish["label"].lower() in ctx_lower or dish["dish_id"].replace("_", " ") in ctx_lower:
                for ingredient in dish.get("bridge_ingredients", []):
                    for entry in kb.bridge_ingredient_rules:
                        if entry["ingredient"] == ingredient:
                            if _tags_overlap(entry["matching_flavor_tags"], flavor_tags):
                                bridge_bonus = 0.10
                                break
                if bridge_bonus > 0:
                    break

    # Bridge via cuisine match — check all dishes of the matched cuisine
    if bridge_bonus == 0.0:
        for cuisine in kb.cuisines:
            if cuisine["label"].lower() in ctx_lower or cuisine["cuisine_id"] in ctx_lower:
                for dish_id in cuisine.get("dishes", []):
                    dish = kb.dish_index.get(dish_id, {})
                    for ingredient in dish.get("bridge_ingredients", []):
                        for entry in kb.bridge_ingredient_rules:
                            if entry["ingredient"] == ingredient:
                                if _tags_overlap(entry["matching_flavor_tags"], flavor_tags):
                                    bridge_bonus = 0.10
                                    break
                        if bridge_bonus > 0:
                            break
                    if bridge_bonus > 0:
                        break
                if bridge_bonus > 0:
                    break

    regional_bonus = 0.0
    for rule in kb.regional_affinity_rules:
        cuisine = kb.cuisine_index.get(rule.get("cuisine_id", ""), {})
        if cuisine.get("label", "").lower() in ctx_lower or rule.get("cuisine_id", "") in ctx_lower:
            if country in [c.lower() for c in rule.get("product_countries", [])]:
                regional_bonus = rule.get("bonus", 0.0)
                break

    intensity_ok = True
    dish_intensity = None
    for dish in kb.dishes:
        if dish["label"].lower() in ctx_lower or dish["dish_id"].replace("_", " ") in ctx_lower:
            dish_intensity = dish.get("intensity")
            break
    if not dish_intensity:
        for cuisine in kb.cuisines:
            if cuisine["label"].lower() in ctx_lower:
                dish_intensity = "medium"
                break
    bev_intensity = _beverage_intensity(candidate, kb)
    if dish_intensity and bev_intensity:
        d_idx = _INTENSITY_ORDER.index(dish_intensity) if dish_intensity in _INTENSITY_ORDER else 1
        b_idx = _INTENSITY_ORDER.index(bev_intensity) if bev_intensity in _INTENSITY_ORDER else 1
        intensity_ok = abs(d_idx - b_idx) <= 1

    contra_triggered = False
    contra_penalty = 0.0
    for rule in kb.contraindication_rules:
        bp = rule.get("beverage_profile", {})
        cls_match = not bp.get("classification") or any(c.lower() in cls.lower() for c in bp["classification"])
        tannin_match = True
        if "wine_tannin" in bp:
            tannin_match = candidate.get("wine_tannin") in bp["wine_tannin"]
        peat_match = True
        if "peat_smoke" in bp:
            tp2 = candidate.get("taste_profile") or {}
            peat_val = (tp2.get("axes", {}).get("peat_smoke") or {}).get("value")
            peat_match = peat_val in bp["peat_smoke"]
        if cls_match and tannin_match and peat_match:
            if any(sig in food_signals for sig in rule.get("food_signals", [])):
                contra_triggered = True
                contra_penalty = min(contra_penalty, rule.get("penalty", 0.0))

    avoid_count = len(set(avoid_tags_hit))
    avoid_penalty = avoid_count * avoid_tag_rate

    return PairingScore(
        rule_matched=pairing_boost > 0,
        pairing_boost=pairing_boost,
        bridge_bonus=bridge_bonus,
        regional_bonus=regional_bonus,
        intensity_ok=intensity_ok,
        contraindication_triggered=contra_triggered,
        contraindication_penalty=contra_penalty,
        avoid_tag_count=avoid_count,
        avoid_tag_penalty=avoid_penalty,
        matched_rule_ids=matched_rule_ids,
    )
