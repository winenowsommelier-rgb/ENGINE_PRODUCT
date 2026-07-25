"""Champagne sub-chapter loader — authored IN-SESSION from the Wine Bible.

All prose is extracted from the CHAMPAGNE chapter (lines ~8598–9658) of
`winebible.md`; nothing here is web-sourced or paid-API generated. Every
context/benchmark carries a real CITATION (never a 'legacy:' marker), and we
link only to the existing region/grape skeleton via `_helpers` (which RAISES on
a missing entity rather than blind-creating one).

We OVERWRITE any pre-existing legacy-marked Champagne region context with a
book-cited, status='validated' one — that is the intended upgrade.

Grape note: Champagne's three grapes are chardonnay, pinot noir and pinot
meunier — but pinot-meunier is NOT present in the entity skeleton (and
link_grape RAISES on a missing grape), so we deliberately link ONLY the two
confirmed majors, chardonnay and pinot-noir, and describe meunier only in prose.

Village system: Champagne is a SINGLE AOC whose 320 villages are ranked Grand
Cru (17 villages) / Premier Cru (42 villages) / Cru — a village-level quality
tier system. We model the top rank as a `classification_tier` ("Champagne Grand
Cru") related to the region with `classified_under` (region -> tier, the
verified-allowed direction).
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.france import _helpers

CITATION = "Wine Bible 2e, France/Champagne"

# The 2 grapes CONFIRMED present as entities. Pinot Meunier is NOT loaded, so we
# deliberately do not link it (link_grape RAISES on a missing grape).
_GRAPES = ("chardonnay", "pinot-noir")


def load(conn) -> None:
    rid = _helpers.find_region(conn, "Champagne")

    # 1. Region context — the big picture from the book, OVERWRITING any legacy
    #    context with a book-cited, validated one.
    region_full = (
        "Champagne is the coolest of France's great wine regions, lying about 90 "
        "miles northeast of Paris, and the only place whose sparkling wine may be "
        "called Champagne. Aromatically, texturally and in flavor it is one of the "
        "most distinct wines in the world, the product of two natural assets: an "
        "iffy, marginal northerly climate (the average temperature is a bare 50°F / "
        "10°C, at the very limit of photosynthesis) and famous white soils that are "
        "more than 75 percent limestone, much of it a porous chalk that drains well "
        "yet stores water and suits high-acid grapes. Only three varieties may be "
        "used — chardonnay (the only white, and the sole grape of blanc de blancs), "
        "pinot noir (the more revered red, giving body, structure and aroma), and "
        "pinot meunier (a supple, fruity clone of pinot noir, the least ageworthy, "
        "used mainly in nonvintage blends). ALL CHAMPAGNES ARE BLENDS — of as many "
        "as a hundred separate still 'base wines', often from several years and held-"
        "back reserve wines — and among the Champenois the art of blending (the "
        "assemblage) is considered paramount. Champagne is made by the méthode "
        "champenoise / méthode traditionnelle: still base wines are bottled with a "
        "liqueur de tirage (sugar + yeast) to trigger a SECOND FERMENTATION inside "
        "the sealed bottle, which traps carbon dioxide as dissolved gas — the future "
        "bubbles. The wine then rests for years SUR LIE (on the spent yeasts); "
        "through AUTOLYSIS the yeast cell walls break down, lending a creamy texture "
        "and complexity, so a great Champagne is at once lightning-crisp from acidity "
        "and lusciously creamy. The yeasts are removed by riddling (rémuage) and "
        "disgorgement, after which a dosage (liqueur d'expédition, sweetened reserve "
        "wine) sets the sweetness style — from bone-dry brut nature and extra brut up "
        "through the now-dominant brut (<12 g/L sugar) to the rare sec, demi-sec and "
        "doux. All of Champagne is a single appellation, but its 320 villages are "
        "ranked Grand Cru (17 villages), Premier Cru (42 villages) or Cru, with every "
        "vineyard in a village sharing the village's rank; its five vineyard areas "
        "are led by the Montagne de Reims, the Côte des Blancs and the Vallée de la "
        "Marne."
    )
    region_short = (
        "France's coolest great region and the only true Champagne: chalk-soiled, "
        "high-acid, made by the méthode traditionnelle (secondary in-bottle "
        "fermentation, long sur lie autolysis, dosage-set sweetness); always a blend "
        "of chardonnay, pinot noir and pinot meunier; a single AOC with a Grand "
        "Cru / Premier Cru village ranking."
    )
    region_attrs = {
        "key_grapes": ["chardonnay", "pinot-noir", "pinot meunier"],
        "climate": "cool, marginal, northerly (avg ~50°F/10°C, limit of ripening)",
        "soil": "white soils >75% limestone, much of it porous chalk",
        "method": "méthode champenoise / méthode traditionnelle (secondary "
                  "in-bottle fermentation, sur lie autolysis, riddling, disgorgement, "
                  "dosage)",
        "always_blended": True,
        "styles": {
            "blanc_de_blancs": "100% chardonnay (Côte des Blancs)",
            "blanc_de_noirs": "100% red grapes (pinot noir / meunier); rare in "
                              "Champagne itself",
            "nv_vs_vintage": "nonvintage blends several years (meunier usual); "
                             "vintage from a single exceptional year",
        },
        "sweetness_scale": ["brut nature", "extra brut", "brut (dominant)",
                            "extra-dry", "sec", "demi-sec", "doux/sweet"],
        "village_ranks": {"Grand Cru": 17, "Premier Cru": 42, "Cru": 258},
        "main_areas": ["Montagne de Reims", "Côte des Blancs", "Vallée de la Marne",
                       "Côte de Sézanne", "Côte des Bar (Aube)"],
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=region_short, full=region_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(region_attrs),
    )

    # 2. The Grand Cru village tier — the top rank of Champagne's cru village
    #    system (17 Grand Cru villages). Modelled as a classification_tier and
    #    related to the region with classified_under (region -> tier).
    tier = ingest.upsert_entity(
        conn, "classification_tier",
        "Champagne Grand Cru", "champagne-grand-cru")
    tier_full = (
        "Grand Cru is the top rank of Champagne's cru village system. Unlike "
        "Burgundy, all of Champagne is a single appellation; instead, its 320 "
        "villages are ranked, and every vineyard in a village shares that village's "
        "rank. Seventeen villages (and all their vineyards) hold the highest status, "
        "Grand Cru; forty-two more are Premier Cru; the remainder are Cru. The "
        "Montagne de Reims and the Côte des Blancs between them share all seventeen "
        "Grand Cru villages — among them the pinot-noir village of Aÿ on the Montagne "
        "de Reims (no village is more cherished) and the chardonnay village of Le "
        "Mesnil-sur-Oger on the Côte des Blancs, home to Krug's Clos du Mesnil and "
        "Salon's Le Mesnil. Prestige cuvées have historically been drawn from Grand "
        "Cru fruit exclusively. Champagne Grand Cru OUTRANKS Premier Cru."
    )
    tier_short = (
        "Top rank of Champagne's cru VILLAGE system: 17 Grand Cru villages (all "
        "vineyards within share the rank), shared between the Montagne de Reims and "
        "the Côte des Blancs; above Premier Cru (42 villages) and Cru."
    )
    tier_attrs = {
        "system": "cru village ranking (village-level, not single-vineyard)",
        "grand_cru_villages": 17,
        "premier_cru_villages": 42,
        "notable_villages": ["Aÿ (pinot noir, Montagne de Reims)",
                             "Le Mesnil-sur-Oger (chardonnay, Côte des Blancs)"],
        "outranks": "Champagne Premier Cru",
        "note": "prestige cuvées historically from Grand Cru fruit exclusively",
    }
    ingest.upsert_context(
        conn, tier, "wine",
        short=tier_short, full=tier_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(tier_attrs),
    )
    # region -> classification_tier (verified allowed classified_under direction).
    ingest.add_relationship(conn, rid, tier, "classified_under")

    # 3. Key sub-region (vineyard-area) contexts, each authored from the book.
    #    find_or_create_subregion returns the existing id where one is present.
    mdr_full = (
        "The Montagne de Reims (the 'mountain of Reims') is an essentially "
        "south-facing slope where the chalk layer runs deep. It is mostly planted "
        "with the red grapes pinot noir and pinot meunier, and pinot noir grown "
        "here has real gravitas and structure. Its most cherished Grand Cru village "
        "is Aÿ, so revered that the name of the town Épernay is said to derive from "
        "'après Aÿ' ('after Aÿ'). With the Côte des Blancs it shares all seventeen "
        "of Champagne's Grand Cru villages."
    )
    mdr_id = _helpers.find_or_create_subregion(conn, "Montagne de Reims", rid, slug="montagne-de-reims")
    ingest.upsert_context(
        conn, mdr_id, "wine",
        short="South-facing, deep-chalk slope planted mostly with pinot noir and "
              "pinot meunier; pinot noir here has gravitas and structure; home to "
              "the great Grand Cru village of Aÿ.",
        full=mdr_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "orientation": "essentially south-facing", "soil": "deep chalk",
            "grapes": ["pinot-noir", "pinot meunier"],
            "notable_grand_cru": "Aÿ",
        }),
    )

    cdb_full = (
        "The Côte des Blancs (the 'hillside of whites') is named for the chalky "
        "outcroppings near the surface here, and is planted almost exclusively with "
        "CHARDONNAY. It is the classic source of blanc de blancs Champagne (made "
        "entirely from chardonnay), treasured for lightness, a gymnastic lift on the "
        "palate and a filigreed, chalky-minerally sense of texture. Chardonnay grown "
        "on this chalk is thought by the Champenois to owe its minerality directly to "
        "the chalk. Within the Côte des Blancs is the Grand Cru village of Le "
        "Mesnil-sur-Oger; with the Montagne de Reims it shares all seventeen Grand "
        "Cru villages."
    )
    cdb_id = _helpers.find_or_create_subregion(conn, "Côte des Blancs", rid, slug="cote-des-blancs")
    ingest.upsert_context(
        conn, cdb_id, "wine",
        short="Chalky, mostly east-facing hillside planted almost exclusively with "
              "chardonnay; the classic source of blanc de blancs — light, lifted, "
              "minerally; home to Le Mesnil-sur-Oger.",
        full=cdb_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "orientation": "mostly east-facing", "soil": "near-surface chalk",
            "grape": "chardonnay", "style": "blanc de blancs",
            "notable_grand_cru": "Le Mesnil-sur-Oger",
        }),
    )

    vdm_full = (
        "The Vallée de la Marne (the 'valley of the Marne River') is mostly planted "
        "with pinot meunier, whose relative resistance to frost and botrytis suits "
        "the more humid, low-lying conditions nearer the river. Its soils tend more "
        "toward marl, clay and sand than the pure chalk of the other areas. Meunier's "
        "supple, fresh fruitiness makes it a mainstay of nonvintage blends, which are "
        "meant to be drunk young rather than long-cellared."
    )
    vdm_id = _helpers.find_or_create_subregion(conn, "Vallée de la Marne", rid, slug="vallee-de-la-marne")
    ingest.upsert_context(
        conn, vdm_id, "wine",
        short="Humid, low-lying Marne river valley planted mostly with pinot "
              "meunier; soils of marl, clay and sand; supple fruit for nonvintage "
              "blends.",
        full=vdm_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "grape": "pinot meunier", "soil": "marl, clay and sand",
            "role": "supple fruit for nonvintage blends",
        }),
    )

    # 4. Link the 2 confirmed grapes to Champagne (grape -> region 'grown_in').
    #    Pinot meunier is deliberately NOT linked (not present; link_grape raises).
    for slug in _GRAPES:
        _helpers.link_grape(conn, slug, rid)

    # 5. Benchmark — the book's sensory language is unambiguous on ONE dimension:
    #    Champagne's defining trait is very HIGH ACIDITY (base wines "virtually
    #    vibrating with acidity"; "the sword is the Champagne's dramatic acidity";
    #    "lightning crisp from acidity"). Scale is the project's 1–5 gauge.
    #    Narrative-derived, so confidence='medium' with an explicit citation suffix.
    bench_citation = CITATION + " (narrative-derived)"
    region_ctx = conn.execute(
        "SELECT id FROM taxonomy_contexts WHERE entity_id=? AND scope_id='wine'",
        (rid,)).fetchone()[0]
    ingest.upsert_benchmark(
        conn, region_ctx, "wine.acidity",
        typical=4.5, low=4.0, high=5.0,
        confidence="medium", source_citation=bench_citation)
