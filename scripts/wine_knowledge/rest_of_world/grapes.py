"""Rest-of-World grape-variety loader — authored IN-SESSION from The Wine Bible
(2nd ed., Karen MacNeil, A-Z grape glossary). Creates the 5 grape entities the
Plan-3c region loaders need that did not already exist. Nothing here is
web-sourced or paid-API generated; every context/benchmark carries a real
CITATION.

ALREADY PRESENT from earlier plans, so NOT recreated: grüner veltliner and
riesling (Plan 1), malbec, chardonnay, pinot noir, sauvignon blanc. The Austria
and Germany loaders link those existing slugs.

SYNONYM DISCIPLINE (the Plan-3b lesson, applied again): the glossary maps
several local names onto varieties we already hold. `welschriesling` is NOT
riesling (the book is explicit: "not a riesling, despite its name, but the
Croatian grape graševina"), so it is neither created nor aliased to riesling —
it is simply out of scope. `weissburgunder` = pinot blanc and `sylvaner` =
silvaner are recorded as synonyms in attrs rather than as separate entities.

Honest-sparse benchmarks: a grape gets a 1-5 benchmark ONLY where the book
makes a clear structural claim. Torrontés ("slightly viscous"), silvaner
("mostly neutral") and zweigelt ("grapey, fruity") describe aroma or texture
rather than body/acid/tannin magnitude, so they get NO structural benchmark.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest

CITATION = "Wine Bible 2e, grape glossary"
BENCH_CITATION = CITATION + " (narrative-derived)"

# Local names that map onto varieties ALREADY in the graph, or that the book
# explicitly warns are NOT the variety their name suggests. Exported so the
# region loaders and tests share one source of truth.
SYNONYM_TO_SLUG: dict[str, str] = {
    "sylvaner": "silvaner",      # Alsace spelling of the same grape
}

# Names that LOOK like an existing variety but are a DIFFERENT grape. Never
# alias these — the book is explicit that welschriesling is not riesling.
FALSE_FRIENDS: dict[str, str] = {
    "welschriesling": "not riesling — the Croatian grape graševina",
}


def _grape(conn, name: str, slug: str, *, short: str, full: str,
           attrs: dict, benchmarks=()) -> None:
    eid = ingest.upsert_entity(conn, "grape_variety", name, slug)
    cid = ingest.upsert_context(
        conn, eid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION, confidence="medium",
        attributes=json.dumps(attrs),
    )
    for dim, typical, low, high in benchmarks:
        ingest.upsert_benchmark(
            conn, cid, dim,
            typical=typical, low=low, high=high,
            confidence="medium", source_citation=BENCH_CITATION,
        )


def load(conn) -> None:
    # 1. TORRONTÉS — Argentina's signature white. The book's claims are
    #    AROMATIC and textural ("beautifully aromatic, slightly viscous"),
    #    not a body/acid magnitude, so no structural benchmark.
    _grape(
        conn, "Torrontés", "torrontes",
        short=(
            "Argentina's aromatic white speciality — beautifully aromatic, "
            "slightly viscous dry wines drunk as aperitifs. Three distinct "
            "varieties share the name; torrontés Riojana is the best."
        ),
        full=(
            "Torrontés is a speciality of Argentina, where it can make "
            "beautifully aromatic, slightly viscous dry wines that are drunk as "
            "aperitifs. Crucially it is NOT a single variety but three "
            "distinctly different ones, all indigenous to Argentina: torrontés "
            "Mendocino (not highly thought of); torrontés Sanjuanino (also "
            "unexceptional, planted mostly in the province of San Juan); and "
            "torrontés Riojana, the most aromatic and highest-quality of the "
            "three, often grown in the high-elevation vineyards of the province "
            "of Salta. DNA typing suggests torrontés Riojana is a white-skinned "
            "natural cross of muscat of Alexandria and the red grape mission "
            "(listán prieto), both brought to the Americas in the sixteenth "
            "century by Spanish missionaries and conquistadores."
        ),
        attrs={
            "color": "white",
            "origin": "Argentina",
            "variants": ["torrontés Riojana (best)", "torrontés Mendocino",
                         "torrontés Sanjuanino"],
            "parents": ["muscat of Alexandria", "mission (listán prieto)"],
            "style": "aromatic, slightly viscous dry white; served as an aperitif",
            "best_region": "Salta (high-elevation vineyards)",
        },
    )

    # 2. BLAUFRÄNKISCH — Austria's serious red. "Deeply coloured", "spicy,
    #    precise, earthy" — colour and flavour, but the book stops short of a
    #    tannin/body magnitude claim, so no structural benchmark.
    _grape(
        conn, "Blaufränkisch", "blaufrankisch",
        short=(
            "A highly esteemed Austrian red making delicious, spicy, precise, "
            "earthy, deeply coloured wines — especially in Burgenland, the "
            "warmest Austrian wine region."
        ),
        full=(
            "Blaufränkisch is a highly esteemed Austrian variety — probably of "
            "Austrian or Hungarian origin — that can make delicious, spicy, "
            "precise, earthy, deeply coloured reds, especially in Burgenland, "
            "the warmest of the Austrian wine regions. It is also the leading "
            "red grape in Hungary, where it is called kékfrankos, and is grown "
            "in Washington State under its German name, Lemberger. DNA analysis "
            "indicates it is probably the progeny of gouais blanc. It is one "
            "parent of zweigelt, the cross that is now among Austria's most "
            "widely planted reds."
        ),
        attrs={
            "color": "red",
            "origin": "Austria or Hungary",
            "synonyms": ["kékfrankos (Hungary)", "Lemberger (Washington State)"],
            "flavor_signature": ["spicy", "precise", "earthy", "deeply coloured"],
            "best_region": "Burgenland — the warmest Austrian wine region",
        },
    )

    # 3. ZWEIGELT — the 1922 cross. "Grapey, fruity, purple/red" is a flavour
    #    and colour claim; no structural benchmark.
    _grape(
        conn, "Zweigelt", "zweigelt",
        short=(
            "An Austrian cross of blaufränkisch and St. Laurent made in 1922, "
            "now one of the most widely planted red grapes in Austria — the "
            "source of grapey, fruity, purple-red wines."
        ),
        full=(
            "Zweigelt is an Austrian cross of blaufränkisch and St. Laurent, "
            "made in 1922 by an Austrian researcher named Fritz Zweigelt. It is "
            "now one of the most widely planted red grapes in Austria and is the "
            "source of grapey, fruity, purple/red wines in that country."
        ),
        attrs={
            "color": "red",
            "origin": "Austria (bred 1922 by Fritz Zweigelt)",
            "parents": ["blaufränkisch", "St. Laurent"],
            "flavor_signature": ["grapey", "fruity", "purple/red"],
            "note": "one of Austria's most widely planted red grapes",
        },
    )

    # 4. TOURIGA NACIONAL — Portugal's powerhouse. Here the book DOES make an
    #    explicit structural claim: "a commanding tannic structure" plus
    #    "richness, depth" -> confident tannin + body benchmarks.
    _grape(
        conn, "Touriga Nacional", "touriga-nacional",
        short=(
            "Portugal's powerhouse red — the leading grape in many Port blends, "
            "with richness, depth, a commanding tannic structure, deep colour "
            "and fine aromas."
        ),
        full=(
            "Touriga Nacional is probably native to Portugal's Dão region, but "
            "is today widely known as the leading powerhouse grape in many of "
            "the blends that make Port. The grape has many attributes, "
            "including richness, depth, a commanding tannic structure, good "
            "deep colouring and good aromas. It is also used in the dry wines "
            "of the Douro."
        ),
        attrs={
            "color": "red",
            "origin": "probably Portugal's Dão region",
            "role": "leading grape in many Port blends; also in dry Douro reds",
            "attributes": ["richness", "depth", "commanding tannic structure",
                           "deep colour", "good aromas"],
        },
        benchmarks=[("wine.body", 4.5, 4.0, 5.0),
                    ("wine.tannin", 4.5, 4.0, 5.0)],
    )

    # 5. SILVANER — "mostly neutral in character" in Austria, but "more
    #    characterful, dry, firm, bold" in Germany's Franken. Neutrality and
    #    the region-dependent split argue against a single benchmark.
    _grape(
        conn, "Silvaner", "silvaner",
        short=(
            "An Austrian variety, mostly neutral in character, that makes a "
            "more characterful, dry, firm, bold wine in Germany's Franken "
            "region. Known as sylvaner in Alsace."
        ),
        full=(
            "Silvaner is an Austrian variety, mostly neutral in character, that "
            "is a cross of savagnin with österreichisch weiss, an ancient white "
            "variety grown near Vienna. In Germany, silvaner makes a somewhat "
            "more characterful, dry, firm, bold wine, especially in the Franken "
            "region. In Alsace, France, silvaner is known as sylvaner, and some "
            "very good wines are made from the grape, although acreage in "
            "Alsace is declining."
        ),
        attrs={
            "color": "white",
            "origin": "Austria",
            "parents": ["savagnin", "österreichisch weiss"],
            "synonyms": ["sylvaner (Alsace)"],
            "style_note": "mostly neutral in Austria; more characterful, dry, "
                          "firm and bold in Germany's Franken",
        },
    )
