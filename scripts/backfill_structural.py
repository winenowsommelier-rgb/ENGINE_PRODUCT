#!/usr/bin/env python3
"""P1 — backfill wine_body / wine_acidity / wine_tannin on in-stock wines.

PAID (Anthropic). Gated by CLAUDE.md Rule 10: backup → 5-SKU canary → cost
estimate → user sign-off → verify in the export.

Design
------
- Target: in-stock wines (SKU `W*`, NOT `WEV` — the reliable signal; the
  `classification` field is unreliable, see apps/catalog/lib/category-groups.ts)
  that are missing >=1 of the three structural fields and have grape/region/country
  signal to reason from.
- Minimal structural-only call (Haiku by default): tiny prompt, constrained JSON
  out. We do NOT re-run the full sommelier pipeline (that would pay for data we
  already have).
- The model output is parsed and VALIDATED against the catalog gauge's canonical
  scales before it touches the export. An off-scale value (e.g. "Medium-Light"
  acidity) would render a silent-empty gauge — we reject it instead.
- Writes a sidecar cache first; only validated values land in the export. Original
  fields are never overwritten if already present.

Usage
-----
    .venv/bin/python scripts/backfill_structural.py --canary 5      # 5-SKU canary (spends)
    .venv/bin/python scripts/backfill_structural.py --dry-run       # show target, NO spend
    .venv/bin/python scripts/backfill_structural.py                 # full run (spends)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EXPORT = REPO_ROOT / "data" / "live_products_export.json"
CACHE_PATH = REPO_ROOT / "data" / "structural_backfill_cache.json"
ENV_LOCAL = REPO_ROOT / ".env.local"
MODEL = "claude-haiku-4-5"

# Canonical scales the catalog gauge renders. Off-scale -> silent-empty gauge.
BODY_SCALE = ("Light", "Medium", "Medium-Full", "Full")
LOWHIGH_SCALE = ("Low", "Medium", "Medium-High", "High")  # acidity + tannin
# case-insensitive lookup -> canonical capitalization
_BODY = {v.lower(): v for v in BODY_SCALE}
_LH = {v.lower(): v for v in LOWHIGH_SCALE}

SYSTEM = (
    "You are an expert sommelier. Given a wine's facts, output ONLY a JSON object "
    "with its structural profile and nothing else (no prose, no markdown).\n"
    'Schema: {"body": <one of: Light, Medium, Medium-Full, Full>, '
    '"acidity": <one of: Low, Medium, Medium-High, High>, '
    '"tannin": <one of: Low, Medium, Medium-High, High>}.\n'
    "Rules: white/rosé/sparkling wines almost always have Low tannin. Base your "
    "answer on the grape variety and region. Use ONLY the allowed values exactly."
)


class StructuralError(ValueError):
    """Raised when a model response can't be parsed/validated to canonical scales."""


def build_facts(product: dict) -> dict:
    """Minimal, leak-safe fact dict for the prompt (no price/margin/internal fields)."""
    return {
        "name": product.get("name") or "",
        "grape_variety": product.get("grape_variety") or "",
        "region": product.get("region") or "",
        "country": product.get("country") or "",
        "vintage": product.get("vintage") or "",
        "wine_color": product.get("wine_color") or "",
    }


def build_user_prompt(facts: dict) -> str:
    lines = [f"Name: {facts['name']}"]
    if facts["grape_variety"]:
        lines.append(f"Grape variety: {facts['grape_variety']}")
    if facts["wine_color"]:
        lines.append(f"Colour: {facts['wine_color']}")
    if facts["region"]:
        lines.append(f"Region: {facts['region']}")
    if facts["country"]:
        lines.append(f"Country: {facts['country']}")
    if facts["vintage"]:
        lines.append(f"Vintage: {facts['vintage']}")
    return "\n".join(lines)


_JSON_RE = re.compile(r"\{.*?\}", re.DOTALL)


def parse_structural(text: str) -> dict:
    """Parse + validate a model response to {wine_body, wine_acidity, wine_tannin}.

    Raises StructuralError on non-JSON, missing fields, or off-scale values.
    """
    if not text:
        raise StructuralError("empty response")
    m = _JSON_RE.search(text)
    if not m:
        raise StructuralError(f"no JSON object found in: {text[:80]!r}")
    try:
        obj = json.loads(m.group(0))
    except (ValueError, TypeError) as e:
        raise StructuralError(f"invalid JSON: {e}") from e
    if not isinstance(obj, dict):
        raise StructuralError("response is not a JSON object")

    for key in ("body", "acidity", "tannin"):
        if key not in obj or not str(obj[key]).strip():
            raise StructuralError(f"missing field: {key}")

    body = _BODY.get(str(obj["body"]).strip().lower())
    acidity = _LH.get(str(obj["acidity"]).strip().lower())
    tannin = _LH.get(str(obj["tannin"]).strip().lower())
    if body is None:
        raise StructuralError(f"body off-scale: {obj['body']!r} (allowed {BODY_SCALE})")
    if acidity is None:
        raise StructuralError(f"acidity off-scale: {obj['acidity']!r} (allowed {LOWHIGH_SCALE})")
    if tannin is None:
        raise StructuralError(f"tannin off-scale: {obj['tannin']!r} (allowed {LOWHIGH_SCALE})")

    return {"wine_body": body, "wine_acidity": acidity, "wine_tannin": tannin}


INFERRED_FIELDS = ("wine_body", "wine_acidity", "wine_tannin")


