"""Validators wired into the generation pipeline before staging. Pure
functions -- no DB, no network. Called by a real content-generation run
(not part of this task) before anything reaches a staging table.
"""
from __future__ import annotations

import re
from collections import Counter

try:
    import jsonschema
    _HAS_JSONSCHEMA = True
except ImportError:
    _HAS_JSONSCHEMA = False

_PRICE_LANGUAGE_RE = re.compile(
    r"(฿\s?\d|only\s+\$|great\s+value|a\s+steal|investment|"
    r"appreciat(e|ing|ion)\s+in\s+value|resale\s+value)",
    re.IGNORECASE,
)

# Marketing-sludge phrases banned from generated copy. Substring match on
# lowercased text -- keep phrases specific enough to avoid false positives
# on legitimate tasting/production language (e.g. "hills", "traditional
# methods" must NOT trip this list).
BANNED_PHRASES = [
    "notes of",
    "perfect for any occasion",
    "elevate your experience",
    "a must-have",
    "hidden gem",
    "world-class",
    "unparalleled",
    "truly exceptional",
    "one of a kind",
]

# The closed set of known provenance field keys. Any key outside this set is
# almost certainly a typo that would otherwise pass schema validation
# silently, since JSON Schema's additionalProperties sub-schema only
# constrains the VALUE shape, not which keys are allowed.
KNOWN_PROVENANCE_FIELDS = {
    "style_summary",
    "expert_note",
    "producer_history",
    "signature_pairings_json",
    "serve_guidance_json",
    "content_hooks_json",
    "occasion_tags_json",
    "cuisine_tags_json",
    "honors_json",
    "drink_from_year",
    "drink_to_year",
    "peak_from_year",
    "peak_to_year",
}


def contains_price_language(text: str) -> bool:
    """True if `text` contains pricing/investment language. Thai legal
    compliance requires generated content never imply investment value or
    quote/reference prices."""
    return bool(_PRICE_LANGUAGE_RE.search(text or ""))


def contains_banned_phrase(text: str) -> bool:
    lower = (text or "").lower()
    return any(p in lower for p in BANNED_PHRASES)


def _ngrams(text: str, n: int) -> Counter:
    words = re.findall(r"\w+", (text or "").lower())
    return Counter(tuple(words[i:i + n]) for i in range(len(words) - n + 1))


def ngram_overlap_ratio(generated: str, source: str, n: int = 6) -> float:
    """Fraction of `generated`'s n-grams that also appear in `source`.
    High ratio = risk of near-verbatim reproduction of (possibly
    copyrighted) critic prose."""
    gen_grams = _ngrams(generated, n)
    if not gen_grams:
        return 0.0
    src_grams = _ngrams(source, n)
    overlap = sum(min(c, src_grams.get(g, 0)) for g, c in gen_grams.items())
    total = sum(gen_grams.values())
    return overlap / total if total else 0.0


def provenance_has_source_for_sourced_fields(provenance: dict) -> list[str]:
    """Returns field names marked 'sourced' with an empty source_urls list --
    a contradiction the validator must catch before staging."""
    bad = []
    for field, entry in (provenance or {}).items():
        if entry.get("confidence") == "sourced" and not entry.get("source_urls"):
            bad.append(field)
    return bad


def unknown_provenance_keys(provenance: dict) -> list[str]:
    """Keys in `provenance` that aren't in the closed known-field list --
    catches typos (e.g. 'soem_typo_field') that JSON Schema's
    additionalProperties sub-schema can't detect, since that sub-schema only
    constrains the shape of each value, not the set of allowed keys."""
    return [k for k in (provenance or {}) if k not in KNOWN_PROVENANCE_FIELDS]


def validate_against_schema(response: dict, schema: dict) -> list[str]:
    """Validate `response` against the JSON Schema, then layer on the
    unknown-provenance-key check that JSON Schema alone can't express
    (a closed enum of allowed object keys)."""
    errors: list[str] = []
    if _HAS_JSONSCHEMA:
        validator = jsonschema.Draft7Validator(schema)
        errors.extend(e.message for e in validator.iter_errors(response))
    elif "wine_key" not in response:
        errors.append("missing required field: wine_key")

    unknown = unknown_provenance_keys(response.get("provenance", {}))
    if unknown:
        errors.append(f"unknown provenance keys: {unknown}")

    return errors
