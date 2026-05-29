from __future__ import annotations
import json
from pathlib import Path
from typing import Literal

import httpx


class LLMRouter:
    def __init__(self, config_path: Path | None = None):
        if config_path is None:
            config_path = Path(__file__).resolve().parents[2] / "data" / "lib" / "curation" / "curation_config.json"
        self._config = json.loads(config_path.read_text())

    def complete(self, prompt: str, tier: Literal["production", "panel"] = "production") -> str:
        if tier == "panel":
            return self._call_anthropic(prompt)
        provider = self._config.get("llm_provider", "ollama")
        if provider == "ollama":
            return self._call_ollama(prompt)
        return self._call_anthropic(prompt)

    def _call_ollama(self, prompt: str) -> str:
        base = self._config.get("ollama_base_url", "http://localhost:11434")
        model = self._config.get("ollama_model", "llama3.1:8b")
        resp = httpx.post(
            f"{base}/api/chat",
            json={"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]

    def _call_anthropic(self, prompt: str) -> str:
        import anthropic
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text
