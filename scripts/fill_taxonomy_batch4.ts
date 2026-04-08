/**
 * Batch 4 — Create missing taxonomy entities (spirits regions, wine regions, brands)
 * and fill their descriptions + attributes.
 */
import { getTaxonomyDb } from '../lib/taxonomy-db';
const db = getTaxonomyDb();

// ── Helpers ──────────────────────────────────────────────────────────────────

function createEntity(entityType: string, name: string, parentName?: string, parentType?: string): number | null {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let parentId: number | null = null;
  if (parentName && parentType) {
    const parent = db.prepare('SELECT id FROM taxonomy_entities WHERE entity_type = ? AND name = ?').get(parentType, parentName) as any;
    if (parent) parentId = parent.id;
    else console.warn(`  WARN: parent not found — ${parentType}/${parentName}`);
  }
  db.prepare('INSERT OR IGNORE INTO taxonomy_entities (entity_type, name, slug, parent_id) VALUES (?, ?, ?, ?)').run(entityType, name, slug, parentId);
  const entity = db.prepare('SELECT id FROM taxonomy_entities WHERE entity_type = ? AND slug = ?').get(entityType, slug) as any;
  return entity?.id ?? null;
}

function createContext(entityId: number, scopeId: string) {
  db.prepare("INSERT OR IGNORE INTO taxonomy_contexts (entity_id, scope_id, status) VALUES (?, ?, 'draft')").run(entityId, scopeId);
}

const update = db.prepare(`
  UPDATE taxonomy_contexts SET
    description_short = ?, description_en = ?,
    attributes = ?, status = 'validated',
    validated_at = datetime('now'), updated_at = datetime('now')
  WHERE entity_id = (
    SELECT id FROM taxonomy_entities WHERE entity_type = ? AND name = ?
  ) AND scope_id = ?
`);

function u(entityType: string, name: string, scopeId: string, short: string, full: string, attrs: Record<string, any>) {
  const changes = update.run(short, full, JSON.stringify(attrs), entityType, name, scopeId).changes;
  console.log(`  ${changes ? '✓' : '✗'} ${entityType}/${name} [${scopeId}]`);
  return changes;
}

let created = 0;
let filled = 0;

// ── 1. Spirits Regions ──────────────────────────────────────────────────────
console.log('\n=== Creating spirits regions ===');

