"""Central in-stock filter for the Drive export bundle.

The ONLY definition of "sellable" for this bundle: is_in_stock == '1'
(canonical per scripts/refresh_live_export.py). Archived-but-in-stock SKUs
(custom_stock_status='CATALOG' with is_in_stock='1') intentionally pass — they
are technically sellable and are not special-cased (see spec sec 2).
"""
from __future__ import annotations


def filter_in_stock(items: list[dict]) -> list[dict]:
    """Return only records whose is_in_stock flag equals '1'."""
    return [p for p in items if str(p.get('is_in_stock')) == '1']
