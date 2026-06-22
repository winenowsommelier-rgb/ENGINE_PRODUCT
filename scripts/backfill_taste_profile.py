#!/usr/bin/env python3
"""P2 — backfill `taste_profile` (tiered notes) on in-stock wines.

PAID (Anthropic, Haiku). Gated by CLAUDE.md Rule 10.

Design (mirrors P1 scripts/backfill_structural.py):
- Target: in-stock wines (SKU `W*`, NOT `WEV`) missing taste_profile, with
  grape/region signal. Seeds the prompt with existing flavor_tags when present.
- Output constrained to the controlled vocab (data/lib/enrichment/shared/taste_vocab.yml,
  94 notes) — all 71 notes used by existing profiles are in it, so output renders
  in the catalog TasteWheel. parse_taste_profile validates every note against the
  vocab (substituting canonical names, dropping off-vocab), clamps intensity 1..3.
- The vocab list dominates the system prompt; it is identical per call, so it's
  marked cache_control to cut input cost on the full run.
- Writes a sidecar cache first; merge into the export is a separate verified step.
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
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.enrichment.shared.vocab_loader import VocabLoader  # noqa: E402

DEFAULT_EXPORT = REPO_ROOT / "data" / "live_products_export.json"
CACHE_PATH = REPO_ROOT / "data" / "taste_profile_backfill_cache.json"
VOCAB_PATH = REPO_ROOT / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"
ENV_LOCAL = REPO_ROOT / ".env.local"
MODEL = "claude-haiku-4-5"
TIERS = ("primary", "secondary", "tertiary")


class TasteProfileError(ValueError):
    """Raised when a model response can't be parsed/validated to a taste_profile."""


def build_taste_facts(product: dict) -> dict:
    """Minimal, leak-safe facts (no price/margin/internal fields)."""
    return {
        "name": product.get("name") or "",
        "variety": product.get("variety") or "",
        "region": product.get("region") or "",
        "country": product.get("country") or "",
        "color": product.get("color") or "",
        "flavor_tags": list(product.get("flavor_tags") or []),
    }


def build_system_prompt(vocab: VocabLoader) -> str:
    names = ", ".join(sorted(n.name for n in vocab.all_notes()))
    return (
        "You are an expert sommelier. Given a wine's facts, output ONLY a JSON object "
        "describing its taste profile as tiered notes — no prose, no markdown.\n"
        'Schema: {"primary":[{"note":<str>,"intensity":<1-3>}], "secondary":[...], '
        '"tertiary":[...]}.\n'
        "primary = 2-4 dominant fruit/character notes; secondary = 2-4 oak/production "
        "notes; tertiary = 1-3 aged/earthy notes. intensity 1 (subtle) to 3 (pronounced).\n"
        "If observed flavor notes are given, anchor your answer in them.\n"
        "Use ONLY these exact note names: " + names
    )


def build_user_prompt(facts: dict) -> str:
    lines = [f"Name: {facts['name']}"]
    for k, label in (("variety", "Grape"), ("color", "Colour"),
                     ("region", "Region"), ("country", "Country")):
        if facts.get(k):
            lines.append(f"{label}: {facts[k]}")
    if facts["flavor_tags"]:
        lines.append("Observed flavor notes: " + ", ".join(facts["flavor_tags"]))
    return "\n".join(lines)


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _clamp_intensity(v) -> int:
    try:
        i = int(v)
    except (ValueError, TypeError):
        return 2
    return max(1, min(3, i))


def parse_taste_profile(text: str, vocab: VocabLoader) -> dict:
    """Parse + validate a model response into a schema-2.0 tiered taste_profile."""
    if not text:
        raise TasteProfileError("empty response")
    m = _JSON_RE.search(text)
    if not m:
        raise TasteProfileError(f"no JSON object found in: {text[:80]!r}")
    try:
        obj = json.loads(m.group(0))
    except (ValueError, TypeError) as e:
        raise TasteProfileError(f"invalid JSON: {e}") from e
    if not isinstance(obj, dict):
        raise TasteProfileError("response is not a JSON object")

    tiers: dict[str, list] = {}
    total_valid = 0
    for tier in TIERS:
        out_notes = []
        for entry in (obj.get(tier) or []):
            if not isinstance(entry, dict):
                continue
            canon = vocab.lookup(str(entry.get("note", "")))
            if canon is None:  # drop off-vocab note
                continue
            note_obj = {"note": canon.name, "intensity": _clamp_intensity(entry.get("intensity", 2))}
            # de-dupe within tier by note name
            if not any(n["note"] == note_obj["note"] for n in out_notes):
                out_notes.append(note_obj)
                total_valid += 1
        tiers[tier] = out_notes

    if total_valid == 0:
        raise TasteProfileError("no valid (in-vocab) notes in response")

    return {"schema_version": "2.0", "structure": "tiered", "source": "ai_inferred", "tiers": tiers}


# ---- target selection (no spend) ----

def is_wine_sku(sku: Optional[str]) -> bool:
    if not sku:
        return False
    s = sku.upper()
    return s.startswith("W") and not s.startswith("WEV")


