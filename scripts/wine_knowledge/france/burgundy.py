"""Burgundy sub-chapter loader — authored IN-SESSION from the Wine Bible.

All prose is extracted from the BURGUNDY chapter (lines ~9658–10974, plus the
Beaujolais chapter ~10974–11281) of `winebible.md`; nothing here is
web-sourced or paid-API generated. Every context/benchmark carries a real
CITATION (never a 'legacy:' marker), and we link only to the existing
region/grape skeleton via `_helpers` (which RAISES on a missing entity rather
than blind-creating one).

This module is the spec's recursive-nesting stress test (§4.4): Burgundy's
quality is a four-tier LADDER — Regional -> Village -> Premier Cru -> Grand
Cru — modelled as four `classification_tier` entities chained by the
`outranks` verb (tier -> tier only, per vocab.DIRECTION). We build the
ADJACENT chain (3 edges: GrandCru->Premier, Premier->Village,
Village->Regional), NOT a fully-connected graph, and separately relate the
Burgundy region to each tier with `classified_under` (region -> tier).

We OVERWRITE the pre-existing legacy-marked Burgundy region context with a
book-cited, status='validated' one — that is the intended upgrade.
"""
from __future__ import annotations

import json

from scripts.wine_knowledge import ingest
from scripts.wine_knowledge.france import _helpers

CITATION = "Wine Bible 2e, France/Burgundy"

# The 3 grapes CONFIRMED present as entities in the burgundy_db skeleton.
# link_grape RAISES on a missing grape, so we link ONLY these.
_GRAPES = ("pinot-noir", "chardonnay", "gamay")

# The four-tier ladder, ordered HIGHEST -> LOWEST. Each adjacent (higher, lower)
# pair becomes one `outranks` edge, giving exactly 3 edges for 4 tiers.
_LADDER = (
    ("Burgundy Grand Cru", "burgundy-grand-cru"),
    ("Burgundy Premier Cru", "burgundy-premier-cru"),
    ("Burgundy Village", "burgundy-village"),
    ("Burgundy Regional", "burgundy-regional"),
)

