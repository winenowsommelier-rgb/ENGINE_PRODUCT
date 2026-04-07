/**
 * Batch 3: Fill taxonomy descriptions for high-impact entities.
 * Run: npx tsx scripts/fill_taxonomy_batch3.ts
 */
import { getTaxonomyDb } from '../lib/taxonomy-db';

const db = getTaxonomyDb();

const update = db.prepare(`
  UPDATE taxonomy_contexts SET
    description_short = ?, description_en = ?,
    attributes = ?, status = 'validated',
    validated_at = datetime('now'), updated_at = datetime('now')
  WHERE entity_id = (
    SELECT id FROM taxonomy_entities WHERE entity_type = ? AND name = ?
  ) AND scope_id = ?
`);

function u(entityType: string, name: string, scopeId: string, short: string, full: string, attrs?: any) {
  const r = update.run(short, full, JSON.stringify(attrs || {}), entityType, name, scopeId);
  return r.changes;
}

let count = 0;

// ═══════════════════════════════════════════════════════════════════════════
// WINE COUNTRIES
// ═══════════════════════════════════════════════════════════════════════════

count += u('country', 'Hungary', 'wine',
  'Historic wine nation renowned for Tokaji Aszú, one of the world\'s great sweet wines, and increasingly impressive dry whites and reds.',
  'Hungary\'s winemaking history stretches back over a thousand years. Tokaj was the world\'s first classified wine region (1737), and Tokaji Aszú — made from botrytised Furmint grapes — was prized by European royalty for centuries. The country has 22 wine regions spanning diverse terroir. Beyond Tokaj, Eger produces the legendary Bikavér (Bull\'s Blood) blend and fine Kadarka. Villány in the south has emerged as a serious red wine region, particularly for Cabernet Franc. Somló produces distinctive mineral whites from volcanic soils. The indigenous Furmint grape is experiencing a renaissance as a dry varietal, showing remarkable acidity and ageability.',
  { key_grapes: ["Furmint", "Hárslevelű", "Kadarka", "Kékfrankos", "Cabernet Franc", "Olaszrizling"], climate: "Continental with some Mediterranean influence in the south", classification_system: "OEM (Oltalom alatt álló Eredetmegjelölés), DHC for Tokaj", soil: "Volcanic (Somló, Tokaj), loess, limestone, clay" });

count += u('country', 'Greece', 'wine',
  'One of the oldest wine-producing countries, with indigenous varieties like Assyrtiko and Xinomavro gaining international recognition.',
  'Greece has produced wine continuously for over 4,000 years, making it one of the cradles of European viticulture. After decades of producing primarily bulk wine and Retsina, a quality revolution began in the 1980s. Santorini\'s Assyrtiko — grown on volcanic ash in wind-trained basket vines (kouloura) — has become one of the world\'s most distinctive white wines. Xinomavro from Naoussa in Macedonia is often compared to Nebbiolo for its tannic structure and aging potential. Agiorgitiko from Nemea produces rich, approachable reds. The Peloponnese, Macedonia, Crete, and the Aegean islands each contribute unique expressions. Greece\'s PDO/PGI system now protects over 30 appellations.',
  { key_grapes: ["Assyrtiko", "Xinomavro", "Agiorgitiko", "Moschofilero", "Malagousia", "Mavrodaphne"], climate: "Mediterranean, volcanic island, continental in north", classification_system: "PDO (OPAP/OPE), PGI", soil: "Volcanic ash (Santorini), limestone, schist, clay" });

count += u('country', 'Lebanon', 'wine',
  'The Bekaa Valley\'s ancient winemaking tradition produces world-class Bordeaux-style blends and indigenous varieties.',
  'Lebanon is one of the oldest wine-producing regions on earth — Phoenician traders spread viticulture across the Mediterranean from these shores. Modern Lebanese wine centres on the Bekaa Valley, at 900-1,100 metres elevation between the Lebanon and Anti-Lebanon mountain ranges. Château Musar, founded in 1930, brought international attention with its idiosyncratic Cabernet-Cinsault-Carignan blends. Château Kefraya and Château Ksara are other major producers. The high altitude provides cool nights that preserve acidity, while warm days ensure full ripeness. Despite political instability, Lebanese winemakers have maintained remarkable quality and consistency.',
  { key_grapes: ["Cabernet Sauvignon", "Cinsault", "Carignan", "Syrah", "Merlot", "Obaideh", "Merwah"], climate: "Mediterranean continental, high-altitude", classification_system: "No formal appellation system", soil: "Limestone, clay, gravel in the Bekaa Valley" });

count += u('country', 'Georgia', 'wine',
  'The cradle of wine — 8,000 years of continuous winemaking, home to qvevri (clay vessel) fermentation and over 500 indigenous varieties.',
  'Archaeological evidence dates Georgian winemaking to approximately 6000 BC, making it the world\'s oldest known wine culture. Georgia\'s signature tradition is qvevri winemaking — fermenting and aging wine in large clay vessels buried underground, a practice recognised by UNESCO as Intangible Cultural Heritage. Kakheti in eastern Georgia produces over 70% of the country\'s wine. Amber wines (orange wines), made from white grapes fermented on their skins in qvevri, have become a global phenomenon. Saperavi is the principal red grape, producing deeply coloured, tannic wines. Rkatsiteli is the dominant white, used for both conventional and qvevri-style wines. Georgia claims over 500 indigenous grape varieties, though fewer than 40 are in commercial production.',
  { key_grapes: ["Saperavi", "Rkatsiteli", "Mtsvane", "Kisi", "Chinuri", "Tavkveri"], climate: "Continental, moderated by Caucasus mountains and Black Sea", classification_system: "PDO system under EU association agreement", soil: "Alluvial, volcanic, limestone, clay" });

count += u('country', 'England', 'wine',
  'England\'s sparkling wines now rival Champagne, driven by chalk soils and a warming climate in the South.',
  'English wine has undergone a dramatic transformation. Climate change has made southern England viable for quality viticulture, and the chalk soils of Sussex, Kent, and Hampshire are geologically identical to those of Champagne. Traditional-method sparkling wines from Chardonnay, Pinot Noir, and Pinot Meunier now regularly beat Champagne in blind tastings. Nyetimber, Ridgeview, Gusbourne, and Wiston Estate lead the quality charge. Still Bacchus and Chardonnay show increasing promise. Plantings have expanded rapidly — over 4,000 hectares now under vine — and the PDO system includes designations for Sussex and Hampshire.',
  { key_grapes: ["Chardonnay", "Pinot Noir", "Pinot Meunier", "Bacchus", "Seyval Blanc"], climate: "Cool maritime, increasingly viable due to climate change", classification_system: "PDO (Sussex, Hampshire), PGI", soil: "Chalk (South Downs), greensand, clay" });

count += u('country', 'China', 'wine',
  'The world\'s fastest-growing wine producer, with Ningxia emerging as its most celebrated region.',
  'China has rapidly become one of the world\'s largest wine-producing countries by volume and vineyard area. Ningxia, in the arid northwest along the Yellow River at the foot of the Helan Mountains, has attracted serious investment and international attention, producing Cabernet Sauvignon of real quality. Other significant regions include Shandong (the historical heartland), Hebei, Yunnan (high-altitude viticulture near Tibet), and Xinjiang. Challenges include continental extremes requiring vine burial in winter, inconsistent quality standards, and developing domestic wine culture. However, the top producers — including Ao Yun (LVMH), Silver Heights, and Kanaan — demonstrate genuine world-class potential.',
  { key_grapes: ["Cabernet Sauvignon", "Merlot", "Cabernet Gernischt (Carménère)", "Marselan", "Chardonnay"], climate: "Continental desert (Ningxia), monsoon-influenced (east)", classification_system: "Emerging regional classification in Ningxia", soil: "Gravel, sand, alluvial (Ningxia), clay-loam (Shandong)" });