const spiritsRegions: Array<{
  name: string; parent: string;
  short: string; full: string; attrs: Record<string, any>;
}> = [
  {
    name: 'Islay',
    parent: 'Scotland',
    short: 'Peat-smoke capital of Scotch whisky with nine active distilleries producing intensely maritime single malts.',
    full: 'Islay is a small Hebridean island off Scotland\'s west coast, renowned as the spiritual home of peated Scotch whisky. Its nine distilleries — Laphroaig, Ardbeg, Lagavulin, Bowmore, Bruichladdich, Kilchoman, Caol Ila, Bunnahabhain, and Ardnahoe — produce whiskies shaped by Atlantic winds, peat bogs, and coastal exposure. Styles range from the medicinal intensity of Laphroaig to the unpeated elegance of Bunnahabhain. The island\'s annual Feis Ile festival draws whisky enthusiasts worldwide. Islay malts are characterised by smoky, briny, iodine-laced profiles that remain among Scotch whisky\'s most distinctive expressions.',
    attrs: { climate: 'Maritime, windswept, moderate temperatures', key_styles: ['Peated single malt', 'Heavily peated', 'Unpeated (Bunnahabhain, Bruichladdich)'], key_distilleries: ['Laphroaig', 'Ardbeg', 'Lagavulin', 'Bowmore', 'Bruichladdich', 'Kilchoman', 'Caol Ila', 'Bunnahabhain'], distillery_count: 9 },
  },
  {
    name: 'Highland',
    parent: 'Scotland',
    short: 'Scotland\'s largest whisky region, producing an enormous diversity of styles from coastal to inland malts.',
    full: 'The Highland region encompasses the vast majority of Scotland\'s landmass north of an imaginary line from Greenock to Dundee. This geographic diversity yields a wide spectrum of whisky styles: coastal distilleries like Oban and Old Pulteney produce briny, maritime malts; inland producers such as Dalwhinnie and Edradour craft heathery, honeyed spirits; and northern operations like Glenmorangie are known for elegant, fruity complexity. Highland whiskies tend toward full-bodied, robust character, though the region resists easy generalisation. Notable distilleries also include Dalmore, Clynelish, and Ben Nevis.',
    attrs: { climate: 'Variable — maritime coast to cold inland', key_styles: ['Full-bodied single malt', 'Coastal malt', 'Fruity Highland malt'], key_distilleries: ['Oban', 'Dalmore', 'Glenmorangie', 'Dalwhinnie', 'Clynelish', 'Old Pulteney', 'Edradour'] },
  },
  {
    name: 'Lowland',
    parent: 'Scotland',
    short: 'Gentle, grassy Scotch whisky region known for light, approachable single malts, historically triple-distilled.',
    full: 'The Lowlands occupy the southern belt of Scotland below the Highland line. Historically the region favoured triple distillation, producing lighter, more delicate whiskies than their Highland and Islay counterparts. Active distilleries include Auchentoshan (the only Scottish distillery still triple-distilling every drop), Glenkinchie (Edinburgh\'s malt), and Bladnoch (Scotland\'s most southerly distillery). New wave producers like Kingsbarns and Lindores Abbey have joined the ranks. Lowland malts are typically grassy, floral, and citrus-noted — ideal aperitif whiskies.',
    attrs: { climate: 'Mild, temperate', key_styles: ['Triple-distilled single malt', 'Light aperitif malt'], key_distilleries: ['Auchentoshan', 'Glenkinchie', 'Bladnoch', 'Kingsbarns', 'Lindores Abbey'] },
  },
  {
    name: 'Campbeltown',
    parent: 'Scotland',
    short: 'Once Scotland\'s whisky capital with 30+ distilleries, now a revered three-distillery region producing complex, briny malts.',
    full: 'Campbeltown sits on the Kintyre peninsula and was once the Victorian-era whisky capital of Scotland, housing over 30 distilleries at its peak. Today only three remain — Springbank, Glen Scotia, and Glengyle (producing Kilkerran) — yet the region retains its own official classification. Springbank is particularly celebrated for its fully on-site production, from floor malting to bottling. Campbeltown whiskies are characterised by a distinctive combination of maritime salt, slight peat smoke, fruit, and oily texture that is unlike any other Scotch region.',
    attrs: { climate: 'Maritime, peninsular', key_styles: ['Briny single malt', 'Lightly peated', 'Complex oily malt'], key_distilleries: ['Springbank', 'Glen Scotia', 'Glengyle (Kilkerran)'], distillery_count: 3 },
  },
  {
    name: 'Kentucky',
    parent: 'USA',
    short: 'Heartland of American bourbon, producing 95% of the world\'s bourbon supply with limestone-filtered water and corn-rich mash bills.',
    full: 'Kentucky is the undisputed centre of bourbon production, responsible for approximately 95% of the global supply. The state\'s unique geological advantage — extensive limestone shelf filtering iron from water while adding calcium — provides ideal distilling conditions. Kentucky\'s hot summers and cold winters drive aggressive barrel interaction, accelerating maturation. Major producers include Maker\'s Mark (Loretto), Woodford Reserve (Versailles), Buffalo Trace and Wild Turkey (Lawrenceburg), Four Roses (Lawrenceburg), Jim Beam (Clermont), and Heaven Hill (Bardstown). The Kentucky Bourbon Trail draws over 1.5 million visitors annually.',
    attrs: { climate: 'Humid subtropical, extreme seasonal variation', soil: 'Limestone karst', key_styles: ['Bourbon', 'Rye whiskey', 'Wheated bourbon'], key_distilleries: ['Buffalo Trace', 'Maker\'s Mark', 'Woodford Reserve', 'Wild Turkey', 'Four Roses', 'Jim Beam', 'Heaven Hill'] },
  },
  {
    name: 'Tennessee',
    parent: 'USA',
    short: 'Home of Tennessee whiskey, distinguished by the Lincoln County Process of charcoal mellowing before barrel aging.',
    full: 'Tennessee whiskey is legally distinct from bourbon through the Lincoln County Process, in which new-make spirit is filtered drop by drop through sugar maple charcoal before entering barrels. This mellowing step imparts a smooth, slightly sweet character. Jack Daniel\'s in Lynchburg dominates production and is the world\'s best-selling American whiskey. George Dickel in Tullahoma offers a contrasting, slightly drier style and chills its spirit before charcoal filtering. Newer entrants include Nelson\'s Green Brier and Chattanooga Whiskey. Tennessee\'s climate, similar to Kentucky\'s, provides strong barrel maturation dynamics.',
    attrs: { climate: 'Humid subtropical', key_styles: ['Tennessee whiskey', 'Charcoal-mellowed'], key_distilleries: ['Jack Daniel\'s', 'George Dickel', 'Nelson\'s Green Brier', 'Chattanooga Whiskey'], process: 'Lincoln County Process (charcoal mellowing)' },
  },
  {
    name: 'Jalisco',
    parent: 'Mexico',
    short: 'Tequila\'s heartland in western Mexico, where highland and lowland zones produce distinctly different agave spirit styles.',
    full: 'Jalisco is the birthplace and primary production zone of tequila, accounting for the vast majority of the spirit\'s output. The state contains two principal growing zones: the highlands (Los Altos), where red clay soils and cooler temperatures produce larger agave plants yielding sweeter, fruitier tequilas; and the lowlands (Tequila Valley), where volcanic soil and warmer conditions create earthier, more herbaceous expressions. Only Blue Weber agave (Agave tequilana) may be used. Major producers based in Jalisco include Jose Cuervo, Sauza, Patrón, Don Julio, Herradura, and Fortaleza. The town of Tequila is a UNESCO World Heritage Site.',
    attrs: { climate: 'Semi-arid highlands, tropical lowlands', soil: 'Red clay (highlands), volcanic (lowlands)', key_styles: ['Blanco tequila', 'Reposado tequila', 'Anejo tequila', 'Extra anejo'], key_agave: 'Blue Weber (Agave tequilana)' },
  },
  {
    name: 'Oaxaca',
    parent: 'Mexico',
    short: 'Mezcal\'s spiritual home, producing over 90% of Mexico\'s mezcal from wild and cultivated agave using artisanal pit-roasting methods.',
    full: 'Oaxaca is the epicentre of mezcal production, responsible for more than 90% of certified output. The state\'s rugged mountainous terrain, diverse microclimates, and rich agave biodiversity — over 30 species used — make it mezcal\'s most complex producing region. Traditional production involves roasting agave hearts (piñas) in earthen pit ovens, crushing with a tahona (stone wheel) or by hand, and fermenting in open-air wooden vats. Key mezcal-producing districts include Santiago Matatlán (self-proclaimed "world capital of mezcal"), Sola de Vega, Miahuatlán, and Ejutla. The artisanal and ancestral categories are legally protected production methods.',
    attrs: { climate: 'Semi-arid to tropical, mountainous', key_styles: ['Joven mezcal', 'Reposado mezcal', 'Ancestral mezcal', 'Pechuga'], key_agave: ['Espadín', 'Tobalá', 'Madrecuixe', 'Arroqueño', 'Tepeztate'], production: 'Artisanal pit-roasting' },
  },
  {
    name: 'Cognac',
    parent: 'France',
    short: 'Premier French brandy region with six classified crus, producing double-distilled grape spirit aged in Limousin and Tronçais oak.',
    full: 'Cognac is an AOC-protected brandy from the Charente and Charente-Maritime departments in southwestern France. The region is divided into six crus ranked by quality potential: Grande Champagne (finest, longest-aging), Petite Champagne, Borderies (smallest, distinctive violet and iris notes), Fins Bois, Bons Bois, and Bois Ordinaires. Production requires double distillation in copper pot stills (alembic charentais) and minimum aging in French oak. Major houses include Hennessy, Rémy Martin, Martell, and Courvoisier. Age designations — VS (minimum 2 years), VSOP (minimum 4 years), XO (minimum 10 years) — govern the category. Ugni Blanc is the dominant grape variety.',
    attrs: { climate: 'Maritime, mild', soil: 'Chalk and limestone (Grande/Petite Champagne)', key_styles: ['VS', 'VSOP', 'XO', 'Extra', 'Hors d\'Age'], key_grapes: ['Ugni Blanc', 'Folle Blanche', 'Colombard'], crus: ['Grande Champagne', 'Petite Champagne', 'Borderies', 'Fins Bois', 'Bons Bois', 'Bois Ordinaires'] },
  },
  {
    name: 'Armagnac',
    parent: 'France',
    short: 'France\'s oldest brandy region in Gascony, single-distilled in column stills for a rustic, characterful spirit.',
    full: 'Armagnac predates Cognac by roughly 150 years, making it France\'s oldest grape brandy. Produced in the Gers, Landes, and Lot-et-Garonne departments of Gascony, it is traditionally single-distilled through a continuous copper column still (alambic armagnacais), yielding a more robust, aromatic spirit than its double-distilled Cognac cousin. The region divides into three production zones: Bas-Armagnac (finest, sandy Fezensac soils), Ténarèze (clay-limestone, fuller style), and Haut-Armagnac (smallest output). Vintage-dated bottlings and single-estate production are far more common than in Cognac. Key grape varieties include Ugni Blanc, Baco 22A, Folle Blanche, and Colombard.',
    attrs: { climate: 'Continental with Atlantic influence', soil: 'Sandy (Bas-Armagnac), clay-limestone (Ténarèze)', key_styles: ['VS', 'VSOP', 'XO', 'Hors d\'Age', 'Vintage-dated'], key_grapes: ['Ugni Blanc', 'Baco 22A', 'Folle Blanche', 'Colombard'], subregions: ['Bas-Armagnac', 'Ténarèze', 'Haut-Armagnac'] },
  },
];

