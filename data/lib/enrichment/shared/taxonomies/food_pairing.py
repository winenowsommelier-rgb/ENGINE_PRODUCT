"""Loader for food-pairing-taxonomy.json."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FoodCategory:
    id: str
    label: str
    group: str
    wine_style_hint: tuple[str, ...]
    examples: str


@dataclass(frozen=True)
class FoodTaxonomy:
    version: str
    categories: tuple[FoodCategory, ...]

    @property
    def labels(self) -> set[str]:
        return {c.label for c in self.categories}

    def prompt_block(self) -> str:
        """Render the taxonomy as a string for inclusion in the system prompt."""
        lines = []
        current_group: str | None = None
        for c in self.categories:
            if c.group != current_group:
                lines.append(f"\n{c.group}:")
                current_group = c.group
            hint = " / ".join(c.wine_style_hint)
            lines.append(f"  - {c.label} (e.g. {c.examples}; pairs with {hint})")
        return "\n".join(lines)


DEFAULT_PATH = Path(__file__).resolve().parents[4] / "db" / "food-pairing-taxonomy.json"


def load(path: Path | None = None) -> FoodTaxonomy:
    p = path or DEFAULT_PATH
    raw = json.loads(p.read_text())
    cats = tuple(
        FoodCategory(
            id=c["id"],
            label=c["label"],
            group=c["group"],
            wine_style_hint=tuple(c.get("wine_style_hint", [])),
            examples=c.get("examples", ""),
        )
        for c in raw["categories"]
    )
    return FoodTaxonomy(version=raw["version"], categories=cats)


_DEFAULT: FoodTaxonomy | None = None


def load_default() -> FoodTaxonomy:
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = load()
    return _DEFAULT
