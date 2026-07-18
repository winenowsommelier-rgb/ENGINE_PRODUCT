# tests/test_compute_reputation.py
"""Unit tests for compute_reputation.py scoring functions.

These tests cover the rule-based logic that must be correct before any
bulk write. They run without a live DB — all inputs are constructed inline.
"""
from __future__ import annotations
import pytest

# Import will fail until compute_reputation.py exists — that is expected.
# Run these tests after Task 3.
from scripts.compute_reputation import (
    prestige_score,
    prestige_confidence,
    acclaim_score_for_sku,
    popularity_percentile,
    composite_score,
    tier_for_composite,
    reputation_summary,
    _compute_producer_signals,
    _load_producer_prestige,
    PRODUCER_PRESTIGE_TIER_SCORES,
)


# ---------------------------------------------------------------------------
# Prestige axis
# ---------------------------------------------------------------------------

class TestPrestigeScore:

    def test_grand_cru_base(self):
        assert prestige_score("Grand Cru", None, 1000, "France", "WRW001") == min(100, 95 + 8)

    def test_grand_cru_with_appellation(self):
        assert prestige_score("Grand Cru", "Burgundy", 1000, "France", "WRW001") == min(100, 95 + 5 + 8)

    def test_grand_cru_capped_at_100(self):
        # Grand Cru (95) + appellation (5) + high price (52) = 152 → capped
        assert prestige_score("Grand Cru", "Burgundy", 200000, "France", "WRW001") == 100

    def test_premier_cru_alias(self):
        # 1er Cru is an alias for Premier Cru — both must score 88
        score_pc = prestige_score("Premier Cru", None, 1000, "France", "WRW001")
        score_1er = prestige_score("1er Cru", None, 1000, "France", "WRW001")
        assert score_pc == score_1er == min(100, 88 + 8)

    def test_gran_reserva_spain_still_wine(self):
        # Spain + still wine type → regulated = 82
        score = prestige_score("Gran Reserva", None, 1000, "Spain", "WRW001")
        assert score == min(100, 82 + 8)

    def test_gran_reserva_argentina_still_wine(self):
        score = prestige_score("Gran Reserva", None, 1000, "Argentina", "WRW001")
        assert score == min(100, 82 + 8)

    def test_gran_reserva_spirits_not_regulated(self):
        # Rum (LRM prefix → Spirits/Rum) → non-regulated = 75. "Gran Reserva"
        # is a legitimate aged-rum designation (Ron Matusalem, Bacardi Gran
        # Reserva Diez are real product lines) so it's still scored, just
        # without the Spain/Argentina still-wine regulation bonus.
        # Regression guard: LSK (Sake & Asian) was wrongly used as the
        # "spirits" fixture here — Gran Reserva must NOT score on sake.
        score = prestige_score("Gran Reserva", None, 1000, "Cuba", "LRM001")
        assert score == min(100, 75 + 8)

    def test_gran_reserva_sake_not_scored(self):
        # Gran Reserva has no legitimate use on Sake & Asian products —
        # any occurrence would be leaked wine/spirits text. Must be ignored,
        # not scored via the non-regulated 75 base.
        score = prestige_score("Gran Reserva", None, 1000, "Japan", "LSK001")
        assert score == min(100, 20 + 8)

    def test_gran_reserva_cava_not_regulated(self):
        # Cava (WCH prefix → Sparkling & Champagne) is NOT in STILL_WINE_TYPES → 75
        score = prestige_score("Gran Reserva", None, 1000, "Spain", "WCH001")
        assert score == min(100, 75 + 8)

    def test_gran_reserva_chile_not_regulated(self):
        # Chilean Gran Reserva → New World wine, not regulated → 75
        score = prestige_score("Gran Reserva", None, 1000, "Chile", "WRW001")
        assert score == min(100, 75 + 8)

    def test_reserva_below_gran_reserva(self):
        # Reserva=70 must be lower than Gran Reserva Spain=82
        reserva = prestige_score("Reserva", None, 1000, "Spain", "WRW001")
        gran_reserva = prestige_score("Gran Reserva", None, 1000, "Spain", "WRW001")
        assert reserva < gran_reserva

    def test_reserva_especial_above_reserva(self):
        # Reserva Especial=74 must be above plain Reserva=70
        especial = prestige_score("Reserva Especial", None, 1000, "Spain", "WRW001")
        plain = prestige_score("Reserva", None, 1000, "Spain", "WRW001")
        assert especial > plain

    def test_reserva_privada_above_reserva(self):
        privada = prestige_score("Reserva Privada", None, 1000, "Argentina", "WRW001")
        plain = prestige_score("Reserva", None, 1000, "Argentina", "WRW001")
        assert privada > plain

    def test_xo_base(self):
        assert prestige_score("XO", None, 1000, "France", "LCO001") == min(100, 75 + 8)

    def test_vsop_below_xo(self):
        xo = prestige_score("XO", None, 1000, "France", "LCO001")
        vsop = prestige_score("VSOP", None, 1000, "France", "LCO001")
        assert vsop < xo

    def test_no_designation_floor_with_high_price(self):
        # No designation: floor 20 + price bonus 52 = 72 (no appellation)
        score = prestige_score(None, None, 200000, "France", "WRW001")
        assert score == 72

    def test_no_designation_with_appellation(self):
        # floor 20 + appellation 5 + price bonus 52 = 77
        score = prestige_score(None, "Pomerol", 200000, "France", "WRW001")
        assert score == 77

    def test_no_designation_cheap(self):
        # floor 20 + price 0 = 20
        score = prestige_score(None, None, 300, "France", "WRW001")
        assert score == 20

    def test_price_bonus_bands(self):
        assert prestige_score(None, None, 499, "France", "WRW001") == 20       # < 500
        assert prestige_score(None, None, 500, "France", "WRW001") == 28       # +8
        assert prestige_score(None, None, 2000, "France", "WRW001") == 42      # +22
        assert prestige_score(None, None, 10000, "France", "WRW001") == 58     # +38
        assert prestige_score(None, None, 50000, "France", "WRW001") == 72     # +52

    def test_multiple_designation_takes_max(self):
        # If a product somehow matches both Premier Cru (88) and Villages (52),
        # implementation must return the max — never sum or average.
        from scripts.compute_reputation import prestige_score_multi
        score = prestige_score_multi(
            ["Premier Cru", "Villages"], None, 1000, "France", "WRW001"
        )
        expected_single = prestige_score("Premier Cru", None, 1000, "France", "WRW001")
        assert score == expected_single

    def test_brut_not_in_designation_table(self):
        # Brut is a dosage level, not a prestige designation.
        # A product with only "Brut" as designation falls to the no-designation floor.
        from scripts.compute_reputation import DESIGNATION_TABLE
        assert "Brut" not in DESIGNATION_TABLE
        assert "Extra Brut" not in DESIGNATION_TABLE

    def test_grand_cru_wine_marketing_text_ignored_on_whisky(self):
        # Regression guard: LWH1034DG "Glendalough Grand Cru Burgundy Cask
        # Finish Single Cask Irish Whiskey" had designation="Grand Cru"
        # (leaked wine-cask-finish marketing text) and scored iconic
        # (94.24). A whisky must never inherit a wine designation score.
        score = prestige_score("Grand Cru", None, 2279, "Ireland", "LWH1034DG")
        assert score == min(100, 20 + 22)  # falls to no-designation floor + price bonus

    def test_grand_cru_burgundy_above_saint_emilion(self):
        # Burgundy Grand Cru (apex of a 5-tier ladder) must score above a
        # Saint-Émilion Grand Cru (that appellation's entry-level tier,
        # below Grand Cru Classé). Distinguished via "St.Emillion"/"Saint
        # Emilion" text in appellation OR name (appellation is often blank
        # in this catalog — verified WRW3496BN carries it only in name).
        burgundy = prestige_score("Grand Cru", "Chablis", 4650, "France", "WWW5292GC",
                                   "Domaine Nathalie & Gilles Fevre Chablis Grand Cru Les Preuses")
        st_emilion = prestige_score("Grand Cru", None, 1400, "France", "WRW3496BN",
                                     "Chateau Teyssier  St.Emillion Grand Cru")
        assert st_emilion < burgundy

    def test_cru_classe_above_plain_grand_cru(self):
        # Bordeaux Cru Classé must rank ABOVE plain Grand Cru — the prior
        # table had this backwards (Cru Classé=82 < Grand Cru=95). Use
        # price=0 to isolate base scores from the shared 100-point cap.
        cru_classe = prestige_score("Cru Classé", None, 0, "France", "WRW001")
        grand_cru = prestige_score("Grand Cru", None, 0, "France", "WRW001")
        assert cru_classe > grand_cru

    def test_rum_gran_reserva_scored_not_gated(self):
        # Confirms the Gran Reserva gate is designation-specific, not a
        # blanket Wine-only rule — real rum product lines (Ron Matusalem,
        # Bacardi Gran Reserva Diez) carry this designation legitimately.
        score = prestige_score("Gran Reserva", None, 1000, "Dominican Republic", "LRM0156CN")
        assert score > 20  # actually scored, not gated to the no-designation floor

    def test_whisky_age_statement_scored_from_name(self):
        # Krug/Macallan-class gap: designation is empty for age-stated
        # whisky, so structured lookup returned 20 (floor) — Macallan 18
        # landed "unrated". Age must now be read from the product name.
        no_age = prestige_score(None, None, 21499, "Scotland", "LWH0668CN", "The Macallan Double Cask")
        with_age = prestige_score(None, None, 21499, "Scotland", "LWH0668CN",
                                   "The Macallan  18 Year Old Double Cask (700 ml)")
        assert with_age > no_age

    def test_older_whisky_age_statement_scores_higher(self):
        aged_12 = prestige_score(None, None, 1000, "Scotland", "LWH001", "Glenlivet 12 Year Old")
        aged_25 = prestige_score(None, None, 1000, "Scotland", "LWH001", "Glenlivet 25 Year Old")
        assert aged_25 > aged_12

    def test_sake_grade_scored_from_name(self):
        # Dassai (Junmai Daiginjo) was "unrated" — no designation vocabulary
        # existed for sake grades. Must now score from product name.
        no_grade = prestige_score(None, None, 2000, "Japan", "LSK0118AB", "Dassai 23")
        daiginjo = prestige_score(None, None, 2000, "Japan", "LSK0118AB",
                                   "Dassai  Junmai Daiginjou Migaki Niwari Sanbu 23")
        assert daiginjo > no_grade

    def test_champagne_prestige_cuvee_scored_from_name(self):
        # Krug Grande Cuvée / Dom Pérignon / Cristal were "unrated" — no
        # designation column entry. Must now score from product name.
        plain = prestige_score(None, None, 12599, "France", "WSP1093AD", "Krug Rose")
        cuvee = prestige_score(None, None, 12599, "France", "WSP1093AD", "Krug  Grande Cuvee (750 ml)")
        assert cuvee > plain