for (const r of spiritsRegions) {
  const id = createEntity('region', r.name, r.parent, 'country');
  if (id) { createContext(id, 'spirits'); created++; }
}

console.log('\n=== Filling spirits region descriptions ===');
for (const r of spiritsRegions) {
  filled += u('region', r.name, 'spirits', r.short, r.full, r.attrs);
}

// ── 2. Wine Regions ─────────────────────────────────────────────────────────
console.log('\n=== Creating wine regions ===');

const wineRegions: Array<{
  name: string; parent: string;
  short: string; full: string; attrs: Record<string, any>;
}> = [
  {
    name: 'Sauternes',
    parent: 'France',
    short: 'Bordeaux appellation producing the world\'s greatest botrytised sweet wines from Semillon, Sauvignon Blanc, and Muscadelle.',
    full: 'Sauternes is a prestigious appellation within Bordeaux\'s Graves district, renowned for producing lusciously sweet white wines through noble rot (Botrytis cinerea). The confluence of the cold Ciron tributary with the warmer Garonne creates morning mists that encourage botrytis development, concentrating sugars and aromatics in the grapes. Chateau d\'Yquem, classified Premier Cru Supérieur in the 1855 Classification, stands as the benchmark. Other top estates include Suduiraut, Climens (in neighbouring Barsac), Rieussec, and Coutet. The wines combine honeyed richness with vibrant acidity, enabling decades of cellar development.',
    attrs: { climate: 'Oceanic, humid autumn mornings', soil: 'Gravel, clay, limestone', key_grapes: ['Semillon', 'Sauvignon Blanc', 'Muscadelle'], classification: '1855 Classification — Premier Cru Supérieur (Yquem)' },
  },
  {
    name: 'Willamette Valley',
    parent: 'USA',
    short: 'Oregon\'s premier wine region, internationally acclaimed for cool-climate Pinot Noir on volcanic Jory soils.',
    full: 'The Willamette Valley stretches 150 miles south from Portland through western Oregon, sheltered by the Coast Range and Cascades. Its cool, marine-influenced climate closely parallels Burgundy, making it one of the New World\'s finest Pinot Noir sources. The volcanic Jory soils — deep, red, basalt-derived clay — are particularly prized in sub-AVAs like Dundee Hills, Eola-Amity Hills, and Ribbon Ridge. Chardonnay and Pinot Gris also perform exceptionally. The region has grown from a handful of pioneers in the 1960s (David Lett, Dick Erath) to over 700 wineries. Key producers include Domaine Drouhin, Eyrie Vineyards, Bergstrom, and Beaux Freres.',
    attrs: { climate: 'Cool maritime, marine-influenced', soil: 'Volcanic Jory, marine sedimentary, loess', key_grapes: ['Pinot Noir', 'Chardonnay', 'Pinot Gris'], sub_avas: ['Dundee Hills', 'Eola-Amity Hills', 'Ribbon Ridge', 'Chehalem Mountains', 'McMinnville'] },
  },
  {
    name: 'Paso Robles',
    parent: 'USA',
    short: 'Central California wine region celebrated for bold Rhone-style blends, Zinfandel, and Cabernet Sauvignon with extreme diurnal swings.',
    full: 'Paso Robles is a sprawling AVA in San Luis Obispo County on California\'s Central Coast, encompassing over 40,000 vineyard acres across 11 sub-districts. The region\'s defining feature is an extreme diurnal temperature variation — often exceeding 50°F (28°C) between day and night — which preserves acidity while allowing full phenolic ripeness. Rhone varieties (Grenache, Syrah, Mourvèdre) and Zinfandel have become signatures, though Cabernet Sauvignon dominates plantings. The western Adelaida District, with its calcareous soils and coastal influence, produces particularly structured wines. Notable producers include Tablas Creek, Justin, Daou, and Epoch.',
    attrs: { climate: 'Mediterranean, extreme diurnal temperature variation', soil: 'Calcareous (west), alluvial (east), shale', key_grapes: ['Cabernet Sauvignon', 'Zinfandel', 'Grenache', 'Syrah', 'Mourvèdre'], sub_districts: ['Adelaida District', 'Willow Creek', 'Paso Robles Estrella', 'San Juan Creek'] },
  },
  {
    name: 'Swartland',
    parent: 'South Africa',
    short: 'South Africa\'s revolution region, leading the old-vine, minimal-intervention movement with Chenin Blanc, Syrah, and Grenache.',
    full: 'Swartland (meaning "black land," for its indigenous renosterbos shrub) lies northwest of Cape Town in the Western Cape. Once dismissed as a bulk-wine and wheat-farming zone, it has undergone a dramatic transformation since the early 2000s, driven by a new generation of winemakers committed to old-vine Chenin Blanc, Mediterranean red varieties, and minimal-intervention winemaking. The Swartland Independent Producers guild champions site-specific, low-yield viticulture. Key figures include Eben Sadie (Sadie Family), Adi Badenhorst, Chris and Andrea Mullineux, and David Sadie (Lammershoek). The region\'s granite, shale, and schist soils, combined with a warm Mediterranean climate tempered by coastal breezes, produce wines of remarkable depth and complexity.',
    attrs: { climate: 'Mediterranean, warm, moderated by Atlantic', soil: 'Granite, shale, schist, ferricrete', key_grapes: ['Chenin Blanc', 'Syrah', 'Grenache', 'Cinsault', 'Mourvedre'] },
  },
  {
    name: 'Wachau',
    parent: 'Austria',
    short: 'UNESCO-listed Danube terrace vineyards producing Austria\'s most prestigious dry Riesling and Gruner Veltliner.',
    full: 'The Wachau is a narrow, 33-kilometre stretch of the Danube valley west of Vienna, designated a UNESCO World Heritage cultural landscape. Its steep, terraced vineyards on primary rock (gneiss and granite) soils produce some of Austria\'s most intense and age-worthy dry white wines. The region operates its own unique quality classification — Steinfeder (lightest, up to 11% ABV), Federspiel (medium, 11.5-12.5%), and Smaragd (richest, 12.5%+) — administered by the Vinea Wachau association. Gruner Veltliner and Riesling dominate, with top sites like Achleiten, Kellerberg, and Loibenberg commanding premium prices. Leading producers include F.X. Pichler, Domane Wachau, Knoll, Hirtzberger, and Prager.',
    attrs: { climate: 'Continental with Pannonian influence, warm days, cool nights', soil: 'Primary rock — gneiss, granite, loess terraces', key_grapes: ['Gruner Veltliner', 'Riesling'], classification: 'Steinfeder / Federspiel / Smaragd (Vinea Wachau)' },
  },
  {
    name: 'Kamptal',
    parent: 'Austria',
    short: 'Leading Austrian DAC wine region in the Kamp valley, excelling in Gruner Veltliner and Riesling on loess and primary rock soils.',
    full: 'Kamptal takes its name from the Kamp river valley north of the Danube, centred around the town of Langenlois — Austria\'s largest wine-producing municipality. The region benefits from a convergence of two geological zones: warm loess soils on the eastern slopes (producing broader, fruit-driven wines) and cool primary rock (gneiss, schist) on the western terraces (yielding mineral, structured expressions). Kamptal was among the first Austrian regions to adopt the DAC (Districtus Austriae Controllatus) appellation system in 2008. Top vineyard sites include Heiligenstein (a celebrated Riesling cru), Lamm, and Kogelberg. Key producers are Schloss Gobelsburg, Brundlmayer, Hiedler, and Jurtschitsch.',
    attrs: { climate: 'Continental, Pannonian warmth with cool river influence', soil: 'Loess, primary rock (gneiss, schist)', key_grapes: ['Gruner Veltliner', 'Riesling'], designation: 'Kamptal DAC (since 2008)' },
  },
  {
    name: 'Tokaj',
    parent: 'Hungary',
    short: 'Historic Hungarian wine region producing legendary botrytised Tokaji Aszu from the Furmint grape, with centuries of documented winemaking.',
    full: 'Tokaj (or Tokaj-Hegyalja) in northeastern Hungary is one of the world\'s oldest classified wine regions, with royal decree establishing vineyard classifications as early as 1730 — predating Bordeaux\'s 1855 system by over a century. The region\'s signature wine, Tokaji Aszu, is made from botrytis-affected Furmint and Harslevelu grapes, with sweetness historically measured in puttonyos (baskets of aszu berries added to base wine). The volcanic soils, sheltered valley microclimate, and autumn mists from the Bodrog and Tisza rivers create ideal conditions for noble rot. Modern Tokaj also excels in dry Furmint, which has gained international recognition. Key producers include Royal Tokaji, Disznoko, Oremus, Szepsy, and Dobogo.',
    attrs: { climate: 'Continental with river-influenced autumn humidity', soil: 'Volcanic (rhyolite, andesite), clay, loess', key_grapes: ['Furmint', 'Harslevelu', 'Sarga Muskotaly'], classification: 'Puttonyos system (3-6), Eszencia' },
  },
];

