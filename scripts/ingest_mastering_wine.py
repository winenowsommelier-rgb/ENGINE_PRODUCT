"""Ingest 'Top 25 Grapes To Know' from The Wine Bible (2e) into taxonomy.db.

IN-SESSION extraction: every field below is authored from the book's own
prose (winebible.md, section "THE TOP TWENTY-FIVE GRAPES TO KNOW"). NO paid
API, NO web search. Benchmarks are derived ONLY where the book gives explicit
sensory language (body/acidity/tannin/sweetness, 0-5). Where the book does not
clearly signal a dimension, it is left out rather than fabricated.

Structured so batch 2 can append more grapes to GRAPES later.

DB path resolves via WNLQ9_TAXONOMY_DB env var (the canonical taxonomy.db
lives in the MAIN checkout, git-ignored) else the worktree default — mirrors
scripts/apply_wine_knowledge_migration.py.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from scripts.wine_knowledge import schema, ingest

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"


def resolve_db() -> Path:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    return Path(override) if override else DEFAULT_DB


def _cite(name: str) -> str:
    return f"Wine Bible 2e, Top 25 Grapes / {name}"


# Batch 1: Albariño .. Merlot (12 grapes). Prose authored strictly from book.
GRAPES = [
    {
        "name": "Albariño",
        "slug": "albarino",
        "short": "One of the liveliest white wines in Europe and a top seafood wine; floral, citrusy, best young and snappy.",
        "full": (
            "One of the liveliest white wines in Europe and considered one of the best wines for "
            "seafood, albariño comes from Rías Baixas along Spain's green northwestern coast, and has "
            "become Spain's most notable dry white table wine. It is floral and citrusy but not quite as "
            "aromatic as riesling or gewürztraminer, is rarely made or aged in oak, and is best when young "
            "and snappy. Though famous in Spain, it probably originated in northeastern Portugal, where it "
            "is known as alvarinho and is the core grape in vinho verde."
        ),
        "attributes": {
            "origin": "probably northeastern Portugal (known there as alvarinho)",
            "key_regions": ["Rías Baixas (Spain)", "Portugal (vinho verde)"],
            "aka": "alvarinho",
            "color": "white",
        },
        # "one of the liveliest white wines" => high acidity; "best young and snappy",
        # not oaked => light body. Dry (implied) => low sweetness.
        "benchmarks": [
            {"dim": "wine.acidity", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.body", "typ": 2.0, "low": 1.5, "high": 2.5},
            {"dim": "wine.sweetness", "typ": 0.5, "low": 0.0, "high": 1.0},
        ],
    },
    {
        "name": "Barbera",
        "slug": "barbera",
        "short": "Piedmont's most-planted red; superbly mouthfilling and rich with a natural vivacity from relatively high acidity.",
        "full": (
            "Barbera is the most widely planted red grape in Italy's Piedmont, where it — not the more "
            "renowned nebbiolo — is what winemakers invariably drink with dinner. From the mid-1980s, "
            "better sites, lower yields, and better barrels made superbly mouthfilling, rich wines packed "
            "with flavor. Top barberas also have a natural vivacity, a precision and vibrancy that comes "
            "from the grapes' relatively high acidity; nearly all great barberas come from Piedmont."
        ),
        "attributes": {
            "origin": "brought to Piedmont; original home uncertain, parents unknown",
            "key_regions": ["Piedmont (Italy)", "northern California (small amount)"],
            "color": "red",
        },
        # "relatively high acidity" (explicit) => high acidity; "mouthfilling, rich" => medium-full body.
        "benchmarks": [
            {"dim": "wine.acidity", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.body", "typ": 3.5, "low": 3.0, "high": 4.0},
        ],
    },
    {
        "name": "Cabernet Franc",
        "slug": "cabernet-franc",
        "short": "Bordeaux blending grape sitting between merlot and cabernet sauvignon; violet aromas, dark chocolaty flavors when ripe.",
        "full": (
            "Cabernet franc plays an important role in top Bordeaux and Bordeaux-style blends, making up "
            "half or more of Right Bank blends in Pomerol and St.-Émilion. It is generally not as fleshy as "
            "merlot nor as structured and intense as cabernet sauvignon, sitting in perfect mid-prance "
            "between the two; unripe it shows green bell pepper, but in warmer years it can be fantastic, "
            "with violet or irislike aromas and minerally, dark chocolaty flavors. Loire Valley Chinon is "
            "the most well-known example; genetic research shows it originated in Spain's Basque country."
        ),
        "attributes": {
            "origin": "Spain's Basque country, brought northeast to Bordeaux",
            "key_regions": ["Bordeaux Right Bank (Pomerol, St.-Émilion)", "Loire Valley (Chinon)", "California"],
            "color": "red",
        },
        # Explicitly positioned BETWEEN merlot and cab sauv => mid tannin & mid-full body.
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 3.0, "low": 2.5, "high": 3.5},
            {"dim": "wine.body", "typ": 3.0, "low": 2.5, "high": 3.5},
        ],
    },
    {
        "name": "Cabernet Sauvignon",
        "slug": "cabernet-sauvignon",
        "short": "The preeminent classic red; one of the most tannic major grapes, making structured, powerful, ageworthy wines.",
        "full": (
            "The preeminent classic red grape, cabernet sauvignon makes some of the most structured, "
            "complex, majestic, and ageworthy reds in the world, often angular and powerful when young "
            "before turning velvety and elegant with age. Its aromas — blackberry, black currant, cassis, "
            "cedar, graphite, tobacco — are well known, and it is one of the most tannic of all the major "
            "red grapes; unripe it can taste vegetal. Historically the most prized versions were Médoc "
            "Bordeaux blends, but world-class cabernets now also come from California, Italy, Australia, "
            "and Washington State."
        ),
        "attributes": {
            "origin": "offspring of sauvignon blanc and cabernet franc (mid-1700s)",
            "key_regions": ["Bordeaux (Médoc: Margaux, St.-Julien, Pauillac, St.-Estèphe)", "Napa Valley", "Italy", "Australia", "Washington State"],
            "color": "red",
        },
        # "one of the most tannic of all the major red grapes", "structured", "power" => high tannin & body.
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 4.5, "low": 4.0, "high": 5.0},
            {"dim": "wine.body", "typ": 4.0, "low": 3.5, "high": 4.5},
        ],
    },
    {
        "name": "Chardonnay",
        "slug": "chardonnay",
        "short": "One of the world's most successful whites; creamy, lush, full-bodied — though lean, crisp Chablis is the exception.",
        "full": (
            "For decades chardonnay has been one of the most successful white wines in the world, with "
            "appealing flavors — vanilla, butter, buttered toast, custard, green apples, citrus — matched by "
            "creamy, lush, full-bodied textures, though lean, racy, lightning-crisp Chablis remains a "
            "brilliant exception. It arose in Burgundy in the early Middle Ages as a natural cross of gouais "
            "blanc and pinot noir, and is a 'winemaker's wine' shaped by barrel and malolactic fermentation "
            "and sur lie aging. Today it is virtually ubiquitous, but the finest remain among the world's "
            "most luscious and complex dry whites."
        ),
        "attributes": {
            "origin": "Burgundy, France (natural cross of gouais blanc x pinot noir)",
            "key_regions": ["Burgundy", "Champagne", "Chablis", "California", "worldwide"],
            "color": "white",
        },
        # "creamy, lush, and full-bodied" for the majority, but lean Chablis exception => body medium-high, wide range.
        # Acidity and sweetness vary too much by winemaking to assign a single value; omitted.
        "benchmarks": [
            {"dim": "wine.body", "typ": 3.5, "low": 2.0, "high": 4.5},
        ],
    },
    {
        "name": "Chenin Blanc",
        "slug": "chenin-blanc",
        "short": "Loire white of apples and honey, shimmering with acidity; made bone-dry to fully sweet.",
        "full": (
            "The most famous, vibrant chenin blancs come from the Loire Valley appellations Vouvray and "
            "Savennières, which is also the grape's ancestral home. The best examples are stunningly complex "
            "wines with a flavor of apples and honey, shimmering with acidity, minerally, and long-lived. "
            "Loire chenin blanc is made in every degree of sweetness, from bone-dry to fully sweet, the "
            "latter yielding phenomenal dessert wines such as Quarts de Chaume; it is also well known in "
            "South Africa, where it is sometimes called steen."
        ),
        "attributes": {
            "origin": "Loire Valley, France (natural cross of savagnin x unknown parent)",
            "key_regions": ["Loire Valley (Vouvray, Savennières, Quarts de Chaume)", "South Africa (steen)", "California"],
            "aka": "steen (South Africa)",
            "color": "white",
        },
        # "shimmering with acidity" (explicit) => high acidity; "bone-dry to fully sweet" => full sweetness range.
        "benchmarks": [
            {"dim": "wine.acidity", "typ": 4.5, "low": 4.0, "high": 5.0},
            {"dim": "wine.sweetness", "typ": 2.0, "low": 0.0, "high": 5.0},
        ],
    },
    {
        "name": "Gamay",
        "slug": "gamay",
        "short": "The Beaujolais grape; perhaps the lowest in tannin of well-known reds, exuberantly fruity, almost white-wine-like.",
        "full": (
            "Gamay, or more properly gamay noir, is the source of French Beaujolais, including Beaujolais "
            "Nouveau. Of all the well-known red grapes it is perhaps the lowest in tannin and thus, "
            "structurally, more like a white wine than a red, and it is also exuberantly fruity, with the "
            "best examples showing crushed rock and minerals. Its parents are pinot noir and gouais blanc, "
            "making it a sibling of chardonnay; the most serious gamays come from the ten 'cru' villages of "
            "the Beaujolais region."
        ),
        "attributes": {
            "origin": "Burgundy, France (parents: pinot noir x gouais blanc); banished to Beaujolais",
            "key_regions": ["Beaujolais (France) and its ten cru villages"],
            "aka": "gamay noir",
            "color": "red",
        },
        # "perhaps the lowest in tannin... more like a white wine than a red" => very low tannin, light body.
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 1.0, "low": 0.5, "high": 1.5},
            {"dim": "wine.body", "typ": 1.5, "low": 1.0, "high": 2.0},
        ],
    },
    {
        "name": "Gewürztraminer",
        "slug": "gewurztraminer",
        "short": "Explosively aromatic white — roses, lychees, gingerbread; full-bodied, naturally low in acidity, usually dry.",
        "full": (
            "More than almost any other wine, gewürztraminer's nose is heady, with explosive aromas of "
            "roses, lychees, gingerbread, and orange marmalade vaulting out of the glass. A pink-berried, "
            "highly aromatic clone of savagnin, its pungent aromatics can fool drinkers into thinking it is "
            "sweet, but the world's best examples are decidedly dry. The most intense versions come from "
            "Alsace — deeply yellow, superbly concentrated, full-bodied, with just enough acidity to hold "
            "it together, as the grape tends to be naturally low in acidity; outside Alsace, only Italy's "
            "Trentino-Alto Adige reliably excels."
        ),
        "attributes": {
            "origin": "a pink-berried aromatic clone of savagnin (a founder variety)",
            "key_regions": ["Alsace (France)", "Trentino-Alto Adige (Italy)"],
            "color": "white",
        },
        # "full-bodied" (explicit), "naturally low in acidity" (explicit), "decidedly dry" => low sweetness.
        "benchmarks": [
            {"dim": "wine.body", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.acidity", "typ": 2.0, "low": 1.5, "high": 2.5},
            {"dim": "wine.sweetness", "typ": 1.0, "low": 0.0, "high": 1.5},
        ],
    },
    {
        "name": "Grenache",
        "slug": "grenache",
        "short": "Spanish-origin red (garnacha), lead grape of Châteauneuf-du-Pape; not high in tannin, sappy and luxurious with cherry-preserve flavor.",
        "full": (
            "Grenache noir is the lead grape in many southern French wines including Châteauneuf-du-Pape, "
            "Côtes-du-Rhône, and Gigondas, and a top grape in Spanish regions such as Priorat, and it makes "
            "devastatingly great wine from old vines in Australia. Spanish in origin — rightfully known as "
            "garnacha, thought to have arisen in Aragon — it is genetically unstable and difficult to grow. "
            "At its best the wines have unmistakable purity, richness, and beauty plus a cherry-preserves "
            "aroma; grenache is not particularly high in tannin, so great examples have a sappy, luxurious "
            "texture, and it is usually blended with carignan, syrah, and mourvèdre."
        ),
        "attributes": {
            "origin": "Spain (Aragon); properly garnacha",
            "key_regions": ["southern France (Châteauneuf-du-Pape, Côtes-du-Rhône, Gigondas)", "Spain (Priorat, Campo de Borja)", "Australia", "California", "Washington State"],
            "aka": "garnacha; cannonau (Sardinia)",
            "color": "red",
        },
        # "not particularly high in tannin" (explicit) => low-mid tannin; "richness", "sappy, luxurious texture" => medium-full body.
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 2.0, "low": 1.5, "high": 2.5},
            {"dim": "wine.body", "typ": 3.5, "low": 3.0, "high": 4.0},
        ],
    },
    {
        "name": "Grüner Veltliner",
        "slug": "gruner-veltliner",
        "short": "Austria's leading white; precise, lively, dry, minerally, with a signature white-pepper note and high natural acidity.",
        "full": (
            "Grüner veltliner is the leading white wine of Austria and the country's vinous signature, "
            "excelling in the vineyards along the Danube north and west of Vienna and grown virtually no "
            "place else. An ancient natural cross of savagnin and the near-extinct St. Georgener, it has a "
            "forward personality — precise, lively, bold, dry, and minerally — and is legendary for its "
            "white-pepper aroma with a hint of green legumes. Like riesling it is rarely blended or oaked "
            "and tends to be high in natural acidity, giving a mouthwatering quality and food-pairing "
            "advantages."
        ),
        "attributes": {
            "origin": "Austria (natural cross of savagnin x St. Georgener)",
            "key_regions": ["Austria (Danube, north/west of Vienna)", "Czech Republic", "Hungary"],
            "color": "white",
        },
        # "high in natural acidity" (explicit), "dry" => low sweetness.
        "benchmarks": [
            {"dim": "wine.acidity", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.sweetness", "typ": 0.5, "low": 0.0, "high": 1.0},
        ],
    },
    {
        "name": "Malbec",
        "slug": "malbec",
        "short": "Southwestern-French grape (cot) that became Argentina's star; low acidity, deep inky color, soft mouthfilling texture.",
        "full": (
            "Indigenous to southwestern France, malbec — the popular name for the grape cot — is one of the "
            "five red grapes of Bordeaux, but plantings there have long declined as it is prone to frost. "
            "Half a world away it is a star: brought to Argentina in the mid-nineteenth century, it is now "
            "the leading grape for fine Argentine reds, grown in dry, high-altitude Andean vineyards and "
            "almost always made as a varietal. Malbec tends to be low in acidity and slightly less tannic "
            "than cabernet sauvignon, prized for its soft, mouthfilling texture, deep inky color, and "
            "plummy, mocha, earthy flavors; it is also the historic grape of Cahors."
        ),
        "attributes": {
            "origin": "southwestern France (grape variety cot; parents magdeleine noire des Charentes x prunelard)",
            "key_regions": ["Argentina (Mendoza / Andes)", "Bordeaux", "Cahors (France)", "Napa Valley"],
            "aka": "cot",
            "color": "red",
        },
        # "low in acidity" (explicit), "slightly less tannic than cabernet sauvignon" => mid-high tannin,
        # "soft, mouthfilling texture", "deep, inky" => full body.
        "benchmarks": [
            {"dim": "wine.acidity", "typ": 2.0, "low": 1.5, "high": 2.5},
            {"dim": "wine.tannin", "typ": 3.5, "low": 3.0, "high": 4.0},
            {"dim": "wine.body", "typ": 4.0, "low": 3.5, "high": 4.5},
        ],
    },
    {
        "name": "Merlot",
        "slug": "merlot",
        "short": "Bordeaux's most-produced grape; similar to cabernet sauvignon, rounder and plumper but can be every bit as structured and tannic.",
        "full": (
            "Very similar in flavor and texture to cabernet sauvignon, merlot is easily confused with it in "
            "blind tastings, sharing the same father, cabernet franc. Its flavors include blackberry, "
            "cassis, baked cherries, plums, licorice, dark chocolate, and mocha, usually lacking cabernet's "
            "hint of green tobacco. Though famous for roundness and lack of tannin, in rocky, well-drained "
            "soils in top appellations merlot can be every bit as structured, commanding, and tannic as "
            "cabernet sauvignon. It is Bordeaux's leading grape by production, especially on the Right Bank "
            "(Pomerol, St.-Émilion, and the nearly all-merlot Château Pétrus), with a sleeker style from "
            "Washington State, Chile, and northern Italy."
        ),
        "attributes": {
            "origin": "Bordeaux (parents: cabernet franc x magdeleine noire des Charentes)",
            "key_regions": ["Bordeaux Right Bank (Pomerol, St.-Émilion)", "Washington State", "Chile", "northern Italy", "Long Island"],
            "color": "red",
        },
        # Book: famous for "roundness... lack of tannin" YET "can be every bit as structured... and tannic
        # as cabernet sauvignon" depending on site => medium tannin with a wide range; medium-full body.
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 3.0, "low": 2.0, "high": 4.5},
            {"dim": "wine.body", "typ": 3.5, "low": 3.0, "high": 4.0},
        ],
    },
]


def load(conn: sqlite3.Connection) -> int:
    """Upsert every grape in GRAPES with its context and benchmarks. Returns count."""
    for g in GRAPES:
        citation = _cite(g["name"])
        entity_id = ingest.upsert_entity(conn, "grape_variety", g["name"], g["slug"])
        context_id = ingest.upsert_context(
            conn, entity_id, "wine",
            short=g["short"],
            full=g["full"],
            status="validated",
            source_citation=citation,
            confidence="high",
            attributes=json.dumps(g["attributes"]),
        )
        for b in g["benchmarks"]:
            ingest.upsert_benchmark(
                conn, context_id, b["dim"],
                typical=b["typ"], low=b.get("low"), high=b.get("high"),
                confidence="medium",
                source_citation=citation + " (narrative-derived)",
            )
    return len(GRAPES)


if __name__ == "__main__":
    db = resolve_db()
    if not db.exists():
        raise SystemExit(f"taxonomy.db not found at {db}")
    conn = sqlite3.connect(db)
    schema.migrate(conn)  # idempotent, safe
    n = load(conn)
    conn.close()
    print(f"ingested {n} grape varieties into {db}")
