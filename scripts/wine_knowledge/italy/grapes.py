"""Italian grape-variety loader — authored IN-SESSION from The Wine Bible.

Creates the 10 core Italian grape entities that the region sub-chapter loaders
will later link to. All prose is extracted from the Italy chapter and the A–Z
grape glossary of `winebible.md` (2nd ed., Karen MacNeil); nothing here is
web-sourced or paid-API generated. Every context/benchmark carries a real
CITATION. This module runs FIRST in the pipeline so `find_grape` in the region
loaders resolves rather than raises.

Where the book gives a clear sensory/structural characterization, we add a
1–5-scale benchmark (range low/high). Where the book is thin (it merely names
the grape without describing structure), we DELIBERATELY leave the benchmark
off rather than fabricate one. Sparse-but-honest beats invented data.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest

CITATION = "Wine Bible 2e, Italy (grape glossary)"
BENCH_CITATION = CITATION + " (narrative-derived)"


def _grape(conn, name: str, slug: str, *, short: str, full: str,
           attrs: dict, benchmarks=()) -> None:
    eid = ingest.upsert_entity(conn, "grape_variety", name, slug)
    cid = ingest.upsert_context(
        conn, eid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION, confidence="medium",
        attributes=json.dumps(attrs),
    )
    for dim, typical, low, high in benchmarks:
        ingest.upsert_benchmark(
            conn, cid, dim,
            typical=typical, low=low, high=high,
            confidence="medium", source_citation=BENCH_CITATION,
        )


def load(conn) -> None:
    # 1. PRIMITIVO — Puglia; genetically the same as zinfandel / Croatian
    #    tribidrag. Book: dry primitivo is "not unlike a light-bodied American
    #    zinfandel"; also made sweet (raisinated). No firm tannin/acid claim in
    #    the book, so only a modest body benchmark from the "light-bodied" note.
    _grape(
        conn, "Primitivo", "primitivo",
        short=(
            "Southern Italian (Apulian) red grape, genetically the same as "
            "California's zinfandel and Croatia's tribidrag."
        ),
        full=(
            "Primitivo is the southern Italian twin of Croatia's tribidrag "
            "(crljenak kastelanski), brought from the Dalmatian coast to Apulia, "
            "and is the same variety as California's zinfandel. In Apulia it is "
            "made into both dry and sweet wines: the dry is not unlike a light-"
            "bodied American zinfandel, while the sweet version — the DOCG "
            "primitivo di Manduria dolce naturale — is a rare red made from "
            "grapes allowed to raisinate on the vine, with roughly 8 percent "
            "residual sugar and produced only in the best vintages."
        ),
        attrs={
            "color": "red",
            "origin": "Apulia (southern Italy); same variety as zinfandel/tribidrag",
            "styles": ["dry red", "sweet red (raisinated)"],
            "synonyms": ["zinfandel", "tribidrag", "crljenak kastelanski"],
        },
        benchmarks=[("wine.body", 3.0, 2.5, 3.5)],
    )

    # 2. CORVINA — backbone of Valpolicella & Amarone; appassimento. Amarone is
    #    a "powerhouse" with "Portlike body" at 15–16% alcohol → very full-bodied.
    _grape(
        conn, "Corvina", "corvina",
        short=(
            "The most important red grape in Valpolicella and Amarone, from the "
            "Veneto around Verona."
        ),
        full=(
            "Corvina (more properly corvina Veronese) is considered the most "
            "important red grape in the blends behind the Veneto's best-known "
            "reds — Valpolicella, Bardolino and, above all, Amarone. It probably "
            "originated around Verona; the name may derive from corvo ('crow'), a "
            "reference to the dark colour of the grapes. It is usually blended "
            "with smaller amounts of rondinella (its progeny) and molinara. In "
            "Amarone the grapes are dried by the appassimento method, "
            "concentrating their sugars into a powerful, Portlike wine of 15–16 "
            "percent alcohol with deep bitter-chocolate, mocha and dried-fig "
            "flavours."
        ),
        attrs={
            "color": "red",
            "region": "Veneto (Verona)",
            "key_wines": ["Amarone", "Valpolicella", "Bardolino"],
            "method": "appassimento (dried-grape) for Amarone",
            "blended_with": ["rondinella", "molinara"],
        },
        benchmarks=[("wine.body", 4.5, 4.0, 5.0)],
    )

    # 3. GARGANEGA — the Soave white grape. Book names it as major grape of
    #    Soave but gives no sensory structure in the glossary → no benchmark.
    _grape(
        conn, "Garganega", "garganega",
        short="The major white grape of Soave, an ancient Veneto variety.",
        full=(
            "Garganega is an ancient variety most closely associated with the "
            "northern Italian region of the Veneto, and is the major grape of "
            "Soave, where it is almost always blended with what is locally called "
            "trebbiano di Soave (a grape DNA-shown to be verdicchio bianco). It "
            "is thought to be one of the parents of many other Italian white "
            "varieties, including trebbiano Toscano, malvasia bianca di Candia, "
            "albana and catarratto bianco."
        ),
        attrs={
            "color": "white",
            "region": "Veneto",
            "key_wine": "Soave",
            "blended_with": ["trebbiano di Soave (verdicchio bianco)"],
        },
    )

    # 4. AGLIANICO — southern Italy's noble red; basis of Taurasi. Book: "almost
    #    blackish", bitter-chocolate/leather/tar, ages well, "dark, foreboding
    #    ... with delicious severity" → full-bodied, ageworthy, structured.
    _grape(
        conn, "Aglianico", "aglianico",
        short=(
            "Southern Italy's noble ageworthy red, the basis of the DOCG Taurasi "
            "in Campania."
        ),
        full=(
            "Aglianico is an ancient red variety planted almost exclusively in "
            "southern Italy. In Campania it makes the famous DOCG Taurasi, and in "
            "Basilicata the wine aglianico del Vulture. Taurasi is almost blackish "
            "in colour, with bitter-chocolate, leather and tar aromas and "
            "flavours, and is one of the very few southern reds noted for its "
            "capacity to age — a dark, foreboding wine with a delicious severity."
        ),
        attrs={
            "color": "red",
            "region": "southern Italy (Campania, Basilicata)",
            "key_wines": ["Taurasi (DOCG)", "aglianico del Vulture"],
            "notes": "deep colour; bitter-chocolate/leather/tar; ageworthy",
        },
        benchmarks=[("wine.body", 4.0, 3.5, 4.5)],
    )

    # 5. MONTEPULCIANO (grape) — slug montepulciano-grape; NOT the Tuscan town.
    #    Book: widespread in central/southern Italy, well known in Abruzzo where
    #    it makes the "good, rustic" montepulciano d'Abruzzo. "Rustic" ~ modest.
    _grape(
        conn, "Montepulciano", "montepulciano-grape",
        short=(
            "A central/southern Italian red grape (best known in Abruzzo) — NOT "
            "the sangiovese-based Tuscan wine vino nobile di Montepulciano."
        ),
        full=(
            "The grape montepulciano is confusingly unrelated to the Tuscan wine "
            "vino nobile di Montepulciano, which is made from sangiovese. It is "
            "widespread throughout central and southern Italy and is especially "
            "well known in Abruzzo, where it makes the good, rustic red "
            "montepulciano d'Abruzzo — usually an appealingly straightforward "
            "everyday wine."
        ),
        attrs={
            "color": "red",
            "region": "central/southern Italy (esp. Abruzzo)",
            "key_wine": "montepulciano d'Abruzzo",
            "note": "distinct from vino nobile di Montepulciano (sangiovese)",
        },
    )

    # 6. VERMENTINO — coastal white (Ligurian Riviera, Sardinia, Corsica).
    #    Book: "dry, floral white wines" → aromatic/dry; no explicit body/acid
    #    scale in the glossary, so we keep it context-only.
    _grape(
        conn, "Vermentino", "vermentino",
        short=(
            "A dry, floral coastal white grape of the Italian Riviera, Sardinia "
            "and Corsica."
        ),
        full=(
            "Vermentino is well known along the Italian Riviera, where it is the "
            "source of dry, floral white wines considered indispensable partners "
            "for Ligurian fish soups. It is also grown on the island of Sardinia "
            "and on French Corsica, where it is sometimes called malvoisie; in "
            "southern France it is often known as rolle."
        ),
        attrs={
            "color": "white",
            "region": "Ligurian Riviera, Sardinia, Corsica/southern France",
            "style": "dry, floral",
            "synonyms": ["rolle", "malvoisie"],
        },
    )

    # 7. DOLCETTO — Piedmont's soft, easy-drinking red. Book is explicit on
    #    structure: "relatively little acid, not much tannin, and is lighter in
    #    body than barbera" → LOW acid, LOW tannin, LOWER body. Full benchmarks.
    _grape(
        conn, "Dolcetto", "dolcetto",
        short=(
            "Piedmont's soft, fruity, low-tannin everyday red — easy-drinking, "
            "almost gulpable."
        ),
        full=(
            "Dolcetto (the name means 'little sweet') is a Piedmontese red often "
            "misleadingly pegged as Italy's Beaujolais, though the two taste "
            "quite different: dolcetto has a firm, spicy fruitiness set off "
            "against a subtle bitter-chocolate background. It has relatively "
            "little acid, not much tannin, and is lighter in body than barbera, "
            "making it so easy to drink it becomes almost gulpable — a favourite "
            "every-night wine in Piedmont. Most is simple, easy-drinking stuff, "
            "though a few producers make serious versions with real grip and "
            "depth. The best wines come from around Alba (dolcetto d'Alba) and "
            "Dogliani (dolcetto di Dogliani)."
        ),
        attrs={
            "color": "red",
            "region": "Piedmont",
            "style": "soft, fruity, early-drinking",
            "structure": "low acid, low tannin, light-to-medium body",
        },
        benchmarks=[
            ("wine.tannin", 2.0, 1.5, 2.5),
            ("wine.acidity", 2.0, 1.5, 2.5),
            ("wine.body", 2.5, 2.0, 3.0),
        ],
    )

    # 8. GLERA — the Prosecco grape (Veneto). Sparkling; book gives no still
    #    body/acid scale in the glossary → context-only.
    _grape(
        conn, "Glera", "glera",
        short="The grape behind Italian sparkling Prosecco, from the Veneto.",
        full=(
            "Glera is an ancient northern Italian grape, formerly known as "
            "prosecco, used to make the sparkling wine Prosecco (grown especially "
            "in the Conegliano area of the Veneto). When the wine Prosecco was "
            "awarded DOCG status in 2009, the grape name 'prosecco' was officially "
            "discontinued — to avoid confusion with the wine's DOC/DOCG zone — and "
            "the old synonym glera came into official use. The grape is thought to "
            "have originated in the Istrian area of northern Croatia, near Trieste."
        ),
        attrs={
            "color": "white",
            "region": "Veneto",
            "key_wine": "Prosecco (sparkling)",
            "former_name": "prosecco (renamed glera in 2009)",
        },
    )

    # 9. NERO D'AVOLA — Sicily's flagship red. Book: "aristocratic red grape of
    #    Sicily, making wines that are mouthfilling, structured, chocolaty, and
    #    often complex" → full-bodied. Benchmark on body.
    _grape(
        conn, "Nero d'Avola", "nero-d-avola",
        short=(
            "Sicily's aristocratic flagship red — mouthfilling, structured and "
            "chocolaty."
        ),
        full=(
            "Nero d'Avola is a widely planted black ('nero') grape, probably named "
            "after the city of Avola in Sicily, and is the aristocratic red grape "
            "of the island. It makes wines that are mouthfilling, structured, "
            "chocolaty and often complex, and is sometimes called Calabrese. DNA "
            "analysis suggests there are several clones — and possibly several "
            "different varieties — that fall under the name."
        ),
        attrs={
            "color": "red",
            "region": "Sicily",
            "style": "mouthfilling, structured, chocolaty, complex",
            "synonym": "Calabrese",
        },
        benchmarks=[("wine.body", 4.0, 3.5, 4.5)],
    )

    # 10. VERDICCHIO — Marche white. Book: mostly "simple, clean white wines",
    #     but at top sites/low yields "a racy, bold, crisp wine" → high acidity.
    _grape(
        conn, "Verdicchio", "verdicchio",
        short=(
            "The white grape of the Marche in central Italy, at its best racy, "
            "bold and crisp."
        ),
        full=(
            "Verdicchio (verdicchio bianco), usually simply known as verdicchio, "
            "is cultivated principally in central Italy, where it is generally "
            "made into simple, clean white wines in the region known as the "
            "Marche. In the top sites and at low yields, however, it can make a "
            "racy, bold, crisp wine with far more personality. This is also the "
            "grape used in the Veneto, alongside garganega, to make the best "
            "Soaves — where it is confusingly called trebbiano di Soave."
        ),
        attrs={
            "color": "white",
            "region": "Marche (central Italy); also Veneto/Soave",
            "style": "simple clean whites; at best racy, bold, crisp",
            "note": "the 'trebbiano di Soave' used with garganega in Soave",
        },
        benchmarks=[("wine.acidity", 4.0, 3.5, 4.5)],
    )
