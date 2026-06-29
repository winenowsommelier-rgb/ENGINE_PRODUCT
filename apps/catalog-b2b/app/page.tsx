import { Suspense } from 'react';
import { getAllProducts } from '@/lib/catalog-data';
import { ProductCardB2B } from '@/components/ProductCardB2B';
import { ViewToggle } from '@/components/ViewToggle';
import type { B2BProduct } from '@/lib/types';

function parseCriticScore(summary?: string): string | null {
  if (!summary) return null;
  try { const p = JSON.parse(summary); if (p?.score) return String(p.score); } catch {}
  const m = summary.match(/^(\d+)/); return m ? m[1] : null;
}

function ListRow({ product }: { product: B2BProduct }) {
  const criticScore = parseCriticScore(product.score_summary);
  return (
    <a href={`/product/${product.sku}`} className="flex items-center gap-4 py-3 border-b border-neutral-100 hover:bg-neutral-50 px-2 rounded-lg">
      <div className="w-12 h-16 flex-shrink-0 rounded bg-neutral-100 overflow-hidden">
        {product.image_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-neutral-300 text-[8px]">—</div>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-neutral-400 truncate">{product.brand} · {product.region ?? product.country}</p>
        <p className="text-sm font-medium text-neutral-900 truncate">{product.name}</p>
      </div>
      {criticScore && <span className="flex-shrink-0 bg-amber-500 text-white text-[10px] font-bold rounded px-1.5 py-0.5">{criticScore}</span>}
      <p className="flex-shrink-0 text-sm font-bold text-neutral-900 w-20 text-right">฿{product.b2b_price.toLocaleString()}</p>
    </a>
  );
}

interface Props { searchParams: Promise<{ view?: string }> }

export default async function ShopPage({ searchParams }: Props) {
  const { view } = await searchParams;
  const products = getAllProducts();
  const isListView = view === 'list';

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 flex items-center h-14 gap-4">
          <span className="text-lg font-bold tracking-tight text-neutral-900">WNLQ9</span>
          <span className="text-[10px] font-bold tracking-widest text-white bg-neutral-800 rounded px-1.5 py-0.5">B2B</span>
          <div className="flex-1" />
          <Suspense><ViewToggle /></Suspense>
        </div>
      </header>
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-4">
        <p className="text-xs text-neutral-400">{products.length.toLocaleString()} wholesale products</p>
      </div>
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 pb-16">
        {isListView ? (
          <div className="bg-white rounded-xl border border-neutral-100 overflow-hidden">
            {products.map((p) => <ListRow key={p.sku} product={p} />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {products.map((p) => <ProductCardB2B key={p.sku} product={p} />)}
          </div>
        )}
      </div>
      <footer className="border-t border-neutral-200 py-8 text-center text-xs text-neutral-400">
        <span className="font-bold text-neutral-900">WNLQ9</span>
        <span className="ml-1.5 text-[9px] font-bold bg-neutral-800 text-white rounded px-1.5 py-0.5">B2B</span>
        <span className="ml-3">Wholesale Catalogue · Trade Use Only</span>
      </footer>
    </main>
  );
}
