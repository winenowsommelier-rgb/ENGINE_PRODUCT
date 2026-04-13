"use client";

import { X } from "lucide-react";
import type { CategoryScope, TaxRegion } from "@/lib/explore/types";
import { getAccent, getAccentRgb } from "@/lib/explore/category-config";
import { getCount, getCountryById } from "@/lib/explore/taxonomy-utils";

interface Props {
  region: TaxRegion;
  category: CategoryScope | null;
  onExplore: () => void;
  onClose: () => void;
}

export default function RegionCard({ region, category, onExplore, onClose }: Props) {
  const country = getCountryById(region.parentId);
  const count = getCount(region.counts, category);
  const accent = getAccent(category);
  const accentRgb = getAccentRgb(category);
  const pr = region.priceRange;
  const priceStr = pr.min && pr.max
    ? `฿${pr.min.toLocaleString()}–฿${pr.max.toLocaleString()}`
    : null;

  return (
    <div
      className="absolute left-8 top-24 z-30 w-[320px] rounded-2xl border border-white/8 shadow-2xl"
      style={{ background: "rgba(10,10,26,0.88)", backdropFilter: "blur(20px)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between p-4 pb-2">
        <div>
          <h3 className="text-lg font-semibold text-white">{region.name}</h3>
          <p className="text-sm text-white/50">
            {country?.name}
            {category && (
              <span
                className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ background: `rgba(${accentRgb},0.2)`, color: accent }}
              >
                {category}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Close region card"
        >
          <X size={16} />
        </button>
      </div>

      {/* Description */}
      {region.description && (
        <p className="px-4 pb-2 text-sm text-white/60 leading-relaxed">
          {region.description}
        </p>
      )}

      {/* Key grapes */}
      {region.keyGrapes && region.keyGrapes.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pb-2">
          {region.keyGrapes.map((g) => (
            <span
              key={g}
              className="rounded-full bg-white/8 px-2.5 py-0.5 text-xs text-white/60"
            >
              {g}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="border-t border-white/8 px-4 py-3">
        <p className="text-sm text-white/70">
          <span className="font-semibold text-white">{count}</span> product{count !== 1 ? "s" : ""}
          {priceStr && <span className="ml-2 text-white/40">{priceStr}</span>}
        </p>
      </div>

      {/* CTA */}
      {count > 0 && (
        <div className="border-t border-white/8 p-4 pt-3">
          <button
            onClick={onExplore}
            className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110"
            style={{ background: accent }}
          >
            Explore Products
          </button>
        </div>
      )}
    </div>
  );
}
