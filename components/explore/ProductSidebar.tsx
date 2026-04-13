"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import type { CategoryScope, ExploreProduct } from "@/lib/explore/types";
import { getAccent } from "@/lib/explore/category-config";
import EmptyState from "@/components/explore/EmptyState";
import ProductFilters from "./ProductFilters";

interface Props {
  locationName: string;
  locationSlug: string;
  country?: string;
  region?: string;
  subregion?: string;
  category: CategoryScope | null;
  onClose: () => void;
}

type SortOption = "popular" | "price-asc" | "price-desc" | "newest" | "name";

export default function ProductSidebar({
  locationName,
  locationSlug,
  country,
  region,
  subregion,
  category,
  onClose,
}: Props) {
  const [products, setProducts] = useState<ExploreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [sort, setSort] = useState<SortOption>("popular");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const accent = getAccent(category);

  const fetchProducts = useCallback(
    async (pageNum: number, append = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (country) params.set("country", country);
        if (region) params.set("region", region);
        if (subregion) params.set("subregion", subregion);
        if (category) params.set("category", category);
        params.set("sort", sort);
        params.set("page", String(pageNum));
        params.set("limit", "20");

        // Append product filters
        for (const [key, value] of Object.entries(filters)) {
          if (value) params.set(key, value);
        }

        const res = await fetch(`/api/explore/products?${params}`);
        if (!res.ok) throw new Error("Failed to load products");
        const data = await res.json();

        setProducts((prev) => (append ? [...prev, ...data.products] : data.products));
        setTotalCount(data.total);
      } catch (err) {
        setError("Couldn't load products. Try again.");
      } finally {
        setLoading(false);
      }
    },
    [country, region, subregion, category, sort, filters]
  );

  // Fetch on mount and when filters change
  useEffect(() => {
    setPage(1);
    fetchProducts(1);
  }, [fetchProducts]);

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || loading) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      if (products.length < totalCount) {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchProducts(nextPage, true);
      }
    }
  }, [loading, products.length, totalCount, page, fetchProducts]);

  return (
    <div className="fixed right-0 top-0 z-40 flex h-full w-[380px] flex-col border-l border-white/8 bg-[#12121f] shadow-2xl max-lg:hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
        <button
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none"
          aria-label="Close sidebar"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="truncate text-sm font-semibold text-white">{locationName}</h2>
          <p className="text-xs text-white/40">{totalCount} product{totalCount !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2">
        <label className="text-xs text-white/40">Sort:</label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none"
        >
          <option value="popular">Popular</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="newest">Newest</option>
          <option value="name">Name A-Z</option>
        </select>
      </div>

      {/* Filters */}
      <ProductFilters
        category={category}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
      />

      {/* Product list */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-2">
        {products.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-white/6 bg-white/3 p-3 transition-colors hover:bg-white/6"
          >
            <h3 className="text-sm font-medium text-white leading-snug">{p.name}</h3>
            <div className="mt-1 flex items-center gap-2 text-xs text-white/50">
              {p.brand && <span>{p.brand}</span>}
              {p.grape_variety && <span>{p.grape_variety}</span>}
              {p.vintage && <span>{p.vintage}</span>}
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">
                ฿{p.price?.toLocaleString() ?? "N/A"}
              </span>
              {p.classification && (
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/40">
                  {p.classification}
                </span>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-white/30" />
          </div>
        )}

        {error && (
          <div className="py-8 text-center">
            <p className="text-sm text-white/50">{error}</p>
            <button
              onClick={() => fetchProducts(page)}
              className="mt-2 rounded-lg px-4 py-1.5 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none"
              style={{ background: accent }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && products.length === 0 && (
          <EmptyState category={category} locationName={locationName} />
        )}

        {!loading && products.length > 0 && products.length < totalCount && (
          <p className="py-2 text-center text-xs text-white/30">
            Showing {products.length} of {totalCount}
          </p>
        )}
      </div>
    </div>
  );
}