count += u('country', 'Peru', 'wine',
  'South America\'s oldest wine-producing country, with emerging quality from high-altitude coastal desert vineyards.',
  'Peru has the longest winemaking history in South America, dating to Spanish missionaries in the 1540s. The Ica Valley, south of Lima, is the primary wine region, situated in coastal desert irrigated by Andean snowmelt. Tacama and Tabernero are the best-known producers. Tannat has shown particular promise in Peru\'s conditions. The country is better known for Pisco, its grape-based brandy, but quality wine production is growing. High UV levels and extreme day-night temperature swings contribute to concentrated fruit and good acidity retention.',
  { key_grapes: ["Tannat", "Malbec", "Cabernet Sauvignon", "Quebranta", "Italia"], climate: "Coastal desert, high UV, extreme diurnal variation", classification_system: "No formal wine appellation system", soil: "Sandy, alluvial desert soils" });

count += u('country', 'Uruguay', 'wine',
  'South America\'s fourth-largest wine producer, globally recognised for Tannat — its adopted national grape.',
  'Uruguay adopted Tannat from southwest France in the 1870s, and the grape has become the country\'s signature variety, producing wines that are softer and more approachable than their Madiran originals. The primary wine regions include Canelones (closest to Montevideo, producing 60% of national wine), Maldonado (including the emerging Garzón project by Alejandro Bulgheroni), and Rivera in the north. The maritime climate moderated by the Río de la Plata provides adequate rainfall and moderate temperatures. Bodega Garzón achieved the first LEED-certified winery in the world and brought international attention to Uruguayan wine.',
  { key_grapes: ["Tannat", "Merlot", "Cabernet Sauvignon", "Cabernet Franc", "Albariño"], climate: "Maritime, moderated by Atlantic and Río de la Plata", classification_system: "Emerging regional designations", soil: "Clay, limestone, granite (Garzón)" });

count += u('country', 'Mexico', 'wine',
  'The oldest wine-producing country in the Americas, centred on Baja California\'s Valle de Guadalupe.',
  'Mexico\'s winemaking dates to 1597, making it the oldest wine-producing country in the Americas. The Valle de Guadalupe in Baja California has become the quality epicentre, with a Mediterranean climate and growing international recognition. Over 90% of Mexican wine comes from Baja. Tempranillo, Nebbiolo, and various Mediterranean varieties thrive in the dry heat. Casa de Piedra, Monte Xanic, and L.A. Cetto are established producers, while a wave of smaller artisan wineries has transformed the Valle into a gastronomic destination. Other regions include Querétaro and Coahuila.',
  { key_grapes: ["Tempranillo", "Nebbiolo", "Cabernet Sauvignon", "Grenache", "Chenin Blanc"], climate: "Mediterranean (Baja), continental (central highlands)", classification_system: "No formal appellation system", soil: "Granite, clay, sandy loam" });

count += u('country', 'Slovenia', 'wine',
  'A hidden gem of Central European wine — exceptional orange wines, Rebula, and refined Pinot Noir from three distinct regions.',
  'Slovenia sits at the crossroads of Alpine, Mediterranean, and Pannonian influences, producing remarkable diversity from just 24,000 hectares of vineyard. The country has three wine regions: Primorska (bordering Italy\'s Friuli, producing world-class orange wines and Rebula), Podravje (continental northeast, known for aromatic whites), and Posavska (the smallest, traditional Cviček rosé). The Goriška Brda subregion is particularly celebrated, with producers like Movia and Radikon (just across the Italian border) pioneering the natural wine movement. Slovenian winemakers often ferment in traditional large oak or amphora.',
  { key_grapes: ["Rebula (Ribolla Gialla)", "Malvazija", "Pinot Noir", "Refošk", "Šipon (Furmint)", "Zelen"], climate: "Mediterranean (Primorska), continental (Podravje), transitional (Posavska)", classification_system: "ZGP (protected geographical indication), similar to EU PDO/PGI", soil: "Flysch (Brda), marl, limestone, clay" });

count += u('country', 'Scotland', 'wine',
  'An emerging curiosity in viticulture, with a handful of pioneering vineyards testing cool-climate varieties.',
  'Scotland represents the extreme frontier of European viticulture. A small number of pioneering estates have planted vineyards in southern Scotland, exploring ultra-cool-climate varieties such as Solaris, Rondo, and Seyval Blanc. Climate change has gradually made southern Scotland more viable, though yields remain low and vintages inconsistent. The movement is still experimental, with no established commercial scale, but it reflects the broader northward expansion of European winegrowing.',
  { key_grapes: ["Solaris", "Rondo", "Seyval Blanc"], climate: "Cool maritime, marginal for viticulture", classification_system: "None", soil: "Various" });

count += u('country', 'New Zealand', 'wine',
  'Sauvignon Blanc powerhouse from Marlborough, with world-class Pinot Noir from Central Otago and outstanding Syrah from Hawke\'s Bay.',
  'New Zealand catapulted to global wine prominence through Marlborough Sauvignon Blanc — a style so distinctive it created its own category. Beyond Sauvignon Blanc, Central Otago produces exceptional Pinot Noir from the world\'s southernmost wine region. Hawke\'s Bay delivers Bordeaux-style reds and increasingly impressive Syrah. Martinborough\'s small-scale Pinot Noir offers an alternative to Central Otago\'s power. Waipara in Canterbury produces fine Riesling and Pinot Noir. New Zealand winemakers are sustainability leaders — over 96% of vineyard area is certified under Sustainable Winegrowing NZ.',
  { key_grapes: ["Sauvignon Blanc", "Pinot Noir", "Chardonnay", "Syrah", "Riesling", "Pinot Gris"], climate: "Cool maritime, continental (Central Otago)", classification_system: "GI (Geographical Indication) system", soil: "Alluvial (Marlborough), schist (Central Otago), gravel (Hawke's Bay)" });

count += u('country', 'Germany', 'wine',
  'The world\'s foremost Riesling producer — from bone-dry Grosses Gewächs to transcendent sweet wines.',
  'Germany is Riesling\'s spiritual home. The 13 Anbaugebiete (wine regions) stretch along major river valleys, where steep slopes and reflected heat allow grapes to ripen at northern latitudes. The Mosel, Rheingau, Pfalz, and Nahe produce the finest Rieslings. The VDP classification system designates Grosse Lage (Grand Cru equivalent) vineyards. German Riesling ranges from feather-light, low-alcohol Kabinett to luscious Trockenbeerenauslese. A growing movement towards dry (trocken) wines has repositioned German wine internationally. Spätburgunder (Pinot Noir) from Baden and the Ahr Valley has gained serious recognition.',
  { key_grapes: ["Riesling", "Spätburgunder (Pinot Noir)", "Müller-Thurgau", "Grauburgunder (Pinot Gris)", "Silvaner", "Weissburgunder (Pinot Blanc)"], climate: "Cool continental, river-valley moderated", classification_system: "VDP (Grosse Lage, Erste Lage), Prädikatswein (Kabinett to TBA)", soil: "Slate (Mosel), loess (Pfalz), limestone, volcanic (Kaiserstuhl)" });

count += u('country', 'South Africa', 'wine',
  'A New World wine country with over 350 years of history, defined by Chenin Blanc, Pinotage, and the Cape Winelands.',
  'South African wine dates to 1659. The Cape Winelands benefit from the cooling influence of the Atlantic and Indian oceans. Stellenbosch is the quality heartland for Cabernet and Bordeaux blends. Swartland has emerged as the centre of South Africa\'s natural wine revolution, producing remarkable old-vine Chenin Blanc, Syrah, and Grenache. Constantia is historically famous for its dessert wine, Vin de Constance. Pinotage — a South African cross of Pinot Noir and Cinsault — remains the country\'s unique contribution to world wine, though Chenin Blanc (locally called Steen) is the most-planted variety. The Wine of Origin (WO) system governs appellations.',
  { key_grapes: ["Chenin Blanc", "Pinotage", "Cabernet Sauvignon", "Syrah", "Sauvignon Blanc", "Chardonnay"], climate: "Mediterranean, maritime-moderated", classification_system: "WO (Wine of Origin)", soil: "Granite (Stellenbosch), shale (Swartland), Table Mountain sandstone" });

