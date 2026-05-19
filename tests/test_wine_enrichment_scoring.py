"""Unit tests for data/lib/enrichment/wine/scoring.py."""
from __future__ import annotations

import pytest
from data.lib.enrichment.wine import scoring as s


class TestFormula:
    def test_tier_a_passed_high_conf(self):
        assert s.final_confidence(0.95, "A", "passed") == pytest.approx(0.95)

    def test_tier_b_repaired_mid_conf(self):
        result = s.final_confidence(0.90, "B", "repaired")
        assert result == pytest.approx(0.7695, abs=0.001)

    def test_tier_c_passed_low_conf(self):
        result = s.final_confidence(0.80, "C", "passed")
        assert result == pytest.approx(0.60, abs=0.001)

    def test_retried_validator(self):
        result = s.final_confidence(0.95, "A", "failed_then_retried")
        assert result == pytest.approx(0.8075, abs=0.001)


class TestRouting:
    def test_above_threshold_direct_write(self):
        assert s.should_direct_write(0.86, threshold=0.85) is True

    def test_at_threshold_direct_write(self):
        assert s.should_direct_write(0.85, threshold=0.85) is True

    def test_below_threshold_csv_only(self):
        assert s.should_direct_write(0.84, threshold=0.85) is False


class TestBounds:
    def test_clamps_to_zero(self):
        assert s.final_confidence(-0.1, "A", "passed") == 0.0

    def test_clamps_to_one(self):
        assert s.final_confidence(1.5, "A", "passed") == 1.0
