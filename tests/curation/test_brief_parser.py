import json
import pathlib
from unittest.mock import patch, MagicMock
from lib.curation.llm_router import LLMRouter
from lib.curation.brief_parser import parse_brief
from lib.curation.models import StructuredQuery

CONFIG = {
    "llm_provider": "ollama",
    "ollama_model": "llama3.1:8b",
    "ollama_base_url": "http://localhost:11434",
    "background_panel_provider": "anthropic",
    "background_panel_enabled": False,
}


OLLAMA_RESPONSE = json.dumps({
    "category_filter": ["Whisky"],
    "country_filter": [],
    "score_threshold": 90.0,
    "pairing_context": "Thai food",
    "in_stock_only": True,
    "output_size": 12,
    "occasion_id": None,
    "audience": ["b2b"]
})


def test_parse_brief_returns_structured_query():
    with patch("lib.curation.llm_router.httpx.post") as mock_post:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": {"content": OLLAMA_RESPONSE}}
        )
        q = parse_brief("Whisky pairing with Thai food, 90 points only")
    assert isinstance(q, StructuredQuery)
    assert "Whisky" in q.category_filter
    assert q.score_threshold == 90.0
    assert q.pairing_context == "Thai food"


def test_router_returns_text_from_ollama(tmp_path):
    cfg = tmp_path / "curation_config.json"
    cfg.write_text(json.dumps(CONFIG))
    router = LLMRouter(config_path=cfg)
    with patch("lib.curation.llm_router.httpx.post") as mock_post:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": {"content": "hello"}}
        )
        result = router.complete("Say hello", tier="production")
    assert result == "hello"
