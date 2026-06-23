from lib.critic_reviews.refresh_products_summary import merge_for_sku

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
