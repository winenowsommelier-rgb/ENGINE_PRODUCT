"""Classification-tier loader for the Plan-3c chapters — authored IN-SESSION
from The Wine Bible (2nd ed., Karen MacNeil; "THE RIPENESS LEVELS" and "THE
MODERN (VDP) SYSTEM" in the Germany chapter, and the Vinea Wachau categories in
the Austria chapter). Nothing here is web-sourced or paid-API generated.

This chapter adds TWO more ladder shapes to the graph, bringing the running
tally to five distinct kinds of hierarchy:

  France  — ranks VINEYARDS      (Grand Cru > Premier Cru > ...)
  Italy   — ranks PLACES         (DOCG > DOC)
  Spain   — ranks TIME IN OAK    (Gran Reserva > Reserva > Crianza)
  Germany — ranks GRAPE RIPENESS (Kabinett > Spätlese > Auslese > BA > TBA)
  Wachau  — ranks ALCOHOL/RIPENESS, and is set by a PRODUCERS' ASSOCIATION
            rather than by law (Smaragd > Federspiel > Steinfeder)

Two deliberate modelling decisions worth reading before editing:

1. **EISWEIN SITS OUTSIDE THE PRÄDIKAT LADDER.** The book lists it alongside
   the ripeness levels, but eiswein is defined by grapes FROZEN NATURALLY ON
   THE VINE, not by a rung of must weight — it is a harvest method, and a BA
   or TBA is not "more eiswein" than a Kabinett. So eiswein is created as a
   tier entity with NO `outranks` edge. Chaining it would assert a rank the
   source does not give it.

2. **THE VDP IS NOT A RUNG, IT IS A DIFFERENT SYSTEM.** More than two hundred
   top estates abandoned the traditional ripeness thinking for a modern,
   vineyard-based system. It is therefore a standalone unranked entity, and
   NO edge connects it to the Prädikat ladder — they are alternative ways of
   organising the same wines, not steps in one hierarchy.

As in Plan 3b, region loaders wire `classified_under` ONLY to PLACE-type
designations. Ripeness and alcohol tiers are properties of a WINE, not of a
region: "Mosel classified_under Trockenbeerenauslese" would assert that
everything from the Mosel is a TBA, which is false.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest

PRADIKAT_CITATION = "Wine Bible 2e, Germany (ripeness levels)"
VDP_CITATION = "Wine Bible 2e, Germany (the modern VDP system)"
WACHAU_CITATION = "Wine Bible 2e, Austria/Wachau (Vinea Wachau categories)"

# --- Germany ripeness ladder: Kabinett -> Spätlese -> Auslese -> BA -> TBA ---
KABINETT_SLUG = "germany-kabinett"
SPATLESE_SLUG = "germany-spatlese"
AUSLESE_SLUG = "germany-auslese"
BA_SLUG = "germany-beerenauslese"
TBA_SLUG = "germany-trockenbeerenauslese"

# --- Wachau alcohol ladder: Smaragd -> Federspiel -> Steinfeder --------------
SMARAGD_SLUG = "wachau-smaragd"
FEDERSPIEL_SLUG = "wachau-federspiel"
STEINFEDER_SLUG = "wachau-steinfeder"

# --- unranked, standalone designations (NO outranks edges) ------------------
EISWEIN_SLUG = "germany-eiswein"
VDP_SLUG = "germany-vdp"

# Ordered HIGHEST -> LOWEST ripeness. NOTE the ordering convention: `outranks`
# runs from the RIPER/rarer wine down, matching Spain's Gran Reserva -> Crianza.
_PRADIKAT_TIERS = (
    ("Trockenbeerenauslese", TBA_SLUG, {
        "short": (
            "The richest, sweetest, rarest and most expensive of all German "
            "wines — made from individual grapes shrivelled to raisins by "
            "botrytis, in exceptional years only."
        ),
        "full": (
            "Trockenbeerenauslese — literally 'dry berry' (trocken beeren) "
            "selected harvest, TBA for short — sits at the APEX of Germany's "
            "traditional ripeness hierarchy. TBAs are the richest, sweetest, "
            "rarest and most expensive of all German wines, produced only in "
            "exceptional years from individual grapes shrivelled to raisins by "
            "botrytis. It takes one person a full day to select and pick enough "
            "grapes for just one bottle. Because of the enormously concentrated "
            "sugar the grapes have difficulty fermenting, so many TBAs are no "
            "more than 6 percent alcohol — less than half the alcohol of, say, "
            "Sauternes. TBAs are absolutely mesmerising in their intensity and "
            "exquisite balance, and are rightfully pricey. TROCKENBEERENAUSLESE "
            "OUTRANKS BEERENAUSLESE."
        ),
        "attrs": {
            "rank": 1, "ladder": "ripeness", "acronym": "TBA",
            "meaning": "dry berry selected harvest",
            "sweetness": "always sweet — the sweetest German category",
            "botrytis": "grapes shrivelled to raisins by Botrytis cinerea",
            "alcohol": "often no more than 6%",
            "rarity": "exceptional years only; a full day's picking per bottle",
            "outranks": BA_SLUG,
        },
    }),
    ("Beerenauslese", BA_SLUG, {
        "short": (
            "Rare, costly wines from very ripe individual grapes selected by "
            "hand, usually affected by noble rot — always sweet, with a deep, "
            "honeyed richness."
        ),
        "full": (
            "Beerenauslese — literally 'berry' (beeren) selected harvest, "
            "conveniently called BA for short — is the second-highest rung of "
            "Germany's traditional ripeness hierarchy. Beerenauslesen are rare "
            "and costly wines made from very ripe individual grapes selected by "
            "hand. Usually BA grapes have been affected by noble rot, Botrytis "
            "cinerea, giving them a deep, honeyed richness. BAs are always "
            "sweet. BEERENAUSLESE OUTRANKS AUSLESE and is OUTRANKED BY "
            "TROCKENBEERENAUSLESE."
        ),
        "attrs": {
            "rank": 2, "ladder": "ripeness", "acronym": "BA",
            "meaning": "berry selected harvest",
            "sweetness": "always sweet",
            "botrytis": "usually affected by noble rot — deep, honeyed richness",
            "outranks": AUSLESE_SLUG, "outranked_by": TBA_SLUG,
        },
    }),
    ("Auslese", AUSLESE_SLUG, {
        "short": (
            "'Select' — made from very ripe grapes harvested in select bunches, "
            "generally only in the best, warmest years. Most are lush and today "
            "often fairly sweet."
        ),
        "full": (
            "Auslese — aus means 'select' — is made from very ripe grapes "
            "harvested in select bunches, another step upward in richness and "
            "intensity. Auslesen can generally be made only in the best years, "
            "those sufficiently warm, and picking individual bunches makes the "
            "wines expensive. Most auslesen are lush and today are often fairly "
            "sweet, though even two decades ago most were made in a lighter, "
            "more elegant style — intensely flavoured but not syrupy. Both "
            "styles can be found today, and Germans sometimes drink them on "
            "Sunday afternoons as an aperitif with hard cheeses. AUSLESE "
            "OUTRANKS SPÄTLESE and is OUTRANKED BY BEERENAUSLESE."
        ),
        "attrs": {
            "rank": 3, "ladder": "ripeness", "meaning": "select harvest",
            "harvest": "very ripe grapes picked in select bunches",
            "vintage_policy": "best, sufficiently warm years only",
            "sweetness": "often fairly sweet today; historically lighter and "
                         "more elegant — both styles exist",
            "outranks": SPATLESE_SLUG, "outranked_by": BA_SLUG,
        },
    }),
    ("Spätlese", SPATLESE_SLUG, {
        "short": (
            "'Late' harvest — fully ripened grapes picked after the kabinett "
            "harvest, giving greater fruit intensity and slightly fuller body. "
            "May be dry or off-dry."
        ),
        "full": (
            "Spätlese — spät means 'late' — describes wines based on grapes "
            "harvested later than those for kabinett. They are fully ripened "
            "and make wines with greater fruit intensity and a slightly fuller "
            "body than kabinett wines. A spätlese may be dry or, like kabinett, "
            "off-dry; even those with some sweetness usually do not TASTE sweet, "
            "because the high level of acidity in the grapes offsets any "
            "impression of sweetness. SPÄTLESE OUTRANKS KABINETT and is "
            "OUTRANKED BY AUSLESE."
        ),
        "attrs": {
            "rank": 4, "ladder": "ripeness", "meaning": "late harvest",
            "body": "slightly fuller than kabinett",
            "sweetness": "dry or off-dry; high acidity offsets any sweetness",
            "outranks": KABINETT_SLUG, "outranked_by": AUSLESE_SLUG,
        },
    }),
    ("Kabinett", KABINETT_SLUG, {
        "short": (
            "The entry rung — made from grapes picked during the normal "
            "harvest; typically light-bodied, low in alcohol and usually dry or "
            "off-dry. Easy to drink and food friendly."
        ),
        "full": (
            "Kabinett is the ENTRY rung of Germany's traditional ripeness "
            "hierarchy: a wine made from grapes picked during the normal "
            "harvest, typically light-bodied, low in alcohol and usually dry or "
            "off-dry. Kabinetts are easy to drink and food friendly, and German "
            "wine lovers typically drink them as casual dinner wines. KABINETT "
            "IS OUTRANKED BY SPÄTLESE."
        ),
        "attrs": {
            "rank": 5, "ladder": "ripeness",
            "harvest": "normal harvest timing",
            "body": "typically light-bodied, low in alcohol",
            "sweetness": "usually dry or off-dry",
            "role": "casual dinner wine — easy drinking and food friendly",
            "outranked_by": SPATLESE_SLUG,
        },
    }),
)

# Vinea Wachau categories, HIGHEST -> LOWEST. Defined by ALCOHOL and set by a
# producers' association, not by law — a distinct shape from every other tier.
_WACHAU_TIERS = (
    ("Smaragd", SMARAGD_SLUG, {
        "short": (
            "The top Vinea Wachau category — the most physiologically ripe "
            "wines and therefore considered the best. Minimum 12.5% alcohol; "
            "most are higher."
        ),
        "full": (
            "Smaragd is the top of the three Vinea Wachau categories. The word "
            "smaragd means 'emerald' and is also the name of a bright green "
            "lizard that suns itself in the vineyards of the Wachau. Smaragd "
            "wines are the most physiologically ripe and are therefore "
            "considered the best; they must have a minimum of 12.5 percent "
            "alcohol, and most are higher. SMARAGD OUTRANKS FEDERSPIEL."
        ),
        "attrs": {
            "rank": 1, "ladder": "alcohol/ripeness (producer association)",
            "min_alcohol": "12.5% (most are higher)",
            "meaning": "emerald — also a green lizard of the Wachau vineyards",
            "note": "most physiologically ripe; considered the best",
            "outranks": FEDERSPIEL_SLUG,
        },
    }),
    ("Federspiel", FEDERSPIEL_SLUG, {
        "short": (
            "The middle Vinea Wachau category — natural, unchaptalised wines of "
            "at least 11.5 but no more than 12.5 percent alcohol."
        ),
        "full": (
            "Federspiel is the middle of the three Vinea Wachau categories: "
            "natural, unchaptalised wines with at least 11.5 but no more than "
            "12.5 percent alcohol. The name derives from the local sport of "
            "falconry. FEDERSPIEL OUTRANKS STEINFEDER and is OUTRANKED BY "
            "SMARAGD."
        ),
        "attrs": {
            "rank": 2, "ladder": "alcohol/ripeness (producer association)",
            "alcohol_range": "11.5% - 12.5%",
            "chaptalisation": "none — natural, unchaptalised",
            "meaning": "from the local sport of falconry",
            "outranks": STEINFEDER_SLUG, "outranked_by": SMARAGD_SLUG,
        },
    }),
    ("Steinfeder", STEINFEDER_SLUG, {
        "short": (
            "The lightest Vinea Wachau category — natural, unchaptalised wines "
            "of no more than 11.5 percent alcohol, described by the association "
            "as 'dainty'."
        ),
        "full": (
            "Steinfeder is the lightest of the three Vinea Wachau categories: "
            "natural, unchaptalised wines with no more than 11.5 percent "
            "alcohol. Steinfeder is the name of a local strain of feathery "
            "grass, and the association poetically describes these wines as "
            "'dainty'. STEINFEDER IS OUTRANKED BY FEDERSPIEL."
        ),
        "attrs": {
            "rank": 3, "ladder": "alcohol/ripeness (producer association)",
            "max_alcohol": "11.5%",
            "chaptalisation": "none — natural, unchaptalised",
            "meaning": "a local strain of feathery grass; wines described as "
                       "'dainty'",
            "outranked_by": FEDERSPIEL_SLUG,
        },
    }),
)

# Standalone designations. Each gets an entity + cited context and NO edge.
_UNRANKED_TIERS = (
    ("Eiswein", EISWEIN_SLUG, PRADIKAT_CITATION, {
        "short": (
            "'Ice wine' — made from very ripe grapes frozen NATURALLY on the "
            "vine and pressed while frozen, yielding juice miraculously high in "
            "both sweetness and acidity. A harvest method, not a ripeness rung."
        ),
        "full": (
            "Eiswein — literally 'ice wine' — is made from very ripe, frozen "
            "grapes picked, often at daybreak, by workers wearing gloves so "
            "their hands do not freeze. As the frozen grapes are pressed, the "
            "sweet, high-acid, concentrated juice is separated from the ice (the "
            "water in the grapes); the wine is made solely from that "
            "concentrated juice, the ice being thrown away, and is miraculously "
            "high in BOTH sweetness and acidity, making drinking it an ethereal "
            "sensation. Eiswein grapes must be frozen NATURALLY on the vine — "
            "Austria and Canada, the two other countries famous for eiswein, "
            "also make it this way, whereas elsewhere 'eiswein' is sometimes "
            "produced by freezing grapes in a commercial freezer, which purists "
            "consider cheating. Note that eiswein is defined by this harvest "
            "method rather than by a rung of grape ripeness, so it is NOT "
            "chained into the kabinett-to-TBA ladder. Ironically, the climate "
            "change that has benefited German winemakers so much may eventually "
            "harm eiswein production: under warmer conditions botrytis may "
            "arrive before temperatures turn cold enough, and the mould "
            "consumes most of the water that would otherwise freeze."
        ),
        "attrs": {
            "ladder": "none — defined by harvest method, not ripeness rank",
            "meaning": "ice wine",
            "requirement": "grapes must freeze NATURALLY on the vine",
            "profile": "high in both sweetness and acidity",
            "also_made_in": ["Austria", "Canada"],
            "risk": "climate change may pre-empt the freeze with botrytis",
        },
    }),
    ("VDP", VDP_SLUG, VDP_CITATION, {
        "short": (
            "Verband Deutscher Prädikatsweingüter — an association of 200+ top "
            "German estates that replaced traditional ripeness thinking with a "
            "modern, vineyard-based system. An alternative system, not a rung."
        ),
        "full": (
            "With the turning of the twenty-first century many growers, "
            "including more than two hundred of the best and most prestigious "
            "estates of Germany, abandoned the traditional way of thinking "
            "about, organising and categorising German wines. In its place they "
            "devised a modern system that they believe better reflects "
            "Germany's new climatic reality — a reality in which, thanks to "
            "climate change, virtually every vintage now yields ripe grapes, "
            "where in the 1960s and 1970s only two or three vintages a decade "
            "did. Most of these wineries belong to a group called the VDP "
            "(Verband Deutscher Prädikatsweingüter), and all VDP members "
            "display the VDP logo — a stylised eagle bearing a cluster of "
            "grapes — prominently on the bottle, so they are easy to identify. "
            "The VDP is an ALTERNATIVE organising system rather than a rung "
            "within the traditional ripeness hierarchy, so no outranks edge "
            "connects it to the kabinett-to-TBA ladder."
        ),
        "attrs": {
            "ladder": "none — an alternative system, not a rung",
            "german": "Verband Deutscher Prädikatsweingüter",
            "members": "200+ of Germany's best and most prestigious estates",
            "basis": "modern, vineyard-based; replaces traditional ripeness "
                     "categorisation",
            "mark": "stylised eagle bearing a cluster of grapes on the bottle",
            "rationale": "better reflects Germany's warmer climatic reality",
        },
    }),
)


def _load_ladder(conn, tiers, citation) -> dict[str, int]:
    """Create each tier entity + its cited validated context, then chain
    ADJACENT pairs with `outranks` (highest -> lowest, as ordered)."""
    ids: dict[str, int] = {}
    for name, slug, ctx in tiers:
        tid = ingest.upsert_entity(conn, "classification_tier", name, slug)
        ingest.upsert_context(
            conn, tid, "wine",
            short=ctx["short"], full=ctx["full"],
            status="validated", source_citation=citation, confidence="high",
            attributes=json.dumps(ctx["attrs"]),
        )
        ids[slug] = tid

    slugs = [slug for _, slug, _ in tiers]
    for higher, lower in zip(slugs, slugs[1:]):
        ingest.add_relationship(conn, ids[higher], ids[lower], "outranks")
    return ids


def load(conn) -> None:
    # Two SEPARATE ladders — no edge is authored between them (a German
    # Kabinett and a Wachau Steinfeder are not comparable rungs).
    _load_ladder(conn, _PRADIKAT_TIERS, PRADIKAT_CITATION)
    _load_ladder(conn, _WACHAU_TIERS, WACHAU_CITATION)

    # Standalone designations: entity + cited context, and NO outranks edge.
    for name, slug, citation, ctx in _UNRANKED_TIERS:
        tid = ingest.upsert_entity(conn, "classification_tier", name, slug)
        ingest.upsert_context(
            conn, tid, "wine",
            short=ctx["short"], full=ctx["full"],
            status="validated", source_citation=citation, confidence="high",
            attributes=json.dumps(ctx["attrs"]),
        )