class TestPrestigeConfidence:

    def test_designation_present(self):
        assert prestige_confidence("Grand Cru", None) == pytest.approx(0.9)

    def test_appellation_only(self):
        assert prestige_confidence(None, "Burgundy") == pytest.approx(0.6)

    def test_price_only(self):
        assert prestige_confidence(None, None) == pytest.approx(0.4)


# ---------------------------------------------------------------------------
# Acclaim axis
# ---------------------------------------------------------------------------

class TestAcclaimScore:

    def test_no_scores_returns_null(self):
        score, conf, note = acclaim_score_for_sku("NOSCORE001", [])
        assert score is None
        assert conf == 0.0

    def test_single_critic_percentile(self):
        # SKU with one critic score at 100th percentile within that critic → 100
        critic_rows = [{"sku": "WRW001", "critic": "WS", "score": 95.0, "pct": 100.0}]
        score, conf, note = acclaim_score_for_sku("WRW001", critic_rows)
        assert score == pytest.approx(100.0)
        assert conf == pytest.approx(1/3)  # 1 critic → min(1.0, 1/3)

    def test_three_critics_saturates_confidence(self):
        critic_rows = [
            {"sku": "WRW001", "critic": "WS", "score": 95.0, "pct": 90.0},
            {"sku": "WRW001", "critic": "RP", "score": 94.0, "pct": 85.0},
            {"sku": "WRW001", "critic": "JR", "score": 93.0, "pct": 80.0},
        ]
        score, conf, note = acclaim_score_for_sku("WRW001", critic_rows)
        assert conf == pytest.approx(1.0)  # min(1.0, 3/3)

    def test_duplicate_critic_uses_max(self):
        # Same critic, two vintage rows — must aggregate to MAX(score) before percentile.
        critic_rows = [
            {"sku": "WRW001", "critic": "WS", "score": 95.0, "pct": 90.0},
            {"sku": "WRW001", "critic": "WS", "score": 88.0, "pct": 70.0},  # same critic, lower
        ]
        score, conf, note = acclaim_score_for_sku("WRW001", critic_rows)
        # Should use the pct from max(score) = 95.0 → pct 90.0, not average of 90+70
        assert score == pytest.approx(90.0)
        assert conf == pytest.approx(1/3)  # still only 1 distinct critic


