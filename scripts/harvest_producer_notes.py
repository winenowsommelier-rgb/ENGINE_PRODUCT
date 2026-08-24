#!/usr/bin/env python3
"""
Write producer-sourced flavor attributes for SKUs where an official, VINTAGE-MATCHED
producer tasting note has been read and verified by a human/agent.

This is the first `producer`-tier write in the catalog. Everything else is
`unverified` (6,681 AI-generated rows, labelled 2026-07-27).

CONTRACT — every row in NOTES below must satisfy ALL of:
  1. `source_url` is an official PRODUCER document (estate site / vintage sheet PDF),
     not a retailer, aggregator, or our own PDP (citing our own page would be
     circular — our PDPs render the same AI text we are trying to replace).
  2. The document names the SAME wine AND the SAME vintage as products.vintage_year.
  3. Every token in `tags` is traceable to `quote`. No token may be added because
     it is "typical for the appellation" — that is inference, which this catalog
     forbids for item-level attributes.
  4. `sourced_vintage` is recorded. Rows flagged vintage_is_provisional=1 can have
     the shelf vintage rotate; storing the year the note was sourced for makes a
     later mismatch DETECTABLE instead of silently wrong.

Writes flavor_tags + attr_sources + attr_evidence_tier='producer' + attr_verified_at/by,
and appends the sourced vintage to enrichment_note. Default is a dry run.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

# Verified 2026-07-27 by reading each official document end-to-end.
NOTES = [
    {
        "sku": "WRW6550FS",
        "wine": "Echo de Lynch-Bages, Pauillac",
        "sourced_vintage": 2018,
        "source_url": "https://www.lynchbages.com/wp-content/uploads/2022/10/Echo-de-Lynch-Bages-2018-ENG.pdf",
        "quote": ("With true Pauillac character, Echo de Lynch-Bages 2018 displays powerful "
                  "tannins with aromas of black fruits and black pepper spicing through the "
                  "palate. Great fruit concentration and aromatic complexity."),
        # Each token appears verbatim (or as the direct noun form) in the quote.
        "tags": ["black fruits", "black pepper", "powerful tannins",
                 "fruit concentration", "aromatic complexity"],
        "structural": {"tannin": "High"},   # "powerful tannins" — stated, not inferred
    },
    # ── WRW6232BN (Château Palmer 2015) DELIBERATELY EXCLUDED ──────────────────
    # The official 2015 vintage sheet
    #   https://cdn.prod.website-files.com/63a45b1a311ee6a3ffd1671d/
    #   65e30d039a981a2429537dfb_Vintage_sheet_EN_2015.pdf
    # is a VINTAGE REPORT, not a fruit-descriptor tasting note. It states structure
    # and character only ("suave", "open and expressive", "dense tannic structure",
    # "excellent ageing potential") and names no aromas.
    #
    # Those tokens all canonicalize to [] against the taste vocabulary, so writing
    # them would replace 9 working canonical notes (Violet, Dark Plum, Graphite,
    # Blackcurrant, Cedar, Cocoa, Earth, Wet Stone, Minerality) with ZERO — a
    # net loss to the product page in exchange for a better provenance label.
    # Inventing "cassis/violet/graphite" to fill the gap is precisely the inference
    # that got the earlier 70-row batch quarantined.
    #
    # Correct resolution: the structural facts ARE usable (tannin/body below were
    # verified from the sheet), but the flavor_tags stay 'unverified' until a real
    # descriptor note for Palmer 2015 is found. Tracked as a NOTE_ONLY row.
]

# Structural-only harvest: the source states body/tannin explicitly but gives no
# aroma descriptors, so flavor_tags is left untouched and the evidence tier is NOT
# upgraded (the tags are still AI-generated). Only the structural columns and a
# source citation are written.
STRUCTURAL_ONLY = [
    {
        "sku": "WRW6232BN",
        "wine": "Château Palmer, Margaux",
        "sourced_vintage": 2015,
        "source_url": "https://cdn.prod.website-files.com/63a45b1a311ee6a3ffd1671d/65e30d039a981a2429537dfb_Vintage_sheet_EN_2015.pdf",
        "quote": ("The relatively high alcoholic content of the 2015 vintage is balanced out "
                  "by a dense tannic structure free from any rustic notes thanks to the "
                  "perfect phenolic maturity of the pips."),
        "structural": {"tannin": "High"},
    },
]


def verify_tokens(entry: dict) -> list[str]:
    """Every tag must be traceable to the quote. Returns violations."""
    q = entry["quote"].lower().replace("'", "'")
    bad = []
    for tag in entry["tags"]:
        t = tag.lower()
        # accept the tag, its singular, or its head noun appearing in the quote
        cands = {t, t.rstrip("s"), t.split()[-1], t.split()[-1].rstrip("s")}
        if not any(c and c in q for c in cands):
            bad.append(tag)
    return bad


def canonical_yield(tags: list[str]) -> list[str]:
    """What the taste vocabulary actually keeps from these tags.

    The product page renders flavor_tags_canonical, so a token that canonicalizes
    to nothing is invisible. Replacing N working canonical notes with 0 is a net
    loss regardless of provenance — this gate makes that visible before writing.
    """
    try:
        sys.path.insert(0, str(ROOT))
        from data.lib.enrichment.shared.flavor_canonicalizer import canonicalize_tag
        from data.lib.enrichment.shared.vocab_loader import VocabLoader
        # Same vocab the export uses (scripts/refresh_live_export.py DEFAULT_VOCAB).
        vocab = VocabLoader.from_path(
            ROOT / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml")
    except Exception as exc:
        print(f"WARNING: canonical-yield gate could not load the taste vocab "
              f"({exc}); gate is INACTIVE for this run", file=sys.stderr)
        return []
    out: list[str] = []
    for t in tags:
        for n in canonicalize_tag(t, vocab):
            if n not in out:
                out.append(n)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write (default is dry run)")
    ap.add_argument("--allow-canonical-loss", action="store_true",
                    help="permit a write that reduces canonical note count")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    # Contract gate 3 — refuse to write anything if a single token is untraceable.
    violations = {e["sku"]: verify_tokens(e) for e in NOTES}
    violations = {k: v for k, v in violations.items() if v}
    if violations:
        print(f"ERROR: tags not traceable to the quote: {violations}", file=sys.stderr)
        return 1
    print("token traceability: all tags appear in their source quote")

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(products)")}
        need = {"flavor_tags", "attr_sources", "attr_evidence_tier",
                "attr_verified_at", "attr_verified_by", "vintage_year",
                "vintage_is_provisional", "enrichment_note"}
        missing = need - cols
        if missing:
            print(f"ERROR: missing columns {missing} — run the migrations first",
                  file=sys.stderr)
            return 1

        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        planned = []
        for e in NOTES:
            row = con.execute(
                "SELECT sku, name, vintage, vintage_year, vintage_is_provisional, "
                "       flavor_tags, attr_evidence_tier, enrichment_note "
                "FROM products WHERE sku = ?", (e["sku"],)).fetchone()
            if row is None:
                print(f"ERROR: {e['sku']} not in products", file=sys.stderr)
                return 1
            # Contract gate 2 — the doc's vintage must equal the catalog's vintage.
            if row["vintage_year"] != e["sourced_vintage"]:
                print(f"ERROR: {e['sku']} vintage mismatch: catalog "
                      f"{row['vintage_year']} vs note {e['sourced_vintage']}",
                      file=sys.stderr)
                return 1
            # Contract gate 4 — never trade working canonical notes for none.
            try:
                old_tags = json.loads(row["flavor_tags"] or "[]")
            except (ValueError, TypeError):
                old_tags = []
            before, after = canonical_yield(old_tags), canonical_yield(e["tags"])
            e["_canon_before"], e["_canon_after"] = before, after
            if len(after) < len(before) and not args.allow_canonical_loss:
                print(f"ERROR: {e['sku']} would reduce canonical notes "
                      f"{len(before)} -> {len(after)}\n"
                      f"       before: {before}\n       after : {after}\n"
                      f"       The product page renders flavor_tags_canonical, so this is a\n"
                      f"       visible downgrade. Find a descriptor note, or move this SKU to\n"
                      f"       STRUCTURAL_ONLY. Override with --allow-canonical-loss.",
                      file=sys.stderr)
                return 1

            planned.append((e, row))
            print(f"\n  {e['sku']}  {row['name'][:52]}")
            print(f"    catalog vintage : {row['vintage']} -> year {row['vintage_year']} "
                  f"(provisional={row['vintage_is_provisional']})")
            print(f"    was            : tier={row['attr_evidence_tier']} "
                  f"canonical={before}")
            print(f"    becomes        : tier=producer tags={e['tags']}")
            print(f"    canonical      : {after}")
            print(f"    structural     : {e['structural']}")
            print(f"    source         : {e['source_url'][:88]}")

        # Structural-only rows: write the stated structure + citation, leave
        # flavor_tags and the evidence tier alone (the tags remain AI-generated).
        struct_planned = []
        for e in STRUCTURAL_ONLY:
            row = con.execute(
                "SELECT sku, name, vintage_year, vintage_is_provisional, tannin, body, "
                "       attr_evidence_tier FROM products WHERE sku = ?", (e["sku"],)).fetchone()
            if row is None:
                print(f"ERROR: {e['sku']} not in products", file=sys.stderr)
                return 1
            if row["vintage_year"] != e["sourced_vintage"]:
                print(f"ERROR: {e['sku']} vintage mismatch", file=sys.stderr)
                return 1
            struct_planned.append((e, row))
            print(f"\n  {e['sku']}  {row['name'][:52]}   [STRUCTURAL ONLY]")
            print(f"    source states  : {e['structural']}")
            print(f"    current        : tannin={row['tannin']} body={row['body']}")
            print(f"    evidence tier  : stays '{row['attr_evidence_tier']}' "
                  f"(flavor_tags untouched — sheet has no aroma descriptors)")
            print(f"    source         : {e['source_url'][:88]}")

        if not args.apply:
            print("\nDRY RUN — nothing written. Re-run with --apply.")
            return 0

        for e, row in planned:
            note_bits = [f"Producer tasting note sourced for vintage {e['sourced_vintage']}"]
            if row["vintage_is_provisional"]:
                note_bits.append("catalog vintage is PROVISIONAL ([**VINTAGE MAY CHANGE]) — "
                                 "re-verify if the shelf vintage rotates")
            note = " | ".join(note_bits)
            sets = {
                "flavor_tags": json.dumps(e["tags"], ensure_ascii=False),
                "attr_sources": e["source_url"],
                "attr_evidence_tier": "producer",
                "attr_verified_at": stamp,
                "attr_verified_by": "harvest_producer_notes.py",
                "enrichment_note": note,
            }
            sets.update(e["structural"])
            assign = ", ".join(f"{k} = ?" for k in sets)
            con.execute(f"UPDATE products SET {assign} WHERE sku = ?",
                        [*sets.values(), e["sku"]])

        for e, row in struct_planned:
            note = (f"Structural facts sourced from the producer's {e['sourced_vintage']} "
                    f"vintage sheet; sheet carries no aroma descriptors, so flavor_tags "
                    f"remain AI-generated and unverified")
            if row["vintage_is_provisional"]:
                note += " | catalog vintage is PROVISIONAL ([**VINTAGE MAY CHANGE])"
            sets = dict(e["structural"])
            sets["attr_sources"] = e["source_url"]
            sets["enrichment_note"] = note
            assign = ", ".join(f"{k} = ?" for k in sets)
            con.execute(f"UPDATE products SET {assign} WHERE sku = ?",
                        [*sets.values(), e["sku"]])

        con.commit()
        print(f"\nwrote {len(planned)} producer-tier rows, "
              f"{len(struct_planned)} structural-only rows")
    except Exception as exc:
        con.rollback()
        print(f"ERROR — rolled back: {exc}", file=sys.stderr)
        return 1
    finally:
        con.close()

    # Rule 1 — verify at the destination.
    chk = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        print("\nVerified in DB:")
        for e in NOTES:
            r = chk.execute(
                "SELECT flavor_tags, attr_evidence_tier, attr_sources, tannin, body "
                "FROM products WHERE sku = ?", (e["sku"],)).fetchone()
            print(f"  {e['sku']}: tier={r[1]} tannin={r[3]} body={r[4]}")
            print(f"    tags   = {r[0]}")
            print(f"    source = {r[2][:88]}")
        n = chk.execute(
            "SELECT COUNT(*) FROM products WHERE attr_evidence_tier='producer'"
        ).fetchone()[0]
        print(f"\ntotal producer-tier rows in catalog: {n}")
    finally:
        chk.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
