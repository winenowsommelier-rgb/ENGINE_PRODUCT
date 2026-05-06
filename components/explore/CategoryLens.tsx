"use client";

import type { CategoryScope } from "@/lib/explore/types";
import { CATEGORIES, getAccent } from "@/lib/explore/category-config";

interface Props {
  active: CategoryScope | null;
  onSelect: (category: CategoryScope | null) => void;
  theme?: "dark" | "light";
}

export default function CategoryLens({ active, onSelect, theme = "dark" }: Props) {
  const inactiveBackground = theme === "light" ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,0.06)";
  const inactiveColor = theme === "light" ? "rgba(15,23,42,0.68)" : "rgba(255,255,255,0.6)";
  const inactiveBorder = theme === "light" ? "1px solid rgba(15,23,42,0.08)" : "1px solid rgba(255,255,255,0.08)";
  const activeText = "#ffffff";
  return (
    <div className="flex items-center gap-1.5">
      {/* "All" pill */}
      <button
        onClick={() => onSelect(null)}
        className="rounded-full px-4 py-1.5 min-h-[44px] text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none"
        style={{
          background: active === null ? "rgba(74,144,217,0.25)" : inactiveBackground,
          color: active === null ? activeText : inactiveColor,
          border: active === null ? "1px solid rgba(74,144,217,0.4)" : inactiveBorder,
        }}
      >
        All
      </button>
      {CATEGORIES.map((cat) => (
        <button
          key={cat.key}
          onClick={() => onSelect(cat.key)}
          className="rounded-full px-4 py-1.5 min-h-[44px] text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none"
          style={{
            background: active === cat.key ? `rgba(${cat.accentRgb},0.25)` : inactiveBackground,
            color: active === cat.key ? activeText : inactiveColor,
            border: active === cat.key ? `1px solid rgba(${cat.accentRgb},0.4)` : inactiveBorder,
          }}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