count += u('country', 'Portugal', 'wine',
  'One of Europe\'s most exciting wine countries — from Port and Douro reds to Vinho Verde and the emerging Alentejo.',
  'Portugal offers extraordinary diversity from a compact geography. The Douro Valley produces both Port and outstanding unfortified reds from indigenous varieties like Touriga Nacional. Vinho Verde from the Minho is a crisp, refreshing style that has become a global favourite. The Alentejo in the south produces generous, modern reds. Dão offers elegant, mineral wines often compared to Burgundy. Madeira produces one of the world\'s most long-lived fortified wines. Portugal has over 250 indigenous grape varieties, giving its wines a distinctiveness that sets them apart. The DOC system protects 31 regions.',
  { key_grapes: ["Touriga Nacional", "Tinta Roriz (Tempranillo)", "Touriga Franca", "Baga", "Alvarinho", "Encruzado", "Arinto"], climate: "Atlantic (north), Mediterranean (south)", classification_system: "DOC, Vinho Regional (IGP)", soil: "Schist (Douro), granite (Dão, Vinho Verde), clay-limestone (Alentejo)" });

count += u('country', 'Austria', 'wine',
  'A quality-obsessed wine culture built on Grüner Veltliner and world-class Riesling from the Danube terraces.',
  'Austria\'s wine industry was rebuilt on a foundation of strict quality controls after the 1985 wine scandal, emerging as one of Europe\'s most exciting wine countries. Grüner Veltliner is the signature grape, producing wines ranging from crisp, peppery quaffers to profound, age-worthy single-vineyard bottlings. The Wachau, Kamptal, and Kremstal along the Danube produce extraordinary Riesling and Grüner Veltliner. Burgenland produces outstanding sweet wines from Neusiedlersee and powerful reds (Blaufränkisch, Zweigelt) from Mittelburgenland. The DAC (Districtus Austriae Controllatus) system ties grape varieties to specific regions.',
  { key_grapes: ["Grüner Veltliner", "Riesling", "Blaufränkisch", "Zweigelt", "Welschriesling", "Sankt Laurent"], climate: "Cool continental, Pannonian (east)", classification_system: "DAC (Districtus Austriae Controllatus)", soil: "Loess, primary rock, gneiss (Wachau), limestone, gravel" });

count += u('country', 'Chile', 'wine',
  'A wine powerhouse shaped by the Andes and Pacific — exceptional Cabernet Sauvignon, Carménère, and extraordinary value.',
  'Chile\'s unique geography — bounded by the Andes, the Pacific, the Atacama Desert, and Patagonia — creates natural barriers that kept phylloxera out, meaning many vines are ungrafted. Cabernet Sauvignon thrives in the Maipo and Colchagua valleys. Carménère, nearly extinct in Bordeaux after phylloxera, found a second life as Chile\'s signature variety. The coastal influence of the Humboldt Current provides cooling, while Andean snowmelt irrigates vineyards. The DO system has evolved to include Costa (coastal), Entre Cordilleras (between ranges), and Andes designations to reflect altitude and proximity effects.',
  { key_grapes: ["Cabernet Sauvignon", "Carménère", "Merlot", "Sauvignon Blanc", "Chardonnay", "País"], climate: "Mediterranean, moderated by Andes and Pacific", classification_system: "DO (Denominación de Origen) with Costa/Andes/Entre Cordilleras", soil: "Alluvial, clay-loam, granite, volcanic" });

count += u('country', 'Argentina', 'wine',
  'The world\'s fifth-largest wine producer, synonymous with Malbec from Mendoza\'s high-altitude vineyards.',
  'Argentina transformed its international reputation through Malbec — a grape that had been a minor blending component in Bordeaux but found its ultimate expression in Mendoza\'s high-altitude vineyards. The Uco Valley (Tupungato, Tunuyán, San Carlos) at 1,000-1,500 metres produces the most refined examples. Beyond Malbec, Cabernet Franc is emerging as a star variety, and Torrontés from Salta offers a distinctively aromatic white. San Juan province to the north and Patagonia\'s Río Negro to the south extend the country\'s viticultural range. Argentine wine culture is deeply embedded in daily life — per capita consumption remains among the world\'s highest.',
  { key_grapes: ["Malbec", "Cabernet Sauvignon", "Cabernet Franc", "Bonarda", "Torrontés", "Chardonnay"], climate: "High-altitude continental desert", classification_system: "DOC (Luján de Cuyo, San Rafael), IG", soil: "Alluvial, calcareous, sandy, clay at altitude" });

// ═══════════════════════════════════════════════════════════════════════════
// SPIRITS COUNTRIES
// ═══════════════════════════════════════════════════════════════════════════

count += u('country', 'Australia', 'spirits',
  'A rapidly growing craft spirits scene producing acclaimed whiskies, gins, and rums from Tasmania to Western Australia.',
  'Australia\'s craft spirits movement has exploded since the early 2010s. Tasmania leads with whisky producers like Sullivan\'s Cove (named World\'s Best Single Malt in 2014), Lark, and Overeem. Australian gin has gained particular momentum, with Four Pillars, Adelaide Hills Distillery, and Archie Rose leading the way — native botanicals like lemon myrtle, Tasmanian pepperberry, and wattleseed create distinctly Australian profiles. Bundaberg Rum remains the country\'s most iconic spirit brand. Starward in Melbourne produces whisky matured in Australian wine barrels. The industry benefits from diverse climates that accelerate maturation and unique local ingredients.',
  { distillation_method: "Pot still (craft whisky/gin), column still (commercial rum)", base_ingredient: "Malted barley (whisky), sugarcane (rum), grain and botanicals (gin)", key_styles: ["Single Malt Whisky", "Australian Gin", "Dark Rum", "Wine-Barrel Whisky"], aging_tradition: "Wine-barrel maturation common, rapid tropical aging" });

count += u('country', 'Italy', 'spirits',
  'Italy\'s rich spirits tradition encompasses grappa, amaro, vermouth, and a growing craft gin scene.',
  'Italy produces a vast array of spirits deeply embedded in its food culture. Grappa, distilled from grape pomace, ranges from raw and fiery to elegant and barrel-aged. The amaro family — bitter herbal liqueurs including Campari, Aperol, Averna, Amaro Montenegro, and Fernet-Branca — is central to Italian drinking culture and the global cocktail renaissance. Vermouth originated in Turin, with Carpano, Cocchi, and Martini & Rossi as historic houses. Limoncello from the Amalfi Coast is Italy\'s most popular liqueur. Italian craft gin is a growing category, with Mediterranean botanicals lending distinctive character.',
  { distillation_method: "Pot still (grappa), column still (commercial), maceration/infusion (amaro, liqueur)", base_ingredient: "Grape pomace (grappa), herbs and botanicals (amaro), grain (gin)", key_styles: ["Grappa", "Amaro", "Vermouth", "Limoncello", "Sambuca", "Italian Gin"], aging_tradition: "Barrel-aged grappa; most amari are not aged" });

count += u('country', 'England', 'spirits',
  'The birthplace of gin, experiencing a craft distilling renaissance with over 800 distilleries.',
  'England\'s spirits heritage is dominated by gin. The Gin Craze of the 18th century established London Dry as a global style. Today, England leads a worldwide gin renaissance, with over 800 distilleries producing an extraordinary range of styles. Sipsmith helped reignite craft gin in 2009. The country also produces growing quantities of single malt whisky (The English Whisky Company, Cotswolds), rum, and vodka. London remains the world\'s most important market for spirits innovation and cocktail culture.',
  { distillation_method: "Pot still (gin, whisky), column still (vodka)", base_ingredient: "Grain, juniper and botanicals (gin), malted barley (whisky)", key_styles: ["London Dry Gin", "Contemporary Gin", "English Single Malt Whisky", "Sloe Gin"], aging_tradition: "Minimal for gin; ex-bourbon/sherry for whisky" });

count += u('country', 'Germany', 'spirits',
  'A major spirits producer known for Korn, Obstbrand (fruit brandies), and an emerging whisky scene.',
  'Germany has a long distilling tradition encompassing Korn (grain spirit), Obstbrand (fruit brandies, especially Kirschwasser from cherries and Williams pear brandy), and herbal liqueurs like Jägermeister and Underberg. German whisky has emerged as a notable category, with over 200 distilleries now producing single malts — many using local grain and innovative cask programs. Monkey 47 gin from the Black Forest has become a global benchmark for botanical complexity. The country\'s strict quality standards and strong agricultural base support premium spirit production.',
  { distillation_method: "Pot still (fruit brandies, whisky), column still (Korn)", base_ingredient: "Grain (Korn, whisky), fruit (Obstbrand), botanicals (gin)", key_styles: ["Korn", "Kirschwasser", "German Single Malt Whisky", "Botanical Gin", "Herbal Liqueur"], aging_tradition: "Various — oak for whisky, unaged for most eau-de-vie" });

