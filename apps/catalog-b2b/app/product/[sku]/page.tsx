import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAllProducts, getProductBySku } from '@/lib/catalog-data';
import type { B2BProduct } from '@/lib/types';

export const dynamicParams = true;

export async function generateStaticParams() {
  const products = getAllProducts();
  return products
    .filter((p) => p.image_url && p.is_in_stock && (p.popularity_tier ?? 0) > 0)
    .slice(0, 200)
    .map((p) => ({ sku: p.sku }));
}

interface Props { params: Promise<{ sku: string }> }

function parseCriticScore(summary?: string): { score: string; reviewer?: string } | null {
  if (!summary) return null;
  try { const p = JSON.parse(summary); if (p?.score) return { score: String(p.score), reviewer: p.reviewer }; } catch {}
  const m = summary.match(/^(\d+)/); return m ? { score: m[1] } : null;
}

function formatPrice(price: number, currency?: string): string {
  const sym = currency === 'THB' || !currency ? '฿' : currency + ' ';
  return sym + price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** One attribute row; renders nothing when value is empty. */
function AttrRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex justify-between gap-4 border-b border-neutral-100 py-2.5 last:border-b-0">
      <dt className="text-sm text-neutral-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-neutral-900">{value}</dd>
    </div>
  );
}

/** Gauge bar for taste attributes (0–100 scale mapped from textual values). */
const GAUGE_LEVELS: Record<string, number> = {
  low: 20, light: 25, medium: 50, 'medium-full': 70, 'medium-high': 70,
  high: 85, full: 90, off: 5, dry: 15, 'off-dry': 30, sweet: 70,
  'very sweet': 90, delicate: 20, moderate: 50, intense: 80, 'very intense': 95,
  gentle: 20, subtle: 25, mild: 30, pronounced: 80, 'extra-brut': 10, brut: 15,
};

function gaugeWidth(value?: string | null): number {
  if (!value) return 0;
  return GAUGE_LEVELS[value.toLowerCase().trim()] ?? 50;
}

