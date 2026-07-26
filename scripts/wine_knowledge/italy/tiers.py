"""Italian classification-tier loader — authored IN-SESSION from The Wine Bible.

Creates Italy's two top legal quality-pyramid tiers, DOCG and DOC, as
`classification_tier` entities and chains them with the `outranks` verb
(tier -> tier only, per vocab.DIRECTION): DOCG OUTRANKS DOC. All prose is
extracted from the Italy chapter of `winebible.md` (2nd ed., Karen MacNeil,
the "pyramid of Italy's wines" passage, lines ~15307-15409); nothing here is
web-sourced or paid-API generated, and every context carries a real CITATION.

Italy's pyramid, apex -> base: DOCG > DOC > IGT > Vino da Tavola. The book is
explicit that these are DESIGNATIONS of place/prestige, NOT a vineyard
classification like Burgundy's Grand/Premier Cru — but for our taxonomy the
legal ranking is still an `outranks` ladder. Per the spec, this module builds
ONLY the two tier entities plus the single DOCG->DOC `outranks` edge; region ->
tier `classified_under` edges belong to the Piedmont/Tuscany region loaders
(later tasks), NOT here.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest

CITATION = "Wine Bible 2e, Italy (classification)"

# The two top tiers of Italy's legal pyramid, ordered HIGHEST -> LOWEST.
# The full pyramid is DOCG > DOC > IGT > Vino da Tavola; per YAGNI we model
# only the two prestige tiers relevant to our in-stock catalogue.
_DOCG_SLUG = "italy-docg"
_DOC_SLUG = "italy-doc"

_TIERS = (
    ("Italy DOCG", _DOCG_SLUG, {
        "short": (
            "Apex of Italy's legal quality pyramid — Denominazione di Origine "
            "Controllata e Garantita ('controlled and guaranteed'). The top "
            "designation, above DOC, IGT and Vino da Tavola; reserved for wine "
            "zones of exceptional quality and renown."
        ),
        "full": (
            "DOCG — Denominazione di Origine Controllata e Garantita ("
            "'Denomination of Controlled and Guaranteed Origin') — sits at the "
            "APEX of Italy's four-level quality pyramid: DOCG at the top, then "
            "DOC, then IGT, with Vino da Tavola (table wine) as the broad base. "
            "The government enacted the DOCG in 1980 for wines of exceptional "
            "quality and renown, with regulations even stricter than the DOC; "
            "the first four were Brunello di Montalcino and Vino Nobile di "
            "Montepulciano in Tuscany and Barolo and Barbaresco in Piedmont, all "
            "designated in 1980. By 2013 there were seventy-three DOCGs. Note the "
            "book's caveat: the word garantita ('guaranteed') is misleading — a "
            "DOCG is applied to an entire region, so both the greatest and the "
            "worst wine of that region may carry it; the designation flags the "
            "PLACE's recognised quality/prestige, not any single wine, and it is "
            "not a vineyard classification like Burgundy's Grand/Premier Cru. "
            "DOCG OUTRANKS DOC."
        ),
        "attrs": {
            "rank": 1,
            "italian": "Denominazione di Origine Controllata e Garantita",
            "acronym": "DOCG",
            "meaning": "controlled and guaranteed origin",
            "enacted": 1980,
            "first_four": ["Brunello di Montalcino", "Vino Nobile di Montepulciano",
                           "Barolo", "Barbaresco"],
            "count_2013": 73,
            "pyramid": ["DOCG", "DOC", "IGT", "Vino da Tavola"],
            "outranks": _DOC_SLUG,
            "caveat": "applies to a whole region, not a single wine; not a "
                      "vineyard classification like Burgundy",
        },
    }),
    ("Italy DOC", _DOC_SLUG, {
        "short": (
            "Second tier of Italy's legal pyramid — Denominazione di Origine "
            "Controllata ('controlled origin'). Below DOCG, above IGT and Vino "
            "da Tavola; the original 1963 quality-zone designation."
        ),
        "full": (
            "DOC — Denominazione di Origine Controllata ('Denomination of "
            "Controlled Origin') — is the tier BELOW DOCG in Italy's quality "
            "pyramid (DOCG > DOC > IGT > Vino da Tavola). The DOC laws, enacted "
            "in 1963, were the original regulations that stipulated standards for "
            "certain types of wine and provoked Italy's wine revolution; the "
            "first wine given DOC status was the Tuscan white Vernaccia di San "
            "Gimignano, in 1966. More than 330 wine zones have been designated as "
            "DOCs. The DOC's stipulations were built around traditional practice "
            "for each region, which famously chafed innovative winemakers and "
            "gave rise to the Super Tuscans (wines that, breaking DOC rules, "
            "could officially be sold only as humble Vino da Tavola). Like DOCG, "
            "DOC marks a place recognised for quality or prestige rather than "
            "guaranteeing any individual wine. DOC is OUTRANKED BY DOCG and "
            "itself outranks IGT."
        ),
        "attrs": {
            "rank": 2,
            "italian": "Denominazione di Origine Controllata",
            "acronym": "DOC",
            "meaning": "controlled origin",
            "enacted": 1963,
            "first_wine": "Vernaccia di San Gimignano (1966)",
            "zone_count": 330,
            "pyramid": ["DOCG", "DOC", "IGT", "Vino da Tavola"],
            "outranked_by": _DOCG_SLUG,
        },
    }),
)


def load(conn) -> None:
    # Build the two tier entities by stable slug (upsert_entity is idempotent),
    # author each tier's book-cited validated context, then chain the single
    # DOCG -> DOC `outranks` edge (tier -> tier; add_relationship validates the
    # direction and is INSERT-OR-IGNORE idempotent).
    ids: dict[str, int] = {}
    for name, slug, ctx in _TIERS:
        tid = ingest.upsert_entity(conn, "classification_tier", name, slug)
        ingest.upsert_context(
            conn, tid, "wine",
            short=ctx["short"], full=ctx["full"],
            status="validated", source_citation=CITATION, confidence="high",
            attributes=json.dumps(ctx["attrs"]),
        )
        ids[slug] = tid

    # DOCG OUTRANKS DOC — the one edge this task owns.
    ingest.add_relationship(conn, ids[_DOCG_SLUG], ids[_DOC_SLUG], "outranks")
