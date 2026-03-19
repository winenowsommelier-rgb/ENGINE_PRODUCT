export type ProductRecord = {
  sku: string;
  name: string;
  category: 'Wine' | 'Spirits';
  type: string;
  grape: string;
  region: string;
  style: string;
  price: number;
  costPrice: number;
  currency: string;
  status: 'Ready' | 'Needs review' | 'Draft';
  oak: number;
  country?: string;
};

export type FlavorProfile = {
  body: number;
  acidity: number;
  tannin: number;
  sweetness: number;
  alcohol: number;
  intensity: number;
  finish: number;
  texture: number;
  oak: number;
  fruit: number;
  floral: number;
  herbal: number;
  spice: number;
  earth: number;
  mineral: number;
};

export type PairingProfile = {
  protein: string[];
  cuisine: string[];
  dishes: string[];
  logic: string;
};

export type TaxonomyMetric = {
  label: string;
  count: number;
  trend: string;
};

export type RawImportRow = {
  sku: string;
  name: string;
  category: string;
  type: string;
  grape: string;
  region: string;
  style: string;
  price: string;
  costPrice: string;
  currency: string;
  status: string;
  oak: string;
};

export const products: ProductRecord[] = [
  {
    sku: 'WN-1001',
    name: 'Silver Ridge Napa Cabernet Sauvignon',
    category: 'Wine',
    type: 'Red Wine',
    grape: 'Cabernet Sauvignon',
    region: 'Napa Valley',
    style: 'Structured & Oak-Aged',
    price: 39,
    costPrice: 19,
    currency: 'USD',
    status: 'Ready',
    oak: 4,
    country: 'USA'
  },
  {
    sku: 'WN-1002',
    name: 'Azure Coast Marlborough Sauvignon Blanc',
    category: 'Wine',
    type: 'White Wine',
    grape: 'Sauvignon Blanc',
    region: 'Marlborough',
    style: 'Crisp & Aromatic',
    price: 23,
    costPrice: 10,
    currency: 'USD',
    status: 'Ready',
    oak: 0,
    country: 'New Zealand'
  },
  {
    sku: 'WN-2010',
    name: 'Casa Naranja Tequila Reposado',
    category: 'Spirits',
    type: 'Agave Spirit',
    grape: 'Blue Weber Agave',
    region: 'Jalisco Highlands',
    style: 'Barrel Rested',
    price: 52,
    costPrice: 28,
    currency: 'USD',
    status: 'Needs review',
    oak: 3,
    country: 'Mexico'
  },
  {
    sku: 'WN-3100',
    name: 'Velvet Ember Willamette Pinot Noir',
    category: 'Wine',
    type: 'Red Wine',
    grape: 'Pinot Noir',
    region: 'Willamette Valley',
    style: 'Elegant & Earthy',
    price: 31,
    costPrice: 16,
    currency: 'USD',
    status: 'Draft',
    oak: 2,
    country: 'USA'
  }
];

export const sampleRawImportRows: RawImportRow[] = [
  {
    sku: ' wn-1003 ',
    name: 'Golden Mesa Reserve Cabernet',
    category: 'wine',
    type: 'red wine',
    grape: 'cab sauv',
    region: 'napa',
    style: 'structured oak aged',
    price: '42',
    costPrice: '20',
    currency: 'usd',
    status: 'ready',
    oak: '6'
  },
  {
    sku: '',
    name: 'Untitled Marlboro Blanc',
    category: 'wine',
    type: 'white wine',
    grape: 'sauv blanc',
    region: 'marlboro',
    style: 'crisp aromatic',
    price: '19',
    costPrice: '8',
    currency: 'usd',
    status: 'draft',
    oak: '0'
  },
  {
    sku: '  wn-2011',
    name: 'Casa Naranja Highland Reposado',
    category: 'spirits',
    type: 'agave spirit',
    grape: 'agave',
    region: 'jalisco',
    style: 'barrel rested',
    price: '54',
    costPrice: '27',
    currency: 'usd',
    status: 'needs review',
    oak: '3'
  }
];

