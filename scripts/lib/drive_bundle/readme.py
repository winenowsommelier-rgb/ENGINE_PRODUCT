"""Render README.md — human/LLM orientation for the Drive folder (spec sec 5)."""
from __future__ import annotations


def render_readme(total_in_stock: int, total_all: int) -> str:
    # NOTE: deliberately does NOT embed a per-run timestamp — that would change
    # the README's hash every run and defeat its hash-gate. Freshness lives in
    # MANIFEST.json (generated_at). README content changes only when counts do.
    return f"""# WN/LIQ9 AI Data Sources

In-stock SKUs: {total_in_stock:,}  |  Total catalogued: {total_all:,}
See MANIFEST.json for generation time and per-file freshness.

## How to use these files

1. **Read `MANIFEST.json` first** — it lists every file, its purpose, freshness,
   row count and hash.
2. **`live/`** (refreshed DAILY) — current commercial truth:
   - `inventory_live.csv` — what is in stock right now.
   - `pricing_promotions_live.csv` — current price & any sale.
   **Never recommend a SKU that is absent from `inventory_live.csv`.**
3. **`catalog/`** (refreshed on change) — full product detail: tasting notes,
   pairing, origin. Category-split JSON + a compact TSV index. Search the TSV
   first, then open the matching category file.
4. **`slim/`** — smaller JSON for Claude/ChatGPT Projects (size-capped).
5. **`notebooklm/`** — plain-text sources for Google NotebookLM.

Live commercial data (price/stock) is deliberately separate from static product
facts, so prices can update daily without re-uploading the heavy detail files.
"""
