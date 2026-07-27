"""New-World / Spanish grape-variety loader — authored IN-SESSION from The Wine
Bible (2nd ed., Karen MacNeil). Creates the 4 grape entities the Plan-3b region
loaders need that did not already exist. Nothing here is web-sourced or
paid-API generated; every context/benchmark carries a real CITATION.

SYNONYM DISCIPLINE (why this list is only 4 grapes, not 7): the book's A-Z
glossary explicitly cross-references several "new" Spanish names to varieties
we ALREADY hold as entities, and creating a second entity for the same vine
would fork the `grown_in` graph — two nodes, each with half the region links,
and the drawer would show whichever slug a loader happened to pick.

  - GARNACHA   -> glossary says "See Grenache"  -> use existing `grenache`
  - MONASTRELL -> glossary says "See Mourvedre" -> use existing `mourvedre`
  - SHIRAZ     -> Australia's name for syrah    -> use existing `syrah`

So those three are deliberately NOT created here; the Spain/Australia region
loaders link the existing slug and mention the local synonym in prose/attrs.

Where the book gives a clear sensory/structural characterization we add a
1-5-scale benchmark (range low/high). Where the book merely names the grape
without describing structure we DELIBERATELY leave the benchmark off rather
than fabricate one — sparse-but-honest beats invented data (the Italy rule).
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest

CITATION = "Wine Bible 2e, grape glossary"
BENCH_CITATION = CITATION + " (narrative-derived)"

# Local synonyms that map onto ALREADY-EXISTING grape entities. Exported so the
# region loaders (and the tests) share one source of truth instead of each
# re-deciding that "shiraz" means the `syrah` row.
SYNONYM_TO_SLUG: dict[str, str] = {
    "garnacha": "grenache",
    "monastrell": "mourvedre",
    "shiraz": "syrah",
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
    # 1. CARMENERE — Chile's signature red. The book characterizes the top
    #    examples as "soft, plush" (=> low-ish tannin for a Bordeaux variety)
    #    and gives a clear flavor signature; no explicit acidity claim, so no
    #    acidity benchmark.
    _grape(
        conn, "Carmenère", "carmenere",
        short=(
            "Ancient Bordeaux red variety, virtually extinct in France, that "
            "became Chile's signature grape — soft, plush wines redolent of "
            "green tobacco, coffee and leather."
        ),
        full=(
            "Carmenère is an ancient Bordeaux variety (known there as grande "
            "vidure) whose parents are cabernet franc and gros cabernet, making "
            "it a half sibling of cabernet sauvignon and merlot. Virtually "
            "extinct in Bordeaux today, it was brought to Chile in the late "
            "nineteenth century and — after spending generations mis-identified "
            "as merlot — is now considered Chile's signature grape, with "
            "plantings on a dramatic rise. The highest-quality examples are "
            "fascinating, soft, plush wines redolent of green tobacco, coffee "
            "and leather, and it can make complex, intensely red-hued wines. It "
            "is often blended with cabernet sauvignon (and sometimes syrah) to "
            "make Chile's greatest reds. The name may derive from carmin — "
            "crimson in Latin — a reference to the vivid red of the variety's "
            "leaves at harvest. In China it is known as cabernet gernischt."
        ),
        attrs={
            "color": "red",
            "origin": "Bordeaux, France; now signature grape of Chile",
            "parents": ["cabernet franc", "gros cabernet"],
            "synonyms": ["grande vidure", "cabernet gernischt"],
            "flavor_signature": ["green tobacco", "coffee", "leather"],
            "note": "long mis-identified as merlot in Chile",
        },
        # "soft, plush" — the book's one clear structural claim.
        benchmarks=[("wine.tannin", 2.5, 2.0, 3.0)],
    )

    # 2. PETITE SIRAH — California. The book is emphatic on structure here
    #    ("nothing petite about petite sirah", "mouthfilling and often hugely
    #    tannic"), which supports confident body + tannin benchmarks.
    _grape(
        conn, "Petite Sirah", "petite-sirah",
        short=(
            "California red, shown by DNA typing to be the French grape durif "
            "(syrah x peloursin) — mouthfilling and often hugely tannic despite "
            "the name."
        ),
        full=(
            "Petite Sirah is the California name for durif, a variety created "
            "just before the 1860s by the French botanist François Durif as a "
            "cross of syrah and the now-obscure French grape peloursin. Durif "
            "has virtually disappeared in France but lives on in California. "
            "There is nothing petite about petite sirah: the wine is "
            "mouthfilling and often hugely tannic. Over many decades of "
            "California's early history other vine types were mixed in among "
            "petite sirah vines, creating field blends, and the grape's true "
            "identity grew obscure until DNA typing in the 1990s revealed that "
            "most California petite sirah is in fact durif. Some of the oldest "
            "'petite sirah' vineyards remain field blends of many varieties — "
            "true syrah, durif, carignan, zinfandel, barbera, even grenache — "
            "and a minority of so-called petite sirah is simply peloursin."
        ),
        attrs={
            "color": "red",
            "origin": "France (as durif); established in California",
            "parents": ["syrah", "peloursin"],
            "synonyms": ["durif"],
            "note": "most California 'petite sirah' confirmed as durif by 1990s "
                    "DNA typing; oldest vineyards are field blends",
        },
        benchmarks=[("wine.body", 4.5, 4.0, 5.0),
                    ("wine.tannin", 4.5, 4.0, 5.0)],
    )

    # 3. PALOMINO — the Sherry grape. The book's defining claim is that it is
    #    NEUTRAL when harvested (desirable for the solera process). Neutrality
    #    is a flavor-intensity statement, not a body/acid/tannin one, so we
    #    record it in attrs and add NO benchmark.
    _grape(
        conn, "Palomino", "palomino",
        short=(
            "White grape of southern and central Spain and the major grape of "
            "Sherry; fairly neutral when harvested, which is exactly what the "
            "solera process wants."
        ),
        full=(
            "Palomino — more correctly Palomino fino — is grown in southern and "
            "central Spain and is the major grape of Spain's famous fortified "
            "wine, Sherry. When just harvested it has a fairly neutral "
            "character, which is desirable for the solera process by which "
            "Sherry is made: the wine's ultimate character comes from flor, "
            "oxidative ageing and the solera's fractional blending rather than "
            "from grapey primary fruit."
        ),
        attrs={
            "color": "white",
            "origin": "southern and central Spain (Jerez)",
            "synonyms": ["palomino fino"],
            "role": "principal grape of Sherry",
            "character": "neutral when harvested — suits the solera process",
        },
    )

    # 4. PAIS — Chile's historic mass-production grape. The book calls its wine
    #    "common, undistinguished" / jug wine. That is a quality judgement, not
    #    a structural one, so NO benchmark (the honest-sparse rule).
    _grape(
        conn, "País", "pais",
        short=(
            "Chile's historic mass-production red, brought by Spanish "
            "missionaries in the sixteenth century; the same variety as "
            "California's mission grape."
        ),
        full=(
            "País (the name means 'country' in Spanish) is a prolific variety "
            "in Chile, where it is the source of common, undistinguished table "
            "wine and is still widely planted for jug wines. It is Chile's "
            "historic mass-production grape, brought from Spain in the "
            "sixteenth century. Originally known as criolla chica, país is the "
            "same grape as California's mission; in the mid-2000s DNA typing "
            "revealed both país and mission to be the Spanish variety listán "
            "prieto, carried to Mexico, Argentina and Chile in the sixteenth "
            "and seventeenth centuries by Spanish conquistadores and "
            "missionaries."
        ),
        attrs={
            "color": "red",
            "origin": "Spain (as listán prieto); historic workhorse of Chile",
            "synonyms": ["criolla chica", "mission", "listán prieto"],
            "role": "historic mass-production / jug wine grape",
        },
    )
