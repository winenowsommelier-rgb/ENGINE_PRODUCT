import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StorefrontImage } from '@/components/StorefrontImage';
import { ContactButtons } from '@/components/ContactButtons';
import { ProductCard } from '@/components/ProductCard';
import { TasteWheel } from '@/components/product/TasteWheel';
import { StructuralGauges } from '@/components/product/StructuralGauges';
import { getAllProducts, getProductBySku } from '@/lib/catalog-data';
import { precomputeRecommendations } from '@/lib/recommender';
import { formatPrice } from '@/lib/price-tiers';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';
import { toTiers, toStructural } from '@/lib/taste-adapter';
import { isInStock } from '@/lib/utils';
import type { PublicProduct } from '@/lib/types';

/**
 * Product detail — SERVER component, statically generated for every SKU.
 *
 * DESIGN: attribute-first. ~40% of products have NO description, so the page must
 * stand on its attribute matrix + taste visualisations as the hero, never showing
 * an empty description block. Image left (top on mobile); identity + commercials +
 * attributes + taste viz + contact + recommendations on the right.
 *
 * SAFETY: every product comes from getProductBySku/getAllProducts, which project
 * through the PUBLIC_FIELDS allowlist (catalog-data.ts) — margin/b2b/internal
 * fields are structurally absent and cannot reach the HTML.
 */

/**
 * RECS — recommendations precomputed ONCE at module load for the whole catalog,
 * NOT per page. Per-page getRecommendations() would be O(n) each → O(n^2) across
 * the ~11,436-page build. We store sku→sku[] and resolve to products per page via
 * the cached getProductBySku.
 */
const RECS: Map<string, string[]> = precomputeRecommendations(getAllProducts());

/** SSG: one static page per SKU. */
export async function generateStaticParams(): Promise<Array<{ sku: string }>> {
  return getAllProducts().map((p) => ({ sku: p.sku }));
}

// ── small presentational helpers (server-rendered) ──────────────────────────

/** One attribute row; renders nothing when the value is empty. */
function AttrRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Critic-score badge. score_summary is a JSON STRING; parse DEFENSIVELY in a
 * try/catch. On success show "Critic reviewed" + the top critic score; on any
 * parse failure render nothing (never crash a whole page over a malformed badge).
 */
function CriticBadge({ scoreSummary }: { scoreSummary?: string }) {
  if (!scoreSummary) return null;
  let top: number | null = null;
  try {
    const parsed = JSON.parse(scoreSummary) as { critics?: Array<{ score_value?: number }> };
    const scores = (parsed.critics ?? [])
      .map((c) => (typeof c.score_value === 'number' ? c.score_value : NaN))
      .filter((n) => !Number.isNaN(n));
    if (scores.length > 0) top = Math.max(...scores);
  } catch {
    // Malformed JSON → show nothing rather than crash. (Rule 2: don't pretend
    // it succeeded, just degrade quietly for a non-critical badge.)
    return null;
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-sm font-medium text-primary">
      <span aria-hidden="true">★</span>
      {top !== null ? `Critic reviewed · ${top}` : 'Critic reviewed'}
    </span>
  );
}