count += u('country', 'Canada', 'spirits',
  'Home to Canadian whisky — historically rye-forward blends — and a growing craft distilling movement.',
  'Canadian whisky has a distinctive identity built on smoothness and versatility. Traditionally blended from corn-based and rye-based distillates, Canadian whisky can legally be called "rye whisky" regardless of grain composition. Crown Royal, Canadian Club, and Lot No. 40 are leading brands. The craft movement has brought single-grain and single-malt expressions. Canada also produces notable ice wines-based spirits, maple-influenced liqueurs, and an expanding gin category. Quebec\'s Ungava gin uses Arctic botanicals. Alberta Premium is made from 100% rye.',
  { distillation_method: "Column still (traditional blends), pot still (craft)", base_ingredient: "Corn, rye, barley", key_styles: ["Blended Canadian Whisky", "100% Rye Whisky", "Canadian Single Malt", "Maple Spirits"], aging_tradition: "Minimum 3 years in wood (by law)" });

count += u('country', 'Jamaica', 'spirits',
  'The spiritual home of funky, ester-rich rum — from Appleton Estate to Hampden Estate and Worthy Park.',
  'Jamaica produces some of the world\'s most characterful rums. The island\'s distinctive "hogo" (funk) comes from natural ester production during fermentation, often using dunder pits and wild yeasts. Appleton Estate in the Nassau Valley has distilled since 1749. Hampden Estate is legendary among rum enthusiasts for its extremely high-ester marks. Worthy Park produces both light and heavy pot-still rums. Jamaica classifies rums by ester levels (Common Clean, Plummer, Wedderburn, Continental Flavoured), providing a unique technical framework. The Geographical Indication for Jamaica Rum was established to protect the island\'s heritage.',
  { distillation_method: "Pot still (traditional), column still (light rums)", base_ingredient: "Sugarcane molasses", key_styles: ["Pot Still Rum", "High-Ester Rum", "Overproof (White)", "Aged Sipping Rum"], aging_tradition: "Tropical aging in ex-bourbon casks, significant angel's share" });

count += u('country', 'Barbados', 'spirits',
  'A founding nation of rum production, home to Mount Gay — the oldest documented rum brand, dating to 1703.',
  'Barbados claims to be the birthplace of rum, with Mount Gay\'s documented distilling history beginning in 1703. The island produces a refined, balanced style of rum that bridges the gap between lighter Spanish-style and heavier Jamaican rums. Mount Gay, Foursquare, and Cockspur are the principal producers. Richard Seale at Foursquare Rum Distillery has become one of the most acclaimed rum makers in the world, producing single-blended vintage rums of extraordinary quality. Barbados uses both pot and column stills, and ages rum in a variety of cask types. The country established a Geographical Indication for Barbados Rum.',
  { distillation_method: "Pot still and column still (often blended)", base_ingredient: "Sugarcane molasses", key_styles: ["Aged Sipping Rum", "White Rum", "Cask-Finished Rum", "Single Blended Rum"], aging_tradition: "Tropical aging in ex-bourbon, sherry, and wine casks" });

count += u('country', 'Guatemala', 'spirits',
  'Producer of rich, sweet aged rums — Ron Zacapa is the country\'s flagship, using a solera-influenced system.',
  'Guatemala\'s rum industry is dominated by Industrias Licoreras de Guatemala, producer of the internationally acclaimed Ron Zacapa. Distilled from virgin sugarcane honey (rather than molasses), Zacapa is aged at altitude (2,300 metres above sea level in Quetzaltenango) using a solera-inspired system that blends rums of different ages. This produces a distinctively smooth, sweet style that has proven enormously popular globally. Botran is another significant Guatemalan rum brand from the same company. The country\'s rum style tends towards richness and sweetness, appealing to whisky and Cognac drinkers.',
  { distillation_method: "Column still", base_ingredient: "Virgin sugarcane honey (not molasses)", key_styles: ["Solera-Aged Rum", "XO Sipping Rum", "White Rum"], aging_tradition: "High-altitude aging, solera blending system" });

count += u('country', 'Trinidad', 'spirits',
  'Home to Angostura — the world\'s most famous bitters brand and a major rum producer.',
  'Trinidad\'s spirits identity centres on the House of Angostura, founded in 1824. Angostura Aromatic Bitters is the single most essential cocktail ingredient worldwide. Beyond bitters, Angostura produces a significant range of aged rums, including the acclaimed Angostura 1919 and 1824. The Fernandes family produces Forres Park Puncheon (a high-proof staple) and 10 Cane (made from fresh sugarcane juice). Trinidad rum tends towards a lighter, more refined style than Jamaican, often produced on column stills. The island\'s Carnival culture has made rum central to its national identity.',
  { distillation_method: "Column still (primary), pot still (blending)", base_ingredient: "Sugarcane molasses, fresh sugarcane juice", key_styles: ["Light Column-Still Rum", "Aged Sipping Rum", "Aromatic Bitters", "Overproof Rum"], aging_tradition: "Tropical aging, ex-bourbon barrels" });

count += u('country', 'Netherlands', 'spirits',
  'The birthplace of genever (jenever) — the precursor to modern gin — and home to Bols, De Kuyper, and Lucas Bols.',
  'The Netherlands has a distilling heritage dating to the 16th century. Genever (jenever), the malt wine-based juniper spirit, is the direct ancestor of London Dry gin. Bols, founded in 1575, is the world\'s oldest distilled spirits brand. De Kuyper is a global leader in liqueurs and cocktail ingredients. Ketel One vodka, from the Nolet family distillery, has become a major international brand. Dutch genever comes in two main styles: oude (old-style, maltier) and jonge (young, lighter). Schiedam, near Rotterdam, was historically the centre of Dutch distilling.',
  { distillation_method: "Pot still (genever malt wine), column still (jonge genever, vodka)", base_ingredient: "Malted grain (genever), grain (vodka), various (liqueurs)", key_styles: ["Oude Genever", "Jonge Genever", "Dutch Vodka", "Fruit Liqueurs", "Curaçao"], aging_tradition: "Oak-aged oude genever; most liqueurs unaged" });

count += u('country', 'Belgium', 'spirits',
  'Known for genever, fruit liqueurs, and herbal spirits — Belgium bridges Dutch and French distilling traditions.',
  'Belgium straddles two spirits cultures: the genever tradition of Flanders (shared with the Netherlands) and the liqueur-making heritage influenced by France. Belgian genever, particularly from Hasselt and East Flanders, has its own character — often smoother and more grain-forward than Dutch versions. Filliers produces genever and gin from a five-generation family distillery. Belgium also produces notable fruit liqueurs, herbal digestifs, and a growing number of craft gins and whiskies. The Belgian Owl was one of the first European single malts outside traditional whisky nations.',
  { distillation_method: "Pot still (genever, whisky), column still", base_ingredient: "Grain, juniper, fruits, herbs", key_styles: ["Belgian Genever", "Grain Genever", "Fruit Liqueur", "Belgian Gin", "Belgian Single Malt"], aging_tradition: "Oak aging for premium genever and whisky" });

count += u('country', 'Sweden', 'spirits',
  'Synonymous with vodka (Absolut) and aquavit, with an emerging whisky scene including Mackmyra.',
  'Sweden\'s spirits heritage centres on vodka and aquavit. Absolut Vodka, from Åhus in southern Sweden, is one of the world\'s best-selling premium spirits. Swedish aquavit, flavoured primarily with dill, caraway, and anise, is essential to Scandinavian food culture, particularly at Midsommar and Christmas. Mackmyra, founded in 1999, pioneered Swedish whisky and now produces internationally recognised single malts using Swedish oak and distinctive seasonal variations. The Swedish government monopoly on alcohol retail (Systembolaget) shapes the domestic market.',
  { distillation_method: "Column still (vodka), pot still (whisky)", base_ingredient: "Winter wheat (vodka), grain (whisky), botanicals (aquavit)", key_styles: ["Swedish Vodka", "Aquavit", "Swedish Single Malt Whisky", "Flavoured Spirits"], aging_tradition: "Oak-aged whisky; aquavit sometimes barrel-aged" });