def merge_into_product(product: dict, inferred: dict) -> bool:
    """Apply inferred structural values to a product in place.

    - Always writes the `<field>_inferred` provenance mirror.
    - Fills the flat `<field>` ONLY where currently empty (never overwrites a
      curated value), so the catalog gauge renders without losing curation.
    Returns True iff at least one flat field was filled.
    """
    changed = False
    for field in INFERRED_FIELDS:
        val = inferred[field]
        product[f"{field}_inferred"] = val
        if not product.get(field):
            product[field] = val
            changed = True
    return changed


# ---- target selection (no spend) ----

def is_wine_sku(sku: Optional[str]) -> bool:
    if not sku:
        return False
    s = sku.upper()
    if s.startswith("WEV"):  # wine-events accessory, not wine
        return False
    return s.startswith("W")


def in_stock(product: dict) -> bool:
    return str(product.get("is_in_stock", "")) == "1"


def needs_structural(product: dict) -> bool:
    return not (product.get("wine_body") and product.get("wine_acidity")
                and product.get("wine_tannin"))


def select_targets(products: list[dict]) -> list[dict]:
    """In-stock wines (by SKU) missing >=1 structural field, with usable signal."""
    out = []
    for p in products:
        if not is_wine_sku(p.get("sku")):
            continue
        if not in_stock(p) or not needs_structural(p):
            continue
        if not (p.get("grape_variety") or p.get("region") or p.get("country")):
            continue
        out.append(p)
    return out


def _load_key() -> Optional[str]:
    """Load ANTHROPIC_API_KEY from env or .env.local (never logged)."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    if ENV_LOCAL.exists():
        for line in ENV_LOCAL.read_text().splitlines():
            line = line.strip()
            if line.startswith("ANTHROPIC_API_KEY"):
                return line.partition("=")[2].strip().strip('"').strip("'")
    return None


def _write_export(export_path: Path, products: list[dict]) -> int:
    """Merge the structural cache into the export. Backup first; no spend."""
    if not CACHE_PATH.exists():
        print(f"ERROR: cache not found: {CACHE_PATH} (run the backfill first).",
              file=sys.stderr)
        return 1
    cache = json.loads(CACHE_PATH.read_text())
    print(f"Cache holds {len(cache)} structural results.")

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = export_path.with_suffix(export_path.suffix + f".bak-pre-p1-{ts}")
    shutil.copy2(export_path, backup)
    print(f"Backup: {backup}")

    by_sku = {p.get("sku"): p for p in products}
    filled = mirrored = skipped = 0
    for sku, inferred in cache.items():
        prod = by_sku.get(sku)
        if prod is None:
            skipped += 1
            continue
        if merge_into_product(prod, inferred):
            filled += 1
        mirrored += 1

    export_path.write_text(json.dumps(products, ensure_ascii=False))
    print(f"Merged: {mirrored} wines got _inferred mirrors; "
          f"{filled} had >=1 empty flat field filled; {skipped} skus not found.")
    print(f"Wrote {export_path}")
    print("NOTE (Rule 9): finder/catalog pick this up on next rebuild.")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    p.add_argument("--canary", type=int, default=None,
                   help="Process only the first N targets (Rule 10 canary). Spends.")
    p.add_argument("--dry-run", action="store_true",
                   help="Show the target count and exit. NO spend.")
    p.add_argument("--write-export", action="store_true",
                   help="Merge the cache into the export (backup first). NO spend, NO API.")
    p.add_argument("--model", default=MODEL)
    args = p.parse_args(argv)

    products = json.loads(args.export.read_text())
    targets = select_targets(products)
    print(f"P1 target: {len(targets)} in-stock wines missing structural data")

    if args.write_export:
        return _write_export(args.export, products)

    if args.dry_run:
        print("--dry-run: no API calls, nothing written.")
        return 0

    key = _load_key()
    if not key:
        print("ERROR: no ANTHROPIC_API_KEY (env or .env.local).", file=sys.stderr)
        return 1

    import anthropic
    client = anthropic.Anthropic(api_key=key)

    batch = targets if args.canary is None else targets[: args.canary]
    print(f"Processing {len(batch)} wines on {args.model}"
          + (" (CANARY)" if args.canary else "") + " ...\n")

    cache = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}
    in_tok = out_tok = ok = failed = 0
    results = []
    for prod in batch:
        sku = prod["sku"]
        facts = build_facts(prod)
        try:
            resp = client.messages.create(
                model=args.model,
                max_tokens=100,
                system=SYSTEM,
                messages=[{"role": "user", "content": build_user_prompt(facts)}],
            )
            in_tok += resp.usage.input_tokens
            out_tok += resp.usage.output_tokens
            text = next((b.text for b in resp.content if b.type == "text"), "")
            parsed = parse_structural(text)
            cache[sku] = parsed
            results.append((sku, prod.get("name", "")[:40], parsed))
            ok += 1
        except StructuralError as e:
            failed += 1
            results.append((sku, prod.get("name", "")[:40], f"REJECTED: {e}"))
        except Exception as e:  # noqa: BLE001 — surface API errors per row, keep going
            failed += 1
            results.append((sku, prod.get("name", "")[:40], f"API ERROR: {e}"))

    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2))

    for sku, name, res in results:
        print(f"  {sku}  {name}")
        print(f"      -> {res}")

    cost = in_tok * 1e-6 * 1.0 + out_tok * 1e-6 * 5.0  # Haiku $1/$5
    print(f"\n--- {ok} ok, {failed} failed ---")
    print(f"tokens: in={in_tok} out={out_tok}  cost(Haiku)=${cost:.4f}")
    print(f"cached -> {CACHE_PATH}")
    if args.canary:
        full = len(targets)
        per = cost / max(len(batch), 1)
        print(f"\nEXTRAPOLATED full run ({full} wines): ~${per*full:.3f}")
        print("CANARY ONLY — review the values above, then re-run without --canary "
              "to process all targets (writing to the export is a SEPARATE verified step).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
