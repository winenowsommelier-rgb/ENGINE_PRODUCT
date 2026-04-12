/**
 * Batch 5: Add coordinates to countries/regions + fill subregion/appellation descriptions
 * Run: npx tsx scripts/fill_taxonomy_batch5.ts
 */
import { getTaxonomyDb } from '../lib/taxonomy-db';
const db = getTaxonomyDb();

let count = 0;

// ── PART 1: Country coordinates ─────────────────────────────────────────────
const updateCoords = db.prepare('UPDATE taxonomy_entities SET latitude = ?, longitude = ? WHERE entity_type = ? AND name = ?');

const countries: [number, number, string][] = [
  [46.6, 2.2, 'France'], [42.5, 12.5, 'Italy'], [38.5, -121.5, 'USA'],
  [-34.9, 138.6, 'Australia'], [39.5, -3.7, 'Spain'], [-33.5, -70.6, 'Chile'],
  [-33.0, -68.5, 'Argentina'], [35.7, 139.7, 'Japan'], [56.5, -4.0, 'Scotland'],
  [-41.3, 174.8, 'New Zealand'], [50.0, 8.3, 'Germany'], [-33.9, 18.9, 'South Africa'],
  [41.2, -8.6, 'Portugal'], [48.3, 15.5, 'Austria'], [14.5, 100.5, 'Thailand'],
  [47.5, 19.1, 'Hungary'], [38.0, 23.7, 'Greece'], [33.9, 35.5, 'Lebanon'],
  [42.0, 43.5, 'Georgia'], [51.5, -1.5, 'England'], [35.0, 105.0, 'China'],
  [-12.0, -77.0, 'Peru'], [-34.9, -56.2, 'Uruguay'], [23.6, -102.5, 'Mexico'],
  [46.1, 14.8, 'Slovenia'], [48.7, 19.7, 'Slovakia'], [57.0, 25.0, 'Latvia'],
  [53.4, -8.2, 'Ireland'], [55.7, -3.5, 'UK'], [60.1, 25.0, 'Finland'],
  [59.3, 18.1, 'Sweden'], [52.1, 5.3, 'Netherlands'], [50.8, 4.4, 'Belgium'],
  [52.2, 21.0, 'Poland'], [55.8, 37.6, 'Russia'], [25.0, 121.5, 'Taiwan'],
  [16.0, 108.0, 'Vietnam'], [-15.8, -47.9, 'Brazil'], [4.7, -74.1, 'Colombia'],
  [18.1, -77.3, 'Jamaica'], [13.2, -59.5, 'Barbados'], [14.6, -90.5, 'Guatemala'],
  [10.5, -61.3, 'Trinidad'], [10.5, -61.3, 'Trinidad & Tobago'],
  [45.0, -75.7, 'Canada'], [20.6, 79.0, 'India'], [-6.2, 106.8, 'Indonesia'],
  [14.6, 121.0, 'Philippines'], [23.0, -82.4, 'Cuba'], [64.1, -21.9, 'Iceland'],
  [-18.1, 178.4, 'Fiji'], [12.6, -70.0, 'Anguilla'], [32.3, -64.8, 'Bermuda'],
  [18.5, -69.9, 'Dominican Republic'], [12.1, -68.9, 'Grenada'],
  [6.8, -58.2, 'Guyana'], [14.6, -61.0, 'Martinique'], [43.7, 7.4, 'Monaco'],
  [12.1, -86.3, 'Nicaragua'], [9.0, -79.5, 'Panama'], [10.5, -67.0, 'Venezuela'],
  [56.9, 24.1, 'Latvia'], [8.5, -80.0, 'Panama'],
];
let coordCount = 0;
for (const [lat, lng, name] of countries) {
  const r = updateCoords.run(lat, lng, 'country', name);
  if (r.changes > 0) coordCount++;
}
console.log(`Countries with coordinates: ${coordCount}`);

