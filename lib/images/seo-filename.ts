/**
 * SEO/AEO-optimized image filename generator for product images.
 *
 * Format: {brand}-{product-name}-{grape-or-type}-{region}-{vintage}.webp
 * Example: opus-one-cabernet-sauvignon-napa-valley-2019.webp
 *
 * Rules:
 * - All lowercase, hyphens as word separators
 * - Strip special characters, transliterate non-ASCII
 * - Primary format: WebP
 * - Alt text auto-generated: "{Brand} {Product Name} — {Grape/Type} from {Region}"
 */

export interface ProductImageMeta {
  sku: string;
  name: string;
  brand?: string;
  classification?: string;
  grape_variety?: string;
  country?: string;
  region?: string;
  vintage?: string;
}

/**
 * Transliterate common non-ASCII chars to ASCII equivalents.
 */
function transliterate(s: string): string {
  return s
    .replace(/[éèêë]/g, 'e')
    .replace(/[àâäã]/g, 'a')
    .replace(/[ùûü]/g, 'u')
    .replace(/[ôöò]/g, 'o')
    .replace(/[îï]/g, 'i')
    .replace(/[ç]/g, 'c')
    .replace(/[ñ]/g, 'n')
    .replace(/[ß]/g, 'ss')
    .replace(/[æ]/g, 'ae')
    .replace(/[œ]/g, 'oe')
    .replace(/[\u2018\u2019\u201C\u201D''""]/g, '')
    .replace(/[—–]/g, '-');
}

/**
 * Slugify a string for URL/filename use.
 */
function slugify(s: string): string {
  let slug = transliterate(s.toLowerCase().trim());
  slug = slug.replace(/[^a-z0-9\s-]/g, '');
  slug = slug.replace(/[\s]+/g, '-');
  slug = slug.replace(/-{2,}/g, '-');
  slug = slug.replace(/^-|-$/g, '');
  return slug;
}

/**
 * Generate an SEO-optimized filename for a product image.
 */
export function generateImageFilename(product: ProductImageMeta, ext = 'webp'): string {
  const parts: string[] = [];

  // Brand
  if (product.brand) {
    parts.push(slugify(product.brand));
  }

  // Product name (remove brand if it appears at start to avoid duplication)
  let name = product.name || '';
  if (product.brand && name.toLowerCase().startsWith(product.brand.toLowerCase())) {
    name = name.slice(product.brand.length).trim();
  }
  if (name) {
    // Truncate to ~40 chars to keep filename reasonable
    const slugName = slugify(name);
    parts.push(slugName.length > 40 ? slugName.slice(0, 40).replace(/-$/, '') : slugName);
  }

  // Grape or type (first grape only if multiple)
  const grapeOrType = product.grape_variety?.split(',')[0]?.trim()
    || product.classification
    || '';
  if (grapeOrType) {
    parts.push(slugify(grapeOrType));
  }

  // Region
  if (product.region) {
    parts.push(slugify(product.region));
  }

  // Vintage
  if (product.vintage && product.vintage !== 'NV' && /\d{4}/.test(product.vintage)) {
    parts.push(product.vintage.match(/\d{4}/)?.[0] || '');
  }

  // Deduplicate consecutive identical parts
  const deduped = parts.filter((p, i) => p && (i === 0 || p !== parts[i - 1]));

  // Fallback to SKU if nothing else
  const filename = deduped.length > 0 ? deduped.join('-') : slugify(product.sku);

  return `${filename}.${ext}`;
}

/**
 * Generate SEO alt text for a product image.
 */
export function generateImageAltText(product: ProductImageMeta): string {
  const parts: string[] = [];

  if (product.brand) parts.push(product.brand);

  let name = product.name || '';
  if (product.brand && name.toLowerCase().startsWith(product.brand.toLowerCase())) {
    name = name.slice(product.brand.length).trim();
  }
  if (name) parts.push(name);

  const descriptor: string[] = [];
  if (product.grape_variety) {
    descriptor.push(product.grape_variety.split(',')[0].trim());
  }
  if (product.region) {
    descriptor.push(`from ${product.region}`);
  }
  if (product.country && !product.region) {
    descriptor.push(`from ${product.country}`);
  }

  if (descriptor.length > 0) {
    return `${parts.join(' ')} — ${descriptor.join(' ')}`;
  }
  return parts.join(' ');
}

/**
 * Get the public URL path for a product image.
 * Organized by country slug for filesystem structure.
 */
export function getImagePath(product: ProductImageMeta): string {
  const countrySlug = product.country ? slugify(product.country) : 'uncategorized';
  const filename = generateImageFilename(product);
  return `/images/products/${countrySlug}/${filename}`;
}

/**
 * Get the filesystem path for saving an image.
 */
export function getImageFsPath(product: ProductImageMeta): string {
  const countrySlug = product.country ? slugify(product.country) : 'uncategorized';
  const filename = generateImageFilename(product);
  return `public/images/products/${countrySlug}/${filename}`;
}