# ---------------------------------------------------------------------------
# Popularity axis
# ---------------------------------------------------------------------------

class TestPopularityPercentile:

    def test_null_sold_qty_treated_as_zero(self):
        # ~5,804 active SKUs have NULL sold_qty — must not crash or assign 0.8 confidence
        skus = [
            {"sku": "WRW001", "sold_qty": None, "sold_orders": None},
            {"sku": "WRW002", "sold_qty": 10,   "sold_orders": 5},
            {"sku": "WRW003", "sold_qty": 5,    "sold_orders": 2},
        ]
        result = popularity_percentile(skus)
        # WRW001 has demand=0 → should get 0.3 confidence (no sales)
        assert result["WRW001"]["confidence"] == pytest.approx(0.3)
        assert result["WRW002"]["confidence"] == pytest.approx(0.8)

    def test_singleton_prefix_falls_back_to_letter_family(self):
        # A group with 1 SKU should not return an arbitrary 0 or 100.
        skus = [
            {"sku": "ZZZ001", "sold_qty": 5, "sold_orders": 2},
            {"sku": "WRW001", "sold_qty": 10, "sold_orders": 5},
            {"sku": "WRW002", "sold_qty": 3,  "sold_orders": 1},
            {"sku": "WRW003", "sold_qty": 1,  "sold_orders": 0},
        ]
        result = popularity_percentile(skus)
        # ZZZ001 is a singleton in ZZZ; falls back to Z* family
        assert 0 <= result["ZZZ001"]["score"] <= 100

    def test_tied_zero_demand_gets_same_score_not_rowid_order(self):
        # Regression guard: 91% of active SKUs have zero demand. Before the
        # mid-rank fix, a stable sort on equal keys let insertion (rowid)
        # order assign them arbitrary scores spanning 0-100. They must now
        # all share the SAME mid-rank score.
        skus = [{"sku": f"WRW{i:03d}", "sold_qty": 0, "sold_orders": 0} for i in range(8)]
        result = popularity_percentile(skus)
        scores = {result[s["sku"]]["score"] for s in skus}
        assert len(scores) == 1, f"tied zero-demand SKUs got different scores: {scores}"

    def test_demand_floor_gates_confidence_and_copy(self):
        # A 1-2 unit sale must not unlock "Top X% by sales" language or the
        # 0.8 confidence bump — 428 products shipped false "Top 4%" copy off
        # 1-2 bottles sold before this floor existed.
        skus = [
            {"sku": "WRW001", "sold_qty": 2,  "sold_orders": 0},  # below floor (5)
            {"sku": "WRW002", "sold_qty": 10, "sold_orders": 0},  # above floor
            {"sku": "WRW003", "sold_qty": 0,  "sold_orders": 0},
        ]
        result = popularity_percentile(skus)
        assert result["WRW001"]["confidence"] == pytest.approx(0.3)
        assert result["WRW001"]["source_note"] == ""
        assert result["WRW002"]["confidence"] == pytest.approx(0.8)
        assert result["WRW002"]["source_note"] != ""


