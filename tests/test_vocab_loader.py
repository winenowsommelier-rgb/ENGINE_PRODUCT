"""Tests for the taste vocab YAML loader."""
from pathlib import Path

import pytest

from data.lib.enrichment.shared.vocab_loader import VocabLoader, CanonicalNote

FIXTURE = Path(__file__).parent / "fixtures" / "taste_vocab_min.yml"


def test_loads_all_notes():
    loader = VocabLoader.from_path(FIXTURE)
    assert len(loader.all_notes()) == 4


def test_lookup_canonical_name():
    loader = VocabLoader.from_path(FIXTURE)
    note = loader.lookup("Blackcurrant")
    assert note is not None
    assert note.name == "Blackcurrant"
    assert note.default_tier == "primary"
    assert note.family == "fruit.black"


def test_lookup_alias():
    loader = VocabLoader.from_path(FIXTURE)
    assert loader.lookup("cassis").name == "Blackcurrant"
    assert loader.lookup("Cassis").name == "Blackcurrant"  # case-insensitive
    assert loader.lookup("black currant").name == "Blackcurrant"


def test_lookup_unknown_returns_none():
    loader = VocabLoader.from_path(FIXTURE)
    assert loader.lookup("Dragonfruit") is None


def test_for_category_filters():
    loader = VocabLoader.from_path(FIXTURE)
    wine_notes = loader.for_category("wine")
    assert "Blackcurrant" in wine_notes
    assert "Cedar" in wine_notes
    assert "Citrus Hops" not in wine_notes

    beer_notes = loader.for_category("beer")
    assert "Citrus Hops" in beer_notes
    assert "Blackcurrant" not in beer_notes


def test_invalid_yaml_raises():
    bad = Path(__file__).parent / "fixtures" / "_bad_vocab.yml"
    bad.write_text("notes:\n  - name: NoTier\n    family: fruit\n    applies_to: [wine]")
    try:
        with pytest.raises(ValueError, match="default_tier"):
            VocabLoader.from_path(bad)
    finally:
        bad.unlink()