function TasteGauge({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  const w = gaugeWidth(value);
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 flex-shrink-0 text-xs text-neutral-500">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-neutral-800 transition-all"
          style={{ width: `${w}%` }}
          role="meter"
          aria-valuenow={w}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${value}`}
        />
      </div>
      <span className="w-24 flex-shrink-0 text-xs text-neutral-500 capitalize">{value}</span>
    </div>
  );
}

/** Taste profile section — gauges + flavor tags. */
function TasteSection({ product }: { product: B2BProduct }) {
  const hasGauges = product.body || product.acidity || product.tannin || product.sweetness || product.intensity || product.smokiness;
  // flavor_tags may arrive as a JSON string from the DB; parse it safely
  const flavorTags: string[] = (() => {
    const raw = product.flavor_tags;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    try { const p = JSON.parse(raw as unknown as string); return Array.isArray(p) ? p : []; } catch { return []; }
  })();
  const hasFlavors = flavorTags.length > 0;
  if (!hasGauges && !hasFlavors) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">Taste Profile</h2>
      <div className="flex flex-col gap-2.5">
        {hasGauges && (
          <div className="flex flex-col gap-2">
            <TasteGauge label="Body" value={product.body} />
            <TasteGauge label="Acidity" value={product.acidity} />
            <TasteGauge label="Tannin" value={product.tannin} />
            <TasteGauge label="Sweetness" value={product.sweetness} />
            <TasteGauge label="Intensity" value={product.intensity} />
            <TasteGauge label="Smokiness" value={product.smokiness} />
          </div>
        )}
        {hasFlavors && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {flavorTags.map((tag) => (
              <span key={tag} className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-700">
                {tag}
              </span>
            ))}
          </div>
        )}
        {product.finish && (
          <p className="text-xs text-neutral-500 mt-1">
            <span className="font-medium text-neutral-700">Finish:</span> {product.finish}
          </p>
        )}
      </div>
    </section>
  );
}

/** Food pairing — pipe-delimited string. */
function FoodPairing({ food, detail }: { food?: string; detail?: string }) {
  if (!food) return null;
  const items = food.split('|').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-3">Pairs With</h2>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item} className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-700">
            {item}
          </li>
        ))}
      </ul>
      {detail && (
        <p className="mt-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">Suggestion:</span> {detail}
        </p>
      )}
    </section>
  );
}

/** Recommendations — same-group products by popularity, excluding current. */
function getRecommendations(allProducts: B2BProduct[], current: B2BProduct): B2BProduct[] {
  return allProducts
    .filter((p) => p.sku !== current.sku && p.category_group === current.category_group && p.image_url && p.is_in_stock)
    .sort((a, b) => (b.popularity_tier ?? 0) - (a.popularity_tier ?? 0))
    .slice(0, 6);
}

export default async function ProductDetailPage({ params }: Props) {
  const { sku } = await params;
  const product = getProductBySku(sku);
  if (!product) return notFound();

  const criticInfo = parseCriticScore(product.score_summary);
  const isArchive = product.custom_stock_status === 'CATALOG';
  const isExpress = !isArchive && (product.wn_stock ?? 0) > 0;
  const inStock = product.is_in_stock;

  const allProducts = getAllProducts();
  const recs = getRecommendations(allProducts, product);

  return (
    <main className="min-h-screen bg-neutral-50">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 flex items-center h-14 gap-4">
          <Link href="/" className="text-lg font-bold tracking-tight text-neutral-900">WNLQ9</Link>
          <span className="text-[10px] font-bold tracking-widest text-white bg-neutral-800 rounded px-1.5 py-0.5">B2B</span>
        </div>
      </header>

      <div className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6 text-xs text-neutral-400">
          <Link href="/" className="hover:text-neutral-700">All products</Link>
          {product.category_group && (
            <>
              <span className="mx-2" aria-hidden="true">/</span>
              <Link href={`/?group=${encodeURIComponent(product.category_group)}`} className="hover:text-neutral-700">{product.category_group}</Link>
            </>
          )}
          <span className="mx-2" aria-hidden="true">/</span>
          <span className="text-neutral-700 truncate">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Image — sticky on desktop */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="aspect-square overflow-hidden rounded-xl bg-white border border-neutral-100 shadow-sm">
              {product.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-full h-full object-contain p-6"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-300 text-sm">No image</div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-8">
            {/* Identity */}
            <header className="flex flex-col gap-3">
              {product.brand && (
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{product.brand}</p>
              )}
              <h1 className="text-2xl font-bold text-neutral-900 leading-snug sm:text-3xl">{product.name}</h1>
              {product.vintage && (
                <p className="text-sm text-neutral-500">{product.vintage}</p>
              )}

              {/* Meta row: SKU + stock badges */}
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500 ring-1 ring-neutral-200">
                  <span className="uppercase tracking-wide">SKU:</span>
                  <span className="select-all font-semibold tabular-nums text-neutral-900">{product.sku}</span>
                </span>
                {isArchive ? (
                  <span className="rounded-full bg-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600">Archive</span>
                ) : isExpress ? (
                  <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">Express Delivery</span>
                ) : inStock ? (
                  <span className="text-xs font-medium text-neutral-500">In stock</span>
                ) : (
                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200">Check availability</span>
                )}
                {product.quantity_in_stock != null && product.quantity_in_stock > 0 && (
                  <span className="text-xs text-neutral-400">{product.quantity_in_stock} units</span>
                )}
              </div>

              {/* Critic score */}
              {criticInfo && (
                <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 w-fit mt-1">
                  <span className="text-2xl font-bold text-amber-700 tabular-nums">{criticInfo.score}</span>
                  <span className="text-xs text-amber-600">{criticInfo.reviewer ?? 'pts'}</span>
                </div>
              )}
            </header>

            {/* Wholesale price — the hero commercial fact */}
            <div className="rounded-xl bg-neutral-900 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-1">Wholesale Price</p>
              <p className="text-3xl font-bold text-white tabular-nums">{formatPrice(product.b2b_price, product.currency)}</p>
            </div>

            {/* Product details */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-3">Details</h2>
              <dl className="rounded-xl border border-neutral-100 bg-white px-4 py-1 shadow-sm">
                <AttrRow label="Country" value={product.country} />
                <AttrRow label="Region" value={product.region} />
                <AttrRow label="Subregion" value={product.subregion} />
                <AttrRow label="Appellation" value={product.appellation} />
                <AttrRow label="Variety" value={product.variety} />
                <AttrRow label="Blend type" value={product.blend_type} />
                <AttrRow label="Designation" value={product.designation} />
                <AttrRow label="Vintage" value={product.vintage} />
                <AttrRow label="Bottle size" value={product.bottle_size} />
                <AttrRow label="Category" value={product.category_type} />
              </dl>
            </section>

            {/* Taste profile */}
            <TasteSection product={product} />

            {/* Food pairing */}
            <FoodPairing food={product.food_matching} detail={product.food_matching_detail} />
          </div>
        </div>

        {/* Recommendations */}
        {recs.length > 0 && (
          <section className="mt-16 border-t border-neutral-200 pt-10">
            <h2 className="text-xl font-bold text-neutral-900 mb-6">You might also like</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {recs.map((p) => {
                const score = parseCriticScore(p.score_summary);
                return (
                  <Link key={p.sku} href={`/product/${p.sku}`} className="group block">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-white border border-neutral-100 shadow-sm transition-shadow hover:shadow-md">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-neutral-300 text-xs">No image</div>
                      )}
                      {score && (
                        <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold rounded px-1.5 py-0.5 leading-none">{score.score}</span>
                      )}
                    </div>
                    <div className="mt-2 px-0.5 pb-1">
                      <p className="text-[11px] text-neutral-400 truncate">{p.brand ?? p.country ?? ''}</p>
                      <p className="text-sm font-medium text-neutral-900 leading-snug line-clamp-2">{p.name}</p>
                      <p className="text-sm font-bold text-neutral-900 mt-1 tabular-nums">{formatPrice(p.b2b_price, p.currency)}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <footer className="border-t border-neutral-200 py-8 mt-16 text-center text-xs text-neutral-400">
        <span className="font-bold text-neutral-900">WNLQ9</span>
        <span className="ml-1.5 text-[9px] font-bold bg-neutral-800 text-white rounded px-1.5 py-0.5">B2B</span>
        <span className="ml-3">Wholesale Catalogue · Trade Use Only</span>
      </footer>
    </main>
  );
}