export const taxonomyMetrics: TaxonomyMetric[] = [
  { label: 'Active SKUs', count: 10482, trend: '+12.4% vs last import' },
  { label: 'Low confidence rows', count: 182, trend: '1.7% of current batch' },
  { label: 'Taxonomy tabs', count: 10, trend: 'Loaded from the global taxonomy workbook' },
  { label: 'Exports', count: 38, trend: 'Magento-ready feeds this week' }
];

export const flavorWheel = [
  { segment: 'Fruit', value: 4.5 },
  { segment: 'Floral', value: 1.8 },
  { segment: 'Spice', value: 3.1 },
  { segment: 'Earth', value: 2.4 },
  { segment: 'Oak', value: 3.6 }
];

export const productLibraryStats = [
  { label: 'Wines', value: 7624 },
  { label: 'Spirits', value: 1904 },
  { label: 'RTD / Mixers', value: 954 }
];

export const samplePairing: PairingProfile = {
  protein: ['Prime rib', 'Aged gouda', 'Portobello mushroom'],
  cuisine: ['Steakhouse', 'Tuscan', 'Modern American'],
  dishes: ['Rosemary braised short ribs', 'Truffle mushroom risotto', 'Peppercorn striploin'],
  logic: 'High tannin and elevated body bind to protein-rich dishes while oak-derived spice reinforces roasted and umami-driven preparations.'
};

export const styleDNA = [
  { style: 'Structured & Oak-Aged', body: 4.7, acidity: 3.3, tannin: 4.5, sweetness: 0.4, intensity: 4.6 },
  { style: 'Crisp & Aromatic', body: 2.3, acidity: 4.8, tannin: 0.2, sweetness: 0.6, intensity: 3.9 },
  { style: 'Elegant & Earthy', body: 3.1, acidity: 4.0, tannin: 2.8, sweetness: 0.5, intensity: 3.4 },
  { style: 'Barrel Rested', body: 4.2, acidity: 2.4, tannin: 0.5, sweetness: 0.8, intensity: 4.1 }
];

export const grapeDNA = [
  { grape: 'Cabernet Sauvignon', body: 4.8, acidity: 3.1, tannin: 4.7, fruitProfile: 3.8 },
  { grape: 'Sauvignon Blanc', body: 2.1, acidity: 4.9, tannin: 0.1, fruitProfile: 4.1 },
  { grape: 'Pinot Noir', body: 3.0, acidity: 4.2, tannin: 2.6, fruitProfile: 3.5 },
  { grape: 'Blue Weber Agave', body: 4.1, acidity: 1.2, tannin: 0.1, fruitProfile: 1.9 }
];

export const regionModifiers = [
  { region: 'Napa Valley', bodyMod: 0.4, acidityMod: -0.1, tanninMod: 0.2, intensityMod: 0.5 },
  { region: 'Marlborough', bodyMod: -0.2, acidityMod: 0.4, tanninMod: 0, intensityMod: 0.2 },
  { region: 'Willamette Valley', bodyMod: -0.1, acidityMod: 0.2, tanninMod: -0.2, intensityMod: 0.1 },
  { region: 'Jalisco Highlands', bodyMod: 0.3, acidityMod: 0.1, tanninMod: 0, intensityMod: 0.4 }
];

export const excelImportSteps = [
  'Download the CSV template and keep the header row unchanged.',
  'Paste or export your Excel data into the template columns.',
  'Normalize obvious duplicates such as cab sauv, marlboro, or lowercase currency values.',
  'Run the self-healing import preview to review auto-corrections and unresolved errors.',
  'Approve only rows with valid SKU plus acceptable confidence before database import/export.'
];

// Magento data is now served server-side via /api/import-rows to keep the client bundle small.
export const magentoImportRows: RawImportRow[] = [];

export const rawImportRows: RawImportRow[] = sampleRawImportRows;
