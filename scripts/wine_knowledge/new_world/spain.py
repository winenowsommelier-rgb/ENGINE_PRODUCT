"""Spain sub-chapter loader (Rioja, Ribera del Duero, Jerez, Priorat, Rías
Baixas, Catalunya) — authored IN-SESSION from The Wine Bible (2nd ed., Karen
MacNeil; the SPAIN / RIOJA / RIBERA DEL DUERO / JEREZ / PENEDÈS / RÍAS BAIXAS /
PRIORAT chapters). Nothing here is web-sourced or paid-API generated.

Mirrors `italy/piedmont.py`: we OVERWRITE each pre-existing region context with
a book-cited, status='validated' one, link the confirmed grapes via `grown_in`,
and attach the region to its place tier via `classified_under`. Every context
and benchmark carries a real CITATION (never a 'legacy:' marker), and we link
only to the EXISTING region/grape skeleton via `_helpers` (which RAISE on a
missing entity rather than blind-creating one).

TIER SCOPE: only the PLACE tiers (spain-doca / spain-do) are wired to regions.
The aging tiers (Crianza/Reserva/Gran Reserva) are deliberately NOT attached to
any region — see the tiers.py docstring: gran reservas are 1-10% of Rioja's
production, so "Rioja classified_under Gran Reserva" would be a false claim.
Two regions carry DOCa (Rioja since 1991, and Priorat — the book states Priorat
"boasts the top classification: DOCa"); the rest are DOs.

SYNONYM DISCIPLINE (see grapes.py): the book maps garnacha -> grenache and
monastrell -> mourvèdre, so we link the EXISTING `grenache` / `mourvedre` slugs
and record the Spanish name in the region's attrs. We never create a second
entity for the same vine.

Regions are chosen by CATALOGUE WEIGHT (in-stock SKUs) intersected with what
the book actually covers in depth. 'Others region' (170 SKUs) is a catch-all
bucket with no book chapter, so it is deliberately skipped.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.new_world import _helpers, tiers

CITATION_RIOJA = "Wine Bible 2e, Spain/Rioja"
CITATION_RIBERA = "Wine Bible 2e, Spain/Ribera del Duero"
CITATION_JEREZ = "Wine Bible 2e, Spain/Jerez"
CITATION_PRIORAT = "Wine Bible 2e, Spain/Priorat"
CITATION_RIAS = "Wine Bible 2e, Spain/Rías Baixas"
CITATION_CATALUNYA = "Wine Bible 2e, Spain/Penedès"


def _region(conn, name, citation, *, short, full, attrs, grapes=(), tier=None,
            benchmarks=()):
    """Author one region: cited validated context, grape links, tier link,
    and any narrative-derived benchmarks."""
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
    # ---------------------------------------------------------------- RIOJA
    # Spain's preeminent region and the first DOCa (1991). Tempranillo-based
    # reds defined by long oak aging. No firm body/tannin claim in the book
    # strong enough to benchmark both styles (the chapter explicitly contrasts
    # a "powerfully structured" modern style with an "elegant... closer to
    # pinot noir" traditional style), so we record that tension in attrs and
    # add NO structural benchmark rather than average two opposite claims.
    _region(
        conn, "Rioja", CITATION_RIOJA,
        short=(
            "Spain's preeminent wine region for more than a century and the "
            "first to be awarded DOCa status (1991) — tempranillo-based reds "
            "defined by long aging in oak, along the Ebro River in the remote "
            "interior of northern Spain."
        ),
        full=(
            "For more than a century Rioja has been considered Spain's "
            "preeminent wine region. Its vineyards run for 75 miles (120 "
            "kilometres) along both banks of the Ebro River and cover more than "
            "157,000 acres (63,500 hectares) in the remote interior of northern "
            "Spain, with craggy mountains standing in desolation behind them. "
            "Several small mountain ranges and the outlying ridges of the "
            "Cantabrian Mountains isolate the region from the moderating "
            "Atlantic and shield it from the harshest northern winds, so "
            "although Rioja lies only 60 miles from the Bay of Biscay it does "
            "NOT have a maritime climate. White and rosé are made here, but the "
            "region's fabled reputation rests almost exclusively on reds based "
            "primarily on tempranillo — an early-ripening variety whose name "
            "comes from temprano ('early'), traditionally blended with garnacha "
            "(French grenache), mazuelo (carignan) and graciano, though a "
            "growing number of Riojas are now entirely tempranillo. Rioja is "
            "often called Spain's Bordeaux, and the French ties are multiple: "
            "the region's signature long aging in oak barrels was inspired by "
            "Bordelais practice, adopted by Manuel Quintano in 1780 and taken "
            "up by the Marqués de Murrieta and Marqués de Riscal by the 1850s — "
            "who then imported American oak trees and coopered the barrels "
            "themselves. When oidium and phylloxera devastated French vineyards "
            "in the 1850s-60s, French négociants came to Rioja to buy, some "
            "stayed to found bodegas, and the vineyard area grew by 40,000 "
            "acres within a generation. Rioja wines are classified by an aging "
            "hierarchy — crianza, reserva and gran reserva — and depending on "
            "style tempranillo here is either powerfully structured, dark and "
            "earthy with leather and a certain peatiness (modern), or elegant "
            "and very earthy, closer to pinot noir than to cabernet "
            "(traditional). Rioja is among the world's most beautifully earthy "
            "wines, and its long-aged gran reservas remain among the best deals "
            "in the world."
        ),
        attrs={
            "key_grapes": ["tempranillo", "garnacha (grenache)", "mazuelo (carignan)",
                           "graciano", "viura"],
            "climate": "continental, NOT maritime — Cantabrian ranges shield the "
                       "region from the Atlantic and the harshest northern winds",
            "classification_system": "DOCa (first in Spain, 1991); aging hierarchy "
                                     "of crianza / reserva / gran reserva",
            "aging_hierarchy": ["crianza", "reserva", "gran reserva"],
            "signature": "tempranillo-based reds with long aging in oak barrels; "
                         "modern style powerfully structured and earthy vs "
                         "traditional style elegant, closer to pinot noir",
            "size": "157,000+ acres (63,500 ha) over 75 miles along the Ebro",
            "style_note": "the book contrasts two opposite house styles, so no "
                          "single structural benchmark is asserted here",
        },
        grapes=("tempranillo", "grenache"),
        tier=tiers.DOCA_SLUG,
    )

    # -------------------------------------------------- RIBERA DEL DUERO
    # Almost exclusively red, from tinto fino (a tempranillo clone group).
    # The book is emphatic and CONSISTENT on structure here: "bold,
    # concentrated, ripe, mouthfilling, structured", "more powerful than
    # Rioja", "among the longest lived of all Spanish red wines" -> confident
    # body + tannin benchmarks.
    _region(
        conn, "Ribera del Duero", CITATION_RIBERA,
        short=(
            "The poster image of conquistador Spain — rugged ocher mesas on a "
            "high plateau north of Madrid, making bold, concentrated, long-lived "
            "reds from tinto fino, the local clone group of tempranillo."
        ),
        full=(
            "A two-hour drive north of Madrid, Ribera del Duero lies in the "
            "province of Castilla y León — a severe, dramatic land of rough "
            "mesas and rocky plateaus stretching as far as the eye can see, with "
            "massive stone castles atop the highest ridges. On these high, dry, "
            "sunny plains the vineyards have a severity of their own: old vines, "
            "gnarled as if in agony, protrude from the rough ground, and the "
            "earth herself seems to cling to the muscular vines. The region is "
            "named for the Duero, the third largest river on the Iberian "
            "Peninsula, which crosses the great meseta (high plateau) of north "
            "central Spain. Ribera del Duero is almost exclusively a red wine "
            "region (simple rosés are made for local consumption). Its major "
            "grape is tinto fino, also called tinta del país — another name for "
            "tempranillo, though after centuries of adaptation the clones here "
            "differ markedly from Rioja's, and tinto fino's smaller berries and "
            "tougher skins, driven by the harsh climate, make wines that are "
            "often more powerful (if occasionally less polished) than Rioja. The "
            "best reds are bold, concentrated, ripe, mouthfilling and structured, "
            "packed with dark flavours of roasted coffee, cocoa, peat and black "
            "licorice, yet the very best are also lusciously refined and among "
            "the longest-lived of all Spanish reds. Three Ribera del Duero wines "
            "— Vega-Sicilia's Unico, Pingus and Pesquera — rank among the most "
            "outstanding reds anywhere in the world; Unico is the most legendary "
            "and expensive red wine in Spain. There are more than 250 wine "
            "estates in the region."
        ),
        attrs={
            "key_grapes": ["tinto fino (tempranillo)", "tinta del país"],
            "climate": "harsh, dramatic high-plateau (meseta) climate; high, dry, "
                       "sunny plains at altitude",
            "soil": "rough, rocky ground of ocher mesas and plateaus",
            "classification_system": "DO",
            "signature": "bold, concentrated, mouthfilling reds — roasted coffee, "
                         "cocoa, peat, black licorice; among Spain's longest-lived",
            "landmark_wines": ["Vega-Sicilia Unico", "Pingus", "Pesquera"],
            "estates": "250+",
        },
        grapes=("tempranillo",),
        tier=tiers.DO_SLUG,
        benchmarks=[("wine.body", 4.5, 4.0, 5.0),
                    ("wine.tannin", 4.0, 3.5, 4.5)],
    )

    # ---------------------------------------------------------------- JEREZ
    # Sherry. Fortified + deliberately oxidised, from neutral palomino. Body
    # and tannin benchmarks would be meaningless for a fortified white, and
    # the book asserts no 1-5 structural claim, so NO benchmarks here.
    _region(
        conn, "Jerez", CITATION_JEREZ,
        short=(
            "The Sherry region of Andalusia — a chalk-white coastal triangle in "
            "southwest Spain where one neutral grape, palomino, is turned into "
            "more radically different styles of wine than anywhere on earth."
        ),
        full=(
            "Jerez, in the province of Andalusia in southwest Spain, is the home "
            "of Sherry — the three words Jerez, Xérès and Sherry on every bottle "
            "reflect the Spanish region, the original Phoenician name and the "
            "English one. Sherry is one of the five great wine classics "
            "alongside Port, Madeira, Champagne and Tokaji, and is arguably the "
            "most misunderstood and underappreciated of them; far from being a "
            "little old lady's drink, it is the daily drink of southern Spanish "
            "men. As a fortified wine its alcoholic strength is raised to "
            "between 15 and 22 percent (a standard table wine is 12 to 15), and "
            "Sherries are additionally given slow, careful and systematic "
            "exposure to oxygen, the degree varying by style. Nowhere else in "
            "the world are so many radically different styles of wine made from "
            "the SAME grape variety — palomino, which is fairly neutral when "
            "harvested, exactly the quality the solera process of fractional "
            "blending requires. The vineyards spread in a triangle from an "
            "inland point north of Jerez de la Frontera to the maritime towns of "
            "Puerto de Santa María on the Bay of Cádiz and Sanlúcar de Barrameda "
            "on the Atlantic at the mouth of the Guadalquivir; the best sites "
            "lie in the heart of that triangle, the zone designated Jerez "
            "Superior. It is an eerie, barren moonscape of blinding whiteness "
            "along the Andalusian coast — the stark, chalky-white shores from "
            "which Columbus began his westward sail, meaning Sherry was very "
            "likely the first European wine drunk in America."
        ),
        attrs={
            "key_grapes": ["palomino", "pedro ximénez"],
            "climate": "hot Andalusian coastal; Atlantic and Bay of Cádiz influence",
            "soil": "blinding chalky-white (albariza) coastal soils",
            "classification_system": "DO; best sites designated Jerez Superior",
            "signature": "fortified to 15-22% and deliberately oxidised; the solera "
                         "process of fractional blending yields many radically "
                         "different styles from one neutral grape",
            "wine_type": "fortified",
            "towns": ["Jerez de la Frontera", "Puerto de Santa María",
                      "Sanlúcar de Barrameda"],
        },
        grapes=("palomino",),
        tier=tiers.DO_SLUG,
    )

    # -------------------------------------------------------------- PRIORAT
    # The second DOCa. Book is unambiguous: "some of the most intense, inky and
    # powerful red wines in Spain", "massively structured, with considerable
    # tannin" -> high body + high tannin, our most confident Spanish benchmark.
    _region(
        conn, "Priorat", CITATION_PRIORAT,
        short=(
            "A tiny, rugged Catalonian region of black slate (llicorella) whose "
            "low-yielding old garnacha and cariñena vines make some of the most "
            "intense, inky and powerful reds in Spain. Holds the top DOCa rank."
        ),
        full=(
            "Usually known by its Catalan name Priorat (rather than the Spanish "
            "Priorato), this is a tiny, isolated wine region just inland from "
            "Tarragona in Catalonia, on the Mediterranean coast. Barely heard of "
            "in the early 1990s, it emerged internationally late in that decade "
            "with a handful of exciting, highly sought-after wines, some of "
            "which upstaged even the most prestigious Riojas by costing four "
            "times as much. Priorat boasts the top classification, DOCa "
            "(Denominación de Origen Calificada). It is a 'new old' wine region: "
            "vines grew here for centuries before the Romans arrived to mine "
            "lead and silver, but the region was progressively abandoned in the "
            "1800s, barely recovered after phylloxera, and by the 1970s its "
            "villages were populated mostly by the elderly — only to be reborn. "
            "The name dates from 1163, when Alfonso II of Aragón founded a "
            "Carthusian monastery, Scala Dei ('God's stairway'), on the spot "
            "where a villager was said to have seen angels ascending a stairway "
            "to heaven; priorato is Spanish for priory. The best wines are all "
            "red: massively structured, with considerable tannin that makes them "
            "ageworthy, thick and soft in texture, loaded with ripe blackberry, "
            "dense chocolate, lively licorice and mineral/rock flavours. That "
            "concentration comes from painfully low-yielding old vines — "
            "sometimes more than a century old — protruding gnarled and "
            "contorted from the poor, stony soil called llicorella ('licorice') "
            "for its blackish slate colour. The region's two native reds, "
            "garnacha and cariñena (grenache and carignan in France), are its "
            "main grapes."
        ),
        attrs={
            "key_grapes": ["garnacha (grenache)", "cariñena (carignan)"],
            "climate": "rugged, mountainous Mediterranean hinterland",
            "soil": "llicorella — distinctive stony black slate",
            "classification_system": "DOCa — the top Spanish classification",
            "signature": "intense, inky, powerful reds from low-yielding "
                         "century-old vines; blackberry, chocolate, licorice, mineral",
            "history": "'new old' region — Roman-era vines, abandoned in the 1800s, "
                       "reborn in the late 1990s",
        },
        grapes=("grenache",),
        tier=tiers.DOCA_SLUG,
        benchmarks=[("wine.body", 4.5, 4.0, 5.0),
                    ("wine.tannin", 4.5, 4.0, 5.0)],
    )

    # ---------------------------------------------------------- RÍAS BAIXAS
    # Albariño. The book's structural claim is about LIGHTNESS and zesty
    # crispness ("as light as gossamer on the palate", "crisp zestiness")
    # -> low body, high acidity.
    _region(
        conn, "Rías Baixas", CITATION_RIAS,
        short=(
            "Spain's benchmark white region, on the fjord-like Atlantic "
            "estuaries of southern Galicia — albariño so light it is 'gossamer "
            "on the palate', poised between creaminess and crisp zestiness."
        ),
        full=(
            "When the small white wine region of Rías Baixas in far northwestern "
            "Spain came to prominence in the 1990s, a new era in Spanish white "
            "wine history was born. With the exception of fortified Sherry and "
            "sparkling cava, the Spanish wines that had commanded world "
            "attention were almost exclusively red. By the late 1980s and early "
            "1990s modern technology — above all temperature-controlled "
            "stainless-steel tanks — reached virtually all of Spain's top white "
            "wine producers and quality skyrocketed, with Rías Baixas leading "
            "the way. The region sits on the Atlantic just above Portugal, in "
            "the southern part of Galicia, and takes its name from the Galician "
            "rías: sharp, fjord-like estuaries that slice like cobalt swords "
            "into the baixas, the lower part of southern Galicia. It is one of "
            "the world's most breathtaking and unusual-looking wine regions — "
            "easy to mistake for Ireland or Wales but for the eucalyptus forests "
            "covering the steep hills and deep ravines. The best wines are made "
            "principally from the white albariño grape, and albariño — not Rías "
            "Baixas — is the name by which they are commonly known and labelled, "
            "in complete contrast to other Spanish regions, where wines are "
            "named for the place rather than the grape. Albariño's flavour "
            "profile is unique: not as zaftig as chardonnay, nor as minerally as "
            "riesling, nor as wild and herbal as sauvignon blanc, ranging from "
            "zingy citrus-peach to almond-honeysuckle. In texture albariños are "
            "beautifully poised between light creaminess and crisp zestiness, "
            "and because most are neither fermented nor aged in wood the best of "
            "them are as light as gossamer on the palate."
        ),
        attrs={
            "key_grapes": ["albariño"],
            "climate": "cool, wet Atlantic maritime; steep hills and deep ravines "
                       "around fjord-like rías",
            "classification_system": "DO",
            "signature": "albariño — labelled by GRAPE, not region, uniquely for "
                         "Spain; citrus-peach to almond-honeysuckle, rarely oaked",
            "texture": "poised between light creaminess and crisp zestiness; "
                       "'as light as gossamer on the palate'",
        },
        grapes=("albarino",),
        tier=tiers.DO_SLUG,
        benchmarks=[("wine.body", 2.0, 1.5, 2.5),
                    ("wine.acidity", 4.0, 3.5, 4.5)],
    )

    # ------------------------------------------------------------ CATALUNYA
    # Our catalogue's region entity is "Catalunya" (67 SKUs); the book's
    # chapter for it is the Penedès, Catalonia's most important DO alongside
    # Priorat and the home of cava. Styles range from sparkling to a wide
    # variety of still wines, so NO single structural benchmark is asserted.
    _region(
        conn, "Catalunya", CITATION_CATALUNYA,
        short=(
            "Catalonia — Spain's most dynamic province and, through the Penedès, "
            "the home of cava, the traditional-method sparkling wine produced "
            "here since the 1870s."
        ),
        full=(
            "Catalonia is arguably the most dynamic province in Spain and the "
            "epicentre of Spanish art, literature, philosophy, gastronomy, "
            "finance and culture — a province fervent about politics and "
            "religion where everyone speaks Catalan first and Spanish second, "
            "and which produced Miró, Dalí, Picasso, the architect Gaudí and the "
            "cellist Pablo Casals. That artistry and exuberance is evident in its "
            "wines. The province's principal wine region, the Penedès, is "
            "anchored by Barcelona, whose gastronomy and nightlife spill over "
            "and give it an edge many sleepy rural wine regions lack. Driving "
            "southwest out of the city, industrial sprawl gives way to pine- and "
            "orchard-covered hills and then a patchwork quilt of vineyards; from "
            "warm coastal land the vineyards climb to higher, cooler elevations "
            "inland. Though modest in surface area the Penedès spans two "
            "mountain chains and a valley, and so has a wide variety of climatic "
            "conditions and soil types. It is one of several Denominaciones de "
            "Origen within Catalonia but continues to be, along with Priorat, "
            "one of the most important. The Penedès is best known for cava — "
            "Spanish sparkling wine made by the traditional (Champagne) method, "
            "produced here since the 1870s — and in addition makes a wide "
            "variety of still wines, many of them simple and in a modern style. "
            "The terms reserva and gran reserva may also be used on cava."
        ),
        attrs={
            "key_grapes": ["macabeo (viura)", "xarel·lo", "parellada",
                           "garnacha (grenache)", "monastrell (mourvèdre)"],
            "climate": "Mediterranean coastal warming to cooler inland elevations; "
                       "spans two mountain chains and a valley",
            "classification_system": "DO (several DOs within Catalonia; Penedès and "
                                     "Priorat the most important)",
            "signature": "cava — traditional-method sparkling wine made here since "
                         "the 1870s — plus a wide range of still wines",
            "key_wines": ["Cava", "Penedès still whites and reds"],
        },
        grapes=("grenache", "mourvedre"),
        tier=tiers.DO_SLUG,
    )
