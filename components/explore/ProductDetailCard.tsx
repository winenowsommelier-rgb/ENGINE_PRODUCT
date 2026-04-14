"use client";

import { useEffect, useCallback } from "react";
import { X, Grape, UtensilsCrossed } from "lucide-react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";
import type { ExploreProduct, CategoryScope } from "@/lib/explore/types";
import { getAccent, getAccentRgb } from "@/lib/explore/category-config";
import { ProductImage } from "@/components/ProductImage";

interface ProductDetailCardProps {
  product: ExploreProduct;
  category: CategoryScope | null;
  onClose: () => void;
}

/* ── Helpers ─────────────────────────────────────── */

function scaleTier(val?: string): number {
  if (!val) return 0;
  const map: Record<string, number> = {
    low: 1,
    light: 1,
    "medium-": 1.5,
    "medium minus": 1.5,
    medium: 2,
    "medium+": 2.5,
    "medium plus": 2.5,
    high: 3,
    full: 3,
  };
  return map[val.toLowerCase().trim()] ?? 0;
}

function hasWineDimensions(p: ExploreProduct): boolean {
  return !!(p.wine_body || p.wine_acidity || p.wine_tannin);
}

function parseTags(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ── Component ───────────────────────────────────── */

export default function ProductDetailCard({
  product,
  category,
  onClose,
}: ProductDetailCardProps) {
  const accent = getAccent(category);
  const accentRgb = getAccentRgb(category);

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

  const flavorTags = parseTags(product.flavor_tags);
  const foodTags = parseTags(product.food_matching);

  const radarData = hasWineDimensions(product)
    ? [
        { name: "Body", value: scaleTier(product.wine_body) },
        { name: "Acidity", value: scaleTier(product.wine_acidity) },
        { name: "Tannin", value: scaleTier(product.wine_tannin) },
      ]
    : null;

  const isWine =
    (product.classification || "").toLowerCase().includes("wine") ||
    (product.classification || "").toLowerCase().includes("champagne");

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Card */}
      <div
        className="relative max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-2xl border border-white/8 bg-[#12121f] shadow-2xl animate-card-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
          aria-label="Close detail"
        >
          <X size={16} />
        </button>

        {/* ── Hero section ─────────────────────────── */}
        <div className="flex gap-4 p-5 pb-4">
          {/* Image */}
          <ProductImage
            src={product.image_url}
            alt={product.name}
            sku={product.sku}
            classification={product.classification}
            size="xl"
            className="!w-[100px] !h-[140px] rounded-xl border border-white/6"
          />

          {/* Info */}
          <div className="flex flex-1 flex-col justify-center min-w-0 pr-6">
            <h2 className="text-base font-semibold text-white leading-snug">
              {product.name}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/50">
              {product.brand && <span>{product.brand}</span>}
              {product.brand && product.vintage && (
                <span className="text-white/20">·</span>
              )}
              {product.vintage && <span>{product.vintage}</span>}
            </div>
            {product.grape_variety && (
              <p className="mt-1 text-xs text-white/40 flex items-center gap-1">
                <Grape size={11} className="text-white/30" />
                {product.grape_variety}
              </p>
            )}
            <p className="mt-2 text-lg font-bold text-white">
              ฿{product.price?.toLocaleString() ?? "N/A"}
            </p>
          </div>
        </div>

        {/* ── Badges ───────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5 border-t border-white/6 px-5 py-3">
          {product.classification && (
            <Badge label={product.classification} accent={accent} />
          )}
          {product.wine_color && (
            <Badge label={product.wine_color} />
          )}
          {product.country && <Badge label={product.country} />}
          {product.region && <Badge label={product.region} />}
          {product.subregion && <Badge label={product.subregion} />}
        </div>

        {/* ── Description ──────────────────────────── */}
        {product.desc_en_short && (
          <div className="border-t border-white/6 px-5 py-3">
            <p className="text-xs leading-relaxed text-white/50">
              {product.desc_en_short}
            </p>
          </div>
        )}

        {/* ── Flavor Radar ─────────────────────────── */}
        {radarData && isWine && (
          <div className="border-t border-white/6 px-5 py-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/30">
              Wine Profile
            </h3>
            <div className="mx-auto" style={{ width: 220, height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis
                    dataKey="name"
                    tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
                  />
                  <Radar
                    dataKey="value"
                    stroke={accent}
                    fill={`rgba(${accentRgb},0.25)`}
                    fillOpacity={1}
                    strokeWidth={1.5}
                    dot={{ r: 3, fill: accent }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 flex justify-center gap-4 text-[10px] text-white/35">
              {product.wine_body && <span>Body: {product.wine_body}</span>}
              {product.wine_acidity && (
                <span>Acidity: {product.wine_acidity}</span>
              )}
              {product.wine_tannin && (
                <span>Tannin: {product.wine_tannin}</span>
              )}
            </div>
          </div>
        )}

        {/* ── Flavor Tags ──────────────────────────── */}
        {flavorTags.length > 0 && (
          <div className="border-t border-white/6 px-5 py-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/30">
              Flavor Notes
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {flavorTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full px-2.5 py-0.5 text-[10px] font-medium"
                  style={{
                    background: `rgba(${accentRgb},0.15)`,
                    color: accent,
                    border: `1px solid rgba(${accentRgb},0.25)`,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Food Matching ────────────────────────── */}
        {foodTags.length > 0 && (
          <div className="border-t border-white/6 px-5 py-3 pb-5">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/30 flex items-center gap-1">
              <UtensilsCrossed size={11} />
              Food Pairing
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {foodTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-white/6 px-2.5 py-0.5 text-[10px] text-white/45 border border-white/8"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Keyframe for card entry animation */}
      <style jsx global>{`
        @keyframes card-in {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(12px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .animate-card-in {
          animation: card-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

/* ── Badge sub-component ─────────────────────────── */

function Badge({ label, accent }: { label: string; accent?: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={
        accent
          ? {
              background: `${accent}20`,
              color: accent,
              border: `1px solid ${accent}30`,
            }
          : {
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.08)",
            }
      }
    >
      {label}
    </span>
  );
}
