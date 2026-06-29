import { notFound } from 'next/navigation';
import { getAllProducts, getProductBySku } from '@/lib/catalog-data';
import Link from 'next/link';

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

export default async function ProductDetailPage({ params }: Props) {
  const { sku } = await params;
  const product = getProductBySku(sku);
  if (!product) notFound();

  const criticInfo = parseCriticScore(product.score_summary);
  const isArchive = product.custom_stock_status === 'CATALOG';
  const isExpress = !isArchive && (product.wn_stock ?? 0) > 0;

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 flex items-center h-14 gap-4">
          <Link href="/" className="text-lg font-bold tracking-tight text-neutral-900">WNLQ9</Link>
          <span className="text-[10px] font-bold tracking-widest text-white bg-neutral-800 rounded px-1.5 py-0.5">B2B</span>
        </div>
      </header>
      <div className="mx-auto max-w-screen-lg px-4 sm:px-6 lg:px-8 py-10">
        <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-700 mb-6 inline-block">← All products</Link>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-neutral-100">
            {product.image_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-neutral-300 text-sm">No image</div>}
          </div>
          <div>
            <p className="text-sm text-neutral-500 mb-1">{product.brand}</p>
            <h1 className="text-2xl font-bold text-neutral-900 leading-snug">{product.name}</h1>
            {product.vintage && <p className="text-sm text-neutral-500 mt-1">{product.vintage}</p>}
            <div className="mt-3 flex gap-2">
              {isExpress && <span className="bg-emerald-600 text-white text-xs font-bold rounded px-2 py-0.5">Express Delivery</span>}
              {isArchive && <span className="bg-neutral-500 text-white text-xs font-bold rounded px-2 py-0.5">Archive</span>}
            </div>
            {criticInfo && (
              <div className="mt-4 inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="text-xl font-bold text-amber-700">{criticInfo.score}</span>
                {criticInfo.reviewer && <span className="text-xs text-amber-600">{criticInfo.reviewer}</span>}
              </div>
            )}
            <div className="mt-6 p-4 bg-neutral-900 rounded-xl">
              <p className="text-xs text-neutral-400 uppercase tracking-wider mb-1">Wholesale Price</p>
              <p className="text-3xl font-bold text-white">฿{product.b2b_price.toLocaleString()}</p>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-3">
              {([['Country', product.country], ['Region', product.region], ['Variety', product.variety], ['Body', product.body], ['Bottle', product.bottle_size], ['Category', product.category_type]] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] uppercase tracking-wider text-neutral-400">{k}</dt>
                  <dd className="text-sm text-neutral-900 font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </main>
  );
}
