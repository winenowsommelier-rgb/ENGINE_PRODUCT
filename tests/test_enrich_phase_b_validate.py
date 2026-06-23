"""Phase B PAID-PATH parse+validate tests (Task 4).

These exercise scripts/enrich_phase_b.enrich_one() with a FAKE (mocked) client —
NO network, NO real API call, ZERO spend. The real anthropic client is only
instantiated in main()'s paid branch (run later, after user sign-off / canary).

The load-bearing contract (Rule 1 + Rule 12 + spec §4.1): the LLM is constrained
but NOT trusted. Anything it returns that is off-vocab (a variety not in the
GROUP's allowlist) or off-scale (a body outside the 4-step scale) MUST be DROPPED
to None — never written, never coerced. The downstream merge is NULL-only, so a
dropped value simply leaves the gap for a later pass; a *coerced* wrong value
would silently ship bad data to the UI. These tests lock that drop behavior.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from scripts.enrich_phase_b import enrich_one  # noqa: E402


# --- Fake client/response doubles (no network) ----------------------------

class _Block:
    """Mimics an anthropic content block with a .text attribute."""

    def __init__(self, text):
        self.text = text


class _Usage:
    def __init__(self, input_tokens, output_tokens):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _Resp:
    def __init__(self, text, input_tokens=100, output_tokens=20):
        self.content = [_Block(text)]
        self.usage = _Usage(input_tokens, output_tokens)


class _FakeMessages:
    def __init__(self, resp=None, raise_exc=None):
        self._resp = resp
        self._raise = raise_exc

    def create(self, **kwargs):
        if self._raise is not None:
            raise self._raise
        return self._resp


class _FakeClient:
    """Stands in for anthropic.Anthropic(); .messages.create returns a canned
    response (or raises). It makes NO network call — purely in-memory."""

    def __init__(self, resp=None, raise_exc=None):
        self.messages = _FakeMessages(resp=resp, raise_exc=raise_exc)


def _row(**over):
    base = {"group": "Whisky", "sku": "X", "name": "Test"}
    base.update(over)
    return base


# --- Tests ----------------------------------------------------------------

def test_valid_variety_and_body_pass_through():
    """A Whisky response with on-vocab variety + on-scale body keeps both."""
    client = _FakeClient(_Resp('{"variety": "Single Malt", "body": "Full"}'))
    out = enrich_one(client, _row())
    assert out["status"] == "ok"
    assert out["variety"] == "Single Malt"
    assert out["body"] == "Full"
    assert out["sku"] == "X"
    assert out["group"] == "Whisky"


def test_off_vocab_variety_dropped_to_none():
    """'Chardonnay' is not in the Whisky vocab -> variety DROPPED to None.
    Regression guard (Rule 1/12): never ship an off-vocab value the LLM invented."""
    client = _FakeClient(_Resp('{"variety": "Chardonnay", "body": "Full"}'))
    out = enrich_one(client, _row())
    assert out["variety"] is None      # dropped, not coerced
    assert out["body"] == "Full"       # valid body still survives
    assert out["status"] == "ok"


def test_off_scale_body_dropped_to_none():
    """'Medium-Light' is OUT of the 4-step scale (spec §4.1) -> body DROPPED."""
    client = _FakeClient(_Resp('{"variety": "Single Malt", "body": "Medium-Light"}'))
    out = enrich_one(client, _row())
    assert out["body"] is None         # dropped, not remapped to Medium
    assert out["variety"] == "Single Malt"
    assert out["status"] == "ok"


def test_malformed_non_json_response_graceful():
    """Garbage text -> both fields None, status still 'ok' (no crash)."""
    client = _FakeClient(_Resp("sorry, I cannot help with that"))
    out = enrich_one(client, _row())
    assert out["variety"] is None
    assert out["body"] is None
    assert out["status"] == "ok"


def test_api_exception_does_not_raise():
    """client.messages.create raising -> status starts 'api_error', no re-raise,
    zero tokens/cost (we never got a usable response)."""
    client = _FakeClient(raise_exc=RuntimeError("overloaded_error"))
    out = enrich_one(client, _row())
    assert out["status"].startswith("api_error")
    assert out["variety"] is None
    assert out["body"] is None
    assert out["tokens_in"] == 0
    assert out["tokens_out"] == 0
    assert out["cost_usd"] == 0.0


def test_cost_computed_from_usage():
    """cost_usd derives from usage token counts via COST_IN/COST_OUT."""
    from scripts.enrich_phase_b import COST_IN, COST_OUT
    client = _FakeClient(_Resp('{"variety": "Bourbon", "body": "Medium"}',
                               input_tokens=1000, output_tokens=50))
    out = enrich_one(client, _row())
    assert out["tokens_in"] == 1000
    assert out["tokens_out"] == 50
    assert out["cost_usd"] == 1000 * COST_IN + 50 * COST_OUT
