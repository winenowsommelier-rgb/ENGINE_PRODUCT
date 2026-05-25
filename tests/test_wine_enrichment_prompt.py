"""Unit tests for data/lib/enrichment/wine/prompt.py."""
from __future__ import annotations

import csv
import json
from pathlib import Path

from data.lib.enrichment.wine import evidence as ev
from data.lib.enrichment.wine import prompt as pr
from data.lib.enrichment.shared.taxonomies import food_pairing


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
SKUS = json.load(open(FIXTURE_DIR / "wine_pilot_skus.json"))
WINESENSED = json.load(open(FIXTURE_DIR / "winesensed_sample.json"))
BRAND_LIB = list(csv.DictReader(open(FIXTURE_DIR / "brand_library_sample.csv")))


def _make_evidence(sku_obj):
    collector = ev.EvidenceCollector(
        winesensed_records=WINESENSED,
        brand_library=BRAND_LIB,
        critic_scores_by_sku={},
    )
    return collector.collect_evidence(sku_obj["sku"], sku_obj)


class TestPromptInjection:
    def test_system_includes_controlled_vocab(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "wine_body" in system
        assert "Light" in system and "Full" in system
        assert "grape_blend_type" in system
        assert "Bordeaux Red Blend" in system
        assert "Conventional" in system
        assert "Grilled red meat" in system

    def test_user_message_includes_product_facts(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "FX-BORDEAUX-001" in user
        assert "Bordeaux" in user
        assert "Cabernet Sauvignon" in user

    def test_user_message_includes_winesensed_when_present(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "Winesensed" in user or "winesensed" in user
        assert "ws-1" in user or "ws-2" in user

    def test_user_message_includes_brand_library_when_present(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "Brand library" in user or "brand library" in user
        assert "Pauillac" in user or "Château Test" in user

    def test_critic_scores_empty_section(self):
        sicily = next(s for s in SKUS if s["sku"] == "FX-SICILIAN-001")
        evidence = _make_evidence(sicily)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "critic scores" in user.lower() or "Expert critic" in user
        # Should NOT contain hallucinated score text
        assert "James Suckling: 95" not in user


class TestPromptHash:
    def test_hash_is_stable_for_same_evidence(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        e = _make_evidence(bordeaux)
        _, _, h1 = pr.build_prompt(e, food_pairing.load_default())
        _, _, h2 = pr.build_prompt(e, food_pairing.load_default())
        assert h1 == h2

    def test_hash_only_depends_on_template_not_evidence(self):
        bordeaux = _make_evidence(next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001"))
        napa = _make_evidence(next(s for s in SKUS if s["sku"] == "FX-NAPACAB-001"))
        _, _, h1 = pr.build_prompt(bordeaux, food_pairing.load_default())
        _, _, h2 = pr.build_prompt(napa, food_pairing.load_default())
        assert h1 == h2


class TestTasteSection:
    """Tests for per-classification taste_profile block in the system prompt."""

    def _load_vocab(self):
        from pathlib import Path
        from data.lib.enrichment.shared.vocab_loader import VocabLoader
        vocab_path = Path(__file__).resolve().parent.parent / "data/lib/enrichment/shared/taste_vocab.yml"
        return VocabLoader.from_path(vocab_path)

    def test_wine_prompt_includes_tiered_schema(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        vocab = self._load_vocab()
        system, user, prompt_hash = pr.build_prompt(
            evidence, food_pairing.load_default(), vocab=vocab, classification="Red Wine"
        )
        assert '"structure": "tiered"' in system
        assert "primary" in system
        assert "secondary" in system
        assert "tertiary" in system
        assert "Blackcurrant" in system
        assert "Citrus Hops" not in system

    def test_beer_prompt_includes_flat_schema(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        vocab = self._load_vocab()
        system, user, prompt_hash = pr.build_prompt(
            evidence, food_pairing.load_default(), vocab=vocab, classification="Beer"
        )
        assert '"structure": "flat"' in system
        assert "flat_tags" in system
        assert "Citrus Hops" in system
        assert "Blackcurrant" not in system
