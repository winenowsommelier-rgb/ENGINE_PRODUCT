"""Piedmont sub-chapter loader (Barolo/Barbaresco) — authored IN-SESSION from
The Wine Bible.

Mirrors `france/bordeaux.py`: we OVERWRITE the pre-existing Piedmont region
context with a book-cited, status='validated' one (the intended upgrade), link
the three confirmed Piedmontese grapes via `grown_in`, attach the region to the
italy-docg classification tier via `classified_under`, and record the two
narrative-derived benchmarks the book clearly supports (nebbiolo's forceful
tannin and structural high acidity).

All prose is extracted from the Italy/Piedmont chapter of `winebible.md`
(2nd ed., Karen MacNeil — Piedmont ~15414-15713, the nebbiolo cross-reference
~3441-3449); nothing here is web-sourced or paid-API generated. Every context
and benchmark carries a real CITATION (never a 'legacy:' marker), and we link
only to the existing region/grape/tier skeleton via `_helpers` / `ingest`
(which RAISE on a missing entity rather than blind-creating one).

Scope guard: NO `style` entity is created here — the Super Tuscan style belongs
to the Tuscany loader. We link ONLY the three grapes named in the book as
Piedmont's leading reds (nebbiolo, barbera, dolcetto), all of which already
exist (nebbiolo + barbera from Plan 1, dolcetto from Task 2).
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.italy import _helpers

CITATION = "Wine Bible 2e, Italy/Piedmont"

# The DOCG tier this region classifies under (created by tiers.load, which must
# have run first — enforced in the loader by looking the slug up and raising).
_DOCG_SLUG = "italy-docg"

# The three grapes the book names as Piedmont's leading reds; all confirmed
# present as entities. link_grape RAISES on a missing grape, so we link only
# these three (no whites here — the book's whites moscato/arneis/cortese are
# not part of this task's grape skeleton).
_GRAPES = ("nebbiolo", "barbera", "dolcetto")


def load(conn) -> None:
    rid = _helpers.find_region(conn, "Piedmont")

    # 1. Region context — the big picture from the book.
    region_full = (
        "Piedmont ('foot of the mountain'), lying in a remote amphitheatre of the "
        "Alps in northwestern Italy, is the country's preeminent fine-wine region "
        "and the homeland of the nebbiolo grape — no place in the world grows more "
        "of it, or has had more success with this difficult, highly site-specific "
        "variety (only about 8 percent of Piedmont's plantings). From nebbiolo come "
        "Barolo and Barbaresco, two of Italy's most legendary and serious reds — "
        "structured, tannic, ageworthy wines often likened to great red Bordeaux "
        "and, in the Italian mind, to the kingly status of France's cabernet "
        "sauvignon; Barolo is the more robust and austere (the 'king'), Barbaresco "
        "the slightly more graceful (the 'queen'). Both are grown in the Langhe "
        "hills of the southeast around the town of Alba, whose clay-limestone-sand "
        "soils and south-tilted 'bricco' and 'sori' slopes give maximum ripeness. "
        "The grape's very name comes from 'nebbia' (fog) — for the whitish bloom on "
        "the ripe grapes and the wisps of fog that envelop the hills at the late, "
        "cold-weather harvest — and its wines carry the classic 'tar and roses' "
        "aromatics, along with licorice, violets, leather and a rich, espresso-like "
        "bitterness from pronounced tannin. Piedmont shares Burgundy's philosophy "
        "that great wine is the progeny of a single perfectly adapted grape. "
        "Alongside the two great reds, the everyday Piedmontese table reds are "
        "barbera (the region's most widely planted grape — vibrant, sometimes "
        "rustic, high in acidity and low in tannin) and dolcetto (a juicy quaffing "
        "wine with an attractive bitter edge). The region also makes the playful "
        "semisweet sparkler Asti and the whites Gavi and arneis. Some 84 percent of "
        "Piedmont's wine is DOC or DOCG, and Barolo and Barbaresco were among the "
        "first four DOCGs, designated in 1980."
    )
    region_short = (
        "Italy's preeminent fine-wine region and nebbiolo's homeland: the tannic, "
        "ageworthy 'king and queen' reds Barolo & Barbaresco (Langhe hills around "
        "Alba, tar-and-roses aromatics born of the autumn 'nebbia' fog), with "
        "barbera and dolcetto as the everyday reds."
    )
    region_attrs = {
        "key_grapes": ["nebbiolo", "barbera", "dolcetto"],
        "climate": "continental/Alpine foothills; warmer, best sites in the "
                   "southeastern Langhe/Monferrato hills; late, cold-weather harvest",
        "key_wines": ["Barolo", "Barbaresco", "Barbera", "Dolcetto", "Asti",
                      "Gavi", "Arneis"],
        "classification_system": "Italian DOCG/DOC; Barolo & Barbaresco among the "
                                 "first four DOCGs (1980); 84% of Piedmont's wine "
                                 "is DOC or DOCG",
        "signature": "nebbiolo — highly site-specific, 'tar and roses', forceful "
                     "tannin; Barolo (robust/'king') vs Barbaresco (graceful/"
                     "'queen'), both from the Langhe around Alba",
    }
    region_ctx = ingest.upsert_context(
        conn, rid, "wine",
        short=region_short, full=region_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(region_attrs),
    )

    # 2. Grape links — the three confirmed Piedmontese reds (grape -> region
    #    'grown_in'). link_grape RAISES if any grape is missing.
    for slug in _GRAPES:
        _helpers.link_grape(conn, slug, rid)

    # 3. classified_under: Piedmont region -> italy-docg tier. The tier must have
    #    been created by tiers.load already; raise clearly if it wasn't.
    docg_row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='classification_tier' "
        "AND slug=?", (_DOCG_SLUG,)).fetchone()
    if not docg_row:
        raise ValueError(
            f"tier {_DOCG_SLUG!r} not found — run tiers.load(conn) before "
            "piedmont.load(conn)")
    ingest.add_relationship(conn, rid, docg_row[0], "classified_under")

    # 4. Benchmarks on the Piedmont region context — only what the book clearly
    #    supports, on the project's 1-5 gauge (per test seed 'wine.body'=4.0).
    #    Narrative-derived, so confidence='medium' and an explicit citation suffix.
    #    Nebbiolo (Barolo/Barbaresco) is famously HIGH tannin ("forceful tannin",
    #    "genetically high in tannin", tongue "shrink-wrapped") and structurally
    #    HIGH acidity (the backbone that makes it decades-ageworthy).
    bench_citation = CITATION + " (narrative-derived)"
    ingest.upsert_benchmark(
        conn, region_ctx, "wine.tannin",
        typical=4.5, low=4.0, high=5.0,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, region_ctx, "wine.acidity",
        typical=4.0, low=3.5, high=5.0,
        confidence="medium", source_citation=bench_citation)
