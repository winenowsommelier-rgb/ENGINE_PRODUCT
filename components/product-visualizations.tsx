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
  // Direct match
  if (FLAVOR_TAXONOMY[s]) return FLAVOR_TAXONOMY[s];
  // Partial match
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
      // More distinct flavors = more complex
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
  // First try the explicit product field
  const explicit = dimensionValue(product, dimKey);
  if (explicit > 0) return explicit;
  // Derive from flavor tags and descriptions
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

  if (radarData.length < 3) {
    if (radarData.length === 0) return null;
    // Show as horizontal bars for < 3 data points
    return (
      <div className="space-y-3">
        {radarData.map(d => (
          <div key={d.dimension} className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-24 shrink-0 text-right">{d.dimension}</span>
            <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${(d.value / 5) * 100}%`,
                  background: 'linear-gradient(90deg, rgba(139,92,246,0.6), rgba(139,92,246,1))',
                }}
              />
            </div>
            <span className="text-[11px] text-slate-500 w-6 text-right font-mono">{d.value.toFixed(1)}</span>
          </div>
        ))}
      </div>
    );
  }

  // Scope accent colors
  const scopeColors: Record<string, { stroke: string; fill: string }> = {
    wine:    { stroke: 'rgba(225,29,72,0.85)', fill: 'rgba(225,29,72,0.15)' },
    spirits: { stroke: 'rgba(245,158,11,0.85)', fill: 'rgba(245,158,11,0.15)' },
    sake:    { stroke: 'rgba(99,102,241,0.85)', fill: 'rgba(99,102,241,0.15)' },
    other:   { stroke: 'rgba(139,92,246,0.85)', fill: 'rgba(139,92,246,0.15)' },
  };
  const accent = scopeColors[scope] ?? scopeColors.other;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="w-[280px] h-[240px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="72%" data={radarData}>
            <PolarGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: 'rgba(148,163,184,0.9)', fontSize: 11, fontWeight: 500 }}
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
              dot={{ r: 3, fill: accent.stroke, strokeWidth: 0 }}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(15,23,42,0.95)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
              formatter={(value: number) => [value.toFixed(1), '']}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2 min-w-0">
        {radarData.map(d => (
          <div key={d.dimension} className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-20 shrink-0">{d.dimension}</span>
            <div className="flex-1 flex gap-[3px]">
              {[1, 2, 3, 4, 5].map(dot => (
                <div
                  key={dot}
                  className="h-[6px] flex-1 rounded-sm transition-colors"
                  style={{
                    background: d.value >= dot
                      ? accent.stroke
                      : 'rgba(255,255,255,0.06)',
                  }}
                />
              ))}
            </div>
            <span className="text-[11px] text-slate-500 w-6 text-right font-mono">
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

    // Classify each tag
    const classified = flavorTags.map(tag => ({
      tag,
      ...classifyFlavor(tag),
    }));

    // Group by category for inner ring
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

    // Outer ring: individual flavors grouped by category
    const outer = classified.map(c => ({
      name: c.tag,
      value: 1,
      category: c.category,
      fill: CATEGORY_COLORS_OUTER[c.category] ?? CATEGORY_COLORS_OUTER.Other,
    }));

    // Sort both rings so categories align
    const catOrder = inner.map(d => d.name);
    outer.sort((a, b) => {
      const ai = catOrder.indexOf(a.category);
      const bi = catOrder.indexOf(b.category);
      return ai - bi;
    });

    return { innerData: inner, outerData: outer };
  }, [flavorTags]);

  if (flavorTags.length === 0) return null;

  return (
    <div className="flex flex-col items-center">
      <div className="w-[280px] h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* Inner ring: categories */}
            <Pie
              data={innerData}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
              strokeWidth={0}
            >
              {innerData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} opacity={0.85} />
              ))}
            </Pie>
            {/* Outer ring: individual flavors */}
            <Pie
              data={outerData}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={75}
              outerRadius={110}
              paddingAngle={1}
              strokeWidth={0}
              label={({ name, cx: cxVal, cy: cyVal, midAngle, outerRadius: outerR }) => {
                if (outerData.length > 12) return null;
                const RADIAN = Math.PI / 180;
                const radius = (outerR as number) + 14;
                const x = (cxVal as number) + radius * Math.cos(-midAngle * RADIAN);
                const y = (cyVal as number) + radius * Math.sin(-midAngle * RADIAN);
                return (
                  <text
                    x={x} y={y}
                    fill="rgba(148,163,184,0.8)"
                    textAnchor={x > (cxVal as number) ? 'start' : 'end'}
                    dominantBaseline="central"
                    fontSize={9}
                    fontWeight={500}
                  >
                    {name}
                  </text>
                );
              }}
            >
              {outerData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} opacity={0.7} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'rgba(15,23,42,0.95)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
        {innerData.map(d => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
            <span className="text-[10px] text-slate-400">{d.name} ({d.value})</span>
          </div>
        ))}
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
  const yVal = isSpirit
    ? (getCharacterValue(product, 'smoke') || getCharacterValue(product, 'sweetness'))
    : getCharacterValue(product, 'sweetness');

  const yLabel = isSpirit
    ? (getCharacterValue(product, 'smoke') > 0 ? 'Smoke' : 'Sweetness')
    : 'Sweetness';

  if (body === 0 && yVal === 0) return null;

  // Normalize to 0-100 range for positioning
  const xPct = Math.max(5, Math.min(95, (body / 5) * 100));
  const yPct = Math.max(5, Math.min(95, 100 - (yVal / 5) * 100)); // invert Y so high = top

  const quadrants = isSpirit
    ? ['Light & Mild', 'Full & Mild', 'Light & Intense', 'Full & Intense']
    : ['Light & Dry', 'Full & Dry', 'Light & Sweet', 'Full & Sweet'];

  return (
    <div className="relative">
      <div className="relative w-full aspect-square max-w-[260px] mx-auto bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
        {/* Grid lines */}
        <div className="absolute inset-0">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/[0.06]" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-white/[0.06]" />
        </div>

        {/* Quadrant labels */}
        <span className="absolute top-2 left-3 text-[9px] text-slate-600">{quadrants[2]}</span>
        <span className="absolute top-2 right-3 text-[9px] text-slate-600">{quadrants[3]}</span>
        <span className="absolute bottom-2 left-3 text-[9px] text-slate-600">{quadrants[0]}</span>
        <span className="absolute bottom-2 right-3 text-[9px] text-slate-600">{quadrants[1]}</span>

        {/* Product dot */}
        <div
          className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full shadow-lg shadow-violet-500/30"
          style={{
            left: `${xPct}%`,
            top: `${yPct}%`,
            background: 'radial-gradient(circle, rgba(139,92,246,1) 0%, rgba(139,92,246,0.6) 100%)',
          }}
        />
        {/* Pulse ring */}
        <div
          className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full animate-ping opacity-20"
          style={{
            left: `${xPct}%`,
            top: `${yPct}%`,
            background: 'rgba(139,92,246,0.3)',
          }}
        />

        {/* Axis labels */}
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-slate-500 font-medium">Body</span>
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 font-medium writing-mode-vertical"
          style={{ writingMode: 'vertical-rl', transform: 'translateY(-50%) rotate(180deg)' }}>
          {yLabel}
        </span>
      </div>
      <div className="flex justify-between mt-2 px-1">
        <span className="text-[9px] text-slate-600">Light</span>
        <span className="text-[10px] text-slate-400 font-medium">
          Body {body.toFixed(1)} / {yLabel} {yVal.toFixed(1)}
        </span>
        <span className="text-[9px] text-slate-600">Full</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. FoodPairingGrid
// ══════════════════════════════════════════════════════════════════════════════

const FOOD_CATEGORIES: { key: string; label: string; keywords: string[]; icon: React.ElementType }[] = [
  { key: 'meat',     label: 'Meat',     keywords: ['meat', 'beef', 'lamb', 'pork', 'steak', 'veal', 'game', 'venison', 'duck', 'bbq', 'grill', 'roast'], icon: Beef },
  { key: 'poultry',  label: 'Poultry',  keywords: ['poultry', 'chicken', 'turkey', 'fowl', 'quail'], icon: Egg },
  { key: 'seafood',  label: 'Seafood',  keywords: ['seafood', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'lobster', 'crab', 'oyster', 'shellfish', 'sushi', 'sashimi', 'scallop'], icon: Fish },
  { key: 'cheese',   label: 'Cheese',   keywords: ['cheese', 'brie', 'camembert', 'gouda', 'cheddar', 'parmesan', 'blue cheese', 'goat cheese', 'manchego'], icon: Milk },
  { key: 'vegetable',label: 'Vegetable',keywords: ['vegetable', 'salad', 'mushroom', 'truffle', 'asparagus', 'artichoke', 'vegetarian', 'vegan'], icon: Salad },
  { key: 'pasta',    label: 'Pasta & Grain', keywords: ['pasta', 'rice', 'risotto', 'noodle', 'pizza', 'bread', 'grain'], icon: Wheat },
  { key: 'dessert',  label: 'Dessert',  keywords: ['dessert', 'chocolate', 'cake', 'pastry', 'fruit', 'tart', 'pie', 'sweet', 'ice cream', 'pudding'], icon: Cake },
  { key: 'appetizer',label: 'Appetizer',keywords: ['appetizer', 'charcuterie', 'tapas', 'antipasto', 'snack', 'nuts', 'olives', 'bruschetta', 'canapé'], icon: Grape },
  { key: 'asian',    label: 'Asian',    keywords: ['asian', 'thai', 'japanese', 'chinese', 'korean', 'indian', 'curry', 'spicy', 'stir-fry', 'dim sum', 'pad thai', 'ramen'], icon: Shell },
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
      <div className="grid grid-cols-3 gap-2">
        {FOOD_CATEGORIES.map(cat => {
          const isMatched = matchedCategories.has(cat.key);
          const Icon = cat.icon;
          return (
            <div
              key={cat.key}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                isMatched
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                  : 'bg-white/[0.015] border-white/[0.04] text-slate-600'
              }`}
            >
              <Icon size={16} strokeWidth={1.5} />
              <span className="text-[10px] font-medium">{cat.label}</span>
            </div>
          );
        })}
      </div>
      {/* Show raw tags below */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {foodTags.map(t => (
          <span key={t} className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 capitalize">
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
  { key: 'classification', label: 'Classification', weight: 2 },
  { key: 'country', label: 'Country', weight: 2 },
  { key: 'region', label: 'Region', weight: 1 },
  { key: 'grape_variety', label: 'Grape', weight: 1 },
  { key: 'vintage', label: 'Vintage', weight: 1 },
  { key: 'wine_body', label: 'Body', weight: 1 },
  { key: 'wine_acidity', label: 'Acidity', weight: 1 },
  { key: 'flavor_tags', label: 'Flavors', weight: 2 },
  { key: 'food_matching', label: 'Pairing', weight: 1 },
  { key: 'desc_en_short', label: 'Short Desc', weight: 1 },
  { key: 'desc_en_full', label: 'Full Desc', weight: 1 },
  { key: 'price', label: 'Price', weight: 2 },
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
  const totalCount = fieldStatus.length;
  const completeness = Math.round((filledCount / totalCount) * 100);

  // Arc gauge SVG
  const radius = 52;
  const strokeWidth = 8;
  const circumference = Math.PI * radius; // half circle
  const offset = circumference - (pct / 100) * circumference;

  const gaugeColor = pct >= 75 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
  const gaugeColorFaded = pct >= 75 ? 'rgba(16,185,129,0.15)' : pct >= 50 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)';

  return (
    <div>
      {/* Arc gauge */}
      <div className="flex justify-center mb-4">
        <div className="relative w-[140px] h-[80px]">
          <svg viewBox="0 0 140 80" className="w-full h-full">
            {/* Background arc */}
            <path
              d="M 10 75 A 55 55 0 0 1 130 75"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            {/* Value arc */}
            <path
              d="M 10 75 A 55 55 0 0 1 130 75"
              fill="none"
              stroke={gaugeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${circumference}`}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-end justify-center pb-0">
            <span className="text-2xl font-bold" style={{ color: gaugeColor }}>{pct}%</span>
          </div>
        </div>
      </div>

      {/* Field completeness bar */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-slate-500">Field completeness</span>
          <span className="text-slate-400">{filledCount}/{totalCount} ({completeness}%)</span>
        </div>
        <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-1.5 rounded-full transition-all"
            style={{
              width: `${completeness}%`,
              background: `linear-gradient(90deg, ${gaugeColorFaded}, ${gaugeColor})`,
            }}
          />
        </div>
      </div>

      {/* Missing fields */}
      <div className="flex flex-wrap gap-1.5">
        {fieldStatus.map(f => (
          <span
            key={f.key}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ${
              f.filled
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : f.weight >= 2
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                  : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            }`}
          >
            {f.filled ? (
              <CheckCircle2 size={8} />
            ) : f.weight >= 2 ? (
              <AlertTriangle size={8} />
            ) : (
              <Info size={8} />
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

  // Show a range around the vintage year
  const currentYear = new Date().getFullYear();
  const rangeStart = Math.min(vintage - 3, currentYear - 8);
  const rangeEnd = Math.max(vintage + 3, currentYear + 1);
  const years = Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i);

  return (
    <div>
      <div className="relative">
        {/* Timeline track */}
        <div className="h-px bg-white/[0.08] absolute top-1/2 left-0 right-0" />

        <div className="flex items-center justify-between relative">
          {years.map(year => {
            const isCurrent = year === vintage;
            const isNow = year === currentYear;
            return (
              <div key={year} className="flex flex-col items-center relative">
                {/* Dot */}
                <div
                  className={`w-3 h-3 rounded-full border-2 transition-all ${
                    isCurrent
                      ? 'bg-violet-500 border-violet-400 shadow-lg shadow-violet-500/40'
                      : isNow
                        ? 'bg-white/20 border-white/30'
                        : 'bg-transparent border-white/10'
                  }`}
                />
                {/* Year label */}
                <span
                  className={`text-[9px] mt-1.5 ${
                    isCurrent
                      ? 'text-violet-300 font-bold'
                      : isNow
                        ? 'text-slate-400'
                        : 'text-slate-600'
                  }`}
                >
                  {year}
                </span>
                {/* "Current" label */}
                {isCurrent && (
                  <span className="text-[8px] text-violet-400 font-medium mt-0.5">Vintage</span>
                )}
                {isNow && !isCurrent && (
                  <span className="text-[8px] text-slate-500 mt-0.5">Now</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Age note */}
      <div className="flex items-center gap-1.5 mt-3">
        <Clock size={10} className="text-slate-500" />
        <span className="text-[10px] text-slate-500">
          {currentYear - vintage} year{currentYear - vintage !== 1 ? 's' : ''} old
        </span>
      </div>
    </div>
  );
}