count += u('country', 'Poland', 'spirits',
  'One of the world\'s great vodka nations, with a distilling tradition spanning centuries and legal protection for Polish Vodka.',
  'Poland disputes Russia\'s claim to inventing vodka, with documented distillation from the 15th century. Polish vodka has legal EU protection as a geographical indication — it must be made from Polish grain or potatoes using water from Polish sources. Żubrówka (Bison Grass Vodka) is one of the most distinctive flavoured vodkas in the world. Belvedere and Chopin are premium brands that have elevated Polish vodka internationally. Sliwowica (plum brandy) is a traditional spirit from the Tatra Mountains. A growing craft scene is producing gins and single malts.',
  { distillation_method: "Column still (vodka), pot still (sliwowica)", base_ingredient: "Rye, wheat, potatoes", key_styles: ["Pure Vodka", "Flavoured Vodka (Żubrówka)", "Potato Vodka", "Sliwowica (Plum Brandy)"], aging_tradition: "Most vodka unaged; some barrel-aged varieties exist" });

count += u('country', 'Russia', 'spirits',
  'The world\'s most iconic vodka nation, with a centuries-old tradition of grain and potato distillation.',
  'Russia\'s distilling history is inseparable from vodka. Commercial production dates to at least the 14th century, and vodka has been central to Russian culture, economy, and politics for centuries. Traditional Russian vodka is typically made from wheat or rye, distilled for purity and filtered through birch charcoal. Stolichnaya (now produced in Latvia) and Russian Standard are major brands. Beyond vodka, Russia produces samogon (home-distilled spirits), nastoykas (infused spirits), and honey-based medovukha. The domestic market remains overwhelmingly vodka-focused.',
  { distillation_method: "Column still (multiple distillation for purity)", base_ingredient: "Wheat, rye, potato", key_styles: ["Classic Vodka", "Premium Filtered Vodka", "Flavoured Vodka", "Nastoyka (Infused Spirit)"], aging_tradition: "Unaged by tradition" });

count += u('country', 'Taiwan', 'spirits',
  'Kavalan whisky has stunned the world — Taiwan\'s subtropical climate produces remarkably mature single malts at accelerated pace.',
  'Taiwan\'s emergence as a world-class whisky producer is one of the most remarkable stories in modern spirits. Kavalan Distillery in Yilan County, founded in 2005 and releasing its first whisky in 2008, has won numerous international awards. The subtropical climate dramatically accelerates maturation — the angel\'s share reaches 12-15% per year (versus 2% in Scotland), meaning a 5-year Kavalan can show the complexity of a much older Scotch. Omar whisky from the state-owned TTL is another notable producer. The humid, warm conditions create a unique interaction between spirit and wood that defines the Taiwanese style.',
  { distillation_method: "Pot still (Scottish-style copper pot stills)", base_ingredient: "Malted barley (imported)", key_styles: ["Single Malt Whisky", "Sherry Cask", "Bourbon Cask", "Specialty Cask Finishes"], aging_tradition: "Accelerated tropical maturation; diverse cask program" });

count += u('country', 'Vietnam', 'spirits',
  'Traditional rice-based spirits are deeply embedded in Vietnamese culture, with craft distilling beginning to emerge.',
  'Vietnam has a long tradition of rice-based spirit production. Rượu (rice wine/spirit) is produced throughout the country in countless local variations. Rượu gạo is a basic rice spirit; Rượu nếp is made from glutinous rice. Snake wine and other infused spirits are traditional but primarily symbolic. The Son Tinh distillery produces premium rice spirits using traditional methods. An emerging craft scene includes Vietnamese gin using local botanicals like pho spices and lotus. Commercial production is dominated by Halico (Hanoi Vodka). The market potential is enormous given Vietnam\'s large, young, and increasingly affluent population.',
  { distillation_method: "Pot still (traditional), column still (commercial)", base_ingredient: "Rice, glutinous rice", key_styles: ["Rượu Gạo (Rice Spirit)", "Rượu Nếp (Glutinous Rice)", "Vietnamese Vodka", "Emerging Craft Gin"], aging_tradition: "Traditionally unaged; some barrel experiments emerging" });

count += u('country', 'Brazil', 'spirits',
  'Home to cachaça — the world\'s third most-consumed spirit — the essential base of the Caipirinha.',
  'Brazil is the world\'s largest sugarcane producer, and cachaça — distilled from fresh sugarcane juice — is its national spirit. Over 1.5 billion litres are produced annually by an estimated 40,000 producers. Cachaça differs from rum in its use of fresh cane juice rather than molasses, and its distinctive fermentation using wild or cultivated yeasts. Unaged cachaça (prata/branca) is used in Caipirinhas. Aged cachaça (ouro/amarela) is matured in a remarkable variety of Brazilian woods — amburana, bálsamo, jequitibá — each imparting unique flavours. Leblon, Avuá, and Novo Fogo have led cachaça\'s international premium positioning.',
  { distillation_method: "Pot still (alambique, artisanal), column still (industrial)", base_ingredient: "Fresh sugarcane juice", key_styles: ["Cachaça Prata (Unaged)", "Cachaça Ouro (Aged)", "Wood-Rested Cachaça", "Industrial Cachaça"], aging_tradition: "Native Brazilian woods (amburana, bálsamo) and oak" });

count += u('country', 'Colombia', 'spirits',
  'Aguardiente is the national spirit — anise-flavoured and deeply woven into Colombian culture and celebration.',
  'Colombia\'s spirits culture is dominated by aguardiente, an anise-flavoured spirit distilled from sugarcane. Each department traditionally has its own aguardiente brand — Antioqueño, Cristal, Néctar — and brand loyalty runs deep. Colombian aguardiente is distinct from other Latin American aguardientes in its consistent anise flavouring. Beyond aguardiente, Colombia\'s emerging craft scene includes rum producers (Dictador from Cartagena produces highly regarded aged rums using a solera system) and a nascent gin and whisky interest. The country\'s rum exports have grown significantly, particularly in the premium segment.',
  { distillation_method: "Column still (aguardiente), pot/column (rum)", base_ingredient: "Sugarcane (aguardiente), sugarcane molasses (rum)", key_styles: ["Aguardiente", "Aged Rum (Solera)", "Ron Añejo", "Craft Spirits"], aging_tradition: "Solera system for premium rum; aguardiente typically unaged" });

count += u('country', 'Cuba', 'spirits',
  'The birthplace of light, elegant rum — the foundation of the Daiquiri, Mojito, and Cuba Libre.',
  'Cuban rum defined the light, refined style that dominates global rum consumption. Havana Club, jointly owned by the Cuban government and Pernod Ricard, is the island\'s flagship brand. Don Facundo Bacardí Massó revolutionised rum production in Santiago de Cuba in 1862 by introducing charcoal filtration and barrel aging, creating the template for light rum. The Cuban style emphasises column-still distillation for elegance, with aging in tropical conditions developing complexity. Santiago de Cuba and Havana Club produce aged rums of genuine sophistication. US trade restrictions have kept Cuban rum from its largest potential market for decades.',
  { distillation_method: "Column still (primary), some pot still for premium blends", base_ingredient: "Sugarcane molasses", key_styles: ["Light White Rum", "Aged Añejo", "Reserva", "Rum-Based Cocktails"], aging_tradition: "Tropical aging in ex-bourbon casks; rapid maturation" });

// ═══════════════════════════════════════════════════════════════════════════
// WINE REGIONS
// ═══════════════════════════════════════════════════════════════════════════

count += u('region', 'Puglia', 'wine',
  'Italy\'s heel — a prolific wine region rediscovering quality through Primitivo, Negroamaro, and Nero di Troia.',
  'Puglia is Italy\'s second-largest wine-producing region by volume, historically a source of bulk wine used to add colour and body to northern blends. A quality revolution has transformed the region. Primitivo di Manduria produces rich, concentrated reds from the same grape as California\'s Zinfandel. Negroamaro is the backbone of Salice Salentino — darker, more tannic, with bitter cherry character. Nero di Troia (Uva di Troia) from the north of the region is gaining recognition for its structure and ageability. Old-vine (alberello) bush-trained vineyards on the Salento peninsula produce some of the most characterful wines in southern Italy.',
  { key_grapes: ["Primitivo", "Negroamaro", "Nero di Troia", "Fiano", "Bombino Bianco"], climate: "Hot Mediterranean, moderated by Adriatic and Ionian seas", soil: "Terra rossa, limestone, tufa, clay" });

