#!/usr/bin/env python3
"""Advisory report: products whose SKU-derived category disagrees with the
Magento `classification` field. Code never trusts classification — this is a
human cleanup list for the data team. No spend, read-only.
"""
from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.taxonomy.sku_taxonomy import resolve, unmapped_prefixes  # noqa: E402

EXPORT = REPO_ROOT / "data" / "live_products_export.json"


def main() -> int:
    prods = json.loads(EXPORT.read_text())

    wine_product = [p for p in prods if (p.get("classification") or "") == "Wine product"]
    print(f"'Wine product' rows reclassified by SKU: {len(wine_product)}")
    by_group = collections.Counter(resolve(p)["group"] for p in wine_product)
    print("  -> now correctly grouped as:")
    for g, n in by_group.most_common():
        print(f"       {g:16s} {n}")

    unmapped = unmapped_prefixes(prods)
    print(f"\nunmapped 3-char prefixes (need explicit map entries): {unmapped or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
