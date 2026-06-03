"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CategoryScope, ExploreProduct } from "@/lib/explore/types";
import { getAccent, getAccentRgb } from "@/lib/explore/category-config";
import { ProductImage } from "@/components/ProductImage";
import EmptyState from "@/components/explore/EmptyState";
import ProductFilters from "./ProductFilters";
import ProductDetailCard from "./ProductDetailCard";

interface Props {
  locationName: string;
  locationSlug: string;
  country?: string;
  region?: string;
  subregion?: string;
  category: CategoryScope | null;
  onClose: () => void;
  theme?: "dark" | "light";
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
  theme = "dark",
}: Props) {
  const [products, setProducts] = useState<ExploreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [sort, setSort] = useState<SortOption>("popular");

  // v2 click-a-note filter (URL-driven): if `?note=` is present, surface
  // a dismissible chip so the user knows what's being filtered and can
  // clear it. The actual filtering happens server-side via the search API.
  const router = useRouter();
  const searchParams = useSearchParams();
  const noteFilter = searchParams?.get("note") ?? null;
  const tierFilter = searchParams?.get("tier") ?? null;

  const clearNoteFilter = () => {
    if (!searchParams) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("note");
    next.delete("tier");
    const qs = next.toString();
    router.push(qs ? `?${qs}` : "?");
  };
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedProduct, setSelectedProduct] = useState<ExploreProduct | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const accent = getAccent(category);
  const accentRgb = getAccentRgb(category);

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

  const shellClass =
    theme === "light"
      ? "fixed right-0 top-0 z-40 flex h-full w-[380px] flex-col border-l border-slate-200 bg-white shadow-2xl max-lg:hidden"
      : "fixed right-0 top-0 z-40 flex h-full w-[380px] flex-col border-l border-white/8 bg-[#12121f] shadow-2xl max-lg:hidden";

  return (
    <div className={shellClass}>
      {/* Header */}
      <div className={theme === "light" ? "border-b border-slate-200 px-4 py-4" : "border-b border-white/[0.08] px-4 py-4"}>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none ${
              theme === "light" ? "text-slate-500 hover:bg-slate-100 hover:text-slate-900" : "text-white/50 hover:bg-white/10 hover:text-white"
            }`}
            aria-label="Close sidebar"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className={theme === "light" ? "truncate text-sm font-semibold text-slate-900" : "truncate text-sm font-semibold text-white"}>{locationName}</h2>
            <p className={theme === "light" ? "text-xs text-slate-500" : "text-xs text-white/40"}>
              {totalCount.toLocaleString()} {totalCount === 1 ? "product" : "products"}
            </p>
          </div>
        </div>
      </div>

      {/* v2 note-filter chip */}
      {noteFilter && (
        <div
          className={
            theme === "light"
              ? "flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2"
              : "flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2"
          }
        >
          <span className={theme === "light" ? "text-xs text-amber-900" : "text-xs text-amber-200"}>
            Filtered by note: <strong>{noteFilter}</strong>
            {tierFilter && <span className="opacity-60"> · {tierFilter}</span>}
          </span>
          <button
            onClick={clearNoteFilter}
            className={`ml-auto flex h-5 w-5 items-center justify-center rounded transition-colors ${
              theme === "light" ? "text-amber-700 hover:bg-amber-100" : "text-amber-200 hover:bg-amber-500/20"
            }`}
            aria-label="Clear note filter"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Sort */}
      <div className={theme === "light" ? "flex items-center gap-2 border-b border-slate-200 px-4 py-2" : "flex items-center gap-2 border-b border-white/8 px-4 py-2"}>
        <label className={theme === "light" ? "text-xs text-slate-500" : "text-xs text-white/40"}>Sort:</label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className={`rounded-md border px-2 py-1 text-xs outline-none ${
            theme === "light" ? "border-slate-200 bg-white text-slate-900" : "border-white/10 bg-white/5 text-white"
          }`}
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
        theme={theme}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
      />

      {/* Product list */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-2">
        {products.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedProduct(p)}
            className={`group w-full rounded-xl border p-3 text-left transition-all focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none ${
              theme === "light"
                ? "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-50"
                : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.05]"
            }`}
          >
            <div className="flex gap-3">
              {/* Product image */}
              <div className={`flex h-20 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg ${theme === "light" ? "bg-white" : "bg-white/[0.03]"}`}>
                <ProductImage
                  src={p.image_url}
                  sku={p.sku}
                  classification={p.classification}
                  size="md"
                  className="!w-full !h-full"
                />
              </div>

              {/* Info */}
              <div className="flex flex-1 flex-col min-w-0">
                <h3 className={theme === "light" ? "line-clamp-2 text-sm font-semibold leading-snug text-slate-900" : "line-clamp-2 text-sm font-semibold leading-snug text-white group-hover:text-white"}>
                  {p.name}
                </h3>
                {p.brand && (
                  <p className={theme === "light" ? "mt-0.5 truncate text-xs text-slate-500" : "mt-0.5 truncate text-xs text-white/50"}>{p.brand}</p>
                )}
                <p className={theme === "light" ? "mt-1 truncate text-[11px] text-slate-500" : "mt-1 truncate text-[11px] text-white/40"}>
                  {[p.grape_variety, p.vintage].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  {p.classification ? (
                    <span
                      className="truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ background: `rgba(${accentRgb},0.15)`, color: accent }}
                    >
                      {p.classification}
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className={theme === "light" ? "whitespace-nowrap text-sm font-bold text-slate-900" : "whitespace-nowrap text-sm font-bold text-white"}>
                    ฿{p.price?.toLocaleString() ?? "—"}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className={theme === "light" ? "animate-spin text-slate-400" : "animate-spin text-white/30"} />
          </div>
        )}

        {error && (
          <div className="py-8 text-center">
            <p className={theme === "light" ? "text-sm text-slate-500" : "text-sm text-white/50"}>{error}</p>
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
          <EmptyState category={category} locationName={locationName} theme={theme} />
        )}

        {!loading && products.length > 0 && products.length < totalCount && (
          <p className={theme === "light" ? "py-2 text-center text-xs text-slate-500" : "py-2 text-center text-xs text-white/30"}>
            Showing {products.length} of {totalCount}
          </p>
        )}
      </div>

      {/* Product detail overlay */}
      {selectedProduct && (
        <ProductDetailCard
          product={selectedProduct}
          category={category}
          theme={theme}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
}
