"""Production-data invariant: every exported sweetness value is on the gauge scale.

The product-page Sweetness gauge (apps/catalog/lib/taste-adapter.ts normalizeScale)
matches the scale [Dry, Off-Dry, Medium-Sweet, Sweet] case-sensitively and DROPS
anything else to null → a silent-empty gauge. 279 pre-Phase-A rows shipped lowercase
'dry'/'sweet' that rendered blank; normalize_sweetness_case.py fixed them at the
source. This invariant guards the regression: if a future import or refresh
re-introduces an off-scale sweetness token, the build fails instead of silently
blanking gauges (CLAUDE.md Rule 6).

Read-only against the live export. Mirrors test_special_price_export_invariant.py.
DO NOT skip without a replacement.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
EXPORT = REPO / "data" / "live_products_export.json"

# Must match SCALE.sweetness in apps/catalog/lib/taste-adapter.ts
SCALE = {"Dry", "Off-Dry", "Medium-Sweet", "Sweet"}


@pytest.fixture(scope="module")
def rows():
    if not EXPORT.exists():
        pytest.skip(f"export not found at {EXPORT}")
    return json.loads(EXPORT.read_text())


def test_no_offscale_sweetness_tokens_ship(rows):
    offenders = {}
    for r in rows:
        v = r.get("sweetness")
        if v in (None, "", []):
            continue
        if v not in SCALE:
            offenders.setdefault(v, 0)
            offenders[v] += 1
    assert not offenders, (
        f"off-scale sweetness tokens in export (gauge will render blank): {offenders}. "
        f"Run scripts/normalize_sweetness_case.py and refresh the export."
    )
