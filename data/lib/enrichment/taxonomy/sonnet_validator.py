"""Sonnet web-search validator for taxonomy fields.

Called only for S1/S2 brand-tier SKUs where Haiku confidence < 0.85.
Uses Claude Sonnet with web_search to cross-check region/subregion/grape_variety
against live producer and appellation authority sources.

Pure helper functions (get_brand_tier, should_validate, parse_validation_response,
build_validation_prompt) are unit-testable without any API calls.
The top-level `validate()` function requires an AnthropicClient instance.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

_DEFAULT_BRAND_LIBRARY = (
    Path(__file__).resolve().parents[4] / "data" / "brand_description_library.csv"
)

# Session-level cache: avoid re-reading CSV for every SKU
_BRAND_TIER_CACHE: dict[str, str] = {}


def get_brand_tier(brand_name: str, library_path: str | Path = _DEFAULT_BRAND_LIBRARY) -> str:
    """Return 'S1', 'S2', 'S3', or 'unknown' for a brand name.

    S1 = >=10 SKUs, S2 = 3-9 SKUs, S3 = <=2 SKUs, unknown = not in library.
    """
    key = f"{library_path}:{brand_name}"
    if key in _BRAND_TIER_CACHE:
        return _BRAND_TIER_CACHE[key]

    path = Path(library_path)
    if not path.exists():
        _BRAND_TIER_CACHE[key] = "unknown"
        return "unknown"

    brand_lower = brand_name.lower().strip()
    try:
        with path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("entity_name", "").lower().strip() == brand_lower:
                    try:
                        count = int(row.get("product_count", "0"))
                    except ValueError:
                        count = 0
                    if count >= 10:
                        tier = "S1"
                    elif count >= 3:
                        tier = "S2"
                    else:
                        tier = "S3"
                    _BRAND_TIER_CACHE[key] = tier
                    return tier
    except Exception:
        pass

    _BRAND_TIER_CACHE[key] = "unknown"
    return "unknown"


def should_validate(brand_tier: str, haiku_confidence: float) -> bool:
    """Return True if this SKU warrants a Sonnet validation call.

    Only S1 and S2 brands with Haiku confidence < 0.85 are validated.
    """
    if brand_tier not in ("S1", "S2"):
        return False
    return haiku_confidence < 0.85


_SYSTEM = (
    "You are a wine and spirits taxonomy expert. "
    "Given a product name and current (possibly incorrect) taxonomy values, "
    "use web search to verify or correct region, subregion, and/or grape_variety "
    "from the producer's official website or an authoritative appellation source. "
    "Output ONLY valid JSON — no preamble. "
    "Always include a 'confidence' key (0.0-1.0) and a 'citations' array of URLs used."
)


def build_validation_prompt(sku_data: dict, fields_to_validate: list[str]) -> tuple[str, str]:
    """Build (system, user) text for a Sonnet validation call."""
    name = sku_data.get("name", "")
    country = sku_data.get("country", "")
    classification = sku_data.get("classification", "")

    current_vals_lines = "\n".join(
        f"  - {f}: currently '{sku_data.get(f, '')}'" for f in fields_to_validate
    )
    schema_fields = ",\n  ".join(
        (f'"{f}": ["..."]' if f == "grape_variety" else f'"{f}": "..."')
        for f in fields_to_validate
    )

    user = (
        f"Product: {name}\n"
        f"Country: {country or 'unknown'}\n"
        f"Classification: {classification}\n\n"
        f"Please verify these fields (search for the producer or appellation authority):\n"
        f"{current_vals_lines}\n\n"
        f"Output JSON:\n"
        f"{{\n  {schema_fields},\n"
        f'  "confidence": 0.0,\n'
        f'  "citations": ["url1", "..."]\n'
        f"}}"
    )
    return _SYSTEM, user


def parse_validation_response(raw: str, fields: list[str]) -> dict:
    """Parse Sonnet JSON response. Returns dict with valid=True/False."""
    empty = {
        "valid": False, "region": "", "subregion": "", "grape_variety": "",
        "confidence": 0.0, "citations": [], "source": "sonnet_validated",
    }
    if not raw:
        return empty
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return empty
        data = json.loads(raw[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return empty

    result: dict = {
        "region":        str(data.get("region") or "").strip(),
        "subregion":     str(data.get("subregion") or "").strip(),
        "grape_variety": "",
        "confidence":    0.0,
        "citations":     [],
        "valid":         True,
        "source":        "sonnet_validated",
    }

    gv = data.get("grape_variety")
    if isinstance(gv, list):
        result["grape_variety"] = ", ".join(str(g).strip() for g in gv if str(g).strip())
    elif isinstance(gv, str):
        result["grape_variety"] = gv.strip()

    try:
        conf = float(data.get("confidence", 0.0))
        result["confidence"] = round(max(0.0, min(1.0, conf)), 2)
    except (TypeError, ValueError):
        result["confidence"] = 0.0

    cites = data.get("citations", [])
    if isinstance(cites, list):
        result["citations"] = [str(c) for c in cites if c]

    return result


def validate(client, sku_data: dict, fields_to_validate: list[str]) -> dict:
    """Call Sonnet with web_search to validate taxonomy fields for one SKU.

    `client` must be an AnthropicClient instance (from data.lib.enrichment.shared.client).
    Returns parse_validation_response result + cost_thb key.
    """
    system, user = build_validation_prompt(sku_data, fields_to_validate)
    try:
        gen = client.generate(
            system=system,
            user=user,
            max_tokens=400,
            temperature=0.1,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
        )
        result = parse_validation_response(gen.text, fields_to_validate)
        result["cost_thb"] = getattr(gen, "cost_thb", 0.0)
        return result
    except Exception as e:
        return {
            "valid": False, "confidence": 0.0, "error": str(e),
            "cost_thb": 0.0, "region": "", "subregion": "",
            "grape_variety": "", "citations": [], "source": "sonnet_validated",
        }
