"""wine_key normalizer -- one-time minting; a registry table (built in a later
task) IS the source of truth once populated. This module only computes what
a FRESH mint would produce for an unmapped SKU; later orchestration logic is
responsible for checking an existing registry BEFORE calling this, so a
rename never re-mints.

PARITY: apps/catalog/lib/dossier/wine-key.ts mirrors WINE_KEY_OVERRIDES only.
tests/test_wine_key_normalizer.py + fixtures/wine_key_cases.json guard drift.
"""
from __future__ import annotations

import re

# Manual override map for irreducible cases the normalizer gets wrong.
# Pattern: SKU_OVERRIDES in data/lib/taxonomy/sku_taxonomy.py.
WINE_KEY_OVERRIDES: dict[str, str] = {}

# Bottle-format tokens to strip. These describe packaging, not the wine
# itself, so they must never be part of the key (hazard: format variants).
# NOTE: imported directly by scripts/audit_wine_keys.py to flag small groups
# for human review -- treat as a semi-public symbol, not safely renameable.
_FORMAT_TOKENS = re.compile(
    r"\b(750\s?ml|375\s?ml|1\.?5\s?l|magnum|jeroboam|methuselah|imperial|"
    r"double\s?magnum|half\s?bottle)\b",
    re.IGNORECASE,
)

# Vintage-year tokens (19xx/20xx) to strip. These describe the harvest year,
# not the wine's identity, so they must never be part of the key (hazard:
# vintage-year variants). NOTE: this is deliberately uniform across ALL
# names -- see the Petrus fixture note in the task report for the tradeoff.
_VINTAGE_TOKEN = re.compile(r"\b(19|20)\d{2}\b")

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    text = text.lower()
    text = _FORMAT_TOKENS.sub(" ", text)
    text = _NON_ALNUM.sub("-", text).strip("-")
    text = re.sub(r"-{2,}", "-", text)
    return text


def wine_key_for(sku: str, name: str) -> str:
    """Compute the wine_key a fresh mint would assign. Callers resolving an
    ALREADY-MAPPED sku must check the registry first -- this function has no
    knowledge of prior mintings.

    Hazard classes handled:
      1. vintage-year stripping    -- _VINTAGE_TOKEN removed before slugify
      2. bottle-format variants    -- _FORMAT_TOKENS removed before slugify
      3. producer case drift       -- .lower() in _slugify
      4. missing double-space sep  -- _NON_ALNUM collapses any run of
                                       whitespace/punctuation to a single "-"
      5. conflated houses          -- NOT touched: distinct producer name
                                       text is never stripped, so distinct
                                       producers always yield distinct keys
      6. single-vineyard vs base   -- NOT touched: vineyard/cuvee name
                                       tokens are never stripped, so extra
                                       qualifying text always survives
    """
    if sku in WINE_KEY_OVERRIDES:
        return WINE_KEY_OVERRIDES[sku]
    name = name or ""
    stripped = _VINTAGE_TOKEN.sub(" ", name)
    return _slugify(stripped)
