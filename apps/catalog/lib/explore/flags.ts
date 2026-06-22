/**
 * flagEmoji — map a country NAME (as used in the explore-map data / catalog) to
 * its flag emoji. A flag emoji is two Unicode Regional-Indicator letters derived
 * from the country's ISO-3166-1 alpha-2 code (e.g. "FR" → 🇫🇷).
 *
 * The explore map uses country NAMES as the source of truth (not ISO codes), so
 * we keep a name→ISO2 lookup for every country that appears in the catalogue. The
 * keys are matched case-insensitively and against a couple of common aliases
 * (e.g. "USA", "UK"). Unknown names return '' so the chip simply renders without a
 * flag rather than a tofu box — never a broken glyph.
 *
 * Sub-national "countries" in our data (England, Scotland) use their own regional
 * flags via the tag-sequence form when available, falling back to GB.
 */

// Country NAME (lowercased) → ISO-3166-1 alpha-2. Covers every country currently
// in data/explore-map-data.json's roll-up plus common aliases.
const NAME_TO_ISO2: Record<string, string> = {
  usa: 'US',
  'united states': 'US',
  'united states of america': 'US',
  spain: 'ES',
  argentina: 'AR',
  france: 'FR',
  germany: 'DE',
  italy: 'IT',
  'south africa': 'ZA',
  austria: 'AT',
  'new zealand': 'NZ',
  australia: 'AU',
  portugal: 'PT',
  chile: 'CL',
  thailand: 'TH',
  ireland: 'IE',
  mexico: 'MX',
  russia: 'RU',
  netherlands: 'NL',
  poland: 'PL',
  japan: 'JP',
  china: 'CN',
  indonesia: 'ID',
  iceland: 'IS',
  anguilla: 'AI',
  latvia: 'LV',
  uruguay: 'UY',
  belgium: 'BE',
  vietnam: 'VN',
  fiji: 'FJ',
  barbados: 'BB',
  nicaragua: 'NI',
  martinique: 'MQ',
  cuba: 'CU',
  taiwan: 'TW',
  canada: 'CA',
  brazil: 'BR',
  grenada: 'GD',
  peru: 'PE',
  greece: 'GR',
  sweden: 'SE',
  panama: 'PA',
  slovakia: 'SK',
  slovenia: 'SI',
  philippines: 'PH',
  venezuela: 'VE',
  'czech republic': 'CZ',
  czechia: 'CZ',
  norway: 'NO',
  'dominican republic': 'DO',
  lebanon: 'LB',
  hungary: 'HU',
  georgia: 'GE',
  colombia: 'CO',
  bermuda: 'BM',
  cambodia: 'KH',
  india: 'IN',
  denmark: 'DK',
  finland: 'FI',
  guyana: 'GY',
  monaco: 'MC',
  guatemala: 'GT',
  jamaica: 'JM',
  honduras: 'HN',
  malaysia: 'MY',
  singapore: 'SG',
  'south korea': 'KR',
  'trinidad & tobago': 'TT',
  'trinidad and tobago': 'TT',
  'united kingdom': 'GB',
  uk: 'GB',
};

// England / Scotland / Wales use Unicode flag TAG SEQUENCES (subdivision flags),
// which many platforms render; we keep them explicit rather than collapsing to GB.
const SUBDIVISION_FLAGS: Record<string, string> = {
  england: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  scotland: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  wales: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
};

/** ISO2 → flag via Regional Indicator Symbols (A=0x1F1E6). */
function iso2ToFlag(iso2: string): string {
  if (iso2.length !== 2) return '';
  const A = 0x1f1e6;
  const a = iso2.toUpperCase().charCodeAt(0) - 65;
  const b = iso2.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return '';
  return String.fromCodePoint(A + a) + String.fromCodePoint(A + b);
}

/** Country NAME → flag emoji, or '' when unknown (caller renders no flag). */
export function flagEmoji(countryName: string | null | undefined): string {
  if (!countryName) return '';
  const key = countryName.trim().toLowerCase();
  if (SUBDIVISION_FLAGS[key]) return SUBDIVISION_FLAGS[key];
  const iso2 = NAME_TO_ISO2[key];
  return iso2 ? iso2ToFlag(iso2) : '';
}
