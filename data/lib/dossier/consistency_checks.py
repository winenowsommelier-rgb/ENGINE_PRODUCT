"""Name-vintage consistency check. A mismatch forces
vintage_scope='unknown-stock-vintage' and caps confidence at 'partial'
regardless of what sources are found -- the field is untrustworthy input,
not a sourcing problem.
"""
from __future__ import annotations

import re

_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def name_vintage_mismatch(name: str, vintage_field: str | None) -> bool:
    """True if `name` embeds a year that disagrees with `vintage_field`."""
    if not vintage_field:
        return False
    vintage_clean = vintage_field.strip()
    if vintage_clean.upper() in ("N/V", "NV", ""):
        return False
    field_year_match = _YEAR_RE.search(vintage_clean)
    if not field_year_match:
        return False  # non-numeric vintage field ("Current vintage" etc) -- not this check's job
    field_year = field_year_match.group(0)

    name_year_match = _YEAR_RE.search(name or "")
    if not name_year_match:
        return False  # no year embedded in name -- nothing to compare against
    name_year = name_year_match.group(0)

    return name_year != field_year
