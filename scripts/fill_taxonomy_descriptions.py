#!/usr/bin/env python3
"""Fill taxonomy_contexts with scope-specific descriptions for key entities."""
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
            description_short = %s,
            description_en = %s,
            attributes = COALESCE(%s::jsonb, attributes),
            status = 'validated',
            validated_at = now(),
            updated_at = now()
        WHERE entity_id = (
            SELECT id FROM taxonomy_entities WHERE entity_type = %s AND name = %s
        ) AND scope_id = %s
    """, (description_short, description_en, json.dumps(attributes) if attributes else None,
          entity_type, entity_name, scope_id))
    return cur.rowcount

count = 0

# ============================================================================
# WINE COUNTRIES
# ============================================================================
wine_countries = {
    "France": {
        "short": "The benchmark for fine wine, home to Bordeaux, Burgundy, Champagne, Rhône, Loire, and Alsace.",
        "full": "France defines the global vocabulary of wine. Its appellation system (AOC/AOP) pioneered the concept of terroir-driven classification, tying grape varieties to specific regions and production methods. Bordeaux established the blueprint for Cabernet-Merlot blends and the 1855 Classification. Burgundy elevated Pinot Noir and Chardonnay to their highest expressions through single-vineyard focus. Champagne created the world's most celebrated sparkling wine method. The Rhône Valley produces powerful Syrah-based reds and complex Grenache blends. Loire offers extraordinary diversity from Muscadet to Sancerre. Alsace specialises in aromatic whites. France remains the reference point against which all wine regions measure themselves.",
        "attrs": {"key_grapes": ["Cabernet Sauvignon","Merlot","Pinot Noir","Chardonnay","Syrah","Grenache","Sauvignon Blanc","Chenin Blanc","Riesling","Gamay"], "climate": "Continental, Maritime, Mediterranean", "classification_system": "AOC/AOP, IGP, Vin de France", "terroir": "Limestone, clay, gravel, chalk, schist, granite — enormous geological diversity"}
    },
    "Italy": {
        "short": "The world's most diverse wine producer, with over 500 native grape varieties across 20 regions.",
        "full": "Italy produces more wine than any other country and possesses unmatched grape diversity. Every one of its 20 administrative regions makes wine, from the Alpine foothills of Alto Adige to the volcanic soils of Sicily. Piedmont is celebrated for Nebbiolo-based Barolo and Barbaresco. Tuscany produces Sangiovese-driven Chianti, Brunello di Montalcino, and the innovative Super Tuscans. Veneto contributes Prosecco, Amarone, and Soave. Southern Italy and the islands offer extraordinary value from indigenous varieties like Aglianico, Nero d'Avola, and Primitivo. Italy's DOCG/DOC system classifies over 400 designated wine zones, though innovation frequently occurs outside official boundaries.",
        "attrs": {"key_grapes": ["Sangiovese","Nebbiolo","Barbera","Corvina","Pinot Grigio","Trebbiano","Glera","Aglianico","Nero d'Avola","Primitivo"], "climate": "Alpine, Continental, Mediterranean", "classification_system": "DOCG, DOC, IGT, Vino da Tavola", "terroir": "Volcanic, limestone, clay, alluvial — extreme diversity across the peninsula"}
    },
    "USA": {
        "short": "Led by California's Napa and Sonoma, America produces bold, fruit-forward wines across 50 states.",
        "full": "The United States is the world's fourth-largest wine producer, dominated by California which accounts for roughly 85% of production. Napa Valley has earned global recognition for Cabernet Sauvignon, producing some of the world's most expensive wines. Sonoma offers broader diversity with Pinot Noir, Zinfandel, and Chardonnay across varied microclimates. Oregon's Willamette Valley has emerged as a world-class Pinot Noir region. Washington State's Columbia Valley produces powerful Syrah, Merlot, and Cabernet blends. The AVA (American Viticultural Area) system identifies over 270 grape-growing regions. American winemaking tends toward ripe, generous fruit expression with careful oak integration.",
        "attrs": {"key_grapes": ["Cabernet Sauvignon","Pinot Noir","Chardonnay","Zinfandel","Merlot","Syrah","Sauvignon Blanc","Riesling"], "climate": "Mediterranean (CA), Maritime (OR), Continental (WA)", "classification_system": "AVA (American Viticultural Area)", "terroir": "Volcanic, alluvial, limestone, loam — varies dramatically by state"}
    },
    "Australia": {
        "short": "Known for bold Shiraz and innovative winemaking, spanning cool-climate elegance to warm-region power.",
        "full": "Australia transformed global wine culture with its approachable, fruit-driven style and technical innovation. Barossa Valley Shiraz became the country's signature — rich, concentrated, and age-worthy. But modern Australia is far more diverse: cool-climate regions like Yarra Valley, Mornington Peninsula, and Tasmania produce refined Pinot Noir and Chardonnay rivalling Burgundy in finesse. McLaren Vale offers Grenache-Shiraz-Mourvèdre blends inspired by the Rhône. Margaret River in Western Australia produces world-class Cabernet and Chardonnay. The classification includes GI (Geographical Indication) zones. Australia pioneered screwcap adoption and continues to lead in sustainable viticulture.",
        "attrs": {"key_grapes": ["Shiraz","Cabernet Sauvignon","Chardonnay","Pinot Noir","Grenache","Riesling","Semillon"], "climate": "Mediterranean, Maritime, Continental", "classification_system": "GI (Geographical Indication)", "terroir": "Ancient soils, red earth, limestone, sand — some of the oldest vineyard soils on earth"}
    },
    "Spain": {
        "short": "The most-planted wine country on earth, from Rioja's Tempranillo to Priorat's old-vine Garnacha.",
        "full": "Spain has more vineyard acreage than any country, though yields are often low due to arid conditions. Rioja remains its most recognised region, producing Tempranillo-based reds aged in oak according to a tiered system (Crianza, Reserva, Gran Reserva). Priorat revived old-vine Garnacha and Cariñena into cult wines. Ribera del Duero makes powerful Tempranillo under the local name Tinto Fino. Rías Baixas in Galicia produces crisp Albariño. Sherry from Jerez is one of the world's great fortified wines, ranging from bone-dry Fino to lusciously sweet Pedro Ximénez. Cava from Penedès provides excellent-value traditional-method sparkling. Spain's DO/DOCa system governs quality standards across its diverse regions.",
        "attrs": {"key_grapes": ["Tempranillo","Garnacha","Albariño","Verdejo","Monastrell","Cariñena","Palomino","Pedro Ximénez"], "climate": "Mediterranean, Continental, Atlantic", "classification_system": "DO, DOCa, VP, VdlT", "terroir": "Limestone, slate, granite, clay, chalky albariza"}
    },
    "Chile": {
        "short": "Phylloxera-free vineyards between the Andes and Pacific produce excellent-value Cabernet and Carmenère.",
        "full": "Chile's geography creates ideal wine conditions: the Andes to the east, the Pacific to the west, the Atacama Desert to the north, and Antarctica's influence from the south. Its vines never suffered phylloxera, preserving ungrafted rootstock. Maipo Valley is the heartland of Chilean Cabernet Sauvignon. Carmenère, nearly extinct in Bordeaux, found a second home here and became Chile's signature grape. Casablanca and Leyda produce cool-climate Sauvignon Blanc and Chardonnay. Colchagua and Rapel offer rich reds. The DO system classifies regions from Atacama in the north to Austral in the south. Chile delivers exceptional quality-to-price ratio across all tiers.",
        "attrs": {"key_grapes": ["Cabernet Sauvignon","Carmenère","Merlot","Sauvignon Blanc","Chardonnay","Pinot Noir","País"], "climate": "Mediterranean, with cooling Pacific influence", "classification_system": "DO (Denominación de Origen)", "terroir": "Alluvial, volcanic, granite, with Andean mineral influence"}
    },
    "Argentina": {
        "short": "High-altitude Malbec from Mendoza defines Argentina, with emerging cool-climate regions gaining recognition.",
        "full": "Argentina is South America's largest wine producer and the world's fifth-largest overall. Mendoza, at the foot of the Andes, produces over 70% of Argentine wine and is the undisputed home of Malbec — a grape that achieves deeper colour, riper fruit, and softer tannins here than in its French birthplace of Cahors. High-altitude vineyards in Uco Valley (1,000-1,500m) produce increasingly refined, structured wines. Salta's Cafayate region grows vines at over 2,000m, among the highest in the world. Torrontés, a floral white grape, is Argentina's other signature variety. Patagonia's Río Negro region is emerging for cool-climate Pinot Noir and Chardonnay.",
        "attrs": {"key_grapes": ["Malbec","Torrontés","Cabernet Sauvignon","Bonarda","Chardonnay","Pinot Noir"], "climate": "Continental, high-altitude desert", "classification_system": "DOC, IG", "terroir": "Alluvial, sandy, calcareous, with altitude-driven temperature variation"}
    },
    "New Zealand": {
        "short": "Marlborough Sauvignon Blanc put New Zealand on the map; Central Otago Pinot Noir keeps it there.",
        "full": "New Zealand's wine industry exploded globally with Marlborough Sauvignon Blanc in the 1980s — intensely aromatic, with trademark passionfruit and cut-grass characters. Today the country produces world-class wines across multiple styles. Central Otago, the world's southernmost wine region, makes Pinot Noir of exceptional purity. Hawke's Bay produces Bordeaux-style reds and Syrah. Martinborough rivals Central Otago for Pinot Noir quality. Waipara in Canterbury offers excellent Riesling and Pinot Noir. The GI (Geographical Indication) system identifies distinct growing regions. New Zealand's cool maritime climate, long sunshine hours, and dramatic diurnal temperature swings create wines with vivid fruit expression and bright natural acidity.",
        "attrs": {"key_grapes": ["Sauvignon Blanc","Pinot Noir","Chardonnay","Syrah","Pinot Gris","Riesling"], "climate": "Cool maritime, with significant diurnal variation", "classification_system": "GI (Geographical Indication)", "terroir": "Greywacke, limestone, clay, volcanic, alluvial"}
    },
    "Germany": {
        "short": "The world's greatest Riesling producer, from bone-dry Grosses Gewächs to luscious Trockenbeerenauslese.",
        "full": "Germany is defined by Riesling, which achieves an unmatched range of styles here — from razor-sharp dry (trocken) to ethereally sweet Trockenbeerenauslese and Eiswein. The Mosel's steep slate slopes produce Rieslings of extraordinary delicacy. Rheingau combines power and elegance. Pfalz and Rheinhessen are the volume leaders with increasingly impressive quality. Baden, the warmest region, produces excellent Spätburgunder (Pinot Noir). Germany's Prädikat system classifies wines by ripeness at harvest (Kabinett through TBA), while the VDP classification ranks vineyards from Gutswein to Grosses Gewächs, inspired by Burgundy's cru hierarchy. German wines typically show lower alcohol, precise acidity, and extraordinary transparency of terroir.",
        "attrs": {"key_grapes": ["Riesling","Spätburgunder (Pinot Noir)","Müller-Thurgau","Silvaner","Grauburgunder","Weissburgunder"], "climate": "Cool continental, with moderating river influence", "classification_system": "Prädikat (QmP), VDP Grosses Gewächs", "terroir": "Slate, limestone, loess, volcanic, sandstone"}
    },
    "South Africa": {
        "short": "Stellenbosch leads South Africa's wine renaissance, with old-vine Chenin Blanc and Pinotage as signatures.",
        "full": "South Africa's winemaking dates to 1659, but its modern renaissance began post-apartheid in the 1990s. Stellenbosch produces the finest Bordeaux-style blends and Cabernet Sauvignon. The Swartland revolution brought old-vine Chenin Blanc, Grenache, and Syrah to global attention through minimal-intervention winemaking. Pinotage, a local crossing of Pinot Noir and Cinsault, remains uniquely South African though divisive. Constantia revived its historic dessert wine tradition. Elgin and Walker Bay offer cool-climate Pinot Noir and Chardonnay. The Wine of Origin (WO) system defines geographical units, regions, districts, and wards. South Africa's ancient granite and shale soils — some over 500 million years old — contribute mineral complexity.",
        "attrs": {"key_grapes": ["Chenin Blanc","Pinotage","Cabernet Sauvignon","Syrah","Chardonnay","Sauvignon Blanc"], "climate": "Mediterranean, with Atlantic cooling", "classification_system": "WO (Wine of Origin)", "terroir": "Granite, shale, Table Mountain sandstone — ancient Precambrian soils"}
    },
    "Portugal": {
        "short": "Beyond Port, Portugal offers extraordinary native-grape diversity from Douro reds to Vinho Verde whites.",
        "full": "Portugal punches far above its weight with over 250 native grape varieties found nowhere else. The Douro Valley produces both Port (one of the world's greatest fortified wines) and increasingly celebrated unfortified reds from Touriga Nacional, Tinta Roriz, and Touriga Franca. Alentejo delivers rich, accessible reds. Dão produces elegant, mineral-driven wines. Vinho Verde in the north is not a grape but a region, producing crisp, often lightly sparkling whites from Alvarinho and Loureiro. Bairrada champions Baga for structured, long-lived reds. Madeira produces indestructible fortified wines with extraordinary longevity. Portugal's DOC system and the Vinho Regional classification frame a wine culture that rewards exploration.",
        "attrs": {"key_grapes": ["Touriga Nacional","Tinta Roriz","Touriga Franca","Alvarinho","Baga","Encruzado","Loureiro"], "climate": "Atlantic, Mediterranean, Continental (inland)", "classification_system": "DOC, Vinho Regional", "terroir": "Schist (Douro), granite, limestone, basalt, clay"}
    },
    "Austria": {
        "short": "Grüner Veltliner and precise Riesling from Wachau lead Austria's quality-focused wine culture.",
        "full": "Austria is a small but quality-obsessed wine nation. Grüner Veltliner is its flagship — peppery, mineral, and versatile from everyday drinking to age-worthy single-vineyard bottlings. Wachau, along the Danube, produces Austria's most celebrated dry Rieslings and Grüner Veltliners, classified by the local Vinea Wachau system (Steinfeder, Federspiel, Smaragd). Kamptal and Kremstal offer excellent value. Burgenland in the east produces rich reds from Blaufränkisch and Zweigelt, plus the sweet wines of Neusiedlersee. The DAC (Districtus Austriae Controllatus) system emphasises regional typicity. Austrian winemaking combines German-speaking precision with a warmer, more generous Pannonian climate influence.",
        "attrs": {"key_grapes": ["Grüner Veltliner","Riesling","Blaufränkisch","Zweigelt","St. Laurent","Welschriesling"], "climate": "Continental with Pannonian influence", "classification_system": "DAC, Vinea Wachau (Smaragd/Federspiel/Steinfeder)", "terroir": "Loess, primary rock, gneiss, limestone, volcanic"}
    },
    "Japan": {
        "short": "Japan's emerging wine scene centres on Koshu from Yamanashi and cool-climate varieties from Hokkaido.",
        "full": "Japan's wine industry is small but rapidly gaining international recognition. Yamanashi Prefecture, west of Tokyo, is the historic centre, producing delicate wines from Koshu — a pink-skinned grape introduced via the Silk Road over 1,000 years ago. Koshu produces light, mineral whites that pair beautifully with Japanese cuisine. Nagano Prefecture is emerging for Merlot and Chardonnay at altitude. Hokkaido's cool climate suits Germanic varieties and Pinot Noir. Muscat Bailey A, a Japanese crossing, makes light, fruity reds. Japanese winemakers bring meticulous attention to detail from their sake-brewing heritage. The GI system was recently strengthened to define quality standards for Yamanashi, Hokkaido, and other regions.",
        "attrs": {"key_grapes": ["Koshu","Muscat Bailey A","Merlot","Chardonnay","Pinot Noir"], "climate": "Humid continental to subarctic (Hokkaido)", "classification_system": "GI (Geographical Indication)", "terroir": "Volcanic, alluvial fans, granite"}
    },
    "Thailand": {
        "short": "Tropical viticulture pioneer, producing wines from Hua Hin, Khao Yai, and the Chateau de Loei highlands.",
        "full": "Thailand defies conventional viticultural wisdom by producing wine in a tropical latitude. The key regions are Khao Yai (Nakhon Ratchasima, ~350m elevation), Hua Hin Hills, and the highlands near Loei in the northeast. The monsoon climate means two potential growing seasons per year; vines are managed to produce their main crop during the dry, cooler winter months (November–March). Chenin Blanc, Colombard, Syrah, and Tempranillo have shown promise. GranMonte in Khao Yai and Monsoon Valley in Hua Hin are leading producers. While not competing with traditional wine regions, Thai wines are increasingly well-made and pair naturally with the country's vibrant cuisine.",
        "attrs": {"key_grapes": ["Chenin Blanc","Colombard","Syrah","Tempranillo","Cabernet Sauvignon","Pokdum"], "climate": "Tropical monsoon, with altitude-mitigated heat", "classification_system": "No formal appellation system", "terroir": "Laterite, limestone, basalt, sandy loam"}
    },
}

for name, data in wine_countries.items():
    n = update_context("country", name, "wine", data["short"], data["full"], data.get("attrs"))
    count += n
    print(f"  Wine: {name} -> {n} updated", flush=True)

# ============================================================================
# SPIRITS COUNTRIES
# ============================================================================
spirits_countries = {
    "Scotland": {
        "short": "The birthplace of Scotch whisky, with five distinct regions producing the world's most revered single malts and blends.",
        "full": "Scotland is synonymous with whisky. Its five whisky regions each impart distinct character: Speyside produces the largest number of distilleries with typically fruity, elegant malts; Islay is famed for intensely peaty, maritime-influenced whiskies; the Highlands encompass enormous diversity from light and floral to rich and sherried; the Lowlands offer gentle, grassy, approachable styles; and Campbeltown, once Scotland's whisky capital, produces complex, briny malts from its few remaining distilleries. Scotch must be distilled and matured in Scotland for a minimum of three years in oak casks. The Scotch Whisky Association regulates production categories: Single Malt, Single Grain, Blended Malt, Blended Grain, and Blended Scotch Whisky.",
        "attrs": {"distillation_method": "Pot still (malt), column still (grain)", "base_ingredient": "Malted barley, grain", "aging_tradition": "Minimum 3 years in oak; commonly ex-bourbon and ex-sherry casks", "key_styles": ["Single Malt","Blended","Peated","Sherried","Cask Strength"], "regulation": "Scotch Whisky Regulations 2009"}
    },
    "France": {
        "short": "Home to Cognac, Armagnac, Calvados, and a rich tradition of liqueurs and eaux-de-vie.",
        "full": "France's spirits tradition extends far beyond wine. Cognac, from the Charente region, is the world's most prestigious grape brandy — double-distilled in copper pot stills, aged in Limousin or Tronçais oak, and classified by age (VS, VSOP, XO, XXO). Armagnac, from Gascony, predates Cognac and is typically single-distilled, producing a more rustic, characterful brandy. Calvados, from Normandy, is apple (and sometimes pear) brandy aged in oak. France also produces extraordinary eaux-de-vie (fruit brandies) from Alsace, and its liqueur heritage includes Chartreuse, Cointreau, Grand Marnier, and Bénédictine. French gin production has emerged recently, often incorporating botanicals from specific terroirs.",
        "attrs": {"distillation_method": "Pot still (Cognac), column/hybrid (Armagnac)", "base_ingredient": "Grape (Cognac/Armagnac), apple (Calvados), various fruits", "aging_tradition": "Limousin/Tronçais oak for Cognac; black Gascon oak for Armagnac", "key_styles": ["Cognac VS/VSOP/XO","Armagnac","Calvados","Eau-de-vie","Liqueur"], "regulation": "AOC for Cognac, Armagnac, Calvados"}
    },
    "Japan": {
        "short": "Japanese whisky has achieved cult status, blending Scottish technique with meticulous Japanese craftsmanship.",
        "full": "Japanese whisky was modelled on Scotch after Masataka Taketsuru studied distilling in Scotland in the 1920s. Today it stands as a world-class category in its own right. Suntory (Yamazaki, Hakushu) and Nikka (Yoichi, Miyagikyo) are the dominant houses, but craft distilleries are multiplying. Japanese whisky is characterised by exceptional balance, subtlety, and precision. Mizunara (Japanese oak) cask aging imparts distinctive sandalwood and incense notes found nowhere else. The industry recently adopted stricter labelling standards requiring Japanese whisky to be distilled, aged, and bottled in Japan. Beyond whisky, Japan produces shochu (distilled from barley, sweet potato, or rice), awamori from Okinawa, and an emerging gin category using native botanicals like yuzu, sansho pepper, and sakura.",
        "attrs": {"distillation_method": "Pot still, column still", "base_ingredient": "Malted barley, grain (whisky); barley, sweet potato, rice (shochu)", "aging_tradition": "Ex-bourbon, ex-sherry, Mizunara oak, ex-wine", "key_styles": ["Single Malt","Blended","Shochu","Awamori","Japanese Gin"], "regulation": "Japan Spirits & Liqueurs Makers Association standards (2021)"}
    },
    "Ireland": {
        "short": "Triple-distilled for smoothness, Irish whiskey is the world's fastest-growing spirits category.",
        "full": "Irish whiskey was once the world's most popular spirit before near-extinction in the 20th century. Its renaissance is remarkable — from just two operating distilleries in the 1980s to over 40 today. Irish whiskey is typically triple-distilled (vs. double for Scotch), producing a smoother, lighter character. Single Pot Still whiskey, made from a mix of malted and unmalted barley, is uniquely Irish — creamy, spicy, and complex. Major brands (Jameson, Bushmills, Redbreast, Midleton) anchor the category, while new craft distilleries push boundaries. Irish whiskey must be distilled and aged in Ireland for at least three years in wooden casks. Peated Irish whiskey, though rare, is historically authentic — Connemara being the best-known example.",
        "attrs": {"distillation_method": "Pot still (triple distillation typical)", "base_ingredient": "Malted barley, unmalted barley, grain", "aging_tradition": "Minimum 3 years; ex-bourbon dominant, ex-sherry, virgin oak", "key_styles": ["Single Pot Still","Single Malt","Blended","Single Grain","Peated"], "regulation": "Irish Whiskey Act 1980, Technical File 2014"}
    },
    "USA": {
        "short": "Bourbon, rye, and American craft spirits lead a dynamic and innovative spirits culture.",
        "full": "The United States has the world's most dynamic spirits scene. Bourbon, America's native spirit, must be made from at least 51% corn, distilled to no more than 160 proof, and aged in new charred American oak barrels — producing the signature vanilla, caramel, and oak character. Kentucky produces 95% of bourbon. Tennessee whiskey (Jack Daniel's, George Dickel) adds the Lincoln County Process — charcoal filtering before aging. Rye whiskey has seen explosive growth, offering spicier, drier character. American craft distilling has exploded since 2000, with over 2,500 distilleries producing gin, vodka, rum, and regional spirits. American single malt whisky is an emerging category with recently established standards.",
        "attrs": {"distillation_method": "Column still (bourbon), pot still (craft)", "base_ingredient": "Corn (bourbon), rye, various grains", "aging_tradition": "New charred American oak (bourbon); various for craft", "key_styles": ["Bourbon","Tennessee Whiskey","Rye","American Single Malt","Craft Gin"], "regulation": "TTB Standards of Identity; Bourbon legally defined since 1964"}
    },
    "Mexico": {
        "short": "Tequila and mezcal — agave-based spirits rooted in centuries of tradition — are Mexico's gift to the world.",
        "full": "Mexico's spirits identity is built on agave. Tequila, made exclusively from blue Weber agave in designated regions (primarily Jalisco), ranges from the crisp, vegetal character of Blanco to the oak-influenced complexity of Añejo and Extra Añejo. Mezcal, the broader category encompassing any agave-based spirit, is produced primarily in Oaxaca from various agave species — Espadín being most common, while wild varieties like Tobalá, Tepeztate, and Madrecuixe offer extraordinary complexity. Traditional mezcal production involves roasting agave hearts in earthen pit ovens, lending the characteristic smoky quality. The Consejo Regulador del Tequila (CRT) and Consejo Regulador del Mezcal govern production standards. Both categories are experiencing unprecedented global demand.",
        "attrs": {"distillation_method": "Pot still (copper or clay), column still (industrial tequila)", "base_ingredient": "Blue Weber agave (tequila), various agave species (mezcal)", "aging_tradition": "Blanco (unaged), Reposado (2-12 months), Añejo (1-3 years), Extra Añejo (3+ years)", "key_styles": ["Tequila Blanco","Tequila Reposado","Tequila Añejo","Mezcal Joven","Mezcal Reposado"], "regulation": "CRT (Tequila), CRM (Mezcal), NOM standards"}
    },
    "Cuba": {
        "short": "The birthplace of light-bodied rum, Cuban spirits tradition shaped cocktail culture worldwide.",
        "full": "Cuba's rum heritage is inseparable from the history of cocktails. Havana Club, the island's iconic brand, exemplifies the Cuban style: light, clean, and elegant, achieved through column distillation and careful aging in tropical conditions. The Spanish column-still tradition distinguishes Cuban rum from the pot-still heaviness of Jamaica or the funky character of Barbados. Aging in Cuba's heat accelerates maturation — a 7-year Cuban rum may have the complexity of a much older spirit from cooler climates, though the angel's share is considerably higher. Ron Santiago de Cuba and Ron Cubay also produce quality expressions. Cuban rum was foundational to the Daiquiri, Mojito, Cuba Libre, and El Presidente cocktails, cementing Havana's place in global bar culture.",
        "attrs": {"distillation_method": "Column still (Spanish tradition)", "base_ingredient": "Sugarcane molasses", "aging_tradition": "Tropical aging in ex-bourbon barrels; solera-influenced blending", "key_styles": ["Ron Ligero (Light)","Añejo","Reserva","Extra Añejo"], "regulation": "Cuban standards body; DOP Havana Club"}
    },
    "Thailand": {
        "short": "Thai spirits range from traditional white spirits to an emerging craft scene producing rum, gin, and whisky.",
        "full": "Thailand's spirits landscape is evolving. Traditional Thai white spirits (Lao Khao) are distilled from rice and sugarcane — a centuries-old tradition. The modern scene is led by Chalong Bay, which produces high-quality rum from Phuket sugarcane. Iron Balls gin from Bangkok has gained international recognition. The Asura brand produces artisanal Thai white spirits from potato, sugarcane, and lychee at higher proof points than traditional Lao Khao. Mekhong, though marketed as whisky, is technically a rum-based spirit with traditional herbs. Thailand's tropical climate creates rapid maturation for barrel-aged spirits. The emerging craft distillery scene is small but ambitious, drawing on Thailand's rich botanical heritage — galangal, lemongrass, kaffir lime, and pandan.",
        "attrs": {"distillation_method": "Pot still (craft), column still (commercial)", "base_ingredient": "Rice, sugarcane, molasses, potato, various botanicals", "aging_tradition": "Tropical aging; most spirits unaged or briefly aged", "key_styles": ["Lao Khao (White Spirit)","Thai Rum","Thai Gin","Herbal Spirits"], "regulation": "Excise Department standards"}
    },
}

for name, data in spirits_countries.items():
    n = update_context("country", name, "spirits", data["short"], data["full"], data.get("attrs"))
    count += n
    print(f"  Spirits: {name} -> {n} updated", flush=True)

# ============================================================================
# WINE REGIONS (Top 15)
# ============================================================================
wine_regions = {
    "Bordeaux": {
        "short": "The world's most famous wine region, defined by Left Bank Cabernet and Right Bank Merlot.",
        "full": "Bordeaux is the reference point for fine wine. The Left Bank (Médoc, Graves, Pessac-Léognan) produces Cabernet Sauvignon-dominant blends from gravel soils — structured, tannic, and long-lived. The Right Bank (Saint-Émilion, Pomerol) favours Merlot on clay and limestone, producing rounder, earlier-drinking wines. The 1855 Classification established the hierarchy of Médoc estates still used today. Between these poles lies an extraordinary range of quality, from everyday Bordeaux to First Growth legends. Dry whites from Pessac-Léognan and sweet Sauternes add further dimension. Bordeaux's maritime climate, moderated by the Gironde estuary and Atlantic Ocean, creates vintage variation that rewards understanding.",
        "attrs": {"key_grapes": ["Cabernet Sauvignon","Merlot","Cabernet Franc","Petit Verdot","Semillon","Sauvignon Blanc"], "climate": "Maritime, moderated by Gironde estuary", "soil": "Gravel (Left Bank), clay-limestone (Right Bank), sand", "classification_system": "1855 Classification, Saint-Émilion Classification, Cru Bourgeois"}
    },
    "Burgundy": {
        "short": "Terroir in its purest expression — single-vineyard Pinot Noir and Chardonnay of transcendent quality.",
        "full": "Burgundy is wine's ultimate terroir expression. From Chablis in the north to Beaujolais in the south, this narrow strip produces the world's most sought-after Pinot Noir (red) and Chardonnay (white) from meticulously classified single vineyards. The hierarchy — Regional, Village, Premier Cru, Grand Cru — reflects centuries of observation about which slopes produce the finest wines. The Côte d'Or (divided into Côte de Nuits for reds and Côte de Beaune for whites) contains 33 Grand Cru vineyards. Small-scale production, fragmented ownership (thanks to Napoleonic inheritance laws), and enormous demand make top Burgundy among the world's most expensive wines. The best examples display a transparency to place that no other region consistently achieves.",
        "attrs": {"key_grapes": ["Pinot Noir","Chardonnay","Gamay","Aligoté"], "climate": "Cool continental", "soil": "Limestone, marl, clay — the Kimmeridgian limestone of Chablis is iconic", "classification_system": "Grand Cru, Premier Cru, Village, Regional (Bourgogne)"}
    },
    "Champagne": {
        "short": "The world's most celebrated sparkling wine region, producing méthode traditionnelle wines of unmatched prestige.",
        "full": "Champagne is both a place and a method. Located at the northern limit of French viticulture, its cool climate and chalk soils produce base wines with high acidity — ideal for the secondary fermentation in bottle that defines méthode champenoise. The three main grapes are Chardonnay (finesse, citrus), Pinot Noir (body, red fruit), and Pinot Meunier (roundness, approachability). Non-vintage blends maintain consistent house style across years. Vintage Champagne is produced only in exceptional years. Prestige cuvées (Dom Pérignon, Krug, Cristal) represent the pinnacle. Grower Champagne — from récoltant-manipulant producers who grow their own grapes — has surged in quality and recognition, offering terroir-driven alternatives to the grandes maisons.",
        "attrs": {"key_grapes": ["Chardonnay","Pinot Noir","Pinot Meunier"], "climate": "Cool continental, at the northern limit of viticulture", "soil": "Chalk (Côte des Blancs), clay-limestone, sand", "classification_system": "Grand Cru (17 villages), Premier Cru (42 villages)"}
    },
    "Tuscany": {
        "short": "Sangiovese country — from Chianti and Brunello di Montalcino to the iconoclastic Super Tuscans.",
        "full": "Tuscany is Italy's most prestigious wine region, built on Sangiovese. Chianti Classico, in the hills between Florence and Siena, produces Sangiovese of varying quality from charming to profound. Brunello di Montalcino demands 100% Sangiovese aged for five years before release — powerful, tannic, and exceptionally long-lived. Vino Nobile di Montepulciano offers a middle ground. The Super Tuscan movement, born in the 1970s when producers like Sassicaia and Tignanello broke DOCG rules to blend Cabernet Sauvignon with Sangiovese (or use international varieties alone), created a new category of Italian fine wine. Bolgheri on the coast has become Italy's answer to the Left Bank. Vernaccia di San Gimignano and Vermentino provide white wine interest.",
        "attrs": {"key_grapes": ["Sangiovese","Cabernet Sauvignon","Merlot","Syrah","Vernaccia","Vermentino"], "climate": "Mediterranean, continental in the hills", "soil": "Galestro (flakey clay-schist), alberese (limestone), sand, clay", "classification_system": "DOCG (Brunello, Chianti Classico, Vino Nobile), DOC, IGT"}
    },
    "Napa": {
        "short": "America's most famous wine valley — Cabernet Sauvignon of power, concentration, and global acclaim.",
        "full": "Napa Valley's 30-mile length contains 16 AVAs with remarkably diverse microclimates and soils. The valley floor, benchlands, and mountain vineyards each produce distinct Cabernet Sauvignon styles — from the elegant, structured wines of Oakville and Rutherford to the intense, tannic mountain Cabernets of Howell Mountain, Spring Mountain, and Atlas Peak. The Stags Leap District produced the wines that won the 1976 Judgement of Paris, changing the wine world forever. Napa also excels with Chardonnay (Carneros), Merlot, and Cabernet Franc. While dominated by premium and ultra-premium production, Napa's average bottle price is the highest of any major wine region globally. The combination of warm days, cool nights (from Pacific fog), and volcanic soils creates wines of remarkable intensity.",
        "attrs": {"key_grapes": ["Cabernet Sauvignon","Chardonnay","Merlot","Cabernet Franc","Sauvignon Blanc"], "climate": "Mediterranean with fog influence, warm days, cool nights", "soil": "Volcanic, alluvial, clay-loam, gravelly benchland", "classification_system": "AVA (16 sub-AVAs within Napa Valley)"}
    },
    "Piedmont": {
        "short": "Home to Barolo and Barbaresco — Italy's greatest Nebbiolo wines, requiring patience and rewarding it magnificently.",
        "full": "Piedmont in northwest Italy produces some of the country's most profound wines. Barolo and Barbaresco, both made from Nebbiolo, are among Italy's most age-worthy reds — pale in colour but monumental in structure, with flavours of tar, roses, dried cherry, and truffle that develop over decades. The Langhe hills, a UNESCO World Heritage site, provide the specific combination of altitude, aspect, and marl-limestone soils that Nebbiolo demands. Barbera d'Asti and Barbera d'Alba offer earlier-drinking pleasure with vibrant acidity and dark fruit. Moscato d'Asti is one of the world's finest sweet sparkling wines. Gavi (from Cortese) provides crisp whites. Piedmont's vineyard culture, combined with its truffle and gastronomy traditions, makes it one of the world's great food-and-wine destinations.",
        "attrs": {"key_grapes": ["Nebbiolo","Barbera","Dolcetto","Moscato","Cortese","Arneis"], "climate": "Continental, with Alpine influence and autumn fog", "soil": "Calcareous marl, clay-limestone, sand (Tortonian and Helvetian soils)", "classification_system": "DOCG (Barolo, Barbaresco, Barbera d'Asti), DOC"}
    },
    "Rhône Valley": {
        "short": "Syrah-driven Northern Rhône and Grenache-dominated Southern Rhône — two distinct wine worlds in one valley.",
        "full": "The Rhône Valley divides into two distinct halves. The Northern Rhône is a narrow corridor of steep, terraced vineyards where Syrah reigns supreme: Côte-Rôtie produces perfumed, elegant Syrah; Hermitage makes monumental, long-lived reds and whites; Cornas offers powerful, brooding Syrah at often better value. Condrieu and Château-Grillet produce rare, exotically aromatic Viognier. The Southern Rhône is warmer, wider, and dominated by Grenache-based blends: Châteauneuf-du-Pape (up to 13 permitted varieties) sets the standard; Gigondas and Vacqueyras offer serious alternatives; Côtes du Rhône and Côtes du Rhône-Villages provide everyday drinking of remarkable quality. The region's garrigue landscape — lavender, thyme, rosemary — often appears in the wines themselves.",
        "attrs": {"key_grapes": ["Syrah","Grenache","Mourvèdre","Viognier","Marsanne","Roussanne","Cinsault"], "climate": "Continental (North), Mediterranean (South), Mistral wind influence", "soil": "Granite, schist (North); galets roulés (round stones), limestone, sand (South)", "classification_system": "AOC: Côte-Rôtie, Hermitage, Châteauneuf-du-Pape, Côtes du Rhône, etc."}
    },
    "Barossa": {
        "short": "Australia's Shiraz heartland — old vines, warm climate, and wines of extraordinary depth and generosity.",
        "full": "The Barossa Valley in South Australia is home to some of the world's oldest continuously producing vineyards — pre-phylloxera Shiraz vines planted in the 1840s that are still bearing fruit. This heritage is the Barossa's unique asset: wines of concentration and complexity impossible to replicate from young vines. Penfolds Grange, Australia's most iconic wine, draws primarily on Barossa fruit. Beyond Shiraz, the region produces excellent Grenache (particularly old-vine), Cabernet Sauvignon, and increasingly impressive Mataro (Mourvèdre). The adjacent Eden Valley, at higher elevation, produces Australia's finest Riesling alongside more elegant Shiraz. The Barossa's Mediterranean climate with warm days and cooling afternoon breezes ensures full ripeness while preserving varietal character.",
        "attrs": {"key_grapes": ["Shiraz","Grenache","Cabernet Sauvignon","Mataro (Mourvèdre)","Riesling (Eden Valley)"], "climate": "Mediterranean, warm continental", "soil": "Red-brown earth, sandy loam, clay over limestone", "classification_system": "GI Barossa Valley, GI Eden Valley"}
    },
    "Rioja": {
        "short": "Spain's most recognised wine region, defined by Tempranillo and a revered oak-aging tradition.",
        "full": "Rioja has been Spain's flagship wine region for over a century. Located in north-central Spain along the Ebro River, it divides into three zones: Rioja Alta (highest elevation, coolest, most elegant wines), Rioja Alavesa (Basque-influenced, similar in style to Alta), and Rioja Oriental (formerly Rioja Baja — warmer, riper, contributing power to blends). Tempranillo dominates, supported by Garnacha, Graciano, and Mazuelo. The traditional aging classification — Joven, Crianza, Reserva, Gran Reserva — reflects mandatory minimum aging in both barrel and bottle. Modern Rioja increasingly includes single-vineyard wines and producers challenging the traditional American oak paradigm with French oak or concrete. White Rioja, both barrel-fermented and unoaked Viura, is experiencing a renaissance.",
        "attrs": {"key_grapes": ["Tempranillo","Garnacha","Graciano","Mazuelo (Cariñena)","Viura"], "climate": "Continental-Mediterranean transitional, Atlantic influence", "soil": "Clay-limestone (Alta/Alavesa), alluvial (Oriental), ferrous clay", "classification_system": "DOCa; Joven, Crianza, Reserva, Gran Reserva; Viñedo Singular"}
    },
    "Mendoza": {
        "short": "Argentina's wine capital at the foot of the Andes — the world's definitive Malbec region.",
        "full": "Mendoza produces over 70% of Argentine wine and has become synonymous with Malbec. At elevations ranging from 600 to 1,500 metres, vineyards benefit from intense sunshine, dramatic day-night temperature swings, and virtually no rainfall (irrigation from Andean snowmelt is essential). The Uco Valley subregions — Tupungato, Tunuyán, San Carlos — at the highest elevations produce the most refined, mineral-driven Malbec. Luján de Cuyo, at slightly lower elevation, offers rounder, more immediately generous wines. Maipú is the historical centre. Beyond Malbec, Mendoza produces excellent Cabernet Sauvignon, increasingly impressive Cabernet Franc, and structured Bonarda. The region's alluvial, sandy, and calcareous soils at altitude create a viticultural environment unique in the world.",
        "attrs": {"key_grapes": ["Malbec","Cabernet Sauvignon","Cabernet Franc","Bonarda","Chardonnay","Torrontés"], "climate": "High-altitude continental desert, extreme diurnal range", "soil": "Alluvial, sandy, calcareous, with Andean rock fragments", "classification_system": "DOC Luján de Cuyo, GI system for sub-regions"}
    },
}

for name, data in wine_regions.items():
    n = update_context("region", name, "wine", data["short"], data["full"], data.get("attrs"))
    count += n
    print(f"  Wine Region: {name} -> {n} updated", flush=True)

print(f"\nTotal updated: {count}")
cur.close()
conn.close()
print("Done!")
