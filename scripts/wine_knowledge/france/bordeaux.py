"""Bordeaux sub-chapter loader — authored IN-SESSION from the Wine Bible.

All prose is extracted from the BORDEAUX chapter (lines ~7228–8598) of
`winebible.md`; nothing here is web-sourced or paid-API generated. Every
context/benchmark carries a real CITATION (never a 'legacy:' marker), and we
link only to the existing region/grape skeleton via `_helpers` (which RAISES on
a missing entity rather than blind-creating one).

We OVERWRITE the pre-existing legacy-marked Bordeaux region context with a
book-cited, status='validated' one — that is the intended upgrade.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.france import _helpers

CITATION = "Wine Bible 2e, France/Bordeaux"

# The 5 grapes CONFIRMED present as entities. Petit Verdot is NOT loaded, so we
# deliberately do not link it (link_grape RAISES on a missing grape).
_GRAPES = (
    "cabernet-sauvignon",
    "merlot",
    "cabernet-franc",
    "sauvignon-blanc",
    "semillon",
)


def load(conn) -> None:
    rid = _helpers.find_region(conn, "Bordeaux")

    # 1. Region context — the big picture from the book.
    region_full = (
        "Bordeaux is the largest Appellation d'Origine Contrôlée in France and one "
        "of the largest fine-wine regions in the world (~290,350 acres across some "
        "sixty appellations), lying along the Gironde Estuary and its two feeder "
        "rivers, the Dordogne and the Garonne, an hour from the Atlantic. Its "
        "maritime climate — tempered by the ocean, the Gulf Stream and the Landes "
        "pine forests — is milder and more stable than it would otherwise be, but "
        "can be difficult, which is why growing several varieties that ripen at "
        "different times spreads the agricultural risk. Nearly 90 percent of the "
        "wine is red, and both red and white Bordeaux are almost always BLENDS of "
        "two or more varieties. The region splits into the LEFT BANK (west of the "
        "Gironde/Garonne — the Médoc and Graves, on deep, well-drained beds of "
        "gravel and stone, where cabernet sauvignon dominates and gives the wines "
        "their framework and tannic structure) and the RIGHT BANK (east of the "
        "Gironde/Dordogne — St.-Émilion and Pomerol, on cooler clay and limestone, "
        "where the earlier-ripening, fleshy merlot leads). The British call red "
        "Bordeaux 'claret.' Wine is made under the château system: a château is any "
        "building attached to vineyards with a cuverie (where wine is made) and a "
        "chai (where it is stored and aged). Bordeaux is famous for its multiple, "
        "region-specific classifications — most famously the 1855 Classification of "
        "the Médoc — and for its top wines' ability to be elegant yet concentrated "
        "and long-lived. It also makes superb sweet whites, notably Sauternes."
    )
    region_short = (
        "France's largest AOC and its benchmark red region: maritime-climate, "
        "blend-based Left Bank (gravel, cabernet-driven) vs Right Bank (clay/"
        "limestone, merlot-driven), organised around the château system and the "
        "1855 Classification."
    )
    region_attrs = {
        "key_grapes": [
            "merlot", "cabernet-sauvignon", "cabernet-franc",
            "sauvignon-blanc", "semillon",
        ],
        "climate": "maritime (Atlantic + Gulf Stream + Landes forests, temperate)",
        "classification_system": "1855 Classification (Médoc/Sauternes) plus "
                                 "separate Graves and St.-Émilion systems; Pomerol "
                                 "unclassified",
        "structure": "Left Bank (Médoc/Graves, gravel, cabernet-dominant) vs Right "
                     "Bank (St.-Émilion/Pomerol, clay-limestone, merlot-dominant)",
        "primarily": "red (nearly 90% of production); wines are almost always blends",
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=region_short, full=region_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(region_attrs),
    )

    # 2. The 1855 First Growth classification tier.
    tier = ingest.upsert_entity(
        conn, "classification_tier",
        "Bordeaux 1855 First Growth", "bordeaux-1855-first-growth")
    tier_full = (
        "The Premier Cru ('First Growth') top rank of the 1855 Classification — the "
        "first and most famous of Bordeaux's classifications. In 1855 Napoléon III "
        "asked Bordeaux's château owners to rate their wines for the Paris Universal "
        "Exhibition; the Bordeaux Chamber of Commerce ranked sixty-one châteaux "
        "(sixty in the Médoc plus Château Haut-Brion in Pessac-Léognan, Graves) into "
        "five tiers purely by the price the wine commanded, from Premier Cru (First "
        "Growth) down to Cinquième Cru (Fifth Growth). The classification was "
        "declared immutable. It established FOUR First Growths — Château Lafite-"
        "Rothschild and Château Margaux (elegant), the powerful Château Latour, and "
        "the earthy, sensual Château Haut-Brion. It was changed only once, in 1973, "
        "when Baron Philippe de Rothschild's twenty-year campaign finally elevated "
        "Château Mouton-Rothschild from Second to First Growth — making FIVE First "
        "Growths in all."
    )
    tier_short = (
        "Top rank of the immutable 1855 Classification: the First Growths — Lafite, "
        "Latour, Margaux and Haut-Brion, with Mouton-Rothschild added in 1973."
    )
    tier_attrs = {
        "year": 1855,
        "revised": "once, 1973 (Mouton-Rothschild promoted to First Growth)",
        "basis": "price the wine commanded (estate-based, not land-based)",
        "first_growths": [
            "Château Lafite-Rothschild", "Château Latour", "Château Margaux",
            "Château Haut-Brion", "Château Mouton-Rothschild (added 1973)",
        ],
    }
    ingest.upsert_context(
        conn, tier, "wine",
        short=tier_short, full=tier_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(tier_attrs),
    )
    # region -> classification_tier (verified allowed direction).
    ingest.add_relationship(conn, rid, tier, "classified_under")

    # 3. Key subregion contexts. find_or_create_subregion returns the existing id
    #    where one is already present. Each is authored from the book.
    medoc_full = (
        "The Médoc (including the Haut-Médoc) is the heart of Bordeaux's LEFT BANK, "
        "on the west side of the Gironde Estuary. Its best vineyards sit on deep, "
        "well-drained beds of gravel and stone near the river — an old saying holds "
        "that the finest vineyards 'can see the river.' The land looks flat but has "
        "gently rolling rises that vary sun exposure and drainage. Inside the "
        "Haut-Médoc are four famous communes running north to south: St.-Estèphe, "
        "Pauillac, St.-Julien and Margaux. The wines are cabernet-sauvignon-based, "
        "drawing their framework, structure and considerable tannin — and thus their "
        "great ageing ability — from that grape."
    )
    medoc_id = _helpers.find_or_create_subregion(conn, "Médoc", rid, slug="medoc")
    medoc_ctx = ingest.upsert_context(
        conn, medoc_id, "wine",
        short="Left-Bank heartland on gravel by the Gironde; cabernet-sauvignon-"
              "based, structured, tannic, long-lived; home to Margaux, Pauillac, "
              "St.-Julien and St.-Estèphe.",
        full=medoc_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "bank": "Left", "soil": "gravel and stone",
            "lead_grape": "cabernet-sauvignon",
            "communes": ["St.-Estèphe", "Pauillac", "St.-Julien", "Margaux"],
        }),
    )

    graves_full = (
        "Graves lies on the Left Bank south of the Médoc and is named for its "
        "gravelly soils. It makes both red and white wine, and contains one famous "
        "smaller appellation, Pessac-Léognan — home to Château Haut-Brion, the only "
        "non-Médoc estate ranked in the 1855 Classification (and later classified "
        "again under the separate 1953/1959 Graves system, giving it two "
        "classifications). The top Graves châteaux were all simply granted the "
        "title Grand Cru Classé, with no hierarchical order among them."
    )
    graves_id = _helpers.find_or_create_subregion(conn, "Graves", rid, slug="graves")
    ingest.upsert_context(
        conn, graves_id, "wine",
        short="Left-Bank, gravel-soiled district making red and white; holds "
              "Pessac-Léognan and Château Haut-Brion; own non-ranked Grand Cru "
              "Classé system.",
        full=graves_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "bank": "Left", "soil": "gravel",
            "styles": ["red", "white"],
            "notable_appellation": "Pessac-Léognan",
        }),
    )

    sauternes_full = (
        "Sauternes, in the southern Graves area, is Bordeaux's most celebrated sweet-"
        "white district (alongside neighbouring Barsac). Its wines are made largely "
        "from sémillon — 'the soul of white Bordeaux' — which with age takes on a "
        "honeyed flavour and a creamy, almost lanolin-like texture. Sauternes was "
        "part of the 1855 Classification, categorised separately: a single estate, "
        "Château d'Yquem, was named Premier Cru Supérieur Classé, above the First "
        "and Second Growths. The wines are intensely, richly sweet."
    )
    sauternes_id = _helpers.find_or_create_subregion(conn, "Sauternes", rid, slug="sauternes")
    sauternes_ctx = ingest.upsert_context(
        conn, sauternes_id, "wine",
        short="Bordeaux's great sweet-white district; sémillon-based, honeyed and "
              "richly sweet; 1855-classified with Château d'Yquem as Premier Cru "
              "Supérieur.",
        full=sauternes_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "style": "sweet white", "lead_grape": "semillon",
            "top_estate": "Château d'Yquem (Premier Cru Supérieur Classé)",
        }),
    )

    st_emilion_full = (
        "St.-Émilion is a leading RIGHT-BANK red appellation. On cooler clay and "
        "limestone soils, its wines are led by the fleshy, supple, earlier-ripening "
        "merlot, with cabernet franc — valued for aromatic intensity and notes of "
        "violets and spices — especially important here. St.-Émilion has its own "
        "classification (first drawn up in 1954 and, unlike the Médoc, revised "
        "roughly every decade): the top level is Premier Grand Cru Classé, split "
        "into an 'A' group (the very best) and a 'B' group, above the Grands Crus "
        "Classés. Its rankings have been repeatedly contested in court."
    )
    st_emilion_id = _helpers.find_or_create_subregion(conn, "Saint-Émilion", rid, slug="saint-emilion")
    ingest.upsert_context(
        conn, st_emilion_id, "wine",
        short="Right-Bank red appellation on clay-limestone; merlot-led with "
              "important cabernet franc; own revisable Premier Grand Cru Classé "
              "(A/B) system.",
        full=st_emilion_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "bank": "Right", "soil": "clay and limestone",
            "lead_grape": "merlot",
            "notable_grape": "cabernet-franc",
            "classification": "Premier Grand Cru Classé (A/B), revised ~every decade",
        }),
    )

    pomerol_full = (
        "Pomerol is a small, prestigious RIGHT-BANK red appellation on clay-rich "
        "soils, where the fleshy, supple merlot leads and cabernet franc plays an "
        "important supporting role. Uniquely among Bordeaux's major areas, Pomerol "
        "was never formally classified — yet it is home to some of the world's most "
        "expensive wines, such as Château Pétrus, which was unranked in 1855 simply "
        "because it was a Pomerol."
    )
    pomerol_id = _helpers.find_or_create_subregion(conn, "Pomerol", rid, slug="pomerol")
    ingest.upsert_context(
        conn, pomerol_id, "wine",
        short="Small, unclassified Right-Bank red appellation on clay; merlot-led "
              "with cabernet franc; home to Château Pétrus.",
        full=pomerol_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "bank": "Right", "soil": "clay",
            "lead_grape": "merlot", "notable_grape": "cabernet-franc",
            "classification": "none (never classified)",
        }),
    )

    # 4. Link the 5 confirmed grapes to Bordeaux (grape -> region 'grown_in').
    for slug in _GRAPES:
        _helpers.link_grape(conn, slug, rid)

    # 5. Benchmarks — only where the book's sensory language clearly supports a
    #    value. Scale is the project's 1–5 gauge (per test seed 'wine.body'=4.0).
    #    Narrative-derived, so confidence='medium' and an explicit citation suffix.
    bench_citation = CITATION + " (narrative-derived)"

    # Médoc / Left-Bank cabernet sauvignon: "framework and structure ... comes
    # principally from tannin", "considerable amounts", long-lived, full-bodied.
    ingest.upsert_benchmark(
        conn, medoc_ctx, "wine.tannin",
        typical=4.5, low=4.0, high=5.0,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, medoc_ctx, "wine.body",
        typical=4.0, low=3.5, high=5.0,
        confidence="medium", source_citation=bench_citation)

    # Sauternes: "intensely ... richly sweet", honeyed — very high sweetness.
    ingest.upsert_benchmark(
        conn, sauternes_ctx, "wine.sweetness",
        typical=5.0, low=4.5, high=5.0,
        confidence="medium", source_citation=bench_citation)