count += u('region', 'Provence', 'wine',
  'The world capital of rosé — accounting for nearly 90% of its production — with serious reds from Bandol.',
  'Provence produces more rosé than any other French region, and these pale, elegant, gastronomic rosés have become a global phenomenon. The region stretches from the Rhône delta to Nice, with key appellations including Côtes de Provence, Coteaux d\'Aix-en-Provence, and Bandol. Bandol is the region\'s most serious appellation, producing age-worthy reds from Mourvèdre. Cassis produces distinctive white wines. The "Provence style" rosé — pale salmon, bone-dry, with restrained fruit and herbal notes — has been widely imitated worldwide. Château d\'Esclans (Whispering Angel) and Domaines Ott are benchmark producers.',
  { key_grapes: ["Grenache", "Cinsault", "Mourvèdre", "Syrah", "Rolle (Vermentino)", "Tibouren"], climate: "Mediterranean with mistral wind influence", soil: "Limestone, clay, schist, volcanic" });

count += u('region', 'Margaret River', 'wine',
  'Western Australia\'s premium wine region — world-class Cabernet Sauvignon and Chardonnay from maritime-influenced terroir.',
  'Margaret River produces only 3% of Australia\'s wine but accounts for over 20% of the premium segment. The region\'s maritime climate, moderated by the Indian Ocean, produces Cabernet Sauvignon and Bordeaux-style blends of remarkable elegance — often compared to the best of Pessac-Léognan. Chardonnay is equally impressive, with producers like Leeuwin Estate, Vasse Felix, and Cullen producing world-class examples. The region was only planted in the late 1960s following research by agronomist Dr. John Gladstones, yet it has rapidly established itself as one of Australia\'s finest wine regions.',
  { key_grapes: ["Cabernet Sauvignon", "Chardonnay", "Sauvignon Blanc", "Semillon", "Merlot"], climate: "Maritime Mediterranean", soil: "Gravel, loam, laterite (ironstone), granite" });

count += u('region', 'McLaren Vale', 'wine',
  'South Australia\'s coastal wine region — old-vine Grenache, Shiraz, and innovative Mediterranean blends.',
  'McLaren Vale lies between the Mount Lofty Ranges and Gulf St Vincent, creating a warm but maritime-moderated climate. The region is celebrated for Shiraz but increasingly recognised for old-vine Grenache and GSM (Grenache-Shiraz-Mourvèdre) blends that express a distinctly Mediterranean character. d\'Arenberg, Wirra Wirra, and Chapel Hill are established names, while a wave of younger winemakers champion low-intervention, single-vineyard wines. McLaren Vale was the first wine region in the world to map its soil types at a commercial vineyard scale, identifying 40+ distinct soil types across 75 square kilometres.',
  { key_grapes: ["Shiraz", "Grenache", "Cabernet Sauvignon", "Mourvèdre", "Vermentino", "Fiano"], climate: "Mediterranean, maritime-moderated", soil: "Highly diverse — sand, clay, limestone, ironstone, loam" });

count += u('region', 'Ribera del Duero', 'wine',
  'Spain\'s other great Tempranillo region — powerful, structured reds from the high Castilian meseta.',
  'Ribera del Duero sits on the northern Castilian meseta at 700-1,000 metres elevation, where extreme continental conditions — freezing winters, scorching summers, and vast day-night temperature swings — produce Tempranillo (locally called Tinto Fino or Tinta del País) of extraordinary concentration and structure. Vega Sicilia, Spain\'s most legendary estate, has produced wines here since 1864. Pingus brought modern, high-extraction winemaking in the 1990s. Pesquera and Emilio Moro represent the region\'s more traditional style. The DO was only established in 1982, but has rapidly risen to rival Rioja in prestige.',
  { key_grapes: ["Tempranillo (Tinto Fino)", "Cabernet Sauvignon", "Merlot", "Malbec", "Albillo"], climate: "Extreme continental, high altitude", soil: "Limestone, clay, sand, chalky marl" });

count += u('region', 'Priorat', 'wine',
  'Spain\'s most dramatic wine region — old-vine Garnacha and Cariñena from steep licorella slate terraces.',
  'Priorat is one of only two DOCa (Denominación de Origen Calificada) regions in Spain, alongside Rioja. Abandoned in the late 19th century after phylloxera, it was revived in the 1980s by a group of pioneers (Álvaro Palacios, René Barbier, and others) who recognised the extraordinary potential of its ancient licorella (slate and quartz) soils. Old-vine Garnacha and Cariñena grown on precipitous terraces at low yields produce wines of searing intensity, mineral complexity, and remarkable concentration. L\'Ermita by Álvaro Palacios is Spain\'s most expensive wine. Production is tiny — the entire DOCa produces less than some single Bordeaux châteaux.',
  { key_grapes: ["Garnacha", "Cariñena (Carignan)", "Cabernet Sauvignon", "Syrah", "Merlot"], climate: "Mediterranean continental, extreme", soil: "Licorella (laminated slate and quartz)" });

count += u('region', 'Rías Baixas', 'wine',
  'Galicia\'s premier white wine region — crisp, aromatic Albariño from Atlantic-influenced granite terroir.',
  'Rías Baixas in northwest Spain\'s Galicia produces Spain\'s finest white wines from the Albariño grape. The Atlantic climate brings abundant rainfall, and vineyards are traditionally trained on pergolas (parras) to promote air circulation and prevent rot. The resulting wines are crisp, aromatic, and mineral, with stone fruit, citrus, and saline notes — perfect partners for Galicia\'s exceptional seafood. Val do Salnés is the most prized subzone, closest to the coast. Pazo de Señoráns, Martín Códax, and Do Ferreiro are benchmark producers. The DO was established in 1988.',
  { key_grapes: ["Albariño", "Treixadura", "Loureiro", "Godello", "Caíño Blanco"], climate: "Cool Atlantic maritime, high rainfall", soil: "Granite, decomposed granite (sand), alluvial" });

count += u('region', 'Sonoma', 'wine',
  'California\'s most diverse wine county — from foggy Pinot Noir coastline to warm inland Zinfandel valleys.',
  'Sonoma County encompasses 18 AVAs and extraordinary diversity, from the fog-shrouded Sonoma Coast (world-class Pinot Noir and Chardonnay) to the warmer Alexander Valley and Dry Creek Valley (Cabernet Sauvignon and old-vine Zinfandel). Russian River Valley is one of America\'s finest Pinot Noir regions. Sonoma\'s identity has increasingly differentiated from neighbouring Napa — less corporate, more agricultural, with a strong sustainability ethic. Kistler, Williams Selyem, and Peter Michael are among the most sought-after producers. Sonoma County was the first wine region in the US to become 99% certified sustainable.',
  { key_grapes: ["Pinot Noir", "Chardonnay", "Cabernet Sauvignon", "Zinfandel", "Sauvignon Blanc", "Syrah"], climate: "Diverse — cool maritime to warm continental", soil: "Goldridge (sandy loam), volcanic, alluvial, clay" });

count += u('region', 'Hawke\'s Bay', 'wine',
  'New Zealand\'s oldest wine region and its finest for Bordeaux-style reds, Syrah, and Chardonnay.',
  'Hawke\'s Bay on the North Island\'s east coast is New Zealand\'s warmest and driest major wine region, making it ideally suited to red varieties. The Gimblett Gravels subregion — an area of free-draining, heat-retaining river gravels — has established itself as New Zealand\'s premier Cabernet and Merlot terroir. Syrah from Hawke\'s Bay, particularly from Bridge Pa Triangle and Te Awanga, is increasingly recognised as world-class, combining Northern Rhône structure with New World fruit purity. Craggy Range, Te Mata (Coleraine), and Trinity Hill are leading producers. Chardonnay from Hawke\'s Bay is among New Zealand\'s best.',
  { key_grapes: ["Merlot", "Cabernet Sauvignon", "Syrah", "Chardonnay", "Viognier"], climate: "Warm maritime, low rainfall", soil: "River gravels (Gimblett Gravels), alluvial, limestone" });

