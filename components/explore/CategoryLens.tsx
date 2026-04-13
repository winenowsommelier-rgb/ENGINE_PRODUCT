"use client";

import type { CategoryScope } from "@/lib/explore/types";
import { CATEGORIES, getAccent } from "@/lib/explore/category-config";

interface Props {
  active: CategoryScope | null;
  onSelect: (category: CategoryScope | null) => void;
}

export default function CategoryLens({ active, onSelect }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {/* "All" pill */}
      <button
        onClick={() => onSelect(null)}
        className="rounded-full px-4 py-1.5 text-sm font-medium transition-all"
        style={{
          background: active === null ? "rgba(74,144,217,0.25)" : "rgba(255,255,255,0.06)",
          color: active === null ? "#fff" : "rgba(255,255,255,0.6)",
          border: active === null ? "1px solid rgba(74,144,217,0.4)" : "1px solid rgba(255,255,255,0.08)",
        }}
      >
        All
      </button>
      {CATEGORIES.map((cat) => (
        <button
          key={cat.key}
          onClick={() => onSelect(cat.key)}
          className="rounded-full px-4 py-1.5 text-sm font-medium transition-all"
          style={{
            background: active === cat.key ? `rgba(${cat.accentRgb},0.25)` : "rgba(255,255,255,0.06)",
            color: active === cat.key ? "#fff" : "rgba(255,255,255,0.6)",
            border: active === cat.key ? `1px solid rgba(${cat.accentRgb},0.4)` : "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
