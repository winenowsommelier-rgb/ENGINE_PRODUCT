"""P4 — canonicalize messy `flavor_tags` onto the controlled taste vocabulary.

Rule-based, no API. Maps a single raw flavor tag (e.g. "Subtle oak",
"Vanilla oak", "Cassis") onto canonical note NAMES from `taste_vocab.yml`
via the existing VocabLoader (which the wine-enrichment pipeline already uses).

Layered, deterministic resolution:
  1. Direct VocabLoader.lookup (canonical name or alias, case-insensitive).
  2. Strip pure qualifier words ("subtle", "dried", "toasted"...) then retry
     the whole remaining phrase.
  3. Split the phrase into tokens and look up each remaining token against the
     vocab — captures compound tags like "Vanilla oak" -> [Vanilla, Oak].

Returns canonical names, de-duplicated, first-seen order. Unmappable -> [].
"""
from __future__ import annotations

import re
from typing import List, Optional

from data.lib.enrichment.shared.vocab_loader import VocabLoader

# Pure qualifier / intensity / preparation words that carry no flavor identity
# of their own. Grounded in the actual leading-word distribution of the misses.
# NOTE: deliberately EXCLUDES colour/identity words (dark, white, green, black,
# red, blood, wild, mineral) — those are part of the note and are resolved by
# the compound-split + alias layers instead.
_QUALIFIERS = frozenset({
    "subtle", "dried", "toasted", "candied", "ripe", "crushed", "clean",
    "warm", "light", "soft", "fresh", "roasted", "hint", "hints", "of",
    "a", "touch", "notes", "note", "nuance", "nuances", "undertone",
    "undertones", "overtone", "overtones", "tinged", "laced", "edged",
    "forward", "driven", "tones", "tone", "finish", "palate", "aromas",
    "aroma", "character", "quality",
})

# Tokens to drop when splitting compounds (connectives/punctuation residue).
_CONNECTIVES = frozenset({"and", "with", "of", "&"})

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _normalize(text: str) -> str:
    """Lowercase, collapse punctuation/whitespace to single spaces."""
    return _NON_ALNUM.sub(" ", text.lower()).strip()


def canonicalize_tag(raw: Optional[str], vocab: VocabLoader) -> List[str]:
    """Map one raw flavor tag onto canonical note names. See module docstring."""
    if not raw or not raw.strip():
        return []

    result: List[str] = []

    def add(note_name: str) -> None:
        if note_name not in result:
            result.append(note_name)

    # 1. Direct lookup on the raw tag (handles names + aliases, case-insensitive).
    direct = vocab.lookup(raw)
    if direct is not None:
        add(direct.name)
        return result

    norm = _normalize(raw)
    if not norm:
        return []

    # 2. Strip qualifier words, then retry the whole remaining phrase.
    tokens = [t for t in norm.split() if t]
    kept = [t for t in tokens if t not in _QUALIFIERS and t not in _CONNECTIVES]
    if kept and kept != tokens:
        phrase = " ".join(kept)
        whole = vocab.lookup(phrase)
        if whole is not None:
            add(whole.name)
            return result

    # 3. Compound split — look up each remaining token (and adjacent pairs,
    #    longest-first) against the vocab.
    search = kept if kept else tokens
    i = 0
    n = len(search)
    while i < n:
        matched = False
        # Try a 2-token run first (e.g. "green apple"), then a single token.
        for span in (2, 1):
            if i + span <= n:
                phrase = " ".join(search[i:i + span])
                note = vocab.lookup(phrase)
                if note is not None:
                    add(note.name)
                    i += span
                    matched = True
                    break
        if not matched:
            i += 1

    return result
