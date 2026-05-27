'use client';
import React, { useMemo } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip, PieChart, Pie, Cell,
} from 'recharts';
import {
  Beef, Fish, Milk, Salad, Cake, Grape, Shell, Egg, Wheat,
  AlertTriangle, Info, CheckCircle2, Clock,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type Product = Record<string, unknown>;
type CharDimension = { dimension_key: string; label: string; description: string };

// ── Shared helpers ───────────────────────────────────────────────────────────

function parseTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as string[]).filter(Boolean);
  try {
    const p = JSON.parse(raw as string);
    return Array.isArray(p) ? p.filter(Boolean) : [];
  } catch {
    // comma-separated fallback
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }
}

const TIER_SCALE: Record<string, number> = {
  low: 1, light: 1, medium: 2, high: 3, full: 3,
};
function scaleTier(v: string | null | undefined): number {
  if (!v) return 0;
  return TIER_SCALE[String(v).toLowerCase().trim()] ?? 2;
}

const DIMENSION_FIELD_MAP: Record<string, string> = {
  body: 'wine_body', acidity: 'wine_acidity', tannin: 'wine_tannin',
  sweetness: 'wine_sweetness', alcohol: 'alcohol', intensity: 'wine_intensity',
  complexity: 'wine_complexity', finish: 'wine_finish', smoke: 'spirit_smoke',
  spice: 'spirit_spice', oak: 'spirit_oak', fruit: 'spirit_fruit',
  umami: 'sake_umami', fragrance: 'sake_fragrance',
};

function dimensionValue(product: Product, dimKey: string): number {
  const field = DIMENSION_FIELD_MAP[dimKey];
  if (field && product[field] != null) {
    const num = parseFloat(String(product[field]));
    if (!isNaN(num)) return Math.min(num, 5);
    return scaleTier(String(product[field]));
  }
  if (product[dimKey] != null) {
    const num = parseFloat(String(product[dimKey]));
    if (!isNaN(num)) return Math.min(num, 5);
    return scaleTier(String(product[dimKey]));
  }
  return 0;
}

// ── Flavor taxonomy ──────────────────────────────────────────────────────────

type FlavorCategory = 'Fruit' | 'Floral' | 'Spice' | 'Earth' | 'Wood' | 'Herbal' | 'Other';
type FlavorSubcat = string;

interface FlavorMapping {
  category: FlavorCategory;
  subcategory: FlavorSubcat;
}