for (const r of wineRegions) {
  const id = createEntity('region', r.name, r.parent, 'country');
  if (id) { createContext(id, 'wine'); created++; }
}

console.log('\n=== Filling wine region descriptions ===');
for (const r of wineRegions) {
  filled += u('region', r.name, 'wine', r.short, r.full, r.attrs);
}

// ── 3. Existing draft contexts (Beaujolais, Chablis, Jerez) ────────────────
console.log('\n=== Filling existing draft contexts ===');

// Beaujolais — subregion, wine scope
filled += u('subregion', 'Beaujolais', 'wine',
  'Granite-soiled Burgundy cru region famous for Gamay, from light Nouveau to age-worthy Morgon and Moulin-a-Vent.',
  'Beaujolais occupies the southern end of Greater Burgundy, extending from the Maconnais south to the outskirts of Lyon. Its granite and schist soils are ideally suited to the Gamay grape, which is the region\'s sole permitted red variety. Ten cru appellations — Morgon, Moulin-a-Vent, Fleurie, Brouilly, Cote de Brouilly, Chiroubles, Saint-Amour, Julienas, Chenas, and Regnie — produce structured, terroir-driven wines that can age for a decade or more. Beaujolais Nouveau, released each November, remains commercially significant but represents only a fraction of the region\'s quality spectrum. Semi-carbonic maceration (whole-cluster fermentation) is the traditional vinification method, yielding fresh, aromatic wines with soft tannins.',
  { climate: 'Continental with Mediterranean influence in the south', soil: 'Granite, schist (crus), clay-limestone (south)', key_grapes: ['Gamay'], crus: ['Morgon', 'Moulin-a-Vent', 'Fleurie', 'Brouilly', 'Cote de Brouilly', 'Chiroubles', 'Saint-Amour', 'Julienas', 'Chenas', 'Regnie'] }
);

