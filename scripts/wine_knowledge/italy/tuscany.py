"""Tuscany sub-chapter loader + the FIRST-EVER `style` entity (Super Tuscan) —
authored IN-SESSION from The Wine Bible.

Mirrors `italy/piedmont.py` for the region half: we OVERWRITE the pre-existing
Tuscany region context with a book-cited, status='validated' one (the intended
upgrade), link sangiovese via `grown_in`, and attach the region to the
italy-docg tier via `classified_under`.

The NEW part — and the point of this task — is the `style` entity_type. We
create exactly ONE style, "Super Tuscan", and exercise the two style verbs in
their REQUIRED directions (vocab.DIRECTION):
  * produces_style: (region|appellation) -> style   [Tuscany region -> style]
  * exhibits_style: (grape_variety|classification_tier) -> style
                                                     [sangiovese grape -> style]
`ingest.add_relationship` validates direction and RAISES on a reversed edge, so
these two calls are the stress test of the style verbs. `style` is NARROW: it is
a single cross-region, extra-legal quality style, NOT one style per DOCG.

All prose is extracted from the Italy chapter of `winebible.md` (2nd ed., Karen
MacNeil): Tuscany ~17199-17422 (the region, its four great sangiovese reds,
galestro/schist soils, the espresso-like acidity+tannin bite); the Super Tuscan
history from the Italy classification passage ~15307-15409 (DOC 1963 -> the
1970s anti-DOC rebellion -> Vino da Tavola -> the 1992 IGT designation) plus the
Tuscany-chapter framing ~17232-17245 and the Sassicaia/Bolgheri story
~17526-17545. Nothing here is web-sourced or paid-API generated; every context
and benchmark carries a real CITATION and links only to the existing
region/grape/tier skeleton (which RAISES on a missing entity, never blind-
creates one).

Note: this edition of the book does not mention the Chianti Classico
"black-rooster / Gallo Nero" consortium emblem, so — per the citation-or-NULL
discipline — that detail is deliberately NOT authored here (it would be
uncited). The region context stays within what the book supports.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.italy import _helpers

CITATION = "Wine Bible 2e, Italy/Tuscany"
# The Super Tuscan HISTORY comes from the classification passage, so its context
# is cited to that chapter (the book's dedicated telling of the story).
CITATION_CLASSIFICATION = "Wine Bible 2e, Italy (classification)"

_DOCG_SLUG = "italy-docg"
_STYLE_SLUG = "super-tuscan"


def load(conn) -> None:
    tid = _helpers.find_region(conn, "Tuscany")

    # 1. Region context — OVERWRITE the seed context with the book's picture.
    region_full = (
        "Tuscany (Toscana) is the quintessential Italian wine region and the "
        "sangiovese heartland — the birthplace of four of Italy's most important "
        "red wines: Chianti, Chianti Classico, Brunello di Montalcino and Vino "
        "Nobile di Montepulciano, all built on the sangiovese grape (for centuries "
        "the region's single greatest variety). The wines nonetheless taste quite "
        "different, because Tuscany is a plethora of distinct mesoclimates thrown up "
        "by an endless succession of twisting, undulating hills (the region is "
        "roughly 68 percent hills, so nearly every vineyard sits on a slope), and "
        "because sangiovese — a finicky, demanding grape, like pinot noir high in "
        "acidity and exacting to ripen — has begotten hundreds of clones that have "
        "adapted to their local sites. Most important wine zones lie in the central "
        "belt from Florence south through Siena to the hill town of Montalcino "
        "(famous for Brunello); the climate there is warm but tempered by cool "
        "nights that preserve sangiovese's natural acidity. The well-drained central "
        "slopes are sandy or stony and calcareous, interspersed with schist and "
        "galestro (a crumbly, stony marl) over the classic albarese limestone. There "
        "is a firmness and espresso-like bitterness to Tuscan reds — the result of "
        "acidity coupled with tannin — that the best wines carry beautifully. A wine "
        "revolution in the 1970s and 1980s lifted quality dramatically and, breaking "
        "the DOC mould, gave rise to the internationally acclaimed Super Tuscans. "
        "White wine has always been an afterthought here (the great exception is the "
        "dessert wine vin santo), though modern dry sauvignon blancs, chardonnays "
        "and the traditional Vernaccia di San Gimignano are all made."
    )
    region_short = (
        "Italy's quintessential region and sangiovese's heartland: the four great "
        "sangiovese reds (Chianti, Chianti Classico, Brunello di Montalcino, Vino "
        "Nobile di Montepulciano) off hilly, galestro/albarese-strewn slopes, with a "
        "firm espresso-like acidity-and-tannin bite; birthplace of the Super Tuscans."
    )
    region_attrs = {
        "key_grapes": ["sangiovese", "cabernet-sauvignon"],
        "climate": "warm central hills tempered by cool nights that preserve "
                   "sangiovese's acidity; ~68% hills, nearly every vineyard on a slope",
        "soils": "sandy/stony, calcareous; schist and galestro (crumbly stony marl) "
                 "over albarese limestone",
        "key_wines": ["Chianti", "Chianti Classico", "Brunello di Montalcino",
                      "Vino Nobile di Montepulciano", "Super Tuscans",
                      "Vernaccia di San Gimignano", "Vin Santo"],
        "classification_system": "Italian DOCG/DOC; the first four DOCGs (1980) "
                                 "included Tuscany's Brunello di Montalcino and Vino "
                                 "Nobile di Montepulciano",
        "signature": "sangiovese — high-acid, tannic, espresso-like bitterness; "
                     "hundreds of site-adapted clones",
    }
    region_ctx = ingest.upsert_context(
        conn, tid, "wine",
        short=region_short, full=region_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(region_attrs),
    )

    # 2. THE style entity — Super Tuscan. Exactly one, cross-region/extra-legal.
    style_id = ingest.upsert_entity(conn, "style", "Super Tuscan", _STYLE_SLUG)
    style_full = (
        "'Super Tuscan' is a consumer nickname — never an official designation, and "
        "the words never appear on the label — for a group of premium, avant-garde "
        "Tuscan reds born of a deliberate rebellion against Italy's DOC rules. The "
        "DOC laws (enacted 1963) built each wine's stipulations around traditional "
        "regional practice, and by the 1970s innovative winemakers were chafing "
        "against them. The template was Sassicaia, planted in 1944 by Mario Incisa "
        "della Rocchetta on a stony/sandy hill at Bolgheri on the Tuscan coast: it "
        "was a Bordeaux-inspired CABERNET SAUVIGNON (reportedly cuttings from Château "
        "Lafite-Rothschild), not sangiovese, aged in small new French oak, and made "
        "nowhere near the Chianti, Brunello or Vino Nobile zones. In 1971 Piero "
        "Antinori made the first well-publicised break with the DOC, modelling his "
        "Tignanello on Sassicaia. Because these wines did not follow the DOC "
        "regulations, the Italian government could officially class them only as Vino "
        "da Tavola (table wine) — the LOWEST status an Italian wine can hold — yet "
        "they commanded a small fortune, and the wine press bestowed on them their "
        "lasting nickname. Super Tuscans are generally flamboyant, powerful, highly "
        "structured and wrapped in new-oak vanilla, trying to be international while "
        "evoking Italianness. Some use non-traditional cabernet sauvignon and/or "
        "merlot (Sassicaia, Solaia, Masseto), others are 100 percent sangiovese "
        "(Tignanello, Flaccianello, Le Pergole Torte, Cepparello). In 1992 Italy "
        "created the IGT (Indicazione Geografica Tipica) designation, in part to give "
        "these extra-legal but high-quality wines a home above humble Vino da Tavola. "
        "Each Super Tuscan carries its own proprietary name; the category is a style, "
        "not a place."
    )
    style_short = (
        "A consumer nickname (never an official designation) for premium Tuscan reds "
        "that in the 1970s-80s broke DOC rules — using non-traditional cabernet/"
        "merlot (Sassicaia, Solaia) or pure sangiovese (Tignanello) — and so were "
        "labelled lowly Vino da Tavola, later IGT, despite commanding high prices."
    )
    style_attrs = {
        "kind": "extra-legal / cross-region quality style",
        "official": False,
        "label_status_history": ["Vino da Tavola", "IGT (from 1992)"],
        "origin": "1970s-80s anti-DOC rebellion in Tuscany",
        "template_wines": ["Sassicaia (cabernet)", "Tignanello (sangiovese)"],
        "grape_approaches": [
            "non-traditional cabernet sauvignon and/or merlot",
            "100% sangiovese outside the DOC(G) rules",
        ],
        "note": "'Super Tuscan' is a consumer term; it never appears on the label",
    }
    ingest.upsert_context(
        conn, style_id, "wine",
        short=style_short, full=style_full,
        status="validated", source_citation=CITATION_CLASSIFICATION, confidence="high",
        attributes=json.dumps(style_attrs),
    )

    # 3. Relationships.
    #    grown_in: sangiovese -> Tuscany.
    _helpers.link_grape(conn, "sangiovese", tid)

    #    classified_under: Tuscany region -> italy-docg tier.
    docg_row = conn.execute(
        "SELECT id FROM taxonomy_entities WHERE entity_type='classification_tier' "
        "AND slug=?", (_DOCG_SLUG,)).fetchone()
    if not docg_row:
        raise ValueError(
            f"tier {_DOCG_SLUG!r} not found — run tiers.load(conn) before "
            "tuscany.load(conn)")
    ingest.add_relationship(conn, tid, docg_row[0], "classified_under")

    #    produces_style: Tuscany region -> super-tuscan (region -> style).
    ingest.add_relationship(conn, tid, style_id, "produces_style")

    #    exhibits_style: sangiovese grape -> super-tuscan (grape -> style).
    #    Sangiovese IS a Super Tuscan grape (Tignanello, Le Pergole Torte, etc.).
    sang_id = _helpers.find_grape(conn, "sangiovese")
    ingest.add_relationship(conn, sang_id, style_id, "exhibits_style")

    # 4. Benchmarks on the Tuscany region context — only what the book clearly
    #    supports, on the project's 1-5 gauge (per test seed 'wine.body'=4.0).
    #    Narrative-derived, so confidence='medium' with an explicit citation suffix.
    #    Tuscan reds carry a firm "espresso-like bitterness ... the result of
    #    acidity coupled with tannin"; sangiovese is "a grape relatively high in
    #    acidity" and modern winemaking "coaxed more ... power, and tannin from the
    #    grape". Brunello (Tuscany's fullest expression) is "ample in body, packed
    #    with flavor ... capable of being cellared for decades".
    bench_citation = CITATION + " (narrative-derived)"
    ingest.upsert_benchmark(
        conn, region_ctx, "wine.acidity",
        typical=4.0, low=3.5, high=5.0,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, region_ctx, "wine.tannin",
        typical=4.0, low=3.0, high=4.5,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, region_ctx, "wine.body",
        typical=4.0, low=3.5, high=4.5,
        confidence="medium", source_citation=bench_citation)