/** food_matching is a comma string → readable chips. */
function FoodPairing({ food }: { food?: string }) {
  if (!food) return null;
  const items = food
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">Pairs well with</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-full border border-border bg-secondary px-3 py-1 text-sm text-foreground"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function generateMetadata({ params }: { params: { sku: string } }): Metadata {
  const product = getProductBySku(params.sku);
  if (!product) return { title: 'Not found — WNLQ9' };
  const description =
    product.desc_en_short || product.full_description || `${product.name} — available at WNLQ9.`;
  return {
    title: `${product.name} — WNLQ9`,
    description: description.slice(0, 160),
    openGraph: {
      title: `${product.name} — WNLQ9`,
      description: description.slice(0, 160),
      images: product.image_url ? [{ url: product.image_url }] : undefined,
    },
  };
}

export default function Page({ params }: { params: { sku: string } }) {
  const product = getProductBySku(params.sku);
  if (!product) notFound();

  const inStock = isInStock(product.is_in_stock);
  const description = product.full_description || product.desc_en_short || '';

  // Taste viz inputs (rendered only when present).
  const tiers = toTiers(product.taste_profile);
  const structural = toStructural(product);
  const hasStructural = Object.keys(structural).length > 0;

  // Per-product contact deep-links (pre-fills "I'm interested in [name] — [sku]").
  const links = buildContactLinks(getContactEnv(), { name: product.name, sku: product.sku });

  // Recommendations: resolve precomputed skus → products (cached lookups).
  const recs: PublicProduct[] = (RECS.get(product.sku) ?? [])
    .map((sku) => getProductBySku(sku))
    .filter((p): p is PublicProduct => Boolean(p));

  return (
    <main className="container flex flex-col gap-12 py-8 sm:py-10">
      {/* Breadcrumb back to shop. */}
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/shop" className="hover:text-primary">Shop</Link>
        <span className="px-2" aria-hidden="true">/</span>
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
        {/* Image — top on mobile, left on desktop. */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <StorefrontImage
            src={product.image_url}
            alt={product.name}
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="rounded-lg"
          />
        </div>

        {/* Right column: identity, commercials, attributes, taste, contact. */}
        <div className="flex flex-col gap-8">
          <header className="flex flex-col gap-3">
            {product.brand ? (
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {product.brand}
              </p>
            ) : null}
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              {product.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-2xl font-semibold text-primary">{formatPrice(product.price)}</p>
              {inStock ? (
                <span className="text-sm font-medium text-muted-foreground">In stock</span>
              ) : (
                <span className="rounded-full bg-secondary px-3 py-1 text-sm font-medium text-muted-foreground ring-1 ring-border">
                  Out of stock
                </span>
              )}
              <CriticBadge scoreSummary={product.score_summary} />
            </div>
          </header>

          {/* Description — ONLY when present (40% have none; don't show an empty block). */}
          {description ? (
            <section className="max-w-prose text-base leading-relaxed text-foreground/90">
              {description}
            </section>
          ) : null}

          {/* Attribute matrix. Omits always-empty fields (alcohol, wine_classification,
              appellation, wine_color — verified 0/11,436) and any empty row. */}
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">Details</h2>
            <dl className="rounded-lg border border-border bg-card px-4 py-1">
              <AttrRow label="Country" value={product.country} />
              <AttrRow label="Region" value={product.region} />
              <AttrRow label="Subregion" value={product.subregion} />
              <AttrRow label="Grape" value={product.grape_variety} />
              <AttrRow label="Vintage" value={product.vintage} />
              <AttrRow label="Bottle size" value={product.bottle_size} />
              <AttrRow label="Body" value={product.wine_body} />
              <AttrRow label="Acidity" value={product.wine_acidity} />
              <AttrRow label="Tannin" value={product.wine_tannin} />
            </dl>
          </section>

          {/* Taste visualisations — only when data is present. */}
          {(tiers || hasStructural) ? (
            <section className="flex flex-col gap-8">
              <h2 className="text-base font-semibold text-foreground">Taste profile</h2>
              {hasStructural ? <StructuralGauges structural={structural} /> : null}
              {tiers ? <TasteWheel tiers={tiers} /> : null}
            </section>
          ) : null}

          <FoodPairing food={product.food_matching} />

          {/* Contact — per-product pre-filled. Renders the section even if env is
              unset; ContactButtons simply omits any unconfigured channel. */}
          <section className="flex flex-col gap-3 border-t border-border pt-6">
            <h2 className="text-base font-semibold text-foreground">Interested? Talk to us</h2>
            <p className="text-sm text-muted-foreground">
              Message us to check availability or place an order.
            </p>
            <ContactButtons links={links} variant="inline" />
          </section>
        </div>
      </div>

      {/* Recommendations rail. */}
      {recs.length > 0 ? (
        <section className="flex flex-col gap-6 border-t border-border pt-10">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            You might also like
          </h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {recs.map((p) => (
              <ProductCard key={p.sku} product={p} contactLinks={buildContactLinks(getContactEnv(), { name: p.name, sku: p.sku })} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
