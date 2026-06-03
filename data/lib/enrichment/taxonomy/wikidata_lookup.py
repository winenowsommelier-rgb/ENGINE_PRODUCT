"""Wikidata appellation lookup for taxonomy enrichment.

Loads a pre-built JSON cache of wine appellations. Performs fuzzy token
matching against product names to infer region/subregion. No network calls
at runtime — purely offline.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Optional

_CACHE_FILE = Path(__file__).parent / "wikidata_appellations.json"

_APPELLATIONS: list[dict] = []
_INDEX: dict[str, list[dict]] = {}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9\s]", " ", s.lower()).strip()


def _tokenize(s: str) -> list[str]:
    return [t for t in _norm(s).split() if len(t) >= 3]


def _build_index() -> None:
    _INDEX.clear()
    for appellation in _APPELLATIONS:
        name = appellation.get("name", "")
        for token in _tokenize(name):
            _INDEX.setdefault(token, []).append(appellation)


def _load() -> None:
    global _APPELLATIONS
    if not _CACHE_FILE.exists():
        _APPELLATIONS = []
        _build_index()
        return
    try:
        _APPELLATIONS = json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        _APPELLATIONS = []
    _build_index()


_load()


def lookup(name: str, classification: str) -> dict:
    """Return best Wikidata match for the product name."""
    empty = {"region": "", "subregion": "", "country": "", "confidence": 0.0, "wikidata_id": "", "source": ""}
    if not _APPELLATIONS:
        return empty

    name_tokens = set(_tokenize(name))
    best: Optional[dict] = None
    best_score = 0.0

    for token in name_tokens:
        for appellation in _INDEX.get(token, []):
            app_name_tokens = set(_tokenize(appellation["name"]))
            if not app_name_tokens:
                continue
            overlap = len(app_name_tokens & name_tokens)
            score = overlap / len(app_name_tokens)
            if score > best_score:
                best_score = score
                best = appellation

    if best is None or best_score < 0.7:
        return empty

    confidence = round(min(0.95, 0.85 + (best_score - 0.7) * 0.5), 2)

    return {
        "region":      best.get("region", ""),
        "subregion":   best.get("subregion", ""),
        "country":     best.get("country", ""),
        "confidence":  confidence,
        "wikidata_id": best.get("wikidata_id", ""),
        "source":      "wikidata",
    }