// Chablis — subregion, wine scope
filled += u('subregion', 'Chablis', 'wine',
  'Northernmost Burgundy appellation producing crystalline, mineral-driven Chardonnay on Kimmeridgian limestone.',
  'Chablis lies in the Yonne department, roughly 100 miles northwest of the Cote d\'Or, making it Burgundy\'s coolest and most northerly district. Its signature Kimmeridgian limestone-marl soils — packed with fossilised Exogyra virgula oyster shells — impart a distinctive flinty, mineral character to the Chardonnay grape. The appellation hierarchy runs from Petit Chablis and Chablis through seven Premiers Crus to seven Grands Crus (Blanchot, Bougros, Les Clos, Grenouilles, Les Preuses, Valmur, Vaudesir) on a single southwest-facing slope above the Serein river. A philosophical divide persists between producers who ferment in stainless steel (preserving steely purity) and those who favour oak (adding breadth and complexity). Key producers include Raveneau, Dauvissat, William Fevre, and Long-Depaquit.',
  { climate: 'Cool continental, frost-prone', soil: 'Kimmeridgian limestone-marl', key_grapes: ['Chardonnay'], grands_crus: ['Blanchot', 'Bougros', 'Les Clos', 'Grenouilles', 'Les Preuses', 'Valmur', 'Vaudesir'] }
);

