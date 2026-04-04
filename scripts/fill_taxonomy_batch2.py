#!/usr/bin/env python3
"""Batch 2: Fill taxonomy descriptions for more regions + spirits regions + top brands."""
import psycopg2, json, sys
from pathlib import Path

env_path = Path(__file__).parent.parent / ".env.local"
db_url = None
for line in env_path.read_text().splitlines():
    if line.startswith("SUPABASE_DB_URL="):
        db_url = line.split("=", 1)[1]
        break

conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

def update_context(entity_type, entity_name, scope_id, description_short, description_en, attributes=None):
    cur.execute("""
        UPDATE taxonomy_contexts SET
            description_short = %s, description_en = %s,
            attributes = COALESCE(%s::jsonb, attributes),
            status = 'validated', validated_at = now(), updated_at = now()
        WHERE entity_id = (
            SELECT id FROM taxonomy_entities WHERE entity_type = %s AND name = %s
        ) AND scope_id = %s
    """, (description_short, description_en, json.dumps(attributes) if attributes else None,
          entity_type, entity_name, scope_id))
    return cur.rowcount

count = 0

# ============================================================================
# WINE REGIONS — Batch 2
# ============================================================================
wine_regions = {
    "Veneto": {
        "short": "Italy's most productive region — home to Prosecco, Amarone, Soave, and Valpolicella.",
        "full": "Veneto is Italy's largest wine-producing region by volume, anchored by three iconic styles. Prosecco (from Glera grapes in the hills of Conegliano-Valdobbiadene) is the world's best-selling sparkling wine. Amarone della Valpolicella is made by the appassimento method — partially drying grapes before fermentation to concentrate flavours into a rich, powerful, high-alcohol red from Corvina, Corvinone, and Rondinella. Valpolicella Ripasso re-ferments wine on Amarone's spent skins for added depth. Soave, from Garganega, produces whites ranging from fresh and mineral to richly textured. The hills around Lake Garda yield fresh Bardolino. Veneto's sheer diversity of styles, from everyday to world-class, makes it one of Italy's most commercially important regions.",
        "attrs": {"key_grapes": ["Corvina","Corvinone","Rondinella","Glera","Garganega","Pinot Grigio"], "climate": "Continental with Alpine and Adriatic influence", "soil": "Volcanic, alluvial, limestone, clay", "classification_system": "DOCG (Amarone, Prosecco Superiore, Soave Superiore), DOC"}
    },
    "California": {
        "short": "America's wine powerhouse — from Napa Cabernet to Sonoma Pinot Noir to Central Coast Rhône blends.",
        "full": "California produces over 80% of American wine across an extraordinary diversity of climates and styles. Beyond Napa Valley's celebrated Cabernet Sauvignon, Sonoma County produces world-class Pinot Noir (Russian River Valley, Sonoma Coast), Zinfandel (Dry Creek Valley), and Chardonnay. The Central Coast encompasses Paso Robles (bold Rhône-style blends and Cabernet), Santa Barbara County (sideways-famous Pinot Noir from Sta. Rita Hills), and Monterey (cool-climate Chardonnay and Pinot Noir). The Sierra Foothills preserve old-vine Zinfandel. Lodi is a Zinfandel stronghold. California's Mediterranean climate — warm, dry summers and mild winters — is moderated by Pacific fog and ocean breezes, creating microclimates that support virtually every major grape variety.",
        "attrs": {"key_grapes": ["Cabernet Sauvignon","Pinot Noir","Chardonnay","Zinfandel","Merlot","Syrah","Sauvignon Blanc"], "climate": "Mediterranean with Pacific fog influence", "soil": "Volcanic, alluvial, limestone, clay, granite, sand", "classification_system": "AVA (over 140 sub-AVAs)"}
    },
    "South Australia": {
        "short": "Australia's premium wine state — Barossa Shiraz, Adelaide Hills Sauvignon Blanc, Coonawarra Cabernet.",
        "full": "South Australia produces roughly 50% of Australia's wine and is home to its most prestigious regions. The Barossa Valley and Eden Valley produce Australia's most iconic Shiraz and Riesling respectively. McLaren Vale excels with Grenache, Shiraz, and Mediterranean varieties. Adelaide Hills offers cool-climate Sauvignon Blanc, Chardonnay, and Pinot Noir at altitude. Clare Valley rivals Eden Valley for Riesling supremacy. Coonawarra's famous terra rossa soils over limestone produce benchmark Cabernet Sauvignon. The Limestone Coast extends this into Padthaway and Wrattonbully. Langhorne Creek and Riverland provide volume production. South Australia's freedom from phylloxera means many vines are ungrafted, including centenarian Barossa Shiraz and Grenache.",
        "attrs": {"key_grapes": ["Shiraz","Cabernet Sauvignon","Grenache","Riesling","Chardonnay","Sauvignon Blanc"], "climate": "Mediterranean to cool continental", "soil": "Terra rossa, red-brown earth, sand over limestone, alluvial", "classification_system": "GI (Geographical Indication)"}
    },
    "Languedoc": {
        "short": "France's largest wine region by volume, reinventing itself with quality-focused producers and Mediterranean varieties.",
        "full": "Languedoc-Roussillon stretches across France's Mediterranean coast from the Rhône to the Spanish border. Once dismissed as a source of cheap bulk wine, it has undergone a dramatic quality revolution. Leading appellations include Corbières, Minervois, Faugères, and Saint-Chinian for red blends dominated by Grenache, Syrah, Mourvèdre, and Carignan. Pic Saint-Loup near Montpellier produces increasingly refined reds. Limoux claims to be the birthplace of sparkling wine (predating Champagne). The region's garrigue-covered hillsides, hot Mediterranean climate, and low rainfall produce concentrated, herb-scented wines at prices that represent extraordinary value. The IGP Pays d'Oc designation allows varietal labelling, making it France's most accessible wine region internationally.",
        "attrs": {"key_grapes": ["Grenache","Syrah","Mourvèdre","Carignan","Cinsault","Viognier","Picpoul"], "climate": "Mediterranean, hot and dry", "soil": "Limestone, schist, clay, garrigue-covered hillsides", "classification_system": "AOC (Corbières, Minervois, etc.), IGP Pays d'Oc"}
    },
    "Central Valley": {
        "short": "Chile's agricultural heartland and wine engine, producing the bulk of the country's exports.",
        "full": "Chile's Central Valley encompasses the Rapel, Curicó, and Maule valleys — the country's largest wine-producing area. Rapel Valley divides into Cachapoal (noted for Cabernet Sauvignon and Carmenère) and Colchagua (Chile's most prestigious red wine sub-region, producing world-class Cabernet, Syrah, and Carmenère). Curicó Valley offers excellent-value Sauvignon Blanc and Cabernet. Maule, the largest region, is home to old-vine País and Carignan — once dismissed, now celebrated by a new generation of producers. The Central Valley's Mediterranean climate with Andean snowmelt irrigation, virtually no rainfall during the growing season, and dramatic temperature swings between day and night create conditions for ripe, healthy fruit at every quality level.",
        "attrs": {"key_grapes": ["Cabernet Sauvignon","Carmenère","Syrah","Merlot","Sauvignon Blanc","País","Carignan"], "climate": "Mediterranean, Andean influence", "soil": "Alluvial, volcanic, clay, decomposed granite", "classification_system": "DO (Denominación de Origen)"}
    },
    "Sicily": {
        "short": "Italy's largest island and a hotbed of innovation, with Nero d'Avola and Etna wines leading the charge.",
        "full": "Sicily is Italy's largest island and its largest wine region by area. Long a source of bulk wine, Sicily has transformed into one of Italy's most exciting quality regions. Nero d'Avola, the island's signature red grape, produces wines ranging from plush and fruit-forward to structured and age-worthy. Etna, on the slopes of Europe's largest active volcano, has become a cult region — its volcanic soils and high altitudes produce hauntingly elegant reds from Nerello Mascalese and crisp whites from Carricante. Grillo and Catarratto provide fresh, mineral whites. Marsala, once Sicily's most famous wine, is undergoing a quality revival. The island's Greek winemaking heritage (over 2,500 years) and diverse terroir — from volcanic to sandy to limestone — offer extraordinary potential.",
        "attrs": {"key_grapes": ["Nero d'Avola","Nerello Mascalese","Grillo","Catarratto","Carricante","Frappato"], "climate": "Mediterranean, hot and dry, cooler on Etna", "soil": "Volcanic (Etna), limestone, clay, sandy", "classification_system": "DOC (Etna, Cerasuolo di Vittoria), IGT Terre Siciliane"}
    },
    "Marlborough": {
        "short": "The world capital of Sauvignon Blanc — explosive aromatics and crystalline acidity from New Zealand's sunniest region.",
        "full": "Marlborough, at the northern tip of New Zealand's South Island, produces over 75% of the country's wine — and virtually defined a global style of Sauvignon Blanc. The combination of long sunshine hours, cool nights, and free-draining stony soils in the Wairau Valley creates Sauvignon Blanc of extraordinary aromatic intensity: passionfruit, gooseberry, capsicum, and cut grass with bracing acidity. The Southern Valleys (Awatere, particularly) add a more mineral, restrained dimension. Beyond Sauvignon Blanc, Marlborough produces excellent Pinot Noir (increasingly serious), Chardonnay, Pinot Gris, and Riesling. The region's rapid growth from a handful of vineyards in the 1970s to New Zealand's dominant wine region is one of the wine world's most remarkable success stories.",
        "attrs": {"key_grapes": ["Sauvignon Blanc","Pinot Noir","Chardonnay","Pinot Gris","Riesling"], "climate": "Cool maritime, high sunshine hours, significant diurnal range", "soil": "Greywacke gravel, stony alluvial, clay", "classification_system": "GI Marlborough (sub-regions: Wairau Valley, Southern Valleys)"}
    },
    "Loire": {
        "short": "France's garden — a 600-mile river valley producing everything from bone-dry Muscadet to luscious Vouvray.",
        "full": "The Loire Valley stretches 600 miles from the Atlantic to central France, producing an unmatched range of styles. At the Atlantic end, Muscadet from Melon de Bourgogne is the ultimate oyster wine. Moving upstream, Anjou-Saumur produces Chenin Blanc in every style from sparkling (Crémant de Loire, Saumur) to bone-dry to lusciously sweet (Coteaux du Layon, Quarts de Chaume, Bonnezeaux). Touraine offers Cabernet Franc reds from Chinon and Bourgueil of ethereal elegance. The eastern end produces Sauvignon Blanc in Sancerre and Pouilly-Fumé — the benchmark for the variety before New Zealand existed. Vouvray demonstrates Chenin Blanc's extraordinary versatility across dry, off-dry, sweet, and sparkling styles. The Loire is perhaps France's most undervalued great wine region.",
        "attrs": {"key_grapes": ["Chenin Blanc","Sauvignon Blanc","Cabernet Franc","Melon de Bourgogne","Gamay"], "climate": "Cool maritime (west) to continental (east)", "soil": "Tuffeau (limestone), schist, silex (flint), sand, clay", "classification_system": "AOC (Sancerre, Vouvray, Chinon, Muscadet, etc.)"}
    },
    "Alsace": {
        "short": "France's aromatic white wine paradise — Riesling, Gewurztraminer, and Pinot Gris from the Vosges foothills.",
        "full": "Alsace occupies a narrow strip between the Vosges Mountains and the Rhine River in northeast France. Sheltered from Atlantic rain by the Vosges, it is France's driest wine region and one of the sunniest. Alsace is unique in France for labelling wines by grape variety rather than appellation. Riesling is the noblest variety — dry, mineral, and age-worthy from Grand Cru sites like Rangen, Schlossberg, and Brand. Gewurztraminer produces exotically aromatic, lychee-scented wines. Pinot Gris ranges from crisp to richly textured. Muscat d'Alsace is intensely grapey and dry. The 51 Grand Cru vineyards represent the finest sites. Vendange Tardive (late harvest) and Sélection de Grains Nobles (botrytised) designations produce extraordinary sweet wines. Crémant d'Alsace is France's largest appellation for traditional-method sparkling after Champagne.",
        "attrs": {"key_grapes": ["Riesling","Gewurztraminer","Pinot Gris","Muscat","Pinot Blanc","Sylvaner","Pinot Noir"], "climate": "Semi-continental, sheltered by Vosges, very dry", "soil": "Granite, limestone, sandstone, volcanic, marl, schist — 13 geological formations", "classification_system": "AOC Alsace, AOC Alsace Grand Cru (51 sites), Crémant d'Alsace"}
    },
    "Mosel": {
        "short": "Germany's most dramatic wine landscape — steep slate slopes producing Riesling of unmatched delicacy.",
        "full": "The Mosel (formerly Mosel-Saar-Ruwer) is Germany's most visually spectacular wine region. Its impossibly steep slate vineyards — some at 65° inclines — line the sinuous Mosel River and its tributaries, the Saar and Ruwer. These slopes create a microclimate where Riesling achieves a purity and delicacy unmatched anywhere else: low alcohol (often 7-9%), piercing acidity, and flavours of green apple, white peach, wet slate, and petrol with age. The best sites — Wehlener Sonnenuhr, Ürziger Würzgarten, Scharzhofberger, Brauneberger Juffer — are among the world's great vineyard names. Blue and red Devonian slate dominates, transmitting heat to vines in this marginal climate. The Saar and Ruwer tributaries produce even more racy, nervy wines. VDP estates have championed the Grosse Lage/Erste Lage classification system.",
        "attrs": {"key_grapes": ["Riesling","Müller-Thurgau","Elbling"], "climate": "Cool continental, river-moderated microclimate", "soil": "Blue Devonian slate, red slate, grey slate, quartzite", "classification_system": "VDP Grosse Lage, Erste Lage; Prädikat system"}
    },
    "Douro": {
        "short": "Portugal's most dramatic wine region — the birthplace of Port and increasingly celebrated for unfortified reds.",
        "full": "The Douro Valley in northern Portugal is one of the world's oldest demarcated wine regions (1756) and a UNESCO World Heritage site. Its terraced schist hillsides along the Douro River produce both Port — the world's greatest fortified wine — and an increasingly exciting range of unfortified reds and whites. Port's extraordinary complexity comes from blending dozens of indigenous varieties, led by Touriga Nacional, Touriga Franca, Tinta Roriz (Tempranillo), Tinta Barroca, and Tinto Cão. Unfortified Douro reds offer structure, concentration, and value rivalling any region in Europe. The Douro's extreme continental climate — brutally hot summers, cold winters — and impoverished schist soils stress vines into producing small, intensely concentrated berries.",
        "attrs": {"key_grapes": ["Touriga Nacional","Touriga Franca","Tinta Roriz","Tinta Barroca","Tinto Cão"], "climate": "Continental Mediterranean, extreme heat in summer", "soil": "Schist, granite (in the west)", "classification_system": "DOC Douro, DOC Porto; A/B/C vineyard classification"}
    },
    "Stellenbosch": {
        "short": "South Africa's premier wine region — Bordeaux-style blends and Cabernet of world-class ambition.",
        "full": "Stellenbosch, in the Western Cape, is South Africa's most prestigious wine region. Established in 1679, it benefits from diverse soils, varied aspects, and cooling breezes from False Bay. The region produces South Africa's finest Cabernet Sauvignon and Bordeaux-style blends, with the Helderberg, Simonsberg, and Stellenbosch Mountain wards offering distinct characters. Cabernet from decomposed granite soils on mountain slopes achieves remarkable depth and structure. Chardonnay and Sauvignon Blanc perform well at cooler sites. Syrah is increasingly impressive. Stellenbosch is home to many of South Africa's most celebrated estates — Kanonkop, Rustenberg, Thelema, Rust en Vrede — and anchors the country's fine wine ambitions. The university of Stellenbosch drives viticultural research.",
        "attrs": {"key_grapes": ["Cabernet Sauvignon","Merlot","Syrah","Chardonnay","Sauvignon Blanc","Pinotage"], "climate": "Mediterranean, with False Bay cooling influence", "soil": "Decomposed granite, Table Mountain sandstone, alluvial clay", "classification_system": "WO Stellenbosch, ward-level appellations"}
    },
}

