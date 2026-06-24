#!/usr/bin/env python3
"""Pure helpers for masterfile intake. No I/O, no DB — unit-testable."""
from __future__ import annotations
import csv, re, html
from pathlib import Path

EMPTY = {"", "-", "–", "—", "n/a", "na"}
def is_empty_cell(v) -> bool:
    return (v or "").strip().lower() in EMPTY

_PCT = re.compile(r"\s*\(?100\s*%\)?\s*")
def normalize_variety(v: str | None) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    # Blends carry their own percentages or separators — preserve verbatim.
    if re.search(r"\d+\s*%.*\d+\s*%", v) or "/" in v or "," in v:
        return v
    out = _PCT.sub(" ", v).strip()
    return out or v

_PTS = re.compile(
    r"(\d{2,3})\s*(?:points?|pts|Point|"
    r"(?=(?:&nbsp;|\s)*(?:by\s*)?(?:Wine|James|Robert|Jeb|Decanter|Vinous)))",
    re.I,
)
def parse_points(raw: str | None) -> int | None:
    if is_empty_cell(raw):
        return None
    txt = html.unescape(re.sub(r"<[^>]+>", " ", raw or ""))
    m = _PTS.search(txt)
    return int(m.group(1)) if m else None

# Designation tokens. Sort by length descending so 'Grand Cru' beats 'Cru'
# and 'Gran Reserva' beats 'Reserva' at the same scan position. Word-boundaried.
_DESIGS = [
    "Grosses Gewächs", "Gran Reserva", "Premier Cru", "1er Cru", "Grand Cru",
    "Extra Brut", "Brut Nature", "Single Malt", "Brut", "Riserva", "Reserva",
    "DOCG", "DOC", "DOP", "IGT", "IGP", "AOC", "AOP", "XO", "VSOP", "VS",
    "Villages", "GG",
]
_DESIGS_BY_LEN = sorted(_DESIGS, key=len, reverse=True)
_DESIG_RE = re.compile(
    r"\b(" + "|".join(re.escape(d) for d in _DESIGS_BY_LEN) + r")\b", re.I
)
# Only these item_types may carry a wine/spirit designation.
_DESIG_TYPES = {
    "Red Wine", "White Wine", "Rosé Wine", "Rose Wine", "Sparkling Wine",
    "Champagne", "Sparkling & Champagne", "Dessert Wine", "Sweet/Dessert",
    "Port Wine", "Orange Wine", "Whisky", "Brandy", "Grappa",
}
def extract_designation(name: str | None, item_type: str | None) -> str | None:
    if not name or (item_type or "").strip() not in _DESIG_TYPES:
        return None
    m = _DESIG_RE.search(name)
    if not m:
        return None
    canon = {d.lower(): d for d in _DESIGS}
    return canon[m.group(1).lower()]

def load_masterfile(path: str | Path) -> tuple[list[dict], list[str]]:
    """Return (deduped rows, list of duplicate SKUs). Last row wins on dup."""
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    seen, dups = {}, []
    for r in rows:
        sku = (r.get("sku") or "").strip()
        if not sku:
            continue
        if sku in seen:
            dups.append(sku)
        seen[sku] = r
    out = list(seen.values())
    return out, dups
