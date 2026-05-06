"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, GripHorizontal, ChevronDown } from "lucide-react";
import type { CategoryScope, ExploreProduct } from "@/lib/explore/types";
import { getAccent, getAccentRgb } from "@/lib/explore/category-config";
import { ProductImage } from "@/components/ProductImage";
import ProductFilters from "./ProductFilters";
import ProductDetailCard from "./ProductDetailCard";

interface LocationContext {
  description_short: string | null;
  description_full: string | null;
  key_grapes: string[];
  key_styles: string[];
  climate: string | null;
}

interface Props {
  locationName: string;
  country?: string;
  region?: string;
  subregion?: string;
  category: CategoryScope | null;
  onClose: () => void;
  theme?: "dark" | "light";
}

export default function BottomPanel({
  locationName,
  country,
  region,
  subregion,
  category,
  onClose,
  theme = "dark",
}: Props) {
  const [products, setProducts] = useState<ExploreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedProduct, setSelectedProduct] = useState<ExploreProduct | null>(null);
  const [activeTab, setActiveTab] = useState<"products" | "region">("products");
  const [locationContext, setLocationContext] = useState<LocationContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const accent = getAccent(category);
  const accentRgb = getAccentRgb(category);

  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (country) params.set("country", country);
        if (region) params.set("region", region);
        if (subregion) params.set("subregion", subregion);
        if (category) params.set("category", category);
        params.set("sort", "popular");
        params.set("page", "1");
        params.set("limit", "20");

        // Append product filters
        for (const [key, value] of Object.entries(filters)) {
          if (value) params.set(key, value);
        }

        const res = await fetch(`/api/explore/products?${params}`);
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        setProducts(data.products);
        setTotalCount(data.total);
      } catch {
        // Silently fail — show empty
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, [country, region, subregion, category, filters]);

  // Fetch location context for Region tab
  useEffect(() => {
    let cancelled = false;
    setContextLoading(true);

    const contextName = subregion || region || country || locationName;
    const contextType = subregion ? "subregion" : region ? "region" : "country";
    const params = new URLSearchParams({ name: contextName, type: contextType });
    if (category) params.set("scope", category);

    fetch(`/api/explore/context?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setLocationContext({
            description_short: data.description_short,
            description_full: data.description_full,
            key_grapes: data.key_grapes ?? [],
            key_styles: data.key_styles ?? [],
            climate: data.climate ?? null,
          });
        } else {
          setLocationContext(null);
        }
      })
      .catch(() => { if (!cancelled) setLocationContext(null); })
      .finally(() => { if (!cancelled) setContextLoading(false); });

    return () => { cancelled = true; };
  }, [locationName, country, region, subregion, category]);

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 rounded-t-2xl shadow-2xl transition-all duration-300 lg:hidden ${
        theme === "light" ? "border-t border-slate-200 bg-white" : "border-t border-white/10 bg-[#12121f]"
      }`}
      style={{ height: expanded ? "85vh" : "100px" }}
    >
      {/* Drag handle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-center py-2"
        aria-label={expanded ? "Collapse panel" : "Expand panel"}
      >
        <GripHorizontal size={20} className={theme === "light" ? "text-slate-300" : "text-white/20"} />
      </button>

      {/* Peek content */}
      <div className="flex items-center justify-between px-4 pb-2">
        <div>
          <h3 className={theme === "light" ? "text-sm font-semibold text-slate-900" : "text-sm font-semibold text-white"}>{locationName}</h3>
          <p className={theme === "light" ? "text-xs text-slate-500" : "text-xs text-white/40"}>{totalCount} products</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className={`flex h-8 items-center gap-1 rounded-lg border px-3 text-xs ${
              theme === "light" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-white/10 bg-white/5 text-white/60"
            }`}
          >
            {expanded ? "Collapse" : "View Products"}
            <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="flex-1 overflow-y-auto pb-4" style={{ maxHeight: "calc(85vh - 80px)" }}>
          {/* Tabs */}
          <div className={theme === "light" ? "flex border-b border-slate-200 px-4" : "flex border-b border-white/[0.08] px-4"}>
            <button
              onClick={() => setActiveTab("products")}
              className={`px-3 py-2 text-xs font-semibold transition-colors ${
                activeTab === "products"
                  ? "border-b-2 text-white"
                  : theme === "light" ? "text-slate-500 hover:text-slate-800" : "text-white/40 hover:text-white/60"
              }`}
              style={activeTab === "products" ? { borderColor: accent } : undefined}
            >
              Products
            </button>
            <button
              onClick={() => setActiveTab("region")}
              className={`px-3 py-2 text-xs font-semibold transition-colors ${
                activeTab === "region"
                  ? theme === "light" ? "border-b-2 text-slate-900" : "border-b-2 text-white"
                  : theme === "light" ? "text-slate-500 hover:text-slate-800" : "text-white/40 hover:text-white/60"
              }`}
              style={activeTab === "region" ? { borderColor: accent } : undefined}
            >
              Region
            </button>
          </div>

          {/* Products tab */}
          {activeTab === "products" && (
            <>
              <ProductFilters category={category} onChange={setFilters} theme={theme} />
              <div className="px-4">
                {loading && (
                  <div className="flex justify-center py-8">
                    <Loader2 size={20} className={theme === "light" ? "animate-spin text-slate-400" : "animate-spin text-white/30"} />
                  </div>
                )}
                {!loading && products.length === 0 && (
                  <p className={theme === "light" ? "py-8 text-center text-sm text-slate-500" : "py-8 text-center text-sm text-white/40"}>No products found</p>
                )}
                <div className="space-y-2">
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
                              &#x0E3F;{p.price?.toLocaleString() ?? "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Region tab */}
          {activeTab === "region" && (
            <div className="px-4 py-4">
              {contextLoading && (
                <div className="space-y-3">
                  <div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-3 w-3/5 animate-pulse rounded bg-white/[0.06]" />
                </div>
              )}
              {!contextLoading && locationContext?.description_short && (
                <p className={theme === "light" ? "text-sm leading-relaxed text-slate-600" : "text-sm leading-relaxed text-white/65"}>
                  {locationContext.description_full || locationContext.description_short}
                </p>
              )}
              {!contextLoading && !locationContext?.description_short && (
                <p className={theme === "light" ? "text-sm text-slate-500" : "text-sm text-white/40"}>No description available for this location.</p>
              )}
              {!contextLoading && locationContext?.key_grapes && locationContext.key_grapes.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                    Key Grapes
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {locationContext.key_grapes.map((g) => (
                      <span
                        key={g}
                        className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-white/70"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!contextLoading && locationContext?.key_styles && locationContext.key_styles.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                    Key Styles
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {locationContext.key_styles.map((s) => (
                      <span
                        key={s}
                        className="rounded-full px-2.5 py-1 text-xs font-medium"
                        style={{ background: `rgba(${accentRgb},0.12)`, color: accent }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!contextLoading && locationContext?.climate && (
                <div className="mt-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/40">
                    Climate
                  </h4>
                  <p className="text-sm text-white/65">{locationContext.climate}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
