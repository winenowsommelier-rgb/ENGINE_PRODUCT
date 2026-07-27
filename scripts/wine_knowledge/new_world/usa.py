"""USA sub-chapter loader (California, Napa, Sonoma County, Washington,
Oregon, Willamette Valley) — authored IN-SESSION from The Wine Bible (2nd ed.,
Karen MacNeil; the CALIFORNIA / WASHINGTON STATE / OREGON chapters and the
Napa Valley and Sonoma County sections within California). Nothing here is
web-sourced or paid-API generated.

Mirrors `italy/piedmont.py` and `new_world/spain.py`. Every context and
benchmark carries a real CITATION, and we link only to the EXISTING
region/grape skeleton via `_helpers` (which RAISE on a missing entity).

TIER SCOPE: every US region links to the single, UNRANKED `usa-ava` tier. There
is no ladder to model — the book is explicit that AVAs delimit boundaries and
nothing else (see tiers.py). Napa Valley does not outrank the sixteen AVAs
inside it.

REGION SELECTION is by catalogue weight intersected with book depth: Napa (279
SKUs), California (234), Sonoma County (53), Kentucky (34) and Tennessee (19),
Washington (3), Willamette Valley (3), Oregon (1). Kentucky and Tennessee are
BOURBON/WHISKEY regions, not wine — the Wine Bible has no chapter for them and
their taxonomy contexts belong to the spirits scope, so they are deliberately
skipped here rather than given a fabricated wine context.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.new_world import _helpers, tiers

CITATION_CA = "Wine Bible 2e, United States/California"
CITATION_NAPA = "Wine Bible 2e, United States/California/Napa Valley"
CITATION_SONOMA = "Wine Bible 2e, United States/California/Sonoma County"
CITATION_WA = "Wine Bible 2e, United States/Washington State"
CITATION_OR = "Wine Bible 2e, United States/Oregon"


def _region(conn, name, citation, *, short, full, attrs, grapes=(),
            tier=tiers.AVA_SLUG, benchmarks=()):
    rid = _helpers.find_region(conn, name)
    ctx = ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=citation, confidence="high",
        attributes=json.dumps(attrs),
    )
    for slug in grapes:
        _helpers.link_grape(conn, slug, rid)
    if tier:
        ingest.add_relationship(conn, rid, _helpers.find_tier(conn, tier),
                                "classified_under")
    bench_citation = citation + " (narrative-derived)"
    for dim, typical, low, high in benchmarks:
        ingest.upsert_benchmark(
            conn, ctx, dim, typical=typical, low=low, high=high,
            confidence="medium", source_citation=bench_citation)
    return rid


def load(conn) -> None:
    # ----------------------------------------------------------- CALIFORNIA
    # The state as a whole. The book's defining claim is DIVERSITY — "a
    # profusion of styles from dozens of different grape varieties" — so a
    # single structural benchmark would be actively misleading. None asserted.
    _region(
        conn, "California", CITATION_CA,
        short=(
            "Source of more than 90 percent of all US wine — a diverse, largely "
            "beneficent climate producing a profusion of styles from dozens of "
            "grape varieties, and one of the world's most technologically "
            "oriented wine regions."
        ),
        full=(
            "More than 90 percent of the wine made in the United States is made "
            "in California. The state's incredibly diverse yet largely "
            "beneficent climate and geography allow its wines to be made in a "
            "profusion of styles from dozens of different grape varieties, and "
            "while winemaking here has spanned four centuries, California is one "
            "of the most modern, technologically oriented wine regions in the "
            "world. Its industry began with the Spanish explorers and "
            "missionaries who moved north from Mexico in the mid-1700s and "
            "secured Alta (Upper) California with a string of missions, each a "
            "day's journey from the next; wine was needed for the Catholic mass "
            "and for the friars themselves. Difficulties along the supply route "
            "from Mexico led California's Franciscan fathers to plant their own "
            "vineyards, using cuttings of the Spanish grape listán prieto — "
            "known in Mexico as misión and later, in California, spelled "
            "'mission' after the missions where it was planted. As the "
            "nineteenth century dawned settlers began planting small vineyards "
            "of their own, all initially based on the mission grape alone; by "
            "the 1830s commercial wineries had begun in Los Angeles, and a "
            "decade later in Sonoma and Napa counties."
        ),
        attrs={
            "climate": "incredibly diverse yet largely beneficent; Mediterranean "
                       "in the coastal valleys",
            "classification_system": "AVA (American Viticultural Area) — unranked",
            "signature": "a profusion of styles from dozens of varieties; modern "
                         "and technologically oriented",
            "share_of_us_wine": "more than 90 percent",
            "history": "Franciscan mission vineyards from the mid-1700s planted "
                       "with the 'mission' grape (listán prieto)",
            "style_note": "diversity is the defining trait — no single structural "
                          "benchmark is asserted for the state as a whole",
        },
        grapes=("cabernet-sauvignon", "chardonnay", "zinfandel", "pinot-noir",
                "merlot", "syrah", "petite-sirah"),
    )

    # ---------------------------------------------------------------- NAPA
    # Cabernet country. The book: "most polished, classy, and complex wines in
    # the state - especially the cabernet sauvignons". Polished/classy is a
    # quality claim, not a structural one; the safe structural read for a warm
    # Mediterranean valley's flagship cabernet is FULL body with firm tannin.
    _region(
        conn, "Napa", CITATION_NAPA,
        short=(
            "California's best-known wine region and the state's first AVA "
            "(1981) — a small, mountain-flanked valley of extraordinary soil "
            "diversity making its most polished, classy cabernet sauvignons."
        ),
        full=(
            "About 48 miles (77 kilometres) north of San Francisco, Napa Valley "
            "is California's best-known and most renowned wine region, even "
            "though it produces an astoundingly small share of the state's wine "
            "— just 4 percent. For almost a century and a half the valley has "
            "attracted a majority of the most ambitious, talented, driven and "
            "outspoken vintners in the United States: Inglenook was built by the "
            "Finnish sea captain Gustave Niebaum and sold a century later to "
            "Francis Ford Coppola; Opus One was founded by Robert Mondavi and "
            "Baron Philippe de Rothschild; and the first California wines to "
            "cost $100, $200 and more than $300 a bottle were all made here. "
            "Critics say Napa has an ego; what it really has is a gargantuan "
            "appetite for life and success, and you can taste it in the wines. "
            "While it is not the only California region to make great wine, Napa "
            "consistently makes a good share of the most polished, classy and "
            "complex wines in the state — especially the cabernet sauvignons. "
            "Named California's first AVA in 1981, the valley proper stretches "
            "in a banana shape from northwest to southeast, 30 miles (48 "
            "kilometres) long — similar to the length of Burgundy's Côte d'Or — "
            "and just 1 to 5 miles wide, beginning at San Pablo Bay and ending "
            "at the extinct volcano Mount St. Helena, flanked by the Vaca "
            "Mountains to the east and the Mayacamas to the west. The climate is "
            "quite Mediterranean, with dry, warm summers and wet, cool winters. "
            "Though it looks uniform to the untrained eye, ancient volcanic "
            "eruptions, the collision of the North American and Pacific plates, "
            "sedimentary soils from the old Pacific floor and the cyclical "
            "flooding of the Napa River have left an extraordinary diversity of "
            "soils: of the twelve soil orders scientists recognise worldwide, "
            "Napa has six, containing almost three dozen soil series and over a "
            "hundred variations. With more than four hundred wineries, most "
            "small and family owned, estates next door to one another often make "
            "wines that taste totally different. In addition to the Napa Valley "
            "AVA there are sixteen smaller AVAs within the valley. The name napa "
            "comes from the Wappo dialect and means 'plenty'."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "chardonnay", "merlot"],
            "climate": "quite Mediterranean — dry, warm summers and wet, cool "
                       "winters; flanked by the Vaca and Mayacamas ranges",
            "soil": "6 of the world's 12 soil orders; ~3 dozen soil series and "
                    "100+ variations — volcanic, sedimentary and alluvial",
            "classification_system": "California's first AVA (1981); 16 smaller "
                                     "AVAs nested within the valley",
            "signature": "the most polished, classy and complex wines in the "
                         "state, especially cabernet sauvignon",
            "size": "30 miles long, 1-5 miles wide; just 4% of California's wine",
            "wineries": "400+, most small and family owned",
        },
        grapes=("cabernet-sauvignon", "chardonnay", "merlot"),
        benchmarks=[("wine.body", 4.5, 4.0, 5.0),
                    ("wine.tannin", 4.0, 3.5, 4.5)],
    )

    # -------------------------------------------------------- SONOMA COUNTY
    # The book's structural signature here is CLIMATIC, not a body/tannin
    # claim: the fog/sunshine pendulum of warm days and cool nights. That
    # supports an ACIDITY benchmark (even, full maturation preserves acid)
    # but no body claim across a county with sixteen different AVAs.
    _region(
        conn, "Sonoma County", CITATION_SONOMA,
        short=(
            "California's Provence — more than twice the size of Napa, a "
            "patchwork of sixteen viticultural areas governed by a pendulum "
            "climate of coastal fog and sunshine, warm days and cool nights."
        ),
        full=(
            "Directly north of San Francisco and bordering the Pacific Ocean, "
            "Sonoma County has 1 million acres (404,700 hectares) of land, "
            "making it more than twice as big as its next-door neighbour Napa "
            "Valley. That size makes the county a geographical patchwork quilt "
            "of valleys, mountains, riverbeds, plains and benchlands, and within "
            "this shifting landscape lie sixteen viticultural areas that can be "
            "quite different in their nuances of climate and soil. Historically "
            "and culturally Sonoma is rather different from Napa: vineyards were "
            "planted here as the nineteenth century dawned, well before Napa, "
            "and many vintners belong to old, established farming families. A "
            "kicked-back country style pervades much of the region — people "
            "drive dusty pickups and the talk is as likely to be about tractors "
            "as about wine sales in Tokyo — yet among the top producers there is "
            "as much cutting-edge winemaking as anywhere in California. The "
            "county is beautifully pastoral and is often called California's "
            "Provence, with vineyards alternating with apple orchards, vegetable "
            "farms, redwood forests, dairies, sheep ranches and aquaculture "
            "fisheries along the rugged coast. Climatically, what makes Sonoma "
            "Sonoma is its pendulum-like rhythm: soft white fog rises in massive "
            "banks off the coast and drifts inland, wrapping around mountains "
            "and filling the valleys with cool vapour, giving a daily ebb and "
            "flow — almost a yin and yang — of fog and sunshine. Areas closer to "
            "the coast (especially the Sonoma Coast AVA and parts of the Russian "
            "River Valley) are cooler and those farther inland warmer, but "
            "overall the warm days and cool nights are the classic scenario for "
            "grapes with the potential to mature evenly and fully."
        ),
        attrs={
            "key_grapes": ["chardonnay", "pinot noir", "zinfandel",
                           "cabernet sauvignon"],
            "climate": "pendulum of coastal fog and sunshine — warm days, cool "
                       "nights; cooler near the coast, warmer inland",
            "classification_system": "AVA — sixteen viticultural areas within the "
                                     "county",
            "signature": "even, full maturation from the daily fog/sun rhythm; "
                         "'California's Provence'",
            "size": "1 million acres — more than twice the size of Napa Valley",
        },
        grapes=("chardonnay", "pinot-noir", "zinfandel"),
        benchmarks=[("wine.acidity", 3.5, 3.0, 4.0)],
    )

    # ---------------------------------------------------------- WASHINGTON
    # The book's claim is unusually direct and repeated: "highly structured,
    # deeply flavored cabernet sauvignon, merlot, and syrah" plus the striking
    # "concentration of the wines". Confident body + tannin.
    _region(
        conn, "Washington", CITATION_WA,
        short=(
            "The second-largest US wine state and a spiritual home of cabernet "
            "sauvignon and merlot — highly structured, deeply flavoured reds "
            "and inspired rieslings, grown in the arid east behind the Cascades."
        ),
        full=(
            "Most of the world's classic grapes grow in many places, but each "
            "has a spiritual home where it ascends beyond merely good; in the "
            "1990s Washington State emerged, to most wine drinkers' surprise, as "
            "one of the great spiritual homes of cabernet sauvignon and merlot. "
            "The phenomenon was startling, since barely a dozen years earlier "
            "growers had pinned their hopes on gewürztraminer, chardonnay and "
            "other whites — which still make good wine there, but nothing like "
            "the top tier of cabernets and merlots. By the late 1990s two more "
            "grapes captured growers' imaginations: riesling and syrah. By the "
            "late 2000s Washington made the best riesling in the country and had "
            "become a hotbed of fantastic, rich, complex syrahs the equal of any "
            "grown in the United States. What one notices immediately about the "
            "greatest Washington cabernets and merlots, or blends of the two, is "
            "the CONCENTRATION of the wines — as if by some magical osmosis they "
            "had been infused with the primal, lush berryness of wild Northwest "
            "blackberries, boysenberries, raspberries and cherries. The state is "
            "the second-largest wine producer in the US after California, and is "
            "one of the few places in the country — or the world — where many "
            "vines grow on their own roots rather than phylloxera-tolerant "
            "rootstocks. Virtually all of its vineyards lie not in the rainy "
            "west near Seattle but in the arid, almost desert-like eastern part "
            "of the state: the massive Cascade range is so effective a rain "
            "shield that eastern and western Washington are about as similar in "
            "appearance as Montana and Vermont. There are thirteen AVAs, the "
            "three most prominent being the gigantic Columbia Valley and, within "
            "it, Yakima Valley and Walla Walla Valley."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "merlot", "syrah", "riesling"],
            "climate": "arid, almost desert-like eastern Washington; the Cascade "
                       "range acts as a rain shield against the wet west",
            "classification_system": "AVA — thirteen in the state, most nested "
                                     "within the Columbia Valley",
            "signature": "highly structured, deeply flavoured reds of striking "
                         "concentration — wild Northwest berry character",
            "viticulture_note": "one of the few places worldwide where many vines "
                                "grow on their own roots, not grafted rootstock",
            "rank": "second-largest wine-producing state in the US",
        },
        grapes=("cabernet-sauvignon", "merlot", "syrah", "riesling"),
        benchmarks=[("wine.body", 4.0, 3.5, 4.5),
                    ("wine.tannin", 4.0, 3.5, 4.5)],
    )

    # ------------------------------------------------------------- OREGON
    # Pinot noir in a cool, marginal climate. The book stresses ELEGANCE,
    # "richness without heaviness", grace and finesse -> moderate body (an
    # explicit not-heavy claim) and the bright acidity of a marginal climate.
    oregon_short = (
        "Pinot noir country — a cool, marginal, nerve-racking climate that is "
        "precisely the cradle of its success, giving wines of grace, focus and "
        "richness without heaviness."
    )
    oregon_full = (
        "Growing grapes in Oregon is fraught with challenges: sunlight and heat "
        "can be in short supply so ripening is never a given, rain (about 40 "
        "inches/102 centimetres a year in the Willamette Valley) and frost "
        "threaten in spring and fall when grapes are most vulnerable, and "
        "weather patterns can be erratic — a stressful scenario for vines, which "
        "love constancy. And yet it is precisely the marginality of Oregon's "
        "climate, along with the state's unique geologic past, that forms the "
        "cradle of its success. Grapes here cannot burst into ripeness but must "
        "make their way slowly and methodically toward maturity and complexity. "
        "Each year is a gamble, but when the forces of nature align with skilled "
        "winemaking, Oregon wines of utter beauty, focus and finesse emerge. In "
        "the first decade of the twenty-first century Oregon turned the big "
        "corner: having long since given up California as a role model, and then "
        "France as well, its winemakers set out on their own course and forged a "
        "new way of working with the unique demands of their land, producing a "
        "mega-leap in quality — especially for the state's signature pinot "
        "noirs. If wines can be graceful AND luscious, if they can have richness "
        "without heaviness, then Oregon is the place to find them. Oregon also "
        "holds itself to stricter rules than federal law requires: its leading "
        "wine types — pinot noir, chardonnay and pinot gris — must contain at "
        "least 90 percent of the grape named on the label, against the US "
        "minimum of 75 percent (cabernet sauvignon, cabernet franc, merlot, "
        "syrah, sauvignon blanc and several others thought to benefit from "
        "blending are excepted and need only be 75 percent)."
    )
    oregon_attrs = {
        "key_grapes": ["pinot noir", "chardonnay", "pinot gris"],
        "climate": "cool and marginal — limited heat, ~40 inches of rain a year, "
                   "spring and fall frost risk; slow, methodical ripening",
        "classification_system": "AVA; plus Oregon's stricter state 90% "
                                 "varietal-labelling rule (US law requires 75%)",
        "signature": "pinot noir of grace, focus and finesse — richness without "
                     "heaviness",
        "labelling_rule": "pinot noir, chardonnay and pinot gris must be >=90% of "
                          "the named grape",
    }
    _region(
        conn, "Oregon", CITATION_OR,
        short=oregon_short, full=oregon_full, attrs=oregon_attrs,
        grapes=("pinot-noir", "chardonnay", "pinot-gris"),
        benchmarks=[("wine.body", 3.0, 2.5, 3.5),
                    ("wine.acidity", 4.0, 3.5, 4.5)],
    )

    # ---------------------------------------------------- WILLAMETTE VALLEY
    # The book names it as the group of small appellations producing most of
    # the state's best wines; it inherits Oregon's cool-marginal character.
    _region(
        conn, "Willamette Valley", CITATION_OR,
        short=(
            "The group of small appellations in Oregon's northwest corner that "
            "produce most of the state's best wines — the heartland of its "
            "signature pinot noir."
        ),
        full=(
            "Most of Oregon's best wines come from a group of small appellations "
            "that make up the Willamette Valley, in the northwest corner of the "
            "state. It is here that Oregon's specialty — pinot noir, a delicate "
            "and temperamental grape considered by many to make the most sensual "
            "red wines in the world — reaches its fullest expression. The "
            "valley's relatively cool, marginal climate, with about 40 inches "
            "(102 centimetres) of rain a year and the risk of frost in spring "
            "and fall, is the major factor in the elegance that characterises "
            "Oregon's top wines: grapes cannot burst into ripeness but must make "
            "their way slowly and methodically toward maturity and complexity. "
            "Willamette Valley is one of the American Viticultural Areas named "
            "on US labels alongside Napa Valley, the Finger Lakes and Columbia "
            "Valley."
        ),
        attrs={
            "key_grapes": ["pinot noir", "chardonnay", "pinot gris"],
            "climate": "relatively cool and marginal — ~40 inches of rain a year, "
                       "spring and fall frost risk",
            "classification_system": "AVA — a group of small nested appellations",
            "signature": "Oregon's finest pinot noir; elegance born of a cool, "
                         "marginal climate",
        },
        grapes=("pinot-noir", "chardonnay", "pinot-gris"),
        benchmarks=[("wine.body", 3.0, 2.5, 3.5),
                    ("wine.acidity", 4.0, 3.5, 4.5)],
    )