# Book-cited context for each tier (drawn from the "four levels" passage,
# lines ~9935–9980, and the classification history at ~9957).
_TIER_CONTEXTS = {
    "burgundy-grand-cru": {
        "short": "Top of the Burgundy ladder — 'Great Growth'. The highest "
                 "designation a Burgundian vineyard can hold; just 33 Grand Cru "
                 "vineyards exist (32 in the Côte d'Or plus one in Chablis) and "
                 "they are ~2% of production.",
        "full": (
            "Grand Cru ('Great Growth') is the highest designation a Burgundian "
            "vineyard can hold, and it sits at the TOP of Burgundy's four-tier "
            "quality ladder. Wines from Grand Cru vineyards are the most treasured "
            "and expensive in Burgundy and rank among the most costly wines in the "
            "world. In the Côte d'Or there are only thirty-two Grand Cru vineyards, "
            "plus one in Chablis, for a total of thirty-three Grands Crus in the "
            "whole region. The Grands Crus are so famous that their vineyard names "
            "alone appear on the label along with the words 'Grand Cru' — for "
            "example La Tâche or Le Musigny — without naming the village they lie "
            "in. Grand Cru wine accounts for just 2 percent of Burgundy's total "
            "production. Grand Cru OUTRANKS Premier Cru."
        ),
        "attrs": {
            "rank": 1, "french": "Grand Cru (Great Growth)",
            "vineyard_count": 33, "share_of_production_pct": 2,
            "outranks": "burgundy-premier-cru",
            "unit": "single named vineyard (climat)",
        },
    },
    "burgundy-premier-cru": {
        "short": "Second tier — 'First Growth', a classified single vineyard whose "
                 "name follows the village on the label; 629 Premier Cru vineyards, "
                 "~10% of production.",
        "full": (
            "Premier Cru ('First Growth') is the second-highest rung of Burgundy's "
            "ladder — a classified single vineyard, the smallest and most "
            "well-defined place of all. In 1861 the top vineyards of Burgundy were "
            "classified as either Premier Cru or, higher still, Grand Cru. There "
            "are 629 Premier Cru vineyards; their wines are invariably expensive. "
            "The vineyard name appears on the label AFTER the village name — for "
            "example Beaune 'Clos de la Mousse' or Gevrey-Chambertin 'Aux "
            "Combottes'. Premier Cru wines account for 10 percent of Burgundy's "
            "total production. Premier Cru OUTRANKS Village but is itself "
            "outranked by Grand Cru."
        ),
        "attrs": {
            "rank": 2, "french": "Premier Cru (First Growth)",
            "vineyard_count": 629, "share_of_production_pct": 10,
            "classified": 1861, "outranks": "burgundy-village",
            "unit": "single named vineyard (climat), listed after the village",
        },
    },
    "burgundy-village": {
        "short": "Third tier — wine made entirely from grapes grown in and around a "
                 "single named village (e.g. Volnay, Meursault); 44 villages, ~36% "
                 "of production.",
        "full": (
            "Village wine is the third rung of Burgundy's ladder, and where "
            "Burgundy begins to get dependably interesting. As the name implies, a "
            "village wine is made entirely from grapes grown in and around that one "
            "village; it is a step up in price and usually quality from a regional "
            "wine because the grapes come from a smaller, better-defined place. The "
            "village name — Beaune, Volnay, Gevrey-Chambertin, Pommard, Meursault, "
            "Nuits-St.-Georges, Chambolle-Musigny and so on — appears on the label "
            "(a hyphenated name, where a village has annexed the name of its top "
            "vineyard, invariably means a village wine). There are forty-four "
            "villages, and their wines account for 36 percent of Burgundy's total "
            "production. Village OUTRANKS Regional but is outranked by Premier Cru."
        ),
        "attrs": {
            "rank": 3, "french": "Village",
            "village_count": 44, "share_of_production_pct": 36,
            "outranks": "burgundy-regional",
            "unit": "a single named village",
        },
    },
    "burgundy-regional": {
        "short": "Base of the ladder — Bourgogne Rouge / Bourgogne Blanc: simple "
                 "regional blends from grapes grown anywhere in Burgundy; 52% of "
                 "production, the most affordable Burgundies.",
        "full": (
            "Regional wine — Bourgogne Rouge and Bourgogne Blanc — is the base of "
            "Burgundy's four-tier ladder: usually simple, basic wines, generally "
            "blends of various lots made from grapes of one variety grown anywhere "
            "in the entire region of Burgundy. These wines often lack the "
            "specificity of terroir Burgundy is acclaimed for, though they do have "
            "a basic regional character, and their quality has risen dramatically "
            "in recent years. Basic regional wine accounts for 52 percent of "
            "Burgundy's total production and is the most affordable Burgundy. "
            "Regional sits below Village, Premier Cru and Grand Cru."
        ),
        "attrs": {
            "rank": 4, "french": "Bourgogne Rouge / Bourgogne Blanc (Regional)",
            "share_of_production_pct": 52,
            "unit": "anywhere in the region of Burgundy",
        },
    },
}


