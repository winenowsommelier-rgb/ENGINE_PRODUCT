"""Unit tests for data/lib/enrichment/wine/output.py."""
from __future__ import annotations

import csv
import io
from unittest.mock import MagicMock, patch

from data.lib.enrichment.wine import output as o


def _good_response() -> dict:
    return {
        "wine_body": "Full",
        "wine_acidity": "Medium",
        "wine_tannin": "High",
        "grape_variety": ["Cabernet Sauvignon"],
        "grape_blend_type": "Single Varietal",
        "wine_production_style": ["Conventional"],
        "flavor_tags": ["Blackcurrant", "Cedar", "Tobacco", "Dark Cherry", "Vanilla"],
        "food_matching": ["Grilled red meat", "Lamb dishes", "Aged hard cheese"],
        "desc_en_short": "Bold structured Cabernet.",
        "full_description": "<p>" + ("Bold structured Cab. " * 15) + "</p>",
        "confidence": 0.9,
        "confidence_notes": "Strong.",
        "citations": {"winesensed_record_ids": [], "brand_library_match": None, "grape_source": "", "critic_scores": []},
    }


class TestCsvRow:
    def test_row_contains_all_required_fields(self):
        row = o.build_csv_row(
            sku="WX-1", response=_good_response(),
            final_confidence=0.91, tier="A",
            cache_id="abc-123",
            current_values={"wine_body": "Medium", "food_matching": "Old value"},
            enrichment_note="haiku tier A",
            model="haiku",
            enriched_at="2026-05-12T15:00:00Z",
        )
        assert row["sku"] == "WX-1"
        assert row["confidence"] == 0.91
        assert row["confidence_tier"] == "A"
        assert "Cabernet Sauvignon" in row["grape_variety"]
        assert row["grape_blend_type"] == "Single Varietal"
        assert row["wine_body"] == "Full"
        assert row["current_wine_body"] == "Medium"
        assert row["cache_id"] == "abc-123"


class TestRouting:
    @patch("data.lib.enrichment.wine.output.urllib.request.urlopen")
    def test_above_threshold_writes_to_supabase(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = b""
        mock_resp.status = 204
        mock_urlopen.return_value = mock_resp

        csv_buf = io.StringIO()
        writer = csv.DictWriter(csv_buf, fieldnames=o.CSV_COLUMNS, quoting=csv.QUOTE_ALL)
        writer.writeheader()

        router = o.OutputRouter(
            supabase_url="https://x.supabase.co", api_key="k",
            csv_writer=writer, write_threshold=0.85,
        )
        wrote = router.route(
            sku="WX-1", products_id="prod-1", response=_good_response(),
            final_confidence=0.91, tier="A",
            cache_id="abc-123",
            current_values={},
            enrichment_note="haiku tier A",
            model="haiku-4-5", enriched_at="2026-05-12T15:00:00Z",
        )
        assert wrote is True
        assert mock_urlopen.called
        assert "WX-1" in csv_buf.getvalue()

    @patch("data.lib.enrichment.wine.output.urllib.request.urlopen")
    def test_below_threshold_csv_only(self, mock_urlopen):
        csv_buf = io.StringIO()
        writer = csv.DictWriter(csv_buf, fieldnames=o.CSV_COLUMNS, quoting=csv.QUOTE_ALL)
        writer.writeheader()

        router = o.OutputRouter(
            supabase_url="https://x.supabase.co", api_key="k",
            csv_writer=writer, write_threshold=0.85,
        )
        wrote = router.route(
            sku="WX-2", products_id="prod-2", response=_good_response(),
            final_confidence=0.70, tier="C",
            cache_id="abc-456",
            current_values={},
            enrichment_note="haiku tier C",
            model="haiku-4-5", enriched_at="2026-05-12T15:00:00Z",
        )
        assert wrote is False
        assert mock_urlopen.call_count == 0
        assert "WX-2" in csv_buf.getvalue()
