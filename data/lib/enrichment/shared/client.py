"""Anthropic SDK wrapper with retries + cost tracking."""
from __future__ import annotations

import time
from dataclasses import dataclass

import anthropic


# Per-million-token USD pricing for Claude 4.x family (as of 2026 spec date).
# input: $1, output: $5, cached: $0.10 for Haiku 4.5
_PRICING_USD_PER_MILLION: dict[str, tuple[float, float, float]] = {
    "claude-haiku-4-5-20251001": (1.0, 5.0, 0.10),
    "claude-haiku-4-5": (1.0, 5.0, 0.10),
    "claude-sonnet-4-6": (3.0, 15.0, 0.30),
    "claude-opus-4-7": (15.0, 75.0, 1.50),
}

USD_TO_THB = 35.0


@dataclass
class GenerationResult:
    text: str
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    cost_thb: float


def _estimate_cost_usd(usage, model: str) -> float:
    in_price, out_price, cache_price = _PRICING_USD_PER_MILLION.get(model, (1.0, 5.0, 0.10))
    cached = getattr(usage, "cache_read_input_tokens", 0) or 0
    in_total = getattr(usage, "input_tokens", 0) or 0
    out_total = getattr(usage, "output_tokens", 0) or 0
    fresh_in = max(0, in_total - cached)
    return (
        fresh_in * in_price / 1_000_000
        + cached * cache_price / 1_000_000
        + out_total * out_price / 1_000_000
    )


class AnthropicClient:
    def __init__(self, api_key: str, model: str = "claude-haiku-4-5-20251001"):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def generate(
        self,
        system: str,
        user: str,
        max_tokens: int = 1500,
        temperature: float = 0.1,
        max_retries: int = 5,
        tools: list[dict] | None = None,
    ) -> GenerationResult:
        """Generate with exponential backoff on transient errors.

        Retries on rate-limit, server-side API errors, AND connection errors
        (the latter has bitten two consecutive Phase 5 runs — transient
        network blips killing 8000-SKU batches mid-flight). 5 retries with
        2^attempt seconds backoff gives ~31s total tolerance per call.

        `tools` — optional list of tool dicts (e.g. web_search). When provided,
        the first text block from the final response is extracted.
        """
        last_err: Exception | None = None
        for attempt in range(max_retries):
            try:
                kwargs: dict = dict(
                    model=self.model,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                    messages=[{"role": "user", "content": user}],
                )
                if tools:
                    kwargs["tools"] = tools
                resp = self.client.messages.create(**kwargs)
                # Extract text: pick the last text block (tool-use may precede it)
                text = ""
                for block in reversed(resp.content or []):
                    if hasattr(block, "text"):
                        text = block.text
                        break
                cost_usd = _estimate_cost_usd(resp.usage, resp.model)
                return GenerationResult(
                    text=text,
                    model=resp.model,
                    tokens_in=getattr(resp.usage, "input_tokens", 0) or 0,
                    tokens_out=getattr(resp.usage, "output_tokens", 0) or 0,
                    cost_usd=cost_usd,
                    cost_thb=cost_usd * USD_TO_THB,
                )
            except (
                anthropic.RateLimitError,
                anthropic.APIStatusError,
                anthropic.APIConnectionError,
                anthropic.APITimeoutError,
            ) as e:
                last_err = e
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise
        raise RuntimeError("unreachable") from last_err