# ---------------------------------------------------------------------------
# Composite and tier
# ---------------------------------------------------------------------------

class TestCompositeScore:

    def test_all_axes_present(self):
        axes = {
            "acclaim":    {"score": 80.0, "confidence": 1.0},
            "prestige":   {"score": 90.0, "confidence": 0.9},
            "popularity": {"score": 70.0, "confidence": 0.8},
            "producer":   {"score": 75.0, "confidence": 0.7},
        }
        c = composite_score(axes)
        assert 70 < c < 95  # sanity range

    def test_zero_denominator_returns_none(self):
        axes = {
            "acclaim":    {"score": None, "confidence": 0.0},
            "prestige":   {"score": None, "confidence": 0.0},
            "popularity": {"score": None, "confidence": 0.0},
            "producer":   {"score": None, "confidence": 0.0},
        }
        assert composite_score(axes) is None

    def test_acclaim_null_excluded_from_numerator(self):
        # If acclaim score is None, its contribution should be zero (not None * weight)
        axes = {
            "acclaim":    {"score": None, "confidence": 0.0},
            "prestige":   {"score": 80.0, "confidence": 0.9},
            "popularity": {"score": 50.0, "confidence": 0.8},
            "producer":   {"score": 60.0, "confidence": 0.7},
        }
        c = composite_score(axes)
        assert c is not None
        assert c > 0