const FLAVOR_TAXONOMY: Record<string, FlavorMapping> = {
  // Fruit > Citrus
  lemon:       { category: 'Fruit', subcategory: 'Citrus' },
  lime:        { category: 'Fruit', subcategory: 'Citrus' },
  orange:      { category: 'Fruit', subcategory: 'Citrus' },
  grapefruit:  { category: 'Fruit', subcategory: 'Citrus' },
  tangerine:   { category: 'Fruit', subcategory: 'Citrus' },
  citrus:      { category: 'Fruit', subcategory: 'Citrus' },
  yuzu:        { category: 'Fruit', subcategory: 'Citrus' },
  // Fruit > Tropical
  mango:       { category: 'Fruit', subcategory: 'Tropical' },
  pineapple:   { category: 'Fruit', subcategory: 'Tropical' },
  passionfruit:{ category: 'Fruit', subcategory: 'Tropical' },
  guava:       { category: 'Fruit', subcategory: 'Tropical' },
  papaya:      { category: 'Fruit', subcategory: 'Tropical' },
  tropical:    { category: 'Fruit', subcategory: 'Tropical' },
  lychee:      { category: 'Fruit', subcategory: 'Tropical' },
  coconut:     { category: 'Fruit', subcategory: 'Tropical' },
  banana:      { category: 'Fruit', subcategory: 'Tropical' },
  // Fruit > Stone
  peach:       { category: 'Fruit', subcategory: 'Stone Fruit' },
  apricot:     { category: 'Fruit', subcategory: 'Stone Fruit' },
  nectarine:   { category: 'Fruit', subcategory: 'Stone Fruit' },
  plum:        { category: 'Fruit', subcategory: 'Stone Fruit' },
  cherry:      { category: 'Fruit', subcategory: 'Stone Fruit' },
  // Fruit > Berry
  blackberry:  { category: 'Fruit', subcategory: 'Dark Berry' },
  blueberry:   { category: 'Fruit', subcategory: 'Dark Berry' },
  blackcurrant:{ category: 'Fruit', subcategory: 'Dark Berry' },
  cassis:      { category: 'Fruit', subcategory: 'Dark Berry' },
  raspberry:   { category: 'Fruit', subcategory: 'Red Berry' },
  strawberry:  { category: 'Fruit', subcategory: 'Red Berry' },
  cranberry:   { category: 'Fruit', subcategory: 'Red Berry' },
  redcurrant:  { category: 'Fruit', subcategory: 'Red Berry' },
  berry:       { category: 'Fruit', subcategory: 'Red Berry' },
  // Fruit > Dried
  raisin:      { category: 'Fruit', subcategory: 'Dried Fruit' },
  fig:         { category: 'Fruit', subcategory: 'Dried Fruit' },
  prune:       { category: 'Fruit', subcategory: 'Dried Fruit' },
  date:        { category: 'Fruit', subcategory: 'Dried Fruit' },
  // Fruit > Other
  apple:       { category: 'Fruit', subcategory: 'Orchard' },
  pear:        { category: 'Fruit', subcategory: 'Orchard' },
  quince:      { category: 'Fruit', subcategory: 'Orchard' },
  melon:       { category: 'Fruit', subcategory: 'Melon' },
  watermelon:  { category: 'Fruit', subcategory: 'Melon' },
  // Floral
  rose:        { category: 'Floral', subcategory: 'Rose' },
  violet:      { category: 'Floral', subcategory: 'Violet' },
  jasmine:     { category: 'Floral', subcategory: 'Jasmine' },
  lavender:    { category: 'Floral', subcategory: 'Lavender' },
  blossom:     { category: 'Floral', subcategory: 'Blossom' },
  flower:      { category: 'Floral', subcategory: 'Floral' },
  floral:      { category: 'Floral', subcategory: 'Floral' },
  elderflower: { category: 'Floral', subcategory: 'Elderflower' },
  honeysuckle: { category: 'Floral', subcategory: 'Honeysuckle' },
  acacia:      { category: 'Floral', subcategory: 'Acacia' },
  // Spice
  pepper:      { category: 'Spice', subcategory: 'Pepper' },
  cinnamon:    { category: 'Spice', subcategory: 'Cinnamon' },
  clove:       { category: 'Spice', subcategory: 'Clove' },
  vanilla:     { category: 'Spice', subcategory: 'Vanilla' },
  nutmeg:      { category: 'Spice', subcategory: 'Nutmeg' },
  ginger:      { category: 'Spice', subcategory: 'Ginger' },
  anise:       { category: 'Spice', subcategory: 'Anise' },
  licorice:    { category: 'Spice', subcategory: 'Licorice' },
  cardamom:    { category: 'Spice', subcategory: 'Cardamom' },
  saffron:     { category: 'Spice', subcategory: 'Saffron' },
  spice:       { category: 'Spice', subcategory: 'Mixed Spice' },
  // Earth
  mushroom:    { category: 'Earth', subcategory: 'Mushroom' },
  truffle:     { category: 'Earth', subcategory: 'Truffle' },
  leather:     { category: 'Earth', subcategory: 'Leather' },
  tobacco:     { category: 'Earth', subcategory: 'Tobacco' },
  earth:       { category: 'Earth', subcategory: 'Earth' },
  soil:        { category: 'Earth', subcategory: 'Soil' },
  forest:      { category: 'Earth', subcategory: 'Forest Floor' },
  clay:        { category: 'Earth', subcategory: 'Clay' },
  wet:         { category: 'Earth', subcategory: 'Petrichor' },
  // Wood
  oak:         { category: 'Wood', subcategory: 'Oak' },
  cedar:       { category: 'Wood', subcategory: 'Cedar' },
  smoke:       { category: 'Wood', subcategory: 'Smoke' },
  smoky:       { category: 'Wood', subcategory: 'Smoke' },
  toast:       { category: 'Wood', subcategory: 'Toast' },
  char:        { category: 'Wood', subcategory: 'Char' },
  wood:        { category: 'Wood', subcategory: 'Wood' },
  sandalwood:  { category: 'Wood', subcategory: 'Sandalwood' },
  pine:        { category: 'Wood', subcategory: 'Pine' },
  // Herbal
  mint:        { category: 'Herbal', subcategory: 'Mint' },
  thyme:       { category: 'Herbal', subcategory: 'Thyme' },
  eucalyptus:  { category: 'Herbal', subcategory: 'Eucalyptus' },
  basil:       { category: 'Herbal', subcategory: 'Basil' },
  sage:        { category: 'Herbal', subcategory: 'Sage' },
  rosemary:    { category: 'Herbal', subcategory: 'Rosemary' },
  herb:        { category: 'Herbal', subcategory: 'Herbal' },
  herbal:      { category: 'Herbal', subcategory: 'Herbal' },
  grass:       { category: 'Herbal', subcategory: 'Grass' },
  green:       { category: 'Herbal', subcategory: 'Green' },
  tea:         { category: 'Herbal', subcategory: 'Tea' },
  // Other
  mineral:     { category: 'Other', subcategory: 'Mineral' },
  chalk:       { category: 'Other', subcategory: 'Mineral' },
  flint:       { category: 'Other', subcategory: 'Mineral' },
  slate:       { category: 'Other', subcategory: 'Mineral' },
  honey:       { category: 'Other', subcategory: 'Honey' },
  butter:      { category: 'Other', subcategory: 'Dairy' },
  cream:       { category: 'Other', subcategory: 'Dairy' },
  caramel:     { category: 'Other', subcategory: 'Confection' },
  chocolate:   { category: 'Other', subcategory: 'Confection' },
  coffee:      { category: 'Other', subcategory: 'Roasted' },
  toffee:      { category: 'Other', subcategory: 'Confection' },
  biscuit:     { category: 'Other', subcategory: 'Baked' },
  brioche:     { category: 'Other', subcategory: 'Baked' },
  bread:       { category: 'Other', subcategory: 'Baked' },
  yeast:       { category: 'Other', subcategory: 'Baked' },
  almond:      { category: 'Other', subcategory: 'Nut' },
  hazelnut:    { category: 'Other', subcategory: 'Nut' },
  walnut:      { category: 'Other', subcategory: 'Nut' },
  marzipan:    { category: 'Other', subcategory: 'Nut' },
};

