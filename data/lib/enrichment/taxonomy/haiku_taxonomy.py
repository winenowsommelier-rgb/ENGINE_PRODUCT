"""Haiku prompt builder + response parser for taxonomy field inference.

Focused micro-prompt: only asks for region/subregion/grape_variety.
Target: ~200 tokens input, ~80 tokens output. Much cheaper than full enrichment.
"""
from __future__ import annotations

import json


_FIELD_DESCRIPTIONS = {
    "region":        "wine/spirits region of origin (e.g. Bordeaux, Napa Valley, Speyside)",
    "subregion":     "sub-appellation or commune if determinable (e.g. Pauillac, Stags Leap District)",
    "grape_variety": "list of grape varieties as an array of strings (e.g. [\"Cabernet Sauvignon\"])",
}

_SYSTEM = (
    "You are a wine and spirits expert. "
    "Given a product name, country, and classification, infer the requested fields. "
    "Output ONLY valid JSON — no preamble. "
    "If a field cannot be determined with reasonable confidence, output an empty string or empty array. "
    "Always include a 'confidence' key (0.0–1.0) reflecting your overall certainty."
)


def build_prompt(
    name: str,
    country: str,
    classification: str,
    needs: list[str],
) -> tuple[str, str]:
    """Return (system_text, user_text). `needs` is the list of field names to fill."""
    field_lines = "\n".join(
        f'  "{f}": <{_FIELD_DESCRIPTIONS.get(f, f)}>'
        for f in needs
    )
    schema_fields = ",\n  ".join(
        (f'"{f}": ["..."]' if f == "grape_variety" else f'"{f}": "..."')
        for f in needs
    )
    user = (
        f"Product name: {name}\n"
        f"Country: {country or 'unknown'}\n"
        f"Classification: {classification}\n\n"
        f"Infer the following fields:\n{field_lines}\n\n"
        f"Output JSON:\n{{\n  {schema_fields},\n  \"confidence\": 0.0\n}}"
    )
    return _SYSTEM, user


def parse_response(raw: str, needs: list[str]) -> dict:
    """Parse Haiku JSON response. Returns dict with valid=True/False."""
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return {"valid": False, "region": "", "subregion": "", "grape_variety": [], "confidence": 0.0}
        data = json.loads(raw[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return {"valid": False, "region": "", "subregion": "", "grape_variety": [], "confidence": 0.0}

    # Build result with defaults
    result: dict = {
        "region":        str(data.get("region") or "").strip(),
        "subregion":     str(data.get("subregion") or "").strip(),
        "grape_variety": [],
        "confidence":    0.0,
        "valid":         True,
    }

    # Parse grape_variety
    gv = data.get("grape_variety")
    if isinstance(gv, list):
        result["grape_variety"] = [str(g).strip() for g in gv if str(g).strip()]
    elif isinstance(gv, str) and gv.strip():
        result["grape_variety"] = [gv.strip()]

    # Parse and clamp confidence
    try:
        conf = float(data.get("confidence", 0.0))
        result["confidence"] = round(max(0.0, min(1.0, conf)), 2)
    except (TypeError, ValueError):
        result["confidence"] = 0.0

    return result
