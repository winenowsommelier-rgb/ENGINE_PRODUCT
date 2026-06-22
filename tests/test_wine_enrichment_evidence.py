"""Unit tests for data/lib/enrichment/wine/evidence.py."""
from __future__ import annotations

import csv
import json
from pathlib import Path

from data.lib.enrichment.wine import evidence as ev

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
SKUS = json.load(open(FIXTURE_DIR / "wine_pilot_skus.json"))
WINESENSED = json.load(open(FIXTURE_DIR / "winesensed_sample.json"))
BRAND_LIB = list(csv.DictReader(open(FIXTURE_DIR / "brand_library_sample.csv")))


def make_collector(critic_scores=None):
    return ev.EvidenceCollector(
        winesensed_records=WINESENSED,
        brand_library=BRAND_LIB,
        critic_scores_by_sku=critic_scores or {},
    )


class TestWinesensedMatching:
    def test_tight_match_grape_and_region(self):
        c = make_collector()
        matches = c._find_winesensed_matches(grape="Cabernet Sauvignon", region="Bordeaux", country="France", limit=5)
        assert len(matches) == 2  # ws-1 and ws-2
        assert all(m.match_type == "tight" for m in matches)

    def test_loose_match_grape_only(self):
        c = make_collector()
        matches = c._find_winesensed_matches(grape="Cabernet Sauvignon", region="Some Other Region", country="USA", limit=5)
        assert any(m.record_id == "ws-3" for m in matches)
        assert any(m.match_type == "loose" for m in matches)

    def test_country_fallback(self):
        c = make_collector()
        matches = c._find_winesensed_matches(grape="ObscureGrape", region="Sicily", country="Italy", limit=5)
        assert any(m.record_id == "ws-7" for m in matches)


class TestQualityTier:
    def test_tier_a_two_tight_matches(self):
        c = make_collector()
        bordeaux_sku = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = c.collect_evidence(bordeaux_sku["sku"], bordeaux_sku)
        assert evidence.quality_tier == "A"

    def test_tier_for_sicilian(self):
        c = make_collector()
        sicily_sku = next(s for s in SKUS if s["sku"] == "FX-SICILIAN-001")
        evidence = c.collect_evidence(sicily_sku["sku"], sicily_sku)
        # Sicily has 1 Winesensed match (loose grape) and brand library entry
        assert evidence.quality_tier in ("B", "C")


class TestEvidenceHash:
    def test_hash_is_stable(self):
        c = make_collector()
        bordeaux_sku = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        e1 = c.collect_evidence(bordeaux_sku["sku"], bordeaux_sku)
        e2 = c.collect_evidence(bordeaux_sku["sku"], bordeaux_sku)
        assert e1.evidence_hash == e2.evidence_hash

    def test_hash_changes_with_critic_scores(self):
        sku_data = {"sku": "TEST-1", "name": "Test", "brand": "Test", "variety": "Cabernet Sauvignon", "region": "Bordeaux", "country": "France", "classification": "Red Wine", "vintage": "2020", "price": 1000, "bottle_size": "750ml", "alcohol": "13%", "subregion": ""}
        c1 = ev.EvidenceCollector(winesensed_records=[], brand_library=[], critic_scores_by_sku={})
        c2 = ev.EvidenceCollector(winesensed_records=[], brand_library=[], critic_scores_by_sku={
            "TEST-1": [{"critic": "James Suckling", "score": 95.0, "score_max": 100, "vintage": "2020"}]
        })
        e1 = c1.collect_evidence("TEST-1", sku_data)
        e2 = c2.collect_evidence("TEST-1", sku_data)
        assert e1.evidence_hash != e2.evidence_hash


class TestCriticScoresTierBoost:
    def test_two_critic_scores_yields_tier_a(self):
        sku_data = {"sku": "TEST-1", "name": "Test", "brand": "Unknown", "variety": "Unknown", "region": "Unknown", "country": "Unknown", "classification": "Red Wine", "vintage": "2020", "price": 1000, "bottle_size": "750ml", "alcohol": "", "subregion": ""}
        c = ev.EvidenceCollector(winesensed_records=[], brand_library=[], critic_scores_by_sku={
            "TEST-1": [
                {"critic": "James Suckling", "score": 95.0, "score_max": 100, "vintage": "2020"},
                {"critic": "Wine Advocate", "score": 92.0, "score_max": 100, "vintage": "2020"},
            ]
        })
        e = c.collect_evidence("TEST-1", sku_data)
        assert e.quality_tier == "A"
