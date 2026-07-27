"""Veneto sub-chapter loader (Soave / Valpolicella-Amarone / Prosecco) —
authored IN-SESSION from The Wine Bible.

Mirrors `italy/piedmont.py`: we OVERWRITE the pre-existing Veneto region
context with a book-cited, status='validated' one (the intended upgrade), link
the three confirmed Venetian grapes via `grown_in`, attach the region to the
italy-docg classification tier via `classified_under`, and record the ONE
narrative-derived benchmark the book unambiguously supports (amarone/corvina's
very full, high-alcohol body — 15-16% alcohol, "Portlike body", "powerhouse").

All prose is extracted from the Italy/Veneto chapter of `winebible.md`
(2nd ed., Karen MacNeil — The Veneto ~16206-16745; Soave ~16457; Prosecco
~16489; Amarone ~16519-16567). Nothing here is web-sourced or paid-API
generated. Every context and benchmark carries a real CITATION (never a
'legacy:' marker), and we link only to the existing region/grape/tier skeleton
via `_helpers` / `ingest` (which RAISE on a missing entity rather than
blind-creating one).

Scope guard: NO `style` entity is created here (the appassimento/dried-grape
method is described in prose, not modelled as a style entity in this task). We
link ONLY the three grapes the book names as the Veneto's key native varieties
for its signature wines — garganega (Soave), corvina (Valpolicella/amarone),
glera (Prosecco) — all of which already exist (created by grapes.load in Task 2).

Benchmark discipline: only ONE region-level benchmark is recorded — a HIGH
wine.body value, defensible from the book's explicit "15 to 16 percent alcohol",
"Portlike body", "opulent, full-bodied", "powerhouse" language about amarone.
Soave and Prosecco are light/crisp, so a single region-average body benchmark
would be contradictory; instead the amarone body figure is recorded as the
region's SIGNATURE benchmark (its most distinctive, book-emphasised wine),
narrative-derived and cited. No acidity/tannin benchmarks are asserted — the
book does not give a defensible region-wide figure for those.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.italy import _helpers

CITATION = "Wine Bible 2e, Italy/Veneto"

# The DOCG tier this region classifies under (created by tiers.load, which must
# have run first — enforced in the loader by looking the slug up and raising).
_DOCG_SLUG = "italy-docg"

# The three grapes the book names as the Veneto's key native varieties for its
# signature wines; all confirmed present as entities (grapes.load, Task 2).
# link_grape RAISES on a missing grape, so we link only these three.
_GRAPES = ("garganega", "corvina", "glera")


def load(conn) -> None:
    vid = _helpers.find_region(conn, "Veneto")

    # 1. Region context — the big picture from the book.
    region_full = (
        "The Veneto, in Italy's northeast around Venice and Verona, is the "
        "leading wine-producing region of the north by volume and in some years "
        "the most prolific region in all of Italy — much of it forgettable, mass "
        "produced, and once shipped in oceans to the United States and Britain, "
        "yet the region is also home to some great classics. Three wines define "
        "it. Soave, one of Italy's best-known exported whites, comes from the "
        "castle-topped hill town east of Verona and is built on garganega (an old "
        "Veronese grape grown since the Renaissance), blended with 'trebbiano di "
        "Soave' (actually verdicchio bianco); at its best it is light, fresh and "
        "smooth (soave means 'suave'/'smooth'), rising through Soave Classico to "
        "Classico Superiore. Valpolicella and its powerful amarone are made near "
        "Verona chiefly from corvina (corvina Veronese), the leading native red "
        "grape, with rondinella, molinara and sometimes negrara. Amarone ('great "
        "bitter one') is produced by the appassimento method: the ripest whole "
        "bunches are dried on bamboo racks or in cool lofts for three to four "
        "months, losing up to a third of their weight, which concentrates their "
        "sugar and flavour — the fermented result is opulent, full-bodied and, at "
        "15 to 16 percent alcohol, far higher than a regular Valpolicella (around "
        "12 percent), a powerhouse with a Portlike body and deep bitter-chocolate, "
        "mocha, dried-fig and earthy flavours. The same drying method gives the "
        "sweet reciotos (recioto della Valpolicella, recioto di Soave), while "
        "Valpolicella ripasso is re-passed over amarone pomace for extra body. "
        "Third is Prosecco, the Veneto's ubiquitous, chic, casual spumante made "
        "principally from glera (the grape formerly called prosecco, renamed in "
        "2009) by the tank-fermented Charmat process — fully sparkling, dry and "
        "fruity with an appealing bitter edge, and the base of the Bellini "
        "cocktail; the best come from the Conegliano-Valdobbiadene hills north of "
        "Venice, elevated to DOCG in 2009."
    )
    region_short = (
        "The north's biggest wine region by volume, home to three classics: Soave "
        "(garganega white, east of Verona), Valpolicella and its powerful amarone "
        "(corvina, dried by the appassimento method to a full-bodied 15-16% "
        "'great bitter one'), and Prosecco (glera sparkling, the Bellini's base)."
    )
    region_attrs = {
        "key_grapes": ["garganega", "corvina", "glera"],
        "climate": "relatively cool northern Italy; broad fertile Adige/Po "
                   "plains, with the best vines on well-drained volcanic hill "
                   "soils near Lake Garda, Verona, and the Treviso hills",
        "key_wines": ["Soave", "Valpolicella", "Amarone", "Prosecco",
                      "Recioto della Valpolicella", "Recioto di Soave",
                      "Valpolicella ripasso", "Bardolino"],
        "classification_system": "Italian DOCG/DOC; Italy's biggest DOC-volume "
                                 "region; Prosecco di Conegliano-Valdobbiadene "
                                 "elevated to DOCG in 2009",
        "signature": "amarone — corvina dried by the appassimento method to an "
                     "opulent, full-bodied 15-16% alcohol 'great bitter one'; "
                     "plus garganega-based Soave and glera-based Prosecco",
        "method_note": "appassimento — ripest bunches dried 3-4 months, losing up "
                       "to a third of their weight, concentrating sugar/flavour "
                       "(dry amarone; sweet reciotos)",
    }
    region_ctx = ingest.upsert_context(
        conn, vid, "wine",
        short=region_short, full=region_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(region_attrs),
    )

    # 2. Grape links — the three confirmed Venetian grapes (grape -> region
    #    'grown_in'). link_grape RAISES if any grape is missing.
    for slug in _GRAPES:
        _helpers.link_grape(conn, slug, vid)

    # 3. classified_under: Veneto region -> italy-docg tier. The tier must have
    #    been created by tiers.load already; raise clearly if it wasn't.
    docg_row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='classification_tier' "
        "AND slug=?", (_DOCG_SLUG,)).fetchone()
    if not docg_row:
        raise ValueError(
            f"tier {_DOCG_SLUG!r} not found — run tiers.load(conn) before "
            "veneto.load(conn)")
    ingest.add_relationship(conn, vid, docg_row[0], "classified_under")

    # 4. Benchmark on the Veneto region context — only what the book clearly
    #    supports, on the project's 1-5 gauge (per test seed 'wine.body'=4.0).
    #    Narrative-derived, so confidence='medium' with an explicit citation
    #    suffix. Amarone (the region's signature, book-emphasised red) is
    #    explicitly "opulent, full-bodied", "Portlike body", "a powerhouse", at
    #    "15 to 16 percent alcohol" — squarely a very-high-body wine. We record
    #    ONE body benchmark (amarone's) as the region's signature; we do NOT
    #    assert a region-average body (Soave/Prosecco are light), nor
    #    acidity/tannin (no defensible region-wide figure in the book).
    bench_citation = CITATION + " (narrative-derived; amarone signature)"
    ingest.upsert_benchmark(
        conn, region_ctx, "wine.body",
        typical=5.0, low=4.5, high=5.0,
        confidence="medium", source_citation=bench_citation)