const CATEGORY_COLORS: Record<FlavorCategory | string, string> = {
  Fruit:  '#e879a0',
  Floral: '#c084fc',
  Spice:  '#f59e0b',
  Earth:  '#a1887f',
  Wood:   '#d97706',
  Herbal: '#34d399',
  Other:  '#94a3b8',
};

const CATEGORY_COLORS_OUTER: Record<FlavorCategory | string, string> = {
  Fruit:  '#f472b6',
  Floral: '#d8b4fe',
  Spice:  '#fbbf24',
  Earth:  '#bcaaa4',
  Wood:   '#fb923c',
  Herbal: '#6ee7b7',
  Other:  '#cbd5e1',
};

function classifyFlavor(tag: string): FlavorMapping {
  const s = tag.toLowerCase().trim();
  if (FLAVOR_TAXONOMY[s]) return FLAVOR_TAXONOMY[s];
  for (const [key, mapping] of Object.entries(FLAVOR_TAXONOMY)) {
    if (s.includes(key) || key.includes(s)) return mapping;
  }
  return { category: 'Other', subcategory: tag };
}

// ── Scope detection ──────────────────────────────────────────────────────────

function detectScope(product: Product): 'wine' | 'spirits' | 'sake' | 'other' {
  const cls = String(product.classification ?? '').toLowerCase();
  if (cls.includes('sake')) return 'sake';
  if (cls.includes('wine') || cls.includes('champagne') || cls.includes('rose') || cls.includes('prosecco') || cls.includes('cava')) return 'wine';
  if (cls.includes('whisky') || cls.includes('whiskey') || cls.includes('gin') || cls.includes('rum') ||
      cls.includes('vodka') || cls.includes('tequila') || cls.includes('mezcal') || cls.includes('brandy') ||
      cls.includes('cognac') || cls.includes('bourbon') || cls.includes('scotch') || cls.includes('spirit') ||
      cls.includes('liqueur')) return 'spirits';
  return 'other';
}

// ── Derive character values from flavor tags + description ───────────────────

function deriveDimensionFromFlavors(product: Product, dimKey: string): number {
  const tags = parseTags(product.flavor_tags as string).map(t => t.toLowerCase());
  const desc = String(product.desc_en_short ?? product.desc_en_full ?? '').toLowerCase();
  const all = [...tags, desc];
  const allText = all.join(' ');

  switch (dimKey) {
    case 'sweetness': {
      const sweetIndicators = ['sweet', 'honey', 'sugar', 'caramel', 'toffee', 'jam', 'ripe', 'luscious', 'rich fruit', 'dessert', 'residual'];
      const dryIndicators = ['dry', 'brut', 'crisp', 'austere', 'tart', 'mineral'];
      const sweetCount = sweetIndicators.filter(w => allText.includes(w)).length;
      const dryCount = dryIndicators.filter(w => allText.includes(w)).length;
      if (sweetCount === 0 && dryCount === 0) return 0;
      return Math.min(5, Math.max(1, 1 + sweetCount - dryCount));
    }
    case 'intensity': {
      const intenseWords = ['intense', 'bold', 'powerful', 'concentrated', 'full', 'robust', 'rich', 'deep', 'strong'];
      const lightWords = ['light', 'delicate', 'subtle', 'elegant', 'gentle', 'faint'];
      const iCount = intenseWords.filter(w => allText.includes(w)).length;
      const lCount = lightWords.filter(w => allText.includes(w)).length;
      if (iCount === 0 && lCount === 0) return 0;
      return Math.min(5, Math.max(1, 2 + iCount - lCount));
    }
    case 'complexity': {
      const uniqueCats = new Set(tags.map(t => classifyFlavor(t).category));
      if (tags.length === 0) return 0;
      const complexWords = ['complex', 'layered', 'nuanced', 'intricate', 'multifaceted'];
      const bonus = complexWords.filter(w => allText.includes(w)).length;
      return Math.min(5, Math.max(1, uniqueCats.size + bonus - 1));
    }
    case 'finish': {
      const longFinish = ['long finish', 'lingering', 'persistent', 'endless', 'lasting'];
      const shortFinish = ['short', 'quick', 'abrupt', 'brief'];
      const lCount = longFinish.filter(w => allText.includes(w)).length;
      const sCount = shortFinish.filter(w => allText.includes(w)).length;
      if (lCount === 0 && sCount === 0) return 0;
      return Math.min(5, Math.max(1, 2 + lCount - sCount));
    }
    case 'smoke': {
      const smokeWords = ['smoke', 'smoky', 'peat', 'peaty', 'bonfire', 'campfire', 'charred', 'ash'];
      const count = smokeWords.filter(w => allText.includes(w)).length;
      return count === 0 ? 0 : Math.min(5, 1 + count);
    }
    case 'spice': {
      const spiceWords = ['pepper', 'spice', 'spicy', 'cinnamon', 'clove', 'ginger', 'nutmeg', 'cardamom', 'anise'];
      const count = spiceWords.filter(w => allText.includes(w)).length;
      return count === 0 ? 0 : Math.min(5, 1 + count);
    }
    case 'oak': {
      const oakWords = ['oak', 'oaked', 'barrel', 'wood', 'cedar', 'toast', 'charred', 'cask'];
      const count = oakWords.filter(w => allText.includes(w)).length;
      return count === 0 ? 0 : Math.min(5, 1 + count);
    }
    case 'fruit': {
      const fruitTags = tags.filter(t => classifyFlavor(t).category === 'Fruit');
      return fruitTags.length === 0 ? 0 : Math.min(5, 1 + fruitTags.length);
    }
    case 'umami': {
      const umamiWords = ['umami', 'savory', 'savoury', 'broth', 'soy', 'miso', 'koji', 'rich'];
      const count = umamiWords.filter(w => allText.includes(w)).length;
      return count === 0 ? 0 : Math.min(5, 1 + count);
    }
    case 'fragrance': {
      const fragWords = ['fragrant', 'aromatic', 'perfumed', 'floral', 'blossom', 'nose', 'bouquet'];
      const count = fragWords.filter(w => allText.includes(w)).length;
      return count === 0 ? 0 : Math.min(5, 1 + count);
    }
    default:
      return 0;
  }
}

