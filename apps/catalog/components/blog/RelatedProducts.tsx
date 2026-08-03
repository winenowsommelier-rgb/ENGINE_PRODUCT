import Link from 'next/link';
import { StorefrontImage } from '@/components/StorefrontImage';
import { ReputationBadge } from '@/components/product/ReputationBadge';
import { formatPrice, resolveSale } from '@/lib/price-tiers';
import type { PublicProduct } from '@/lib/types';

// Tags too generic to signal a product match on their own (post format/topic
// labels, not drinks/regions/varietals/types). Left unfiltered, "guide" or
// bare category words like "spirits"/"whisky"/"wine" would match every
// product in that entire category instead of the post's actual subject.
const NON_SIGNAL_TAGS = new Set([
  'guide', 'deep-dive', 'compare', 'curated', 'pairing', 'beginner', 'bangkok',
  'wine-education', 'designations', 'education', 'wine-label', 'collector',
  'fine-wine', 'value', 'gifting', 'celebration', 'wine-care', 'storage', 'heat',
  'dinner-party', 'deals', 'sale', 'spirits', 'wine', 'whisky', 'wine-guide',
  'wine-list', 'restaurants', 'sommelier', 'tasting', 'home', 'entertaining',
  'collection', 'monthly', 'picks', 'news', 'arrivals', 'new', 'occasions',
  'science', 'food', 'events', 'asia', 'wine-scene', 'investment', 'budget',
  'premium', 'organic-wine',
]);

// Country-name tags are too broad for the region-substring match alone — a
// product's `region` field can contain a country name (e.g. "Other Spain")
// regardless of category, which would otherwise let e.g. a Spanish rum match
// a wine-country tag. These only count as a REGION match if the product is
// Wine — but they're still allowed to contribute a (lower-weight) name match.
const COUNTRY_TAGS = new Set([
  'france', 'italy', 'spain', 'usa', 'chile', 'argentina', 'australia',
  'new-zealand', 'japan', 'mexico', 'scotland', 'thailand', 'germany', 'austria',
]);

// Tags that name a specific product type map to an exact category_type value
// (or one of a few) rather than a loose substring — substring matching lets
// bare "japan" hit "The Japanese Yuzu Bitter" and bare "spirits" hit every
// spirit in the store. Keys are tag slugs; values are exact category_type
// strings to match against (case-sensitive as stored in the export).
const TAG_TO_CATEGORY_TYPES: Record<string, string[]> = {
  sake: ['Sake / Shochu'],
  shochu: ['Shochu', 'Sake / Shochu'],
  gin: ['Gin'],
  rum: ['Rum'],
  tequila: ['Tequila'],
  mezcal: ['Tequila'],
  cognac: ['Cognac', 'Armagnac'],
  champagne: ['Sparkling & Champagne'],
  sparkling: ['Sparkling & Champagne'],
  prosecco: ['Sparkling & Champagne'],
  rose: ['Rosé Wine'],
  'rosé': ['Rosé Wine'],
  'red-wine': ['Red Wine'],
  'white-wine': ['White Wine'],
  'orange-wine': ['Orange Wine'],
  'dessert-wine': ['Sweet/Dessert', 'Fortified'],
};

// Whisky's category_type is a single flat "Whisky" bucket — it doesn't
// distinguish Scotch from Japanese from Bourbon, so a sub-style tag has to
// gate on `country` (which does distinguish them) instead of category_type,
// or it would match every whisky in the store regardless of origin.
const TAG_TO_WHISKY_COUNTRY: Record<string, string[]> = {
  scotch: ['scotland'],
  'japanese-whisky': ['japan'],
};

// Country tags mapped to the wine `region` values that actually represent
// that country in the catalog, for a cleaner match than raw substring.
const TAG_TO_REGION_HINTS: Record<string, string[]> = {
  speyside: ['speyside'],
  islay: ['islay'],
  rioja: ['rioja'],
  napa: ['napa'],
  burgundy: ['burgundy', 'cote de nuits', 'cote de beaune', "cote d'or", 'chablis'],
  bordeaux: ['bordeaux'],
  tuscany: ['tuscany', 'toscana'],
  piedmont: ['piedmont', 'piemonte'],
  veneto: ['veneto'],
  languedoc: ['languedoc'],
  'rhone-valley': ['rhone', 'rhône'],
  marlborough: ['marlborough'],
};

interface RelatedProductsProps {
  tags: Array<{ name: string; slug: string }>;
  allProducts: PublicProduct[];
  products?: string[];
}

interface ScoredMatch {
  product: PublicProduct;
  score: number;
}

