import { Suspense } from 'react';
import { getAllProducts } from '@/lib/catalog-data';
import { ProductCardB2B } from '@/components/ProductCardB2B';
import { ViewToggle } from '@/components/ViewToggle';
import { B2BFilters } from '@/components/B2BFilters';
import { applyB2BQuery, buildFacets, B2B_PAGE_SIZE } from '@/lib/b2b-query';
import type { B2BProduct } from '@/lib/types';
import type { B2BParams } from '@/lib/b2b-query';

function parseCriticScore(summary?: string): string | null {
  if (!summary) return null;
  try { const p = JSON.parse(summary); if (p?.score) return String(p.score); } catch {}
  const m = summary.match(/^(\d+)/); return m ? m[1] : null;
}

function ListRow({ product }: { product: B2BProduct }) {
  const criticScore = parseCriticScore(product.score_summary);
  return (
    <a href={`/product/${product.sku}`} className="flex items-center gap-4 py-3 border-b border-neutral-100 hover:bg-neutral-50 px-2 rounded-lg">
      <div className="w-10 h-14 flex-shrink-0 rounded bg-white border border-neutral-100 overflow-hidden">
        {product.image_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" />
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

function pageHref(params: Record<string, string>, page: number): string {
  const sp = new URLSearchParams(params);
  if (page <= 1) sp.delete('page'); else sp.set('page', String(page));
  const qs = sp.toString();
  return qs ? `/?${qs}` : '/';
}

function Pagination({ params, page, totalPages }: { params: Record<string, string>; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const pages: Array<number | 'gap'> = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    const lo = Math.max(2, page - 1);
    const hi = Math.min(totalPages - 1, page + 1);
    if (lo > 2) pages.push('gap');
    for (let i = lo; i <= hi; i++) pages.push(i);
    if (hi < totalPages - 1) pages.push('gap');
    pages.push(totalPages);
  }
  const base = 'inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border text-sm transition-colors';
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-1.5 pt-6">
      {page > 1 && (
        <a href={pageHref(params, page - 1)} aria-label="Previous" className={`${base} border-neutral-200 text-neutral-700 hover:border-neutral-400 px-3`}>←</a>
      )}
      {pages.map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} className="px-1 text-neutral-400">…</span>
        ) : item === page ? (
          <span key={item} aria-current="page" className={`${base} border-neutral-900 bg-neutral-900 font-medium text-white px-3`}>{item}</span>
        ) : (
          <a key={item} href={pageHref(params, item)} className={`${base} border-neutral-200 text-neutral-700 hover:border-neutral-400 px-3`}>{item}</a>
        )
      )}
      {page < totalPages && (
        <a href={pageHref(params, page + 1)} aria-label="Next" className={`${base} border-neutral-200 text-neutral-700 hover:border-neutral-400 px-3`}>→</a>
      )}
    </nav>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

function toParams(sp: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === 'string' && val !== '') out[k] = val;
  }
  return out;
}

interface Props { searchParams: Promise<SearchParams> }

export default async function ShopPage({ searchParams }: Props) {
  const rawParams = await searchParams;
  const params = toParams(rawParams) as B2BParams;
  const isListView = rawParams.view === 'list';

  const allProducts = getAllProducts();
  const facets = buildFacets(allProducts, params);
  const { pageItems, total, page, totalPages } = applyB2BQuery(allProducts, params);

  const stringParams = toParams(rawParams);

  const first = total === 0 ? 0 : (page - 1) * B2B_PAGE_SIZE + 1;
  const last = Math.min(page * B2B_PAGE_SIZE, total);

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

      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5">
        {/* Filter bar */}
        <Suspense fallback={<div className="h-32 rounded-xl border border-neutral-200 bg-white animate-pulse" />}>
          <B2BFilters
            groups={facets.groups}
            subCategories={facets.subCategories}
            countries={facets.countries}
            regions={facets.regions}
          />
        </Suspense>

        {/* Result count */}
        <p className="text-xs text-neutral-400" aria-live="polite" role="status">
          {total > 0 ? (
            <>Showing <strong className="text-neutral-700">{first}–{last}</strong> of <strong className="text-neutral-700">{total.toLocaleString()}</strong> wholesale products</>
          ) : (
            <>No products match the selected filters</>
          )}
        </p>

        {/* Grid / List */}
        {total === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white py-16 text-center">
            <p className="text-base font-medium text-neutral-700">No products match</p>
            <a href="/" className="rounded-full bg-neutral-900 px-5 py-2 text-sm text-white hover:bg-neutral-700">Clear filters</a>
          </div>
        ) : isListView ? (
          <div className="bg-white rounded-xl border border-neutral-100 overflow-hidden">
            {pageItems.map((p) => <ListRow key={p.sku} product={p} />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {pageItems.map((p) => <ProductCardB2B key={p.sku} product={p} />)}
          </div>
        )}

        <Pagination params={stringParams} page={page} totalPages={totalPages} />
      </div>

      <footer className="border-t border-neutral-200 py-8 text-center text-xs text-neutral-400">
        <span className="font-bold text-neutral-900">WNLQ9</span>
        <span className="ml-1.5 text-[9px] font-bold bg-neutral-800 text-white rounded px-1.5 py-0.5">B2B</span>
        <span className="ml-3">Wholesale Catalogue · Trade Use Only</span>
      </footer>
    </main>
  );
}
