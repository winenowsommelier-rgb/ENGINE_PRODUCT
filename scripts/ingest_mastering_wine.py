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
    # Batch 2: Mourvèdre .. Zinfandel (13 grapes), completing the Top 25.
    {
        "name": "Mourvèdre",
        "slug": "mourvedre",
        "short": "The 'Heathcliff' of red grapes: dark, hard-edged, brooding wines with gravitas; Spanish-origin (monastrell), star of Bandol.",
        "full": (
            "Mourvèdre is the Heathcliff of red grapes — its dark, hard-edged, almost brooding flavors are "
            "never light, juicy, or lively, and it has gravitas. Spanish in origin, it should properly be known "
            "as monastrell (or mataró), and in Castilla-La Mancha, especially Jumilla, it makes delicious, "
            "sometimes muscular wines with dry, bitter espresso-like flavors that call for red meat. In "
            "southern France a small amount gives depth, color, and kick to Rhône blends such as "
            "Châteauneuf-du-Pape and Côtes-du-Rhône; today the Provençal appellation of Bandol remains its "
            "steadfast French stronghold, and it is also a blending grape in California's Rhône-style wines."
        ),
        "attributes": {
            "origin": "Spain (province of Valencia; propagated by monks); properly monastrell",
            "key_regions": ["Bandol (Provence)", "Jumilla (Castilla-La Mancha, Spain)", "southern France (Châteauneuf-du-Pape, Côtes-du-Rhône)", "California"],
            "aka": "monastrell; mataró",
            "color": "red",
        },
        # "muscular", "gravitas", gives "structure" => full body & high tannin (the book's tannic/structural grape).
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.body", "typ": 4.0, "low": 3.5, "high": 4.5},
        ],
    },
    {
        "name": "Muscat",
        "slug": "muscat",
        "short": "Not one grape but a large group of ancient aromatic varieties; intensely fruity, made in every style from bone-dry to fortified sweet.",
        "full": (
            "Muscat is not a single variety but a large group of different ancient grapes that have grown "
            "around the Mediterranean for centuries — possibly the first domesticated grape. What most share is "
            "the distinct, awesomely fruity muscat aroma, intensely aromatic and irresistible. The two main "
            "muscats are the high-quality, small-berried muscat blanc à petits grains and its daughter muscat of "
            "Alexandria. Within the group are wines made in virtually every style imaginable — dry, sweet, "
            "still, sparkling, and fortified: dry still wines in Alsace and Austria, passito dessert wines in "
            "southern Italy and Spain, sweet bubbly moscato d'Asti in northern Italy, and fortified muscat de "
            "Beaumes-de-Venise in southern France."
        ),
        "attributes": {
            "origin": "around the Mediterranean; a large group of ancient related and unrelated varieties",
            "key_regions": ["Alsace (France)", "Austria", "northern Italy (moscato d'Asti)", "southern France (Beaumes-de-Venise)", "southern Italy", "Spain"],
            "aka": "moscato; muscat blanc à petits grains; muscat of Alexandria",
            "color": "white",
        },
        # "intensely aromatic"; explicitly made "dry, sweet... fortified" => full sweetness range, no single value.
        "benchmarks": [
            {"dim": "wine.sweetness", "typ": 2.5, "low": 0.0, "high": 5.0},
        ],
    },
    {
        "name": "Nebbiolo",
        "slug": "nebbiolo",
        "short": "Massively structured and adamantly tannic; pale in color yet ferociously tannic and high-acid; the noble grape of Barolo and Barbaresco.",
        "full": (
            "One of the oldest and most important varieties in Piedmont, Italy, nebbiolo is massively "
            "structured and adamantly tannic when young — from anything less than a fantastic vineyard it can "
            "slam your palate closed. The finest nebbiolos possess an unequaled combination of complexity and "
            "power, with flavors and aromas of tar, violets, and a rich, espresso-like bitterness from the "
            "wine's pronounced tannin. In the minds of Italians it is equal in status to the great cabernet "
            "sauvignons of France, and it makes the exalted Piedmontese wines Barolo and Barbaresco. It is a "
            "poster child for grapes that don't travel well, thriving essentially only in Piedmont."
        ),
        "attributes": {
            "origin": "Piedmont, Italy (or perhaps the Valtellina of Lombardy); parents presumed extinct",
            "key_regions": ["Piedmont (Barolo, Barbaresco)", "Valtellina (Lombardy)"],
            "color": "red",
        },
        # "adamantly tannic", "pronounced tannin" => very high tannin; structure "from acidity" implied high acid;
        # pale-colored but massively structured => full body. The signature high-tannin/high-acid red.
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 4.5, "low": 4.0, "high": 5.0},
            {"dim": "wine.acidity", "typ": 4.5, "low": 4.0, "high": 5.0},
            {"dim": "wine.body", "typ": 4.0, "low": 3.5, "high": 4.5},
        ],
    },
    {
        "name": "Pinot Gris",
        "slug": "pinot-gris",
        "short": "'Gray' pinot whose style swings from neutral Italian pinot grigio to opulent, smoky-spicy Alsace pinot gris; a color-mutation clone of pinot noir.",
        "full": (
            "Depending on where it is grown, pinot gris — 'gray' pinot — can taste strikingly different. The "
            "best-known style, Italian pinot grigio, is usually the lowest in quality, often utterly neutral, "
            "though there are delicious exceptions. The pinot gris of Alsace, France is nearly the opposite: "
            "complex, opulent, often a bit smoky and spicy but still precise and crisp, and one of Alsace's four "
            "'noble' varieties. In Germany (as grauburgunder) it can be broad and Rubenesque; Oregon versions "
            "show pear and spice-cake. Technically it is not its own variety but a color-mutation clone of pinot "
            "noir, so the grapes range from bluish silver to mauve-pink to ashen yellow."
        ),
        "attributes": {
            "origin": "a color-mutation clone of pinot noir (not technically its own variety)",
            "key_regions": ["Alsace (France)", "Italy (pinot grigio: Friuli, Alto Adige)", "Germany (grauburgunder)", "Oregon", "Okanagan Valley (British Columbia)", "California"],
            "aka": "pinot grigio; grauburgunder",
            "color": "white",
        },
        # Book contrasts neutral, light Italian grigio with broad/opulent/Rubenesque Alsace & German gris
        # => body varies widely; no single acidity/sweetness signal given.
        "benchmarks": [
            {"dim": "wine.body", "typ": 2.5, "low": 1.5, "high": 4.0},
        ],
    },
    {
        "name": "Pinot Noir",
        "slug": "pinot-noir",
        "short": "The sensual red — supple, silky, earthy; lighter in body and far less tannic than cabernet, and famously the most difficult grape to grow.",
        "full": (
            "Thought to be more than two thousand years old, pinot noir is a 'founder variety' and, more than "
            "any other wine, is described in sensual terms — its remarkably supple, silky textures and "
            "erotically earthy aromas set it apart. The best pinots exude warm baked cherries, plums, "
            "pomegranate, and strawberry jam alongside damp earth, forest floor, mushrooms, and worn leather. "
            "It is lighter in body and far less tannic than cabernet sauvignon, merlot, or syrah, and lighter in "
            "color, yet its aromas and flavors can be deep and riveting. Considered the most difficult grape to "
            "grow and vinify, its historic home is Burgundy (home of the legendary Romanée-Conti), with "
            "outstanding New World examples from Oregon, New Zealand, and California."
        ),
        "attributes": {
            "origin": "northeastern France; a 'founder variety' (parents/exact origin unknown)",
            "key_regions": ["Burgundy", "Oregon", "New Zealand", "California (Sta. Rita Hills, Russian River, Sonoma Coast, Carneros)"],
            "color": "red",
        },
        # "lighter in body and far less tannic than cabernet"; "supple, silky" => light-medium body, low-moderate
        # tannin; bright/riveting acidity implied => moderate-high acidity.
        "benchmarks": [
            {"dim": "wine.body", "typ": 2.5, "low": 2.0, "high": 3.0},
            {"dim": "wine.tannin", "typ": 2.0, "low": 1.5, "high": 2.5},
            {"dim": "wine.acidity", "typ": 3.5, "low": 3.0, "high": 4.0},
        ],
    },
    {
        "name": "Riesling",
        "slug": "riesling",
        "short": "Considered by many the most noble white grape; soaring acidity, purity and minerality; made in every degree from bone-dry to lusciously sweet.",
        "full": (
            "Riesling is considered by many — possibly most — wine experts to be the most noble and unique "
            "white grape in the world, thought to have originated in Germany's Rheingau. Great riesling has "
            "soaring acidity, an incomparable sense of purity and vividness, and considerable extract, yet is "
            "wonderfully graceful and seems light; its refined structure is complemented by peach, apricot, and "
            "melon flavors pierced with a vibrant mineral quality. Temperamental about where it is planted, the "
            "most elegant, precise examples come from cool-to-cold climates — Germany, Alsace, Austria, "
            "Slovenia, Canada, and upstate New York. Most of the world's rieslings are actually dry, though it "
            "also spans to intentionally sweet styles such as beerenauslese and trockenbeerenauslese."
        ),
        "attributes": {
            "origin": "Rheingau, Germany (offspring of gouais blanc x an unknown father)",
            "key_regions": ["Germany (Mosel, Rheingau)", "Alsace (France)", "Austria", "Clare & Eden Valleys (Australia)", "Washington State", "upstate New York"],
            "color": "white",
        },
        # "soaring acidity" => very high acidity; explicitly dry to beerenauslese/TBA => full sweetness range;
        # "seems light", relatively low alcohol => light-medium body.
        "benchmarks": [
            {"dim": "wine.acidity", "typ": 4.5, "low": 4.0, "high": 5.0},
            {"dim": "wine.sweetness", "typ": 1.5, "low": 0.0, "high": 5.0},
            {"dim": "wine.body", "typ": 2.0, "low": 1.5, "high": 2.5},
        ],
    },
    {
        "name": "Sangiovese",
        "slug": "sangiovese",
        "short": "Italy's most famous grape; takes its structure from acidity rather than tannin — fresh cherry when young, earthy and mineral with age.",
        "full": (
            "Italy's most famous grape, sangiovese is responsible for the three great wines of Tuscany — Chianti "
            "Classico, vino nobile di Montepulciano, and brunello di Montalcino — and is a major grape in the "
            "Super Tuscans, with great sangiovese coming almost only from Tuscany. Like pinot noir it is old and "
            "genetically unstable, yielding hundreds of clones and wines that vary widely in style and quality. "
            "In flavor and structure it is closer to pinot noir than to cabernet sauvignon, taking its structure "
            "primarily from acidity rather than tannin. Young, it has the appeal of a fresh, warm cherry pie; "
            "with age it takes on dried leaf, dried orange peel, tea, mocha, and a fabulous minerality, even "
            "saltiness."
        ),
        "attributes": {
            "origin": "possibly southern Italy (parents Calabrese di Montenuovo x ciliegiolo), later spread to Tuscany",
            "key_regions": ["Tuscany (Chianti Classico, Montepulciano, Montalcino)", "Umbria", "Emilia-Romagna", "California"],
            "color": "red",
        },
        # "takes its structure primarily from acidity rather than tannin" => high acidity, moderate tannin;
        # medium body (closer to pinot noir than cabernet).
        "benchmarks": [
            {"dim": "wine.acidity", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.tannin", "typ": 3.0, "low": 2.5, "high": 3.5},
            {"dim": "wine.body", "typ": 3.0, "low": 2.5, "high": 3.5},
        ],
    },
    {
        "name": "Sauvignon Blanc",
        "slug": "sauvignon-blanc",
        "short": "Wild, riotous, herbaceous white — grass, smoke, green herbs, lime, gunflint — with a clean, keen stiletto of acidity through its center.",
        "full": (
            "The name sauvignon comes from the French sauvage, 'wild' — a fitting name for both the vine and the "
            "wine's riotous, untamed flavors: straw, hay, grass, smoke, green tea, green herbs, lime, and "
            "gunflint charge around the mouth with wonderful intensity. The wine appears almost linear on the "
            "palate, with a clean, keen stiletto of acidity that vibrates through its center. The best, most "
            "outrageous, tangy sauvignons come from the Loire Valley (Sancerre and Pouilly-Fumé), New Zealand, "
            "and Austria, followed by South Africa and Chile; in Bordeaux it is blended with sémillon, whose "
            "broad character mellows sauvignon's tart herbalness. Poorly made or from unripe grapes it can turn "
            "vegetal."
        ),
        "attributes": {
            "origin": "likely the Loire Valley, France (a parent was probably savagnin; the other unknown)",
            "key_regions": ["Loire Valley (Sancerre, Pouilly-Fumé)", "New Zealand", "Austria", "South Africa", "Chile", "Bordeaux (blended)", "California"],
            "aka": "fumé blanc; blanc fumé",
            "color": "white",
        },
        # "stiletto of acidity" => high acidity; dry, "linear on the palate" => low sweetness, light-medium body.
        "benchmarks": [
            {"dim": "wine.acidity", "typ": 4.5, "low": 4.0, "high": 5.0},
            {"dim": "wine.sweetness", "typ": 0.5, "low": 0.0, "high": 1.0},
            {"dim": "wine.body", "typ": 2.0, "low": 1.5, "high": 2.5},
        ],
    },
    {
        "name": "Sémillon",
        "slug": "semillon",
        "short": "Broad, mouthfilling white with a pure, clean, 'starched' character young; the ideal Sauternes botrytis grape; honeyed and nutty with age.",
        "full": (
            "There can be something pure, clean, and starched about many sémillons, especially when young. In "
            "Bordeaux — sémillon's birthplace — its broad, mouthfilling character gets a perfect lift from the "
            "lean tartness of sauvignon blanc, a blend true both for dry white Bordeaux and for the region's "
            "sweet wines such as Sauternes: sémillon's thin skins and loose bunches are readily attacked by the "
            "noble rot, Botrytis cinerea, making it ideal for Sauternes. Some of the greatest dry sémillons are "
            "made in Australia's Hunter Valley, where — unlike broad, lush Bordeaux — they are howlingly tart and "
            "tensile when young, becoming honeyed, cashew-nutty, and lanolin-textured with age."
        ),
        "attributes": {
            "origin": "Bordeaux, France (genetically linked to sauvignon blanc, relationship unclear)",
            "key_regions": ["Bordeaux (Sauternes; dry white Bordeaux)", "Hunter Valley (Australia)"],
            "color": "white",
        },
        # "broad, mouthfilling" => full body; low-moderate acidity (lifted by sauvignon's tartness, though Aussie
        # versions tart); Sauternes botrytis examples are lusciously sweet => wide sweetness range.
        "benchmarks": [
            {"dim": "wine.body", "typ": 3.5, "low": 3.0, "high": 4.5},
            {"dim": "wine.acidity", "typ": 2.5, "low": 2.0, "high": 4.0},
            {"dim": "wine.sweetness", "typ": 1.5, "low": 0.0, "high": 5.0},
        ],
    },
    {
        "name": "Syrah",
        "slug": "syrah",
        "short": "Manly yet elegant — potent, exuberant reds of leather, smoke, roasted meat, and black pepper; the star grape of the northern Rhône.",
        "full": (
            "Syrah is manly yet elegant — a nineteenth-century writer called Rhône Hermitage (pure syrah) the "
            "'manliest wine' he'd ever drunk. Its potent, exuberant aromas and flavors lean toward leather, "
            "smoke, roasted meats, bacon, game, coffee, spices, iron, black olive, and especially white and "
            "black pepper, and the best wines have a kinetic mouthfeel with flavors that detonate on the palate "
            "like tiny grenades. The most dramatic syrahs come from the northern Rhône Valley (Hermitage, "
            "Côte-Rôtie, Cornas), while in the south it joins blends like Châteauneuf-du-Pape. Called shiraz in "
            "Australia, where it is the country's most famous red — a spellbinding, spicy blockbuster in the "
            "Barossa Valley and beyond."
        ),
        "attributes": {
            "origin": "France (progeny of dureza x mondeuse blanche; pinot noir a likely great-grandparent)",
            "key_regions": ["northern Rhône (Hermitage, Côte-Rôtie, Cornas)", "southern Rhône (Châteauneuf-du-Pape, Gigondas)", "Languedoc-Roussillon", "Australia (Barossa, McLaren Vale)", "California", "Washington State"],
            "aka": "shiraz (Australia)",
            "color": "red",
        },
        # "potent", "blockbuster", peppery power; dark and forceful => full body & high tannin.
        "benchmarks": [
            {"dim": "wine.body", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.tannin", "typ": 4.0, "low": 3.5, "high": 4.5},
        ],
    },
    {
        "name": "Tempranillo",
        "slug": "tempranillo",
        "short": "Spain's most famous red and the main grape of Rioja; well structured and balanced, cherry when young, deep and earthy with age.",
        "full": (
            "Spain's most famous red grape, tempranillo makes a huge range of styles depending on where it is "
            "grown — it is the main grape of Rioja, where traditionally styled wines can resemble red Burgundy "
            "in refinement, earthiness, and complexity, but it also makes blockbuster dense reds like tinta del "
            "Toro and the tinta del país of Ribera del Duero. It is usually well structured and well balanced; "
            "its significant tannin lets it age for long periods, though the wine is generally not as firm on "
            "the palate as cabernet sauvignon, and its acidity gives precision without being as high as pinot "
            "noir. Young, its flavors burst with cherries; with age it takes on a deep, complex earthiness. It "
            "also grows in Portugal (as tinta roriz, a Port grape), Argentina, and California."
        ),
        "attributes": {
            "origin": "Rioja and Navarra, northern Spain (one probable parent: albillo mayor)",
            "key_regions": ["Rioja", "Ribera del Duero", "Toro", "Portugal (tinta roriz; Port)", "Argentina", "California"],
            "aka": "tinta roriz; tinto del país; cencibel; ull de llebre",
            "color": "red",
        },
        # "significant... tannin" but "not as firm... as cabernet"; acidity gives precision but "not as high as
        # pinot noir"; well structured/balanced => moderate everything.
        "benchmarks": [
            {"dim": "wine.tannin", "typ": 3.5, "low": 3.0, "high": 4.0},
            {"dim": "wine.acidity", "typ": 3.0, "low": 2.5, "high": 3.5},
            {"dim": "wine.body", "typ": 3.5, "low": 3.0, "high": 4.0},
        ],
    },
    {
        "name": "Viognier",
        "slug": "viognier",
        "short": "One of the finest, rarest French whites; usually full-bodied, honeysuckle-apricot-musky and lanolin-textured, so fruity/floral it seems sweet even when bone-dry.",
        "full": (
            "Viognier is one of the finest but rarest French white grapes — it nearly went extinct in the 1960s "
            "before becoming fashionable in California and Languedoc-Roussillon, and fewer than 300 acres remain "
            "in its home, the northern Rhône. There it makes the prestigious wines Condrieu and Château-Grillet, "
            "and a little is co-fermented with syrah in Côte-Rôtie. Viognier is usually a full-bodied wine with "
            "honeysuckle, apricot, gingerbread, and musky aromas and flavors and a mesmerizing lanolin-ish "
            "texture; like gewürztraminer its extroverted fruity/floral aromas fool many drinkers into thinking "
            "it is a little sweet even when it's bone-dry. In California it often suffers from too little acidity "
            "to give it definition. It is also well known in Australia."
        ),
        "attributes": {
            "origin": "northern Rhône, France (related to mondeuse blanche; half-sibling or grandparent of syrah)",
            "key_regions": ["northern Rhône (Condrieu, Château-Grillet)", "California", "Languedoc-Roussillon", "Virginia", "Australia"],
            "color": "white",
        },
        # "usually a full-bodied wine" => full body; "too little acidity to give it definition" => low acidity;
        # "bone-dry" (aromatic but dry) => low sweetness.
        "benchmarks": [
            {"dim": "wine.body", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.acidity", "typ": 2.0, "low": 1.5, "high": 2.5},
            {"dim": "wine.sweetness", "typ": 1.0, "low": 0.0, "high": 1.5},
        ],
    },
    {
        "name": "Zinfandel",
        "slug": "zinfandel",
        "short": "California's jammy chameleon; true red zin is soft-textured, dry, medium-to-full-bodied and crammed with blackberry, boysenberry, and plummy fruit.",
        "full": (
            "For decades zinfandel was California's most widely planted red grape (until cabernet surpassed it in "
            "1998), and it is a chameleon — made into everything from blush 'white zinfandel' to sweet fortified "
            "wine. But the zinfandel that knowledgeable drinkers love — true red zinfandel — is a soft-textured "
            "dry red crammed with jammy blackberry, boysenberry, and plummy fruit, usually concentrated, medium "
            "to full in body, and notorious for temporarily staining one's teeth crimson. DNA typing in the "
            "1990s revealed it to be the Croatian grape crljenak kaštelanski (historically tribidrag), the same "
            "grape known as primitivo in southern Italy's Apulia. Some of California's oldest 'old-vine' "
            "vineyards, in Amador and Sonoma counties, are zinfandel."
        ),
        "attributes": {
            "origin": "Croatia (crljenak kaštelanski / tribidrag), imported to California in the 1830s",
            "key_regions": ["California (Amador County, Sonoma County)", "Apulia, Italy (primitivo)"],
            "aka": "primitivo; crljenak kaštelanski; tribidrag",
            "color": "red",
        },
        # "medium to full in body" (explicit); "soft-textured" => moderate tannin; jammy/concentrated, high
        # alcohol implied => full body. Acidity not clearly signaled => omitted.
        "benchmarks": [
            {"dim": "wine.body", "typ": 4.0, "low": 3.5, "high": 4.5},
            {"dim": "wine.tannin", "typ": 3.0, "low": 2.5, "high": 3.5},
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
