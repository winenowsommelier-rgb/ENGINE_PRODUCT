"""Tests for the P4 export-writer transform.

`add_canonical_flavors(product, vocab)` returns a NEW product dict with a
`flavor_tags_canonical` list (canonical note names, de-duped across all the
product's raw tags). It MUST NOT mutate or remove the original `flavor_tags`
(Rule 9 / reversibility — display text stays untouched). Idempotent: running
twice yields the same result.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from data.lib.enrichment.shared.vocab_loader import VocabLoader
from scripts.apply_flavor_canonical import add_canonical_flavors

VOCAB_PATH = Path(__file__).resolve().parent.parent / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"


@pytest.fixture(scope="module")
def vocab() -> VocabLoader:
    return VocabLoader.from_path(VOCAB_PATH)


def test_adds_canonical_field_from_raw_tags(vocab):
    p = {"sku": "X1", "flavor_tags": ["Subtle oak", "Cassis"]}
    out = add_canonical_flavors(p, vocab)
    assert out["flavor_tags_canonical"] == ["Oak", "Blackcurrant"]


def test_original_flavor_tags_untouched(vocab):
    p = {"sku": "X1", "flavor_tags": ["Vanilla oak"]}
    out = add_canonical_flavors(p, vocab)
    assert out["flavor_tags"] == ["Vanilla oak"]  # display text preserved


def test_dedupes_across_tags(vocab):
    # Two raw tags that both resolve to Oak must yield Oak once.
    p = {"sku": "X1", "flavor_tags": ["Subtle oak", "Toasted oak"]}
    out = add_canonical_flavors(p, vocab)
    assert out["flavor_tags_canonical"] == ["Oak"]


def test_missing_flavor_tags_yields_empty_canonical(vocab):
    p = {"sku": "X1"}
    out = add_canonical_flavors(p, vocab)
    assert out["flavor_tags_canonical"] == []


def test_empty_flavor_tags_yields_empty_canonical(vocab):
    p = {"sku": "X1", "flavor_tags": []}
    out = add_canonical_flavors(p, vocab)
    assert out["flavor_tags_canonical"] == []


def test_idempotent(vocab):
    p = {"sku": "X1", "flavor_tags": ["Vanilla oak"]}
    once = add_canonical_flavors(p, vocab)
    twice = add_canonical_flavors(once, vocab)
    assert twice["flavor_tags_canonical"] == once["flavor_tags_canonical"]
    assert twice["flavor_tags"] == ["Vanilla oak"]


def test_does_not_mutate_input(vocab):
    p = {"sku": "X1", "flavor_tags": ["Cassis"]}
    add_canonical_flavors(p, vocab)
    assert "flavor_tags_canonical" not in p  # input dict unchanged