// ── PART 2: Region coordinates ──────────────────────────────────────────────
const regions: [number, number, string][] = [
  [44.84, -0.58, 'Bordeaux'], [47.0, 4.8, 'Burgundy'], [49.0, 3.9, 'Champagne'],
  [43.3, 11.3, 'Tuscany'], [38.5, -122.3, 'Napa'], [44.7, 8.0, 'Piedmont'],
  [-34.5, 138.9, 'Barossa'], [42.5, -2.5, 'Rioja'], [-33.0, -68.5, 'Mendoza'],
  [-41.5, 174.0, 'Marlborough'], [45.4, 12.3, 'Veneto'], [37.3, -119.5, 'California'],
  [-35.0, 138.5, 'South Australia'], [43.3, 3.3, 'Languedoc'], [-34.0, -71.2, 'Central Valley'],
  [37.8, 15.0, 'Sicily'], [41.1, 16.9, 'Puglia'], [43.7, 6.5, 'Provence'],
  [45.3, -123.1, 'Willamette Valley'], [-33.8, 115.0, 'Margaret River'],
  [-35.2, 138.5, 'McLaren Vale'], [41.7, -3.5, 'Ribera del Duero'],
  [41.2, 0.8, 'Priorat'], [42.2, -8.8, 'Rías Baixas'], [46.2, 4.7, 'Beaujolais'],
  [47.8, 3.8, 'Chablis'], [44.6, -0.3, 'Sauternes'], [38.4, -122.7, 'Sonoma'],
  [35.6, -120.7, 'Paso Robles'], [-39.6, 176.9, 'Hawke\'s Bay'],
  [-45.0, 169.2, 'Central Otago'], [-33.4, 18.7, 'Swartland'],
  [48.4, 15.4, 'Wachau'], [48.5, 15.7, 'Kamptal'], [48.3, 21.5, 'Tokaj'],
  [44.1, -0.5, 'Graves'], [41.2, -8.2, 'Douro'], [-34.0, 18.9, 'Stellenbosch'],
  [45.9, 7.0, 'Rhône Valley'], [49.9, 7.6, 'Mosel'], [48.2, 7.3, 'Alsace'],
  [47.3, -0.3, 'Loire'], [-34.9, 139.0, 'Eden Valley'], [-33.8, 138.7, 'Clare Valley'],
  [-37.8, 145.5, 'Yarra Valley'], [-32.8, 151.3, 'Hunter Valley'],
  [50.0, 8.0, 'Rheingau'], [49.5, 8.2, 'Pfalz'], [49.8, 8.3, 'Rheinhessen'],
  [48.0, 7.8, 'Baden'], [57.5, -3.2, 'Speyside'], [55.8, -6.2, 'Islay'],
  [57.0, -5.0, 'Highland'], [55.4, -5.6, 'Campbeltown'],
  [38.2, -85.7, 'Kentucky'], [35.8, -86.7, 'Tennessee'],
  [20.7, -103.3, 'Jalisco'], [16.9, -96.7, 'Oaxaca'],
  [45.7, -0.3, 'Cognac'], [43.9, -0.1, 'Armagnac'],
  [42.4, 2.0, 'Penedès'], [36.7, -6.1, 'Jerez'],
  [14.5, 101.4, 'Khao Yai'], [12.6, 99.9, 'Hua Hin Hills'],
  [-33.9, 18.6, 'Paarl'], [-33.9, 19.1, 'Franschhoek'],
  [-34.1, 18.4, 'Constantia'], [-34.4, 19.6, 'Walker Bay'],
  [-34.2, 18.8, 'Elgin'], [42.8, 11.8, 'Brunello di Montalcino'],
];
let regionCoordCount = 0;
for (const [lat, lng, name] of regions) {
  const r = updateCoords.run(lat, lng, 'region', name);
  if (r.changes > 0) regionCoordCount++;
}
console.log(`Regions with coordinates: ${regionCoordCount}`);

// ── PART 3: Subregion descriptions ──────────────────────────────────────────
const update = db.prepare(`
  UPDATE taxonomy_contexts SET
    description_short = ?, description_en = ?,
    attributes = ?, status = 'validated',
    validated_at = datetime('now'), updated_at = datetime('now')
  WHERE entity_id = (
    SELECT id FROM taxonomy_entities WHERE entity_type = ? AND name = ?
  ) AND scope_id = ?
`);

function u(type: string, name: string, scope: string, short: string, full: string, attrs?: any) {
  const r = update.run(short, full, JSON.stringify(attrs || {}), type, name, scope);
  if (r.changes > 0) count++;
  return r.changes;
}

