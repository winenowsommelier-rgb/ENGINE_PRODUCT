"""Canonical SKU-prefix taxonomy — Python loader. SKU is the source of truth.

Reads data/taxonomy/sku_prefix_map.json. resolve(product) -> {group, type}.
Per-product type refinements live in refine_type.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
MAP_PATH = REPO_ROOT / "data" / "taxonomy" / "sku_prefix_map.json"
OVERRIDES_PATH = REPO_ROOT / "data" / "taxonomy" / "sku_overrides.json"

_FORTIFIED = re.compile(r"\b(port|marsala|madeira|sherry|oloroso|amontillado|fino)\b", re.I)


@lru_cache(maxsize=1)
def _load() -> dict:
    return json.loads(MAP_PATH.read_text())


@lru_cache(maxsize=1)
def _overrides() -> dict:
    """Per-SKU corrections for products carrying the WRONG prefix line in Magento.
    Keyed by uppercase full SKU. See sku_overrides.json's _README. Missing file is
    not an error — overrides are optional (an empty dict means prefix map wins)."""
    try:
        return json.loads(OVERRIDES_PATH.read_text()).get("overrides", {})
    except (FileNotFoundError, ValueError):
        return {}


def _override_for(sku: str) -> dict:
    return _overrides().get(str(sku or "").upper(), {})


def region_override(sku: str):
    """Corrected region for a SKU whose stored region is a data-entry artifact, or
    None if no override. Returns "" to mean 'clear the region'. The refresh applies
    this so the correction survives every export rebuild (drift-proof, like group)."""
    ov = _override_for(sku)
    return ov["region"] if "region" in ov else None


# Invariant: all map prefixes are exactly 3 chars. A hypothetical 2-char entry
# would be silently unreachable (we slice [:3] then fall back to [:1]).
def _prefix3(sku: str) -> str:
    return str(sku or "").upper()[:3]


def refine_type(prefix: str, base_type: str, name: str) -> str:
    """Apply per-product type rules. Deterministic, name-keyword based."""
    n = (name or "")
    if prefix == "WDW":
        return "Fortified" if _FORTIFIED.search(n) else "Sweet/Dessert"
    if prefix == "LBD":
        nl = n.lower()
        if "cognac" in nl:
            return "Cognac"
        if "armagnac" in nl:
            return "Armagnac"
        return "Brandy"
    return base_type


def resolve(product: dict) -> dict:
    """Return {'group','type'} for a product. SKU prefix wins; classification ignored."""
    data = _load()
    sku = str(product.get("sku") or "").upper()
    if not sku.strip():
        return {"group": "Unknown", "type": "Unknown"}
    p3 = _prefix3(sku)
    entry = data["prefixes"].get(p3)
    if entry is not None:
        base = {"group": entry["group"],
                "type": refine_type(p3, entry["type"], product.get("name", ""))}
    else:
        grp = data["letter_fallback"].get(sku[:1], "Unknown")
        base = {"group": grp, "type": "Unknown"}
    # Per-SKU override (Magento mis-prefixed lines). Applies AFTER the prefix
    # lookup so a wrong-line SKU lands in its real group/type. region is handled
    # separately by region_override() in the refresh — not part of {group,type}.
    ov = _override_for(sku)
    if "group" in ov:
        base["group"] = ov["group"]
    if "type" in ov:
        base["type"] = ov["type"]
    return base


def group_for(sku: str) -> str:
    return resolve({"sku": sku})["group"]


def type_for(sku: str) -> str:
    return resolve({"sku": sku})["type"]


def unmapped_prefixes(products: list) -> list:
    """3-char prefixes seen in products but absent from the map (audit)."""
    data = _load()
    known = set(data["prefixes"])
    seen = {}
    for p in products:
        p3 = _prefix3((p.get("sku") or ""))
        if p3 and p3 not in known:
            seen[p3] = seen.get(p3, 0) + 1
    return sorted(seen)
