"""TypedDict definitions for the v2 taste_profile shape."""
from __future__ import annotations

from typing import Literal, Optional, TypedDict, Union


class Note(TypedDict):
    note: str
    intensity: int  # 1 (subtle) | 2 (supporting) | 3 (dominant)


class Tiers(TypedDict):
    primary: list[Note]
    secondary: list[Note]
    tertiary: list[Note]


class TasteProfileTiered(TypedDict):
    schema_version: Literal["2.0"]
    structure: Literal["tiered"]
    tiers: Tiers
    structural: dict[str, Optional[str]]
    confidence: float
    prompt_version: str
    enriched_at: str  # ISO 8601


class TasteProfileFlat(TypedDict):
    schema_version: Literal["2.0"]
    structure: Literal["flat"]
    flat_tags: list[Note]
    structural: dict[str, Optional[str]]
    confidence: float
    prompt_version: str
    enriched_at: str


TasteProfile = Union[TasteProfileTiered, TasteProfileFlat]


CATEGORY_TO_STRUCTURE: dict[str, Literal["tiered", "flat"]] = {
    # Strong-fits (tiered)
    "Red Wine": "tiered", "White Wine": "tiered", "Rosé Wine": "tiered",
    "Sparkling Wine": "tiered", "Champagne": "tiered", "Dessert Wine": "tiered",
    "Port Wine": "tiered", "Orange Wine": "tiered", "Korean Wine": "tiered",
    "Fruit Wine": "tiered",
    "Brandy": "tiered", "Whisky": "tiered", "Cognac": "tiered",
    "Gin": "tiered", "Vodka": "tiered", "Tequila": "tiered",
    "Chinese Spirits": "tiered", "Sake/Shochu": "tiered",
    # Weak-fits (flat)
    "Beer": "flat", "Liqueur": "flat", "Ready to Drink": "flat",
    # Skip (not in this dict — produces None at lookup site, signals "no taste section")
}


CATEGORY_TO_FAMILY: dict[str, str] = {
    # Used by prompt to pick vocab subset (applies_to value)
    "Red Wine": "wine", "White Wine": "wine", "Rosé Wine": "wine",
    "Sparkling Wine": "wine", "Champagne": "wine", "Dessert Wine": "wine",
    "Port Wine": "wine", "Orange Wine": "wine", "Korean Wine": "wine",
    "Fruit Wine": "wine",
    "Brandy": "brown_spirit", "Whisky": "brown_spirit", "Cognac": "brown_spirit",
    "Chinese Spirits": "brown_spirit",  # baijiu often aged; treat as brown family
    "Gin": "white_spirit", "Vodka": "white_spirit", "Tequila": "white_spirit",
    "Sake/Shochu": "white_spirit",
    "Beer": "beer", "Liqueur": "liqueur", "Ready to Drink": "rtd",
}
