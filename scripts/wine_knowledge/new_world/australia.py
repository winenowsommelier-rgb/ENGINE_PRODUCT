"""Australia sub-chapter loader — authored IN-SESSION from The Wine Bible (2nd
ed., Karen MacNeil; the AUSTRALIA chapter and its state-by-state "THE WINE
REGIONS" thumbnails). Nothing here is web-sourced or paid-API generated.

Mirrors `italy/piedmont.py`. Every context and benchmark carries a real
CITATION, and we link only to the EXISTING region/grape skeleton via `_helpers`
(which RAISE on a missing entity).

NO TIER LINKS. The Wine Bible's Australia chapter never documents the
Geographical Indication system, so no `australia-gi` entity exists and no
`classified_under` edge is authored — see the note in tiers.py. Inventing a
designation the source does not describe would break the citation discipline
that the whole graph rests on.

SHIRAZ = SYRAH. The book states plainly that shiraz is "the same as the French
grape syrah", so every region below links the EXISTING `syrah` slug rather than
creating a duplicate entity (see SYNONYM_TO_SLUG in grapes.py). The local name
is preserved in each region's prose and attrs.

REGION SELECTION is by catalogue weight intersected with book depth: South
Australia (202 SKUs), South Eastern Australia (171), Barossa Valley (137),
Margaret River (50), Victoria (47), Clare Valley (36), Coonawarra (29),
McLaren Vale (25), Yarra (16), Adelaide Hills (15), Hunter (12).
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.new_world import _helpers

CITATION = "Wine Bible 2e, Australia"
CITATION_SA = "Wine Bible 2e, Australia/South Australia"
CITATION_NSW = "Wine Bible 2e, Australia/New South Wales"
CITATION_VIC = "Wine Bible 2e, Australia/Victoria"
CITATION_WA = "Wine Bible 2e, Australia/Western Australia"


def _region(conn, name, citation, *, short, full, attrs, grapes=(),
            benchmarks=()):
    """Author one Australian region. No `tier` parameter by design — see the
    module docstring on the absent GI system."""
    rid = _helpers.find_region(conn, name)
    ctx = ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=citation, confidence="high",
        attributes=json.dumps(attrs),
    )
    for slug in grapes:
        _helpers.link_grape(conn, slug, rid)
    bench_citation = citation + " (narrative-derived)"
    for dim, typical, low, high in benchmarks:
        ingest.upsert_benchmark(
            conn, ctx, dim, typical=typical, low=low, high=high,
            confidence="medium", source_citation=bench_citation)
    return rid


def load(conn) -> None:
    # ------------------------------------------------------ SOUTH AUSTRALIA
    # The state. Produces more than half of all Australian wine and spans
    # everything from cool-climate Adelaide Hills riesling to Barossa shiraz,
    # so NO single structural benchmark is asserted.
    _region(
        conn, "South Australia", CITATION_SA,
        short=(
            "The driest state on the driest continent and the source of more "
            "than half of all Australian wine — home to the Barossa, Clare "
            "Valley, McLaren Vale, Coonawarra, Eden Valley and Adelaide Hills."
        ),
        full=(
            "South Australia is the driest state in Australia — which is itself "
            "the driest continent — and more than half of all Australian wine is "
            "produced here, including many of the country's best cabernet "
            "sauvignons, shirazes, chardonnays, rieslings and sémillons. Its "
            "wine regions span out from the city of Adelaide, the top ones being "
            "Adelaide Hills, Barossa Valley, Eden Valley, Clare Valley, McLaren "
            "Vale and Coonawarra. These districts were founded by men whose "
            "names became synonymous with Australian wine — Hamilton, Seppelt, "
            "Penfold — and today a Who's Who of large Australian wine companies "
            "is based here, including Hardys, Penfolds, Peter Lehmann, "
            "Seppeltsfield, Wolf Blass, Wynns and Yalumba, alongside a hotbed of "
            "small and medium-size avant-garde producers such as Henschke, Jim "
            "Barry, Grosset, Torbreck, Shaw & Smith and Tim Adams. Note that "
            "'South Australia' on a label is emphatically NOT the same as 'South "
            "Eastern Australia': South Australia is one of the five Australian "
            "states and contains the country's most famous wine regions, and its "
            "wines are among the most expensive in the country."
        ),
        attrs={
            "key_grapes": ["shiraz (syrah)", "cabernet sauvignon", "chardonnay",
                           "riesling", "sémillon", "grenache"],
            "climate": "the driest state on the driest continent; regions range "
                       "from cool-climate Adelaide Hills to warm Barossa floor",
            "signature": "more than half of all Australian wine, including many "
                         "of the country's best reds and rieslings",
            "key_regions": ["Adelaide Hills", "Barossa Valley", "Eden Valley",
                            "Clare Valley", "McLaren Vale", "Coonawarra"],
            "label_note": "NOT the same as 'South Eastern Australia' — this is a "
                          "single state and its wines are among the most "
                          "expensive in the country",
        },
        grapes=("syrah", "cabernet-sauvignon", "chardonnay", "riesling",
                "semillon", "grenache"),
    )

    # ---------------------------------------------- SOUTH EASTERN AUSTRALIA
    # 171 SKUs of what the book calls "in a sense, not a place". Recording
    # that honestly is far more useful to a shopper than a fabricated terroir
    # description. No benchmarks: the wine could come from anywhere.
    _region(
        conn, "South Eastern Australia", CITATION,
        short=(
            "Not a state and, in a sense, not a place — a legal blending "
            "designation covering grapes grown thousands of miles apart across "
            "three states. For these wines the producer's name is the guide to "
            "quality."
        ),
        full=(
            "South Eastern Australia is not a state and, in a sense, not a "
            "place: it is a legal designation meaning the wine in the bottle is "
            "a blend of wines made from grapes grown thousands of miles apart, "
            "often in three different states — New South Wales, Victoria and "
            "South Australia. To give a New World analogy, a wine labelled South "
            "Eastern Australia is the rough equivalent of a wine made from a "
            "blend of grapes grown in California, Oregon, Washington State and "
            "Texas and then called 'Western United States'. Not surprisingly, "
            "South Eastern Australia wines are often inexpensive wines meant for "
            "everyday drinking, in contrast to the wines of South Australia, "
            "which are among the most expensive in the country. For "
            "multiregional blends labelled this way the grapes will probably "
            "have come from disparate regions, possibly quite far apart, so THE "
            "MOST IMPORTANT GUIDE TO QUALITY IS THE PRODUCER'S NAME."
        ),
        attrs={
            "designation_type": "multi-state blending designation, not a "
                                "geographic wine region",
            "covers": ["New South Wales", "Victoria", "South Australia"],
            "typical_style": "inexpensive, everyday-drinking blends",
            "quality_guide": "the producer's name — terroir tells you nothing here",
            "contrast": "distinct from 'South Australia', which IS a single state",
        },
    )

    # -------------------------------------------------------- BAROSSA VALLEY
    # Australia's most famous region. Book: "rich, sappy shiraz with a
    # concentrated core of vivid berriness", "dramatic richness and bigness"
    # yet "superb structure, balance, and sense of precision" -> high body,
    # firm-but-not-extreme tannin (the balance/precision caveat matters).
    _region(
        conn, "Barossa Valley", CITATION_SA,
        short=(
            "Australia's most renowned region — rich, sappy shiraz with a "
            "concentrated core of vivid berriness over wild lavender, spice and "
            "licorice, yet with superb structure, balance and precision."
        ),
        full=(
            "The Barossa Valley is the most famous wine region in Australia. The "
            "wide, fertile valley is made up of biscuit-coloured hills, and its "
            "small hamlets are full of old stone cottages. The Barossa — as it is "
            "simply known — was settled in the nineteenth century by Silesian "
            "immigrants (Silesia, today part of Poland, was then part of "
            "Germany, and German is still regularly spoken here), an insular "
            "community of hardworking, frugal farmers with a strong food culture "
            "of baked, pickled, preserved and smoked specialities, still evident "
            "in the hugely popular Barossa Farmer's Market and the annual dill "
            "gherkin and pickled onion championships. Great cabernet is made in "
            "the Barossa, along with fine grenaches and grenache blends and "
            "superb Australian fortified tawnies. But above all the Barossa is "
            "known for shiraz — rich, sappy shiraz with a concentrated core of "
            "vivid 'berriness' overlaid by wild lavender, spice, brambly and "
            "licorice notes. Yet for all their dramatic richness and bigness, "
            "the best Barossa shirazes also have a superb structure, balance and "
            "sense of precision."
        ),
        attrs={
            "key_grapes": ["shiraz (syrah)", "cabernet sauvignon", "grenache"],
            "climate": "warm; a wide, fertile valley of biscuit-coloured hills",
            "signature": "rich, sappy shiraz — vivid berriness with wild lavender, "
                         "spice, bramble and licorice, but structured and precise",
            "history": "settled in the 19th century by Silesian immigrants; German "
                       "is still regularly spoken",
            "also_known_for": ["grenache and grenache blends",
                               "fortified tawny", "cabernet sauvignon"],
        },
        grapes=("syrah", "cabernet-sauvignon", "grenache"),
        benchmarks=[("wine.body", 4.5, 4.0, 5.0),
                    ("wine.tannin", 4.0, 3.5, 4.5)],
    )

    # ----------------------------------------------------------- CLARE VALLEY
    # Riesling. Book is explicit and structural: "more citrusy, with driving
    # acidity", crispness from cold nights and limestone soils -> high acid,
    # light body.
    _region(
        conn, "Clare Valley", CITATION_SA,
        short=(
            "An elevated plateau famous for exquisite dry riesling — citrusy, "
            "with driving acidity preserved by extremely cold nights and "
            "limestone-laced soils."
        ),
        full=(
            "Clare Valley (which, like Eden Valley, is not a true valley but an "
            "elevated plateau) is known for exquisite rieslings, although it "
            "also makes very precise shirazes. Where Eden Valley's rieslings are "
            "more floral, exotic and medium-bodied, those of Clare Valley are "
            "more citrusy, with driving acidity. It is commonly assumed that the "
            "rieslings from these areas are picked early to achieve their "
            "dizzying crispness, but they are not: rather, the regions' "
            "extremely cold nights and water-holding, limestone-laced soils are "
            "credited with preserving riesling's backbone of inherent acidity. "
            "Clare Valley sits within South Australia, the state that produces "
            "more than half of all Australian wine."
        ),
        attrs={
            "key_grapes": ["riesling", "shiraz (syrah)"],
            "climate": "elevated plateau with extremely cold nights",
            "soil": "water-holding, limestone-laced",
            "signature": "citrusy dry riesling with driving acidity — crispness "
                         "from cold nights and soil, NOT from early picking",
            "also_known_for": ["very precise shiraz"],
        },
        grapes=("riesling", "syrah"),
        benchmarks=[("wine.body", 2.0, 1.5, 2.5),
                    ("wine.acidity", 4.5, 4.0, 5.0)],
    )

    # ------------------------------------------------------------ COONAWARRA
    # Cabernet on terra rossa. Book: "one of the best places in the country for
    # STRUCTURED cabernet sauvignons", maritime climate "like that of
    # Bordeaux" -> firm tannin, full-ish body.
    _region(
        conn, "Coonawarra", CITATION_SA,
        short=(
            "A cigar-shaped strip of terra rossa over limestone with a maritime "
            "climate like Bordeaux's — one of the best places in Australia for "
            "structured cabernet sauvignon."
        ),
        full=(
            "Coonawarra — the name is Aboriginal for 'honeysuckle' — is "
            "considered, along with Western Australia's Margaret River, one of "
            "the best places in the country for structured cabernet sauvignons. "
            "The region, about 230 miles (370 kilometres) south of Adelaide, is "
            "a cigar-shaped strip just 7.5 miles (12 kilometres) long and 1.2 "
            "miles (1.9 kilometres) wide of terra rossa soil — porous reddish "
            "clay overlaying limestone. The climate, not surprisingly, is "
            "maritime, like that of Bordeaux."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "shiraz (syrah)"],
            "climate": "maritime, like that of Bordeaux",
            "soil": "terra rossa — porous reddish clay over limestone",
            "signature": "structured cabernet sauvignon; with Margaret River, one "
                         "of the two best cabernet addresses in Australia",
            "size": "a cigar-shaped strip 7.5 miles long and 1.2 miles wide",
            "name_origin": "Aboriginal for 'honeysuckle'",
        },
        grapes=("cabernet-sauvignon", "syrah"),
        benchmarks=[("wine.body", 4.0, 3.5, 4.5),
                    ("wine.tannin", 4.0, 3.5, 4.5)],
    )

    # ----------------------------------------------------------- MCLAREN VALE
    # Book: shiraz "powerful and ripe character but SLEEK structure", with
    # "dramatic lift of spiciness, black olive, menthol, and dark chocolate".
    # Powerful+ripe -> full body; "sleek" argues against maximal tannin.
    _region(
        conn, "McLaren Vale", CITATION_SA,
        short=(
            "Shiraz country on the Fleurieu Peninsula — powerful and ripe but "
            "sleek in structure, with a dramatic lift of spice, black olive, "
            "menthol and dark chocolate."
        ),
        full=(
            "In a blind tasting the shirazes from McLaren Vale always seem "
            "relatively easy to pick out: first for their powerful and ripe "
            "character but sleek structure, and second for their dramatic lift "
            "of spiciness, black olive, menthol and dark chocolate. Clarendon "
            "Hills' Astralis Shiraz and d'Arenberg's The Dead Arm Shiraz are "
            "perfect examples. The small region — a mix of hills and valleys "
            "with ironstone and loamy clay soils — lies just 22 miles (35 "
            "kilometres) south of Adelaide on the Fleurieu Peninsula, bounded on "
            "the northwest by the Onkaparinga River and on the west by Gulf St. "
            "Vincent, giving at least some of the vines a bit of cooling "
            "maritime influence, which may help account for the wine's structure "
            "and elegance. Grapes were first planted here in 1838 by John "
            "Reynell and Thomas Hardy, who started Seaview and the Hardy Wine "
            "Company respectively. Shiraz accounts for more than 50 percent of "
            "the wine made in McLaren Vale."
        ),
        attrs={
            "key_grapes": ["shiraz (syrah)", "grenache"],
            "climate": "warm with a cooling maritime influence from Gulf St. Vincent",
            "soil": "ironstone and loamy clay over a mix of hills and valleys",
            "signature": "powerful, ripe yet sleek shiraz — spice, black olive, "
                         "menthol, dark chocolate",
            "shiraz_share": "more than 50 percent of the region's wine",
        },
        grapes=("syrah", "grenache"),
        benchmarks=[("wine.body", 4.5, 4.0, 5.0),
                    ("wine.tannin", 3.5, 3.0, 4.0)],
    )

    # --------------------------------------------------------- ADELAIDE HILLS
    # Cool-climate and explicitly DIVERSE ("a wide range of grape varieties"),
    # so no body/tannin benchmark; the one safe structural read from
    # "cool-climate" is bright acidity.
    _region(
        conn, "Adelaide Hills", CITATION_SA,
        short=(
            "A cool-climate region just east of Adelaide — one of Australia's "
            "largest and most diverse, growing everything from riesling and "
            "sauvignon blanc to shiraz and cabernet."
        ),
        full=(
            "A cool-climate region just east of the city of Adelaide, the "
            "Adelaide Hills is one of the largest geographical regions in "
            "Australia and one of the most diverse. A wide range of grape "
            "varieties — everything from riesling, sauvignon blanc and "
            "chardonnay to shiraz and cabernet sauvignon — grows here. "
            "Viticulture in the Adelaide Hills began in the 1840s, but a modern "
            "industry took hold only after the 1970s. It is one of the top "
            "regions of South Australia, the state that produces more than half "
            "of all Australian wine."
        ),
        attrs={
            "key_grapes": ["sauvignon blanc", "chardonnay", "riesling",
                           "shiraz (syrah)", "cabernet sauvignon"],
            "climate": "cool-climate, just east of Adelaide",
            "signature": "breadth — one of Australia's largest and most diverse "
                         "regions, spanning crisp whites to full reds",
            "history": "viticulture from the 1840s; modern industry post-1970s",
        },
        grapes=("sauvignon-blanc", "chardonnay", "riesling", "syrah",
                "cabernet-sauvignon"),
        benchmarks=[("wine.acidity", 4.0, 3.5, 4.5)],
    )

    # ---------------------------------------------------------- MARGARET RIVER
    # "Little Bordeaux": sem/sauv blends + "structure and elegance" of the
    # cabernets. Elegance tempers the tannin read vs Coonawarra.
    _region(
        conn, "Margaret River", CITATION_WA,
        short=(
            "Australia's 'little Bordeaux' on the remote west coast, where the "
            "warm Indian and cold Southern Oceans collide — elegant, structured "
            "cabernet and lovely sémillon/sauvignon blanc blends."
        ),
        full=(
            "Three hours south of Perth, where the great warm Indian Ocean and "
            "the cold Southern Ocean collide, lies the most renowned and "
            "ambitious of all Western Australian districts: Margaret River. "
            "Originally known for its timber, it is one of the world's newer "
            "fine wine regions — vines were not planted until the late 1960s, "
            "more than a century after grapes were planted in the Napa Valley — "
            "and it remains extremely remote, best known to the wider world for "
            "its hypnotic giant waves. A key pioneer was David Hohnen, who "
            "learned winemaking in California and founded Cape Mentelle in 1970 "
            "(he later founded Cloudy Bay in Marlborough, New Zealand, in 1983). "
            "Given the region's maritime location and gravelly soils, Hohnen and "
            "other pioneers focused not on shiraz but on BORDEAUX varieties, and "
            "today Margaret River is considered something of a 'little Bordeaux' "
            "for the loveliness of its sémillon/sauvignon blanc blends and the "
            "structure and elegance of its cabernet sauvignons — especially from "
            "Cape Mentelle, Leeuwin Estate and Vasse Felix. Chardonnay too has "
            "an almost magical affinity for the region: Leeuwin Estate's Art "
            "Series Chardonnays are wines of depth that grow richer and more "
            "expansive with several years' age, and are among the best produced "
            "in all of Australia. Despite a nearly ideal sunny, ocean-cooled "
            "climate there is one huge problem: birds. Each row of vines must be "
            "netted as harvest approaches — before netting, three crops out of "
            "five were lost to the omnivorous silvereyes."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "sémillon", "sauvignon blanc",
                           "chardonnay"],
            "climate": "maritime and ocean-cooled, where the warm Indian Ocean "
                       "meets the cold Southern Ocean",
            "soil": "gravelly",
            "signature": "'little Bordeaux' — elegant, structured cabernet and "
                         "sémillon/sauvignon blanc blends; outstanding chardonnay",
            "history": "one of the world's newest fine wine regions — first vines "
                       "in the late 1960s",
        },
        grapes=("cabernet-sauvignon", "semillon", "sauvignon-blanc", "chardonnay"),
        benchmarks=[("wine.body", 3.5, 3.0, 4.0),
                    ("wine.tannin", 3.5, 3.0, 4.0)],
    )

    # --------------------------------------------------------------- VICTORIA
    # Explicitly varied ("vary considerably in climate, terrain, and soil"),
    # so no structural benchmark for the state as a whole.
    _region(
        conn, "Victoria", CITATION_VIC,
        short=(
            "Mainland Australia's smallest and most southern wine state — 820+ "
            "producers across a dozen districts fanning out from Melbourne, "
            "from cool coastal pinot noir to Rutherglen's sweet muscats."
        ),
        full=(
            "Just as northern California's wine industry was jump-started by the "
            "gold rush of 1849, the discovery of gold in Victoria in 1851 paved "
            "the way for a fledgling wine industry; as the supply of gold "
            "dwindled, vintners were known to hire out-of-work miners to dig "
            "underground wine cellars. By the 1960s Victoria's wine industry was "
            "a shadow of its former self, but a new period of growth came with "
            "the Australian boom of the 1970s and 1980s. Of all mainland "
            "Australia's wine regions Victoria is the smallest and most "
            "southern, with more than 820 producers spread over more than a "
            "dozen small wine districts fanning out from Melbourne. Its "
            "districts vary considerably in climate, terrain and soil, thanks in "
            "part to the Great Dividing Range, which creates mountainous and "
            "hilly terrain over more than a third of the state. Several of the "
            "most renowned districts — the Yarra Valley, Geelong and Mornington "
            "Peninsula — lie very close to the sea and benefit from cool breezes "
            "off the Great Southern Ocean, and in these cool areas chardonnay "
            "and pinot noir thrive. Farther inland, in slightly warmer pockets "
            "like Beechworth, the chardonnays can again be stellar if richer. "
            "Victoria is also known for cabernet sauvignon and shiraz, and one "
            "of its specialities is the captivating sweet muscats and topaques "
            "of Rutherglen in the northeast — spellbinding and unctuous wines. "
            "Victoria has always been associated with sparkling wine too: "
            "Seppelt is in the Grampians, and in 1986 Moët & Chandon founded "
            "Chandon Australia in the Yarra Valley."
        ),
        attrs={
            "key_grapes": ["chardonnay", "pinot noir", "shiraz (syrah)",
                           "cabernet sauvignon", "muscat"],
            "climate": "varies considerably — cool maritime near the coast, "
                       "warmer inland; Great Dividing Range creates hill country",
            "signature": "cool-coastal chardonnay and pinot noir, plus "
                         "Rutherglen's sweet muscats and topaques",
            "producers": "820+ across more than a dozen districts",
            "history": "jump-started by the 1851 Victorian gold rush",
        },
        grapes=("chardonnay", "pinot-noir", "syrah", "cabernet-sauvignon",
                "muscat"),
    )

    # ------------------------------------------------------------------ YARRA
    # A cool coastal Victorian district where "chardonnay and pinot noir
    # thrive" -> lighter body, brighter acidity.
    _region(
        conn, "Yarra", CITATION_VIC,
        short=(
            "One of Victoria's most renowned districts — close to the sea and "
            "cooled by breezes off the Great Southern Ocean, where chardonnay "
            "and pinot noir thrive."
        ),
        full=(
            "The Yarra Valley is one of the most renowned wine districts of "
            "Victoria, mainland Australia's smallest and most southern wine "
            "state. Along with Geelong and the Mornington Peninsula it lies very "
            "close to the sea and benefits from the cool breezes that sweep in "
            "off the Great Southern Ocean; in these cool areas chardonnay and "
            "pinot noir grapes thrive. Victoria's districts vary considerably in "
            "climate, terrain and soil thanks in part to the Great Dividing "
            "Range, and the Yarra sits at the cool end of that range. Producers "
            "such as Yarra Yering and Mount Mary make delicious red blends here, "
            "and in 1986 the French Champagne house Moët & Chandon founded "
            "Chandon Australia in the Yarra Valley, continuing Victoria's long "
            "association with sparkling wine."
        ),
        attrs={
            "key_grapes": ["chardonnay", "pinot noir", "cabernet sauvignon",
                           "shiraz (syrah)"],
            "climate": "cool — close to the sea, swept by breezes off the Great "
                       "Southern Ocean",
            "signature": "cool-climate chardonnay and pinot noir; sparkling wine "
                         "(Chandon Australia, founded 1986)",
        },
        grapes=("chardonnay", "pinot-noir"),
        benchmarks=[("wine.body", 3.0, 2.5, 3.5),
                    ("wine.acidity", 4.0, 3.5, 4.5)],
    )

    # ----------------------------------------------------------------- HUNTER
    # Sémillon is the ace: "as high in acid as wine gets" — the single most
    # emphatic acidity claim in the whole Australia chapter, and the wine is
    # light-bodied in youth.
    _region(
        conn, "Hunter", CITATION_NSW,
        short=(
            "Australia's first wine area, warm and almost too humid for grapes — "
            "yet the home of an ace in the hole: sémillon as high in acid as "
            "wine gets, which ages into a honey pot of nutty, buttery fruit."
        ),
        full=(
            "The most famous wine district in New South Wales — Australia's "
            "second-leading wine state after South Australia — is the relatively "
            "small Hunter Valley, 75 miles (120 kilometres) north of Sydney. The "
            "Hunter was the FIRST wine area in Australia, with vineyards planted "
            "at the beginning of the nineteenth century by the country's "
            "earliest European settlers, who had moved inland after their first "
            "vines rotted in the heat and humidity of the coastal penal colony. "
            "Around 1960 Penfolds moved to an area slightly north of the "
            "original vineyards, creating the distinction between the Upper and "
            "Lower Hunter. The whole region is something of an anomaly: being "
            "one of the most northerly of Australia's wine districts it is "
            "closer to the equator, its weather influenced by warm ocean "
            "currents from the tropics, and it is very warm and almost too humid "
            "for grapes. Nonetheless, and almost against all odds, several top "
            "chardonnays and shirazes come from here. But the Hunter's ace in "
            "the hole is sémillon — a wine that starts out bracing, limey, white "
            "peppery and as high in acid as wine gets; drinking it is like being "
            "slapped. With age, five to ten years or more, something startling "
            "happens: the wine turns into a honey pot of rich, nutty, buttery "
            "fruit. Great examples come from Tyrrell's, McWilliam's, Mount "
            "Pleasant, Hart & Hunter, Thomas Wines and Brokenwood."
        ),
        attrs={
            "key_grapes": ["sémillon", "chardonnay", "shiraz (syrah)"],
            "climate": "very warm and almost too humid for grapes — one of "
                       "Australia's most northerly districts, warmed by tropical "
                       "ocean currents",
            "signature": "Hunter sémillon — bracing, limey and searingly high in "
                         "acid young, turning nutty and honeyed after 5-10 years",
            "history": "the first wine area in Australia, planted at the start of "
                       "the 19th century",
            "subregions": ["Upper Hunter", "Lower Hunter"],
        },
        grapes=("semillon", "chardonnay", "syrah"),
        benchmarks=[("wine.body", 2.5, 2.0, 3.0),
                    ("wine.acidity", 5.0, 4.5, 5.0)],
    )
