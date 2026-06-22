#!/usr/bin/env python3
"""Backfill a `designation` column on data/db/products.db from product names.

Designations are the product CLASS (Grand Cru/DOCG/IGT/XO/Reserva/…). They are
NOT the raw `classification` field (that is product TYPE — CLAUDE.md RULE 12).
Pure regex over `name`; NO paid API. Mirrors apps/catalog/lib/designation.ts —
keep them in sync (tests/test_designation_parity.py guards drift).

This file is import-safe: defining patterns + designation_for_name has no side
effects. The DB-write CLI is added in a later step.
"""
from __future__ import annotations  # Python 3.9
import re

# Ordered MOST-SPECIFIC FIRST — first match wins. Mirrors the TS table EXACTLY.
# Spirit grades (XO/VSOP/VS) + Single Malt beat soft modifiers (Reserva/Reserve/Limited/Vintage).
DESIGNATION_PATTERNS = [
    ("Grand Cru",   re.compile(r"\bgrand\s+cru\b", re.I)),
    ("Premier Cru", re.compile(r"\b(?:premier\s+cru|1er\s+cru)\b", re.I)),
    ("Cru Classé",  re.compile(r"\bcru\s+class[eé](?![a-z])", re.I)),
    ("DOCG",        re.compile(r"\bDOCG\b")),
    ("DOC",         re.compile(r"\bDOC\b")),
    ("IGT",         re.compile(r"\bIGT\b")),
    ("DOP/IGP",     re.compile(r"\b(?:DOP|IGP)\b")),
    ("AOC",         re.compile(r"\b(?:AOC|AOP)\b")),
    ("Single Malt", re.compile(r"\bsingle\s+malt\b", re.I)),
    ("XO",          re.compile(r"\bXO\b")),
    ("VSOP",        re.compile(r"\bVSOP\b")),
    ("VS",          re.compile(r"\bVS\b")),
    ("Gran Reserva",re.compile(r"\bgran\s+reserva\b", re.I)),
    ("Extra Brut",  re.compile(r"\bextra\s+brut\b", re.I)),
    ("Brut",        re.compile(r"\bbrut\b", re.I)),
    ("Reserva",     re.compile(r"\b(?:reserva|riserva)\b", re.I)),
    ("Reserve",     re.compile(r"\breserve\b", re.I)),
    ("Limited",     re.compile(r"\blimited(?:\s+edition)?\b", re.I)),
    ("Vintage",     re.compile(r"\bvintage\b", re.I)),
]

def designation_for_name(name: str | None) -> str | None:
    n = name or ""
    for label, rx in DESIGNATION_PATTERNS:
        if rx.search(n):
            return label
    return None
