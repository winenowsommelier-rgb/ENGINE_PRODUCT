export type TaxonomySheet = {
  name: string;
  purpose: string;
};

export type TaxonomyCountry = {
  id: number;
  name: string;
  iso: string;
};

export type TaxonomyAuditIssue = {
  severity: 'warning' | 'info';
  area: string;
  message: string;
  recommendation: string;
};

export const taxonomySheets: TaxonomySheet[] = [
  { name: 'countries', purpose: 'Canonical origin-country lookup with IDs and ISO codes.' },
  { name: 'regions', purpose: 'Primary regional taxonomy used for origin and merchandising filters.' },
  { name: 'subregions', purpose: 'Nested appellations or secondary location groupings.' },
  { name: 'Origin', purpose: 'Origin-facing mapping layer that should be aligned with regions/countries.' },
  { name: 'classification_master', purpose: 'Product classification and taxonomy control rules.' },
  { name: 'ingredient_master', purpose: 'Controlled ingredient vocabulary for products and blends.' },
  { name: 'flavor_note_master', purpose: 'Approved tasting-note vocabulary for enrichment and rendering.' },
  { name: 'category_render_config', purpose: 'UI/render configuration by product category.' },
  { name: 'expert_sources', purpose: 'External validation references and citation sources.' },
  { name: 'Magento item data', purpose: 'Commerce/export-oriented column mapping layer.' }
];

export const taxonomyCountries: TaxonomyCountry[] = [
  { id: 1, name: 'France', iso: 'FR' },
  { id: 2, name: 'Italy', iso: 'IT' },
  { id: 3, name: 'Spain', iso: 'ES' },
  { id: 4, name: 'Germany', iso: 'DE' },
  { id: 5, name: 'Portugal', iso: 'PT' },
  { id: 6, name: 'USA', iso: 'US' },
  { id: 7, name: 'Chile', iso: 'CL' },
  { id: 8, name: 'Argentina', iso: 'AR' },
  { id: 9, name: 'Australia', iso: 'AU' },
  { id: 10, name: 'New Zealand', iso: 'NZ' },
  { id: 11, name: 'South Africa', iso: 'ZA' },
  { id: 12, name: 'Austria', iso: 'AT' },
  { id: 13, name: 'Greece', iso: 'GR' },
  { id: 14, name: 'Hungary', iso: 'HU' },
  { id: 15, name: 'Canada', iso: 'CA' },
  { id: 16, name: 'Japan', iso: 'JP' },
  { id: 17, name: 'Mexico', iso: 'MX' },
  { id: 18, name: 'Scotland', iso: 'GB-SCT' },
  { id: 19, name: 'Ireland', iso: 'IE' },
  { id: 20, name: 'China', iso: 'CN' },
  { id: 21, name: 'England', iso: 'GB-ENG' },
  { id: 22, name: 'Brazil', iso: 'BR' },
  { id: 23, name: 'Uruguay', iso: 'UY' },
  { id: 24, name: 'Lebanon', iso: 'LB' },
  { id: 25, name: 'Israel', iso: 'IL' },
  { id: 26, name: 'Georgia', iso: 'GE' },
  { id: 27, name: 'Thailand', iso: 'TH' },
  { id: 28, name: 'Other (N/A)', iso: 'NA' }
];

export const taxonomyAuditIssues: TaxonomyAuditIssue[] = [
  {
    severity: 'warning',
    area: 'Tab naming',
    message: 'The workbook mixes snake_case tabs with human-readable names such as Origin and Magento item data.',
    recommendation: 'Standardize tab slugs, or add a sheet registry with stable machine keys and display labels.'
  },
  {
    severity: 'warning',
    area: 'Country row formatting',
    message: 'The visible countries tab renders the final entry as Other (N/A)NA, which suggests a missing delimiter between the label and ISO value.',
    recommendation: 'Normalize that record to name = Other (N/A) and iso = NA before importing.'
  },
  {
    severity: 'info',
    area: 'ISO strategy',
    message: 'Most country codes are ISO alpha-2, but Scotland and England use sub-national ISO forms (GB-SCT and GB-ENG).',
    recommendation: 'Keep an explicit geography level field so country and constituent-country records validate predictably.'
  }
];

export const knownRegionCountryMap: Record<string, string> = {
  'Napa Valley': 'USA',
  Marlborough: 'New Zealand',
  'Willamette Valley': 'USA',
  'Jalisco Highlands': 'Mexico'
};

export const knownRegionAliases: Record<string, string> = {
  napa: 'Napa Valley',
  'napa valley': 'Napa Valley',
  marlboro: 'Marlborough',
  marlborough: 'Marlborough',
  willamette: 'Willamette Valley',
  'willamette valley': 'Willamette Valley',
  jalisco: 'Jalisco Highlands',
  'jalisco highlands': 'Jalisco Highlands'
};

export const knownGrapeAliases: Record<string, string> = {
  'cab sauv': 'Cabernet Sauvignon',
  cabernet: 'Cabernet Sauvignon',
  'cabernet sauvignon': 'Cabernet Sauvignon',
  'sauv blanc': 'Sauvignon Blanc',
  'sauvignon blanc': 'Sauvignon Blanc',
  'pinot noir': 'Pinot Noir',
  agave: 'Blue Weber Agave',
  'blue weber agave': 'Blue Weber Agave'
};

export const knownStyleAliases: Record<string, string> = {
  'structured oak aged': 'Structured & Oak-Aged',
  'structured & oak-aged': 'Structured & Oak-Aged',
  'crisp aromatic': 'Crisp & Aromatic',
  'crisp & aromatic': 'Crisp & Aromatic',
  'elegant earthy': 'Elegant & Earthy',
  'elegant & earthy': 'Elegant & Earthy',
  'barrel rested': 'Barrel Rested'
};