count += u('region', 'Central Otago', 'wine',
  'The world\'s southernmost wine region — Pinot Noir of extraordinary intensity from New Zealand\'s dramatic mountain landscape.',
  'Central Otago in the South Island is the world\'s southernmost wine region (45th parallel) and the only major wine region in New Zealand with a continental rather than maritime climate. The combination of extreme UV levels, massive diurnal temperature variation (up to 20°C), and poor schist soils produces Pinot Noir of remarkable intensity, dark fruit concentration, and mineral drive. Bannockburn, Gibbston Valley, Bendigo, and Wanaka are key subregions, each with distinct character. The region is spectacularly beautiful, with vineyards set against mountains and lakes. Felton Road, Mt Difficulty, and Burn Cottage are benchmark producers.',
  { key_grapes: ["Pinot Noir", "Pinot Gris", "Riesling", "Chardonnay"], climate: "Continental, semi-arid, extreme diurnal variation", soil: "Schist, loess, alluvial gravel, mica" });

count += u('region', 'South Australia', 'wine',
  'Australia\'s wine engine room — home to Barossa, McLaren Vale, Clare Valley, and over half of national production.',
  'South Australia produces approximately 50% of Australia\'s wine and contains its most celebrated regions. The Barossa Valley is the epicentre of Australian Shiraz. McLaren Vale offers Mediterranean-influenced Grenache and Shiraz. Clare Valley produces some of Australia\'s finest Riesling. Adelaide Hills provides cool-climate Sauvignon Blanc, Chardonnay, and Pinot Noir. Coonawarra\'s terra rossa soils over limestone yield distinctive Cabernet Sauvignon. The Limestone Coast zone encompasses several emerging regions. South Australia is phylloxera-free — a critical advantage that protects its old-vine heritage. Penfolds, Henschke, and Wynns are iconic producers.',
  { key_grapes: ["Shiraz", "Cabernet Sauvignon", "Grenache", "Riesling", "Chardonnay", "Mourvèdre"], climate: "Mediterranean to cool continental (varies by subregion)", soil: "Terra rossa, limestone, clay, sand, loam, alluvial" });

// ═══════════════════════════════════════════════════════════════════════════
// BRANDS
// ═══════════════════════════════════════════════════════════════════════════

count += u('brand', 'Yalumba', 'wine',
  'Australia\'s oldest family-owned winery, continuously operating since 1849 in the Barossa Valley.',
  'Founded by Samuel Smith in 1849, Yalumba remains in the hands of the Smith family — now in its fifth generation under Robert Hill-Smith\'s stewardship. The winery owns the only cooperage in the Southern Hemisphere, crafting its own barrels. Yalumba champions Viognier (The Virgilius is Australia\'s benchmark), old-vine Grenache, and Barossa Shiraz. The "Rare & Fine" tier includes The Signature (Cabernet-Shiraz), The Octavius (old-vine Shiraz), and The Caley (Cabernet-Shiraz). Yalumba is also a leader in sustainability, with advanced water recycling and renewable energy across its estates.',
  { founding_year: 1849, country: "Australia", key_products: ["The Virgilius Viognier", "The Signature", "The Octavius Shiraz", "Samuel's Collection"], style_philosophy: "Heritage meets innovation; champion of Viognier and old-vine Barossa varieties" });

count += u('brand', 'Albert Bichot', 'wine',
  'One of Burgundy\'s largest and most respected négociants, with significant domaine holdings since 1831.',
  'Albert Bichot is a sixth-generation family-owned Burgundy house founded in 1831. The company owns six domaines across Burgundy — including Domaine du Clos Frantin (Vosne-Romanée), Domaine Long-Depaquit (Chablis), and Domaine du Pavillon (Pommard) — totalling over 100 hectares. Under Albéric Bichot\'s leadership, the house has invested heavily in organic and biodynamic conversion. The négociant range sources fruit across Burgundy\'s appellations, from Bourgogne to Grand Cru. Albert Bichot consistently delivers well-crafted, terroir-expressive wines across all price points.',
  { founding_year: 1831, country: "France", key_products: ["Chablis Grand Cru", "Nuits-Saint-Georges", "Pommard Premier Cru", "Fixin"], style_philosophy: "Terroir expression through sustainable viticulture and traditional Burgundian winemaking" });

count += u('brand', 'Duckhorn', 'wine',
  'Napa Valley\'s Merlot champion since 1976 — also producing acclaimed Cabernet, Sauvignon Blanc, and Pinot Noir.',
  'Dan and Margaret Duckhorn founded Duckhorn Vineyards in 1976 with a mission to elevate Napa Valley Merlot. Three Palms Vineyard Merlot became the winery\'s icon, named Wine Spectator\'s Wine of the Year in 2017. The Duckhorn portfolio has grown to include Goldeneye (Anderson Valley Pinot Noir), Migration (cool-climate wines), Decoy (accessible tier), and Paraduxx (red blends). The company was acquired by TSG Consumer Partners and later by E. & J. Gallo in 2022. Despite corporate ownership, Duckhorn wines maintain a consistent quality standard that has earned enduring respect.',
  { founding_year: 1976, country: "USA", key_products: ["Three Palms Merlot", "Napa Valley Cabernet", "Goldeneye Pinot Noir", "Decoy"], style_philosophy: "Merlot-focused excellence expanding to a portfolio of refined, food-friendly wines" });

count += u('brand', 'Santa Carolina', 'wine',
  'One of Chile\'s oldest and most respected wineries, producing quality across all price tiers since 1875.',
  'Founded in 1875 by Don Luis Pereira Cotapos, Santa Carolina is one of Chile\'s historic wineries, with vineyards spanning the country\'s key regions from Casablanca to Colchagua. The portfolio ranges from the value-driven Reserva line through Reserva de Familia to the top-tier VSC (Very Special Cellar Selection) and Herencia. The winery\'s historic cellars in Santiago are a national monument. Santa Carolina has been a consistent performer in international competitions and is recognised for delivering reliable quality at accessible price points.',
  { founding_year: 1875, country: "Chile", key_products: ["Reserva", "Reserva de Familia", "VSC", "Herencia"], style_philosophy: "Accessible Chilean wine across tiers, emphasising varietal expression and regional character" });

count += u('brand', 'Bols', 'spirits',
  'The world\'s oldest distilled spirits brand, founded in Amsterdam in 1575 — renowned for genever and liqueurs.',
  'Lucas Bols is the world\'s oldest distilled spirits brand, with an unbroken history dating to 1575 in Amsterdam. The company played a central role in the development of genever and was instrumental in the Dutch Golden Age spirits trade. Bols produces over 30 liqueur flavours — the Bols Bartending Academy has trained thousands of bartenders worldwide. Bols Genever was relaunched in 2008 to revive interest in the category. The distinctive round Bols Ballerina bottle is an icon of bar culture. The company also owns Damrak Gin (named after Amsterdam\'s famous street) and continues to innovate in the cocktail ingredients space.',
  { founding_year: 1575, country: "Netherlands", key_products: ["Bols Genever", "Bols Liqueurs (30+ flavours)", "Damrak Gin", "Bols Cocktail Range"], style_philosophy: "Heritage Amsterdam distilling; bartender-focused innovation in genever and liqueurs" });

count += u('brand', 'Coravin', 'accessories',
  'Revolutionary wine preservation system that allows pouring without removing the cork.',
  'Coravin was invented by Greg Lambrecht, a medical device engineer who adapted needle-insertion technology to create a system that accesses wine through the cork without removing it. Argon gas replaces the wine extracted, preserving the remaining contents for weeks, months, or years. The system launched commercially in 2013 and transformed wine-by-the-glass programs in restaurants worldwide. Coravin now offers multiple models — from the entry-level Pivot (for wines consumed within weeks) to the Timeless series (indefinite preservation). The technology has been particularly embraced by collectors, sommeliers, and wine bars.',
  { founding_year: 2013, country: "USA", key_products: ["Timeless Six+", "Timeless Three+", "Pivot", "Sparkling System"], style_philosophy: "Technology-driven wine preservation enabling glass-by-glass access to any bottle" });