export function RelatedProducts({ tags, allProducts, products }: RelatedProductsProps) {
  let related: PublicProduct[];

  if (products && products.length > 0) {
    // Curated override from post frontmatter (PRODUCTS: sku1,sku2,...) — used
    // for posts whose tags are too broad/topical to auto-match well, e.g.
    // multi-country designation explainers.
    const bySku = new Map(allProducts.map((p) => [p.sku, p]));
    related = products
      .map((sku) => bySku.get(sku))
      .filter((p): p is PublicProduct => !!p && !!p.is_in_stock)
      .slice(0, 4);
  } else {
    if (tags.length === 0) return null;

    const signalSlugs = tags.map((t) => t.slug.toLowerCase()).filter((s) => !NON_SIGNAL_TAGS.has(s));
    const signalNames = tags.map((t) => t.name.toLowerCase()).filter((n) => !NON_SIGNAL_TAGS.has(n.replace(/\s+/g, '-')));

    if (signalSlugs.length === 0) return null;

    const scored: ScoredMatch[] = [];

    for (const p of allProducts) {
      // is_in_stock is coerced to boolean once in getAllProducts()
      if (!p.is_in_stock) continue;
      // Accessories (stoppers, glassware, etc.) can name-match drink keywords
      // ("Sparkling Wine Stopper") without being a drink themselves — exclude.
      if (p.category_group === 'Accessories') continue;

      const regionSlug = (p.region ?? '').trim().toLowerCase().replace(/\s+/g, '-');
      const region = (p.region ?? '').toLowerCase();
      const country = (p.country ?? '').toLowerCase();
      const name = p.name.toLowerCase();
      const catGroup = (p.category_group ?? '').toLowerCase();
      const catType = p.category_type ?? '';
      const isWine = catGroup === 'wine';
      const isWhisky = catGroup === 'whisky';

      let score = 0;

      for (const s of signalSlugs) {
        // Highest confidence: tag maps to an exact category_type value.
        const exactTypes = TAG_TO_CATEGORY_TYPES[s];
        if (exactTypes?.includes(catType)) score += 5;

        // Highest confidence: whisky sub-style tag, gated on country since
        // category_type alone can't distinguish Scotch/Japanese/Bourbon.
        const whiskyCountries = TAG_TO_WHISKY_COUNTRY[s];
        if (whiskyCountries && isWhisky && whiskyCountries.some((c) => country.includes(c))) score += 5;

        // High confidence: tag maps to a known region hint for that place.
        const regionHints = TAG_TO_REGION_HINTS[s];
        if (regionHints?.some((h) => region.includes(h))) score += 4;

        // Medium: country-tag region match, gated to Wine only (see comment above).
        if (COUNTRY_TAGS.has(s) && isWine && regionSlug.length > 0) {
          if (regionSlug.includes(s) || s.includes(regionSlug.replace(/-/g, ' '))) score += 2;
        }

        // Medium: loose category_group/category_type substring, for tags with
        // no explicit mapping above (varietals like "malbec", "riesling").
        if (!exactTypes && !whiskyCountries && (catGroup.includes(s) || catType.toLowerCase().includes(s))) score += 2;
      }

      // Product-name match: require the full tag phrase (spaces, not just the
      // slug) so e.g. "japan" doesn't fire on "The Japanese Yuzu Bitter".
      for (const n of signalNames) {
        if (n.length >= 4 && name.includes(n)) score += 1;
      }

      if (score > 0) scored.push({ product: p, score });
    }

    related = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((m) => m.product);
  }

  if (related.length === 0) return null;

  return (
    <section className="mt-14 border-t border-stone-200 pt-10">
      <h2 className="mb-7 text-xl font-semibold text-stone-900">You might also like</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5">
        {related.map((product) => {
          const sale = resolveSale(product.price, product.special_price);

          return (
            <Link
              key={product.sku}
              href={`/product/${product.sku}`}
              className="group flex flex-col rounded-xl border border-stone-200 bg-white overflow-hidden transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="relative">
                <StorefrontImage
                  src={product.image_url}
                  alt={product.name}
                  sizes="(min-width: 640px) 25vw, 50vw"
                  className="transition-transform duration-300 group-hover:scale-105"
                />
                <ReputationBadge tier={product.reputation_tier} className="absolute bottom-2 left-2" />
              </div>

              {/* Text area — name wraps to 2 lines instead of truncating */}
              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="text-sm font-semibold leading-snug text-stone-800 line-clamp-2 min-h-[2.5em]">
                  {product.name}
                </p>
                {sale ? (
                  <div className="mt-auto flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-sm font-semibold text-primary tabular-nums">
                      {formatPrice(sale.special)}
                    </span>
                    <span className="text-xs text-stone-400 line-through tabular-nums">
                      {formatPrice(product.price)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-auto text-sm font-medium text-stone-500 tabular-nums">
                    {formatPrice(product.price)}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
