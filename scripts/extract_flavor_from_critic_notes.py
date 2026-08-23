#!/usr/bin/env python3
"""
Extract flavor descriptors from VINTAGE-MATCHED critic tasting notes already stored
in critic_scores.notes, and (optionally) promote them to products.flavor_tags at
evidence tier 'critic'.

WHY THIS IS EXTRACTION, NOT INFERENCE
-------------------------------------
Tokens are produced by matching the project's OWN taste vocabulary
(data/lib/enrichment/shared/taste_vocab.yml, 291 alias surface terms -> 94 canonical
notes) against the critic's text, keeping only aliases that appear VERBATIM as whole
words. Nothing is added because it is "typical for the appellation". If the critic
did not write it, it is not emitted.

Audited 2026-07-27:
  * critic_scores.source_url is 0/3187 — there are no URLs to cite. Provenance is
    therefore critic name + score + vintage, plus the extracted-from text length,
    which is re-checkable against the row.
  * 1,777 rows carry notes across 789 SKUs; 647 SKUs have a critic vintage equal to
    products.vintage_year; 637 of those yield >= 1 canonical note (median 8).
  * Median 30% of the current AI tags are confirmed by the critic; median 5 AI tags
    per SKU appear nowhere in the note. The AI data is mostly unsupported.

VINTAGE MATCHING IS MANDATORY
A critic note for a different vintage describes a different wine. Rows whose critic
vintage does not equal products.vintage_year are skipped and counted, never coerced.
Both sides are parsed with the same year regex used by migrate_add_vintage_year.py,
so "2018 [**VINTAGE MAY CHANGE]" matches 2018.

Default is a dry run. --apply writes flavor_tags, attr_evidence_tier='critic',
attr_sources (critic attribution string), attr_verified_at/by, enrichment_note.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sqlite3
import statistics
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"
VOCAB_PATH = ROOT / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"

YEAR = re.compile(r"((?:19|20)\d{2})")
# The stored notes open with "<strong>94 points Wine Spectator</strong>" — strip it
# or the critic's name and the score leak into the extracted descriptors.
SCORE_HEADER = re.compile(
    r"^\s*\d{2,3}\s*(?:\+)?\s*(?:points?|pts?|point)\s*(?:by)?\s*[A-Za-z .&'-]*", re.I)


def strip_html(raw: str | None) -> str:
    t = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def note_body(raw: str | None) -> str:
    """Visible critic prose with the score/critic header removed."""
    return SCORE_HEADER.sub("", strip_html(raw)).strip(' "“”')


def year_of(text: str | None) -> int | None:
    m = YEAR.search(text or "")
    return int(m.group(1)) if m else None


# ── False-positive guards, each verified against the real critic corpus ──────
#
# 1. "bitter" -> Bitter. The vocabulary maps the bare adjective, so it fires inside
#    "bitter chocolate" (5 occurrences — the intended note is Cocoa) and inside
#    "bitterness" (9). A taste AXIS is not an aroma descriptor; only accept it when
#    the critic uses it as a standalone sensory claim.
# 2. "pine" -> Piney Hops. 'pine' is an alias of a BEER note, but appears 12 times in
#    wine notes as a resinous aroma. Emitting "Piney Hops" for a Margaux is wrong, so
#    the bare 'pine' alias is dropped; explicit "piney hops"/"resinous hops" still map.
CONTEXT_BLOCKED = {
    # canonical note -> patterns that must NOT count as a match for it
    "Bitter": [re.compile(r"bitter\s+(?:chocolate|cocoa|orange|almond|herb)", re.I)],
}
# aliases too ambiguous to trust in a wine/spirits corpus
ALIAS_DENYLIST = {"pine"}


class Extractor:
    def __init__(self, vocab):
        self.vocab = vocab
        # longest-first so "black cherry" wins over "cherry"
        self.aliases = [a for a in sorted(vocab._by_alias, key=len, reverse=True)
                        if a not in ALIAS_DENYLIST]
        self._res = {a: re.compile(r"(?<![a-z])" + re.escape(a) + r"(?![a-z])")
                     for a in self.aliases}

    def canonical_notes(self, text: str) -> list[str]:
        low = " " + text.lower() + " "
        out: list[str] = []
        for a in self.aliases:
            m = self._res[a].search(low)
            if not m:
                continue
            note = self.vocab.lookup(a)
            name = getattr(note, "name", None)
            if not name or name in out:
                continue
            # Drop a hit whose only occurrences sit inside a blocked phrase.
            blockers = CONTEXT_BLOCKED.get(name)
            if blockers:
                spans = [mm.span() for mm in self._res[a].finditer(low)]
                blocked = {b for pat in blockers for bm in pat.finditer(low)
                           for b in (bm.span(),)}
                if all(any(bs <= s and e <= be for bs, be in blocked) for s, e in spans):
                    continue
            out.append(name)
        return out


def load_vocab():
    sys.path.insert(0, str(ROOT))
    from data.lib.enrichment.shared.vocab_loader import VocabLoader
    return VocabLoader.from_path(VOCAB_PATH)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="write (default is dry run)")
    ap.add_argument("--limit", type=int, default=0, help="canary: only N SKUs")
    ap.add_argument("--only-gains", action="store_true",
                    help="skip SKUs where the critic yields fewer canonical notes")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    vocab = load_vocab()
    ex = Extractor(vocab)
    from data.lib.enrichment.shared.flavor_canonicalizer import canonicalize_tag

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(products)")}
        need = {"flavor_tags", "attr_sources", "attr_evidence_tier", "attr_verified_at",
                "attr_verified_by", "vintage_year", "vintage_is_provisional"}
        if need - cols:
            print(f"ERROR: missing columns {need - cols} — run the migrations first",
                  file=sys.stderr)
            return 1

        rows = con.execute("""
            SELECT cs.sku, cs.critic, cs.score, cs.vintage AS critic_vintage, cs.notes,
                   p.name, p.vintage, p.vintage_year, p.vintage_is_provisional,
                   p.flavor_tags, p.attr_evidence_tier
              FROM critic_scores cs
              JOIN products p ON p.sku = cs.sku
             WHERE COALESCE(cs.notes,'') <> ''
             ORDER BY cs.sku, cs.score DESC
        """).fetchall()

        skipped = Counter()
        agg: dict[str, dict] = {}
        for r in rows:
            cy, py = year_of(r["critic_vintage"]), r["vintage_year"]
            if py is None:
                skipped["product_has_no_parsed_vintage"] += 1
                continue
            if cy is None:
                skipped["critic_row_has_no_vintage"] += 1
                continue
            if cy != py:
                skipped["vintage_mismatch"] += 1
                continue
            body = note_body(r["notes"])
            got = ex.canonical_notes(body)
            if not got:
                skipped["no_vocab_terms_in_note"] += 1
                continue
            e = agg.setdefault(r["sku"], {
                "sku": r["sku"], "name": r["name"], "vintage": r["vintage"],
                "vintage_year": py, "provisional": r["vintage_is_provisional"],
                "flavor_tags": r["flavor_tags"], "tier": r["attr_evidence_tier"],
                "notes_new": [], "critics": [], "chars": 0,
            })
            for n in got:
                if n not in e["notes_new"]:
                    e["notes_new"].append(n)
            e["critics"].append(f"{r['critic']} {int(r['score'])}")
            e["chars"] += len(body)

        # Compare against what the current AI tags canonicalize to.
        plan, deltas = [], []
        for e in agg.values():
            try:
                cur = json.loads(e["flavor_tags"] or "[]")
            except (ValueError, TypeError):
                cur = []
            before: list[str] = []
            for t in cur:
                for n in canonicalize_tag(t, vocab):
                    if n not in before:
                        before.append(n)
            e["before"], e["after"] = before, e["notes_new"]
            e["delta"] = len(e["after"]) - len(before)
            e["confirmed"] = sorted(set(before) & set(e["after"]))
            e["unsupported"] = sorted(set(before) - set(e["after"]))
            if args.only_gains and e["delta"] < 0:
                skipped["would_lose_notes"] += 1
                continue
            plan.append(e)
            deltas.append(e["delta"])

        plan.sort(key=lambda x: -x["delta"])
        if args.limit:
            plan = plan[:args.limit]

        print(f"critic rows with notes            : {len(rows)}")
        print(f"skipped: {dict(skipped)}")
        print(f"SKUs eligible                     : {len(agg)}")
        print(f"SKUs in this run                  : {len(plan)}")
        if deltas:
            print(f"canonical-note delta              : median {statistics.median(deltas):+.0f}, "
                  f"gain {sum(1 for d in deltas if d>0)}, "
                  f"lose {sum(1 for d in deltas if d<0)}, flat {sum(1 for d in deltas if d==0)}")

        for e in plan:
            print(f"\n  {e['sku']}  {e['name'][:50]}")
            print(f"    vintage   : {e['vintage']} -> {e['vintage_year']} "
                  f"(provisional={e['provisional']})")
            print(f"    critics   : {', '.join(e['critics'])}")
            print(f"    BEFORE ({len(e['before']):>2}): {e['before']}")
            print(f"    AFTER  ({len(e['after']):>2}): {e['after']}   [{e['delta']:+d}]")
            print(f"    confirmed : {e['confirmed']}")
            print(f"    dropped   : {e['unsupported']}  (AI notes absent from the critic text)")

        if not args.apply:
            print("\nDRY RUN — nothing written. Re-run with --apply.")
            return 0

        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for e in plan:
            attrib = "; ".join(e["critics"]) + f" (vintage {e['vintage_year']})"
            note = (f"Flavor notes extracted verbatim from vintage-matched critic tasting "
                    f"notes ({attrib}); {e['chars']} chars of source text in critic_scores")
            if e["provisional"]:
                note += (" | catalog vintage is PROVISIONAL ([**VINTAGE MAY CHANGE]) — "
                         "re-verify if the shelf vintage rotates")
            con.execute(
                """UPDATE products
                      SET flavor_tags = ?, attr_sources = ?, attr_evidence_tier = 'critic',
                          attr_verified_at = ?, attr_verified_by = ?, enrichment_note = ?
                    WHERE sku = ?""",
                (json.dumps(e["after"], ensure_ascii=False), attrib, stamp,
                 "extract_flavor_from_critic_notes.py", note, e["sku"]))
        con.commit()
        print(f"\nwrote {len(plan)} rows at tier 'critic'")
    except Exception as exc:
        con.rollback()
        print(f"ERROR — rolled back: {exc}", file=sys.stderr)
        return 1
    finally:
        con.close()

    chk = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        print("\nVerified in DB:")
        for tier, n in chk.execute(
                """SELECT COALESCE(attr_evidence_tier,'(null)'), COUNT(*)
                     FROM products GROUP BY 1 ORDER BY 2 DESC"""):
            print(f"  {tier:<12} {n}")
    finally:
        chk.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
