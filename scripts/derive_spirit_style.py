#!/usr/bin/env python3
"""P3 — derive a new `spirit_style` field for whisky & spirits. Rule-based, NO API.

`spirit_style` means different things per category, so derivation is
category-routed:
  whisky : Single Malt / Blended / Peated / Sherried / Bourbon / Rye / Irish /
           Tennessee + cask finishes (Port-cask, Wine-cask)
  gin    : London Dry / Old Tom / Navy Strength / Flavoured
  rum    : White / Aged / Spiced / Dark / Overproof
  tequila: Blanco / Reposado / Añejo / Extra Añejo
  cognac : VS / VSOP / XO
  brandy : (cognac axis where applicable)
  vodka  : Flavoured / Plain
  mezcal : Joven / Reposado / Añejo

Pure functions; honest absence (returns [] when no rule matches — never guesses).
Lands `spirit_style` (list[str]) into live_products_export.json (Rule 9 target).

Usage:
    .venv/bin/python scripts/derive_spirit_style.py --dry-run   # coverage, no write
    .venv/bin/python scripts/derive_spirit_style.py             # apply (backs up first)
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EXPORT = REPO_ROOT / "data" / "live_products_export.json"
FIELD = "spirit_style"

# Islay/island peated distilleries (region 'Islay' also implies peat).
PEATED_DISTILLERIES = {
    "lagavulin", "laphroaig", "ardbeg", "caol ila", "bowmore", "bruichladdich",
    "kilchoman", "octomore", "port charlotte", "talisker", "ledaig", "ardmore",
}
BLENDED_BRANDS = {
    "johnnie walker", "chivas", "ballantine", "dewar", "famous grouse",
    "monkey shoulder", "naked", "grant", "teacher", "cutty sark", "j&b",
}
SCOTCH_MALT_REGIONS = {"speyside", "highland", "highlands", "islay", "islands",
                       "lowland", "campbeltown", "island"}


# The full controlled vocabulary of spirit_style tags (union across categories).
# The LLM fallback output is validated against this — anything else is dropped.
VALID_STYLES = {
    # whisky
    "Single Malt", "Blended", "Peated", "Sherried", "Bourbon", "Rye", "Irish",
    "Tennessee Whiskey", "Port-cask", "Wine-cask",
    # gin
    "London Dry", "Old Tom", "Navy Strength", "Flavoured",
    # rum
    "White", "Aged", "Spiced", "Dark", "Overproof",
    # tequila / mezcal
    "Blanco", "Reposado", "Añejo", "Extra Añejo", "Joven",
    # brandy / cognac
    "VS", "VSOP", "XO",
    # vodka
    "Plain",
}
# case-insensitive lookup -> canonical
_VALID_LC = {v.lower(): v for v in VALID_STYLES}

_ARRAY_RE = None  # lazy compile below


def parse_style_array(text: str) -> list[str]:
    """Parse an LLM JSON-array response into validated style tags.

    Tolerates surrounding prose; keeps only styles in VALID_STYLES (canonical
    casing); returns [] on non-array / unparseable / all-unknown.
    """
    import re
    global _ARRAY_RE
    if _ARRAY_RE is None:
        _ARRAY_RE = re.compile(r"\[.*?\]", re.DOTALL)
    if not text:
        return []
    m = _ARRAY_RE.search(text)
    if not m:
        return []
    try:
        arr = json.loads(m.group(0))
    except (ValueError, TypeError):
        return []
    if not isinstance(arr, list):
        return []
    out: list[str] = []
    for item in arr:
        canon = _VALID_LC.get(str(item).strip().lower())
        if canon and canon not in out:
            out.append(canon)
    return out


def _sku(p: dict) -> str:
    return (p.get("sku") or "").upper()


def spirit_category(product: dict) -> Optional[str]:
    """Route a product to a spirit category, or None if not a whisky/spirit."""
    s = _sku(product)
    if not s.startswith("L"):
        return None
    if any(s.startswith(x) for x in ("LSK", "LSJ", "LBE")):  # sake/shochu/beer
        return None
    if s.startswith("LWH"):
        return "whisky"

    name = (product.get("name") or "").lower()
    cls = (product.get("classification") or "").lower()
    hay = f"{cls} {name}"
    # order matters: more specific first
    if "whisk" in hay:
        return "whisky"
    if "gin" in hay:
        return "gin"
    if "tequila" in hay:
        return "tequila"
    if "mezcal" in hay:
        return "mezcal"
    if "rum" in hay or "cachaça" in hay or "cachaca" in hay:
        return "rum"
    if "cognac" in hay or "armagnac" in hay or "calvados" in hay or "brandy" in hay:
        return "brandy"
    if "vodka" in hay:
        return "vodka"
    if "liqueur" in cls or "absinthe" in hay:
        return "liqueur"
    return "spirit"  # generic L* spirit, category unknown


def _whisky_styles(name: str, region: str) -> list[str]:
    s: list[str] = []
    if any(k in name for k in ("sherry", "oloroso", "pedro xim", "px cask", "px-cask")):
        s.append("Sherried")
    if "port" in name:
        s.append("Port-cask")
    if any(k in name for k in ("sauternes", "wine cask", "wine-cask", "madeira")):
        s.append("Wine-cask")
    if (any(k in name for k in ("peat", "smoky", "smoke"))
            or any(d in name for d in PEATED_DISTILLERIES) or region == "islay"):
        s.append("Peated")
    if "single malt" in name or "singlemalt" in name:
        s.append("Single Malt")
    if any(b in name for b in BLENDED_BRANDS) or "blended" in name:
        s.append("Blended")
    if "rye" in name:
        s.append("Rye")
    if "bourbon" in name:
        s.append("Bourbon")
    if region in ("kentucky",) and "Bourbon" not in s:
        s.append("Bourbon")
    if region == "tennessee":
        s.append("Tennessee Whiskey")
    if "irish" in name or region in ("midlands", "midleton", "cork"):
        s.append("Irish")
    # Scotch single-malt region fallback (only if nothing else fired)
    if not s and region in SCOTCH_MALT_REGIONS:
        s.append("Single Malt")
    # de-dupe preserving order
    return list(dict.fromkeys(s))


def _gin_styles(name: str) -> list[str]:
    s = []
    if "london dry" in name:
        s.append("London Dry")
    if "old tom" in name:
        s.append("Old Tom")
    if "navy" in name:
        s.append("Navy Strength")
    if any(k in name for k in ("sloe", "pink", "flavoured", "flavored", "citrus", "berry")):
        s.append("Flavoured")
    return list(dict.fromkeys(s))


def _rum_styles(name: str) -> list[str]:
    s = []
    if "spiced" in name:
        s.append("Spiced")
    if any(k in name for k in ("white", "silver", "blanco", "light")):
        s.append("White")
    if any(k in name for k in ("dark", "black")):
        s.append("Dark")
    if any(k in name for k in ("aged", "anos", "años", "xo", "reserva", "gran reserva", "solera", "12 year", "15 year")):
        s.append("Aged")
    if any(k in name for k in ("overproof", "151", "navy")):
        s.append("Overproof")
    return list(dict.fromkeys(s))


def _agave_styles(name: str) -> list[str]:
    s = []
    if "extra añejo" in name or "extra anejo" in name:
        s.append("Extra Añejo")
    elif "añejo" in name or "anejo" in name:
        s.append("Añejo")
    if "reposado" in name:
        s.append("Reposado")
    if any(k in name for k in ("blanco", "silver", "plata", "joven")):
        s.append("Blanco")
    return list(dict.fromkeys(s))


def _brandy_styles(name: str) -> list[str]:
    s = []
    if "xo" in name:
        s.append("XO")
    if "vsop" in name:
        s.append("VSOP")
    if "vs " in name or name.endswith(" vs") or "v.s." in name:
        s.append("VS")
    return list(dict.fromkeys(s))


def _vodka_styles(name: str) -> list[str]:
    flavour_kw = ("flavoured", "flavored", "apple", "citrus", "vanilla", "raspberry",
                  "lime", "lemon", "orange", "peach", "berry", "twist")
    if any(k in name for k in flavour_kw):
        return ["Flavoured"]
    return ["Plain"]


def derive_spirit_style(product: dict) -> list[str]:
    """Return category-specific spirit_style tags, or [] when no rule matches."""
    cat = spirit_category(product)
    if cat is None:
        return []
    name = (product.get("name") or "").lower()
    region = (product.get("region") or "").lower()
    if cat == "whisky":
        return _whisky_styles(name, region)
    if cat == "gin":
        return _gin_styles(name)
    if cat == "rum":
        return _rum_styles(name)
    if cat in ("tequila", "mezcal"):
        return _agave_styles(name)
    if cat == "brandy":
        return _brandy_styles(name)
    if cat == "vodka":
        return _vodka_styles(name)
    return []  # liqueur / generic spirit: no style axis


def in_stock(product: dict) -> bool:
    return str(product.get("is_in_stock", "")) == "1"


# Categories that have a meaningful style axis (LLM fallback only targets these).
STYLE_CATS = {"whisky", "gin", "rum", "tequila", "mezcal", "brandy", "vodka"}

LLM_SYSTEM = (
    "You classify a spirit into style tags. Output ONLY a JSON array of short "
    "style strings, nothing else.\n"
    "Allowed tags by category:\n"
    "  gin: London Dry, Old Tom, Navy Strength, Flavoured\n"
    "  rum: White, Aged, Spiced, Dark, Overproof\n"
    "  tequila/mezcal: Blanco, Reposado, Añejo, Extra Añejo, Joven\n"
    "  brandy/cognac: VS, VSOP, XO\n"
    "  whisky: Single Malt, Blended, Peated, Sherried, Bourbon, Rye, Irish\n"
    "Use ONLY these exact tags. Most unmarked gins are 'London Dry'. "
    "If genuinely unknown, return []. No preamble, no markdown."
)


def _llm_user(product: dict) -> str:
    return (f"Category: {spirit_category(product)}\n"
            f"Name: {product.get('name')}\n"
            f"Region: {product.get('region')}\n"
            f"Classification: {product.get('classification')}")


def _load_key() -> Optional[str]:
    import os
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    env = REPO_ROOT / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith("ANTHROPIC_API_KEY"):
                return line.partition("=")[2].strip().strip('"').strip("'")
    return None


def run_llm_fill(products: list[dict], canary: Optional[int], model: str) -> int:
    """Fill empty spirit_style on style-bearing in-stock spirits via Haiku. PAID."""
    target = [p for p in products
              if spirit_category(p) in STYLE_CATS and in_stock(p) and not p.get("spirit_style")]
    print(f"LLM-fill target (style-bearing, in-stock, no rule style): {len(target)}")
    key = _load_key()
    if not key:
        print("ERROR: no ANTHROPIC_API_KEY.", file=sys.stderr)
        return 1
    import anthropic
    client = anthropic.Anthropic(api_key=key)
    system = [{"type": "text", "text": LLM_SYSTEM, "cache_control": {"type": "ephemeral"}}]
    batch = target if canary is None else target[:canary]
    print(f"Processing {len(batch)} on {model}" + (" (CANARY)" if canary else "") + " ...\n")

    in_tok = out_tok = ok = empty = 0
    for prod in batch:
        try:
            resp = client.messages.create(model=model, max_tokens=60, system=system,
                                          messages=[{"role": "user", "content": _llm_user(prod)}])
            in_tok += resp.usage.input_tokens
            out_tok += resp.usage.output_tokens
            text = next((b.text for b in resp.content if b.type == "text"), "")
            styles = parse_style_array(text)
            prod["spirit_style"] = styles          # write (may be [] = honest unknown)
            prod["spirit_style_inferred"] = styles  # provenance marker
            if styles:
                ok += 1
            else:
                empty += 1
            print(f"  {prod['sku']}  {prod.get('name','')[:38]} -> {styles}")
        except Exception as e:  # noqa: BLE001
            print(f"  {prod['sku']}  API ERROR: {e}")

    cost = in_tok * 1e-6 * 1.0 + out_tok * 1e-6 * 5.0
    print(f"\n--- {ok} styled, {empty} returned [] ---")
    print(f"tokens in={in_tok} out={out_tok}  cost(Haiku)~${cost:.4f}")
    if canary:
        per = cost / max(len(batch), 1)
        print(f"EXTRAPOLATED full LLM-fill ({len(target)}): ~${per*len(target):.3f}")
        print("CANARY ONLY — values NOT written to export (canary runs in memory). "
              "Review, then re-run --llm-fill without --canary to write + persist.")
        return 0
    # full run: persist
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = DEFAULT_EXPORT.with_suffix(DEFAULT_EXPORT.suffix + f".bak-pre-p3llm-{ts}")
    shutil.copy2(DEFAULT_EXPORT, backup)
    print(f"\nBackup: {backup}")
    DEFAULT_EXPORT.write_text(json.dumps(products, ensure_ascii=False))
    print(f"Wrote spirit_style (LLM-filled) to {DEFAULT_EXPORT}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    import collections
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--all", action="store_true",
                   help="Process all spirits, not just in-stock.")
    p.add_argument("--llm-fill", action="store_true",
                   help="PAID: Haiku-fill empty spirit_style on style-bearing spirits.")
    p.add_argument("--canary", type=int, default=None,
                   help="With --llm-fill: process only the first N (no write).")
    p.add_argument("--model", default="claude-haiku-4-5")
    args = p.parse_args(argv)

    products = json.loads(args.export.read_text())

    if args.llm_fill:
        return run_llm_fill(products, args.canary, args.model)
    cat_counts = collections.Counter()
    style_counts = collections.Counter()
    tagged = considered = 0

    for prod in products:
        cat = spirit_category(prod)
        if cat is None:
            continue
        if not args.all and not in_stock(prod):
            continue
        considered += 1
        cat_counts[cat] += 1
        styles = derive_spirit_style(prod)
        if not args.dry_run:
            prod[FIELD] = styles
        if styles:
            tagged += 1
            for s in styles:
                style_counts[s] += 1

    print(f"spirits considered ({'all' if args.all else 'in-stock'}): {considered}")
    print(f"  got >=1 style: {tagged} ({100*tagged/considered:.0f}%)")
    print(f"  by category: {dict(cat_counts.most_common())}")
    print(f"  style distribution: {dict(style_counts.most_common())}")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = args.export.with_suffix(args.export.suffix + f".bak-pre-p3-{ts}")
    shutil.copy2(args.export, backup)
    print(f"\nBackup: {backup}")
    args.export.write_text(json.dumps(products, ensure_ascii=False))
    print(f"Wrote {FIELD} to {args.export}")
    print("NOTE (Rule 9): finder/catalog pick this up on next rebuild.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
