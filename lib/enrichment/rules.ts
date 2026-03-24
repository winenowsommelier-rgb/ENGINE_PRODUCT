export type EnrichmentResult = {
  country?: string;
  region?: string;
  subregion?: string;
  classification?: string;
  grape_variety?: string;
  confidence: number;
  source: 'rules' | 'claude' | 'manual';
  note: string;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── BRAND MAP ─────────────────────────────────────────────────────────────
// Ordered from most specific to least; first match wins.
const BRAND_MAP: Array<{ patterns: string[]; country: string; region?: string; confidence: number }> = [

  // === CHAMPAGNE & FRENCH SPARKLING ===
  { patterns: ['veuveclicquot', 'veuvecliquot'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['moetchandon', 'moet'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['laurentperrier', 'laurentperrier'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['charlesheidsiec', 'charlesheidsieck'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['piperheidsieck', 'piperheidsieck'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['bollingerchampagne', 'bollinger'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['domperigon', 'domperignon'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['krug'], country: 'France', region: 'Champagne', confidence: 0.90 },
  { patterns: ['taittinger'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['baronsdero', 'baronsderothschild'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['roederer', 'louisroederer'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['delaschampagne', 'delaschampagne', 'delas'], country: 'France', region: 'Rhône', confidence: 0.85 },
  { patterns: ['barton', 'bartonguestier', 'bartonandguestier'], country: 'France', confidence: 0.85 },
  { patterns: ['josephdrouhin', 'drouhin'], country: 'France', region: 'Burgundy', confidence: 0.90 },
  { patterns: ['georgesduboeuf', 'duboeuf'], country: 'France', region: 'Beaujolais', confidence: 0.90 },
  { patterns: ['louislatour', 'louislatour'], country: 'France', region: 'Burgundy', confidence: 0.90 },
  { patterns: ['mfrichter', 'maxferd', 'maxferdrichter'], country: 'Germany', region: 'Mosel', confidence: 0.90 },
  { patterns: ['eeguigal', 'guigal'], country: 'France', region: 'Rhône', confidence: 0.90 },
  { patterns: ['domaindelamordore', 'mordoree', 'mordore'], country: 'France', region: 'Rhône', confidence: 0.90 },
  { patterns: ['lacourdes', 'lacourdesdames'], country: 'France', confidence: 0.85 },
  { patterns: ['chateau', 'chateaumargaux'], country: 'France', region: 'Bordeaux', confidence: 0.85 },

  // === FRENCH COGNAC / SPIRITS ===
  { patterns: ['hennessy'], country: 'France', confidence: 0.95 },
  { patterns: ['remymartin', 'remymartin'], country: 'France', confidence: 0.95 },
  { patterns: ['courvoisier'], country: 'France', confidence: 0.95 },
  { patterns: ['martell'], country: 'France', confidence: 0.95 },
  { patterns: ['greygoo', 'greygoose'], country: 'France', confidence: 0.95 },
  { patterns: ['cointreau'], country: 'France', confidence: 0.95 },
  { patterns: ['grandmarnier'], country: 'France', confidence: 0.95 },
  { patterns: ['chambord'], country: 'France', confidence: 0.95 },

  // === ITALY — WINES ===
  { patterns: ['antinori', 'tormaresca'], country: 'Italy', confidence: 0.95 },
  { patterns: ['piocessare', 'piocesare'], country: 'Italy', region: 'Piedmont', confidence: 0.95 },
  { patterns: ['allegrini', 'cortegiara'], country: 'Italy', region: 'Veneto', confidence: 0.95 },
  { patterns: ['zenato'], country: 'Italy', region: 'Veneto', confidence: 0.90 },
  { patterns: ['masi'], country: 'Italy', region: 'Veneto', confidence: 0.90 },
  { patterns: ['fontanafredda'], country: 'Italy', region: 'Piedmont', confidence: 0.90 },
  { patterns: ['laspinetta', 'spinetta'], country: 'Italy', region: 'Piedmont', confidence: 0.90 },
  { patterns: ['michelechiar', 'michelechiarlobarolo'], country: 'Italy', region: 'Piedmont', confidence: 0.90 },
  { patterns: ['batasiolo'], country: 'Italy', region: 'Piedmont', confidence: 0.90 },
  { patterns: ['velenosi'], country: 'Italy', region: 'Marche', confidence: 0.90 },
  { patterns: ['livonfriuli', 'livon'], country: 'Italy', region: 'Friuli', confidence: 0.90 },
  { patterns: ['jermann'], country: 'Italy', region: 'Friuli', confidence: 0.90 },
  { patterns: ['liviofelluga', 'livofelluga'], country: 'Italy', region: 'Friuli', confidence: 0.90 },
  { patterns: ['eugenicocollavini', 'collavini'], country: 'Italy', region: 'Friuli', confidence: 0.90 },
  { patterns: ['elenawalch'], country: 'Italy', region: 'Alto Adige', confidence: 0.90 },
  { patterns: ['cantinaterlano', 'terlano'], country: 'Italy', region: 'Alto Adige', confidence: 0.90 },
  { patterns: ['alaoislageder', 'aloislageder'], country: 'Italy', region: 'Alto Adige', confidence: 0.90 },
  { patterns: ['pietradolce'], country: 'Italy', region: 'Sicily', confidence: 0.90 },
  { patterns: ['cristodicampobello', 'cristocampobello'], country: 'Italy', region: 'Sicily', confidence: 0.90 },
  { patterns: ['tentuadelleterrenere', 'terrenere', 'tenutadelleterre'], country: 'Italy', region: 'Sicily', confidence: 0.90 },
  { patterns: ['tornatore'], country: 'Italy', region: 'Sicily', confidence: 0.90 },
  { patterns: ['talamonti'], country: 'Italy', region: 'Abruzzo', confidence: 0.90 },
  { patterns: ['dimajono', 'dimajono', 'dimajoorante', 'dimajo'], country: 'Italy', region: 'Molise', confidence: 0.88 },
  { patterns: ['lungarotti'], country: 'Italy', region: 'Umbria', confidence: 0.90 },
  { patterns: ['fattoriapupil', 'fattorialepupil', 'lepupille'], country: 'Italy', region: 'Tuscany', confidence: 0.90 },
  { patterns: ['monteverro'], country: 'Italy', region: 'Tuscany', confidence: 0.90 },
  { patterns: ['labraccesca', 'braccesca'], country: 'Italy', region: 'Tuscany', confidence: 0.90 },
  { patterns: ['olek'], country: 'Italy', region: 'Piedmont', confidence: 0.85 },
  { patterns: ['riporta'], country: 'Italy', confidence: 0.85 },
  { patterns: ['vignetidelsalento', 'salento'], country: 'Italy', region: 'Puglia', confidence: 0.85 },
  { patterns: ['notte'], country: 'Italy', confidence: 0.80 },
  { patterns: ['zonin'], country: 'Italy', confidence: 0.88 },
  { patterns: ['bottega'], country: 'Italy', confidence: 0.88 },
  { patterns: ['strega'], country: 'Italy', confidence: 0.90 },
  { patterns: ['nonino'], country: 'Italy', region: 'Friuli', confidence: 0.90 },
  { patterns: ['luxardo'], country: 'Italy', confidence: 0.90 },
  { patterns: ['contizecca', 'zecca'], country: 'Italy', confidence: 0.88 },
  { patterns: ['masseto'], country: 'Italy', region: 'Tuscany', confidence: 0.95 },
  { patterns: ['feudomaccari', 'maccari'], country: 'Italy', region: 'Sicily', confidence: 0.90 },

  // === SPAIN ===
  { patterns: ['torres'], country: 'Spain', confidence: 0.90 },
  { patterns: ['valdubon'], country: 'Spain', region: 'Ribera del Duero', confidence: 0.90 },
  { patterns: ['osborne'], country: 'Spain', confidence: 0.88 },

  // === AUSTRALIA ===
  { patterns: ['penfolds'], country: 'Australia', confidence: 0.95 },
  { patterns: ['wolfs', 'wolfblass'], country: 'Australia', confidence: 0.95 },
  { patterns: ['jacobscreek', 'jacobcreek'], country: 'Australia', confidence: 0.95 },
  { patterns: ['yellowtail'], country: 'Australia', confidence: 0.95 },
  { patterns: ['twohand', 'twohands'], country: 'Australia', region: 'Barossa Valley', confidence: 0.95 },
  { patterns: ['lindeman', 'lindemans'], country: 'Australia', confidence: 0.90 },
  { patterns: ['debortoli'], country: 'Australia', confidence: 0.90 },
  { patterns: ['rawsonsretreat', 'rawson'], country: 'Australia', confidence: 0.90 },
  { patterns: ['19crimes'], country: 'Australia', confidence: 0.90 },
  { patterns: ['wynns'], country: 'Australia', region: 'Coonawarra', confidence: 0.90 },
  { patterns: ['mcguigan'], country: 'Australia', confidence: 0.90 },
  { patterns: ['tyrrells', 'tyrrell'], country: 'Australia', region: 'Hunter Valley', confidence: 0.90 },
  { patterns: ['mollydooker'], country: 'Australia', region: 'McLaren Vale', confidence: 0.90 },
  { patterns: ['corryton', 'corrytonburge'], country: 'Australia', region: 'Barossa', confidence: 0.90 },
  { patterns: ['angove'], country: 'Australia', confidence: 0.90 },

  // === NEW ZEALAND ===
  { patterns: ['craggyrange', 'craggy'], country: 'New Zealand', region: "Hawke's Bay", confidence: 0.92 },
  { patterns: ['feltonroad', 'felton'], country: 'New Zealand', region: 'Central Otago', confidence: 0.92 },
  { patterns: ['mountriley', 'mount riley'], country: 'New Zealand', region: 'Marlborough', confidence: 0.92 },
  { patterns: ['pounamu'], country: 'New Zealand', confidence: 0.88 },

  // === CHILE ===
  { patterns: ['conchaytoro', 'conchytoro'], country: 'Chile', confidence: 0.95 },
  { patterns: ['viumanent'], country: 'Chile', region: 'Colchagua Valley', confidence: 0.92 },
  { patterns: ['aromo'], country: 'Chile', confidence: 0.90 },
  { patterns: ['montegras', 'montgras'], country: 'Chile', confidence: 0.90 },
  { patterns: ['cartavieja'], country: 'Chile', confidence: 0.90 },
  { patterns: ['altivo'], country: 'Chile', confidence: 0.88 },
  { patterns: ['echeverria'], country: 'Chile', confidence: 0.88 },
  { patterns: ['bodegavol', 'bodegavolcanes', 'volcanes'], country: 'Chile', confidence: 0.88 },
  { patterns: ['mascota', 'mascotavineyards'], country: 'Chile', confidence: 0.85 },
  { patterns: ['sutil'], country: 'Chile', confidence: 0.85 },
  { patterns: ['g7'], country: 'Chile', confidence: 0.85 },

  // === ARGENTINA ===
  { patterns: ['catenazapata', 'catena'], country: 'Argentina', region: 'Mendoza', confidence: 0.95 },
  { patterns: ['antigal'], country: 'Argentina', region: 'Mendoza', confidence: 0.90 },
  { patterns: ['fincalacelia', 'lacelia'], country: 'Argentina', confidence: 0.88 },
  { patterns: ['intipalka'], country: 'Peru', confidence: 0.85 },

  // === USA ===
  { patterns: ['jackdaniel', 'jackdaniels'], country: 'USA', confidence: 0.95 },
  { patterns: ['jimbeam'], country: 'USA', confidence: 0.95 },
  { patterns: ['makersmark'], country: 'USA', confidence: 0.95 },
  { patterns: ['buffalotrace'], country: 'USA', confidence: 0.95 },
  { patterns: ['wildturkey'], country: 'USA', confidence: 0.95 },
  { patterns: ['woodfordreserve'], country: 'USA', confidence: 0.95 },
  { patterns: ['coastalridge'], country: 'USA', confidence: 0.85 },
  { patterns: ['grandnapavineyards', 'grandnapa'], country: 'USA', region: 'Napa Valley', confidence: 0.90 },
  { patterns: ['petrmichael', 'petermichael'], country: 'USA', region: 'Sonoma', confidence: 0.90 },
  { patterns: ['merryvale'], country: 'USA', region: 'Napa Valley', confidence: 0.90 },
  { patterns: ['beringer'], country: 'USA', confidence: 0.90 },
  { patterns: ['stgeorge'], country: 'USA', confidence: 0.85 },
  { patterns: ['hiramwalker'], country: 'Canada', confidence: 0.88 },

  // === SCOTLAND — WHISKY ===
  { patterns: ['johnniewalker'], country: 'Scotland', confidence: 0.95 },
  { patterns: ['glenfiddich'], country: 'Scotland', region: 'Speyside', confidence: 0.95 },
  { patterns: ['macallan'], country: 'Scotland', region: 'Speyside', confidence: 0.95 },
  { patterns: ['chivas', 'chivasregal'], country: 'Scotland', confidence: 0.95 },
  { patterns: ['laphroaig'], country: 'Scotland', region: 'Islay', confidence: 0.95 },
  { patterns: ['glenlivet'], country: 'Scotland', region: 'Speyside', confidence: 0.95 },
  { patterns: ['balvenie'], country: 'Scotland', region: 'Speyside', confidence: 0.95 },
  { patterns: ['oban'], country: 'Scotland', confidence: 0.95 },
  { patterns: ['talisker'], country: 'Scotland', region: 'Isle of Skye', confidence: 0.95 },
  { patterns: ['dalwhinnie'], country: 'Scotland', region: 'Highlands', confidence: 0.95 },
  { patterns: ['lagavulin'], country: 'Scotland', region: 'Islay', confidence: 0.95 },
  { patterns: ['glenmorangie'], country: 'Scotland', region: 'Highlands', confidence: 0.95 },
  { patterns: ['royalsalute'], country: 'Scotland', confidence: 0.95 },
  { patterns: ['singleton'], country: 'Scotland', region: 'Speyside', confidence: 0.92 },
  { patterns: ['tomintoul'], country: 'Scotland', region: 'Speyside', confidence: 0.92 },
  { patterns: ['wolfburn'], country: 'Scotland', region: 'Highlands', confidence: 0.90 },
  { patterns: ['douglaslaing', 'douglaslaings'], country: 'Scotland', confidence: 0.90 },

  // === IRELAND ===
  { patterns: ['jameson'], country: 'Ireland', confidence: 0.95 },
  { patterns: ['bushmills'], country: 'Ireland', confidence: 0.95 },
  { patterns: ['tullamore'], country: 'Ireland', confidence: 0.95 },

  // === ENGLAND ===
  { patterns: ['tanqueray'], country: 'England', confidence: 0.95 },
  { patterns: ['gordons'], country: 'England', confidence: 0.90 },
  { patterns: ['beefeater'], country: 'England', confidence: 0.95 },
  { patterns: ['bombaysapphire', 'bombay'], country: 'England', confidence: 0.95 },
  { patterns: ['hendricks', 'hendrick'], country: 'England', confidence: 0.92 },
  { patterns: ['whitleyneill'], country: 'England', confidence: 0.92 },
  { patterns: ['rockrose'], country: 'Scotland', confidence: 0.90 },
  { patterns: ['deadmansfinger', 'deadmans'], country: 'England', confidence: 0.88 },
  { patterns: ['buss509', 'buss'], country: 'England', confidence: 0.85 },

  // === SWEDEN / RUSSIA / VODKA ===
  { patterns: ['absolut'], country: 'Sweden', confidence: 0.95 },
  { patterns: ['smirnoff'], country: 'Russia', confidence: 0.80 },
  { patterns: ['stolichnaya', 'stoli'], country: 'Russia', confidence: 0.90 },

  // === CUBA / RUM ===
  { patterns: ['bacardi'], country: 'Cuba', confidence: 0.95 },
  { patterns: ['havanaclub'], country: 'Cuba', confidence: 0.95 },
  { patterns: ['plantation'], country: 'Barbados', confidence: 0.88 },
  { patterns: ['angostura'], country: 'Trinidad', confidence: 0.90 },
  { patterns: ['chalong', 'chalongbay'], country: 'Thailand', confidence: 0.88 },

  // === MEXICO ===
  { patterns: ['patron'], country: 'Mexico', confidence: 0.95 },
  { patterns: ['donjulio'], country: 'Mexico', confidence: 0.95 },
  { patterns: ['josecuervo', 'cuervo'], country: 'Mexico', confidence: 0.95 },
  { patterns: ['espolon'], country: 'Mexico', confidence: 0.95 },
  { patterns: ['cenote'], country: 'Mexico', confidence: 0.90 },
  { patterns: ['maestri', 'casamaestri'], country: 'Mexico', confidence: 0.88 },

  // === JAPAN — WHISKY & SAKE ===
  { patterns: ['yamazaki'], country: 'Japan', confidence: 0.95 },
  { patterns: ['hakushu'], country: 'Japan', confidence: 0.95 },
  { patterns: ['nikka'], country: 'Japan', confidence: 0.95 },
  { patterns: ['hibiki'], country: 'Japan', confidence: 0.95 },
  { patterns: ['kavalan'], country: 'Taiwan', confidence: 0.95 },
  { patterns: ['thejapanese'], country: 'Japan', confidence: 0.88 },
  { patterns: ['hakutsuru'], country: 'Japan', confidence: 0.92 },
  { patterns: ['kamotsuru'], country: 'Japan', confidence: 0.92 },
  { patterns: ['fukuju'], country: 'Japan', confidence: 0.90 },
  { patterns: ['komasa'], country: 'Japan', confidence: 0.90 },
  { patterns: ['nanbubijin'], country: 'Japan', confidence: 0.90 },
  { patterns: ['tengumai'], country: 'Japan', confidence: 0.90 },
  { patterns: ['niwa', 'niwanouguisu'], country: 'Japan', confidence: 0.88 },
  { patterns: ['asamai'], country: 'Japan', confidence: 0.88 },
  { patterns: ['iichiko'], country: 'Japan', confidence: 0.90 },
  { patterns: ['hakutake'], country: 'Japan', confidence: 0.90 },

  // === THAILAND ===
  { patterns: ['granmonte'], country: 'Thailand', confidence: 0.90 },
  { patterns: ['monsoonvalley'], country: 'Thailand', confidence: 0.90 },
  { patterns: ['sodchaeng', 'sod chaeng'], country: 'Thailand', confidence: 0.90 },

  // === URUGUAY / OTHER SOUTH AMERICA ===
  { patterns: ['loscerros', 'sanjuan', 'cerrosdesanjuan'], country: 'Uruguay', confidence: 0.88 },
  { patterns: ['pisano'], country: 'Uruguay', confidence: 0.85 },

  // === MIXERS / SYRUPS — NO COUNTRY NEEDED ===
  { patterns: ['monin'], country: 'France', confidence: 0.85 },
  { patterns: ['dekuyper', 'de kuyper'], country: 'Netherlands', confidence: 0.88 },

  // === GERMAN BEER ===
  { patterns: ['paulaner'], country: 'Germany', region: 'Bavaria', confidence: 0.95 },

  // === FREIXENET / SPANISH SPARKLING ===
  { patterns: ['freixenet'], country: 'Spain', region: 'Cava', confidence: 0.95 },

  // === BURGUNDY / RHONE — SPECIFIC PRODUCERS ===
  { patterns: ['rochesterw', 'rochesters'], country: 'England', confidence: 0.80 },
  { patterns: ['monemvasia'], country: 'Greece', confidence: 0.90 },

  // === FRANCE — ADDITIONAL ===
  { patterns: ['baronphilippederothschild', 'baronphilippe', 'baronphilipped'], country: 'France', region: 'Bordeaux', confidence: 0.92 },
  { patterns: ['rothschild'], country: 'France', region: 'Bordeaux', confidence: 0.88 },
  { patterns: ['clarendelle'], country: 'France', region: 'Bordeaux', confidence: 0.90 },
  { patterns: ['jeffcarrel'], country: 'France', region: 'Languedoc', confidence: 0.88 },
  { patterns: ['leclosduserres', 'closduserres'], country: 'France', region: 'Languedoc', confidence: 0.88 },
  { patterns: ['pierrevallet'], country: 'France', confidence: 0.85 },

  // === ITALY — ADDITIONAL ===
  { patterns: ['tenutaornellaia', 'ornellaia'], country: 'Italy', region: 'Tuscany', confidence: 0.95 },
  { patterns: ['tuarita', 'tua rita'], country: 'Italy', region: 'Tuscany', confidence: 0.93 },
  { patterns: ['roccadifrasinello', 'roccadifrassinello'], country: 'Italy', region: 'Tuscany', confidence: 0.92 },
  { patterns: ['tascadalmerita', 'tasca'], country: 'Italy', region: 'Sicily', confidence: 0.92 },
  { patterns: ['vignetidizabu', 'zabu'], country: 'Italy', region: 'Sicily', confidence: 0.90 },
  { patterns: ['masserialiveli', 'liveli'], country: 'Italy', region: 'Puglia', confidence: 0.90 },
  { patterns: ['primosic'], country: 'Italy', region: 'Friuli', confidence: 0.90 },
  { patterns: ['destefani'], country: 'Italy', region: 'Veneto', confidence: 0.88 },
  { patterns: ['malfy'], country: 'Italy', confidence: 0.92 },
  { patterns: ['mancino'], country: 'Italy', confidence: 0.90 },
  { patterns: ['delp', 'delprofessore'], country: 'Italy', confidence: 0.88 },

  // === SPAIN — ADDITIONAL ===
  { patterns: ['marquesdecaceres', 'marquesdecaceres'], country: 'Spain', region: 'Rioja', confidence: 0.92 },

  // === AUSTRALIA — ADDITIONAL ===
  { patterns: ['torbreck'], country: 'Australia', region: 'Barossa Valley', confidence: 0.93 },
  { patterns: ['voyagerestate', 'voyager'], country: 'Australia', region: 'Margaret River', confidence: 0.92 },
  { patterns: ['langmeil'], country: 'Australia', region: 'Barossa Valley', confidence: 0.92 },
  { patterns: ['fermoy', 'fermoyestate'], country: 'Australia', region: 'Margaret River', confidence: 0.90 },
  { patterns: ['sunnycliff'], country: 'Australia', confidence: 0.88 },
  { patterns: ['georgewyndham', 'wyndham'], country: 'Australia', confidence: 0.88 },
  { patterns: ['twooceans'], country: 'South Africa', confidence: 0.88 },

  // === NEW ZEALAND — ADDITIONAL ===
  { patterns: ['greywacke'], country: 'New Zealand', region: 'Marlborough', confidence: 0.92 },
  { patterns: ['dogpoint', 'dog point'], country: 'New Zealand', region: 'Marlborough', confidence: 0.92 },
  { patterns: ['framingham'], country: 'New Zealand', region: 'Marlborough', confidence: 0.92 },
  { patterns: ['spyvalley', 'spy valley'], country: 'New Zealand', region: 'Marlborough', confidence: 0.92 },
  { patterns: ['brancottestate', 'brancott'], country: 'New Zealand', confidence: 0.90 },

  // === USA — ADDITIONAL ===
  { patterns: ['kendalljackson', 'kendall'], country: 'USA', region: 'California', confidence: 0.90 },
  { patterns: ['wentevineyards', 'wente'], country: 'USA', region: 'California', confidence: 0.90 },
  { patterns: ['opusone', 'opus one'], country: 'USA', region: 'Napa Valley', confidence: 0.95 },
  { patterns: ['phelpcreek', 'phelps'], country: 'USA', region: 'Oregon', confidence: 0.88 },
  { patterns: ['layercake'], country: 'USA', confidence: 0.85 },
  { patterns: ['gallofamily', 'gallo'], country: 'USA', confidence: 0.88 },

  // === SOUTH AFRICA ===
  { patterns: ['kanonkop'], country: 'South Africa', region: 'Stellenbosch', confidence: 0.93 },
  { patterns: ['nederburg'], country: 'South Africa', confidence: 0.90 },
  { patterns: ['noblehill', 'noble hill'], country: 'South Africa', confidence: 0.88 },
  { patterns: ['expresion'], country: 'South Africa', confidence: 0.85 },

  // === SCOTLAND — ADDITIONAL ===
  { patterns: ['ardbeg'], country: 'Scotland', region: 'Islay', confidence: 0.95 },
  { patterns: ['oldpulteney', 'pulteney'], country: 'Scotland', region: 'Highlands', confidence: 0.93 },
  { patterns: ['balblair'], country: 'Scotland', region: 'Highlands', confidence: 0.93 },
  { patterns: ['ballantines', 'ballantin'], country: 'Scotland', confidence: 0.92 },
  { patterns: ['cragganmore'], country: 'Scotland', region: 'Speyside', confidence: 0.95 },
  { patterns: ['glenkinchie'], country: 'Scotland', region: 'Lowlands', confidence: 0.95 },
  { patterns: ['royalsalute'], country: 'Scotland', confidence: 0.95 },

  // === IRELAND — ADDITIONAL ===
  { patterns: ['glendalough'], country: 'Ireland', confidence: 0.92 },

  // === ENGLAND — ADDITIONAL ===
  { patterns: ['fuller', 'fullers'], country: 'England', region: 'London', confidence: 0.90 },
  { patterns: ['hoxton'], country: 'England', confidence: 0.90 },
  { patterns: ['gilbeys', 'gilbey'], country: 'England', confidence: 0.85 },

  // === PORTUGAL ===
  { patterns: ['grahams', 'graham'], country: 'Portugal', region: 'Douro', confidence: 0.90 },
  { patterns: ['dows', 'dow'], country: 'Portugal', region: 'Douro', confidence: 0.90 },

  // === CHILE — ADDITIONAL ===
  { patterns: ['caliterra'], country: 'Chile', confidence: 0.90 },
  { patterns: ['santaema', 'santa ema'], country: 'Chile', confidence: 0.90 },
  { patterns: ['laplaya', 'la playa'], country: 'Chile', confidence: 0.88 },
  { patterns: ['torrodepiedra', 'torodepiedra'], country: 'Chile', confidence: 0.88 },
  { patterns: ['santahelena', 'santa helena'], country: 'Chile', confidence: 0.88 },
  { patterns: ['signus'], country: 'Chile', region: 'Maipo', confidence: 0.88 },

  // === JAPAN — SAKE ADDITIONAL ===
  { patterns: ['dewazakura'], country: 'Japan', confidence: 0.93 },
  { patterns: ['suminoe'], country: 'Japan', confidence: 0.90 },
  { patterns: ['mansaku', 'mansakunohana'], country: 'Japan', confidence: 0.90 },
  { patterns: ['kunizakari'], country: 'Japan', confidence: 0.90 },
  { patterns: ['inatahime', 'inata'], country: 'Japan', confidence: 0.90 },
  { patterns: ['shirayuki'], country: 'Japan', confidence: 0.90 },
  { patterns: ['kobewine', 'kobe wine'], country: 'Japan', confidence: 0.90 },

  // === MEXICO — ADDITIONAL ===
  { patterns: ['komos'], country: 'Mexico', confidence: 0.90 },

  // === THAILAND — ADDITIONAL ===
  { patterns: ['silverlake'], country: 'Thailand', confidence: 0.88 },

  // === CARIBBEAN / RUM — ADDITIONAL ===
  { patterns: ['rumcane', 'rumandcane'], country: 'Caribbean', confidence: 0.85 },
  { patterns: ['shackrum', 'shack rum'], country: 'Caribbean', confidence: 0.85 },
  { patterns: ['ronzacapa', 'zacapa'], country: 'Guatemala', confidence: 0.92 },
  { patterns: ['nasan'], country: 'Thailand', confidence: 0.85 },
  { patterns: ['mathilde'], country: 'France', confidence: 0.85 },

  // === GREECE ===
  { patterns: ['tselepos', 'domainetselepos'], country: 'Greece', confidence: 0.88 },
  { patterns: ['monemvasia'], country: 'Greece', confidence: 0.90 },

  // === FINAL PASS — remaining unmatched ===
  { patterns: ['tenutasanguido', 'sassicaia'], country: 'Italy', region: 'Tuscany', confidence: 0.95 },
  { patterns: ['fantinel'], country: 'Italy', region: 'Friuli', confidence: 0.90 },
  { patterns: ['edisimcic', 'simcic'], country: 'Slovenia', confidence: 0.90 },
  { patterns: ['2naturkinder', 'naturkinder'], country: 'Germany', region: 'Franken', confidence: 0.90 },
  { patterns: ['daou'], country: 'USA', region: 'Paso Robles', confidence: 0.90 },
  { patterns: ['drycreek', 'dry creek'], country: 'USA', region: 'Sonoma', confidence: 0.90 },
  { patterns: ['drycreekv'], country: 'USA', region: 'Sonoma', confidence: 0.90 },
  { patterns: ['bretbrother', 'bret brothers'], country: 'France', region: 'Burgundy', confidence: 0.90 },
  { patterns: ['lasoufrandiere', 'soufrandiere'], country: 'France', region: 'Burgundy', confidence: 0.90 },
  { patterns: ['ferratonpere', 'ferraton'], country: 'France', region: 'Rhône', confidence: 0.90 },
  { patterns: ['saintjames'], country: 'Martinique', confidence: 0.92 },
  { patterns: ['casco', 'cascoviejo'], country: 'Mexico', confidence: 0.88 },
  { patterns: ['kikumasamune', 'kiku'], country: 'Japan', confidence: 0.90 },
  { patterns: ['frenchbloom'], country: 'France', confidence: 0.90 },
  { patterns: ['artero'], country: 'Spain', confidence: 0.88 },
  { patterns: ['victoriaparkwine', 'victoriapark'], country: 'Australia', confidence: 0.85 },
  { patterns: ['aguasanta'], country: 'Chile', confidence: 0.85 },
  { patterns: ['askur'], country: 'Iceland', confidence: 0.85 },
  { patterns: ['kai'], country: 'New Zealand', region: 'Marlborough', confidence: 0.85 },
  { patterns: ['soberspirits', 'sober spirits'], country: '', confidence: 0.75 },
  { patterns: ['rochestercordials', 'rochestercabernet'], country: 'England', confidence: 0.82 },

  // === PASS 4 — BRAND EXPANSION ===

  // Australia
  { patterns: ['jipjiprocks', 'jipjip'], country: 'Australia', region: 'Padthaway', confidence: 0.90 },
  { patterns: ['mtmonster', 'mountmonster'], country: 'Australia', region: 'Coonawarra', confidence: 0.90 },
  { patterns: ['morambrocreek', 'morambro'], country: 'Australia', region: 'Padthaway', confidence: 0.90 },
  { patterns: ['capementelle'], country: 'Australia', region: 'Margaret River', confidence: 0.92 },
  { patterns: ['glaetzer'], country: 'Australia', region: 'Barossa Valley', confidence: 0.92 },
  { patterns: ['mountlangi', 'langhiran'], country: 'Australia', region: 'Grampians', confidence: 0.90 },
  { patterns: ['tournon'], country: 'Australia', region: 'Victoria', confidence: 0.88 },
  { patterns: ['inspiredcompany'], country: 'Australia', confidence: 0.85 },
  { patterns: ['aldridge'], country: 'Australia', confidence: 0.82 },
  { patterns: ['stagnez', 'sagnez', 'stagnes'], country: 'Australia', confidence: 0.82 },
  { patterns: ['pinnical', 'pinicalest'], country: 'Australia', confidence: 0.82 },

  // New Zealand
  { patterns: ['cloudybay'], country: 'New Zealand', region: 'Marlborough', confidence: 0.95 },
  { patterns: ['witherhills', 'wither hills'], country: 'New Zealand', region: 'Marlborough', confidence: 0.92 },
  { patterns: ['mudhouse'], country: 'New Zealand', region: 'Marlborough', confidence: 0.90 },
  { patterns: ['wairauriver', 'wairau'], country: 'New Zealand', region: 'Marlborough', confidence: 0.92 },
  { patterns: ['matua'], country: 'New Zealand', confidence: 0.90 },
  { patterns: ['villamaria'], country: 'New Zealand', confidence: 0.92 },
  { patterns: ['cablebay'], country: 'New Zealand', region: 'Waiheke Island', confidence: 0.90 },
  { patterns: ['astrolabe'], country: 'New Zealand', region: 'Marlborough', confidence: 0.90 },

  // South Africa
  { patterns: ['anura'], country: 'South Africa', confidence: 0.90 },
  { patterns: ['delheim'], country: 'South Africa', region: 'Stellenbosch', confidence: 0.92 },
  { patterns: ['rochestermerlot', 'rochesterpinotage', 'rochesterchardonnay', 'rochestershiraz'], country: 'South Africa', confidence: 0.85 },

  // France — Champagne
  { patterns: ['armanddebrignac'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['ghmumm', 'mumm'], country: 'France', region: 'Champagne', confidence: 0.92 },
  { patterns: ['polroger'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['veuveduvern', 'veuvduvern'], country: 'France', region: 'Champagne', confidence: 0.88 },

  // France — Burgundy
  { patterns: ['maisonjaffelin', 'jaffelin'], country: 'France', region: 'Burgundy', confidence: 0.90 },
  { patterns: ['domaineligerbelair', 'ligerbelair', 'thibaultligerbelair'], country: 'France', region: 'Burgundy', confidence: 0.92 },
  { patterns: ['domainepoussedor', 'poussedor'], country: 'France', region: 'Burgundy', confidence: 0.92 },
  { patterns: ['domainejeamfery', 'domaineferyfils', 'jeanfery'], country: 'France', region: 'Burgundy', confidence: 0.90 },
  { patterns: ['domainederochebin', 'rochebin'], country: 'France', region: 'Burgundy', confidence: 0.90 },
  { patterns: ['maison1838', 'maison jaffelin'], country: 'France', region: 'Burgundy', confidence: 0.88 },

  // France — Loire
  { patterns: ['josephmellot'], country: 'France', region: 'Loire Valley', confidence: 0.92 },
  { patterns: ['domainehuet'], country: 'France', region: 'Loire Valley', confidence: 0.92 },

  // France — Rhône
  { patterns: ['brotte'], country: 'France', region: 'Rhône', confidence: 0.90 },

  // France — Alsace
  { patterns: ['domainealbertmann', 'albertmann'], country: 'France', region: 'Alsace', confidence: 0.92 },
  { patterns: ['schieferkopf'], country: 'France', region: 'Alsace', confidence: 0.88 },

  // France — Languedoc / Roussillon
  { patterns: ['laurentmiquel'], country: 'France', region: 'Languedoc', confidence: 0.90 },
  { patterns: ['gallician'], country: 'France', region: 'Languedoc', confidence: 0.88 },
  { patterns: ['antech'], country: 'France', region: 'Languedoc', confidence: 0.88 },
  { patterns: ['reservestmartin', 'reserve st martin', 'stmartin'], country: 'France', region: 'Languedoc', confidence: 0.88 },
  { patterns: ['labelleangele', 'belleangele'], country: 'France', region: 'Languedoc', confidence: 0.85 },
  { patterns: ['lesvolets'], country: 'France', region: 'Languedoc', confidence: 0.85 },
  { patterns: ['lacollectionboutinot', 'boutinot'], country: 'France', region: 'Languedoc', confidence: 0.85 },
  { patterns: ['domainelafage', 'lafage'], country: 'France', region: 'Roussillon', confidence: 0.90 },

  // France — Provence
  { patterns: ['domainesott', 'domainesott'], country: 'France', region: 'Provence', confidence: 0.92 },
  { patterns: ['mirabeau'], country: 'France', region: 'Provence', confidence: 0.90 },
  { patterns: ['domainehouchart', 'houchart'], country: 'France', region: 'Provence', confidence: 0.90 },

  // France — Bordeaux
  { patterns: ['michellynch', 'michel lynch'], country: 'France', region: 'Bordeaux', confidence: 0.90 },

  // France — Cognac
  { patterns: ['camus'], country: 'France', region: 'Cognac', confidence: 0.92 },

  // Spain
  { patterns: ['cune'], country: 'Spain', region: 'Rioja', confidence: 0.90 },
  { patterns: ['solarviejo'], country: 'Spain', region: 'Rioja', confidence: 0.90 },
  { patterns: ['codorniu', 'bodegascodorniu'], country: 'Spain', region: 'Cava', confidence: 0.90 },
  { patterns: ['donluciano'], country: 'Spain', confidence: 0.85 },

  // Italy — Tuscany
  { patterns: ['poggioaltesoro'], country: 'Italy', region: 'Tuscany', confidence: 0.92 },
  { patterns: ['tenutadivalgiano', 'valgiano'], country: 'Italy', region: 'Tuscany', confidence: 0.92 },
  { patterns: ['tenutadibiserno', 'biserno'], country: 'Italy', region: 'Tuscany', confidence: 0.92 },
  { patterns: ['roccadimontegrossi', 'montegrossi'], country: 'Italy', region: 'Tuscany', confidence: 0.90 },
  { patterns: ['poderecarnasciale', 'carnasciale'], country: 'Italy', region: 'Tuscany', confidence: 0.90 },
  { patterns: ['tenutasetteponti', 'setteponti'], country: 'Italy', region: 'Tuscany', confidence: 0.90 },
  { patterns: ['poggioallupo'], country: 'Italy', region: 'Tuscany', confidence: 0.88 },

  // Italy — Piedmont
  { patterns: ['marchesidigresy', 'digresy'], country: 'Italy', region: 'Piedmont', confidence: 0.92 },

  // Italy — Campania
  { patterns: ['mastroberardino'], country: 'Italy', region: 'Campania', confidence: 0.92 },
  { patterns: ['feudidisangregorio', 'feudisangregorio', 'feudosangregorio'], country: 'Italy', region: 'Campania', confidence: 0.92 },

  // Italy — Sicily
  { patterns: ['cantinepellegrino', 'pellegrino'], country: 'Italy', region: 'Sicily', confidence: 0.90 },
  { patterns: ['planeta'], country: 'Italy', region: 'Sicily', confidence: 0.92 },

  // Italy — Abruzzo
  { patterns: ['fantini'], country: 'Italy', region: 'Abruzzo', confidence: 0.88 },

  // Italy — Puglia
  { patterns: ['luccarelli'], country: 'Italy', region: 'Puglia', confidence: 0.88 },
  { patterns: ['masseriaborgodt', 'borgodeitrulli'], country: 'Italy', region: 'Puglia', confidence: 0.88 },

  // Italy — Veneto
  { patterns: ['follador'], country: 'Italy', region: 'Veneto', confidence: 0.90 },
  { patterns: ['corteviola'], country: 'Italy', region: 'Veneto', confidence: 0.85 },
  { patterns: ['pitars'], country: 'Italy', region: 'Veneto', confidence: 0.85 },
  { patterns: ['tavernello'], country: 'Italy', confidence: 0.85 },

  // Italy — Lombardy (Franciacorta)
  { patterns: ['contadicastaldi'], country: 'Italy', region: 'Lombardy', confidence: 0.92 },

  // Italy — Trentino
  { patterns: ['tenutulunelli', 'lunelli'], country: 'Italy', region: 'Trentino', confidence: 0.90 },

  // Italy — Umbria
  { patterns: ['lacarraia', 'carraia'], country: 'Italy', region: 'Umbria', confidence: 0.90 },

  // Italy — Sparkling / Brandy
  { patterns: ['vecchiaromagna'], country: 'Italy', confidence: 0.90 },
  { patterns: ['bohem'], country: 'Italy', confidence: 0.85 },

  // Austria
  { patterns: ['judithbeck'], country: 'Austria', region: 'Burgenland', confidence: 0.92 },
  { patterns: ['jurisgolser', 'jurisst', 'golserst'], country: 'Austria', region: 'Burgenland', confidence: 0.90 },

  // Germany
  { patterns: ['biankadanielschmitt', 'biankaanddan', 'biankaschmitt'], country: 'Germany', region: 'Rheinhessen', confidence: 0.90 },

  // Chile
  { patterns: ['vinaelprincipal', 'elprincipal'], country: 'Chile', region: 'Maipo Valley', confidence: 0.90 },
  { patterns: ['odfjell'], country: 'Chile', confidence: 0.90 },
  { patterns: ['maturana'], country: 'Chile', confidence: 0.85 },
  { patterns: ['latue'], country: 'Chile', confidence: 0.85 },
  { patterns: ['herdadedesaomiguel', 'herdadesaomiguel'], country: 'Portugal', region: 'Alentejo', confidence: 0.90 },

  // Argentina
  { patterns: ['zuccardi'], country: 'Argentina', region: 'Mendoza', confidence: 0.92 },
  { patterns: ['santajulia'], country: 'Argentina', region: 'Mendoza', confidence: 0.90 },
  { patterns: ['chevaldesandes'], country: 'Argentina', region: 'Mendoza', confidence: 0.93 },
  { patterns: ['terrazas'], country: 'Argentina', region: 'Mendoza', confidence: 0.90 },

  // Ireland
  { patterns: ['teeling'], country: 'Ireland', confidence: 0.92 },
  { patterns: ['thequietman', 'quietman'], country: 'Ireland', confidence: 0.92 },

  // Scotland
  { patterns: ['dalmore', 'thedalmore'], country: 'Scotland', region: 'Highlands', confidence: 0.95 },
  { patterns: ['glenmoray'], country: 'Scotland', region: 'Speyside', confidence: 0.95 },
  { patterns: ['aberlour'], country: 'Scotland', region: 'Speyside', confidence: 0.95 },
  { patterns: ['glengrant'], country: 'Scotland', region: 'Speyside', confidence: 0.93 },
  { patterns: ['jura'], country: 'Scotland', region: 'Isle of Jura', confidence: 0.90 },
  { patterns: ['springbank'], country: 'Scotland', region: 'Campbeltown', confidence: 0.93 },
  { patterns: ['bruichladdich'], country: 'Scotland', region: 'Islay', confidence: 0.95 },
  { patterns: ['bowmore'], country: 'Scotland', region: 'Islay', confidence: 0.95 },
  { patterns: ['bunnahabhain'], country: 'Scotland', region: 'Islay', confidence: 0.95 },

  // USA
  { patterns: ['spottswoode'], country: 'USA', region: 'Napa Valley', confidence: 0.93 },
  { patterns: ['starmont'], country: 'USA', region: 'Carneros', confidence: 0.90 },
  { patterns: ['districtseriesalexander', 'alexandervalley'], country: 'USA', region: 'Sonoma', confidence: 0.90 },
  { patterns: ['districtseriesrussian', 'russianriverchardonnay'], country: 'USA', region: 'Sonoma', confidence: 0.90 },
  { patterns: ['flyby', 'fly by'], country: 'USA', confidence: 0.82 },

  // Japan — Gin / Additional Sake
  { patterns: ['kinobi'], country: 'Japan', confidence: 0.93 },
  { patterns: ['sesshu'], country: 'Japan', confidence: 0.90 },
  { patterns: ['houkinoindama', 'houki'], country: 'Japan', confidence: 0.90 },

  // Thailand
  { patterns: ['ironballs'], country: 'Thailand', confidence: 0.92 },
  { patterns: ['siamlanna'], country: 'Thailand', confidence: 0.88 },
  { patterns: ['phraya'], country: 'Thailand', confidence: 0.90 },
  { patterns: ['prakaan'], country: 'Thailand', confidence: 0.88 },
  { patterns: ['kosapan'], country: 'Thailand', confidence: 0.88 },

  // India
  { patterns: ['sikkim'], country: 'India', confidence: 0.90 },

  // Norway
  { patterns: ['harahorn'], country: 'Norway', confidence: 0.92 },

  // Poland / Netherlands / Caribbean
  { patterns: ['belvedere'], country: 'Poland', confidence: 0.92 },
  { patterns: ['ketelone'], country: 'Netherlands', confidence: 0.92 },
  { patterns: ['captainmorgan'], country: 'Caribbean', confidence: 0.92 },
  { patterns: ['ciroc'], country: 'France', confidence: 0.90 },
  { patterns: ['bulleit'], country: 'USA', confidence: 0.92 },
  { patterns: ['baileys'], country: 'Ireland', confidence: 0.92 },

  // === PASS 5 — REMAINING IDENTIFIABLE BRANDS ===

  // France — Champagne
  { patterns: ['delamotte'], country: 'France', region: 'Champagne', confidence: 0.95 },
  { patterns: ['allartfils', 'allartandfils'], country: 'France', region: 'Champagne', confidence: 0.90 },
  { patterns: ['davidoff'], country: 'France', region: 'Cognac', confidence: 0.90 },

  // France — Burgundy
  { patterns: ['domaineleflaive', 'leflaive'], country: 'France', region: 'Burgundy', confidence: 0.95 },
  { patterns: ['fontainegagnard', 'domaineontainegagnard'], country: 'France', region: 'Burgundy', confidence: 0.92 },

  // France — Rhône
  { patterns: ['pauljaboulet', 'jaboulet'], country: 'France', region: 'Rhône', confidence: 0.92 },

  // Italy — Tuscany
  { patterns: ['argiano'], country: 'Italy', region: 'Tuscany', confidence: 0.92 },
  { patterns: ['brancaia'], country: 'Italy', region: 'Tuscany', confidence: 0.92 },

  // Italy — Piedmont
  { patterns: ['ceretto'], country: 'Italy', region: 'Piedmont', confidence: 0.92 },
  { patterns: ['contratto'], country: 'Italy', region: 'Piedmont', confidence: 0.90 },

  // Italy — Emilia-Romagna (Lambrusco)
  { patterns: ['cavicchioli'], country: 'Italy', region: 'Emilia-Romagna', confidence: 0.90 },

  // Italy — Misc
  { patterns: ['pallini'], country: 'Italy', confidence: 0.88 },
  { patterns: ['terredelvulcano', 'terredelvulcano'], country: 'Italy', region: 'Sicily', confidence: 0.88 },
  { patterns: ['cristiani'], country: 'Italy', confidence: 0.85 },

  // Spain
  { patterns: ['cuevadelviento'], country: 'Spain', confidence: 0.88 },

  // Chile
  { patterns: ['sena'], country: 'Chile', region: 'Aconcagua Valley', confidence: 0.93 },

  // USA
  { patterns: ['sterlingvineyards', 'sterlingvintner', 'sterling'], country: 'USA', region: 'Napa Valley', confidence: 0.90 },
  { patterns: ['cornerstone'], country: 'USA', region: 'Napa Valley', confidence: 0.88 },
  { patterns: ['theblindpig', 'blindpig'], country: 'USA', region: 'Napa Valley', confidence: 0.88 },
  { patterns: ['elijah', 'elijahcraig'], country: 'USA', confidence: 0.92 },
  { patterns: ['evanwilliams'], country: 'USA', confidence: 0.92 },

  // New Zealand
  { patterns: ['frommwinery', 'fromm'], country: 'New Zealand', region: 'Marlborough', confidence: 0.90 },
  { patterns: ['russianjack'], country: 'New Zealand', region: 'Marlborough', confidence: 0.88 },
  { patterns: ['satellite'], country: 'New Zealand', region: 'Marlborough', confidence: 0.88 },

  // Australia
  { patterns: ['mrriggs', 'mr riggs'], country: 'Australia', region: 'McLaren Vale', confidence: 0.92 },
  { patterns: ['heartland'], country: 'Australia', confidence: 0.85 },

  // England
  { patterns: ['langleys'], country: 'England', confidence: 0.90 },

  // Canada
  { patterns: ['gibsons'], country: 'Canada', confidence: 0.88 },

  // Indonesia
  { patterns: ['nusacana'], country: 'Indonesia', confidence: 0.90 },

  // China
  { patterns: ['peddlers'], country: 'China', confidence: 0.88 },

  // Chile
  { patterns: ['vikwinery', 'vikmillahue', 'vikmillacala'], country: 'Chile', region: 'Cachapoal Valley', confidence: 0.92 },

  // === PASS 6 ===

  // Italy — Alto Adige
  { patterns: ['stpauls'], country: 'Italy', region: 'Alto Adige', confidence: 0.90 },

  // Italy — Friuli
  { patterns: ['pighin'], country: 'Italy', region: 'Friuli', confidence: 0.90 },

  // Italy — Tuscany
  { patterns: ['carpineto'], country: 'Italy', region: 'Tuscany', confidence: 0.90 },

  // Italy — Marche
  { patterns: ['garofoli'], country: 'Italy', region: 'Marche', confidence: 0.90 },

  // Italy — Basilicata
  { patterns: ['vignetidelvulture'], country: 'Italy', region: 'Basilicata', confidence: 0.90 },

  // Italy — Misc
  { patterns: ['disaronno'], country: 'Italy', confidence: 0.95 },

  // France — Alsace
  { patterns: ['trimbach'], country: 'France', region: 'Alsace', confidence: 0.95 },
  { patterns: ['heim'], country: 'France', region: 'Alsace', confidence: 0.88 },

  // France — Burgundy
  { patterns: ['chansonpere', 'chansonperefilss', 'chansonfils'], country: 'France', region: 'Burgundy', confidence: 0.90 },

  // France — Rhône / Languedoc
  { patterns: ['moulindegassac', 'moulingassac'], country: 'France', region: 'Languedoc', confidence: 0.90 },
  { patterns: ['ostalcazes', 'lostalcazes'], country: 'France', region: 'Languedoc', confidence: 0.90 },

  // France — Provence
  { patterns: ['minuty', 'chateauminuty'], country: 'France', region: 'Provence', confidence: 0.92 },

  // France — Armagnac
  { patterns: ['chabotarmagnac', 'chabot'], country: 'France', region: 'Armagnac', confidence: 0.92 },

  // Australia — Barossa
  { patterns: ['sthallett', 'st hallett'], country: 'Australia', region: 'Barossa Valley', confidence: 0.92 },
  { patterns: ['headlineacts'], country: 'Australia', confidence: 0.85 },

  // New Zealand — Martinborough
  { patterns: ['escarpment'], country: 'New Zealand', region: 'Martinborough', confidence: 0.92 },

  // Argentina
  { patterns: ['argento'], country: 'Argentina', region: 'Mendoza', confidence: 0.90 },

  // Chile
  { patterns: ['colina'], country: 'Chile', confidence: 0.85 },
  { patterns: ['sena'], country: 'Chile', region: 'Aconcagua Valley', confidence: 0.93 },

  // USA — Napa/Carneros
  { patterns: ['cuvaison'], country: 'USA', region: 'Carneros', confidence: 0.92 },

  // Mexico — Tequila
  { patterns: ['sierratequila', 'sierrablanco', 'sierrareposado'], country: 'Mexico', confidence: 0.92 },

  // England
  { patterns: ['chasegin', 'chasedistillery', 'chasevod'], country: 'England', confidence: 0.92 },
  { patterns: ['brokers', 'brokersgin'], country: 'England', confidence: 0.92 },
  { patterns: ['rivogin', 'rivosloe', 'rivoforaged', 'rivomediterranean'], country: 'England', confidence: 0.88 },

  // Ireland
  { patterns: ['theirishman', 'irishman'], country: 'Ireland', confidence: 0.92 },

  // Belgium
  { patterns: ['1836gin', '1836organic'], country: 'Belgium', confidence: 0.90 },

  // USA — spirits
  { patterns: ['mccormick'], country: 'USA', confidence: 0.88 },
];

// ─── REGION KEYWORD MAP ────────────────────────────────────────────────────
// These fire on the full product name and assign country+region from appellation
type RegionRule = { keyword: string; country: string; region?: string; subregion?: string; classification?: string; confidence: number };
const REGION_MAP: RegionRule[] = [
  // France
  { keyword: 'champagne',      country: 'France', region: 'Champagne',          classification: 'Sparkling Wine', confidence: 0.95 },
  { keyword: 'bordeaux',       country: 'France', region: 'Bordeaux',            classification: 'Red Wine',       confidence: 0.90 },
  { keyword: 'pomerol',        country: 'France', region: 'Bordeaux', subregion: 'Pomerol', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'margaux',        country: 'France', region: 'Bordeaux', subregion: 'Margaux', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'saintjulien',    country: 'France', region: 'Bordeaux', subregion: 'Saint-Julien', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'pauillac',       country: 'France', region: 'Bordeaux', subregion: 'Pauillac', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'saintestephe',   country: 'France', region: 'Bordeaux', subregion: 'Saint-Estèphe', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'sauternes',      country: 'France', region: 'Bordeaux', subregion: 'Sauternes', classification: 'Dessert Wine', confidence: 0.92 },
  { keyword: 'burgundy',       country: 'France', region: 'Burgundy',            classification: 'Wine',           confidence: 0.90 },
  { keyword: 'bourgogne',      country: 'France', region: 'Burgundy',            classification: 'Wine',           confidence: 0.90 },
  { keyword: 'chablis',        country: 'France', region: 'Burgundy', subregion: 'Chablis', classification: 'White Wine', confidence: 0.92 },
  { keyword: 'beaujolais',     country: 'France', region: 'Beaujolais',          classification: 'Red Wine',       confidence: 0.90 },
  { keyword: 'rhone',          country: 'France', region: 'Rhône',               classification: 'Wine',           confidence: 0.88 },
  { keyword: 'cotedurhone',    country: 'France', region: 'Rhône',               classification: 'Wine',           confidence: 0.88 },
  { keyword: 'cotesdurhone',   country: 'France', region: 'Rhône',               classification: 'Wine',           confidence: 0.88 },
  { keyword: 'sancerre',       country: 'France', region: 'Loire Valley', subregion: 'Sancerre', classification: 'White Wine', confidence: 0.92 },
  { keyword: 'loire',          country: 'France', region: 'Loire Valley',        classification: 'Wine',           confidence: 0.88 },
  { keyword: 'alsace',         country: 'France', region: 'Alsace',              classification: 'Wine',           confidence: 0.90 },
  { keyword: 'languedoc',      country: 'France', region: 'Languedoc',           classification: 'Wine',           confidence: 0.88 },
  { keyword: 'cremant',        country: 'France',                                classification: 'Sparkling Wine', confidence: 0.88 },
  { keyword: 'cognac',         country: 'France',                                classification: 'Brandy',         confidence: 0.95 },

  // Italy
  { keyword: 'barolo',         country: 'Italy', region: 'Piedmont', subregion: 'Barolo', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'barbaresco',     country: 'Italy', region: 'Piedmont', subregion: 'Barbaresco', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'barbera',        country: 'Italy', region: 'Piedmont',             classification: 'Red Wine',       confidence: 0.88 },
  { keyword: 'dolcetto',       country: 'Italy', region: 'Piedmont',             classification: 'Red Wine',       confidence: 0.88 },
  { keyword: 'nebbiolo',       country: 'Italy',                                 classification: 'Red Wine',       confidence: 0.88 },
  { keyword: 'chianti',        country: 'Italy', region: 'Tuscany', subregion: 'Chianti', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'brunello',       country: 'Italy', region: 'Tuscany', subregion: 'Brunello di Montalcino', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'montalcino',     country: 'Italy', region: 'Tuscany',              classification: 'Red Wine',       confidence: 0.92 },
  { keyword: 'toscana',        country: 'Italy', region: 'Tuscany',              classification: 'Wine',           confidence: 0.88 },
  { keyword: 'tuscany',        country: 'Italy', region: 'Tuscany',              classification: 'Wine',           confidence: 0.88 },
  { keyword: 'amarone',        country: 'Italy', region: 'Veneto',               classification: 'Red Wine',       confidence: 0.92 },
  { keyword: 'soave',          country: 'Italy', region: 'Veneto',               classification: 'White Wine',     confidence: 0.90 },
  { keyword: 'valpolicella',   country: 'Italy', region: 'Veneto',               classification: 'Red Wine',       confidence: 0.90 },
  { keyword: 'prosecco',       country: 'Italy', region: 'Veneto',               classification: 'Sparkling Wine', confidence: 0.95 },
  { keyword: 'sangiovese',     country: 'Italy',                                 classification: 'Red Wine',       confidence: 0.85 },
  { keyword: 'moscato',        country: 'Italy',                                 classification: 'Dessert Wine',   confidence: 0.85 },
  { keyword: 'grappa',         country: 'Italy',                                 classification: 'Grappa',         confidence: 0.90 },
  { keyword: 'aglianico',      country: 'Italy',                                 classification: 'Red Wine',       confidence: 0.88 },

  // Spain
  { keyword: 'rioja',          country: 'Spain', region: 'Rioja',                classification: 'Red Wine',       confidence: 0.92 },
  { keyword: 'ribera',         country: 'Spain', region: 'Ribera del Duero',     classification: 'Red Wine',       confidence: 0.90 },
  { keyword: 'priorat',        country: 'Spain', region: 'Priorat',              classification: 'Red Wine',       confidence: 0.90 },
  { keyword: 'cava',           country: 'Spain',                                 classification: 'Sparkling Wine', confidence: 0.90 },
  { keyword: 'sherry',         country: 'Spain', region: 'Jerez',                classification: 'Sherry',         confidence: 0.90 },
  { keyword: 'jerez',          country: 'Spain', region: 'Jerez',                classification: 'Sherry',         confidence: 0.92 },
  { keyword: 'albarino',       country: 'Spain', region: 'Galicia',              classification: 'White Wine',     confidence: 0.90 },
  { keyword: 'albarino',       country: 'Spain', region: 'Galicia',              classification: 'White Wine',     confidence: 0.90 },
  { keyword: 'tempranillo',    country: 'Spain',                                 classification: 'Red Wine',       confidence: 0.85 },

  // Germany / Austria
  { keyword: 'riesling',       country: 'Germany',                               classification: 'White Wine',     confidence: 0.75 },
  { keyword: 'gruner',         country: 'Austria',                               classification: 'White Wine',     confidence: 0.88 },
  { keyword: 'grüner',         country: 'Austria',                               classification: 'White Wine',     confidence: 0.88 },
  { keyword: 'mosel',          country: 'Germany', region: 'Mosel',              classification: 'White Wine',     confidence: 0.90 },
  { keyword: 'rheingau',       country: 'Germany', region: 'Rheingau',           classification: 'White Wine',     confidence: 0.90 },

  // Portugal
  { keyword: 'porto',          country: 'Portugal', region: 'Douro',             classification: 'Port',           confidence: 0.95 },
  { keyword: 'portwine',       country: 'Portugal', region: 'Douro',             classification: 'Port',           confidence: 0.95 },
  { keyword: 'douro',          country: 'Portugal', region: 'Douro',             classification: 'Wine',           confidence: 0.90 },
  { keyword: 'vinhoverdeport', country: 'Portugal',                              classification: 'White Wine',     confidence: 0.88 },

  // Australia
  { keyword: 'barossa',        country: 'Australia', region: 'Barossa Valley',   classification: 'Red Wine',       confidence: 0.90 },
  { keyword: 'mclaren',        country: 'Australia', region: 'McLaren Vale',     classification: 'Red Wine',       confidence: 0.90 },
  { keyword: 'margaret',       country: 'Australia', region: 'Margaret River',   classification: 'Wine',           confidence: 0.88 },

  // New Zealand
  { keyword: 'marlborough',    country: 'New Zealand', region: 'Marlborough',    classification: 'White Wine',     confidence: 0.92 },
  { keyword: 'hawkes',         country: 'New Zealand', region: "Hawke's Bay",    classification: 'Wine',           confidence: 0.88 },
  { keyword: 'otago',          country: 'New Zealand', region: 'Central Otago',  classification: 'Red Wine',       confidence: 0.90 },

  // USA
  { keyword: 'napa',           country: 'USA', region: 'Napa Valley',            classification: 'Wine',           confidence: 0.90 },
  { keyword: 'sonoma',         country: 'USA', region: 'Sonoma',                 classification: 'Wine',           confidence: 0.88 },
  { keyword: 'willamette',     country: 'USA', region: 'Willamette Valley',      classification: 'Red Wine',       confidence: 0.90 },
  { keyword: 'walla',          country: 'USA', region: 'Walla Walla',            classification: 'Wine',           confidence: 0.88 },
  { keyword: 'bourbon',        country: 'USA',                                   classification: 'Whiskey',        confidence: 0.95 },

  // Argentina / Chile
  { keyword: 'mendoza',        country: 'Argentina', region: 'Mendoza',          classification: 'Wine',           confidence: 0.90 },
  { keyword: 'malbec',         country: 'Argentina',                             classification: 'Red Wine',       confidence: 0.82 },

  // Scotland/UK
  { keyword: 'scotch',         country: 'Scotland',                              classification: 'Whisky',         confidence: 0.90 },
  { keyword: 'speyside',       country: 'Scotland', region: 'Speyside',          classification: 'Whisky',         confidence: 0.92 },
  { keyword: 'islay',          country: 'Scotland', region: 'Islay',             classification: 'Whisky',         confidence: 0.92 },
  { keyword: 'highlands',      country: 'Scotland', region: 'Highlands',         classification: 'Whisky',         confidence: 0.90 },
  { keyword: 'lowland',        country: 'Scotland', region: 'Lowlands',          classification: 'Whisky',         confidence: 0.88 },

  // Japan
  { keyword: 'sake',           country: 'Japan',                                 classification: 'Sake',           confidence: 0.95 },
  { keyword: 'shochu',         country: 'Japan',                                 classification: 'Shochu',         confidence: 0.95 },
  { keyword: 'soju',           country: 'South Korea',                           classification: 'Soju',           confidence: 0.95 },

  // Mexico
  { keyword: 'tequila',        country: 'Mexico',                                classification: 'Tequila',        confidence: 0.95 },
  { keyword: 'mezcal',         country: 'Mexico',                                classification: 'Mezcal',         confidence: 0.95 },

  // Other
  { keyword: 'tokaj',          country: 'Hungary',                               classification: 'Dessert Wine',   confidence: 0.92 },
  { keyword: 'shiraz',         country: '',                                      classification: 'Red Wine',       confidence: 0.72 },
  { keyword: 'syrah',          country: '',                                      classification: 'Red Wine',       confidence: 0.72 },
  { keyword: 'viognier',       country: '',                                      classification: 'White Wine',     confidence: 0.72 },
  { keyword: 'gewurztraminer', country: '',                                      classification: 'White Wine',     confidence: 0.72 },
  { keyword: 'chenin',         country: '',                                      classification: 'White Wine',     confidence: 0.70 },
  { keyword: 'torrontes',      country: 'Argentina',                             classification: 'White Wine',     confidence: 0.82 },
  { keyword: 'pinotnoir',      country: '',                                      classification: 'Red Wine',       confidence: 0.70 },
  { keyword: 'cabernetsauvignon', country: '',                                   classification: 'Red Wine',       confidence: 0.70 },
  { keyword: 'sauvignonblanc', country: '',                                      classification: 'White Wine',     confidence: 0.70 },
  { keyword: 'chardonnay',     country: '',                                      classification: 'White Wine',     confidence: 0.70 },

  // Additional appellations
  { keyword: 'bolgheri',       country: 'Italy', region: 'Tuscany', subregion: 'Bolgheri', classification: 'Red Wine', confidence: 0.92 },
  { keyword: 'vouvray',        country: 'France', region: 'Loire Valley', subregion: 'Vouvray', classification: 'White Wine', confidence: 0.92 },
  { keyword: 'limoux',         country: 'France', region: 'Languedoc', classification: 'Sparkling Wine', confidence: 0.90 },
  { keyword: 'bandol',         country: 'France', region: 'Provence', classification: 'Wine', confidence: 0.90 },
  { keyword: 'provence',       country: 'France', region: 'Provence', classification: 'Wine', confidence: 0.88 },
  { keyword: 'roussillon',     country: 'France', region: 'Roussillon', classification: 'Wine', confidence: 0.88 },
  { keyword: 'pfalz',          country: 'Germany', region: 'Pfalz', classification: 'White Wine', confidence: 0.88 },
  { keyword: 'alentejo',       country: 'Portugal', region: 'Alentejo', classification: 'Wine', confidence: 0.90 },
  { keyword: 'primitivo',      country: 'Italy', region: 'Puglia', classification: 'Red Wine', confidence: 0.88 },
  { keyword: 'franciacorta',   country: 'Italy', region: 'Lombardy', classification: 'Sparkling Wine', confidence: 0.92 },
  { keyword: 'trentino',       country: 'Italy', region: 'Trentino', classification: 'Wine', confidence: 0.88 },
  { keyword: 'campania',       country: 'Italy', region: 'Campania', classification: 'Wine', confidence: 0.88 },
  { keyword: 'maremma',        country: 'Italy', region: 'Tuscany', classification: 'Wine', confidence: 0.88 },
  { keyword: 'orvieto',        country: 'Italy', region: 'Umbria', classification: 'White Wine', confidence: 0.88 },
  { keyword: 'carmenere',      country: 'Chile', classification: 'Red Wine', confidence: 0.82 },
  { keyword: 'pinotage',       country: 'South Africa', classification: 'Red Wine', confidence: 0.88 },
  { keyword: 'vinhoverdeale',  country: 'Portugal', classification: 'White Wine', confidence: 0.88 },
];

// ─── ACCESSORY SKU PREFIXES ──────────────────────────────────────────────────
// Products with these SKU prefixes are bar/wine accessories — no country needed.
const ACCESSORY_PREFIXES = new Set(['ABA', 'AWC', 'GWN', 'GLQ', 'GBE', 'GNB', 'GAC', 'GDC', 'GDE']);

// ─── MAIN ENRICHMENT FUNCTION ────────────────────────────────────────────────
export function enrichWithRules(product: Record<string, any>): EnrichmentResult {
  const sku = String(product.sku ?? '').substring(0, 3).toUpperCase();

  // 0. Accessories — auto-validate, no country needed
  if (ACCESSORY_PREFIXES.has(sku)) {
    return {
      classification: 'Accessory',
      confidence: 0.90,
      source: 'rules',
      note: `SKU prefix ${sku} → Accessory (bar/wine equipment)`,
    };
  }

  const name = norm(String(product.name ?? ''));
  const brand = norm(String(product.brand ?? ''));

  // 1. Brand match (most specific — exact brand knowledge)
  for (const entry of BRAND_MAP) {
    if (entry.patterns.some(p => name.includes(p) || brand.includes(p))) {
      return {
        country: entry.country,
        region: entry.region,
        confidence: entry.confidence,
        source: 'rules',
        note: `Brand match → ${entry.country}${entry.region ? ` (${entry.region})` : ''}`,
      };
    }
  }

  // 2. Region / appellation / keyword match
  for (const rule of REGION_MAP) {
    const kw = norm(rule.keyword);
    if (name.includes(kw)) {
      return {
        country: rule.country || undefined,
        region: rule.region,
        subregion: rule.subregion,
        classification: rule.classification,
        confidence: rule.confidence,
        source: 'rules',
        note: `Keyword "${rule.keyword}" → ${rule.classification ?? ''}${rule.country ? ` (${rule.country})` : ''}`,
      };
    }
  }

  // 3. Category defaults (low confidence)
  const liquorType = norm(String(product.liquor_main_type ?? ''));
  if (liquorType.includes('rum')) {
    return { country: 'Caribbean', confidence: 0.40, source: 'rules', note: 'Default: rum → Caribbean' };
  }
  if (liquorType.includes('whisky') || liquorType.includes('whiskey')) {
    return { confidence: 0.35, source: 'rules', note: 'Default: whisky (country unknown)' };
  }

  return { confidence: 0.20, source: 'rules', note: 'No rule matched' };
}
