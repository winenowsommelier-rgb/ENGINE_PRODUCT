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

    # KNOWN LIMITATION: uses the FIRST (leftmost) year found in `name`, not
    # necessarily the semantically-relevant one. A name with two embedded
    # years (heritage text like "since 1855", or a bottle-format/vintage
    # combo) could compare against the wrong year. Verified 2026-07-16
    # against the live catalog (11,436 products): only 4 names contain 2+
    # years and 0 contain heritage-date phrasing, so this is a negligible
    # real-world risk today -- re-examine if catalog composition changes or
    # this function starts gating higher-stakes decisions.
    name_year_match = _YEAR_RE.search(name or "")
    if not name_year_match:
        return False  # no year embedded in name -- nothing to compare against
    name_year = name_year_match.group(0)

    return name_year != field_year
