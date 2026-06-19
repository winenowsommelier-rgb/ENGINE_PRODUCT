#!/usr/bin/env python3
"""P4 — write `flavor_tags_canonical` onto the live products export.

What
----
Adds a NEW field `flavor_tags_canonical` (list of canonical note names from
`taste_vocab.yml`) to each product in `data/live_products_export.json`, derived
from the messy `flavor_tags` via the rule-based canonicalizer. The original
`flavor_tags` is left UNTOUCHED (display text preserved; reversible).

Why this file (Rule 9)
----------------------
The catalog/finder read `data/live_products_export.json`, NOT the SQLite DB
(which is empty). So P4 lands directly in the export. No API spend — pure
deterministic mapping against the existing controlled vocabulary.

Usage
-----
    .venv/bin/python scripts/apply_flavor_canonical.py --dry-run   # report only
    .venv/bin/python scripts/apply_flavor_canonical.py             # apply (backs up first)
    .venv/bin/python scripts/apply_flavor_canonical.py --limit 5   # canary slice

Per CLAUDE.md Rule 10: makes a timestamped backup before writing, and reports
coverage (products with >=1 canonical note) so the result is verified, not
inferred. Idempotent — safe to re-run.
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
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.enrichment.shared.flavor_canonicalizer import canonicalize_tag  # noqa: E402
from data.lib.enrichment.shared.vocab_loader import VocabLoader  # noqa: E402

DEFAULT_EXPORT = REPO_ROOT / "data" / "live_products_export.json"
DEFAULT_VOCAB = REPO_ROOT / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"

CANONICAL_FIELD = "flavor_tags_canonical"


def add_canonical_flavors(product: dict, vocab: VocabLoader) -> dict:
    """Return a NEW product dict with `flavor_tags_canonical` added.

    De-dupes canonical notes across all of the product's raw tags, preserving
    first-seen order. Does not mutate the input and never touches `flavor_tags`.
    """
    out = dict(product)
    canonical: list[str] = []
    for raw in (product.get("flavor_tags") or []):
        for note in canonicalize_tag(raw, vocab):
            if note not in canonical:
                canonical.append(note)
    out[CANONICAL_FIELD] = canonical
    return out


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    p.add_argument("--vocab", type=Path, default=DEFAULT_VOCAB)
    p.add_argument("--dry-run", action="store_true",
                   help="Report coverage without writing the file.")
    p.add_argument("--no-backup", action="store_true",
                   help="Skip the backup step (default is to back up).")
    p.add_argument("--limit", type=int, default=None,
                   help="Process only the first N products (canary).")
    args = p.parse_args(argv)

    if not args.export.exists():
        print(f"ERROR: export not found: {args.export}", file=sys.stderr)
        return 1
    if not args.vocab.exists():
        print(f"ERROR: vocab not found: {args.vocab}", file=sys.stderr)
        return 1

    vocab = VocabLoader.from_path(args.vocab)
    products = json.loads(args.export.read_text())
    if not isinstance(products, list):
        print(f"ERROR: expected a JSON list, got {type(products).__name__}", file=sys.stderr)
        return 1

    target = products if args.limit is None else products[: args.limit]

    tagged = with_canonical = total_notes = 0
    for i, prod in enumerate(target):
        updated = add_canonical_flavors(prod, vocab)
        products[i if args.limit is None else i] = updated
        if prod.get("flavor_tags"):
            tagged += 1
            if updated[CANONICAL_FIELD]:
                with_canonical += 1
            total_notes += len(updated[CANONICAL_FIELD])

    scope = f"first {len(target)}" if args.limit is not None else f"all {len(products)}"
    print(f"\nProcessed {scope} products")
    print(f"  with raw flavor_tags:        {tagged}")
    print(f"  got >=1 canonical note:      {with_canonical}"
          + (f"  ({100*with_canonical/tagged:.1f}% of tagged)" if tagged else ""))
    print(f"  total canonical notes set:   {total_notes}")

    if args.dry_run:
        print("\n--dry-run: no file written.")
        return 0

    if not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = args.export.with_suffix(args.export.suffix + f".bak-pre-p4-{ts}")
        shutil.copy2(args.export, backup)
        print(f"\nBackup: {backup}")

    args.export.write_text(json.dumps(products, ensure_ascii=False, indent=2))
    print(f"Wrote {CANONICAL_FIELD} to {args.export}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
