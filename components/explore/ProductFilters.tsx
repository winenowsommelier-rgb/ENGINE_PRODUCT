"use client";

import { useCallback, useState, useRef } from "react";
import type { CategoryScope } from "@/lib/explore/types";

/* ──────────────────────────────────────────────────
   Filter chip definitions per category
   ────────────────────────────────────────────────── */

interface ChipGroup {
  label: string;
  paramKey: string;
  options: string[];
}

const WINE_CHIPS: ChipGroup[] = [
  {
    label: "Color",
    paramKey: "wine_color",
    options: ["Red", "White", "Rosé", "Sparkling"],
  },
  {
    label: "Grape",
    paramKey: "grape_variety",
    options: [
      "Cabernet Sauvignon",
      "Merlot",
      "Pinot Noir",
      "Chardonnay",
      "Sauvignon Blanc",
      "Syrah",
      "Tempranillo",
      "Riesling",
      "Malbec",
      "Grenache",
    ],
  },
];

const SPIRITS_CHIPS: ChipGroup[] = [
  {
    label: "Item Category",
    paramKey: "classification",
    options: ["Whisky", "Gin", "Rum", "Tequila", "Vodka", "Brandy", "Liqueur"],
  },
];

const BEER_CHIPS: ChipGroup[] = [
  {
    label: "Item Category",
    paramKey: "classification",
    options: ["IPA", "Lager", "Stout", "Ale"],
  },
];

const SAKE_CHIPS: ChipGroup[] = [
  {
    label: "Item Category",
    paramKey: "classification",
    options: ["Junmai", "Daiginjo", "Honjozo"],
  },
];

const ALL_CHIPS: ChipGroup[] = [
  {
    label: "Item Category",
    paramKey: "classification",
    options: [
      "Red Wine",
      "White Wine",
      "Whisky",
      "Gin",
      "Rum",
      "Vodka",
      "Brandy",
      "IPA",
      "Lager",
    ],
  },
];

function getChipGroups(category: CategoryScope | null): ChipGroup[] {
  switch (category) {
    case "wine":
      return WINE_CHIPS;
    case "spirits":
      return SPIRITS_CHIPS;
    case "beer":
      return BEER_CHIPS;
    case "sake":
      return SAKE_CHIPS;
    default:
      return ALL_CHIPS;
  }
}

/* ──────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────── */

interface Props {
  category: CategoryScope | null;
  onChange: (filters: Record<string, string>) => void;
  theme?: "dark" | "light";
}

export default function ProductFilters({ category, onChange, theme = "dark" }: Props) {
  const [open, setOpen] = useState(false);

  // Selected chips: paramKey -> Set of selected values
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  // Price range
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  const priceMinRef = useRef<HTMLInputElement>(null);
  const priceMaxRef = useRef<HTMLInputElement>(null);

  const chipGroups = getChipGroups(category);

  // Build filter params from current state
  const buildParams = useCallback(
    (sel: Record<string, Set<string>>, pMin: string, pMax: string) => {
      const params: Record<string, string> = {};
      for (const [key, values] of Object.entries(sel)) {
        if (values.size > 0) {
          params[key] = Array.from(values).join(",");
        }
      }
      if (pMin && Number(pMin) > 0) params.price_min = pMin;
      if (pMax && Number(pMax) > 0) params.price_max = pMax;
      return params;
    },
    []
  );

  const toggleChip = useCallback(
    (paramKey: string, value: string) => {
      setSelected((prev) => {
        const next = { ...prev };
        const set = new Set(prev[paramKey] ?? []);
        if (set.has(value)) {
          set.delete(value);
        } else {
          set.add(value);
        }
        next[paramKey] = set;
        onChange(buildParams(next, priceMin, priceMax));
        return next;
      });
    },
    [onChange, buildParams, priceMin, priceMax]
  );

  const applyPrice = useCallback(() => {
    onChange(buildParams(selected, priceMin, priceMax));
  }, [onChange, buildParams, selected, priceMin, priceMax]);

  const handlePriceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyPrice();
    },
    [applyPrice]
  );

  const clearAll = useCallback(() => {
    setSelected({});
    setPriceMin("");
    setPriceMax("");
    onChange({});
  }, [onChange]);

  // Count active filters
  const activeCount =
    Object.values(selected).reduce((n, s) => n + s.size, 0) +
    (priceMin ? 1 : 0) +
    (priceMax ? 1 : 0);

  return (
    <div className={theme === "light" ? "border-b border-slate-200" : "border-b border-white/8"}>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-between px-4 py-2 text-xs transition-colors ${
          theme === "light" ? "text-slate-500 hover:text-slate-800" : "text-white/50 hover:text-white/70"
        }`}
      >
        <span className="flex items-center gap-1.5">
          Filters
          {activeCount > 0 && (
            <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
              theme === "light" ? "bg-slate-900 text-white" : "bg-white/15 text-white"
            }`}>
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-[10px]">{open ? "\u25B4" : "\u25BE"}</span>
      </button>

      {/* Filter panel */}
      {open && (
        <div className="px-4 pb-3 space-y-3">
          {/* Chip groups */}
          {chipGroups.map((group) => (
            <div key={group.paramKey + group.label}>
              <p className={theme === "light" ? "mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400" : "mb-1.5 text-[10px] font-medium uppercase tracking-wider text-white/30"}>
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.options.map((opt) => {
                  const isActive = selected[group.paramKey]?.has(opt) ?? false;
                  return (
                    <button
                      key={opt}
                      onClick={() => toggleChip(group.paramKey, opt)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        isActive
                          ? theme === "light"
                            ? "border-slate-900/15 bg-slate-900 text-white"
                            : "border-white/30 bg-white/15 text-white"
                          : theme === "light"
                            ? "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            : "border-white/10 bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Price range */}
          <div>
            <p className={theme === "light" ? "mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400" : "mb-1.5 text-[10px] font-medium uppercase tracking-wider text-white/30"}>
              Price (฿)
            </p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className={theme === "light" ? "absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400" : "absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-white/30"}>
                  ฿
                </span>
                <input
                  ref={priceMinRef}
                  type="number"
                  placeholder="Min"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  onBlur={applyPrice}
                  onKeyDown={handlePriceKeyDown}
                  className={`w-full rounded-md border py-1.5 pl-5 pr-2 text-xs outline-none ${
                    theme === "light"
                      ? "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-slate-400"
                      : "border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-white/20"
                  }`}
                />
              </div>
              <span className={theme === "light" ? "text-[10px] text-slate-400" : "text-[10px] text-white/25"}>&ndash;</span>
              <div className="relative flex-1">
                <span className={theme === "light" ? "absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400" : "absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-white/30"}>
                  ฿
                </span>
                <input
                  ref={priceMaxRef}
                  type="number"
                  placeholder="Max"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  onBlur={applyPrice}
                  onKeyDown={handlePriceKeyDown}
                  className={`w-full rounded-md border py-1.5 pl-5 pr-2 text-xs outline-none ${
                    theme === "light"
                      ? "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-slate-400"
                      : "border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:border-white/20"
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Clear all */}
          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className={`text-[11px] underline underline-offset-2 transition-colors ${
                theme === "light"
                  ? "text-slate-500 decoration-slate-300 hover:text-slate-900"
                  : "text-white/40 decoration-white/20 hover:text-white/60"
              }`}
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
