// apps/catalog/lib/seo/jsonld.ts
import { isInStock } from '@/lib/utils';
import type { PublicProduct } from '@/lib/types';

const BASE = 'https://wnlq9-catalog.vercel.app';

// Maps CategoryGroup display name to URL slug
export const GROUP_SLUG: Record<string, string> = {
  'Wine': 'wine',
  'Whisky': 'whisky',
  'Spirits': 'spirits',
  'Sake & Asian': 'sake--asian',
  'Liqueur': 'liqueur',
  'Beer & RTD': 'beer--rtd',
  'Non-Alcoholic': 'non-alcoholic',
  'Cigars': 'cigars',
  'Events': 'events',
  'Accessories': 'accessories',
};

export function buildWebSiteOrganization() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${BASE}/#website`,
        name: 'WNLQ9',
        url: BASE,
      },
      {
        '@type': 'Organization',
        '@id': `${BASE}/#organization`,
        name: 'WNLQ9',
        url: BASE,
        description: 'Curated wine, whisky and spirits retailer based in Bangkok, Thailand.',
        areaServed: 'Thailand',
        serviceType: 'Wine and spirits retail',
      },
    ],
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isRealVintage(v: string | undefined): boolean {
  return !!v && /^\d{4}$/.test(v.trim());
}

function parseScoreSummary(raw: string | undefined) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const critics: Array<{ critic: string; score_value: number }> =
      parsed?.critics?.filter((c: { score_value?: unknown }) => typeof c.score_value === 'number') ?? [];
    if (critics.length === 0) return null;
    return critics;
  } catch {
    return null;
  }
}

export function buildProductSchema(product: PublicProduct) {
  const inStock = isInStock(product.is_in_stock);
  const isArchived = product.custom_stock_status === 'CATALOG';

  let availability: string;
  if (isArchived) {
    availability = 'https://schema.org/Discontinued';
  } else if (inStock) {
    availability = 'https://schema.org/InStock';
  } else {
    availability = 'https://schema.org/OutOfStock';
  }

  const description =
    product.desc_en_short
      ? stripHtml(product.desc_en_short)
      : product.full_description
      ? stripHtml(product.full_description).slice(0, 300)
      : undefined;

  const additionalProperty: object[] = [];
  if (product.body) additionalProperty.push({ '@type': 'PropertyValue', name: 'Body', value: product.body });
  if (product.acidity) additionalProperty.push({ '@type': 'PropertyValue', name: 'Acidity', value: product.acidity });
  if (product.tannin) additionalProperty.push({ '@type': 'PropertyValue', name: 'Tannin', value: product.tannin });
  if (product.variety) additionalProperty.push({ '@type': 'PropertyValue', name: 'Grape Variety', value: product.variety });
  if (product.region) additionalProperty.push({ '@type': 'PropertyValue', name: 'Region', value: product.region });
  if (isRealVintage(product.vintage)) additionalProperty.push({ '@type': 'PropertyValue', name: 'Vintage', value: product.vintage! });
  if (product.flavor_tags?.length) additionalProperty.push({ '@type': 'PropertyValue', name: 'Flavors', value: product.flavor_tags.join(', ') });

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.sku,
    ...(description ? { description } : {}),
    ...(product.image_url ? { image: product.image_url } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    // NEVER use product.classification — use category_type (SKU-derived canonical)
    ...(product.category_type ? { category: product.category_type } : {}),
    ...(product.country ? { countryOfOrigin: product.country } : {}),
    offers: {
      '@type': 'Offer',
      price: String(product.price),
      priceCurrency: 'THB',
      availability,
      url: `${BASE}/product/${product.sku}`,
      seller: { '@type': 'Organization', name: 'WNLQ9' },
    },
    ...(additionalProperty.length ? { additionalProperty } : {}),
  };

  const critics = parseScoreSummary(product.score_summary);
  if (critics) {
    const mean = critics.reduce((sum, c) => sum + c.score_value, 0) / critics.length;
    const criticDesc = critics.map((c) => `${c.critic} ${c.score_value}`).join(', ');
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: mean.toFixed(1),
      bestRating: '100',
      worstRating: '50',
      ratingCount: critics.length,
      description: criticDesc,
    };
  }

  return schema;
}

export function buildBreadcrumbList(
  productName: string,
  groupName: string,
  groupSlug: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Shop', item: `${BASE}/shop` },
      { '@type': 'ListItem', position: 2, name: groupName, item: `${BASE}/shop/${groupSlug}` },
      { '@type': 'ListItem', position: 3, name: productName },
    ],
  };
}

export function buildLocalBusiness(address?: string) {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${BASE}/#organization`,
    name: 'WNLQ9',
    description: 'Curated wine, whisky and spirits. Browse online, order via LINE or WhatsApp.',
    url: BASE,
    areaServed: {
      '@type': 'City',
      name: 'Bangkok',
      containedInPlace: { '@type': 'Country', name: 'Thailand' },
    },
    serviceType: 'Wine and spirits retail',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'WNLQ9 Wine & Spirits Catalog',
      url: `${BASE}/shop`,
    },
  };
  if (address) {
    schema.address = { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'TH' };
  }
  return schema;
}

export function buildCollectionPage(
  regionName: string,
  regionSlug: string,
  countryName: string,
  total: number,
  topProducts: PublicProduct[],
  description: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${regionName} — WNLQ9`,
    description,
    url: `${BASE}/explore-map/${regionSlug}`,
    about: {
      '@type': 'Place',
      name: regionName,
      containedInPlace: { '@type': 'Country', name: countryName },
    },
    numberOfItems: total,
    hasPart: topProducts.slice(0, 5).map((p) => ({
      '@type': 'Product',
      name: p.name,
      url: `${BASE}/product/${p.sku}`,
      ...(p.price ? { offers: { '@type': 'Offer', price: String(p.price), priceCurrency: 'THB' } } : {}),
    })),
  };
}

export function buildItemList(
  topProducts: PublicProduct[],
  groupName: string,
  groupSlug: string,
  totalCount: number,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${groupName} — WNLQ9`,
    url: `${BASE}/shop/${groupSlug}`,
    numberOfItems: totalCount,
    itemListElement: topProducts.slice(0, 20).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${BASE}/product/${p.sku}`,
      name: p.name,
      ...(p.image_url ? { image: p.image_url } : {}),
      ...(p.price ? { offers: { '@type': 'Offer', price: String(p.price), priceCurrency: 'THB' } } : {}),
    })),
  };
}