count += u('brand', 'Eikun', 'sake',
  'A distinguished Kyoto sake brewery producing elegant, refined sake since 1895.',
  'Eikun is the flagship brand of Saito Shuzo, a Kyoto-based brewery founded in 1895. Located in Fushimi — one of Japan\'s most celebrated sake-producing districts, known for its exceptionally soft, mineral-rich water — Eikun produces a range from junmai to daiginjo. The brewery combines traditional Fushimi brewing techniques with modern precision. Eikun sake is characterised by the clean, soft water profile typical of Fushimi, producing elegant, approachable sake with refined umami and subtle floral notes. The brand is well-distributed in Southeast Asian markets.',
  { founding_year: 1895, country: "Japan", key_products: ["Junmai Daiginjo", "Junmai Ginjo", "Tokubetsu Junmai", "Honjozo"], style_philosophy: "Fushimi soft-water elegance; refined, food-friendly sake" });

count += u('brand', 'Chiyomusubi', 'sake',
  'A Tottori prefecture brewery crafting distinctive sake from local rice and spring water since 1865.',
  'Chiyomusubi Shuzo was established in 1865 in Sakaiminato, Tottori Prefecture, along the Sea of Japan coast. The brewery draws on pure water from the Daisen mountain range and uses locally grown rice. Chiyomusubi produces a wide range of sake styles, from delicate daiginjo to robust junmai, as well as shochu and other spirits. The brand name means "bond of a thousand generations," reflecting the brewery\'s commitment to connecting tradition with future generations. Tottori\'s cool, humid climate during the brewing season contributes to slow, controlled fermentation that builds complexity.',
  { founding_year: 1865, country: "Japan", key_products: ["Junmai Daiginjo", "Junmai Ginjo", "Goriki Junmai", "Shochu"], style_philosophy: "Tottori terroir expression through local rice varieties and Daisen mountain water" });

count += u('brand', 'Reguta', 'wine',
  'A family estate in Veneto\'s Custoza DOC producing characterful wines from Lake Garda\'s shores since the 1960s.',
  'Reguta is a family-owned estate situated on the morainic hills near Lake Garda in the Custoza DOC of Veneto. The winery has been producing wine since the 1960s, farming vineyards that benefit from the lake\'s moderating influence and the well-drained glacial soils. The range includes Custoza DOC whites, Bardolino reds, and Valpolicella-area wines. Reguta focuses on indigenous Veneto varieties and traditional winemaking, offering authentic regional character at approachable price points. The estate is particularly noted for its Custoza, a blend of Garganega, Trebbianello, and other local white varieties.',
  { founding_year: 1960, country: "Italy", key_products: ["Custoza DOC", "Bardolino", "Lugana", "Valpolicella"], style_philosophy: "Authentic Lake Garda terroir; indigenous varieties, family-scale production" });

count += u('brand', 'Masseria Tagaro', 'wine',
  'A Puglian estate in the heart of Primitivo di Manduria territory, producing concentrated southern Italian reds.',
  'Masseria Tagaro is an estate winery located in Manduria, Puglia — the epicentre of Primitivo production in southern Italy. The masseria (fortified farmhouse) tradition reflects centuries of agricultural heritage in the region. The winery focuses on Primitivo di Manduria DOC, producing rich, concentrated reds from old bush-trained (alberello) vines in the hot, dry Salento climate. Terra rossa soils over limestone contribute mineral structure to the wines. Masseria Tagaro represents the quality-focused new wave of Puglian winemaking, moving beyond bulk production to terroir-driven, estate-bottled wines.',
  { founding_year: null, country: "Italy", key_products: ["Primitivo di Manduria DOC", "Primitivo Salento IGT", "Negroamaro"], style_philosophy: "Estate-grown Primitivo from old vines; southern Italian authenticity and concentration" });

count += u('brand', 'Glenfiddich', 'spirits',
  'The world\'s most awarded single malt Scotch whisky — pioneering the single malt category since 1887.',
  'Glenfiddich was founded in 1887 by William Grant in Dufftown, Speyside. It is credited with launching the single malt category commercially — in 1963, the Grant family began marketing Glenfiddich as a single malt at a time when virtually all Scotch was sold as blended. This decision changed the industry. The distillery uses the same Robbie Dhu spring water source since its founding. The Solera Vat 15 Year Old uses a unique solera-inspired process. The range extends from the 12 Year Old (the world\'s best-selling single malt) through experimental series and rare vintage bottlings. Glenfiddich remains family-owned by William Grant & Sons.',
  { founding_year: 1887, country: "Scotland", key_products: ["12 Year Old", "15 Year Old Solera", "18 Year Old", "21 Year Old Gran Reserva", "Experimental Series"], style_philosophy: "Pioneering single malt house; fruit-forward Speyside character with innovation" });

count += u('brand', 'Glenfarclas', 'spirits',
  'An independent, family-owned Speyside distillery since 1865 — celebrated for rich, sherried single malts.',
  'Glenfarclas has been owned by the Grant family (unrelated to William Grant of Glenfiddich) since 1865 — six generations of independent ownership. The distillery is one of the few remaining that is entirely family-owned and uses direct-fired copper pot stills. Glenfarclas is renowned for its exclusive use of sherry casks (predominantly ex-Oloroso), producing rich, full-bodied malts with dried fruit, spice, and Christmas cake character. The 105 Cask Strength is legendary. The Family Casks series — single-cask bottlings from every vintage since 1954 — is one of whisky\'s most remarkable collections.',
  { founding_year: 1836, country: "Scotland", key_products: ["10 Year Old", "15 Year Old", "21 Year Old", "25 Year Old", "105 Cask Strength", "Family Casks"], style_philosophy: "Independent, sherry-cask focused, direct-fired distillation; traditional Speyside richness" });

count += u('brand', 'Maker\'s Mark', 'spirits',
  'Kentucky\'s handcrafted bourbon icon — the red wax seal and wheated mash bill that defined a category.',
  'Maker\'s Mark was founded in 1953 by Bill Samuels Sr. in Loretto, Kentucky. His innovation was replacing the traditional rye grain in bourbon\'s mash bill with red winter wheat, creating a softer, rounder whisky. Every bottle is still hand-dipped in the signature red wax seal. The distillery was designated a National Historic Landmark in 1980 — the first distillery to receive this honour. Maker\'s Mark Cask Strength and the Private Select program (custom stave finishing) have expanded the range while maintaining the brand\'s artisanal identity. Now owned by Beam Suntory, production methods remain intentionally traditional.',
  { founding_year: 1953, country: "USA", key_products: ["Maker's Mark Original", "Maker's 46", "Cask Strength", "Private Select"], style_philosophy: "Wheated bourbon; handcrafted, soft, approachable, with signature red wax identity" });

count += u('brand', 'Bacardi', 'spirits',
  'The world\'s largest privately held spirits company — founded in Santiago de Cuba in 1862.',
  'Don Facundo Bacardí Massó revolutionised rum in 1862 in Santiago de Cuba by introducing charcoal filtration, specific yeast strains, and barrel aging to create a lighter, more refined style. The Bacardí bat logo — inspired by fruit bats in the original distillery — is one of the most recognised symbols in spirits. After the Cuban Revolution, the family relocated operations; Bacardi is now headquartered in Bermuda and produces rum primarily in Puerto Rico. The portfolio has expanded to include Grey Goose, Patrón, Bombay Sapphire, Martini, Dewar\'s, and Hendrick\'s. Bacardí Superior remains the world\'s best-selling premium white rum.',
  { founding_year: 1862, country: "Cuba (now Bermuda)", key_products: ["Bacardí Superior", "Bacardí 8 Años", "Bacardí Reserva Ocho", "Bacardí Gran Reserva Diez"], style_philosophy: "Pioneer of light rum; family-owned global spirits portfolio anchored by Cuban heritage" });

// ═══════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════

const stats = db.prepare("SELECT status, count(*) as n FROM taxonomy_contexts GROUP BY status").all();
console.log(`\nUpdated: ${count} contexts`);
console.log('Status breakdown:');
for (const s of stats as any[]) console.log(`  ${s.status}: ${s.n}`);
console.log('Done!');
