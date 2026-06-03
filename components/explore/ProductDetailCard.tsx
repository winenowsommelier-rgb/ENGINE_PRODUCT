"use client";

import { useEffect, useCallback } from "react";
import { X } from "lucide-react";
import type { ExploreProduct, CategoryScope } from "@/lib/explore/types";
import { ProductDetailPanel } from "@/components/product/ProductDetailPanel";

interface ProductDetailCardProps {
  product: ExploreProduct;
  category: CategoryScope | null;
  onClose: () => void;
  theme?: "dark" | "light";
}

export default function ProductDetailCard({
  product,
  category,
  onClose,
  theme = "dark",
}: ProductDetailCardProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  return (
    /* Backdrop */
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm ${
        theme === "light" ? "bg-slate-900/20" : "bg-black/60"
      }`}
      onClick={onClose}
    >
      {/* Modal card */}
      <div
        className={`relative max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-2xl border shadow-2xl animate-card-in ${
          theme === "light" ? "border-slate-200 bg-white" : "border-white/[0.08] bg-[#111827]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none ${
            theme === "light"
              ? "text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              : "text-slate-400 hover:bg-white/10 hover:text-white"
          }`}
          aria-label="Close detail"
        >
          <X size={16} />
        </button>

        <ProductDetailPanel product={product} theme={theme} category={category} />
      </div>
    </div>
  );
}