function getCharacterValue(product: Product, dimKey: string): number {
  const explicit = dimensionValue(product, dimKey);
  if (explicit > 0) return explicit;
  return deriveDimensionFromFlavors(product, dimKey);
}

// Default dimensions per scope when no charDimensions loaded
const DEFAULT_DIMENSIONS: Record<string, { dimension_key: string; label: string }[]> = {
  wine: [
    { dimension_key: 'body', label: 'Body' },
    { dimension_key: 'acidity', label: 'Acidity' },
    { dimension_key: 'tannin', label: 'Tannin' },
    { dimension_key: 'sweetness', label: 'Sweetness' },
    { dimension_key: 'intensity', label: 'Intensity' },
    { dimension_key: 'complexity', label: 'Complexity' },
  ],
  spirits: [
    { dimension_key: 'body', label: 'Body' },
    { dimension_key: 'sweetness', label: 'Sweetness' },
    { dimension_key: 'smoke', label: 'Smoke' },
    { dimension_key: 'spice', label: 'Spice' },
    { dimension_key: 'complexity', label: 'Complexity' },
    { dimension_key: 'finish', label: 'Finish' },
    { dimension_key: 'oak', label: 'Oak' },
    { dimension_key: 'fruit', label: 'Fruit' },
  ],
  sake: [
    { dimension_key: 'umami', label: 'Umami' },
    { dimension_key: 'sweetness', label: 'Sweetness' },
    { dimension_key: 'acidity', label: 'Acidity' },
    { dimension_key: 'body', label: 'Body' },
    { dimension_key: 'fragrance', label: 'Fragrance' },
    { dimension_key: 'finish', label: 'Finish' },
  ],
  other: [
    { dimension_key: 'body', label: 'Body' },
    { dimension_key: 'sweetness', label: 'Sweetness' },
    { dimension_key: 'complexity', label: 'Complexity' },
    { dimension_key: 'intensity', label: 'Intensity' },
  ],
};

// ══════════════════════════════════════════════════════════════════════════════
// 1. CharacterRadarChart
// ══════════════════════════════════════════════════════════════════════════════