// Get existing subregions
const subs = db.prepare("SELECT e.name, p.name as parent FROM taxonomy_entities e LEFT JOIN taxonomy_entities p ON p.id = e.parent_id WHERE e.entity_type = 'subregion' ORDER BY e.name").all() as any[];
console.log(`\nSubregions in DB: ${subs.length}`);
for (const s of subs.slice(0, 10)) console.log(`  ${s.name} (parent: ${s.parent})`);

// Fill subregion descriptions
const subDescs: [string, string, string, string, any?][] = [
  ['Médoc', 'wine', 'Bordeaux\'s Left Bank powerhouse — gravelly soils producing structured, long-lived Cabernet Sauvignon.', 'The Médoc peninsula stretches north of Bordeaux along the Gironde estuary. Its deep gravel beds over clay produce Bordeaux\'s most structured and age-worthy Cabernet-dominant reds. Home to four of the five 1855 First Growths (Lafite, Latour, Margaux, Mouton).', {key_grapes: ['Cabernet Sauvignon', 'Merlot']}],
  ['Pauillac', 'wine', 'Home to three First Growths — the pinnacle of Bordeaux Cabernet Sauvignon.', 'Pauillac contains Lafite Rothschild, Latour, and Mouton Rothschild. Deep gravel soils over limestone produce powerful, concentrated Cabernet-dominant wines with extraordinary aging potential.', {key_grapes: ['Cabernet Sauvignon']}],
  ['Margaux', 'wine', 'The most elegant and perfumed of Bordeaux\'s Médoc appellations.', 'Margaux is renowned for producing the most perfumed and silky wines of the Médoc. Château Margaux leads, with Rauzan-Ségla, Palmer, and Brane-Cantenac as notable estates.', {key_grapes: ['Cabernet Sauvignon', 'Merlot']}],
  ['Saint-Émilion', 'wine', 'Bordeaux\'s Right Bank — Merlot-dominant wines from limestone and clay.', 'Saint-Émilion\'s limestone plateau and clay slopes produce rounder, more approachable Merlot-dominant wines. Cheval Blanc and Ausone lead the classification.', {key_grapes: ['Merlot', 'Cabernet Franc']}],
  ['Pomerol', 'wine', 'Tiny, prestigious Right Bank appellation — home to Pétrus.', 'Pomerol has no classification system but commands Bordeaux\'s highest prices. Clay soils with iron-rich crasse de fer produce opulent Merlot of extraordinary concentration.', {key_grapes: ['Merlot']}],
  ['Côte de Nuits', 'wine', 'Northern Côte d\'Or — Burgundy\'s greatest red wine villages.', 'The Côte de Nuits runs from Marsannay to Nuits-Saint-Georges, containing legendary Grand Crus: Chambertin, Musigny, Romanée-Conti, Clos de Vougeot. Pinot Noir at its most profound.', {key_grapes: ['Pinot Noir']}],
  ['Côte de Beaune', 'wine', 'Southern Côte d\'Or — Burgundy\'s finest white wine villages.', 'The Côte de Beaune produces Burgundy\'s greatest Chardonnay from Meursault, Puligny-Montrachet, and Chassagne-Montrachet, plus excellent Pinot Noir from Volnay and Pommard.', {key_grapes: ['Chardonnay', 'Pinot Noir']}],
  ['Barossa Valley', 'wine', 'Australia\'s Shiraz heartland — old vines, warm climate, extraordinary depth.', 'The Barossa Valley floor produces Australia\'s most iconic Shiraz from some of the world\'s oldest vines (1840s plantings). Penfolds Grange draws primarily on Barossa fruit.', {key_grapes: ['Shiraz', 'Grenache']}],
  ['Eden Valley', 'wine', 'Elevated Barossa sub-region producing Australia\'s finest Riesling.', 'At higher elevation than the Barossa Valley floor, Eden Valley\'s cooler temperatures produce Australia\'s benchmark Riesling alongside more elegant, structured Shiraz.', {key_grapes: ['Riesling', 'Shiraz']}],
  ['Uco Valley', 'wine', 'Argentina\'s highest-altitude wine frontier — refined, mineral Malbec.', 'The Uco Valley (Tupungato, Tunuyán, San Carlos) at 1,000-1,500m produces Argentina\'s most structured, mineral-driven Malbec. Altitude creates extreme diurnal temperature swings.', {key_grapes: ['Malbec', 'Cabernet Franc']}],
  ['Russian River Valley', 'wine', 'Sonoma\'s premier cool-climate Pinot Noir and Chardonnay appellation.', 'Morning fog from the Pacific creates ideal conditions for Pinot Noir and Chardonnay. Williams Selyem, Rochioli, and Kistler set benchmarks for New World Burgundian varieties.', {key_grapes: ['Pinot Noir', 'Chardonnay']}],
  ['Wairau Valley', 'wine', 'The original Marlborough Sauvignon Blanc heartland.', 'The Wairau Valley\'s stony, free-draining soils and long sunshine hours produce the quintessential New Zealand Sauvignon Blanc — explosively aromatic with trademark passionfruit and cut-grass.', {key_grapes: ['Sauvignon Blanc']}],
  ['Luján de Cuyo', 'wine', 'Mendoza\'s historic Malbec district at the foot of the Andes.', 'Luján de Cuyo was the first designated appellation in Argentina. Its alluvial soils and moderate altitude (800-1,100m) produce generous, round Malbec with ripe fruit and soft tannins.', {key_grapes: ['Malbec', 'Cabernet Sauvignon']}],
  ['Bolgheri', 'wine', 'Tuscany\'s Cabernet coast — home to Sassicaia and the Super Tuscan revolution.', 'Bolgheri on Tuscany\'s coast launched the Super Tuscan movement. Sassicaia (1968) proved Cabernet Sauvignon could produce world-class wine outside Bordeaux. Maritime climate.', {key_grapes: ['Cabernet Sauvignon', 'Merlot']}],
  ['Chianti Classico', 'wine', 'The historic heart of Chianti — Sangiovese from the hills between Florence and Siena.', 'Chianti Classico (with the Gallo Nero black rooster symbol) produces Sangiovese-dominant reds from the original, highest-quality zone. Gran Selezione is the top tier.', {key_grapes: ['Sangiovese']}],
  ['Côtes du Rhône', 'wine', 'Southern France\'s everyday-to-excellent Grenache-based red appellation.', 'The Côtes du Rhône appellation covers a vast area of southern France, producing Grenache-based reds of remarkable quality and value. The best rival named crus at fraction of the price.', {key_grapes: ['Grenache', 'Syrah', 'Mourvèdre']}],
  ['Côte-Rôtie', 'wine', 'Northern Rhône\'s most elegant Syrah — steep terraces above the Rhône River.', 'Côte-Rôtie\'s vertiginous slopes produce perfumed, elegant Syrah, sometimes co-fermented with a small percentage of Viognier. Guigal\'s La Landonne, La Mouline, and La Turque are legendary.', {key_grapes: ['Syrah', 'Viognier']}],
  ['Hermitage', 'wine', 'The Rhône\'s most monumental Syrah — powerful, long-lived single-vineyard reds.', 'Hermitage\'s granite hill produces Syrah of extraordinary power and longevity. Jaboulet\'s La Chapelle and Chave are among France\'s greatest wines. Also produces rich white from Marsanne/Roussanne.', {key_grapes: ['Syrah', 'Marsanne']}],
];

