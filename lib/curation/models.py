from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class StructuredQuery:
    raw_brief: str
    category_filter: list[str] = field(default_factory=list)
    subcategory_filter: list[str] = field(default_factory=list)
    country_filter: list[str] = field(default_factory=list)
    region_filter: list[str] = field(default_factory=list)
    score_threshold: Optional[float] = None
    price_min_thb: Optional[float] = None
    price_max_thb: Optional[float] = None
    prefer_high_margin: bool = False
    in_stock_only: bool = True
    pairing_context: Optional[str] = None
    course_position: Optional[str] = None
    occasion_id: Optional[str] = None
    menu_tier: Optional[str] = None
    output_size: int = 12
    audience: list[str] = field(default_factory=list)


@dataclass
class PairingScore:
    rule_matched: bool
    pairing_boost: float
    bridge_bonus: float
    regional_bonus: float
    intensity_ok: bool
    contraindication_triggered: bool
    contraindication_penalty: float
    avoid_tag_count: int
    avoid_tag_penalty: float
    matched_rule_ids: list[str]

    @property
    def total_bonus(self) -> float:
        return self.pairing_boost + self.bridge_bonus + self.regional_bonus + (0.10 if self.intensity_ok else 0.0)

    @property
    def total_penalty(self) -> float:
        return self.contraindication_penalty + self.avoid_tag_penalty


@dataclass
class ScoredProduct:
    sku: str
    name: str
    raw_score: float
    rationale: str
    pairing_score: Optional[PairingScore] = None
    web_signal: Optional[float] = None
    matched_rule_ids: list[str] = field(default_factory=list)

    @property
    def final_score(self) -> int:
        return int(min(max(self.raw_score, 0.0), 1.0) * 100)
