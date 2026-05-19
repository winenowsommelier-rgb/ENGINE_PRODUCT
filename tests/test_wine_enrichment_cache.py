"""Unit tests for data/lib/enrichment/shared/cache.py.

Mocks urllib.request.urlopen to avoid real network calls.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from data.lib.enrichment.shared import cache as ca


class TestCacheLookupMiss:
    @patch("data.lib.enrichment.shared.cache.urllib.request.urlopen")
    def test_miss_returns_none(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = b"[]"
        mock_resp.status = 200
        mock_urlopen.return_value = mock_resp

        client = ca.CacheClient(supabase_url="https://x.supabase.co", api_key="k")
        result = client.lookup(sku="WX-1", prompt_hash="ph", evidence_hash="eh")
        assert result is None


class TestCacheLookupHit:
    @patch("data.lib.enrichment.shared.cache.urllib.request.urlopen")
    def test_hit_returns_row(self, mock_urlopen):
        row = {
            "id": "abc-123", "sku": "WX-1", "category": "wine",
            "prompt_hash": "ph", "evidence_hash": "eh",
            "response_json": {"wine_body": "Full"}, "model": "haiku",
            "tokens_in": 100, "tokens_out": 50, "cost_thb": 0.1,
            "confidence": 0.9, "validation_status": "passed",
        }
        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = json.dumps([row]).encode("utf-8")
        mock_resp.status = 200
        mock_urlopen.return_value = mock_resp

        client = ca.CacheClient(supabase_url="https://x.supabase.co", api_key="k")
        result = client.lookup(sku="WX-1", prompt_hash="ph", evidence_hash="eh")
        assert result is not None
        assert result["sku"] == "WX-1"
        assert result["response_json"]["wine_body"] == "Full"


class TestCacheWrite:
    @patch("data.lib.enrichment.shared.cache.urllib.request.urlopen")
    def test_write_supersedes_and_inserts(self, mock_urlopen):
        # Mock both calls: PATCH supersede returns empty, POST insert returns new row
        responses = [
            (b"", 200),  # supersede
            (json.dumps([{"id": "new-uuid"}]).encode("utf-8"), 201),  # insert
        ]
        call_idx = [0]
        def side_effect(req, timeout=None):
            m = MagicMock()
            m.__enter__.return_value = m
            body, status = responses[call_idx[0]]
            m.read.return_value = body
            m.status = status
            call_idx[0] += 1
            return m
        mock_urlopen.side_effect = side_effect

        client = ca.CacheClient(supabase_url="https://x.supabase.co", api_key="k")
        new_id = client.write(
            sku="WX-1", category="wine",
            prompt_hash="ph", evidence_hash="eh",
            prompt_text="...", response_json={"wine_body": "Full"},
            response_raw="x", model="haiku",
            tokens_in=100, tokens_out=50, cost_thb=0.1,
            confidence=0.9, validation_status="passed", validation_issues=[],
        )
        assert new_id == "new-uuid"
        assert mock_urlopen.call_count == 2
