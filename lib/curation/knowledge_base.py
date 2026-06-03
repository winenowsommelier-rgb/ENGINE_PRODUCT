from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class PairingKnowledgeBase:
    flavor_signals: list[dict]
    cuisines: list[dict]
    dishes: list[dict]
    intensity_map: list[dict]
    food_beverage_rules: list[dict]
    contraindication_rules: list[dict]
    regional_affinity_rules: list[dict]
    bridge_ingredient_rules: list[dict]
    course_positions: list[dict]
    occasion_profiles: list[dict]
    service_context: list[dict]
    product_affinity_rules: list[dict]

    signal_index: dict = field(default_factory=dict)
    cuisine_index: dict = field(default_factory=dict)
    dish_index: dict = field(default_factory=dict)
    occasion_index: dict = field(default_factory=dict)
    course_index: dict = field(default_factory=dict)
    intensity_index: dict = field(default_factory=dict)

    def __post_init__(self):
        self.signal_index = {s["signal_id"]: s for s in self.flavor_signals}
        self.cuisine_index = {c["cuisine_id"]: c for c in self.cuisines}
        self.dish_index = {d["dish_id"]: d for d in self.dishes}
        self.occasion_index = {o["occasion_id"]: o for o in self.occasion_profiles}
        self.course_index = {c["course_id"]: c for c in self.course_positions}
        for cat_entry in self.intensity_map:
            cat = cat_entry["category"]
            self.intensity_index[cat] = {}
            for mapping in cat_entry["axis_mappings"]:
                self.intensity_index[cat][mapping["axis"]] = mapping["tier_map"]


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return data if isinstance(data, list) else [data]


def load_knowledge_base(base: Path) -> PairingKnowledgeBase:
    ft = base / "food_taxonomy"
    bv = base / "beverage_profiles"
    ru = base / "rules"
    cx = base / "contexts"
    return PairingKnowledgeBase(
        flavor_signals=_load(ft / "flavor_signals.json"),
        cuisines=_load(ft / "cuisines.json"),
        dishes=_load(ft / "dishes.json"),
        intensity_map=_load(bv / "intensity_map.json"),
        food_beverage_rules=_load(ru / "food_beverage_rules.json"),
        contraindication_rules=_load(ru / "contraindication_rules.json"),
        regional_affinity_rules=_load(ru / "regional_affinity_rules.json"),
        bridge_ingredient_rules=_load(ru / "bridge_ingredient_rules.json"),
        course_positions=_load(cx / "course_positions.json"),
        occasion_profiles=_load(cx / "occasion_profiles.json"),
        service_context=_load(cx / "service_context.json"),
        product_affinity_rules=_load(base / "product_affinity_rules.json"),
    )
