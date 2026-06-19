"""Tests for P4 flavor-tag canonicalization.

P4 maps the 5,521 messy raw `flavor_tags` values onto the existing controlled
vocabulary (`taste_vocab.yml`, loaded by VocabLoader). The output is a list of
canonical note NAMES (not slugs) so it round-trips through the same vocab the
enrichment pipeline already uses. Rule-based, no API.

The normalizer is a layered, deterministic function:
  1. direct VocabLoader.lookup (name or alias, case-insensitive)
  2. strip leading qualifier words (subtle/dried/toasted/crisp/ripe/...) then retry
  3. split compound tags ("Vanilla oak" -> ["Vanilla", "Oak"]) and look up each token-run
Returns canonical names, de-duplicated, order-stable. Unmappable -> [].
"""
from __future__ import annotations

from pathlib import Path

import pytest

from data.lib.enrichment.shared.vocab_loader import VocabLoader
from data.lib.enrichment.shared.flavor_canonicalizer import canonicalize_tag

VOCAB_PATH = Path(__file__).resolve().parent.parent / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"


@pytest.fixture(scope="module")
def vocab() -> VocabLoader:
    return VocabLoader.from_path(VOCAB_PATH)


def test_exact_canonical_name_maps_to_itself(vocab):
    # "Oak" is a canonical note name in the vocab.
    assert canonicalize_tag("Oak", vocab) == ["Oak"]


def test_case_insensitive(vocab):
    assert canonicalize_tag("oak", vocab) == ["Oak"]
    assert canonicalize_tag("BLACKCURRANT", vocab) == ["Blackcurrant"]


def test_known_alias_maps_to_canonical(vocab):
    # "cassis" is an alias of Blackcurrant in taste_vocab.yml.
    assert canonicalize_tag("Cassis", vocab) == ["Blackcurrant"]


def test_strips_leading_qualifier(vocab):
    # "Subtle oak" has no direct entry; stripping "subtle" yields "oak" -> Oak.
    assert canonicalize_tag("Subtle oak", vocab) == ["Oak"]


def test_strips_dried_qualifier(vocab):
    # "Dried apricot" -> Apricot (Apricot is canonical).
    assert canonicalize_tag("Dried apricot", vocab) == ["Apricot"]


def test_splits_compound_into_multiple_notes(vocab):
    # "Vanilla oak" describes two notes; both are canonical.
    assert canonicalize_tag("Vanilla oak", vocab) == ["Vanilla", "Oak"]


def test_unmappable_returns_empty(vocab):
    assert canonicalize_tag("Quux nonsense xyzzy", vocab) == []


def test_blank_and_none_safe(vocab):
    assert canonicalize_tag("", vocab) == []
    assert canonicalize_tag("   ", vocab) == []
    assert canonicalize_tag(None, vocab) == []


def test_dedupes_and_preserves_order(vocab):
    # A tag that resolves the same note twice must not duplicate it.
    # "Oak oak" -> ["Oak"], not ["Oak","Oak"].
    assert canonicalize_tag("Oak oak", vocab) == ["Oak"]


# --- New aliases added for the high-frequency long-tail misses (P4 coverage) ---
# Each maps to an ALREADY-EXISTING canonical note in taste_vocab.yml.

@pytest.mark.parametrize("raw,expected", [
    # New master notes added for the long-tail (real, distinct aromatic notes).
    ("Graphite", ["Graphite"]),
    ("Pencil lead", ["Graphite"]),
    ("Pomegranate", ["Pomegranate"]),
    ("Black olive", ["Black Olive"]),
    ("Tapenade", ["Black Olive"]),
    ("Coconut", ["Coconut"]),
    ("Toasted coconut", ["Coconut"]),
    # New Caramel note absorbs the sweet/aged sugar family (was unmapped).
    ("Caramel", ["Caramel"]),
    ("Toffee", ["Caramel"]),
    ("Dark toffee", ["Caramel"]),
    ("Butterscotch", ["Caramel"]),
    ("Molasses", ["Caramel"]),
    ("Brown sugar", ["Caramel"]),
])
def test_new_master_notes(vocab, raw, expected):
    assert canonicalize_tag(raw, vocab) == expected


@pytest.mark.parametrize("raw,expected", [
    # Canonical names below are the vocab's true note names: "Herbal" and
    # "Forest Floor" are aliases of Herbaceous / Earth respectively.
    ("Dried herb", ["Herbaceous"]),
    ("Dried herbs", ["Herbaceous"]),
    ("Saline finish", ["Sea Salt"]),
    ("Saline tension", ["Sea Salt"]),
    ("Coastal brine", ["Sea Salt"]),
    ("Candied orange peel", ["Citrus Zest"]),
    ("Dried orange peel", ["Citrus Zest"]),
    ("Orange peel", ["Citrus Zest"]),
    ("Red currant", ["Cranberry"]),  # closest existing red-tart-berry note
    ("Sous-bois", ["Earth"]),
    ("Garrigue", ["Herbaceous"]),
    ("Garrigue herbs", ["Herbaceous"]),
    ("Crushed limestone", ["Wet Stone"]),
])
def test_new_aliases_map_to_existing_notes(vocab, raw, expected):
    assert canonicalize_tag(raw, vocab) == expected
