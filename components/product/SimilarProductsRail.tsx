"use client";

import { useEffect, useState } from "react";

interface SimilarProductRef {
  id: string;
  sku: string;
  name: string | null;
  classification: string | null;
  price: number | null;
  image_url: string | null;
}

interface SimilarRow {
  similar_id: string;
  score: number;
  matching_notes: unknown;
  products: SimilarProductRef | null;
}

interface ApiResponse {
  similar?: SimilarRow[];
  error?: string;
}

/**
 * Renders the horizontal "More like this" rail under the TasteProfileSection.
 *
 * Fetches pre-computed similarity data from /api/products/[id]/similar.
 * Returns null silently when there's no data — that's the expected state
 * for products not yet enriched OR before pg_cron has populated their
 * product_similar rows.
 */
export function SimilarProductsRail({ productId }: { productId: string }) {
  const [items, setItems] = useState<SimilarRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/products/${encodeURIComponent(productId)}/similar?limit=10`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d: ApiResponse) => {
        if (cancelled) return;
        setItems(d.similar ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (loading) {
    return <div className="similar-rail-skeleton" aria-hidden="true" />;
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <section
      className="similar-products-rail border-t border-white/6 px-5 py-3 pb-5"
      aria-labelledby={`similar-rail-${productId}`}
    >
      <h3
        id={`similar-rail-${productId}`}
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/30"
      >
        More like this
      </h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((item) => {
          const p = item.products;
          if (!p) return null;
          return (
            <a
              key={item.similar_id}
              href={`/products/${encodeURIComponent(p.sku)}`}
              className="flex-shrink-0 w-28 rounded-md bg-white/4 border border-white/6 p-2 hover:bg-white/8 transition-colors"
              aria-label={`${p.name ?? p.sku} — ${Math.round(item.score * 100)}% match`}
            >
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.image_url}
                  alt={p.name ?? p.sku}
                  loading="lazy"
                  className="w-full h-20 object-contain mb-1"
                />
              ) : (
                <div className="w-full h-20 bg-white/4 rounded mb-1" />
              )}
              <div className="text-[10px] text-white/70 line-clamp-2 mb-1">
                {p.name ?? p.sku}
              </div>
              {p.price != null && (
                <div className="text-[10px] text-white/45">
                  {p.price.toLocaleString()} THB
                </div>
              )}
              <div className="text-[9px] text-white/35 mt-0.5">
                {Math.round(item.score * 100)}% match
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
