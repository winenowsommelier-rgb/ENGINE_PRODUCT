"""Region loaders for the Plan-3c chapters (Argentina, New Zealand, Germany,
Portugal, Austria) — authored IN-SESSION from The Wine Bible (2nd ed., Karen
MacNeil). Nothing here is web-sourced or paid-API generated.

Mirrors `new_world/spain.py`. Every context and benchmark carries a real
CITATION, and we link only to the EXISTING region/grape skeleton via `_helpers`
(which RAISE on a missing entity rather than blind-creating one).

TIER SCOPE — nothing is wired to a region here. Every tier this chapter creates
(Prädikat ripeness, Vinea Wachau alcohol, Eiswein, VDP) is a property of a
WINE, not of a place: "Mosel classified_under Trockenbeerenauslese" would claim
every Mosel wine is a TBA. Germany's own place-level classification (the
Anbaugebiete) is not described in enough detail by the book to model honestly,
and Portugal/Argentina/New Zealand place systems are likewise not covered, so
NO `classified_under` edges are authored in this module at all. The Plan-3b
precedent for this is Australia (no GI entity because the book never documents
one).

LOW-SKU DISCIPLINE — Kamptal carries only 2 in-stock SKUs. Per the
no-inferred-item-level-data rule, a description for a 1-3 SKU region must stay
on verifiable geography/industry facts and must NOT drift into sensory language
that would function as a tasting note for those specific bottles. Kamptal's
copy below is deliberately geographic and its `attrs` carry an explicit
confirm-with-producer note. It gets NO benchmark.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.rest_of_world import _helpers

CITATION_AR = "Wine Bible 2e, Argentina"
CITATION_NZ = "Wine Bible 2e, New Zealand"
CITATION_DE = "Wine Bible 2e, Germany"
CITATION_MOSEL = "Wine Bible 2e, Germany/The Mosel"
CITATION_RHEINGAU = "Wine Bible 2e, Germany/The Rheingau"
CITATION_PT = "Wine Bible 2e, Portugal"
CITATION_PORT = "Wine Bible 2e, Portugal/Port"
CITATION_AT = "Wine Bible 2e, Austria"

# Regions with <= 3 in-stock SKUs, where taxonomy copy must not read as a
# tasting note for the handful of bottles behind it. Verified against the live
# export on 2026-07-27. Enforced by a unit test.
LOW_SKU_REGIONS = ("Kamptal",)


def _region(conn, name, citation, *, short, full, attrs, grapes=(),
            benchmarks=()):
    """Author one region. No `tier` parameter by design — see module docstring."""
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
    # ============================================================= ARGENTINA
    # Mendoza (197 SKUs). Malbec: "remarkably soft, rich, and palate-coating"
    # — an explicit structural claim (full body, SOFT tannin), and notably the
    # opposite of Cahors côt, which the book calls "hard, sleek, and tannic".
    _region(
        conn, "Mendoza", CITATION_AR,
        short=(
            "Argentina's leading wine province and the heartbeat of its "
            "industry — high-desert vineyards at 4,000 feet framed by the "
            "Andes, and the home of the vast majority of Argentine malbec."
        ),
        full=(
            "Mendoza is the name of Argentina's leading wine province and of "
            "its capital city, founded in 1561; both were named for Don García "
            "Hurtado de Mendoza, a sixteenth-century Chilean governor, from the "
            "era when Mendoza belonged to the Captaincy of Chile. Huddled in "
            "the high desert foothills of the Andes, the province covers more "
            "than 36 million acres — at over 57,000 square miles it is about "
            "the size of New York State — though less than 5 percent of its "
            "surface is planted with vines. Mendoza is more than the leading "
            "wine region: it is the heartbeat of the Argentine wine industry. "
            "Of roughly 1,400 wineries in Argentina, nearly 1,000 are in this "
            "one province, and a majority of all Argentine wine, including the "
            "vast majority of all malbec, is grown here. The region lies "
            "directly west of Buenos Aires, some 1,000 miles inland from the "
            "Atlantic; its vineyards, at 4,000 feet (1,200 metres) and more, "
            "are the highest in the country and are framed by the snowcapped "
            "Andes. The climate is extremely dry, with intense sunlight — what "
            "Mendozans call 'sunlight density' — but temperatures stay "
            "generally mild thanks to the elevation. The most important "
            "subregions lie south of Mendoza city along the Ruta 40 corridor, "
            "including Luján de Cuyo and the Uco Valley (itself made up of "
            "Tupungato, Tunuyán and San Carlos). Malbec, native to Cahors in "
            "southwest France where it is called côt, behaves quite differently "
            "here: where Cahors côt is extremely hard, sleek and tannic, "
            "Argentine malbec is usually remarkably soft, rich and "
            "palate-coating. In arid Argentina the variety thrived, and the "
            "country may now have the deepest DNA pool of malbec clones in the "
            "world."
        ),
        attrs={
            "key_grapes": ["malbec", "cabernet sauvignon", "chardonnay"],
            "climate": "high-desert — extremely dry, intense 'sunlight density', "
                       "mild temperatures thanks to altitude",
            "elevation": "4,000 ft (1,200 m) and above — the highest in Argentina",
            "signature": "soft, rich, palate-coating malbec — the opposite of "
                         "Cahors' hard, sleek, tannic côt",
            "subregions": ["Luján de Cuyo", "Uco Valley (Tupungato, Tunuyán, "
                           "San Carlos)"],
            "scale": "~1,000 of Argentina's ~1,400 wineries; <5% of the province "
                     "is planted to vine",
        },
        grapes=("malbec", "cabernet-sauvignon", "chardonnay"),
        benchmarks=[("wine.body", 4.0, 3.5, 4.5),
                    ("wine.tannin", 2.5, 2.0, 3.0)],
    )

    # =========================================================== NEW ZEALAND
    # Marlborough (119). Sauvignon blanc: "explosive yet taut", "racy,
    # vibrant", cool maritime climate giving "a dazzling sense of crispness"
    # -> high acidity, light-to-moderate body.
    _region(
        conn, "Marlborough", CITATION_NZ,
        short=(
            "The region whose sauvignon blanc put New Zealand on the world wine "
            "map — explosive yet taut wines evoking a whole spectrum of fresh "
            "greens over an exotic tropical backdrop."
        ),
        full=(
            "Marlborough is the heartland of the wine that made New Zealand "
            "famous. In the mid-1980s, almost against all odds, one wine rose "
            "to extraordinary fame — Cloudy Bay Sauvignon Blanc — and its first "
            "few vintages put the whole of New Zealand on the international "
            "wine map. It was the first time a single wine had ever had such "
            "impact, made more surprising because sauvignon blanc was then "
            "considered something of a second-string variety. Sauvignon blanc "
            "is now the leading variety in the country and the wine that "
            "dominates exports, and New Zealand sauvignon blancs have no "
            "parallel anywhere in the world: explosive yet taut, they evoke a "
            "spectrum of fresh greens — limes, wild herbs, watercress, "
            "gooseberries, green olives, green figs, green tea, green melons — "
            "over an exotic tropical backdrop hinting at mango, papaya or "
            "passion fruit. The combination makes for untamed, unleashed wines "
            "true to their name, sauvignon deriving from the French sauvage, "
            "'wild'. Greenness is a double-edged sword, and for the top estates "
            "the key has been to harness sauvignon's freshness and zing while "
            "leaving out strident, raw, unripe flavours. Most are fermented in "
            "stainless steel so the green and tropical flavours are not bogged "
            "down by oak, and the best are dry — leaving residual sugar to mask "
            "unripe, vegetal wine is regarded as a cheap trick. Marlborough is "
            "also a significant source of the country's increasingly successful "
            "pinot noir."
        ),
        attrs={
            "key_grapes": ["sauvignon blanc", "pinot noir", "riesling"],
            "climate": "cool maritime — no New Zealand vineyard is more than 80 "
                       "miles from the sea; long, gentle growing season",
            "signature": "explosive yet taut sauvignon blanc — fresh greens over "
                         "an exotic tropical backdrop",
            "winemaking": "mostly stainless steel to protect green/tropical "
                          "flavours; top examples are dry",
            "history": "Cloudy Bay Sauvignon Blanc (mid-1980s) put New Zealand "
                       "on the international wine map",
        },
        grapes=("sauvignon-blanc", "pinot-noir", "riesling"),
        benchmarks=[("wine.body", 2.5, 2.0, 3.0),
                    ("wine.acidity", 4.5, 4.0, 5.0)],
    )

    # Central Otago (21) — the world's southernmost vineyards; pinot noir.
    _region(
        conn, "Central Otago", CITATION_NZ,
        short=(
            "Home to the southernmost vineyards on earth and a leading source "
            "of New Zealand's earthy, elegant pinot noir."
        ),
        full=(
            "Central Otago lies at the far south of New Zealand's South Island, "
            "in a country whose vineyards are the southernmost in the world and "
            "the first on earth to see the sun each day, thanks to New "
            "Zealand's location close to the International Date Line. New "
            "Zealand is best known for its racy, vibrant sauvignon blancs and "
            "its earthy, elegant pinot noirs, and Central Otago is one of the "
            "country's most celebrated pinot noir addresses. Pinot noir has "
            "proven hugely successful here in a very short period — plantings "
            "doubled nationally in the decade between 2003 and 2013 — and "
            "because it is such a new phenomenon, growers and winemakers are "
            "still discovering the best sites and methods. Much of the quality "
            "traces to the so-called Gumboot (or Abel) Clone, smuggled in from "
            "France in a rain boot in the 1970s and now behind some of the "
            "country's finest pinot noirs. The coolness of the climate is the "
            "factor that most influences New Zealand's grapes: a cool, steady "
            "climate lets fruit ripen evenly and gently over a long growing "
            "season, culminating in a harvest that can fall anywhere from March "
            "to May, and gives the grapes a good amount of natural acidity."
        ),
        attrs={
            "key_grapes": ["pinot noir", "riesling", "chardonnay"],
            "climate": "cool; the world's southernmost vineyards, with a long, "
                       "gentle growing season and a March-May harvest",
            "signature": "earthy, elegant pinot noir",
            "note": "much NZ pinot quality traces to the Gumboot/Abel clone",
        },
        grapes=("pinot-noir", "riesling", "chardonnay"),
        benchmarks=[("wine.body", 3.0, 2.5, 3.5),
                    ("wine.acidity", 4.0, 3.5, 4.5)],
    )

    # Hawke's Bay (26) and Martinborough (19).
    _region(
        conn, "Hawke's Bay", CITATION_NZ,
        short=(
            "A warmer North Island region in one of the coolest maritime "
            "wine countries of the New World — a long, gentle growing season "
            "yielding wines of pure, intense flavour."
        ),
        full=(
            "Hawke's Bay is one of New Zealand's established North Island wine "
            "regions. The factor that most influences New Zealand's grapes, and "
            "hence its wines, is the coolness of the climate: the country has "
            "some of the coolest maritime wine regions in the New World, and "
            "because of the long, narrow shape of the two main islands no "
            "vineyard is more than 80 miles (130 kilometres) from the sea. That "
            "cool, steady climate allows grapes to ripen evenly and gently over "
            "a long growing season, culminating in a harvest that can take "
            "place anytime from March to May. In the best circumstances the "
            "length of the growing season leads to elegant wines with "
            "wonderfully pure flavours — it is often said that New Zealand "
            "produce, grapes included, has an intensity of flavour rarely found "
            "elsewhere — and a cool climate also means the grapes carry a good "
            "amount of natural acidity, which for the best whites translates "
            "into a dazzling sense of crispness. New Zealand's wine industry "
            "remains tiny by global standards, accounting for less than 1 "
            "percent of world production."
        ),
        attrs={
            "key_grapes": ["chardonnay", "sauvignon blanc", "merlot",
                           "cabernet sauvignon", "syrah"],
            "climate": "cool maritime, warmer than the South Island regions; no "
                       "vineyard more than 80 miles from the sea",
            "signature": "pure, intense flavours from a long, gentle growing "
                         "season; naturally high acidity",
        },
        grapes=("chardonnay", "sauvignon-blanc", "merlot", "syrah"),
        benchmarks=[("wine.acidity", 4.0, 3.5, 4.5)],
    )

    _region(
        conn, "Martinborough", CITATION_NZ,
        short=(
            "A small North Island region at the southern tip of the Wairarapa, "
            "known with Marlborough and Central Otago for New Zealand's earthy, "
            "elegant pinot noir."
        ),
        full=(
            "Martinborough is a small but highly regarded New Zealand wine "
            "region and, with Marlborough and Central Otago, one of the "
            "addresses most associated with the country's earthy, elegant pinot "
            "noir. Pinot noir has proven hugely successful in New Zealand in a "
            "very short time — national plantings doubled between 2003 and 2013 "
            "— and winemakers at top estates such as Ata Rangi and Dry River "
            "began experimenting with pinot noir clones only in the late 1980s, "
            "so growers are still discovering the best sites and methods. Ata "
            "Rangi's Clive Paton was given cuttings of what became known as the "
            "Gumboot or Abel Clone, now behind some of the best pinot noirs in "
            "the country. As everywhere in New Zealand, the cool maritime "
            "climate — no vineyard is more than 80 miles from the sea — lets "
            "fruit ripen evenly and gently over a long season and preserves a "
            "good amount of natural acidity."
        ),
        attrs={
            "key_grapes": ["pinot noir", "sauvignon blanc", "chardonnay"],
            "climate": "cool maritime, at the southern tip of the North Island",
            "signature": "earthy, elegant pinot noir",
            "note": "home of Ata Rangi, where the Gumboot/Abel clone was first "
                    "grown on",
        },
        grapes=("pinot-noir", "sauvignon-blanc", "chardonnay"),
        benchmarks=[("wine.body", 3.0, 2.5, 3.5),
                    ("wine.acidity", 4.0, 3.5, 4.5)],
    )

    # =============================================================== GERMANY
    # Mosel (39). "Ravishingly elegant", "crystalline clarity", steepest
    # vineyards, northern latitude -> light body + very high acidity. Germany
    # as a whole runs 6-8 g/l acidity vs Champagne's 5-6, per the book.
    _region(
        conn, "Mosel", CITATION_MOSEL,
        short=(
            "Where Germany's most ravishingly elegant wines are made — riesling "
            "of crystalline clarity from the steepest vineyards in Germany, on "
            "grey-blue slate above a snaking river gorge."
        ),
        full=(
            "The Mosel is where Germany's most ravishingly elegant wines are "
            "made. The region — some 21,700 acres (8,800 hectares) — is defined "
            "by the hauntingly beautiful and eerily still Mosel River, which "
            "cuts a deep, snakelike gorge through the land, entering Germany "
            "where the country converges with Luxembourg and France and winding "
            "about 145 miles northeast until it empties into the Rhine near "
            "Koblenz; the Saar and the Ruwer are its small tributaries. The "
            "Mosel's greatest grape is riesling, but that states the case too "
            "simply, for here riesling is turned into wines of such crystalline "
            "clarity they are like glittering sunlight on a subzero day. The "
            "reasons are several. The vineyards are the steepest in Germany and "
            "among the steepest in the world — the stretch from Zelting to "
            "Bernkastel is considered the longest run of near-vertical "
            "vineyards anywhere on the globe, and the steepest vineyard in the "
            "world, Calmont, has a 60- to 70-degree incline that makes it look "
            "like a vertical wall of vines gripping the slatey cliff. They are "
            "also among Germany's most northern. Steepness in a cold, northern "
            "region means the sun is in contact with the vines for limited, "
            "precious hours each day, and the total sunlight during the growing "
            "season is modest — in a good year the Mosel gets about a third of "
            "the sunlight hours that Provence does. So vineyards must be "
            "perfectly sited to maximise every ray, and the region's famous "
            "grey-blue slate holds heat well, helping riesling to ripen."
        ),
        attrs={
            "key_grapes": ["riesling"],
            "climate": "cold and northern, with modest sunlight — about a third "
                       "of Provence's growing-season hours in a good year",
            "soil": "famous grey-blue slate, which holds heat and helps riesling "
                    "ripen",
            "signature": "riesling of crystalline clarity and ravishing elegance",
            "topography": "the steepest vineyards in Germany and among the "
                          "steepest in the world (Calmont: 60-70 degrees)",
            "size": "21,700 acres (8,800 ha) along a 145-mile river gorge",
        },
        grapes=("riesling",),
        benchmarks=[("wine.body", 2.0, 1.5, 2.5),
                    ("wine.acidity", 4.5, 4.0, 5.0)],
    )

    # Rheingau (28). The book draws an EXPLICIT contrast with the Mosel:
    # "richer, rounder, earthier, and more voluptuous", absent the Mosel's
    # "icicle-like sharpness" -> fuller body, high but lower acidity.
    _region(
        conn, "Rheingau", CITATION_RHEINGAU,
        short=(
            "The region on which Germany's white-wine reputation was "
            "historically built — a continuous south-facing slope above the "
            "Rhine giving richer, rounder, more voluptuous riesling."
        ),
        full=(
            "Germany's reputation as the greatest white-wine producing nation "
            "in the world was historically based largely on the Rheingau. Today "
            "the supremacy of this very small region (7,744 acres/3,134 "
            "hectares) is challenged by wines from the Mosel and the Pfalz, yet "
            "the Rheingau has the longest history of quality winemaking of any "
            "region in Germany. It is a serene, aristocratic region — one long, "
            "virtually continuous horizontal slope, a rolling carpet of vines, "
            "with the densely forested Taunus Mountains rising behind. In a "
            "sense the mountains created the region: they abruptly halted the "
            "Rhine's northward flow and forced it west for 20 miles before it "
            "could resume, leaving a nearly ideal, immense south-facing bank "
            "backed by forests that block cold northern winds. The leading "
            "grape is riesling — the first record of riesling planted in "
            "Germany dates from 1435 at Schloss Johannisberg, a former "
            "Benedictine abbey in the Rheingau — and of all German regions the "
            "Rheingau has the highest percentage of riesling, nearly 80 percent "
            "of its acreage. The rieslings here are entirely different from "
            "Mosel rieslings: richer, rounder, earthier and more voluptuous. "
            "Absent are the Mosel's icicle-like sharpness and slate flavours, "
            "and in their place is a near perfect gripping expression of "
            "lip-smacking fruit; the best have amazing breadth, suggesting "
            "everything from violets and cassis to apricots and honey. Sun, "
            "soil and latitude make the difference — the Rheingau lies farther "
            "south than the Mosel, its south-facing bank rises gently from a "
            "river that acts as a giant sunlight reflector, and its soil is not "
            "solely slate but a vast mixture including loess, loam, limestone, "
            "marl, sand and quartzite."
        ),
        attrs={
            "key_grapes": ["riesling"],
            "climate": "farther south than the Mosel; a south-facing bank "
                       "sheltered by the forested Taunus Mountains",
            "soil": "loess, loam, limestone, marl, sand and quartzite — not "
                    "solely slate",
            "signature": "richer, rounder, earthier, more voluptuous riesling "
                         "than the Mosel's",
            "history": "first record of riesling in Germany, 1435, at Schloss "
                       "Johannisberg; longest quality-winemaking history",
            "riesling_share": "nearly 80% of acreage — the highest in Germany",
        },
        grapes=("riesling",),
        benchmarks=[("wine.body", 3.0, 2.5, 3.5),
                    ("wine.acidity", 4.0, 3.5, 4.5)],
    )

    # Pfalz (15) and Rheinhessen (16) — named by the book as the Mosel's and
    # Rheingau's peers, but without their own chapters, so the copy stays at
    # the level the source supports and no benchmark is asserted.
    _region(
        conn, "Pfalz", CITATION_DE,
        short=(
            "One of Germany's leading regions alongside the Mosel and Rheingau, "
            "and a source of many of the country's most delicious modern wines."
        ),
        full=(
            "The Pfalz is named by The Wine Bible, together with the Mosel, as "
            "one of the regions whose many delicious wines now challenge the "
            "historic supremacy of the Rheingau. Germany as a whole is "
            "considered one of the world's top producers of elegant white "
            "wines, its best rieslings having ravishing purity and "
            "concentration, and its vineyards lie at the northernmost extreme "
            "of where grapes can dependably ripen. The majority of fine German "
            "wines are dry or just a touch off-dry, the exceptions being the "
            "expensive late-harvest dessert wines — beerenauslesen, "
            "trockenbeerenauslesen and eisweins — which are crafted to be "
            "sweet. More than any other country Germany has benefited from "
            "climate change: in the 1960s and 1970s only two or three vintages "
            "a decade yielded ripe grapes, whereas virtually every vintage now "
            "does. Ripeness still proceeds incrementally, with few heat waves, "
            "which is an advantage because slowly ripened grapes develop more "
            "complex flavours. If anything has been a German constant it is "
            "acidity: where most Champagnes carry 5 to 6 grams per litre, "
            "German wines usually possess 6 to 8."
        ),
        attrs={
            "key_grapes": ["riesling"],
            "climate": "northern European; German vineyards sit at the "
                       "northernmost extreme of dependable ripening",
            "signature": "one of the regions now challenging the Rheingau's "
                         "historic supremacy",
            "national_context": "German wines typically carry 6-8 g/l acidity vs "
                                "5-6 g/l for most Champagne",
        },
        grapes=("riesling", "silvaner"),
    )

    _region(
        conn, "Rheinhessen", CITATION_DE,
        short=(
            "A German wine region in the Rhine heartland — part of a country "
            "considered one of the world's top producers of elegant white wines."
        ),
        full=(
            "Rheinhessen is one of Germany's wine regions, lying in the Rhine "
            "heartland. Germany is considered one of the world's top producers "
            "of elegant white wines — its best rieslings have ravishing purity "
            "and concentration — and its vineyards lie at the northernmost "
            "extreme of where grapes can dependably ripen. The majority of fine "
            "German wines are dry or just a touch off-dry; the exceptions are "
            "the expensive late-harvest dessert wines (beerenauslesen, "
            "trockenbeerenauslesen and eisweins), which are crafted to be "
            "sweet. German wine is organised by a traditional hierarchy of six "
            "ascending ripeness levels, and since the turn of the twenty-first "
            "century by the modern, vineyard-based VDP system adopted by more "
            "than two hundred of the country's most prestigious estates. "
            "Acidity is the German constant: most German wines carry 6 to 8 "
            "grams per litre, against 5 to 6 for most Champagne."
        ),
        attrs={
            "key_grapes": ["riesling", "silvaner"],
            "climate": "northern European, in the Rhine heartland",
            "classification_context": "traditional ripeness ladder (kabinett to "
                                      "TBA) plus the modern VDP system",
            "national_context": "German wines typically carry 6-8 g/l acidity",
        },
        grapes=("riesling", "silvaner"),
    )

    # ============================================================== PORTUGAL
    # Douro (30). Port + dry Douro reds. Touriga nacional's "commanding tannic
    # structure" plus fortification supports full body and firm tannin.
    _region(
        conn, "Douro", CITATION_PORT,
        short=(
            "The steep banks of the golden river in northeastern Portugal — "
            "birthplace of Port, and today also the source of serious dry reds "
            "built on touriga nacional."
        ),
        full=(
            "The Douro valley in northeastern Portugal is the home of Port. The "
            "ancient Romans prized the juicy red wines from the steep banks of "
            "the Douro River, but centuries passed before the British "
            "transformed them into Port — what the book calls Britain's early "
            "version of central heating. The famous Port firms were mostly "
            "begun by men with British names — Sandeman, Croft, Graham, "
            "Cockburn, Dow, Warre — and if Portugal is the mother of Port, "
            "Britain is certainly its father. By the seventeenth century wine "
            "was regularly being fortified with grape spirits simply to keep it "
            "stable on the voyage to England, at first only about 3 percent. "
            "Then the remarkable 1820 vintage produced wine that was naturally "
            "rich, ripe and sweet, and sales soared; the next year shippers "
            "added more brandy and added it sooner, arresting fermentation "
            "earlier to leave more sweetness. Over many decades the quantity of "
            "spirits was incrementally increased, producing a wine that is both "
            "sweet and substantially fortified. The name Port derives from the "
            "city of Oporto, a major port on the Atlantic at the mouth of the "
            "Douro — the golden river — and Portugal's second largest city "
            "after Lisbon; historically, barrels were floated down from the "
            "inland vineyards of the Upper Douro to Oporto in narrow, "
            "shallow-bottomed boats called barcos rabelos. Touriga nacional, "
            "probably native to the Dão, is the leading powerhouse grape in "
            "many Port blends and is also used in the dry wines of the Douro, "
            "bringing richness, depth, a commanding tannic structure, deep "
            "colour and fine aromas."
        ),
        attrs={
            "key_grapes": ["touriga nacional"],
            "climate": "hot, dry continental valley on steep river banks",
            "signature": "Port — fortified and sweet — plus increasingly serious "
                         "dry Douro reds",
            "history": "fortification began as voyage stabilisation (~3% spirit); "
                       "the 1820 vintage drove the modern sweet, fortified style",
            "name_origin": "Oporto, at the mouth of the Douro ('golden river')",
        },
        grapes=("touriga-nacional",),
        benchmarks=[("wine.body", 4.5, 4.0, 5.0),
                    ("wine.tannin", 4.0, 3.5, 4.5)],
    )

    # Dão (3 SKUs) — right at the low-SKU boundary, so the copy stays on
    # verifiable geography/variety-origin facts and gets no benchmark.
    _region(
        conn, "Dão", CITATION_PT,
        short=(
            "A Portuguese wine region, probably the native home of touriga "
            "nacional — the powerhouse grape behind many Port blends and the "
            "dry reds of the Douro."
        ),
        full=(
            "The Dão is one of Portugal's established wine regions and is "
            "probably the native home of touriga nacional. That grape is today "
            "widely known as the leading powerhouse variety in many of the "
            "blends that make Port, and is also used in the dry wines of the "
            "Douro; its attributes include richness, depth, a commanding tannic "
            "structure, good deep colouring and good aromas. Portugal itself is "
            "the mother of Port, the fortified wine of the Douro valley, and "
            "maintains a large body of indigenous grape varieties alongside it."
        ),
        attrs={
            "key_grapes": ["touriga nacional"],
            "signature": "probable birthplace of touriga nacional",
            "sourcing_note": "few in-stock SKUs — confirm specifics with the "
                             "producer before describing a particular bottling",
        },
        grapes=("touriga-nacional",),
    )

    # =============================================================== AUSTRIA
    # Wachau (6). Austria's top subregion. The book's national-level claim is
    # structural and explicit: Austria's dry whites are "much fuller in body
    # and bolder in character than Germany's filigreed, dry whites".
    _region(
        conn, "Wachau", CITATION_AT,
        short=(
            "Austria's top subregion, on terraced slopes above the Danube — the "
            "only place using the Vinea Wachau categories steinfeder, "
            "federspiel and smaragd, and a benchmark for riesling and grüner."
        ),
        full=(
            "The Wachau is the top subregion of Lower Austria, the country's "
            "most important wine region in terms of size and reputation for "
            "high quality; the word 'lower' refers to the lower part of the "
            "Danube, which flows through it. Austria's vineyards all lie in the "
            "distant, more exotic eastern half of this landlocked country, some "
            "108,000 acres forming a crescent along the eastern border, worked "
            "by just over 20,000 growers and around 6,500 wineries. Vines have "
            "been planted on the Wachau's stark, rocky terraces since the "
            "thirteenth century. Austrian wines bear very little resemblance in "
            "flavour to German ones: Austria's dry whites are much fuller in "
            "body and bolder in character than Germany's filigreed dry whites, "
            "and the same is true of the reds. The Wachau is the only place in "
            "all of Austria where the three words steinfeder, federspiel and "
            "smaragd appear — categories created by the Vinea Wachau, an "
            "association of top Wachau producers, to set their dry white wines "
            "apart, and which must be listed on the label. Austria's modern "
            "industry was rebuilt from the ground up by small family estates "
            "after the 1985 diethylene-glycol scandal, which one winemaker "
            "called a cleansing thunderstorm; today top-quality wine is a "
            "virtual religion there, and Austria has the largest percentage of "
            "land under certified organic production of any EU country."
        ),
        attrs={
            "key_grapes": ["grüner veltliner", "riesling"],
            "climate": "continental Danube valley; rocky terraced slopes planted "
                       "since the 13th century",
            "classification_system": "Vinea Wachau categories — steinfeder, "
                                     "federspiel, smaragd (producer association, "
                                     "not law)",
            "signature": "dry whites much fuller in body and bolder than "
                         "Germany's filigreed dry whites",
            "national_context": "industry rebuilt by small family estates after "
                                "the 1985 scandal; largest share of certified "
                                "organic land in the EU",
        },
        grapes=("gruner-veltliner", "riesling"),
        benchmarks=[("wine.body", 3.5, 3.0, 4.0),
                    ("wine.acidity", 4.0, 3.5, 4.5)],
    )

    # Kamptal — ONLY 2 IN-STOCK SKUs. Per the no-inferred-item-level-data
    # rule, this copy stays on verifiable geography and industry facts and
    # carries NO sensory description that could read as a tasting note for
    # those two bottles. NO benchmark. See LOW_SKU_REGIONS + its unit test.
    _region(
        conn, "Kamptal", CITATION_AT,
        short=(
            "A wine region of Lower Austria, on the Kamp river north of the "
            "Danube — part of the country's most important wine area by size "
            "and quality reputation."
        ),
        full=(
            "Kamptal is one of the wine regions of Lower Austria, which is the "
            "country's most important wine region in terms of size and its "
            "reputation for high-quality wine, lying in the north along the "
            "Slovakian border and taking its name from the lower part of the "
            "Danube. Austria is a landlocked country bordered by the Czech "
            "Republic, the Slovak Republic, Germany, Hungary, Slovenia, Italy "
            "and Switzerland, and although its western cities such as Salzburg "
            "and Innsbruck are better known, the vineyards all lie in the "
            "eastern half: some 108,000 acres (43,700 hectares) forming a "
            "crescent along the eastern border, farmed by just over 20,000 "
            "growers, with approximately 6,500 wineries making and bottling "
            "wine. There are four main wine regions — Lower Austria and "
            "Burgenland, the two largest, plus Styria and Vienna — and the "
            "larger two contain several smaller regions within them. Austria's "
            "modern wine industry was rebuilt from the ground up by small "
            "family estates after the 1985 diethylene-glycol scandal collapsed "
            "the mass market for inferior wine, and the country now has the "
            "largest percentage of land under certified organic production of "
            "any European Union member."
        ),
        attrs={
            "key_grapes": ["grüner veltliner", "riesling"],
            "region_of": "Lower Austria",
            "national_context": "108,000 acres of vineyard in a crescent along "
                                "Austria's eastern border; 20,000+ growers, "
                                "~6,500 wineries; largest EU share of certified "
                                "organic land",
            "sourcing_note": "very few in-stock SKUs — this description covers "
                             "regional geography only; confirm any specific "
                             "bottling's character with the producer",
        },
        grapes=("gruner-veltliner", "riesling"),
    )