class TestTierForComposite:

    def test_iconic(self):
        assert tier_for_composite(85.0, 0.8) == "iconic"

    def test_premium(self):
        assert tier_for_composite(65.0, 0.8) == "premium"
        assert tier_for_composite(84.9, 0.8) == "premium"

    def test_established(self):
        assert tier_for_composite(40.0, 0.8) == "established"

    def test_everyday(self):
        assert tier_for_composite(1.0, 0.8) == "everyday"

    def test_none_composite_is_unrated(self):
        assert tier_for_composite(None, 0.0) == "unrated"

    def test_low_confidence_is_unrated(self):
        assert tier_for_composite(75.0, 0.29) == "unrated"

    def test_override_respected(self):
        # If reputation_override is set, use it regardless of computed score
        assert tier_for_composite(85.0, 0.9, override="everyday") == "everyday"

    def test_invalid_override_ignored(self):
        # Typo in override must be ignored (logged, not written)
        assert tier_for_composite(85.0, 0.9, override="icnoic") == "iconic"

    def test_iconic_requires_acclaim(self):
        # Regression guard: 181/199 iconic SKUs had zero critic acclaim
        # (e.g. a ฿900 Chilean Gran Reserva, 2 bottles sold, 0 reviews,
        # composite 85.45, tiered "iconic"). A high score without acclaim
        # corroboration must cap at premium.
        assert tier_for_composite(85.0, 0.8, has_acclaim=False) == "premium"
        assert tier_for_composite(99.0, 0.9, has_acclaim=False) == "premium"
        assert tier_for_composite(85.0, 0.8, has_acclaim=True) == "iconic"

    def test_acclaim_gate_does_not_affect_lower_tiers(self):
        # The gate only caps the iconic threshold; premium/established/
        # everyday classification is unaffected by has_acclaim.
        assert tier_for_composite(65.0, 0.8, has_acclaim=False) == "premium"
        assert tier_for_composite(40.0, 0.8, has_acclaim=False) == "established"
        assert tier_for_composite(1.0, 0.8, has_acclaim=False) == "everyday"

    def test_override_beats_acclaim_gate(self):
        # An explicit human override still wins even without acclaim.
        assert tier_for_composite(85.0, 0.9, override="iconic", has_acclaim=False) == "iconic"


# ---------------------------------------------------------------------------
# Summary copy
# ---------------------------------------------------------------------------

class TestReputationSummary:

    def test_acclaim_leads_when_high(self):
        axes = {
            "acclaim":    {"score": 75.0, "confidence": 0.7, "source_note": "Rated in the top 12% by Wine Spectator."},
            "prestige":   {"score": 90.0, "confidence": 0.9, "source_note": "Grand Cru, Burgundy."},
            "popularity": {"score": 30.0, "confidence": 0.8, "source_note": ""},
            "producer":   {"score": 60.0, "confidence": 0.5, "source_note": ""},
        }
        summary = reputation_summary(axes)
        assert "top" in summary.lower() and "spectator" in summary.lower()

    def test_designation_leads_when_no_acclaim(self):
        axes = {
            "acclaim":    {"score": None, "confidence": 0.0, "source_note": ""},
            "prestige":   {"score": 90.0, "confidence": 0.9, "source_note": "Grand Cru, Burgundy."},
            "popularity": {"score": 30.0, "confidence": 0.8, "source_note": ""},
            "producer":   {"score": 60.0, "confidence": 0.5, "source_note": ""},
        }
        summary = reputation_summary(axes)
        assert summary is not None
        assert "Grand Cru" in summary or "Burgundy" in summary

    def test_fallback_is_none_not_empty_string(self):
        # Rule: store NULL, not "". UI checks `if (product.reputation_summary)`.
        axes = {
            "acclaim":    {"score": 20.0, "confidence": 0.3, "source_note": ""},
            "prestige":   {"score": 20.0, "confidence": 0.4, "source_note": ""},
            "popularity": {"score": 20.0, "confidence": 0.3, "source_note": ""},
            "producer":   {"score": 20.0, "confidence": 0.3, "source_note": ""},
        }
        summary = reputation_summary(axes)
        assert summary is None


# ---------------------------------------------------------------------------
# Producer prestige (curated brand overrides — Phase C, 2026-07-10)
# ---------------------------------------------------------------------------