def load(conn) -> None:
    rid = _helpers.find_region(conn, "Burgundy")

    # 1. Region context — the big picture from the book, OVERWRITING any legacy
    #    context with a book-cited, validated one.
    region_full = (
        "Burgundy (Bourgogne) is a comparatively small, cool, northerly wine "
        "region in northeastern France that makes some of the world's most "
        "sought-after, expensive and exquisite wines — just over 66,000 acres "
        "(26,700 hectares) of vines, roughly a quarter the size of Bordeaux. Two "
        "grapes dominate: virtually all top white Burgundy is CHARDONNAY and "
        "virtually all top red Burgundy is PINOT NOIR, each grown unblended "
        "because both reach their greatest elegance in a cool climate — and "
        "Burgundy is the coolest, most northern of the world's great red-wine "
        "regions, giving reds that are intensely flavored yet light to medium in "
        "body with a gossamer gracefulness. Above all Burgundy is a study in "
        "TERROIR: over centuries Benedictine and Cistercian monks delineated the "
        "vineyards plot by plot, establishing terroir as the core of viticulture. "
        "A Burgundian vineyard is defined by its terroir, not by ownership, so a "
        "single vineyard (like the 125-acre Grand Cru Clos de Vougeot with its "
        "eighty owners) usually has many owners; a domaine is a collection of "
        "often-tiny scattered parcels; a vineyard with a single owner is a rare "
        "monopole; and much wine was historically bottled by négociant brokers who "
        "bought and blended small lots. Quality is a four-tier LADDER — from basic "
        "Regional (Bourgogne) up through Village and Premier Cru to Grand Cru. The "
        "region has four main sub-regions: Chablis (chardonnay only), the Côte d'Or "
        "(the Côte de Nuits, red only, and the Côte de Beaune, red and white), the "
        "Côte Chalonnaise and the Mâconnais. (Beaujolais, though administratively "
        "part of Burgundy, is gamay-based and treated separately.)"
    )
    region_short = (
        "France's most terroir-obsessed, cool-climate region: unblended chardonnay "
        "(whites) and pinot noir (reds), a Regional→Village→Premier Cru→Grand Cru "
        "quality ladder, and a fragmented domaine/monopole/négociant ownership "
        "system across Chablis, the Côte d'Or, the Côte Chalonnaise and Mâconnais."
    )
    region_attrs = {
        "key_grapes": ["chardonnay", "pinot-noir"],
        "also_administratively": ["gamay (Beaujolais, treated separately)"],
        "climate": "cool, northern (coolest of the great red-wine regions)",
        "defining_idea": "terroir — vineyards defined by site, not ownership; the "
                         "climat (a single named vineyard/parcel) is the true unit",
        "quality_ladder": ["Regional (Bourgogne)", "Village", "Premier Cru",
                            "Grand Cru"],
        "ownership_terms": {
            "domaine": "a collection of often-tiny scattered vineyard parcels",
            "monopole": "a (rare) vineyard with a single owner",
            "negociant": "broker who bought and blended small lots to bottle "
                         "under their own label",
        },
        "sub_regions": ["Chablis", "Côte d'Or (Côte de Nuits + Côte de Beaune)",
                        "Côte Chalonnaise", "Mâconnais"],
        "grand_cru_vineyards": 33,
    }
    ingest.upsert_context(
        conn, rid, "wine",
        short=region_short, full=region_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps(region_attrs),
    )

    # 2. Build the four-tier classification_tier ladder by stable slug
    #    (upsert_entity is idempotent), author each tier's cited context, then
    #    chain the ADJACENT pairs with `outranks` (tier -> tier, 3 edges) and
    #    relate the region to each tier with `classified_under` (region -> tier).
    tier_ids: list[int] = []
    for name, slug in _LADDER:
        tid = ingest.upsert_entity(conn, "classification_tier", name, slug)
        ctx = _TIER_CONTEXTS[slug]
        ingest.upsert_context(
            conn, tid, "wine",
            short=ctx["short"], full=ctx["full"],
            status="validated", source_citation=CITATION, confidence="high",
            attributes=json.dumps(ctx["attrs"]),
        )
        # region -> classification_tier (allowed classified_under direction).
        ingest.add_relationship(conn, rid, tid, "classified_under")
        tier_ids.append(tid)

    # Adjacent-chain outranks: higher tier OUTRANKS the next-lower tier.
    # _LADDER is ordered high->low, so (i -> i+1) is exactly the 3 edges wanted.
    for higher, lower in zip(tier_ids, tier_ids[1:]):
        ingest.add_relationship(conn, higher, lower, "outranks")

    # 3. Key sub-region contexts, each authored from the book. find_or_create
    #    returns the existing id if one is already present.
    cdn_full = (
        "The Côte de Nuits is the NORTHERN half of the Côte d'Or, the 30-mile "
        "limestone escarpment that is Burgundy's most renowned region. It is "
        "planted virtually entirely with PINOT NOIR and so makes RED wines almost "
        "exclusively. Its villages — Gevrey-Chambertin, Morey-St.-Denis, "
        "Chambolle-Musigny, Vougeot, Flagey-Echézeaux, Vosne-Romanée and "
        "Nuits-St.-Georges among them — are home to most of Burgundy's Grand Cru "
        "red vineyards (Le Chambertin, Le Musigny, Clos de Vougeot, La Tâche, "
        "Romanée-Conti and more). Its top reds tend to have greater intensity and "
        "a firmer structure than those of the Côte de Beaune."
    )
    cdn_id = _helpers.find_or_create_subregion(conn, "Côte de Nuits", rid, slug="cote-de-nuits")
    cdn_ctx = ingest.upsert_context(
        conn, cdn_id, "wine",
        short="Northern half of the Côte d'Or; pinot noir only, red wines only; "
              "home to most red Grand Crus (Chambertin, Musigny, Romanée-Conti); "
              "intense, firmly structured.",
        full=cdn_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "part_of": "Côte d'Or", "half": "northern",
            "grape": "pinot-noir", "styles": ["red"],
            "character": "greater intensity and firmer structure than Côte de Beaune",
        }),
    )

    cdb_full = (
        "The Côte de Beaune is the SOUTHERN half of the Côte d'Or. It is planted "
        "with both pinot noir and chardonnay and makes both RED and WHITE wines, "
        "though its ultra-famous whites — Puligny-Montrachet, Chassagne-Montrachet, "
        "Meursault, Corton-Charlemagne — dominate its fame; ALL white Burgundy "
        "from the Côte d'Or comes from here. Its top reds (Aloxe-Corton, Beaune, "
        "Volnay, Pommard) are frequently softer and more lush than those of the "
        "Côte de Nuits; its Premier and Grand Cru whites can be amazingly rich and "
        "concentrated without being heavy."
    )
    cdb_id = _helpers.find_or_create_subregion(conn, "Côte de Beaune", rid, slug="cote-de-beaune")
    cdb_ctx = ingest.upsert_context(
        conn, cdb_id, "wine",
        short="Southern half of the Côte d'Or; both pinot noir and chardonnay, red "
              "and white; source of Burgundy's greatest whites (Montrachet, "
              "Meursault, Corton-Charlemagne); reds softer and more lush.",
        full=cdb_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "part_of": "Côte d'Or", "half": "southern",
            "grapes": ["pinot-noir", "chardonnay"], "styles": ["red", "white"],
            "renowned_for": "white Burgundy (Puligny/Chassagne-Montrachet, "
                            "Meursault, Corton-Charlemagne)",
        }),
    )

    chablis_full = (
        "Chablis is the northernmost sub-region of Burgundy, an isolated island of "
        "vineyards far north of the Côte d'Or and closer to Champagne. It is "
        "entirely devoted to CHARDONNAY. Its harsh, wet, very cold, Atlantic-"
        "influenced climate and its whitish Kimmeridgian limestone soil (full of "
        "fossil oyster shells) give wines that are so crisp and racy they 'vibrate "
        "with spring-loaded acidity' — steely, minerally, gunflint (goût de pierre "
        "à fusil) in character and quite unlike chardonnay from anywhere else. Most "
        "Chablis is made entirely in stainless steel to preserve purity of flavor. "
        "Chablis has numerous Premier Crus and a single Grand Cru, itself made up "
        "of seven contiguous climats (Blanchot, Bougros, Grenouilles, Les Clos, "
        "Les Preuses, Valmur and Vaudésir) — a textbook example of the climat "
        "concept, a single named vineyard being the true unit of Burgundy."
    )
    chablis_id = _helpers.find_or_create_subregion(conn, "Chablis", rid, slug="chablis")
    chablis_ctx = ingest.upsert_context(
        conn, chablis_id, "wine",
        short="Northernmost, coolest Burgundy sub-region; chardonnay only; steely, "
              "minerally, gunflint, high-acid, usually unoaked (stainless steel); "
              "one Grand Cru of seven climats.",
        full=chablis_full,
        status="validated", source_citation=CITATION, confidence="high",
        attributes=json.dumps({
            "grape": "chardonnay", "styles": ["white"],
            "soil": "Kimmeridgian limestone (fossil oyster shells)",
            "winemaking": "mostly stainless steel, unoaked",
            "character": "steely, minerally, gunflint, spring-loaded acidity",
            "grand_cru": "one, comprising seven climats",
        }),
    )

    # 4. Link the 3 confirmed grapes to Burgundy (grape -> region 'grown_in').
    for slug in _GRAPES:
        _helpers.link_grape(conn, slug, rid)

    # 5. Benchmarks — only where the book's sensory language clearly supports a
    #    value, on the project's 1–5 gauge (test seed 'wine.body'=4.0).
    #    Narrative-derived, so confidence='medium' with an explicit citation suffix.
    bench_citation = CITATION + " (narrative-derived)"

    # Burgundy Pinot Noir (Côte de Nuits reds): the book says Burgundy's cool
    # climate gives reds "intensely flavored but ... a light to medium body",
    # high acidity from the cool north, and (pinot generally) low-to-moderate
    # tannin — pinot noir is fragile, the "complete opposite of cabernet".
    ingest.upsert_benchmark(
        conn, cdn_ctx, "wine.body",
        typical=2.5, low=2.0, high=3.0,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, cdn_ctx, "wine.acidity",
        typical=4.0, low=3.5, high=4.5,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, cdn_ctx, "wine.tannin",
        typical=2.5, low=2.0, high=3.0,
        confidence="medium", source_citation=bench_citation)

    # Chablis Chardonnay: "crisp and racy ... vibrate with spring-loaded acidity",
    # lean, steely, mostly unoaked -> very high acidity, low body.
    ingest.upsert_benchmark(
        conn, chablis_ctx, "wine.acidity",
        typical=4.5, low=4.0, high=5.0,
        confidence="medium", source_citation=bench_citation)
    ingest.upsert_benchmark(
        conn, chablis_ctx, "wine.body",
        typical=2.5, low=2.0, high=3.0,
        confidence="medium", source_citation=bench_citation)
