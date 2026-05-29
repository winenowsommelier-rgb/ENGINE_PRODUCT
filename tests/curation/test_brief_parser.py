import json
import pathlib
from unittest.mock import patch, MagicMock
from lib.curation.llm_router import LLMRouter

CONFIG = {
    "llm_provider": "ollama",
    "ollama_model": "llama3.1:8b",
    "ollama_base_url": "http://localhost:11434",
    "background_panel_provider": "anthropic",
    "background_panel_enabled": False,
}


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
