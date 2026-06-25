import json
from lib.critic_reviews.refresh_products_summary import merge_for_sku, build_summary, abbr_for

# NOTE: rows have NO abbr key — abbr is derived later, never carried on the row.
def _row(critic, score, conf, tier=1, scale="100pt", native=None,
         fetched="2026-01-01T00:00:00Z", source="magento_csv", added_by="magento_csv_2026-06-15"):
    return {"critic": critic, "score": score, "confidence": conf, "signal_tier": tier,
            "score_scale": scale, "score_native": native or str(int(score)),
            "fetched_at": fetched, "source": source, "added_by": added_by}

def test_curated_beats_scraped_same_critic_scale():
    rows = [_row("Wine Spectator", 90.0, 1.0, native="90"),
            _row("Wine Spectator", 93.0, 0.6, native="93")]  # scraped, higher score
    winners = merge_for_sku(rows)
    assert len(winners) == 1
    assert winners[0]["score"] == 90.0  # curated wins despite lower score

def test_tie_confidence_recency_wins():
    rows = [_row("WineAlign", 88.0, 1.0, fetched="2026-01-01T00:00:00Z"),
            _row("WineAlign", 91.0, 1.0, fetched="2026-06-01T00:00:00Z")]
    winners = merge_for_sku(rows)
    assert winners[0]["score"] == 91.0  # most recent

def test_low_confidence_excluded_from_badge():
    rows = [_row("Distiller", 92.0, 0.4)]  # below 0.5 threshold
    winners = merge_for_sku(rows)
    assert winners == []

def test_distinct_critics_all_kept():
    rows = [_row("James Suckling", 91.0, 1.0), _row("Wine Spectator", 90.0, 1.0)]
    winners = merge_for_sku(rows)
    assert {w["critic"] for w in winners} == {"James Suckling", "Wine Spectator"}

def test_second_dedup_on_critic_score_native():
    # same critic, SAME scale, SAME native, two rows -> collapse to one
    rows = [_row("Wine Spectator", 90.0, 1.0, native="90", fetched="2026-01-01T00:00:00Z"),
            _row("Wine Spectator", 90.0, 1.0, native="90", fetched="2026-06-01T00:00:00Z")]
    winners = merge_for_sku(rows)
    assert len(winners) == 1

def test_abbr_map_canonical_and_fallback():
    assert abbr_for("Wine Enthusiast") == "WE"
    assert abbr_for("Wine Advocate") == "WA"
    assert abbr_for("Wine Spectator") == "WS"
    assert abbr_for("James Suckling") == "JS"
    assert abbr_for("Natalie MacLean") == "NM"
    assert abbr_for("The Real Review") == "TRR"

def test_build_summary_shape_and_score_max():
    winners = [_row("James Suckling", 91.0, 1.0, native="91"),
               _row("Wine Spectator", 90.0, 1.0, native="90")]
    score_max, summary_json = build_summary(winners)
    assert score_max == 91.0
    data = json.loads(summary_json)
    assert [c["abbr"] for c in data["critics"]] == ["JS", "WS"]
    assert data["critics"][0] == {"abbr": "JS", "critic": "James Suckling",
                                  "score_native": "91", "score_value": 91.0}
    assert data["community"] == [] and data["medals"] == []
    assert data["primary_source"] == "magento_csv_2026-06-15"
    assert data["rows_total"] == 2
    assert "computed_at" in data

def test_primary_source_falls_back_to_source_when_no_added_by():
    winners = [_row("Distiller", 92.0, 0.6, source="distiller", added_by=None)]
    _, summary_json = build_summary(winners)
    assert json.loads(summary_json)["primary_source"] == "distiller"

def test_score_max_excludes_tier3_plus():
    winners = [_row("Wine Spectator", 90.0, 1.0, tier=1, native="90"),
               _row("CommunityAvg", 95.0, 0.7, tier=3, scale="community", native="95")]
    score_max, _ = build_summary(winners)
    assert score_max == 90.0

def test_caps_at_five_critics():
    winners = [_row(f"Critic{i}", 80.0 + i, 1.0) for i in range(8)]
    _, summary_json = build_summary(winners)
    assert len(json.loads(summary_json)["critics"]) == 5

def test_empty_winners_returns_none():
    assert build_summary([]) == (None, None)