export function CharacterRadarChart({
  product,
  charDimensions = [],
}: {
  product: Product;
  charDimensions?: CharDimension[];
}) {
  const scope = detectScope(product);

  const radarData = useMemo(() => {
    const dims = charDimensions.length > 0
      ? charDimensions.map(d => ({ dimension_key: d.dimension_key, label: d.label }))
      : DEFAULT_DIMENSIONS[scope] ?? DEFAULT_DIMENSIONS.other;

    return dims
      .map(d => ({
        dimension: d.label,
        value: getCharacterValue(product, d.dimension_key),
        fullMark: 5,
      }))
      .filter(d => d.value > 0);
  }, [product, charDimensions, scope]);

  // Scope accent colors — vivid enough to read on dark bg
  const scopeColors: Record<string, { stroke: string; fill: string; dot: string }> = {
    wine:    { stroke: 'rgba(251,113,133,1)',   fill: 'rgba(251,113,133,0.18)', dot: '#fb7185' },
    spirits: { stroke: 'rgba(251,191,36,1)',    fill: 'rgba(251,191,36,0.18)',  dot: '#fbbf24' },
    sake:    { stroke: 'rgba(129,140,248,1)',   fill: 'rgba(129,140,248,0.18)', dot: '#818cf8' },
    other:   { stroke: 'rgba(167,139,250,1)',   fill: 'rgba(167,139,250,0.18)', dot: '#a78bfa' },
  };
  const accent = scopeColors[scope] ?? scopeColors.other;

  if (radarData.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <p className="text-sm text-slate-400 italic">No character data available yet</p>
      </div>
    );
  }

  if (radarData.length < 3) {
    // Bar fallback for < 3 points
    return (
      <div className="space-y-3 py-2">
        {radarData.map(d => (
          <div key={d.dimension} className="flex items-center gap-3">
            <span className="text-xs text-slate-300 w-24 shrink-0 text-right font-medium">{d.dimension}</span>
            <div className="flex-1 h-2.5 bg-white/[0.08] rounded-full overflow-hidden">
              <div
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: `${(d.value / 5) * 100}%`,
                  background: `linear-gradient(90deg, ${accent.fill.replace('0.18', '0.6')}, ${accent.stroke})`,
                }}
              />
            </div>
            <span className="text-xs text-slate-300 w-8 text-right font-mono tabular-nums">{d.value.toFixed(1)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      {/* Radar chart */}
      <div className="w-[280px] h-[240px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="68%" data={radarData}>
            <PolarGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: 'rgba(226,232,240,0.85)', fontSize: 11, fontWeight: 500 }}
              tickLine={false}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 5]}
              tick={false}
              axisLine={false}
            />
            <Radar
              name="Profile"
              dataKey="value"
              stroke={accent.stroke}
              fill={accent.fill}
              strokeWidth={2}
              dot={{ r: 3.5, fill: accent.dot, strokeWidth: 0 }}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(15,23,42,0.97)',
                border: `1px solid ${accent.stroke}40`,
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
              formatter={(value: number, name: string) => [`${value.toFixed(1)} / 5`, name]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Bar legend */}
      <div className="flex-1 space-y-2.5 min-w-0 w-full sm:w-auto">
        {radarData.map(d => (
          <div key={d.dimension} className="flex items-center gap-3">
            <span className="text-xs text-slate-300 w-20 shrink-0 font-medium">{d.dimension}</span>
            <div className="flex-1 flex gap-[3px]">
              {[1, 2, 3, 4, 5].map(dot => (
                <div
                  key={dot}
                  className="h-[7px] flex-1 rounded-sm transition-all"
                  style={{
                    background: d.value >= dot
                      ? accent.stroke
                      : 'rgba(255,255,255,0.08)',
                    opacity: d.value >= dot ? (dot <= Math.floor(d.value) ? 1 : 0.5) : 1,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-slate-300 w-8 text-right font-mono tabular-nums">
              {d.value.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. FlavorWheel
// ══════════════════════════════════════════════════════════════════════════════

export function FlavorWheel({ product }: { product: Product }) {
  const flavorTags = parseTags(product.flavor_tags as string);

  const { innerData, outerData } = useMemo(() => {
    if (flavorTags.length === 0) return { innerData: [], outerData: [] };

    const classified = flavorTags.map(tag => ({
      tag,
      ...classifyFlavor(tag),
    }));

    const catGroups = new Map<string, { tags: string[]; subcats: Set<string> }>();
    for (const c of classified) {
      if (!catGroups.has(c.category)) catGroups.set(c.category, { tags: [], subcats: new Set() });
      const g = catGroups.get(c.category)!;
      g.tags.push(c.tag);
      g.subcats.add(c.subcategory);
    }

    const inner = Array.from(catGroups.entries()).map(([cat, g]) => ({
      name: cat,
      value: g.tags.length,
      fill: CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Other,
    }));

    const outer = classified.map(c => ({
      name: c.tag,
      value: 1,
      category: c.category,
      fill: CATEGORY_COLORS_OUTER[c.category] ?? CATEGORY_COLORS_OUTER.Other,
    }));

    const catOrder = inner.map(d => d.name);
    outer.sort((a, b) => catOrder.indexOf(a.category) - catOrder.indexOf(b.category));

    return { innerData: inner, outerData: outer };
  }, [flavorTags]);

  if (flavorTags.length === 0) return null;

  // For many tags, show chip list instead of wheel (wheel labels become unreadable)
  if (flavorTags.length > 14) {
    return (
      <div>
        {/* Category summary badges */}
        <div className="flex flex-wrap gap-2 mb-3">
          {innerData.map(d => (
            <span
              key={d.name}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{
                background: `${d.fill}22`,
                color: d.fill,
                border: `1px solid ${d.fill}50`,
              }}
            >
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: d.fill }} />
              {d.name} · {d.value}
            </span>
          ))}
        </div>
        {/* Flavor chips */}
        <div className="flex flex-wrap gap-1.5">
          {flavorTags.map(tag => {
            const mapping = classifyFlavor(tag);
            const color = CATEGORY_COLORS_OUTER[mapping.category] ?? '#94a3b8';
            return (
              <span
                key={tag}
                className="px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
                style={{
                  background: `${color}20`,
                  color: color,
                  border: `1px solid ${color}45`,
                }}
              >
                {tag}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-[280px] h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* Inner ring: categories */}
            <Pie
              data={innerData}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={38}
              outerRadius={68}
              paddingAngle={2}
              strokeWidth={0}
            >
              {innerData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} opacity={0.9} />
              ))}
            </Pie>
            {/* Outer ring: individual flavors */}
            <Pie
              data={outerData}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={73}
              outerRadius={108}
              paddingAngle={1}
              strokeWidth={0}
              label={({ name, cx: cxVal, cy: cyVal, midAngle, outerRadius: outerR }) => {
                if (outerData.length > 10) return null;
                const RADIAN = Math.PI / 180;
                const radius = (outerR as number) + 16;
                const x = (cxVal as number) + radius * Math.cos(-midAngle * RADIAN);
                const y = (cyVal as number) + radius * Math.sin(-midAngle * RADIAN);
                return (
                  <text
                    x={x} y={y}
                    fill="rgba(203,213,225,0.9)"
                    textAnchor={x > (cxVal as number) ? 'start' : 'end'}
                    dominantBaseline="central"
                    fontSize={10}
                    fontWeight={500}
                  >
                    {name}
                  </text>
                );
              }}
            >
              {outerData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} opacity={0.8} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'rgba(15,23,42,0.97)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
              formatter={(value: number, name: string) => [name, '']}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {innerData.map(d => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.fill }} />
            <span className="text-xs text-slate-300 font-medium">{d.name}</span>
            <span className="text-xs text-slate-500">({d.value})</span>
          </div>
        ))}
      </div>

      {/* Raw tags */}
      <div className="flex flex-wrap justify-center gap-1.5 w-full">
        {flavorTags.map(tag => {
          const mapping = classifyFlavor(tag);
          const color = CATEGORY_COLORS_OUTER[mapping.category] ?? '#94a3b8';
          return (
            <span
              key={tag}
              className="px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
              style={{
                background: `${color}20`,
                color: color,
                border: `1px solid ${color}45`,
              }}
            >
              {tag}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. BodySweetnessMatrix
// ══════════════════════════════════════════════════════════════════════════════

export function BodySweetnessMatrix({ product }: { product: Product }) {
  const scope = detectScope(product);
  const isSpirit = scope === 'spirits';

  const body = getCharacterValue(product, 'body');
  const smokeVal = getCharacterValue(product, 'smoke');
  const sweetnessVal = getCharacterValue(product, 'sweetness');

  const yVal = isSpirit ? (smokeVal > 0 ? smokeVal : sweetnessVal) : sweetnessVal;
  const yLabel = isSpirit ? (smokeVal > 0 ? 'Smoke' : 'Sweetness') : 'Sweetness';

  if (body === 0 && yVal === 0) {
    return (
      <div className="flex items-center justify-center py-4">
        <p className="text-sm text-slate-400 italic">No style data available yet</p>
      </div>
    );
  }

  const xPct = Math.max(8, Math.min(92, (body / 5) * 100));
  const yPct = Math.max(8, Math.min(92, 100 - (yVal / 5) * 100));

  const quadrants = isSpirit
    ? [
        { label: 'Light & Mild',    pos: 'bottom-left'  },
        { label: 'Full & Mild',     pos: 'bottom-right' },
        { label: 'Light & Intense', pos: 'top-left'     },
        { label: 'Full & Intense',  pos: 'top-right'    },
      ]
    : [
        { label: 'Light & Dry',   pos: 'bottom-left'  },
        { label: 'Full & Dry',    pos: 'bottom-right' },
        { label: 'Light & Sweet', pos: 'top-left'     },
        { label: 'Full & Sweet',  pos: 'top-right'    },
      ];

  // Determine which quadrant the dot is in
  const inRight = xPct > 50;
  const inTop   = yPct < 50;
  const activeQ = inTop
    ? (inRight ? 'top-right' : 'top-left')
    : (inRight ? 'bottom-right' : 'bottom-left');

  return (
    <div>
      <div className="relative w-full aspect-square max-w-[260px] mx-auto rounded-xl overflow-hidden border border-white/10 bg-slate-900/50">

        {/* Quadrant backgrounds — subtle tint on active quadrant */}
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 pointer-events-none">
          {quadrants.map(q => (
            <div
              key={q.pos}
              className="transition-all"
              style={{
                background: activeQ === q.pos
                  ? 'rgba(167,139,250,0.08)'
                  : 'transparent',
              }}
            />
          ))}
        </div>

        {/* Grid lines */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10 pointer-events-none" />
        <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10 pointer-events-none" />

        {/* Quadrant labels — readable contrast */}
        {quadrants.map(q => {
          const isActive = activeQ === q.pos;
          const [vert, horiz] = q.pos.split('-') as ['top' | 'bottom', 'left' | 'right'];
          return (
            <span
              key={q.pos}
              className={`absolute text-[10px] font-medium leading-tight max-w-[70px] text-center transition-colors pointer-events-none ${
                isActive ? 'text-violet-300' : 'text-slate-500'
              }`}
              style={{
                [vert]: '8px',
                [horiz]: '8px',
                textAlign: horiz === 'left' ? 'left' : 'right',
              }}
            >
              {q.label}
            </span>
          );
        })}

        {/* Crosshair lines from dot */}
        <div
          className="absolute top-0 bottom-0 w-px pointer-events-none"
          style={{ left: `${xPct}%`, background: 'rgba(167,139,250,0.2)' }}
        />
        <div
          className="absolute left-0 right-0 h-px pointer-events-none"
          style={{ top: `${yPct}%`, background: 'rgba(167,139,250,0.2)' }}
        />

        {/* Product dot */}
        <div
          className="absolute w-5 h-5 rounded-full shadow-lg"
          style={{
            left: `${xPct}%`,
            top:  `${yPct}%`,
            transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(circle at 35% 35%, rgba(196,181,253,1) 0%, rgba(139,92,246,1) 100%)',
            boxShadow: '0 0 0 3px rgba(139,92,246,0.25), 0 0 12px rgba(139,92,246,0.5)',
          }}
        />

        {/* Axis labels */}
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-slate-400 font-medium pointer-events-none select-none">
          ← Light &nbsp; Body &nbsp; Full →
        </span>
        <span
          className="absolute left-2 top-1/2 text-[10px] text-slate-400 font-medium pointer-events-none select-none"
          style={{ writingMode: 'vertical-rl', transform: 'translateY(-50%) rotate(180deg)' }}
        >
          ← Low &nbsp;{yLabel}&nbsp; High →
        </span>
      </div>

      {/* Values below */}
      <div className="flex justify-center gap-6 mt-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Body</span>
          <span className="text-xs font-semibold text-slate-200 tabular-nums">{body.toFixed(1)}<span className="text-slate-500">/5</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">{yLabel}</span>
          <span className="text-xs font-semibold text-slate-200 tabular-nums">{yVal.toFixed(1)}<span className="text-slate-500">/5</span></span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. FoodPairingGrid
// ══════════════════════════════════════════════════════════════════════════════

const FOOD_CATEGORIES: { key: string; label: string; keywords: string[]; icon: React.ElementType }[] = [
  { key: 'meat',      label: 'Meat',          keywords: ['meat', 'beef', 'lamb', 'pork', 'steak', 'veal', 'game', 'venison', 'duck', 'bbq', 'grill', 'roast'], icon: Beef },
  { key: 'poultry',   label: 'Poultry',       keywords: ['poultry', 'chicken', 'turkey', 'fowl', 'quail'], icon: Egg },
  { key: 'seafood',   label: 'Seafood',        keywords: ['seafood', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'lobster', 'crab', 'oyster', 'shellfish', 'sushi', 'sashimi', 'scallop'], icon: Fish },
  { key: 'cheese',    label: 'Cheese',        keywords: ['cheese', 'brie', 'camembert', 'gouda', 'cheddar', 'parmesan', 'blue cheese', 'goat cheese', 'manchego'], icon: Milk },
  { key: 'vegetable', label: 'Vegetables',    keywords: ['vegetable', 'salad', 'mushroom', 'truffle', 'asparagus', 'artichoke', 'vegetarian', 'vegan'], icon: Salad },
  { key: 'pasta',     label: 'Pasta & Grain', keywords: ['pasta', 'rice', 'risotto', 'noodle', 'pizza', 'bread', 'grain'], icon: Wheat },
  { key: 'dessert',   label: 'Dessert',       keywords: ['dessert', 'chocolate', 'cake', 'pastry', 'fruit', 'tart', 'pie', 'sweet', 'ice cream', 'pudding'], icon: Cake },
  { key: 'appetizer', label: 'Appetizer',     keywords: ['appetizer', 'charcuterie', 'tapas', 'antipasto', 'snack', 'nuts', 'olives', 'bruschetta'], icon: Grape },
  { key: 'asian',     label: 'Asian',         keywords: ['asian', 'thai', 'japanese', 'chinese', 'korean', 'indian', 'curry', 'spicy', 'stir-fry', 'dim sum', 'pad thai', 'ramen'], icon: Shell },
];

export function FoodPairingGrid({ product }: { product: Product }) {
  const foodTags = parseTags(product.food_matching as string);

  const matchedCategories = useMemo(() => {
    if (foodTags.length === 0) return new Set<string>();
    const matched = new Set<string>();
    const allText = foodTags.map(t => t.toLowerCase()).join(' ');
    for (const cat of FOOD_CATEGORIES) {
      if (cat.keywords.some(kw => allText.includes(kw))) {
        matched.add(cat.key);
      }
    }
    return matched;
  }, [foodTags]);

  if (foodTags.length === 0) return null;

  return (
    <div>
      {/* Icon grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {FOOD_CATEGORIES.map(cat => {
          const isMatched = matchedCategories.has(cat.key);
          const Icon = cat.icon;
          return (
            <div
              key={cat.key}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                isMatched
                  ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-300'
                  : 'bg-white/[0.02] border-white/[0.06] text-slate-500'
              }`}
            >
              <Icon size={18} strokeWidth={1.5} />
              <span className={`text-[10px] font-medium leading-tight text-center ${isMatched ? 'text-emerald-300' : 'text-slate-500'}`}>
                {cat.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Raw pairing tags */}
      <div className="flex flex-wrap gap-1.5">
        {foodTags.map(t => (
          <span
            key={t}
            className="px-2.5 py-0.5 rounded-full text-xs font-medium capitalize bg-emerald-500/12 text-emerald-300 border border-emerald-500/25"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. DataQualityGauge
// ══════════════════════════════════════════════════════════════════════════════

const QUALITY_FIELDS = [
  { key: 'classification', label: 'Item Category', weight: 2 },
  { key: 'country',        label: 'Country',       weight: 2 },
  { key: 'region',         label: 'Region',        weight: 1 },
  { key: 'grape_variety',  label: 'Grape',         weight: 1 },
  { key: 'vintage',        label: 'Vintage',       weight: 1 },
  { key: 'wine_body',      label: 'Body',          weight: 1 },
  { key: 'wine_acidity',   label: 'Acidity',       weight: 1 },
  { key: 'flavor_tags',    label: 'Flavors',       weight: 2 },
  { key: 'food_matching',  label: 'Pairing',       weight: 1 },
  { key: 'desc_en_short',  label: 'Short Desc',    weight: 1 },
  { key: 'desc_en_full',   label: 'Full Desc',     weight: 1 },
  { key: 'price',          label: 'Price',         weight: 2 },
];

export function DataQualityGauge({ product }: { product: Product }) {
  const conf = parseFloat(String(product.overall_confidence ?? 0));
  const pct = Math.round(conf * 100);

  const fieldStatus = useMemo(() => {
    return QUALITY_FIELDS.map(f => {
      const v = product[f.key];
      const filled = v !== null && v !== undefined && v !== '' && String(v).trim() !== '';
      return { ...f, filled };
    });
  }, [product]);

  const filledCount = fieldStatus.filter(f => f.filled).length;
  const totalCount  = fieldStatus.length;
  const completeness = Math.round((filledCount / totalCount) * 100);

  // Arc gauge
  const radius = 52;
  const strokeWidth = 9;
  const circumference = Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  const gaugeColor =
    pct >= 75 ? '#10b981' :
    pct >= 50 ? '#f59e0b' : '#ef4444';
  const gaugeLabel =
    pct >= 75 ? 'High' :
    pct >= 50 ? 'Medium' : 'Low';

  return (
    <div>
      {/* Arc gauge */}
      <div className="flex flex-col items-center mb-5">
        <div className="relative w-[150px] h-[86px]">
          <svg viewBox="0 0 150 86" className="w-full h-full overflow-visible">
            {/* Track */}
            <path
              d="M 14 80 A 57 57 0 0 1 136 80"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            {/* Value */}
            <path
              d="M 14 80 A 57 57 0 0 1 136 80"
              fill="none"
              stroke={gaugeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${circumference}`}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
            <span className="text-3xl font-bold leading-none tabular-nums" style={{ color: gaugeColor }}>{pct}%</span>
            <span className="text-[11px] font-semibold mt-0.5" style={{ color: gaugeColor }}>{gaugeLabel} confidence</span>
          </div>
        </div>
      </div>

      {/* Completeness bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-slate-400 font-medium">Field completeness</span>
          <span className="text-slate-300 font-semibold tabular-nums">{filledCount}/{totalCount} ({completeness}%)</span>
        </div>
        <div className="h-2 bg-white/[0.07] rounded-full overflow-hidden">
          <div
            className="h-2 rounded-full transition-all duration-700"
            style={{
              width: `${completeness}%`,
              background: `linear-gradient(90deg, ${gaugeColor}80, ${gaugeColor})`,
            }}
          />
        </div>
      </div>

      {/* Field status chips */}
      <div className="flex flex-wrap gap-1.5">
        {fieldStatus.map(f => (
          <span
            key={f.key}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${
              f.filled
                ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-300'
                : f.weight >= 2
                  ? 'bg-rose-500/12 border-rose-500/30 text-rose-300'
                  : 'bg-amber-500/12 border-amber-500/30 text-amber-300'
            }`}
          >
            {f.filled ? (
              <CheckCircle2 size={9} />
            ) : f.weight >= 2 ? (
              <AlertTriangle size={9} />
            ) : (
              <Info size={9} />
            )}
            {f.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. VintageTimeline
// ══════════════════════════════════════════════════════════════════════════════

export function VintageTimeline({ product }: { product: Product }) {
  const vintage = product.vintage ? parseInt(String(product.vintage), 10) : null;

  if (!vintage || isNaN(vintage)) return null;

  const currentYear = new Date().getFullYear();
  const age = currentYear - vintage;
  const rangeStart = Math.min(vintage - 3, currentYear - 8);
  const rangeEnd   = Math.max(vintage + 3, currentYear + 1);
  const years = Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i);

  return (
    <div>
      <div className="relative pt-3 pb-6">
        {/* Track */}
        <div className="h-px bg-white/[0.1] absolute top-[18px] left-0 right-0" />

        <div className="flex items-start justify-between relative">
          {years.map(year => {
            const isCurrent = year === vintage;
            const isNow     = year === currentYear;
            return (
              <div key={year} className="flex flex-col items-center relative">
                {/* Dot */}
                <div
                  className={`w-3 h-3 rounded-full border-2 transition-all ${
                    isCurrent
                      ? 'bg-violet-500 border-violet-300 shadow-lg shadow-violet-500/50 scale-125'
                      : isNow
                        ? 'bg-slate-400 border-slate-300'
                        : 'bg-transparent border-white/15'
                  }`}
                />
                {/* Year label */}
                <span
                  className={`text-[9px] mt-2 select-none ${
                    isCurrent
                      ? 'text-violet-300 font-bold'
                      : isNow
                        ? 'text-slate-300 font-semibold'
                        : 'text-slate-500'
                  }`}
                >
                  {year}
                </span>
                {/* Tags */}
                {isCurrent && (
                  <span className="text-[8px] text-violet-400 font-semibold mt-0.5 whitespace-nowrap">Vintage</span>
                )}
                {isNow && !isCurrent && (
                  <span className="text-[8px] text-slate-400 mt-0.5">Now</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Age line */}
      <div className="flex items-center gap-2 mt-1">
        <Clock size={11} className="text-slate-400 shrink-0" />
        <span className="text-xs text-slate-300 font-medium">
          {age} year{age !== 1 ? 's' : ''} old
        </span>
        {age >= 10 && (
          <span className="text-xs text-violet-400 font-semibold">· Aged</span>
        )}
        {age >= 20 && (
          <span className="text-xs text-amber-400 font-semibold">· Grand cru territory</span>
        )}
      </div>
    </div>
  );
}