// Jerez — region, spirits scope (sherry brandy context)
filled += u('region', 'Jerez', 'spirits',
  'Andalusian sherry triangle producing fortified wines and Brandy de Jerez through the solera aging system.',
  'Jerez de la Frontera, together with El Puerto de Santa Maria and Sanlucar de Barrameda, forms the "Sherry Triangle" in southwestern Andalusia, Spain. The region\'s albariza soils (bright white chalk) retain moisture through hot summers, sustaining Palomino and Pedro Ximenez vines. Brandy de Jerez, aged through the solera fractional-blending system in former sherry casks, is a major product alongside the fortified wines themselves. Styles range from bone-dry Fino and Manzanilla to rich, sweet Pedro Ximenez. The biological aging under flor yeast (a film of yeast on the wine surface) produces the distinctive tangy, saline character of Fino and Manzanilla sherries. Key houses include Gonzalez Byass (Tio Pepe), Lustau, Osborne, and Bodegas Tradicion.',
  { climate: 'Mediterranean, hot, Atlantic-influenced', soil: 'Albariza (chalk), barros (clay), arenas (sand)', key_styles: ['Fino', 'Manzanilla', 'Amontillado', 'Oloroso', 'Palo Cortado', 'Pedro Ximenez', 'Brandy de Jerez'], aging_system: 'Solera' }
);

