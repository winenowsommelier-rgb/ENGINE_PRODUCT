"""Chile sub-chapter loader — authored IN-SESSION from The Wine Bible (2nd ed.,
Karen MacNeil; the CHILE chapter). Nothing here is web-sourced or paid-API
generated.

Mirrors `italy/piedmont.py`. Every context and benchmark carries a real
CITATION, and we link only to the EXISTING region/grape skeleton via `_helpers`
(which RAISE on a missing entity).

TIER SCOPE: every Chilean region links to the single, UNRANKED `chile-do` tier.
The book presents the five DOs as a north-to-south GEOGRAPHIC ordering of
climate zones, never as a quality ranking, so no `outranks` edge exists — the
same reasoning as the US AVA (see tiers.py).

REGION SELECTION is by catalogue weight intersected with book depth: Central
Valley (219 SKUs), Colchagua Valley (112), Maipo Valley (48), Maule (29),
Casablanca Valley (17), Aconcagua Valley (7), Cachapoal Valley (6).
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.new_world import _helpers, tiers

CITATION = "Wine Bible 2e, Chile"


def _region(conn, name, *, short, full, attrs, grapes=(), benchmarks=(),
            citation=CITATION):
    rid = _helpers.find_region(conn, name)
    ctx = ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=citation, confidence="high",
        attributes=json.dumps(attrs),
    )
    for slug in grapes:
        _helpers.link_grape(conn, slug, rid)
    ingest.add_relationship(conn, rid, _helpers.find_tier(conn, tiers.CHILE_DO_SLUG),
                            "classified_under")
    bench_citation = citation + " (narrative-derived)"
    for dim, typical, low, high in benchmarks:
        ingest.upsert_benchmark(
            conn, ctx, dim, typical=typical, low=low, high=high,
            confidence="medium", source_citation=bench_citation)
    return rid


def load(conn) -> None:
    # ------------------------------------------------------- CENTRAL VALLEY
    # The big one (219 SKUs). Spans five sub-valleys and every price tier from
    # flood-irrigated bulk to icon wines, so NO structural benchmark — the
    # book's own cabernet description splits into "moderately priced... easy to
    # drink" vs "icon... firmer structure".
    _region(
        conn, "Central Valley",
        short=(
            "Chile's historic wine centre — a broad, fertile expanse between the "
            "Andes and the Coastal Range, spanning the Maipo, Cachapoal, "
            "Colchagua, Curicó and Maule sub-valleys."
        ),
        full=(
            "Southwest of Chile's capital, Santiago, lies the large Valle "
            "Central — an expanse of fertile and fairly flat land between the "
            "Andes and the Coastal Range, the low-lying mountains just inland "
            "from the Pacific. It is Chile's most notable wine area, where a "
            "majority of the most important appellations are found, including "
            "the two most renowned, Maipo Valley and Colchagua Valley. The most "
            "fertile part of the valley — the centre, where the soils are "
            "deepest — grows an abundance of crops from wheat, corn and beans to "
            "nuts, fruits and sugar beets; it is in the LESS fertile, granitic "
            "soils, often hugging the hillsides, that wine grapes are grown. The "
            "region spans five distinct sub-valleys: Maipo, Cachapoal, "
            "Colchagua, Curicó and Maule (label readers note that Cachapoal and "
            "Colchagua are sometimes referred to together as the Rapel Valley), "
            "many separated by rivers that begin high in the Andes and flow to "
            "the Pacific. Soils in the top vineyards are often a well-drained, "
            "friable granite, becoming more fertile toward the deep centre where "
            "granitic stone is interspersed with loam, sand and clay; on the "
            "eastern side, below the Andes, many vineyards sit on alluvial fans. "
            "The easy availability of water — Andean snowmelt channelled through "
            "dikes and canals — is one of Chile's leading viticultural assets, "
            "but also a potential downfall: growers wanting huge crops of bland, "
            "cheap wine can simply flood the vineyards, while top producers use "
            "controlled drip irrigation or even water by hand. Along with "
            "Aconcagua, the Valle Central makes up Chile's historic wine centre, "
            "and a lion's share of all Chilean wine exports comes from these two "
            "areas."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "carmenère", "merlot",
                           "chardonnay", "sauvignon blanc"],
            "climate": "sheltered valley floor between the Andes and the Coastal "
                       "Range; Andean snowmelt irrigation",
            "soil": "well-drained friable granite on the hillsides; loam, sand and "
                    "clay in the fertile centre; alluvial fans below the Andes",
            "classification_system": "DO Valle Central",
            "sub_valleys": ["Maipo", "Cachapoal", "Colchagua", "Curicó", "Maule"],
            "signature": "Chile's historic wine centre and the source of most of "
                         "its important appellations",
            "quality_note": "spans flood-irrigated bulk wine to icon wines — no "
                            "single structural profile applies",
        },
        grapes=("cabernet-sauvignon", "carmenere", "merlot", "chardonnay",
                "sauvignon-blanc"),
    )

    # ------------------------------------------------------ COLCHAGUA VALLEY
    # "Fast becoming the Napa of Chile"; source of the icon wines, which the
    # book describes as concentrated, complex, with FIRMER structure.
    _region(
        conn, "Colchagua Valley",
        short=(
            "Fast becoming 'the Napa of Chile' — with Maipo, the source of most "
            "of the country's icon wines, above all from the tiny moon-shaped "
            "district of Apalta."
        ),
        full=(
            "Colchagua is fast becoming the Napa of Chile, especially the tiny "
            "district of Apalta — a small, moon-shaped internal valley hard up "
            "against the Coastal Range. This is where Neyen, Viña Montes's Alpha "
            "M and Lapostolle's Clos Apalta are sourced, and all three are among "
            "the most iconic of Chile's icon wines, each with dozens of "
            "international awards and high scores from critics. Colchagua is one "
            "of the five sub-valleys of the Valle Central and, with the Maipo "
            "Valley, one of the two most renowned; it is from these two "
            "districts that most of Chile's so-called icon wines are sourced. "
            "(Colchagua and neighbouring Cachapoal are sometimes referred to "
            "together as the Rapel Valley.) Chile's newer, high-priced icon "
            "cabernets and cabernet blends are polished wines with much more "
            "concentrated and complex flavours and firmer structure than the "
            "country's moderately priced bottlings."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "carmenère", "syrah", "merlot"],
            "climate": "warm interior valley sheltered by the Coastal Range",
            "classification_system": "DO — sub-valley of the Valle Central; "
                                     "sometimes grouped with Cachapoal as Rapel",
            "signature": "'the Napa of Chile' — concentrated, complex icon "
                         "cabernets with firm structure",
            "key_district": "Apalta",
            "icon_wines": ["Neyen", "Viña Montes Alpha M", "Lapostolle Clos Apalta"],
        },
        grapes=("cabernet-sauvignon", "carmenere", "syrah", "merlot"),
        benchmarks=[("wine.body", 4.0, 3.5, 4.5),
                    ("wine.tannin", 4.0, 3.5, 4.5)],
    )

    # ---------------------------------------------------------- MAIPO VALLEY
    # Chile's oldest wine region, next to Santiago; the other icon-wine source.
    _region(
        conn, "Maipo Valley",
        short=(
            "One of Chile's oldest wine regions, edged up against Santiago — "
            "headquarters of the great historic wineries and, with Colchagua, "
            "the source of most of the country's icon wines."
        ),
        full=(
            "Edged up against the city limits of Santiago, the Maipo Valley is "
            "one of Chile's oldest wine regions, and because of its proximity to "
            "the capital many wineries are headquartered there. This is where "
            "the huge wineries Concha y Toro and Cousiño-Macul are located, the "
            "latter with its massive, cavernous cellars and stately 125-acre "
            "(50-hectare) park, a dreamlike expanse of private gardens tended by "
            "fifteen full-time gardeners. Maipo is one of the five sub-valleys "
            "of the Valle Central and, with Colchagua, one of the two most "
            "renowned — it is from these two districts that most of Chile's "
            "so-called icon wines are sourced. It was in Maipo that the "
            "joint-venture team of Château Mouton-Rothschild and Concha y Toro "
            "debuted their Bordeaux-style blend Almaviva at $70 a bottle. Chile's "
            "high-priced icon cabernets and cabernet blends are polished wines "
            "with concentrated, complex flavours and firm structure."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "carmenère", "merlot"],
            "climate": "warm valley beside Santiago, framed by the Andes",
            "classification_system": "DO — sub-valley of the Valle Central",
            "signature": "Chile's oldest wine region and, with Colchagua, the "
                         "home of its icon cabernets",
            "landmark_wineries": ["Concha y Toro", "Cousiño-Macul"],
            "icon_wines": ["Almaviva (Mouton-Rothschild / Concha y Toro)"],
        },
        grapes=("cabernet-sauvignon", "carmenere", "merlot"),
        benchmarks=[("wine.body", 4.0, 3.5, 4.5),
                    ("wine.tannin", 4.0, 3.5, 4.5)],
    )

    # ------------------------------------------------------ CASABLANCA VALLEY
    # The cool, coastal, avant-garde white district — sauvignon blanc and
    # chardonnay planted in the 1990s "gold rush". Chilean sauvignon is
    # "zesty and bold" -> high acidity, light body.
    _region(
        conn, "Casablanca Valley",
        short=(
            "Chile's cool, coastal, avant-garde white-wine district — planted "
            "with sauvignon blanc and chardonnay in the 1990s land rush, and the "
            "home of its zesty, bold sauvignons."
        ),
        full=(
            "Casablanca Valley is one of the more coastal, cool and avant-garde "
            "districts of the Aconcagua DO, alongside San Antonio Valley (and "
            "within San Antonio, the very upcoming zone of Leyda Valley). In the "
            "1990s these regions experienced the wine equivalent of a mini gold "
            "rush, as investors swooped in, bought land and began planting "
            "sauvignon blanc and chardonnay. Chilean sauvignon blanc is "
            "decidedly the more exciting of the country's two main white grapes "
            "— zesty and bold at its best — while most Chilean chardonnay, "
            "extensively planted in the 1990s in response to seemingly "
            "bottomless demand for inexpensive chardonnay in the United States "
            "and Great Britain, remains bargain-priced and uncomplicated, with a "
            "few exceptions such as Lapostolle and Montes."
        ),
        attrs={
            "key_grapes": ["sauvignon blanc", "chardonnay", "pinot noir"],
            "climate": "cool and coastal — the Pacific-influenced end of the "
                       "Aconcagua DO",
            "classification_system": "DO — coastal district of Aconcagua",
            "signature": "zesty, bold sauvignon blanc; Chile's avant-garde cool-"
                         "climate white district",
            "history": "planted during the 1990s coastal 'mini gold rush'",
        },
        grapes=("sauvignon-blanc", "chardonnay", "pinot-noir"),
        benchmarks=[("wine.body", 2.0, 1.5, 2.5),
                    ("wine.acidity", 4.5, 4.0, 5.0)],
    )

    # ------------------------------------------------------ ACONCAGUA VALLEY
    # The warm inland part of the Aconcagua DO; home of Errázuriz.
    _region(
        conn, "Aconcagua Valley",
        short=(
            "The warmish inland heart of the Aconcagua DO, home to Errázuriz — "
            "with the Valle Central, one of the two areas that make up Chile's "
            "historic wine centre."
        ),
        full=(
            "Aconcagua, which takes its name from the nearby Aconcagua River, is "
            "one of Chile's five Denominacions de Origen and includes the "
            "warmish Aconcagua Valley — home to Errázuriz, one of Chile's "
            "prominent wine producers — as well as the more coastal, cool "
            "districts of Casablanca Valley and San Antonio Valley. Along with "
            "the Valle Central, Aconcagua makes up Chile's historic wine centre, "
            "and these two areas are still where most of the country's best wine "
            "districts are found; a lion's share of all wine exported from Chile "
            "comes from them. In the early 1990s Errázuriz partnered with "
            "California's Robert Mondavi Winery to create Seña, a Bordeaux blend "
            "that cost a startlingly high $55 on its 1998 release. Rising up "
            "behind many of Chile's vineyards are the majestic Andes, the "
            "longest mountain chain in the world, whose peaks reach 22,000 feet "
            "and are exceeded in elevation only by the Himalayas; when the chain "
            "was formed, sedimentary rocks folded into ridges, creating many of "
            "the sheltered valleys in which Chile's vineyards lie."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "carmenère", "syrah"],
            "climate": "warmish inland valley, sheltered by Andean ridges",
            "classification_system": "DO Aconcagua — one of Chile's five DOs",
            "signature": "with the Valle Central, one of the two areas forming "
                         "Chile's historic wine centre",
            "landmark_wineries": ["Errázuriz"],
            "icon_wines": ["Seña (Errázuriz / Robert Mondavi)"],
        },
        grapes=("cabernet-sauvignon", "carmenere", "syrah"),
        benchmarks=[("wine.body", 4.0, 3.5, 4.5)],
    )

    # ----------------------------------------------------------------- MAULE
    # One of the five Valle Central sub-valleys; the historic home of país.
    _region(
        conn, "Maule",
        short=(
            "The southernmost of the Valle Central's five sub-valleys, on "
            "granitic hillside soils — historically the heartland of Chile's "
            "old país vines."
        ),
        full=(
            "Maule is one of the five distinct sub-valleys of the Valle Central, "
            "alongside Maipo, Cachapoal, Colchagua and Curicó, many of them "
            "separated by rivers that begin high in the Andes and flow to the "
            "Pacific. As throughout the Valle Central, the best wine grapes grow "
            "not in the deep, fertile centre of the valley — where wheat, corn, "
            "beans, nuts, fruits and sugar beets flourish — but in the less "
            "fertile, well-drained granitic soils that hug the hillsides. Maule "
            "is closely associated with país, Chile's historic mass-production "
            "grape: brought from Spain in the sixteenth century as listán prieto "
            "and originally called criolla chica, it became so common by the "
            "nineteenth century that it was rechristened simply país "
            "('country'), and it is still widely planted for jug wines. "
            "Approximately fifteen varieties of wine grapes are grown in Chile, "
            "but most wines are based on just five: cabernet sauvignon, "
            "chardonnay, merlot, sauvignon blanc and carmenère."
        ),
        attrs={
            "key_grapes": ["país", "cabernet sauvignon", "carmenère", "merlot"],
            "climate": "the cooler, southern end of the Valle Central",
            "soil": "well-drained friable granite on the hillsides",
            "classification_system": "DO — sub-valley of the Valle Central",
            "signature": "historic heartland of país, Chile's oldest planted "
                         "variety",
        },
        grapes=("pais", "cabernet-sauvignon", "carmenere", "merlot"),
    )

    # -------------------------------------------------------- CACHAPOAL VALLEY
    _region(
        conn, "Cachapoal Valley",
        short=(
            "A Valle Central sub-valley neighbouring Colchagua — the two are "
            "sometimes labelled together as the Rapel Valley."
        ),
        full=(
            "Cachapoal is one of the five distinct sub-valleys within Chile's "
            "Valle Central, alongside Maipo, Colchagua, Curicó and Maule. Wine "
            "label readers should note that the Cachapoal and Colchagua valleys "
            "are sometimes referred to together as the Rapel Valley. As "
            "elsewhere in the Valle Central, the top vineyards sit on "
            "well-drained, friable granitic soils that hug the hillsides rather "
            "than in the deep, fertile centre of the valley, and on the eastern "
            "side, below the Andes, many vineyards lie on alluvial fans — rocky "
            "streambeds washed down the mountainsides by the force of water. "
            "Andean snowmelt, channelled through a system of dikes and canals, "
            "provides the region's irrigation."
        ),
        attrs={
            "key_grapes": ["cabernet sauvignon", "carmenère", "merlot"],
            "climate": "sheltered Valle Central sub-valley below the Andes",
            "soil": "friable granite on hillsides; alluvial fans on the eastern "
                    "side below the Andes",
            "classification_system": "DO — sub-valley of the Valle Central; "
                                     "grouped with Colchagua as the Rapel Valley",
        },
        grapes=("cabernet-sauvignon", "carmenere", "merlot"),
    )