for (const [name, scope, short, full, attrs] of subDescs) {
  u('subregion', name, scope, short, full, attrs);
}

// ── PART 4: Appellation descriptions ────────────────────────────────────────
const apps = db.prepare("SELECT e.name FROM taxonomy_entities e WHERE e.entity_type = 'appellation' ORDER BY e.name").all() as any[];
console.log(`\nAppellations in DB: ${apps.length}`);

const appDescs: [string, string, string, string, any?][] = [
  ['Napa Valley', 'wine', 'America\'s most prestigious wine appellation — Cabernet Sauvignon of global acclaim.', 'Napa Valley AVA encompasses 16 sub-AVAs with diverse microclimates. From Oakville to Rutherford to Howell Mountain, each produces distinct Cabernet styles. The Judgement of Paris 1976 put Napa on the world stage.', {key_grapes: ['Cabernet Sauvignon']}],
  ['Barolo', 'wine', 'Piedmont\'s crown jewel — powerful, age-worthy Nebbiolo requiring patience.', 'Barolo DOCG demands 100% Nebbiolo aged minimum 38 months (18 in wood). Communes like La Morra, Barolo, Castiglione Falletto, Serralunga, and Monforte each express Nebbiolo differently.', {key_grapes: ['Nebbiolo']}],
  ['Barbaresco', 'wine', 'Nebbiolo\'s more approachable sibling — elegant, earlier-drinking Piedmontese reds.', 'Barbaresco DOCG requires 26 months aging minimum. Generally more accessible than Barolo, with perfumed elegance from slightly warmer, lower-altitude vineyards.', {key_grapes: ['Nebbiolo']}],
  ['Brunello di Montalcino', 'wine', '100% Sangiovese aged five years — Tuscany\'s most powerful expression.', 'Brunello di Montalcino DOCG requires 100% Sangiovese Grosso, minimum 5 years aging (2 in oak) before release. Montalcino\'s warm, south-facing slopes produce concentrated, tannic wines.', {key_grapes: ['Sangiovese']}],
  ['Châteauneuf-du-Pape', 'wine', 'The Southern Rhône\'s greatest appellation — up to 13 grape varieties permitted.', 'Châteauneuf-du-Pape\'s galets roulés (round stones) retain heat and reflect it back to vines. Grenache dominates in rich, spicy, herb-scented reds of extraordinary warmth.', {key_grapes: ['Grenache', 'Syrah', 'Mourvèdre']}],
  ['Sancerre', 'wine', 'Loire Valley benchmark for Sauvignon Blanc — flinty, mineral, precise.', 'Sancerre\'s Kimmeridgian limestone and silex (flint) soils produce Sauvignon Blanc of crystalline purity. Also produces underrated Pinot Noir rosé and light reds.', {key_grapes: ['Sauvignon Blanc']}],
  ['Chablis', 'wine', 'Burgundy\'s northernmost appellation — unoaked Chardonnay of mineral purity.', 'Chablis\' Kimmeridgian limestone soils (ancient oyster shell fossils) produce Chardonnay of steely minerality, green apple, and chalk. Premier and Grand Cru add richness with age.', {key_grapes: ['Chardonnay']}],
  ['Pouilly-Fumé', 'wine', 'Loire Sauvignon Blanc from flinty soils — smoky, mineral, age-worthy.', 'Pouilly-Fumé\'s silex (flint) soils give its Sauvignon Blanc a distinctive smoky, gunflint character. More structured and age-worthy than neighbouring Sancerre.', {key_grapes: ['Sauvignon Blanc']}],
  ['Pauillac', 'wine', 'Three First Growths — the pinnacle of Bordeaux Cabernet Sauvignon.', 'Pauillac\'s deep gravel beds produce the most powerful, structured wines of the Médoc. Lafite, Latour, and Mouton Rothschild represent the summit of Bordeaux.', {key_grapes: ['Cabernet Sauvignon']}],
  ['Saint-Julien', 'wine', 'Bordeaux\'s most consistent Médoc commune — no First Growths but eleven classified estates.', 'Saint-Julien is considered the most reliable commune in the Médoc. Léoville-Las Cases, Léoville-Barton, Ducru-Beaucaillou, and Gruaud-Larose deliver consistent excellence.', {key_grapes: ['Cabernet Sauvignon', 'Merlot']}],
  ['Pessac-Léognan', 'wine', 'Graves\' finest — Haut-Brion leads both red and white Bordeaux.', 'Pessac-Léognan was carved from Graves in 1987. Haut-Brion (First Growth) and La Mission Haut-Brion lead. Produces Bordeaux\'s finest dry whites from Sauvignon Blanc/Semillon.', {key_grapes: ['Cabernet Sauvignon', 'Merlot', 'Sauvignon Blanc']}],
  ['Amarone della Valpolicella', 'wine', 'Veneto\'s iconic dried-grape red — rich, concentrated, high-alcohol.', 'Amarone is made by the appassimento method: partially drying Corvina, Corvinone, and Rondinella grapes for 3-4 months before fermentation, concentrating sugars and flavours.', {key_grapes: ['Corvina', 'Corvinone', 'Rondinella']}],
  ['Vino Nobile di Montepulciano', 'wine', 'Tuscany\'s elegant middle ground between Chianti and Brunello.', 'Made primarily from Sangiovese (locally called Prugnolo Gentile), Vino Nobile offers a middle path between Chianti\'s accessibility and Brunello\'s power and price.', {key_grapes: ['Sangiovese']}],
];