// Also create a wine-scope context for Jerez since it's primarily a wine region
const jerezEntity = db.prepare("SELECT id FROM taxonomy_entities WHERE entity_type = 'region' AND name = 'Jerez'").get() as any;
if (jerezEntity) {
  createContext(jerezEntity.id, 'wine');
  filled += u('region', 'Jerez', 'wine',
    'The Sherry Triangle in Andalusia, producing the world\'s most diverse range of fortified wines from Palomino and Pedro Ximenez.',
    'The Jerez-Xeres-Sherry Denominacion de Origen protects one of the world\'s most complex and underappreciated wine styles. Centred on Jerez de la Frontera, El Puerto de Santa Maria, and Sanlucar de Barrameda in Cadiz province, the region\'s brilliant white albariza chalk soils and warm Mediterranean climate produce fortified wines of extraordinary variety. Biological aging under flor yeast creates the bone-dry Fino and Manzanilla styles; oxidative aging yields the nutty Amontillado and rich Oloroso. Palo Cortado — a rare style combining Amontillado finesse with Oloroso body — is among the wine world\'s great treasures. Sun-dried Pedro Ximenez grapes produce viscously sweet dessert wines. The solera fractional-blending system ensures consistency across vintages.',
    { climate: 'Hot Mediterranean with Atlantic sea breezes', soil: 'Albariza (chalk), barros, arenas', key_grapes: ['Palomino Fino', 'Pedro Ximenez', 'Moscatel'], classification: 'DO Jerez-Xeres-Sherry, DO Manzanilla-Sanlucar de Barrameda' }
  );
}

// ── 4. Brands ───────────────────────────────────────────────────────────────
console.log('\n=== Creating brands ===');

