"""Loads and indexes the taste-note controlled vocabulary."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml

Tier = Literal["primary", "secondary", "tertiary", "flat"]
Category = Literal["wine", "brown_spirit", "white_spirit", "beer", "liqueur", "rtd"]

REQUIRED_FIELDS = ("name", "default_tier", "family", "applies_to")
VALID_TIERS = {"primary", "secondary", "tertiary", "flat"}


@dataclass(frozen=True)
class CanonicalNote:
    name: str
    default_tier: Tier
    family: str
    aliases: tuple[str, ...]
    applies_to: tuple[Category, ...]


class VocabLoader:
    """Index of canonical taste notes with alias + category lookups.

    Build once at process startup; lookups are O(1).
    """

    def __init__(self, notes: list[CanonicalNote]):
        self._notes_by_name: dict[str, CanonicalNote] = {n.name: n for n in notes}
        # Alias reverse-map: lowercase alias → canonical note. Includes the
        # canonical name itself (lowercased) so lookup is case-insensitive.
        self._by_alias: dict[str, CanonicalNote] = {}
        for n in notes:
            self._by_alias[n.name.lower()] = n
            for a in n.aliases:
                self._by_alias[a.lower()] = n

    @classmethod
    def from_path(cls, path: Path) -> "VocabLoader":
        raw = yaml.safe_load(path.read_text())
        notes_raw = raw.get("notes", [])
        notes: list[CanonicalNote] = []
        for i, entry in enumerate(notes_raw):
            for field in REQUIRED_FIELDS:
                if field not in entry:
                    raise ValueError(f"notes[{i}]: missing required field '{field}'")
            if entry["default_tier"] not in VALID_TIERS:
                raise ValueError(
                    f"notes[{i}] ({entry['name']}): invalid default_tier '{entry['default_tier']}'"
                )
            notes.append(CanonicalNote(
                name=entry["name"],
                default_tier=entry["default_tier"],
                family=entry["family"],
                aliases=tuple(entry.get("aliases") or ()),
                applies_to=tuple(entry["applies_to"]),
            ))
        return cls(notes)

    def lookup(self, name: str) -> CanonicalNote | None:
        """Look up a canonical note by name or alias (case-insensitive)."""
        return self._by_alias.get(name.strip().lower())

    def all_notes(self) -> list[CanonicalNote]:
        return list(self._notes_by_name.values())

    def for_category(self, category: Category) -> set[str]:
        """Return canonical names of notes valid for this category."""
        return {n.name for n in self._notes_by_name.values() if category in n.applies_to}