for (const [name, scope, short, full, attrs] of appDescs) {
  u('appellation', name, scope, short, full, attrs);
}

// ── PART 5: Remaining draft countries/regions ───────────────────────────────
// Fill any remaining draft country wine contexts
const draftCountries = db.prepare("SELECT e.name FROM taxonomy_entities e JOIN taxonomy_contexts c ON c.entity_id = e.id WHERE e.entity_type = 'country' AND c.status = 'draft' AND c.scope_id = 'wine'").all() as any[];
console.log(`\nDraft wine countries: ${draftCountries.length}`);
for (const c of draftCountries) console.log(`  ${c.name}`);

// Fill remaining with brief descriptions
const briefCountries: [string, string, string][] = [
  ['Hungary', 'Historic wine nation — Tokaj\'s sweet Furmint and Bull\'s Blood from Eger.', 'Hungary\'s Tokaj region produces one of the world\'s great sweet wines from Furmint grapes affected by noble rot. Eger is known for Bikavér (Bull\'s Blood) reds.'],
  ['Greece', 'Ancient wine culture reborn — Assyrtiko from Santorini leads the modern renaissance.', 'Greece has 300+ indigenous grape varieties. Santorini\'s volcanic Assyrtiko, Naoussa\'s Xinomavro, and Nemea\'s Agiorgitiko lead the quality revolution.'],
  ['Lebanon', 'Bekaa Valley — 5,000 years of winemaking tradition, Château Musar leading globally.', 'Lebanon\'s Bekaa Valley has produced wine for millennia. Château Musar put Lebanese wine on the global map with its distinctive Cabernet-Cinsault-Carignan blends.'],
  ['Georgia', 'The cradle of wine — 8,000 years of qvevri (clay vessel) winemaking tradition.', 'Georgia is the oldest wine-producing region on earth. Traditional qvevri (buried clay vessel) fermentation produces distinctive amber wines from Rkatsiteli and Saperavi grapes.'],
  ['China', 'The world\'s fastest-growing wine market and producer — Ningxia leads quality.', 'China\'s Ningxia region in the Yellow River corridor has emerged as a serious Cabernet Sauvignon producer. Ao Yun in Yunnan and Changyu are notable.'],
  ['Peru', 'South America\'s oldest wine tradition — Ica Valley and emerging Pisco production.', 'Peru\'s Ica Valley has produced wine since the 16th century. Tacama is the leading producer. The region is better known for Pisco, the grape-based spirit.'],
  ['Uruguay', 'Tannat\'s adopted home — full-bodied reds from South America\'s fourth-largest producer.', 'Uruguay has made Tannat its own — this Basque grape produces rich, deeply coloured reds suited to the country\'s cattle-rich cuisine. Bodega Garzón leads the modern era.'],
  ['Slovenia', 'A hidden gem — orange wines, indigenous varieties, and Alpine-Mediterranean diversity.', 'Slovenia straddles Alpine and Mediterranean climates. The Brda/Collio region produces exceptional orange wines from Ribolla Gialla. Goriska Brda and Vipava Valley lead quality.'],
  ['England', 'Cool-climate sparkling wine rising — chalk soils rivalling Champagne.', 'England\'s sparkling wine has won international acclaim. Southern England\'s chalk soils mirror Champagne\'s terroir. Nyetimber, Ridgeview, and Gusbourne lead the movement.'],
];

for (const [name, short, full] of briefCountries) {
  u('country', name, 'wine', short, full);
}

// Summary
const stats = db.prepare("SELECT status, count(*) as n FROM taxonomy_contexts GROUP BY status").all() as any[];
console.log(`\n=== FINAL STATS ===`);
console.log(`Total descriptions updated: ${count}`);
console.log(`Coordinates: ${coordCount} countries, ${regionCoordCount} regions`);
for (const s of stats) console.log(`  ${s.status}: ${s.n}`);
console.log('Done!');