def in_stock(product: dict) -> bool:
    return str(product.get("is_in_stock", "")) == "1"


def has_taste_profile(product: dict) -> bool:
    tp = product.get("taste_profile")
    if not isinstance(tp, dict):
        return False
    tiers = tp.get("tiers") or {}
    return any(tiers.get(t) for t in TIERS)


def select_targets(products: list[dict]) -> list[dict]:
    out = []
    for p in products:
        if not is_wine_sku(p.get("sku")):
            continue
        if not in_stock(p) or has_taste_profile(p):
            continue
        if not (p.get("variety") or p.get("region")):
            continue
        out.append(p)
    return out


def merge_into_product(product: dict, profile: dict) -> bool:
    """Write taste_profile_inferred always; fill flat taste_profile only-if-empty."""
    product["taste_profile_inferred"] = profile
    if not has_taste_profile(product):
        product["taste_profile"] = profile
        return True
    return False


def _load_key() -> Optional[str]:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    if ENV_LOCAL.exists():
        for line in ENV_LOCAL.read_text().splitlines():
            if line.strip().startswith("ANTHROPIC_API_KEY"):
                return line.partition("=")[2].strip().strip('"').strip("'")
    return None


def _write_export(export_path: Path, products: list[dict]) -> int:
    if not CACHE_PATH.exists():
        print(f"ERROR: cache not found: {CACHE_PATH}", file=sys.stderr)
        return 1
    cache = json.loads(CACHE_PATH.read_text())
    print(f"Cache holds {len(cache)} taste profiles.")
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = export_path.with_suffix(export_path.suffix + f".bak-pre-p2-{ts}")
    shutil.copy2(export_path, backup)
    print(f"Backup: {backup}")
    by_sku = {p.get("sku"): p for p in products}
    filled = mirrored = skipped = 0
    for sku, profile in cache.items():
        prod = by_sku.get(sku)
        if prod is None:
            skipped += 1
            continue
        if merge_into_product(prod, profile):
            filled += 1
        mirrored += 1
    export_path.write_text(json.dumps(products, ensure_ascii=False))
    print(f"Merged: {mirrored} mirrors; {filled} flat taste_profile filled; {skipped} not found.")
    print("NOTE (Rule 9): finder/catalog pick this up on next rebuild.")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    p.add_argument("--canary", type=int, default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--write-export", action="store_true")
    p.add_argument("--model", default=MODEL)
    args = p.parse_args(argv)

    products = json.loads(args.export.read_text())
    targets = select_targets(products)
    print(f"P2 target: {len(targets)} in-stock wines missing taste_profile")

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
    vocab = VocabLoader.from_path(VOCAB_PATH)
    system = [{"type": "text", "text": build_system_prompt(vocab),
               "cache_control": {"type": "ephemeral"}}]  # cache the vocab list

    batch = targets if args.canary is None else targets[: args.canary]
    print(f"Processing {len(batch)} wines on {args.model}"
          + (" (CANARY)" if args.canary else "") + " ...\n")

    cache = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}
    in_tok = out_tok = cache_read = ok = failed = 0
    results = []
    for prod in batch:
        sku = prod["sku"]
        facts = build_taste_facts(prod)
        try:
            resp = client.messages.create(
                model=args.model, max_tokens=400, system=system,
                messages=[{"role": "user", "content": build_user_prompt(facts)}],
            )
            in_tok += resp.usage.input_tokens
            out_tok += resp.usage.output_tokens
            cache_read += getattr(resp.usage, "cache_read_input_tokens", 0) or 0
            text = next((b.text for b in resp.content if b.type == "text"), "")
            profile = parse_taste_profile(text, vocab)
            cache[sku] = profile
            counts = {t: len(profile["tiers"][t]) for t in TIERS}
            results.append((sku, prod.get("name", "")[:38], f"notes p/s/t = {counts['primary']}/{counts['secondary']}/{counts['tertiary']}"))
            ok += 1
        except TasteProfileError as e:
            failed += 1
            results.append((sku, prod.get("name", "")[:38], f"REJECTED: {e}"))
        except Exception as e:  # noqa: BLE001
            failed += 1
            results.append((sku, prod.get("name", "")[:38], f"API ERROR: {e}"))

    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
    for sku, name, res in results:
        print(f"  {sku}  {name}\n      -> {res}")

    cost = in_tok * 1e-6 * 1.0 + out_tok * 1e-6 * 5.0  # Haiku; cache_read billed ~0.1x (approx in 'in')
    print(f"\n--- {ok} ok, {failed} failed ---")
    print(f"tokens: in={in_tok} (cache_read={cache_read}) out={out_tok}  cost(Haiku)~${cost:.4f}")
    print(f"cached -> {CACHE_PATH}")
    if args.canary:
        per = cost / max(len(batch), 1)
        print(f"\nEXTRAPOLATED full run ({len(targets)} wines): ~${per*len(targets):.3f}"
              " (cache hits lower this on the real run)")
        print("CANARY ONLY — review, then re-run without --canary. Writing to the export "
              "is a SEPARATE verified step (--write-export).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