for name, data in wine_regions.items():
    n = update_context("region", name, "wine", data["short"], data["full"], data.get("attrs"))
    count += n
    print(f"  Wine Region: {name} -> {n}", flush=True)

# ============================================================================
# SPIRITS REGION — Speyside (only one that exists as spirits context)
# ============================================================================
spirits_regions = {
    "Speyside": {
        "short": "Scotland's densest concentration of distilleries — elegant, fruity, often sherried single malts.",
        "full": "Speyside, in the northeast Highlands around the River Spey, contains over half of Scotland's malt whisky distilleries — more than 50 in a compact area. Its malts are characterised by elegance, complexity, and fruit-forward character, ranging from light and grassy (Glenlivet) to richly sherried (Macallan, Glenfarclas, Aberlour) to intensely fruity (Balvenie, Glenfiddich). The region's soft water, sheltered climate, and concentration of coopering and blending expertise made it the heart of the Scotch whisky industry. Speyside malts are the backbone of many premium blends. The Malt Whisky Trail connects eight distilleries and a cooperage for visitors. Despite its small geography, the range of styles produced in Speyside demonstrates how water source, still shape, and cask selection create dramatically different whiskies.",
        "attrs": {"distillation_method": "Copper pot still", "base_ingredient": "Malted barley", "aging_tradition": "Ex-bourbon, ex-sherry, refill casks; typically 10-25 years", "key_styles": ["Fruity/Floral","Sherried","Light/Grassy","Rich/Complex"], "regulation": "Scotch Whisky Regulations 2009"}
    },
}

