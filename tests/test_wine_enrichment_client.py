"""Unit tests for data/lib/enrichment/shared/client.py."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from data.lib.enrichment.shared import client as c


class TestCostEstimate:
    def test_haiku_cost_calc(self):
        usage = MagicMock(input_tokens=1200, output_tokens=600, cache_read_input_tokens=500)
        cost_usd = c._estimate_cost_usd(usage, model="claude-haiku-4-5-20251001")
        # 700 fresh × $1/1M + 500 cached × $0.10/1M + 600 output × $5/1M
        # = 0.0007 + 0.00005 + 0.003 = 0.00375
        assert cost_usd == pytest.approx(0.00375, abs=0.0001)


class TestGenerateMocked:
    @patch("data.lib.enrichment.shared.client.anthropic.Anthropic")
    def test_generate_returns_response(self, mock_anthropic_class):
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        mock_resp = MagicMock()
        mock_resp.content = [MagicMock(text='{"wine_body":"Full"}')]
        mock_resp.model = "claude-haiku-4-5-20251001"
        mock_resp.usage = MagicMock(input_tokens=1000, output_tokens=500, cache_read_input_tokens=0)
        mock_client.messages.create.return_value = mock_resp

        client = c.AnthropicClient(api_key="fake-key", model="claude-haiku-4-5-20251001")
        result = client.generate(system="sys", user="usr", max_tokens=1500)

        assert result.text == '{"wine_body":"Full"}'
        assert result.model == "claude-haiku-4-5-20251001"
        assert result.tokens_in == 1000
        assert result.tokens_out == 500
        assert result.cost_usd > 0
