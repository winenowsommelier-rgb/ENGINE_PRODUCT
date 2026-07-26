"""Southern Italy + Islands + Friuli chapter loader — authored IN-SESSION from
The Wine Bible.

Mirrors `italy/piedmont.py` / `italy/veneto.py`: for each of the seven regions
that already exist on the live DB we OVERWRITE the pre-existing region context
with a book-cited, status='validated' one (the intended upgrade), and add the
region's ONE flagship grape via a `grown_in` link. All prose is extracted from
the Italy chapter of `winebible.md` (2nd ed., Karen MacNeil):

  - Abruzzi                     ~18802-18859
  - The Southern Peninsula      ~18862-18906  (Campania ~18907; Apulia ~18967;
                                Basilicata ~19014; Calabria ~19045)
  - Sicily & Sardinia           ~19061  (Sicily ~19069; Sardinia ~19253)
  - Friuli-Venezia Giulia       ~16746-16865
  - Verdicchio / the Marche     ~5235-5239 (grape glossary — the Marche has no
                                dedicated regional chapter; see thin-region note)

Nothing here is web-sourced or paid-API generated. Every context/benchmark
carries a real CITATION (never a 'legacy:' marker), and we link ONLY to the
existing region/grape skeleton via `_helpers` / `ingest` (which RAISE on a
missing entity rather than blind-creating one).

Ground truth used here (verified against the live DB and grapes.load, Task 2):
  region name           -> flagship grape (grown_in)
  ------------------------------------------------------
  Campania              -> aglianico
  Puglia                -> primitivo
  Sicily                -> nero-d-avola
  Sardinia              -> vermentino
  Abruzzo               -> montepulciano-grape
  Marche                -> verdicchio
  Friuli-Venezia Giulia -> pinot-gris   (from Plan 1; friulano does NOT exist
                                          as an entity, so we do NOT link it)

Scope guard: NO `style` entity is created here (dessert/fortified styles like
moscato passito, Marsala, aglianico del Vulture are described in prose only).

Benchmark discipline — honest-and-sparse. A region-level benchmark is recorded
ONLY where the book gives an unambiguous structural characterization of the
region's signature wine:

  - Campania: Taurasi (aglianico) is "almost blackish in colour", ageworthy,
    "a dark, foreboding wine with delicious severity" -> HIGH body + HIGH
    tannin (structure/ageability). Recorded.
  - Sicily: nero d'Avola makes "intensely black-colored wines of real depth",
    "good, concentrated reds", "mouthfilling, structured, chocolaty" -> HIGH
    body. Recorded.

For Puglia the book explicitly calls dry primitivo "not unlike a LIGHT-bodied
American zinfandel", so no high-body region benchmark is asserted (the grape
entity already carries a modest body figure). Abruzzo (montepulciano d'Abruzzo
is "rustic... solidly built"), Sardinia (cannonau "bold, dry, spicy";
vermentino "a simple wine"), the Marche (verdicchio "simple, clean" whites,
only "racy, bold, crisp" at the top sites) and Friuli (racy whites but nearly
half the production is red) do NOT get a defensible region-wide benchmark, so
none is invented — sparse-but-honest beats fabricated data.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.italy import _helpers

CITATION_SOUTH = "Wine Bible 2e, Italy/Southern Peninsula"
CITATION_ISLANDS = "Wine Bible 2e, Italy/Sicily & Sardinia"
CITATION_ABRUZZO = "Wine Bible 2e, Italy/Abruzzi"
CITATION_FRIULI = "Wine Bible 2e, Italy/Friuli-Venezia Giulia"
CITATION_MARCHE = "Wine Bible 2e, Italy (grape glossary: verdicchio/the Marche)"


def load(conn) -> None:
    _load_campania(conn)
    _load_puglia(conn)
    _load_sicily(conn)
    _load_sardinia(conn)
    _load_abruzzo(conn)
    _load_marche(conn)
    _load_friuli(conn)


# --------------------------------------------------------------------------- #
# Campania (Southern Peninsula) — flagship aglianico / Taurasi
# --------------------------------------------------------------------------- #
def _load_campania(conn) -> None:
    rid = _helpers.find_region(conn, "Campania")
    full = (
        "Campania, the region around Naples, the Amalfi Coast and Capri, is — "
        "along with Apulia — one of the two most exciting wine regions of "
        "southern Italy: where there were only three main wineries in 1970 there "
        "are now more than a hundred, and over a hundred grape varieties, "
        "including three of the south's most impressive ancient ('archaeological') "
        "grapes that thrive in the volcanic soils of Avellino, northeast of Mount "
        "Vesuvius — the red aglianico and the whites fiano and greco. Aglianico is "
        "the basis for the south's most famous red, the DOCG Taurasi: almost "
        "blackish in colour, with fascinating bitter-chocolate, leather and tar "
        "aromas and flavours, it is one of the only southern wines noted for its "
        "capacity to age — a dark, foreboding wine of delicious severity "
        "(Mastroberardino's Historia is the benchmark example). Campania's whites "
        "are equally fascinating: the region's hilly geography lets white grapes "
        "ripen at higher, cooler elevations that preserve acidity, so greco (greco "
        "di Tufo) is bursting with cooling freshness, the softer fiano is less "
        "dramatic, and falanghina and coda di volpe round out the roster. Lacryma "
        "Christi, from the slopes of Vesuvius, is Campania's best-known simple, "
        "easy-drinking wine (red, white and sparkling)."
    )
    short = (
        "Volcanic Campania (around Naples/Vesuvius) is one of the south's two most "
        "exciting regions: red aglianico makes the ageworthy, almost-blackish DOCG "
        "Taurasi, while cool-hillside whites — greco (greco di Tufo), fiano and "
        "falanghina — burst with freshness."
    )
    attrs = {
        "key_grapes": ["aglianico", "greco", "fiano", "falanghina", "coda di volpe"],
        "climate": "warm, sunny southern Italy; volcanic soils of Avellino NE of "
                   "Mount Vesuvius; hilly geography lets whites ripen at higher, "
                   "cooler elevations that preserve acidity",
        "key_wines": ["Taurasi (DOCG)", "Greco di Tufo", "Fiano di Avellino",
                      "Falanghina", "Lacryma Christi"],
        "signature": "Taurasi — aglianico; almost blackish, ageworthy, bitter-"
                     "chocolate/leather/tar, 'dark, foreboding... delicious "
                     "severity'",
        "notable_producers": ["Mastroberardino", "Feudi di San Gregorio"],
    }
    cid = ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION_SOUTH, confidence="high",
        attributes=json.dumps(attrs),
    )
    _helpers.link_grape(conn, "aglianico", rid)
    # Taurasi (aglianico): ageworthy, "almost blackish", structured, foreboding
    # -> high body AND high tannin. Narrative-derived, cited.
    bench = CITATION_SOUTH + " (narrative-derived; Taurasi/aglianico signature)"
    ingest.upsert_benchmark(
        conn, cid, "wine.body", typical=4.0, low=3.5, high=4.5,
        confidence="medium", source_citation=bench)
    ingest.upsert_benchmark(
        conn, cid, "wine.tannin", typical=4.0, low=3.5, high=4.5,
        confidence="medium", source_citation=bench)


# --------------------------------------------------------------------------- #
# Puglia / Apulia (Southern Peninsula) — flagship primitivo
# --------------------------------------------------------------------------- #
def _load_puglia(conn) -> None:
    rid = _helpers.find_region(conn, "Puglia")
    full = (
        "Apulia (Puglia), a long, flat, sun-drenched, fertile strip across the "
        "Adriatic from Greece, stretches from the spur of the Italian boot to its "
        "heel and for recent years has produced more wine than any other Italian "
        "region (and more olive oil, too — nearly half the national total). Much "
        "of it is basic, cheap table wine, but there are very good everyday reds — "
        "ideal bargain house wines — and quality is rising as outside investors "
        "such as Tuscany's Antinori move in. The leading grapes are negroamaro "
        "(from Latin negro, 'black', and probably amaro, 'bitter'), malvasia nera "
        "di Brindisi, nero di Troia (uva di Troia) and primitivo. Negroamaro is "
        "the primary grape of the hot, arid Salento peninsula, where it makes "
        "Salice Salentino, one of the most popular low-priced wines on Italian "
        "restaurant lists; nero di Troia gives the robust red DOCG Castel del "
        "Monte Nero di Troia Riserva. Primitivo — genetically the same as "
        "California's zinfandel and Croatia's tribidrag/crljenak kastelanski, "
        "brought from the Dalmatian coast — is made both dry (not unlike a "
        "light-bodied American zinfandel) and sweet, the latter being the rare "
        "DOCG primitivo di Manduria dolce naturale, made from grapes raisinated "
        "on the vine to about 8 percent residual sugar in only the best vintages."
    )
    short = (
        "Sun-drenched Apulia (Puglia), the heel of the boot, is Italy's most "
        "prolific region — mostly rustic bargain reds from negroamaro (Salice "
        "Salentino), nero di Troia and primitivo (the zinfandel grape), the last "
        "made both dry and as the sweet DOCG primitivo di Manduria dolce naturale."
    )
    attrs = {
        "key_grapes": ["primitivo", "negroamaro", "nero di Troia (uva di Troia)",
                       "malvasia nera di Brindisi"],
        "climate": "long, flat, sun-drenched, fertile; hot and arid (esp. the "
                   "Salento peninsula); ground-water scarce",
        "key_wines": ["Salice Salentino", "Castel del Monte Nero di Troia Riserva "
                      "(DOCG)", "Primitivo di Manduria dolce naturale (DOCG)"],
        "signature": "primitivo (= zinfandel/tribidrag) — dry, light-bodied reds "
                     "plus the rare sweet raisinated DOCG; negroamaro's Salice "
                     "Salentino the popular house red",
        "note": "Italy's largest wine-producing region by volume; quality rising "
                "with outside (Antinori) investment",
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION_SOUTH, confidence="high",
        attributes=json.dumps(attrs),
    )
    _helpers.link_grape(conn, "primitivo", rid)
    # No region benchmark: the book explicitly calls dry primitivo "light-bodied"
    # (the grape entity already carries a modest body figure); no defensible
    # region-wide tannin/acidity figure is given. Sparse-but-honest.


# --------------------------------------------------------------------------- #
# Sicily (Islands) — flagship nero d'Avola
# --------------------------------------------------------------------------- #
def _load_sicily(conn) -> None:
    rid = _helpers.find_region(conn, "Sicily")
    full = (
        "Sicily, the Mediterranean's largest island and Italy's largest region, "
        "is one of the country's top regions by volume. Famous for its wines in "
        "antiquity, it spent much of the twentieth century infamous for ultra-"
        "cheap vino da tavola, until a quality-oriented mini-revolution in the "
        "1970s-80s. Today more fascinating wines — white and red — are made than "
        "ever. Sicily's mainstay red is nero d'Avola (also called Calabrese), a "
        "high-quality variety making intensely black-coloured, concentrated reds "
        "of real depth, juiciness and charm, and increasingly of surprising "
        "complexity and richness. A separate zone generating excitement is Mt. "
        "Etna, whose chilly, high-altitude, black-lava terroir suits snappy whites "
        "(riesling and the local, minerally carricante) and pale but ferociously "
        "dry, bitter reds from nerello Mascalese and nerello cappuccio. The local "
        "white grillo makes dry, racy, peppery whites. Sicily is also home to two "
        "of the world's most wickedly delicious dessert wines — moscato passito di "
        "Pantelleria (from zibibbo/muscat of Alexandria) and malvasia delle Lipari "
        "— and to the historic fortified Marsala (grillo, catarratto, inzolia), "
        "which at vergine/vergine stravecchio level rivals the best tawny Ports "
        "and oloroso Sherries."
    )
    short = (
        "Italy's largest region, post-1980s revitalised for quality: mainstay "
        "nero d'Avola makes intensely black, concentrated reds; high, cold Mt. "
        "Etna gives snappy carricante whites and pale, bitter nerello reds; plus "
        "the dessert legends moscato passito di Pantelleria, malvasia delle Lipari "
        "and fortified Marsala."
    )
    attrs = {
        "key_grapes": ["nero d'Avola (Calabrese)", "carricante", "grillo",
                       "nerello Mascalese", "nerello cappuccio", "zibibbo (muscat "
                       "of Alexandria)"],
        "climate": "sunny Mediterranean island; hilly, poor soil; the cold, "
                   "high-altitude black-lava terroir of Mt. Etna is a snappy-"
                   "white/pale-red exception",
        "key_wines": ["nero d'Avola reds", "Etna Bianco (carricante)", "Etna Rosso "
                      "(nerello)", "Marsala", "Moscato passito di Pantelleria",
                      "Malvasia delle Lipari"],
        "signature": "nero d'Avola — intensely black-coloured, concentrated, "
                     "mouthfilling, structured, chocolaty reds of real depth",
    }
    cid = ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION_ISLANDS, confidence="high",
        attributes=json.dumps(attrs),
    )
    _helpers.link_grape(conn, "nero-d-avola", rid)
    # nero d'Avola: "intensely black-colored wines of real depth", "concentrated",
    # "mouthfilling, structured, chocolaty" -> high body. Narrative-derived.
    bench = CITATION_ISLANDS + " (narrative-derived; nero d'Avola signature)"
    ingest.upsert_benchmark(
        conn, cid, "wine.body", typical=4.0, low=3.5, high=4.5,
        confidence="medium", source_citation=bench)


# --------------------------------------------------------------------------- #
# Sardinia (Islands) — flagship vermentino
# --------------------------------------------------------------------------- #
def _load_sardinia(conn) -> None:
    rid = _helpers.find_region(conn, "Sardinia")
    full = (
        "Sardinia (Sardegna), 125 miles off the Italian mainland, is remote and "
        "insular, and — thanks to long Spanish rule — several of its grapes are "
        "Spanish in origin: cannonau (the same as Spain's garnacha), carignano "
        "(cariñena/carignan) and the ancient girò. Cannonau, planted all over the "
        "island, is Sardinia's most important red — a bold, dry, spicy wine with "
        "chaparral and dried-herb flavours evocative of the parched island itself "
        "(terrific alone, sometimes blended, as in Sella & Mosca's Tanca Farra "
        "with cabernet). Girò makes an interesting Portlike wine near Cagliari, "
        "and carignano a decent, earthy red in the far-southern Sulcis. Two whites "
        "are essential: the unusual, deliberately oxidised, bone-dry, bitter-"
        "almond vernaccia di Oristano (Sherry-like, and unrelated to Tuscany's "
        "vernaccia), and vermentino — a terrific dry white that could be any "
        "Italian wine lover's nightly house wine, its aromas mirroring the dry, "
        "windswept island in notes of wild rosemary, sage and dried lavender, and "
        "at its finest labelled vermentino di Gallura in the far north near "
        "Corsica."
    )
    short = (
        "Remote, Spanish-influenced Sardinia: bold, spicy, dried-herb cannonau "
        "(garnacha) is the flagship red, while dry, herb-scented vermentino "
        "(finest as vermentino di Gallura) is the island's essential white, "
        "alongside the Sherry-like vernaccia di Oristano."
    )
    attrs = {
        "key_grapes": ["vermentino", "cannonau (garnacha)", "carignano",
                       "girò", "vernaccia di Oristano"],
        "climate": "isolated, rugged, dry, windswept Mediterranean island; "
                   "Spanish cultural and varietal influence",
        "key_wines": ["Vermentino di Sardegna", "Vermentino di Gallura",
                      "Cannonau di Sardegna", "Vernaccia di Oristano"],
        "signature": "vermentino — dry, herb-scented white of rosemary/sage/"
                     "lavender; cannonau the bold, spicy flagship red",
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION_ISLANDS, confidence="high",
        attributes=json.dumps(attrs),
    )
    _helpers.link_grape(conn, "vermentino", rid)
    # No region benchmark: vermentino is "a simple wine", cannonau "bold, dry,
    # spicy" — no unambiguous region-wide body/acidity/tannin scale in the book.


# --------------------------------------------------------------------------- #
# Abruzzo (central Italy) — flagship montepulciano
# --------------------------------------------------------------------------- #
def _load_abruzzo(conn) -> None:
    rid = _helpers.find_region(conn, "Abruzzo")
    full = (
        "Abruzzi (Abruzzo), in central Italy along the Adriatic and cut off from "
        "Rome by the Apennines, has ample sunshine, a dry climate, coastal breezes "
        "and high-altitude vineyards (three-quarters above 2,000 feet) — seemingly "
        "tailor-made for vines, and one of the country's most productive regions. "
        "Yet more than three-quarters of its wine is made by large cooperatives, "
        "much of it inexpensive or bulk. Its most notable wine is the rustic red "
        "montepulciano d'Abruzzo, from the montepulciano grape (not to be confused "
        "with Tuscany's sangiovese-based vino nobile di Montepulciano): usually an "
        "appealingly rustic, solidly built wine with a soft texture and thick "
        "middle fruit, at its best in the DOCG montepulciano d'Abruzzo Colline "
        "Teramane. A summer specialty is the fresh light red (rosé-like) "
        "cerasuolo, 'cherry red'. The main white, trebbiano d'Abruzzo, is usually "
        "a bland, dry quaffer for the region's fish dishes — though a handful of "
        "artisanal producers, chief among them the cult estate Valentini, make "
        "extraordinary examples that tower above the rest."
    )
    short = (
        "Sunny, high-altitude, co-op-dominated Abruzzi in central Italy is best "
        "known for the rustic, solidly built red montepulciano d'Abruzzo (top: the "
        "DOCG Colline Teramane) and its light cherry-red cerasuolo, plus the "
        "everyday white trebbiano d'Abruzzo."
    )
    attrs = {
        "key_grapes": ["montepulciano", "trebbiano d'Abruzzo"],
        "climate": "central Italy, Adriatic coast; sunny, dry, high altitude "
                   "(much of it above 2,000 ft), coastal breezes",
        "key_wines": ["Montepulciano d'Abruzzo", "Montepulciano d'Abruzzo Colline "
                      "Teramane (DOCG)", "Cerasuolo d'Abruzzo", "Trebbiano "
                      "d'Abruzzo"],
        "signature": "montepulciano d'Abruzzo — rustic, solidly built, soft-"
                     "textured red with thick middle fruit",
        "note": "co-op-dominated and often inexpensive; a few artisans (Valentini) "
                "make cult-level wines",
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION_ABRUZZO, confidence="high",
        attributes=json.dumps(attrs),
    )
    _helpers.link_grape(conn, "montepulciano-grape", rid)
    # No region benchmark: montepulciano d'Abruzzo is "rustic... solidly built"
    # with "soft texture" — no unambiguous high/low structural scale is given.


# --------------------------------------------------------------------------- #
# Marche (central Italy) — flagship verdicchio (THIN region; grape-glossary only)
# --------------------------------------------------------------------------- #
def _load_marche(conn) -> None:
    rid = _helpers.find_region(conn, "Marche")
    # NB: the Marche has no dedicated regional chapter in this edition; the book
    # covers it only through the verdicchio grape glossary. Context is therefore
    # short and cited to that glossary — honest about the thin coverage.
    full = (
        "The Marche, in central Italy on the Adriatic, is the home of verdicchio "
        "(verdicchio bianco), cultivated principally here where it is generally "
        "made into simple, clean white wines. In the top sites and at low yields, "
        "however, verdicchio can make a racy, bold, crisp wine with far more "
        "personality. (The same grape is used in the Veneto, alongside garganega, "
        "to make the best Soaves, where it is confusingly called trebbiano di "
        "Soave.) The Wine Bible (2nd ed.) does not give the Marche its own "
        "regional chapter, so this context is drawn from its verdicchio glossary "
        "entry rather than a fuller regional treatment."
    )
    short = (
        "Adriatic central-Italian region and home of verdicchio: usually simple, "
        "clean whites, but racy, bold and crisp at the top sites and low yields."
    )
    attrs = {
        "key_grapes": ["verdicchio"],
        "climate": "central Italy, Adriatic side",
        "key_wines": ["Verdicchio"],
        "signature": "verdicchio — simple clean whites; at best racy, bold, crisp",
        "coverage_note": "thin — no dedicated Wine Bible regional chapter; sourced "
                         "from the verdicchio grape glossary",
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION_MARCHE, confidence="medium",
        attributes=json.dumps(attrs),
    )
    _helpers.link_grape(conn, "verdicchio", rid)
    # No region benchmark: verdicchio is mostly "simple, clean" and only "racy,
    # bold, crisp" at top sites (the grape entity already carries an acidity
    # figure); the thin regional coverage does not support a region-wide scale.


# --------------------------------------------------------------------------- #
# Friuli-Venezia Giulia (NE Italy) — flagship pinot-gris (pinot grigio)
# --------------------------------------------------------------------------- #
def _load_friuli(conn) -> None:
    rid = _helpers.find_region(conn, "Friuli-Venezia Giulia")
    full = (
        "Friuli-Venezia Giulia (usually just Friuli), sticking out from Italy's "
        "northeastern corner toward Austria and Slovenia, is acclaimed as one of "
        "the top places in the world for racy white wines — more than any other "
        "Italian wines, its whites have a Teutonic precision, focus and grip. "
        "Cool nights and warm days off the juxtaposition of Alps and Adriatic give "
        "an exhilaratingly taut structure and pinpoint balance, and the whites are "
        "not fragile but have real body and determined grip. The top whites are "
        "made from pinot grigio (pinot gris), sauvignon blanc, chardonnay, ribolla "
        "gialla and — the grape that has captured the Friulian heart, theirs "
        "alone — friulano (formerly tocai friulano). Despite the renown of the "
        "whites, reds account for more than 40 percent of production: mostly "
        "merlot (excellent in Friuli's warmer pockets), plus cabernet sauvignon, "
        "cabernet franc and the stellar native schioppettino, tazzelenghe and "
        "pignolo. Two exquisite sweet wines, verduzzo di Ramandolo and picolit, "
        "are also made here in tiny quantities. Friuli is one of Italy's most "
        "ambitious regions: DOC/DOCG wines are more than half its production, and "
        "no other Italian region has moved so quickly from obscurity to "
        "distinction."
    )
    short = (
        "Northeastern, Austrian/Slovenian-influenced Friuli is acclaimed for racy, "
        "taut white wines of Teutonic precision and grip — pinot grigio, ribolla "
        "gialla, sauvignon and the local friulano — though merlot-led reds are "
        "over 40 percent of production."
    )
    attrs = {
        "key_grapes": ["pinot grigio (pinot gris)", "friulano", "ribolla gialla",
                       "sauvignon blanc", "chardonnay", "merlot", "schioppettino"],
        "climate": "cool northeastern Italy; Alps-meet-Adriatic; cold nights and "
                   "warm days give taut structure and pinpoint balance",
        "key_wines": ["Pinot Grigio", "Friulano", "Ribolla Gialla", "merlot reds",
                      "Verduzzo di Ramandolo", "Picolit"],
        "signature": "racy, taut, precise white wines with real body and grip; "
                     "pinot grigio, ribolla gialla, sauvignon and native friulano",
        "note": "reds (mostly merlot) are >40% of production; DOC/DOCG >50% of "
                "total output",
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=short, full=full,
        status="validated", source_citation=CITATION_FRIULI, confidence="high",
        attributes=json.dumps(attrs),
    )
    # Only pinot-gris exists as an entity (Plan 1); friulano does NOT, so it is
    # NOT linked (link_grape would raise). Sparse-but-honest.
    _helpers.link_grape(conn, "pinot-gris", rid)
    # No region benchmark: the region makes both racy whites AND substantial reds
    # (>40%), so no single region-wide body/acidity/tannin figure is defensible.
