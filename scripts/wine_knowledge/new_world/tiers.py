"""Classification-tier loader for the Plan-3b chapters — authored IN-SESSION
from The Wine Bible (2nd ed., Karen MacNeil; the Spain/Rioja DOCa passage, the
"AGING REQUIREMENTS FOR RIOJA" box, and the "AMERICAN VITICULTURAL AREAS"
passage). Nothing here is web-sourced or paid-API generated; every context
carries a real CITATION.

Spain contributes TWO INDEPENDENT ladders, and keeping them separate is the
whole point of this module:

  1. PLACE ladder  — DOCa OUTRANKS DO. Same kind of thing as Italy's DOCG/DOC:
     a legal quality designation attached to a REGION.
  2. AGING ladder  — Gran Reserva OUTRANKS Reserva OUTRANKS Crianza. This is
     the FIRST AGE-BASED tier ladder in the graph. France's tiers rank
     VINEYARDS (Grand Cru) and Italy's rank PLACES (DOCG); Spain's crianza
     hierarchy ranks a wine by HOW LONG IT WAS AGED, independent of where it
     came from. A Rioja crianza and a Rioja gran reserva share one region and
     one DOCa — they differ only in time in oak and bottle.

Because the aging tiers are NOT a property of a place, the region loaders wire
`classified_under` ONLY to the place tiers (DOCa/DO). Attaching "Gran Reserva"
to Rioja-the-region would assert that everything from Rioja is a gran reserva,
which is false — the book is explicit that gran reservas are just 1-10% of
production. The aging tiers stand as standalone entities that a future
product-level `designation` field can point at (see the classification/
designation note in CLAUDE.md Rule 12).

The two ladders are deliberately NOT joined to each other: DOCa does not
outrank Gran Reserva, and no edge is authored between them, because they
measure different axes and the book never ranks one against the other.

The USA contributes a THIRD, DELIBERATELY UNRANKED tier: the AVA. This is the
first tier in the graph with NO `outranks` edge at all, and that absence is the
data, not an omission — the book is explicit that an AVA merely delimits a
grape-growing region "distinguished by geographical features" and, unlike a
European appellation, mandates nothing about grape varieties, farming, ageing
or alcohol. There is no AVA hierarchy to model: Napa Valley does not outrank
the sixteen smaller AVAs inside it, they are simply nested places. Inventing a
ladder here would fabricate a legal structure the United States does not have.
Australia's GI and Chile's DO are likewise single-level and get no ladder.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest

CITATION = "Wine Bible 2e, Spain/Rioja (classification)"
AGING_CITATION = "Wine Bible 2e, Spain/Rioja (aging requirements)"
AVA_CITATION = "Wine Bible 2e, United States (American Viticultural Areas)"

# --- place ladder: DOCa > DO -------------------------------------------------
DOCA_SLUG = "spain-doca"
DO_SLUG = "spain-do"

# --- aging ladder: Gran Reserva > Reserva > Crianza --------------------------
GRAN_RESERVA_SLUG = "spain-gran-reserva"
RESERVA_SLUG = "spain-reserva"
CRIANZA_SLUG = "spain-crianza"

# --- unranked, single-level New-World designations (NO outranks edges) -------
# NOTE: there is deliberately NO australia-gi tier. The Wine Bible's Australia
# chapter never describes the Geographical Indication system, and the
# honest-sparse rule that governs the benchmarks governs entities too: we do
# not invent a designation the source does not document. The Australian region
# loaders therefore wire no `classified_under` edge at all.
AVA_SLUG = "usa-ava"
CHILE_DO_SLUG = "chile-do"

_PLACE_TIERS = (
    ("Spain DOCa", DOCA_SLUG, {
        "short": (
            "Apex of Spain's legal place hierarchy — Denominación de Origen "
            "Calificada ('qualified denomination of origin'). Rioja was the "
            "first region awarded it, in 1991."
        ),
        "full": (
            "DOCa — Denominación de Origen Calificada, 'Qualified Denomination "
            "of Origin' — is the highest legal designation a Spanish wine "
            "region can carry, ranking ABOVE the DO. To be granted DOCa status "
            "a wine region must meet the highest standards in its winemaking "
            "and viticultural practices. Rioja was the first region in Spain to "
            "carry the designation, a status awarded it in 1991. Like Italy's "
            "DOCG, the DOCa is attached to an entire REGION rather than to any "
            "individual wine, so it marks the recognised standing of the place "
            "and not a guarantee about a particular bottle. DOCa OUTRANKS DO."
        ),
        "attrs": {
            "rank": 1,
            "spanish": "Denominación de Origen Calificada",
            "acronym": "DOCa",
            "meaning": "qualified denomination of origin",
            "ladder": "place",
            "first_region": "Rioja (1991)",
            "outranks": DO_SLUG,
            "requirement": "region must meet the highest standards in winemaking "
                           "and viticultural practices",
        },
    }),
    ("Spain DO", DO_SLUG, {
        "short": (
            "Spain's principal region-level designation — Denominación de "
            "Origen ('denomination of origin'), the tier below DOCa."
        ),
        "full": (
            "DO — Denominación de Origen, 'Denomination of Origin' — is Spain's "
            "principal legal wine-region designation and the tier immediately "
            "BELOW the DOCa. It marks a delimited zone whose wines meet the "
            "region's defined standards; the great majority of Spain's "
            "recognised wine regions, from Ribera del Duero and Rías Baixas to "
            "Jerez and Penedès, are DOs. As with the DOCa, the designation "
            "attaches to the PLACE rather than to any single wine. DO is "
            "OUTRANKED BY DOCa."
        ),
        "attrs": {
            "rank": 2,
            "spanish": "Denominación de Origen",
            "acronym": "DO",
            "meaning": "denomination of origin",
            "ladder": "place",
            "outranked_by": DOCA_SLUG,
        },
    }),
)

# Aging tiers, HIGHEST -> LOWEST. Each carries the book's exact legal minimum
# aging periods for BOTH colours (the "AGING REQUIREMENTS FOR RIOJA" box).
_AGING_TIERS = (
    ("Gran Reserva", GRAN_RESERVA_SLUG, {
        "short": (
            "Top of Spain's aging hierarchy: reds aged at least five years, two "
            "in oak and three in bottle. Made only in exceptional years, from "
            "the very best vineyards — just 1-10% of production."
        ),
        "full": (
            "Gran reserva is the APEX of the Spanish aging hierarchy, which "
            "ranks a wine by how long it has been aged rather than by where it "
            "grew. By law red gran reservas must be aged at least FIVE years, "
            "two of which must be in oak barrels and the remaining three in "
            "bottle; white gran reservas must be aged four years, one of them "
            "in oak. In practice many are aged far longer — Marqués de Murrieta "
            "released their 1942 gran reserva in 1983, forty-one years after it "
            "was made. Gran reservas are made only in exceptional years, come "
            "from the very best vineyards of all and are extremely rare: in most "
            "years they represent just 1 to 10 percent of the wines produced, "
            "and white gran reservas are now made by only a handful of bodegas. "
            "Red gran reservas are elegant, silky and refined, aged the longest "
            "in the oldest, most neutral barrels. Rioja's long-aged gran "
            "reservas remain among the best deals in the world. GRAN RESERVA "
            "OUTRANKS RESERVA."
        ),
        "attrs": {
            "rank": 1,
            "ladder": "aging",
            "min_aging_red": "5 years (2 in oak, 3 in bottle)",
            "min_aging_white": "4 years (1 in oak)",
            "vintage_policy": "exceptional years only",
            "share_of_production": "1-10% in most years",
            "character": "elegant, silky, refined; oldest, most neutral barrels",
            "outranks": RESERVA_SLUG,
        },
    }),
    ("Reserva", RESERVA_SLUG, {
        "short": (
            "Middle of Spain's aging hierarchy: reds aged at least three years, "
            "one in oak. Superior grapes from prime sites; made only in "
            "exceptional years."
        ),
        "full": (
            "Reserva is the MIDDLE rung of the Spanish aging hierarchy. By law "
            "red reservas must be aged at least THREE years, one of which must "
            "be in oak barrels; white reservas must be aged two years, six "
            "months of them in oak. Reservas are made from superior grapes from "
            "prime sites and only in exceptional years. They are far more "
            "concentrated than crianzas and have a fuller, fleshier texture with "
            "greater overall depth and intensity — but they are not necessarily "
            "powerhouses; just the opposite can be true, and reservas can be "
            "subtle, supple wines with quiet but intense echoes of earth, old "
            "saddle leather and dried leaves. RESERVA OUTRANKS CRIANZA and is "
            "OUTRANKED BY GRAN RESERVA."
        ),
        "attrs": {
            "rank": 2,
            "ladder": "aging",
            "min_aging_red": "3 years (1 in oak)",
            "min_aging_white": "2 years (6 months in oak)",
            "vintage_policy": "exceptional / above-average years only",
            "character": "concentrated, fuller and fleshier than crianza; can be "
                         "subtle and supple — earth, old saddle leather, dried leaves",
            "outranks": CRIANZA_SLUG,
            "outranked_by": GRAN_RESERVA_SLUG,
        },
    }),
    ("Crianza", CRIANZA_SLUG, {
        "short": (
            "Entry rung of Spain's aging hierarchy: reds aged at least two "
            "years, one in oak. The bread-and-butter wines of every bodega."
        ),
        "full": (
            "Crianza is the ENTRY rung of the Spanish aging hierarchy — in "
            "Spanish the word refers to something that is raised or nursed. By "
            "law red crianzas must be aged at least TWO years, one of which must "
            "be in oak barrels; white crianzas must be aged six months in oak. "
            "Crianzas are the bread-and-butter wines of every bodega, generally "
            "made with grapes from good but not exceptional vineyards: "
            "easy-drinking reds full of earth, spice, cherry and vanilla. Below "
            "crianza sit the very basic, very young vinos jóvenes or sin "
            "crianzas, usually not exported. Note the book's warning that the "
            "flood of radically inexpensive crianzas at rock-bottom prices is "
            "best avoided. CRIANZA IS OUTRANKED BY RESERVA."
        ),
        "attrs": {
            "rank": 3,
            "ladder": "aging",
            "min_aging_red": "2 years (1 in oak)",
            "min_aging_white": "6 months in oak",
            "character": "easy-drinking; cherry, spice, earth, vanilla",
            "sourcing": "good but not exceptional vineyards",
            "below": "vinos jóvenes / sin crianza (usually not exported)",
            "outranked_by": RESERVA_SLUG,
        },
    }),
)


# Single-level designations. These are NOT a ladder — each stands alone and no
# `outranks` edge is authored for them (see the module docstring).
_UNRANKED_TIERS = (
    ("American Viticultural Area", AVA_SLUG, AVA_CITATION, {
        "short": (
            "The US designation — a delimited grape-growing region distinguished "
            "by geographical features. Unlike a European appellation it mandates "
            "nothing about grapes, farming or ageing, and AVAs are NOT ranked."
        ),
        "full": (
            "In the United States the process of defining wine regions began in "
            "1978, when the then Bureau of Alcohol, Tobacco and Firearms (today "
            "the Tax and Trade Bureau) began drawing up requirements for the "
            "first American Viticultural Areas, or AVAs. An AVA is defined as 'a "
            "delimited grape growing region, distinguished by geographical "
            "features, the boundaries of which have been recognized and "
            "defined'. Napa Valley, Finger Lakes, Willamette Valley and Columbia "
            "Valley are all AVAs. The first was Augusta, Missouri, approved in "
            "June 1980; the smallest is Cole Ranch in Mendocino, California, at "
            "a quarter of a square mile; the largest is the Upper Mississippi "
            "River Valley, at 29,914 square miles across four states. There are "
            "now just over two hundred AVAs. Although AVAs and European "
            "appellation systems look like similar constructs they are immensely "
            "different in critical ways: European appellation rules legally "
            "mandate a sweeping array of details — which grape varieties may be "
            "used and in what percentages, vineyard and farming practices, how "
            "long and in what vessel the wine must be aged, minimum and maximum "
            "alcohol — whereas winemakers in the United States are free to plant "
            "whatever they want and make wine almost any way they want. That "
            "freedom has one drawback: the premise behind an appellation is that "
            "the wines of an area share certain flavour characteristics, which "
            "has been hard to demonstrate in the US, where it can be very "
            "difficult to tell whether a flavour comes from the place or from "
            "something the winemaker did. Crucially, the AVA system is FLAT: an "
            "AVA carries no rank, and a larger AVA does not outrank the smaller "
            "AVAs nested inside it."
        ),
        "attrs": {
            "acronym": "AVA",
            "ladder": "none — AVAs are unranked",
            "meaning": "delimited grape growing region distinguished by "
                       "geographical features",
            "established": 1978,
            "first_ava": "Augusta, Missouri (June 1980)",
            "smallest": "Cole Ranch, Mendocino, California (0.25 sq mi)",
            "largest": "Upper Mississippi River Valley (29,914 sq mi, 4 states)",
            "count": "just over 200",
            "contrast_with_europe": "mandates boundaries ONLY — no rules on grape "
                                    "varieties, farming, ageing vessel or alcohol",
        },
    }),
    ("Chile DO", CHILE_DO_SLUG, "Wine Bible 2e, Chile", {
        "short": (
            "Chile's Denominación de Origen — five major DOs running north to "
            "south (Atacama, Coquimbo, Aconcagua, Valle Central, Southern "
            "Regions). A geographic framework, not a quality ranking."
        ),
        "full": (
            "Chile's 506,000 acres (204,800 hectares) of vineyards and two "
            "hundred plus wineries are located in five major Denominacions de "
            "Origen (DOs). From north to south they are Atacama, Coquimbo, "
            "Aconcagua, the Valle Central and the Southern Regions. The "
            "northernmost DOs of Atacama and Coquimbo are desert-like and the DO "
            "Southern Regions is the coldest, but the DOs to know are the ones "
            "in the middle — Aconcagua and the Valle Central ('Central Valley'). "
            "These make up Chile's historic wine centre and are still where most "
            "of Chile's best wine districts are found; a lion's share of all "
            "wine exported from Chile comes from these two areas. The Chilean DO "
            "framework is GEOGRAPHIC — a north-to-south ordering of climate "
            "zones and their nested sub-valleys — and does not rank one DO above "
            "another in the way Spain's DOCa outranks its DO."
        ),
        "attrs": {
            "acronym": "DO",
            "spanish": "Denominación de Origen",
            "ladder": "none — Chilean DOs are geographic, not ranked",
            "count": 5,
            "dos_north_to_south": ["Atacama", "Coquimbo", "Aconcagua",
                                   "Valle Central", "Southern Regions"],
            "most_important": ["Aconcagua", "Valle Central"],
            "vineyard_area": "506,000 acres (204,800 ha)",
            "wineries": "200+",
        },
    }),
)


def _load_ladder(conn, tiers, citation) -> dict[str, int]:
    """Create each tier entity + its cited validated context, then chain
    ADJACENT pairs with `outranks` (highest -> lowest, as ordered)."""
    ids: dict[str, int] = {}
    for name, slug, ctx in tiers:
        tid = ingest.upsert_entity(conn, "classification_tier", name, slug)
        ingest.upsert_context(
            conn, tid, "wine",
            short=ctx["short"], full=ctx["full"],
            status="validated", source_citation=citation, confidence="high",
            attributes=json.dumps(ctx["attrs"]),
        )
        ids[slug] = tid

    # Chain only ADJACENT rungs (Burgundy's ladder pattern): Gran Reserva ->
    # Reserva -> Crianza, never a transitive Gran Reserva -> Crianza shortcut.
    slugs = [slug for _, slug, _ in tiers]
    for higher, lower in zip(slugs, slugs[1:]):
        ingest.add_relationship(conn, ids[higher], ids[lower], "outranks")
    return ids


def load(conn) -> None:
    # Two SEPARATE ladders — no edge is authored between them (see module
    # docstring: place-rank and aging-rank are different axes).
    _load_ladder(conn, _PLACE_TIERS, CITATION)
    _load_ladder(conn, _AGING_TIERS, AGING_CITATION)

    # Single-level designations: entity + cited context, and NO outranks edge.
    for name, slug, citation, ctx in _UNRANKED_TIERS:
        tid = ingest.upsert_entity(conn, "classification_tier", name, slug)
        ingest.upsert_context(
            conn, tid, "wine",
            short=ctx["short"], full=ctx["full"],
            status="validated", source_citation=citation, confidence="high",
            attributes=json.dumps(ctx["attrs"]),
        )
