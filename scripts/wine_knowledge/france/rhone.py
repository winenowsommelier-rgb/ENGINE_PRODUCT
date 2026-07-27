"""Rhône sub-chapter loader — authored IN-SESSION from the Wine Bible.

All prose is extracted from the RHÔNE chapter (lines ~11281–12469) of
`winebible.md`; nothing here is web-sourced or paid-API generated. Every
context/benchmark carries a real CITATION (never a 'legacy:' marker), and we
link only to the existing region/grape skeleton via `_helpers` (which RAISES on
a missing entity rather than blind-creating one).

Canonical region: there is a duplicate "Rhône Valley" region entity in the
skeleton. `_helpers.find_region(conn, "Rhône")` returns the LOWEST-id match, so
we target the canonical "Rhône" and never create a third region.

We OVERWRITE any pre-existing legacy-marked Rhône region context with a
book-cited, status='validated' one — that is the intended upgrade.

Grapes: syrah, grenache, viognier and mourvedre are all confirmed present, so
all four are linked.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.france import _helpers

CITATION = "Wine Bible 2e, France/Rhône"

# All four confirmed present as entities in the rhone_db skeleton.
_GRAPES = ("syrah", "grenache", "viognier", "mourvedre")


def load(conn) -> None:
    # Canonical Rhône region only (lowest id); the "Rhône Valley" duplicate is
    # ignored, and no third region is ever created.
    rid = _helpers.find_region(conn, "Rhône")

    # 1. Region context — the big picture from the book, OVERWRITING any legacy
    #    context with a book-cited, validated one.
    region_full = (
        "The Rhône Valley in southeastern France takes its name from the Rhône "
        "River and is one of France's oldest and greatest regions, prized for the "
        "uninhibited, almost savage flavors of its top reds. It divides into two "
        "parts so distinct that, but for the river, they would be considered "
        "separate regions. The NORTHERN RHÔNE is smaller and a bit more prestigious, "
        "with a continental climate and steep, terraced granite and slate slopes: its "
        "only red grape is SYRAH, making darkly savage, spicy, white-peppery, "
        "leather-and-blackberry reds (Côte-Rôtie and Hermitage are the most "
        "renowned), while its whites are VIOGNIER (the exotically perfumed grape of "
        "Condrieu and Château-Grillet) or a marsanne–roussanne blend. The SOUTHERN "
        "RHÔNE is larger, better known and Mediterranean in climate — sunny, "
        "herb-scented, swept by the cold Mistral wind — and its reds are almost "
        "always BLENDS of many grapes led by GRENACHE, with syrah for color and "
        "spice and MOURVÈDRE for structure (the GSM-style blend); its best-known "
        "appellation is Châteauneuf-du-Pape, famous for vineyards carpeted in large "
        "rounded stones (galets) that store the sun's heat. The everyday "
        "Côtes-du-Rhône, staples of French cafés, come mostly from the south. Across "
        "the valley twenty-seven varieties are permitted, but only a handful matter; "
        "each appellation specifies which grapes may be used, and winemakers blend "
        "their own 'personal recipe' from them."
    )
    region_short = (
        "Southeastern France's great red region in two distinct halves: the "
        "continental, granite Northern Rhône (single-grape SYRAH reds — Côte-Rôtie, "
        "Hermitage; viognier whites — Condrieu) and the Mediterranean Southern Rhône "
        "(grenache-led GSM blends — Châteauneuf-du-Pape, on galets stones)."
    )
    region_attrs = {
        "structure": "Northern Rhône (single-grape syrah reds) vs Southern Rhône "
                     "(grenache-based multi-grape blends)",
        "north": {
            "climate": "continental",
            "soil": "steep terraced granite and slate",
            "red_grape": "syrah (sole permitted red)",
            "white_grapes": ["viognier (Condrieu, Château-Grillet)",
                             "marsanne", "roussanne"],
            "famous_reds": ["Côte-Rôtie", "Hermitage", "Cornas"],
        },
        "south": {
            "climate": "Mediterranean (hot, swept by Le Mistral)",
            "soil": "galets (large rounded stones) over clay/sandy-limestone/gravel",
            "lead_red_grape": "grenache",
            "blend": "GSM — grenache + syrah + mourvèdre (+ cinsaut)",
            "famous_reds": ["Châteauneuf-du-Pape", "Gigondas", "Vacqueyras"],
        },
        "everyday_wine": "Côtes-du-Rhône (mostly from the south)",
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=region_short, full=region_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(region_attrs),
    )

    # 2. Key sub-region / appellation contexts, each authored from the book.
    #    find_or_create_subregion returns the existing id where one is present.
    north_full = (
        "The Northern Rhône is the smaller, more prestigious half, with a "
        "continental climate (hard, cold, wet winters; hot summers) cooled by the "
        "icy Mistral. Its best vineyards cling to narrow, rocky terraces on steep "
        "slopes of poor, shallow granite and slate above the river, held in place by "
        "hand-built stone walls. Its only permitted red grape is SYRAH, which here "
        "makes some of the world's most intense reds — darkly savage and dramatic, "
        "with gamy, meaty, leathery flavors and a signature note of white pepper, "
        "over black plum, blackberry and blueberry fruit, their concentration owed "
        "partly to very old, low-yielding vines. Its rare, prized whites are made "
        "from viognier (Condrieu, Château-Grillet) or from marsanne and roussanne "
        "(Hermitage Blanc and the like); no rosé is made in the north."
    )
    north_id = _helpers.find_or_create_subregion(conn, "Northern Rhône", rid, slug="northern-rhone")
    north_ctx = ingest.upsert_context(
        conn, north_id, "wine",
        short="Continental, steep-granite northern half; SYRAH the only red — "
              "intense, savage, white-peppery, leathery; viognier and "
              "marsanne/roussanne whites; no rosé.",
        full=north_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "climate": "continental", "soil": "shallow granite and slate terraces",
            "red_grape": "syrah", "white_grapes": ["viognier", "marsanne", "roussanne"],
            "character": "savage, white pepper, leather, gamy, black fruit",
            "key_appellations": ["Côte-Rôtie", "Hermitage", "Cornas", "Condrieu"],
        }),
    )

    cr_full = (
        "Côte-Rôtie ('roasted slope'), the northernmost northern-Rhône appellation, "
        "makes some of the Rhône's most thrilling reds — dramatic, incisive, earthy "
        "and gamy, with pepper pacing the glass 'like a caged animal'. All Côte-Rôtie "
        "is red and based on SYRAH; no white is made. Its best vineyards sit on "
        "precipitous, due-south granite slopes (grades up to 60 degrees). It is one "
        "of only two top French reds (with Hermitage) that may by law blend in a "
        "little white grape — up to 20 percent VIOGNIER, though most producers use "
        "under 5 percent — whose creamy texture softens syrah's edges and adds exotic "
        "aroma. Its two famous slopes are the more tannic, powerful Côte Brune and "
        "the more elegant, racy Côte Blonde."
    )
    cr_id = _helpers.find_or_create_subregion(conn, "Côte-Rôtie", rid, slug="cote-rotie")
    cr_ctx = ingest.upsert_context(
        conn, cr_id, "wine",
        short="Northernmost northern-Rhône red on steep south-facing granite; "
              "syrah-based, may blend up to 20% viognier; dramatic, peppery, gamy; "
              "Côte Brune (powerful) vs Côte Blonde (elegant).",
        full=cr_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "part_of": "Northern Rhône", "style": "red",
            "red_grape": "syrah", "may_blend": "up to 20% viognier (usually <5%)",
            "slopes": {"Côte Brune": "more tannic/powerful",
                       "Côte Blonde": "more elegant/racy"},
        }),
    )

    herm_full = (
        "Hermitage is a single ~1,000-foot hill of just 300 acres of mostly "
        "south-facing vineyards on granite interspersed with gravel, flint and "
        "limestone — once France's costliest red, so esteemed that even top Bordeaux "
        "were secretly 'hermitaged' (blended with Hermitage) for depth and color. "
        "Along with Côte-Rôtie it is the most revered red of the northern Rhône: a "
        "leathery, meaty red of blackberry and black cherry over smoky, damp-earth "
        "flavors, made from SYRAH (up to 15 percent marsanne/roussanne is allowed but "
        "rarely used). The rare white Hermitage Blanc, from marsanne and roussanne, "
        "is a full-bodied, bold, rich, almost 'masculine' white."
    )
    herm_id = _helpers.find_or_create_subregion(conn, "Hermitage", rid, slug="hermitage")
    herm_ctx = ingest.upsert_context(
        conn, herm_id, "wine",
        short="Single granite hill, ~300 acres; syrah-based, leathery/meaty, "
              "profoundly ageworthy — the northern Rhône's most revered red; bold "
              "marsanne/roussanne whites.",
        full=herm_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "part_of": "Northern Rhône", "styles": ["red", "white"],
            "red_grape": "syrah",
            "white_grapes": ["marsanne", "roussanne"],
            "character": "leathery, meaty, black-fruit, powerful, long-lived",
        }),
    )

    condrieu_full = (
        "Condrieu is the northern Rhône's most famous white-wine appellation, made "
        "exclusively from VIOGNIER (its tiny enclave Château-Grillet, one of France's "
        "smallest appellations at 8.6 acres, is the same). Viognier here is one of "
        "the most sensual white grapes in the world, exploding with heady aromas of "
        "honeysuckle, peaches, white melon, lychee, orange peel and gardenia over a "
        "texture as soothing as whipped cream — but it is fickle, site-sensitive, low "
        "in acidity and hard to grow, and in careless hands can taste like cheap "
        "perfume."
    )
    condrieu_id = _helpers.find_or_create_subregion(conn, "Condrieu", rid, slug="condrieu")
    condrieu_ctx = ingest.upsert_context(
        conn, condrieu_id, "wine",
        short="Northern Rhône's famed white appellation; 100% viognier — perfumed, "
              "honeysuckle/peach/lychee, creamy-textured, low-acid.",
        full=condrieu_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "part_of": "Northern Rhône", "style": "white",
            "grape": "viognier",
            "character": "perfumed, honeysuckle/peach/lychee, creamy, low acidity",
        }),
    )

    south_full = (
        "The Southern Rhône is the larger, better-known half, Mediterranean in "
        "climate — sunny, herb-scented, olive-growing, and swept by the savage cold "
        "Mistral wind that cools the vines and concentrates the grapes. Its soils are "
        "fundamentally different from the granite north: in many parts vines grow in "
        "a carpet of large rounded riverbed stones (galets), elsewhere in clay, sandy "
        "limestone or gravel. GRENACHE — not syrah — is the leading red grape, and "
        "southern reds are almost always BLENDS of many varieties (grenache led, with "
        "syrah for color and spice and mourvèdre for structure and cinsaut), because "
        "in the hot dry climate no single grape holds enough focus on its own. Its "
        "great appellation is Châteauneuf-du-Pape, followed by Gigondas and "
        "Vacqueyras; Tavel is the capital of rosé; and most Côtes-du-Rhône comes from "
        "here."
    )
    south_id = _helpers.find_or_create_subregion(conn, "Southern Rhône", rid, slug="southern-rhone")
    south_ctx = ingest.upsert_context(
        conn, south_id, "wine",
        short="Larger, Mediterranean southern half; grenache-led multi-grape (GSM) "
              "blends on galets stones; Châteauneuf-du-Pape, Gigondas, Vacqueyras, "
              "Tavel rosé, most Côtes-du-Rhône.",
        full=south_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "climate": "Mediterranean (Le Mistral)",
            "soil": "galets (rounded stones) over clay/sandy-limestone/gravel",
            "lead_red_grape": "grenache",
            "blend": "GSM — grenache + syrah + mourvèdre (+ cinsaut)",
            "key_appellations": ["Châteauneuf-du-Pape", "Gigondas", "Vacqueyras",
                                 "Tavel (rosé)"],
        }),
    )

    cnp_full = (
        "Châteauneuf-du-Pape ('new castle of the Pope'), just north of Avignon, is "
        "the southern Rhône's greatest and best-known appellation — large by Rhône "
        "standards (~8,000 acres, versus Hermitage's 300). Its most startling "
        "feature is its 'soil' of smooth rolled stones (GALETS, or pudding-stones), "
        "remnants of ancient Alpine glaciers that carpet many vineyards with no "
        "visible dirt; they retain the sun's heat and hasten ripening while holding "
        "moisture below. About 95 percent of the wine is red, drawn from the "
        "Châteauneuf 'thirteen' permitted grapes but based on GRENACHE (grown until "
        "sweetly, jammily ripe), blended with SYRAH for color and spice and "
        "MOURVÈDRE for structure. By law it carries the lowest yields in France, and "
        "little new oak is used, so the wines taste of stones and terroir: "
        "penetrating, gamy, wild reds with an edge of tar, leather and rough stone. "
        "Its warm Mediterranean site and ripe grenache make it notably full-bodied "
        "and high in alcohol."
    )
    cnp_id = _helpers.find_or_create_subregion(conn, "Châteauneuf-du-Pape", rid, slug="chateauneuf-du-pape")
    cnp_ctx = ingest.upsert_context(
        conn, cnp_id, "wine",
        short="Southern Rhône's great appellation on galets stones; grenache-based "
              "GSM blend, lowest yields in France, little oak; full-bodied, "
              "high-alcohol, gamy, terroir-driven reds.",
        full=cnp_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "part_of": "Southern Rhône", "style": "mostly red (~95%)",
            "soil": "galets (rounded pudding-stones) over clay/sandy-limestone/gravel",
            "lead_red_grape": "grenache",
            "blend": "grenache (base) + syrah + mourvèdre; 'thirteen' permitted grapes",
            "character": "full-bodied, high-alcohol, gamy, tar/leather/stone",
            "note": "lowest legal yields in France; little new oak",
        }),
    )

    # 3. Link the four confirmed grapes to the Rhône (grape -> region 'grown_in').
    for slug in _GRAPES:
        _helpers.link_grape(conn, slug, rid)

    # 4. Benchmarks — only where the book's sensory language clearly supports a
    #    value, on the project's 1–5 gauge. Narrative-derived, so
    #    confidence='medium' with an explicit citation suffix.
    bench_citation = CITATION + " (narrative-derived)"

    # Northern-Rhône syrah (Hermitage): "some of the world's most intense wines",
    # dense/powerful, tannin raised by whole-cluster/stem inclusion, long-lived ->
    # full body, high tannin.
    ingest.upsert_benchmark(
        conn, herm_ctx, "wine.body",
        typical=4.5, low=4.0, high=5.0,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, herm_ctx, "wine.tannin",
        typical=4.5, low=4.0, high=5.0,
        confidence="medium", source_citation=bench_citation)

    # Châteauneuf-du-Pape: grenache "grown until sweetly ripe", hot Mediterranean
    # site -> full-bodied and high in alcohol.
    ingest.upsert_benchmark(
        conn, cnp_ctx, "wine.body",
        typical=4.5, low=4.0, high=5.0,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, cnp_ctx, "wine.alcohol",
        typical=4.5, low=4.0, high=5.0,
        confidence="medium", source_citation=bench_citation)
