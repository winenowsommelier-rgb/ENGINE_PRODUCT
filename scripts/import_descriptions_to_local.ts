/**
 * Import existing descriptions from fill_taxonomy scripts into local SQLite.
 * Run: npx tsx scripts/import_descriptions_to_local.ts
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

// ── WINE COUNTRIES ──────────────────────────────────────────────────────────
count += u('country', 'France', 'wine',
  'The benchmark for fine wine, home to Bordeaux, Burgundy, Champagne, Rhône, Loire, and Alsace.',
  'France defines the global vocabulary of wine. Its appellation system (AOC/AOP) pioneered the concept of terroir-driven classification, tying grape varieties to specific regions and production methods. Bordeaux established the blueprint for Cabernet-Merlot blends and the 1855 Classification. Burgundy elevated Pinot Noir and Chardonnay to their highest expressions through single-vineyard focus. Champagne created the world\'s most celebrated sparkling wine method. The Rhône Valley produces powerful Syrah-based reds and complex Grenache blends. Loire offers extraordinary diversity from Muscadet to Sancerre. Alsace specialises in aromatic whites. France remains the reference point against which all wine regions measure themselves.',
  {key_grapes:["Cabernet Sauvignon","Merlot","Pinot Noir","Chardonnay","Syrah","Grenache","Sauvignon Blanc","Chenin Blanc","Riesling","Gamay"],climate:"Continental, Maritime, Mediterranean",classification_system:"AOC/AOP, IGP, Vin de France",terroir:"Limestone, clay, gravel, chalk, schist, granite — enormous geological diversity"});

count += u('country', 'Italy', 'wine',
  'The world\'s most diverse wine producer, with over 500 native grape varieties across 20 regions.',
  'Italy produces more wine than any other country and possesses unmatched grape diversity. Every one of its 20 administrative regions makes wine, from the Alpine foothills of Alto Adige to the volcanic soils of Sicily. Piedmont is celebrated for Nebbiolo-based Barolo and Barbaresco. Tuscany produces Sangiovese-driven Chianti, Brunello di Montalcino, and the innovative Super Tuscans. Veneto contributes Prosecco, Amarone, and Soave. Southern Italy and the islands offer extraordinary value from indigenous varieties like Aglianico, Nero d\'Avola, and Primitivo. Italy\'s DOCG/DOC system classifies over 400 designated wine zones.',
  {key_grapes:["Sangiovese","Nebbiolo","Barbera","Corvina","Pinot Grigio","Trebbiano","Glera","Aglianico","Nero d'Avola","Primitivo"],climate:"Alpine, Continental, Mediterranean",classification_system:"DOCG, DOC, IGT, Vino da Tavola"});

count += u('country', 'USA', 'wine',
  'Led by California\'s Napa and Sonoma, America produces bold, fruit-forward wines across 50 states.',
  'The United States is the world\'s fourth-largest wine producer, dominated by California which accounts for roughly 85% of production. Napa Valley has earned global recognition for Cabernet Sauvignon. Sonoma offers broader diversity with Pinot Noir, Zinfandel, and Chardonnay. Oregon\'s Willamette Valley has emerged as a world-class Pinot Noir region. Washington State\'s Columbia Valley produces powerful Syrah, Merlot, and Cabernet blends. The AVA system identifies over 270 grape-growing regions.',
  {key_grapes:["Cabernet Sauvignon","Pinot Noir","Chardonnay","Zinfandel","Merlot","Syrah"],climate:"Mediterranean (CA), Maritime (OR), Continental (WA)",classification_system:"AVA (American Viticultural Area)"});

count += u('country', 'Australia', 'wine',
  'Known for bold Shiraz and innovative winemaking, spanning cool-climate elegance to warm-region power.',
  'Australia transformed global wine culture with its approachable, fruit-driven style and technical innovation. Barossa Valley Shiraz became the country\'s signature. Cool-climate regions like Yarra Valley and Tasmania produce refined Pinot Noir and Chardonnay. McLaren Vale offers Grenache-Shiraz-Mourvèdre blends. Margaret River produces world-class Cabernet and Chardonnay. Australia pioneered screwcap adoption.',
  {key_grapes:["Shiraz","Cabernet Sauvignon","Chardonnay","Pinot Noir","Grenache","Riesling","Semillon"],climate:"Mediterranean, Maritime, Continental"});

count += u('country', 'Spain', 'wine',
  'The most-planted wine country on earth, from Rioja\'s Tempranillo to Priorat\'s old-vine Garnacha.',
  'Spain has more vineyard acreage than any country. Rioja remains its most recognised region, producing Tempranillo-based reds. Priorat revived old-vine Garnacha. Ribera del Duero makes powerful Tempranillo. Rías Baixas produces crisp Albariño. Sherry from Jerez is one of the world\'s great fortified wines. Cava from Penedès provides excellent-value traditional-method sparkling.',
  {key_grapes:["Tempranillo","Garnacha","Albariño","Verdejo","Monastrell"],climate:"Mediterranean, Continental, Atlantic"});

count += u('country', 'Japan', 'wine',
  'Japan\'s emerging wine scene centres on Koshu from Yamanashi and cool-climate varieties from Hokkaido.',
  'Japan\'s wine industry is small but rapidly gaining recognition. Yamanashi Prefecture produces delicate wines from Koshu. Nagano is emerging for Merlot and Chardonnay. Hokkaido suits Germanic varieties and Pinot Noir. Japanese winemakers bring meticulous attention from sake-brewing heritage.',
  {key_grapes:["Koshu","Muscat Bailey A","Merlot","Chardonnay","Pinot Noir"],climate:"Humid continental to subarctic"});

count += u('country', 'Thailand', 'wine',
  'Tropical viticulture pioneer, producing wines from Hua Hin, Khao Yai, and the highlands near Loei.',
  'Thailand defies conventional viticultural wisdom by producing wine in a tropical latitude. The key regions are Khao Yai, Hua Hin Hills, and highlands near Loei. Vines are managed to produce during the dry, cooler winter months. GranMonte and Monsoon Valley are leading producers.',
  {key_grapes:["Chenin Blanc","Colombard","Syrah","Tempranillo"],climate:"Tropical monsoon, altitude-mitigated"});

// ── SPIRITS COUNTRIES ───────────────────────────────────────────────────────
count += u('country', 'Scotland', 'spirits',
  'The birthplace of Scotch whisky, with five distinct regions producing the world\'s most revered single malts.',
  'Scotland is synonymous with whisky. Its five regions each impart distinct character: Speyside (fruity, elegant), Islay (peaty, maritime), Highlands (diverse), Lowlands (gentle, grassy), Campbeltown (complex, briny). Scotch must be matured minimum three years in oak.',
  {distillation_method:"Pot still (malt), column still (grain)",base_ingredient:"Malted barley, grain",key_styles:["Single Malt","Blended","Peated","Sherried","Cask Strength"]});

count += u('country', 'France', 'spirits',
  'Home to Cognac, Armagnac, Calvados, and a rich tradition of liqueurs and eaux-de-vie.',
  'France\'s spirits tradition extends far beyond wine. Cognac is the world\'s most prestigious grape brandy. Armagnac predates Cognac with more rustic character. Calvados is apple brandy from Normandy. France also produces extraordinary eaux-de-vie and liqueurs including Chartreuse, Cointreau, and Grand Marnier.',
  {distillation_method:"Pot still (Cognac), column/hybrid (Armagnac)",base_ingredient:"Grape, apple, various fruits",key_styles:["Cognac","Armagnac","Calvados","Eau-de-vie","Liqueur"]});

count += u('country', 'Japan', 'spirits',
  'Japanese whisky has achieved cult status, blending Scottish technique with meticulous Japanese craftsmanship.',
  'Japanese whisky was modelled on Scotch in the 1920s. Suntory (Yamazaki, Hakushu) and Nikka (Yoichi, Miyagikyo) are dominant. Mizunara oak aging imparts distinctive sandalwood notes. Beyond whisky, Japan produces shochu, awamori, and emerging gins using native botanicals.',
  {distillation_method:"Pot still, column still",base_ingredient:"Malted barley, grain; barley/potato/rice (shochu)",key_styles:["Single Malt","Blended","Shochu","Japanese Gin"]});

count += u('country', 'USA', 'spirits',
  'Bourbon, rye, and American craft spirits lead a dynamic and innovative spirits culture.',
  'The US has the world\'s most dynamic spirits scene. Bourbon must be 51%+ corn, aged in new charred American oak. Kentucky produces 95% of bourbon. Rye whiskey offers spicier character. Over 2,500 craft distilleries produce gin, vodka, rum, and regional spirits.',
  {distillation_method:"Column still (bourbon), pot still (craft)",base_ingredient:"Corn (bourbon), rye, various grains",key_styles:["Bourbon","Tennessee Whiskey","Rye","American Single Malt","Craft Gin"]});

count += u('country', 'Mexico', 'spirits',
  'Tequila and mezcal — agave-based spirits rooted in centuries of tradition.',
  'Mexico\'s spirits identity is built on agave. Tequila from blue Weber agave ranges from crisp Blanco to complex Añejo. Mezcal from various agave species features characteristic smokiness from earthen pit roasting. Both categories are experiencing unprecedented global demand.',
  {distillation_method:"Pot still (copper or clay)",base_ingredient:"Blue Weber agave (tequila), various agave (mezcal)",key_styles:["Tequila Blanco","Tequila Reposado","Tequila Añejo","Mezcal Joven"]});

count += u('country', 'Ireland', 'spirits',
  'Triple-distilled for smoothness, Irish whiskey is the world\'s fastest-growing spirits category.',
  'Irish whiskey\'s renaissance is remarkable — from two distilleries in the 1980s to over 40 today. Triple distillation produces smoother character. Single Pot Still whiskey, from malted and unmalted barley, is uniquely Irish — creamy, spicy, and complex.',
  {distillation_method:"Pot still (triple distillation)",base_ingredient:"Malted barley, unmalted barley",key_styles:["Single Pot Still","Single Malt","Blended","Peated"]});

count += u('country', 'Thailand', 'spirits',
  'Thai spirits range from traditional white spirits to an emerging craft scene producing rum, gin, and whisky.',
  'Thailand\'s spirits landscape is evolving. Traditional Lao Khao is rice-distilled. Chalong Bay produces rum from Phuket sugarcane. Iron Balls gin has gained international recognition. The Asura brand produces artisanal Thai white spirits. The emerging craft scene draws on Thailand\'s rich botanical heritage.',
  {distillation_method:"Pot still (craft), column still (commercial)",base_ingredient:"Rice, sugarcane, various botanicals",key_styles:["Lao Khao","Thai Rum","Thai Gin","Herbal Spirits"]});

// ── WINE REGIONS ────────────────────────────────────────────────────────────
count += u('region', 'Bordeaux', 'wine',
  'The world\'s most famous wine region, defined by Left Bank Cabernet and Right Bank Merlot.',
  'Bordeaux is the reference point for fine wine. Left Bank produces Cabernet-dominant blends from gravel. Right Bank favours Merlot on clay-limestone. The 1855 Classification established the hierarchy still used today.',
  {key_grapes:["Cabernet Sauvignon","Merlot","Cabernet Franc","Petit Verdot","Semillon","Sauvignon Blanc"],climate:"Maritime"});

count += u('region', 'Burgundy', 'wine',
  'Terroir in its purest expression — single-vineyard Pinot Noir and Chardonnay of transcendent quality.',
  'Burgundy is wine\'s ultimate terroir expression. The hierarchy — Regional, Village, Premier Cru, Grand Cru — reflects centuries of observation. The Côte d\'Or contains 33 Grand Cru vineyards. Small production and enormous demand make top Burgundy among the world\'s most expensive wines.',
  {key_grapes:["Pinot Noir","Chardonnay","Gamay","Aligoté"],climate:"Cool continental"});

count += u('region', 'Champagne', 'wine',
  'The world\'s most celebrated sparkling wine region.',
  'Champagne\'s cool climate and chalk soils produce base wines with high acidity — ideal for méthode champenoise. Chardonnay, Pinot Noir, and Pinot Meunier are the three main grapes. Grower Champagne has surged in recognition.',
  {key_grapes:["Chardonnay","Pinot Noir","Pinot Meunier"],climate:"Cool continental, northern limit"});

count += u('region', 'Tuscany', 'wine',
  'Sangiovese country — from Chianti and Brunello to the iconoclastic Super Tuscans.',
  'Italy\'s most prestigious wine region built on Sangiovese. Chianti Classico, Brunello di Montalcino, Vino Nobile di Montepulciano, and the Super Tuscan movement. Bolgheri on the coast has become Italy\'s answer to the Left Bank.',
  {key_grapes:["Sangiovese","Cabernet Sauvignon","Merlot","Vernaccia"],climate:"Mediterranean, continental in hills"});

count += u('region', 'Napa', 'wine',
  'America\'s most famous wine valley — Cabernet Sauvignon of power, concentration, and global acclaim.',
  'Napa Valley\'s 16 AVAs produce distinct Cabernet styles. The Stags Leap District won the 1976 Judgement of Paris. Napa\'s average bottle price is the highest of any major wine region globally.',
  {key_grapes:["Cabernet Sauvignon","Chardonnay","Merlot","Cabernet Franc"],climate:"Mediterranean with fog"});

count += u('region', 'Piedmont', 'wine',
  'Home to Barolo and Barbaresco — Italy\'s greatest Nebbiolo wines.',
  'Barolo and Barbaresco are among Italy\'s most age-worthy reds — pale in colour but monumental in structure. The Langhe hills are a UNESCO World Heritage site. Barbera and Moscato d\'Asti add further dimension.',
  {key_grapes:["Nebbiolo","Barbera","Dolcetto","Moscato","Cortese"],climate:"Continental with Alpine influence"});

count += u('region', 'Barossa', 'wine',
  'Australia\'s Shiraz heartland — old vines, warm climate, extraordinary depth.',
  'Home to some of the world\'s oldest continuously producing vineyards — pre-phylloxera Shiraz from the 1840s. Penfolds Grange draws primarily on Barossa fruit. Eden Valley at higher elevation produces Australia\'s finest Riesling.',
  {key_grapes:["Shiraz","Grenache","Cabernet Sauvignon","Mataro","Riesling"],climate:"Mediterranean, warm continental"});

count += u('region', 'Rioja', 'wine',
  'Spain\'s most recognised wine region, defined by Tempranillo and oak aging.',
  'Rioja divides into Alta, Alavesa, and Oriental. The aging classification — Joven, Crianza, Reserva, Gran Reserva — reflects mandatory minimum aging. Modern Rioja increasingly includes single-vineyard wines.',
  {key_grapes:["Tempranillo","Garnacha","Graciano","Viura"],climate:"Continental-Mediterranean transitional"});

count += u('region', 'Mendoza', 'wine',
  'Argentina\'s wine capital at the foot of the Andes — the world\'s definitive Malbec region.',
  'Mendoza produces over 70% of Argentine wine. Uco Valley subregions at 1,000-1,500m produce refined, mineral Malbec. Luján de Cuyo offers rounder wines. Beyond Malbec, excellent Cabernet Franc is emerging.',
  {key_grapes:["Malbec","Cabernet Sauvignon","Cabernet Franc","Bonarda","Torrontés"],climate:"High-altitude continental desert"});

count += u('region', 'Rhône Valley', 'wine',
  'Syrah-driven Northern Rhône and Grenache-dominated Southern Rhône — two wine worlds in one valley.',
  'Northern Rhône: steep terraced Syrah at Côte-Rôtie, Hermitage, Cornas. Southern Rhône: Grenache blends at Châteauneuf-du-Pape, Gigondas. Côtes du Rhône provides everyday drinking of remarkable quality.',
  {key_grapes:["Syrah","Grenache","Mourvèdre","Viognier","Marsanne","Roussanne"],climate:"Continental (North), Mediterranean (South)"});

// ── Batch 2 regions ─────────────────────────────────────────────────────────
count += u('region', 'Veneto', 'wine', 'Italy\'s most productive region — Prosecco, Amarone, Soave, Valpolicella.', 'Veneto produces Prosecco from Glera, Amarone by appassimento method, and crisp Soave from Garganega.', {key_grapes:["Corvina","Glera","Garganega"]});
count += u('region', 'California', 'wine', 'America\'s wine powerhouse — Napa Cabernet to Sonoma Pinot Noir.', 'Over 80% of American wine. Paso Robles, Santa Barbara, Monterey, Lodi add diversity beyond Napa/Sonoma.', {key_grapes:["Cabernet Sauvignon","Pinot Noir","Chardonnay","Zinfandel"]});
count += u('region', 'Marlborough', 'wine', 'World capital of Sauvignon Blanc — explosive aromatics from New Zealand.', 'Marlborough produces 75%+ of NZ wine. Passionfruit, gooseberry, cut-grass Sauvignon Blanc with bracing acidity.', {key_grapes:["Sauvignon Blanc","Pinot Noir","Chardonnay"]});
count += u('region', 'Loire', 'wine', 'France\'s garden — 600-mile river valley from Muscadet to Sancerre.', 'Muscadet, Chenin Blanc (Vouvray), Cabernet Franc (Chinon), Sauvignon Blanc (Sancerre). Undervalued great wine region.', {key_grapes:["Chenin Blanc","Sauvignon Blanc","Cabernet Franc","Melon de Bourgogne"]});
count += u('region', 'Alsace', 'wine', 'France\'s aromatic white wine paradise — Riesling, Gewurztraminer, Pinot Gris.', 'Sheltered by Vosges. 51 Grand Cru sites. Labelled by variety. Crémant d\'Alsace is France\'s largest non-Champagne sparkling AOC.', {key_grapes:["Riesling","Gewurztraminer","Pinot Gris","Muscat"]});
count += u('region', 'Mosel', 'wine', 'Germany\'s most dramatic wine landscape — steep slate slopes, Riesling of unmatched delicacy.', 'Steep slate vineyards along the Mosel River produce low-alcohol, high-acidity Riesling of crystalline purity.', {key_grapes:["Riesling"],climate:"Cool continental, river-moderated"});
count += u('region', 'Douro', 'wine', 'Portugal\'s most dramatic region — birthplace of Port and celebrated unfortified reds.', 'UNESCO site. Port from Touriga Nacional blends. Unfortified Douro reds offer structure and concentration at great value.', {key_grapes:["Touriga Nacional","Touriga Franca","Tinta Roriz"]});
count += u('region', 'Stellenbosch', 'wine', 'South Africa\'s premier wine region — world-class Cabernet and Bordeaux blends.', 'Diverse soils, False Bay cooling. Home to Kanonkop, Rustenberg, Thelema. Anchors SA\'s fine wine ambitions.', {key_grapes:["Cabernet Sauvignon","Merlot","Syrah","Chardonnay"]});
count += u('region', 'Languedoc', 'wine', 'France\'s largest wine region, reinventing itself with quality-focused Mediterranean wines.', 'Corbières, Minervois, Faugères, Pic Saint-Loup. IGP Pays d\'Oc makes France\'s most accessible wines internationally.', {key_grapes:["Grenache","Syrah","Mourvèdre","Carignan"]});
count += u('region', 'Sicily', 'wine', 'Italy\'s largest island — Nero d\'Avola and volcanic Etna wines lead the charge.', 'Nero d\'Avola is the signature. Etna\'s Nerello Mascalese on volcanic soil has become a cult region.', {key_grapes:["Nero d'Avola","Nerello Mascalese","Grillo","Carricante"]});

// ── Spirits region ──────────────────────────────────────────────────────────
count += u('region', 'Speyside', 'spirits',
  'Scotland\'s densest concentration of distilleries — elegant, fruity, often sherried single malts.',
  'Over 50 distilleries. Ranges from light Glenlivet to richly sherried Macallan. The backbone of many premium blends.',
  {distillation_method:"Copper pot still",base_ingredient:"Malted barley",key_styles:["Fruity/Floral","Sherried","Light/Grassy"]});

// ── Top Brands ──────────────────────────────────────────────────────────────
count += u('brand', 'Riedel', 'accessories', 'World\'s leading wine glass manufacturer since 1756.', 'Austrian family-owned, 11th generation. Pioneered varietal-specific glassware.', {founding_year:1756,country:"Austria"});
count += u('brand', 'Penfolds', 'wine', 'Australia\'s most iconic wine brand — from Grange to Bin 389.', 'Founded 1844. Grange is Australia\'s first internationally recognised fine wine. Multi-region blending philosophy.', {founding_year:1844,country:"Australia"});
count += u('brand', 'Johnnie Walker', 'spirits', 'World\'s best-selling Scotch whisky — Red Label to Blue Label.', 'Since 1820. Colour-coded range spanning every occasion and price point. 18M+ cases annually.', {founding_year:1820,country:"Scotland"});
count += u('brand', 'Giffard', 'spirits', 'French liqueur house since 1885 — bartender-favourite syrups and liqueurs.', 'Founded by pharmacist Emile Giffard. 80+ products. Natural ingredients, Loire Valley sourcing.', {founding_year:1885,country:"France"});
count += u('brand', 'Joseph Drouhin', 'wine', 'One of Burgundy\'s most respected négociants since 1880.', 'Owns 73ha across Burgundy\'s finest appellations. Organic/biodynamic. Oregon venture established Willamette Pinot Noir.', {founding_year:1880,country:"France"});
count += u('brand', 'Hennessy', 'spirits', 'World\'s largest Cognac house — 40% of global production since 1765.', 'Founded by Irish officer. VS is world\'s best-selling Cognac. Eight-generation blending tradition.', {founding_year:1765,country:"France"});
count += u('brand', 'The Macallan', 'spirits', 'Speyside\'s most prestigious single malt — exceptional sherry cask maturation.', 'Founded 1824. Defined by sherry-seasoned oak. Smallest stills on Speyside. Among most valuable at auction.', {founding_year:1824,country:"Scotland"});
count += u('brand', 'Torres', 'wine', 'Spain\'s most international wine family since 1870.', 'Pioneered modern Spanish winemaking. Mas La Plana beat Latour in 1979. Now across Penedès, Priorat, Chile.', {founding_year:1870,country:"Spain"});
count += u('brand', 'Concha y Toro', 'wine', 'Chile\'s largest wine producer — Casillero del Diablo to Don Melchor.', 'Founded 1883. Latin America\'s largest wine company. Don Melchor is Chile\'s highest-rated wine.', {founding_year:1883,country:"Chile"});
count += u('brand', 'Suntory', 'spirits', 'Japan\'s pioneering spirits house — Yamazaki whisky, Roku Gin, Hibiki.', 'Founded 1899. Built Japan\'s first distillery (Yamazaki) in 1923. Acquired Beam Inc. in 2014.', {founding_year:1899,country:"Japan"});
count += u('brand', 'Louis Jadot', 'wine', 'Burgundy\'s largest and most consistent négociant since 1859.', 'Over 150ha. Grand Cru holdings include Chambertin-Clos de Bèze, Musigny. Iconic Bacchus head label.', {founding_year:1859,country:"France"});
count += u('brand', 'Jack Daniel\'s', 'spirits', 'World\'s best-selling American whiskey — Tennessee\'s iconic since 1866.', 'Lincoln County Process charcoal mellowing. Old No. 7 is the flagship. 13M+ cases annually.', {founding_year:1866,country:"USA"});
count += u('brand', 'Masumi', 'sake', 'Nagano\'s most celebrated sake brewery since 1662.', 'Kyokai No.7 yeast originated here. Alpine water, cold-climate brewing. Elegant, food-friendly sake.', {founding_year:1662,country:"Japan"});
count += u('brand', 'Dassai', 'sake', 'Yamaguchi\'s revolutionary junmai daiginjo specialist.', 'Only junmai daiginjo. Yamada Nishiki polished to extreme ratios. Dassai 23 (77% milled away). Joel Robuchon partnership.', {founding_year:1948,country:"Japan"});
count += u('brand', 'Domaines Barons de Rothschild', 'wine', 'The Lafite Rothschild empire — First Growth Bordeaux to global estates.', 'Château Lafite Rothschild since 1868. Portfolio: Duhart-Milon, L\'Évangile, Rieussec, Los Vascos, Long Dai.', {founding_year:1868,country:"France"});

const stats = db.prepare("SELECT status, count(*) as n FROM taxonomy_contexts GROUP BY status").all();
console.log(`\nUpdated: ${count} contexts`);
console.log('Status breakdown:');
for (const s of stats as any[]) console.log(`  ${s.status}: ${s.n}`);
console.log('Done!');