for name, data in spirits_regions.items():
    n = update_context("region", name, "spirits", data["short"], data["full"], data.get("attrs"))
    count += n
    print(f"  Spirits Region: {name} -> {n}", flush=True)

# ============================================================================
# TOP BRANDS
# ============================================================================
brands = {
    ("Riedel", "accessories"): {
        "short": "The world's leading wine glass manufacturer, pioneering varietal-specific glassware since 1756.",
        "full": "Riedel is an Austrian family-owned glassware company, now in its 11th generation, that revolutionised how the world drinks wine. Claus Riedel introduced the first varietal-specific wine glass in 1973 — the Sommeliers series — proving that glass shape dramatically affects flavour perception. The Vinum series (machine-made, introduced 1986) democratised this concept. Today Riedel offers multiple ranges: Sommeliers (mouth-blown, handmade), Superleggero (machine-blown, ultra-light), Veritas, Performance, and the entry-level Wine Wings. The company also produces the Spiegelau brand (value-oriented) and Nachtmann (decorative crystal). Riedel's Kufstein factory in Tyrol remains the production centre. Every serious wine programme — from Michelin restaurants to tasting rooms — relies on Riedel's approach to glass engineering.",
        "attrs": {"founding_year": 1756, "country": "Austria", "key_products": ["Sommeliers","Vinum","Superleggero","Veritas","Performance"], "style_philosophy": "Varietal-specific glass shapes to optimise aroma, flavour, and finish"}
    },
    ("Penfolds", "wine"): {
        "short": "Australia's most iconic wine brand — from Grange to Bin 389, defining Australian fine wine since 1844.",
        "full": "Penfolds was founded by Dr Christopher Rawson Penfold in 1844 at Magill Estate, Adelaide. Max Schubert created Grange (originally Grange Hermitage) in the 1950s after visiting Bordeaux — it became Australia's first internationally recognised fine wine and remains its most celebrated. The Bin series (Bin 389, Bin 128, Bin 28, Bin 2) offers accessible quality at multiple price points. RWT (Red Winemaking Trial) Barossa Shiraz and St Henri provide alternatives to Grange's style. Penfolds' multi-vineyard, multi-region blending philosophy — sourcing the best fruit regardless of origin — distinguishes it from European single-estate traditions. Now owned by Treasury Wine Estates, Penfolds has expanded into Champagne (Penfolds x Thiénot) and California. The annual Penfolds Collection release is an Australian wine calendar event.",
        "attrs": {"founding_year": 1844, "country": "Australia", "key_products": ["Grange","Bin 389","RWT","St Henri","Bin 707","Yattarna"], "style_philosophy": "Multi-region blending for consistent quality; house style over terroir expression"}
    },
    ("Johnnie Walker", "spirits"): {
        "short": "The world's best-selling Scotch whisky brand, from Red Label to Blue Label and beyond.",
        "full": "Johnnie Walker began in 1820 when John Walker opened a grocery in Kilmarnock, Scotland. His son Alexander and grandson Alexander II built it into a global brand. The colour-coded range — Red Label (accessible, for mixing), Black Label 12yo (the benchmark blended Scotch), Double Black (smokier), Green Label 15yo (blended malt), Gold Label Reserve (celebratory), and Blue Label (ultra-premium) — spans virtually every occasion and price point. The Striding Man logo, created in 1909, is one of the world's most recognisable trademarks. Johnnie Walker blends draw from a vast portfolio of malt and grain distilleries across Scotland. Now owned by Diageo, the brand sells over 18 million cases annually. Special releases, including the Jane Walker and Johnnie Walker Island Green editions, expand the range further.",
        "attrs": {"founding_year": 1820, "country": "Scotland", "key_products": ["Red Label","Black Label","Double Black","Green Label","Gold Label Reserve","Blue Label"], "style_philosophy": "Consistent blended Scotch across a colour-tiered portfolio from everyday to ultra-premium"}
    },
    ("Giffard", "spirits"): {
        "short": "French liqueur house since 1885, producing bartender-favourite syrups, liqueurs, and crèmes.",
        "full": "Giffard was founded in 1885 by Emile Giffard, a pharmacist in Angers, Loire Valley, who created Menthe Pastille — a peppermint liqueur that became a local sensation. Five generations later, the family-owned company produces over 80 liqueurs, crèmes, and syrups prized by professional bartenders worldwide. Giffard's approach emphasises natural ingredients: real fruit, botanical distillation, and minimal artificial additives. Key products include the premium Liqueur de France range, the widely used Banane du Brésil (green banana liqueur), Crème de Pêche de Vigne, and the extensive professional syrup line. Based in Avrillé near Angers, Giffard sources many fruits from the Loire Valley. The brand has become indispensable in craft cocktail bars for its clean, authentic flavours and consistent quality.",
        "attrs": {"founding_year": 1885, "country": "France", "key_products": ["Menthe Pastille","Banane du Brésil","Crème de Pêche","Elderflower","Professional Syrups"], "style_philosophy": "Natural fruit and botanical-based liqueurs and syrups for professional bartenders"}
    },
    ("Joseph Drouhin", "wine"): {
        "short": "One of Burgundy's most respected négociants, producing terroir-driven wines across the Côte d'Or since 1880.",
        "full": "Maison Joseph Drouhin was founded in 1880 in Beaune and is now in its fourth generation under the Drouhin family. The house owns 73 hectares across Burgundy's finest appellations — including parcels in Musigny, Chambertin-Clos de Bèze, Bonnes Mares, Corton-Charlemagne, and the monopole Clos des Mouches in Beaune. Under the direction of Véronique Drouhin (winemaker, trained at UC Davis), the domaine converted entirely to organic and biodynamic viticulture. Drouhin's style emphasises purity, elegance, and transparency of terroir over power. The Oregon venture, Domaine Drouhin Oregon, helped establish Willamette Valley Pinot Noir internationally. The Beaune-based operation also acts as a négociant, purchasing grapes and must from trusted growers across Burgundy.",
        "attrs": {"founding_year": 1880, "country": "France", "key_products": ["Clos des Mouches","Musigny","Chambertin-Clos de Bèze","Beaune Premier Cru","Domaine Drouhin Oregon"], "style_philosophy": "Terroir-driven elegance, organic and biodynamic viticulture, Burgundian purity"}
    },
    ("Hennessy", "spirits"): {
        "short": "The world's largest Cognac house, producing over 40% of global Cognac from a 1765 foundation.",
        "full": "Hennessy was founded in 1765 by Richard Hennessy, an Irish officer in the French army, in the town of Cognac. Now part of LVMH, it is the world's dominant Cognac producer, accounting for roughly 40% of global sales. The house maintains over 350 partner-growers and owns some of the finest eaux-de-vie stocks in the region. The VS (Very Special) is the world's best-selling Cognac. VSOP Privilège offers smooth, balanced complexity. XO (Extra Old), redesigned in 1947 by Maurice Fillioux, set the standard for the category. Paradis and Richard Hennessy represent the ultra-luxury tier, blending eaux-de-vie up to 130 years old. The Comité de Dégustation (tasting committee), led by master blender Renaud Fillioux de Gironde, is the eighth-generation custodian of Hennessy's blending tradition.",
        "attrs": {"founding_year": 1765, "country": "France", "key_products": ["VS","VSOP Privilège","XO","Paradis","Richard Hennessy","Master Blender's Selection"], "style_philosophy": "Consistent house style through multi-vintage blending; richness, power, and longevity"}
    },
    ("Masumi", "sake"): {
        "short": "Nagano prefecture's most celebrated sake brewery, producing elegant, food-friendly sake since 1662.",
        "full": "Masumi (宮坂醸造, Miyasaka Brewing) was founded in 1662 in Suwa, Nagano Prefecture, at the foot of the Japanese Alps. The brewery gained fame when its yeast strain — discovered in 1946 and designated Kyokai No.7 (Association Yeast #7) — became the most widely used sake yeast in Japan, prized for producing clean, aromatic flavours. Masumi's sake reflects Nagano's pure mountain water and cold winters. The range spans from the approachable Okuden Kantsukuri (a benchmark junmai) to the refined Nanago Junmai Daiginjo and the flagship Yumedono Daiginjo. Under seventh-generation president Katsuhiko Miyasaka, the brewery has embraced export markets while maintaining traditional methods including some kimoto production. Masumi exemplifies the balance between tradition and accessibility that defines the best regional breweries.",
        "attrs": {"founding_year": 1662, "country": "Japan", "key_products": ["Nanago Junmai Daiginjo","Yumedono Daiginjo","Okuden Kantsukuri","Arabashiri","Mirror of Truth"], "style_philosophy": "Clean, elegant, food-friendly sake reflecting Nagano's alpine water and cold-climate brewing"}
    },
    ("The Macallan", "spirits"): {
        "short": "Speyside's most prestigious single malt — defined by exceptional sherry cask maturation and luxury positioning.",
        "full": "The Macallan distillery was founded in 1824 by Alexander Reid in Craigellachie, Speyside. It became synonymous with sherry cask maturation, having used exclusively sherry-seasoned oak for decades — a practice that defined its rich, dried-fruit, spice-laden character. The distillery's small copper pot stills (the smallest on Speyside) and high cut point produce a characteristically oily, full-bodied new make spirit. The Sherry Oak range continues the exclusive sherry cask tradition. The Double Cask range combines American and European sherry-seasoned oak. The Macallan Estate and Rare Cask represent the super-premium tier. The 2018 opening of a spectacular underground distillery designed by Rogers Stirk Harbour + Partners signalled Macallan's luxury ambitions. Now owned by Edrington, The Macallan is consistently among the world's most valuable single malt brands at auction.",
        "attrs": {"founding_year": 1824, "country": "Scotland", "key_products": ["Sherry Oak 12/18/25/30","Double Cask 12/15/18","Rare Cask","Edition Series","The Macallan Estate"], "style_philosophy": "Sherry cask-defined richness; small stills for oily, full-bodied spirit; luxury positioning"}
    },
    ("Torres", "wine"): {
        "short": "Spain's most international wine family, pioneering quality across Penedès, Priorat, and Chile since 1870.",
        "full": "Familia Torres was founded in 1870 in Vilafranca del Penedès, Catalonia. Under Miguel A. Torres (third generation), the company modernised Spanish winemaking — introducing temperature-controlled fermentation, French varietals, and small-barrel aging in the 1960s-70s. Mas La Plana Cabernet Sauvignon's victory over Château Latour in a 1979 blind tasting shocked the wine world. Today, fifth-generation Miguel Torres Maczassek leads the company with a focus on sustainability and climate adaptation — including recovering pre-phylloxera indigenous varieties and high-altitude vineyard development. The portfolio spans Penedès (Viña Sol, Sangre de Toro, Gran Coronas), Priorat, Ribera del Duero, Rioja, Rías Baixas, and international operations in Chile (Miguel Torres Chile) and California. Torres is one of Spain's most respected and innovative wine producers.",
        "attrs": {"founding_year": 1870, "country": "Spain", "key_products": ["Mas La Plana","Grans Muralles","Viña Sol","Sangre de Toro","Purgatori","Salmos (Priorat)"], "style_philosophy": "Innovation within tradition; sustainability-driven; recovering indigenous varieties alongside international grapes"}
    },
    ("Concha y Toro", "wine"): {
        "short": "Chile's largest and most recognised wine producer, from everyday Casillero del Diablo to premium Don Melchor.",
        "full": "Viña Concha y Toro was founded in 1883 by Don Melchor de Concha y Toro in the Maipo Valley. Today it is Latin America's largest wine company and one of the world's top ten by volume. The brand portfolio is tiered: Frontera (entry-level), Casillero del Diablo (the global best-seller, named after the cellar legend of the devil guarding the founder's best wines), Marqués de Casa Concha (premium), and Don Melchor Cabernet Sauvignon (the flagship, consistently Chile's highest-rated wine). The company also owns Cono Sur (Pinot Noir specialist), Trivento (Argentina), Fetzer (California), and Bonterra (organic). Concha y Toro operates vineyards across Chile's key valleys — Maipo, Casablanca, Colchagua, Rapel, and Maule — giving it unmatched sourcing diversity.",
        "attrs": {"founding_year": 1883, "country": "Chile", "key_products": ["Don Melchor","Marqués de Casa Concha","Casillero del Diablo","Terrunyo","Amelia"], "style_philosophy": "Volume-to-premium tiered portfolio; Chilean terroir expression at every price point"}
    },
    ("Suntory", "spirits"): {
        "short": "Japan's pioneering spirits house — from Yamazaki whisky to Roku Gin and Toki, shaping Japanese drinking culture.",
        "full": "Suntory was founded in 1899 by Shinjiro Torii as a port wine producer, but its destiny was whisky. In 1923, Torii built Yamazaki — Japan's first whisky distillery — hiring Masataka Taketsuru (who later founded Nikka) as founding distiller. Suntory now operates three whisky distilleries: Yamazaki (complex, multi-layered), Hakushu (fresh, herbaceous, forest character), and Chita (grain whisky). Hibiki, the harmonious blend of all three, became a global icon. Roku Gin, with six Japanese botanicals, and Haku Vodka expanded the portfolio. Suntory Toki was created specifically for the Highball serve that revitalised Japanese whisky consumption. The acquisition of Beam Inc. in 2014 (creating Beam Suntory) added Jim Beam, Maker's Mark, and Laphroaig. The family-owned Suntory Holdings remains Japan's largest spirits company.",
        "attrs": {"founding_year": 1899, "country": "Japan", "key_products": ["Yamazaki","Hakushu","Hibiki","Roku Gin","Toki","Haku Vodka"], "style_philosophy": "Monozukuri (art of making things) — meticulous craftsmanship, harmony, and Japanese aesthetic in spirits"}
    },
    ("Louis Jadot", "wine"): {
        "short": "One of Burgundy's largest and most consistent négociants, producing benchmark wines from village to Grand Cru.",
        "full": "Maison Louis Jadot was founded in 1859 in Beaune and is now one of Burgundy's most important producers. The house owns over 150 hectares of vineyards across the Côte d'Or, Beaujolais, and Mâconnais — including Premier and Grand Cru parcels in Chambertin-Clos de Bèze, Musigny, Bonnes-Mares, Corton-Charlemagne, and Chevalier-Montrachet. Long-time winemaker Jacques Lardière (retired 2012) established a house style of structured, terroir-faithful wines that reward aging. His successor Frédéric Barnier has continued this philosophy while refining viticulture. The iconic Bacchus head label is instantly recognisable. Jadot also produces excellent Beaujolais from owned estates including Château des Jacques in Moulin-à-Vent. Owned since 1985 by the Kopf family (Kobrand Corp.), Jadot remains headquartered in its original Beaune cellars.",
        "attrs": {"founding_year": 1859, "country": "France", "key_products": ["Chambertin-Clos de Bèze","Musigny","Corton-Charlemagne","Chevalier-Montrachet","Beaune Grèves Vigne de l'Enfant Jésus"], "style_philosophy": "Structured, terroir-faithful Burgundy built for aging; consistency from village to Grand Cru"}
    },
    ("Jack Daniel's", "spirits"): {
        "short": "The world's best-selling American whiskey — Tennessee's iconic charcoal-mellowed spirit since 1866.",
        "full": "Jack Daniel's was registered by Jasper Newton 'Jack' Daniel in Lynchburg, Tennessee, in 1866 — making it the oldest registered distillery in the United States. What distinguishes Jack Daniel's from bourbon (though it meets all bourbon requirements) is the Lincoln County Process: filtering the new-make spirit through ten feet of sugar maple charcoal before barrel aging, which imparts a distinctive smoothness. Old No. 7 (the Black Label) is the flagship and the world's best-selling American whiskey. Gentleman Jack is charcoal-mellowed twice. Single Barrel Select offers individual barrel character. The Tennessee Honey and Apple liqueur extensions broadened the brand's reach. The distillery in Lynchburg (pop. ~700) is one of America's most visited. Now owned by Brown-Forman, Jack Daniel's sells over 13 million cases annually.",
        "attrs": {"founding_year": 1866, "country": "USA", "key_products": ["Old No. 7","Gentleman Jack","Single Barrel Select","Tennessee Honey","Tennessee Rye"], "style_philosophy": "Lincoln County Process charcoal mellowing; smooth, accessible Tennessee whiskey at global scale"}
    },
    ("Dassai", "sake"): {
        "short": "Yamaguchi's revolutionary junmai daiginjo specialist — polishing rice to extremes for ethereal purity.",
        "full": "Dassai (獺祭) is produced by Asahi Shuzo in Iwakuni, Yamaguchi Prefecture. The brewery abandoned all grades except junmai daiginjo — an audacious strategy that paid off spectacularly. Using only Yamada Nishiki rice polished to extreme ratios (50%, 39%, and the legendary 23% — meaning 77% of each grain is milled away), Dassai produces sake of crystalline purity and delicate complexity. The 'Beyond' bottling pushes further, with no fixed polishing ratio, aiming for transcendent quality. Dassai's success revitalised a struggling rural brewery and inspired a generation of premium-focused producers. The 2018 opening of Dassai Joel Robuchon in Paris — partnering with the legendary chef — brought Dassai to the fine dining world stage. President Kazuhiro Sakurai's vision of making junmai daiginjo accessible (not just rarified) redefined sake's global image.",
        "attrs": {"founding_year": 1948, "country": "Japan", "key_products": ["Dassai 45","Dassai 39","Dassai 23","Dassai Beyond","Dassai Sparkling"], "style_philosophy": "Junmai daiginjo only; extreme rice polishing; purity, elegance, and accessibility over tradition"}
    },
    ("Domaines Barons de Rothschild", "wine"): {
        "short": "The Lafite Rothschild empire — from First Growth Bordeaux to estates in Chile, Argentina, and China.",
        "full": "Domaines Barons de Rothschild (Lafite) manages the legendary Château Lafite Rothschild, a Bordeaux First Growth since the 1855 Classification. The Rothschild family acquired Lafite in 1868 and has since built an international portfolio: Château Duhart-Milon (Pauillac), Château L'Évangile (Pomerol), Château Rieussec (Sauternes), Viña Los Vascos (Chile), Bodegas CARO with Catena (Argentina), and Long Dai (Shandong, China). Lafite itself produces arguably the most elegant, cerebral Cabernet-dominant wine in Bordeaux — prioritising finesse over power, with extraordinary aging potential (50+ years in top vintages). Carruades de Lafite is the second wine. The Rothschild Collection wines (Légende, Saga) extend the brand to accessible price points. The family's commitment to each property's individual terroir expression, rather than imposing a house style, distinguishes their approach.",
        "attrs": {"founding_year": 1868, "country": "France", "key_products": ["Château Lafite Rothschild","Carruades de Lafite","Duhart-Milon","L'Évangile","Rieussec","Los Vascos"], "style_philosophy": "Elegance over power; terroir fidelity across a global portfolio; the quiet authority of Pauillac First Growth"}
    },
}

for (name, scope), data in brands.items():
    n = update_context("brand", name, scope, data["short"], data["full"], data.get("attrs"))
    count += n
    print(f"  Brand ({scope}): {name} -> {n}", flush=True)

print(f"\nTotal updated: {count}", flush=True)
cur.close()
conn.close()
print("Done!")
