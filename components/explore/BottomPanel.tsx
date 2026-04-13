"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, GripHorizontal, ChevronDown } from "lucide-react";
import type { CategoryScope, ExploreProduct } from "@/lib/explore/types";
import { getAccent } from "@/lib/explore/category-config";

interface Props {
  locationName: string;
  country?: string;
  region?: string;
  subregion?: string;
  category: CategoryScope | null;
  onClose: () => void;
}

export default function BottomPanel({
  locationName,
  country,
  region,
  subregion,
  category,
  onClose,
}: Props) {
  const [products, setProducts] = useState<ExploreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const accent = getAccent(category);

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
  }, [country, region, subregion, category]);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 rounded-t-2xl border-t border-white/10 bg-[#12121f] shadow-2xl transition-all duration-300 lg:hidden"
      style={{ height: expanded ? "85vh" : "100px" }}
    >
      {/* Drag handle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-center py-2"
        aria-label={expanded ? "Collapse panel" : "Expand panel"}
      >
        <GripHorizontal size={20} className="text-white/20" />
      </button>

      {/* Peek content */}
      <div className="flex items-center justify-between px-4 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-white">{locationName}</h3>
          <p className="text-xs text-white/40">{totalCount} products</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-white/60"
          >
            {expanded ? "Collapse" : "View Products"}
            <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Expanded product list */}
      {expanded && (
        <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ maxHeight: "calc(85vh - 80px)" }}>
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-white/30" />
            </div>
          )}

          {!loading && products.length === 0 && (
            <p className="py-8 text-center text-sm text-white/40">No products found</p>
          )}

          <div className="space-y-2">
            {products.map((p) => (
              <div key={p.id} className="rounded-xl border border-white/6 bg-white/3 p-3">
                <h3 className="text-sm font-medium text-white">{p.name}</h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-white/50">
                  {p.brand && <span>{p.brand}</span>}
                  {p.vintage && <span>{p.vintage}</span>}
                </div>
                <p className="mt-1 text-sm font-semibold text-white">
                  ฿{p.price?.toLocaleString() ?? "N/A"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