class TestProducerPrestigeLoader:

    def test_loads_real_seed_file(self):
        # Regression guard: the live data/taxonomy/producer_prestige.json must
        # parse and every entry's tier must be a known tier (loader raises
        # KeyError otherwise — this test would fail loudly on a typo).
        curated = _load_producer_prestige()
        assert len(curated) > 50, "expected the seeded curated list to have entries"
        assert "Krug" in curated
        assert "The Macallan" in curated

    def test_metadata_keys_excluded(self):
        curated = _load_producer_prestige()
        assert "_comment" not in curated
        assert "_tiers" not in curated

    def test_unknown_tier_raises(self, tmp_path, monkeypatch):
        import json
        import scripts.compute_reputation as cr
        bad_file = tmp_path / "bad_producer_prestige.json"
        bad_file.write_text(json.dumps({"Some Brand": {"tier": "not_a_real_tier"}}))
        monkeypatch.setattr(cr, "PRODUCER_PRESTIGE_PATH", bad_file)
        _load_producer_prestige.cache_clear()
        try:
            with pytest.raises(KeyError):
                _load_producer_prestige()
        finally:
            _load_producer_prestige.cache_clear()  # don't poison other tests' cache

    def test_missing_file_returns_empty_dict(self, tmp_path, monkeypatch):
        import scripts.compute_reputation as cr
        monkeypatch.setattr(cr, "PRODUCER_PRESTIGE_PATH", tmp_path / "does_not_exist.json")
        _load_producer_prestige.cache_clear()
        try:
            assert _load_producer_prestige() == {}
        finally:
            _load_producer_prestige.cache_clear()


class TestComputeProducerSignals:

    def test_curated_brand_overrides_circular_self_average(self):
        # Regression guard: before this existed, a single-SKU brand's
        # "producer" signal just echoed its own prestige score back — zero
        # independent information. Krug (curated "reference" tier = 97) must
        # now get that score regardless of its own prestige/acclaim scores.
        skus = [{"sku": "WSP1093AD", "brand": "Krug"}]
        signals = [
            {"sku": "WSP1093AD", "axis": "prestige", "score": 40, "confidence": 0.4},
        ]
        _compute_producer_signals(skus, signals, "2026-07-10T00:00:00")
        producer = [s for s in signals if s["axis"] == "producer"][0]
        assert producer["method"] == "curated-producer-prestige"
        assert producer["score"] == PRODUCER_PRESTIGE_TIER_SCORES["reference"]
        assert producer["score"] != 40  # did NOT echo its own low prestige score
        assert producer["confidence"] == pytest.approx(0.85)

    def test_uncurated_brand_keeps_brand_average_behavior(self):
        # Non-curated brands must be byte-for-byte unaffected by this feature.
        skus = [{"sku": "WRW0001ZZ", "brand": "Some Obscure Label"}]
        signals = [
            {"sku": "WRW0001ZZ", "axis": "prestige", "score": 40, "confidence": 0.4},
        ]
        _compute_producer_signals(skus, signals, "2026-07-10T00:00:00")
        producer = [s for s in signals if s["axis"] == "producer"][0]
        assert producer["method"] == "brand-avg-acclaim-prestige"
        assert producer["score"] == 40.0

    def test_curated_multi_sku_brand_all_get_same_score(self):
        skus = [
            {"sku": "LWH0001AA", "brand": "The Macallan"},
            {"sku": "LWH0002AA", "brand": "The Macallan"},
        ]
        signals = [
            {"sku": "LWH0001AA", "axis": "prestige", "score": 20, "confidence": 0.4},
            {"sku": "LWH0002AA", "axis": "prestige", "score": 90, "confidence": 0.9},
        ]
        _compute_producer_signals(skus, signals, "2026-07-10T00:00:00")
        producer_scores = {s["sku"]: s["score"] for s in signals if s["axis"] == "producer"}
        assert producer_scores["LWH0001AA"] == producer_scores["LWH0002AA"] == PRODUCER_PRESTIGE_TIER_SCORES["reference"]

    def test_source_note_mentions_curated(self):
        skus = [{"sku": "WSP1093AD", "brand": "Krug"}]
        signals = [{"sku": "WSP1093AD", "axis": "prestige", "score": 40, "confidence": 0.4}]
        _compute_producer_signals(skus, signals, "2026-07-10T00:00:00")
        producer = [s for s in signals if s["axis"] == "producer"][0]
        assert "curated" in producer["source_note"].lower()
        assert "Krug" in producer["source_note"]
