"""Deterministic taste-axis inferers (Phase A, free — no LLM).

name / region / category_type → a ladder value for the universal columns
`smokiness`, `sweetness`, `body`. Pure functions, no I/O. Conservative by design:
return None when there is NO confident signal (so Phase B, not a guess, fills it).
'none' (a real ladder value, e.g. an unpeated whisky) is DISTINCT from None (unknown).

Validated against real in-stock product names from the live export (see
docs/superpowers/plans/2026-06-22-finder-taste-coverage-enrichment.md).
"""
from __future__ import annotations  # Python 3.9 — `str | None` in annotations

import re

# ── smokiness (whisky/spirits) ───────────────────────────────────────────────
# Distillery names whose CORE range is heavily peated (name alone implies smoke even
# when region data is wrong/missing) + explicit peat words.
_PEAT_HEAVY = re.compile(
    r"\b(peated|smoky|smoke|laphroaig|ardbeg|lagavulin|kilchoman|caol ila|"
    r"port charlotte|octomore|big peat|peat monster)\b", re.I)
# bare 'peat' is matched separately so the negation guard can pre-empt 'non-peated'.
_PEAT_WORD = re.compile(r"\bpeat\b", re.I)
_PEAT_LIGHT = re.compile(r"lightly peated|a touch of (smoke|peat)|gently peated", re.I)
# NEGATION GUARD (Rule 5): explicit non/un-peated, and Islay distilleries whose FLAGSHIP
# is unpeated (Bruichladdich Classic/Laddie/<year>, Bunnahabhain) — region=Islay must NOT
# force heavy for these.
_NOT_PEATED = re.compile(
    r"non[- ]?peated|un[- ]?peated|bruichladdich\s+(the\s+)?(classic|laddie|\d)|bunnahabhain",
    re.I)
_ISLAY = {"islay"}


def infer_smokiness(name: str, region: str = "") -> str | None:
    hay = f"{name} {region}".lower()
    # 1) Explicit non-peated / unpeated-flagship wins over everything (incl. region=Islay).
    if _NOT_PEATED.search(hay):
        return "none"
    if _PEAT_LIGHT.search(hay):
        return "light"
    # 2) Heavy if a peat cue OR an Islay region (the proxy) OR a heavy-distillery name.
    if (region or "").strip().lower() in _ISLAY or _PEAT_HEAVY.search(hay) or _PEAT_WORD.search(hay):
        return "heavy"
    # 3) A whisky-shaped row with a Scotch/whisky region but no peat cue reads as clean.
    if (region or "").strip():
        return "none"
    return None


# ── sweetness (sake) ─────────────────────────────────────────────────────────
_SWEET = re.compile(r"\bnigori\b|\bamakuchi\b|\bsweet\b|\bplum\b|\bumeshu\b", re.I)
_DRY = re.compile(r"\bkarakuchi\b|\bdry\b|\bsuper dry\b", re.I)


def infer_sweetness(name: str, category_type: str = "") -> str | None:
    hay = name.lower()
    if _SWEET.search(hay):
        return "sweet"
    if _DRY.search(hay):
        return "dry"
    return None  # no confident cue → Phase B (most polished sake has no name cue)


# ── body (wine) ──────────────────────────────────────────────────────────────
_BODY_FULL = re.compile(r"\b(full[- ]bodied|big|bold|powerful|robust)\b", re.I)
_BODY_LIGHT = re.compile(r"\b(light[- ]bodied|light|easy[- ]drinking|delicate)\b", re.I)


def infer_body(name: str, category_type: str = "") -> str | None:
    hay = name.lower()
    if _BODY_FULL.search(hay):
        return "full"
    if _BODY_LIGHT.search(hay):
        return "light"
    return None  # no cue → Phase B (body is rarely stated in the name; expect low A-reach)