const brands: Array<{
  name: string; scope: string;
  short: string; full: string; attrs: Record<string, any>;
}> = [
  {
    name: "Hendrick's",
    scope: 'spirits',
    short: 'Scottish gin distilled with an unusual combination of cucumber and Bulgarian rose petals alongside traditional botanicals.',
    full: "Hendrick's is a super-premium gin produced by William Grant & Sons at the Girvan distillery in Ayrshire, Scotland. Launched in 1999, it broke with London Dry convention by infusing cucumber and Bulgarian Rosa damascena petals into separately distilled spirit from a Carter-Head still and a Bennett copper pot still. The two distillates are blended in small batches of 500 litres. The brand's distinctive apothecary-style bottle and offbeat marketing established it as the catalyst for the modern gin renaissance. Extensions include Hendrick's Orbium, Lunar, Neptunia, and Flora Adora. The recommended serve — garnished with cucumber rather than citrus — has become iconic.",
    attrs: { founding_year: 1999, country: 'Scotland', parent_company: 'William Grant & Sons', key_products: ["Hendrick's Gin", "Hendrick's Orbium", "Hendrick's Lunar", "Hendrick's Neptunia"], still_type: 'Carter-Head + Bennett pot still' },
  },
  {
    name: 'Tanqueray',
    scope: 'spirits',
    short: 'Iconic London Dry gin since 1830, built on a famously secretive recipe of just four core botanicals.',
    full: 'Tanqueray is a cornerstone London Dry gin founded by Charles Tanqueray at his Bloomsbury distillery in 1830. The original recipe reportedly uses only four botanicals — juniper, coriander, angelica root, and liquorice — though the exact formula remains a closely guarded secret. The distinctive green cocktail-shaker bottle has been a brand icon for decades. Tanqueray No. Ten, launched in 2000 and distilled in a small copper pot still nicknamed "Tiny Ten," uses fresh citrus fruits and chamomile, earning widespread acclaim as a premium sipping gin. The brand is now owned by Diageo and produced at Cameronbridge in Scotland. Other expressions include Tanqueray Rangpur, Flor de Sevilla, and Blackcurrant Royale.',
    attrs: { founding_year: 1830, country: 'England (now produced in Scotland)', parent_company: 'Diageo', key_products: ['Tanqueray London Dry', 'Tanqueray No. Ten', 'Tanqueray Rangpur', 'Tanqueray Flor de Sevilla'] },
  },
  {
    name: 'Marie Brizard',
    scope: 'spirits',
    short: 'Historic French liqueur house established in 1755, renowned for its signature anisette and broad range of fruit liqueurs.',
    full: 'Marie Brizard was founded in Bordeaux in 1755 by its namesake, who reportedly received the anisette recipe from a West Indian sailor she nursed back to health. The brand\'s anisette — a sweet, anise-flavoured liqueur — became its flagship product and remains in production today. Over nearly three centuries, the house expanded into a comprehensive range of fruit liqueurs, syrups, and spirits, making it a staple of professional bars worldwide. The company is now part of Marie Brizard Wine & Spirits (MBWS), listed on Euronext Paris. Key products include the original Anisette, Apry (apricot brandy), Parfait Amour, and a wide range of cremes and fruit liqueurs used extensively in cocktail-making.',
    attrs: { founding_year: 1755, country: 'France', parent_company: 'Marie Brizard Wine & Spirits (MBWS)', key_products: ['Marie Brizard Anisette', 'Apry', 'Parfait Amour', 'Watermelon Liqueur', 'Cassis'] },
  },
  {
    name: 'Lucaris',
    scope: 'accessories',
    short: 'Thai-designed crystal wine glassware brand created in partnership with Zwiesel Kristallglas of Germany.',
    full: 'Lucaris is a premium crystal glassware brand conceived in Thailand and developed in technical partnership with Zwiesel Kristallglas (now Zwiesel Glas), one of Germany\'s leading glass manufacturers. The collaboration combines Asian design sensibility with German crystal engineering, using Zwiesel\'s patented Tritan crystal technology for enhanced break resistance and brilliance. Collections are designed by international sommeliers to optimise aroma and flavour delivery for specific wine styles. Key ranges include Desire (universal everyday), Shanghai Soul (Asian-influenced premium), and the Lucaris Elements series. The brand has gained particular traction in Asian hospitality markets, where it is a preferred supplier for luxury hotels and fine-dining restaurants.',
    attrs: { founding_year: 2010, country: 'Thailand', partner: 'Zwiesel Kristallglas (Germany)', key_products: ['Desire Collection', 'Shanghai Soul', 'Elements Series'], technology: 'Tritan crystal' },
  },
  {
    name: 'Eurocave',
    scope: 'accessories',
    short: 'French pioneer of the wine cabinet, producing professional-grade wine storage and service equipment since 1976.',
    full: 'EuroCave was founded in 1976 in Lyon, France, and is credited with inventing the modern wine cabinet (cave a vin). The company engineered the first purpose-built, temperature-and-humidity-controlled wine storage unit for domestic use, solving the problem of proper wine maturation for collectors without natural cellars. EuroCave cabinets maintain stable temperature (10-14°C), humidity (50-80%), vibration damping, and UV-filtered lighting. The range spans from compact countertop units to walk-in cellar solutions and commercial hospitality installations. The brand also produces wine-service equipment including the Wine Art wine-by-the-glass system. EuroCave remains the reference standard against which all wine storage manufacturers are measured.',
    attrs: { founding_year: 1976, country: 'France', key_products: ['Premiere Range', 'Pure Range', 'Royale Range', 'Wine Art by-the-glass system', 'Commercial cellars'], specialty: 'Temperature-controlled wine storage' },
  },
  {
    name: 'Joseph Cartron',
    scope: 'spirits',
    short: 'Burgundy-based artisanal liqueur house since 1882, celebrated for its Creme de Cassis and fruit liqueurs made from local produce.',
    full: 'Maison Joseph Cartron was established in 1882 in Nuits-Saint-Georges, in the heart of Burgundy. The house specialises in fruit-based liqueurs and cremes, with Creme de Cassis de Bourgogne — made from locally grown Noir de Bourgogne blackcurrants — as its flagship product. The distillery processes fresh fruit within hours of harvest to preserve aromatics, using cold maceration and careful distillation. The range extends to over 50 liqueurs, eaux-de-vie, and cremes, including notable expressions of raspberry (framboise), cherry (griotte), blackberry (mure), and pear (poire Williams). Joseph Cartron products are a staple in French professional bars and are exported to over 50 countries. The family-owned business remains independent.',
    attrs: { founding_year: 1882, country: 'France', key_products: ['Creme de Cassis de Bourgogne', 'Creme de Framboise', 'Poire Williams', 'Creme de Mure', 'Triple Sec'], specialty: 'Fruit liqueurs and cremes', ownership: 'Family-owned, independent' },
  },
];

for (const b of brands) {
  const id = createEntity('brand', b.name);
  if (id) { createContext(id, b.scope); created++; }
}

console.log('\n=== Filling brand descriptions ===');
for (const b of brands) {
  filled += u('brand', b.name, b.scope, b.short, b.full, b.attrs);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n=== Summary ===');
console.log(`Entities created/ensured: ${created}`);
console.log(`Contexts filled: ${filled}`);

const stats = db.prepare('SELECT count(*) as n FROM taxonomy_entities').get() as any;
const ctxStats = db.prepare('SELECT count(*) as n FROM taxonomy_contexts').get() as any;
const valStats = db.prepare("SELECT count(*) as n FROM taxonomy_contexts WHERE status = 'validated'").get() as any;
console.log(`Total entities: ${stats.n}`);
console.log(`Total contexts: ${ctxStats.n}`);
console.log(`Validated contexts: ${valStats.n}`);
