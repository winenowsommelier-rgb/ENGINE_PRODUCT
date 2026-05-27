"use client";

import { useEffect, useCallback } from "react";
import { X, Grape, UtensilsCrossed } from "lucide-react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";
import type { ExploreProduct, CategoryScope } from "@/lib/explore/types";
import { getAccent, getAccentRgb } from "@/lib/explore/category-config";
import { ProductImage } from "@/components/ProductImage";
import { TasteProfileSection, type TasteProfile } from "@/components/product/TasteProfileSection";
import { SimilarProductsRail } from "@/components/product/SimilarProductsRail";

interface ProductDetailCardProps {
  product: ExploreProduct;
  category: CategoryScope | null;
  onClose: () => void;
  theme?: "dark" | "light";
}

/* ── Helpers ─────────────────────────────────────── */

function scaleTier(val?: string | null): number {
  if (!val) return 0;
  // Map every value the AI can produce per data/lib/enrichment/wine/taxonomies.py:
  //   body:    Light | Medium | Medium-Full | Full
  //   acidity: Low   | Medium | Medium-High | High
  //   tannin:  Low   | Medium | Medium-High | High
  // Plus legacy v1 spellings (medium-, medium+, medium minus/plus).
  const map: Record<string, number> = {
    low: 1,
    light: 1,
    "medium-": 1.5,
    "medium minus": 1.5,
    medium: 2,
    "medium+": 2.5,
    "medium plus": 2.5,
    "medium-high": 2.5,
    "medium-full": 2.5,
    high: 3,
    full: 3,
  };
  return map[val.toLowerCase().trim()] ?? 0;
}

function hasWineDimensions(p: ExploreProduct): boolean {
  return !!(p.wine_body || p.wine_acidity || p.wine_tannin);
}

function parseTags(raw?: string | string[] | null): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  return String(raw)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ── Section heading ─────────────────────────────── */
function SectionHeading({
  children,
  theme,
  icon,
}: {
  children: React.ReactNode;
  theme: "dark" | "light";
  icon?: React.ReactNode;
}) {
  return (
    <h3
      className={`mb-2.5 text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
        theme === "light" ? "text-slate-500" : "text-slate-400"
      }`}
    >
      {icon}
      {children}
    </h3>
  );
}

/* ── Component ───────────────────────────────────── */

export default function ProductDetailCard({
  product,
  category,
  onClose,
  theme = "dark",
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
  const foodTags   = parseTags(product.food_matching);

  // Always render all three axes when ANY structural dimension is populated.
  // Previously this filtered out axes scoring 0, which (a) hid axes whose
  // values weren't in the legacy scaleTier map (e.g. "Medium-Full"), and
  // (b) collapsed the radar into a wedge for white wines where tannin is
  // legitimately null. The radar shape should communicate "Body N, Acidity
  // M, Tannin 0" honestly rather than vanish axes.
  const radarData = hasWineDimensions(product)
    ? [
        { name: "Body",    value: scaleTier(product.wine_body) },
        { name: "Acidity", value: scaleTier(product.wine_acidity) },
        { name: "Tannin",  value: scaleTier(product.wine_tannin) },
      ]
    : null;

  const isWine =
    (product.classification || "").toLowerCase().includes("wine") ||
    (product.classification || "").toLowerCase().includes("champagne");

  /* ── Theme tokens ────────────────────────────── */
  const t = {
    card:         theme === "light" ? "border-slate-200 bg-white"        : "border-white/[0.08] bg-[#111827]",
    divider:      theme === "light" ? "border-slate-100"                 : "border-white/[0.07]",
    nameText:     theme === "light" ? "text-slate-900"                   : "text-white",
    metaText:     theme === "light" ? "text-slate-500"                   : "text-slate-400",
    dotSep:       theme === "light" ? "text-slate-300"                   : "text-slate-600",
    descText:     theme === "light" ? "text-slate-600"                   : "text-slate-300",
    sectionBg:    theme === "light" ? "bg-slate-50"                      : "bg-white/[0.02]",
    radarLabel:   theme === "light" ? "rgba(71,85,105,0.9)"              : "rgba(226,232,240,0.85)",
    radarGrid:    theme === "light" ? "rgba(0,0,0,0.08)"                 : "rgba(255,255,255,0.1)",
    radarValText: theme === "light" ? "text-slate-500"                   : "text-slate-400",
    tagBg:        theme === "light" ? "bg-slate-100 text-slate-700 border-slate-200" : "",
    foodTagBg:    theme === "light" ? "bg-slate-100 text-slate-700 border-slate-200" : "bg-white/[0.06] text-slate-300 border-white/10",
    pairingText:  theme === "light" ? "text-slate-600"                   : "text-slate-300",
    closeBtn:     theme === "light" ? "text-slate-400 hover:bg-slate-100 hover:text-slate-900" : "text-slate-400 hover:bg-white/10 hover:text-white",
    imageBorder:  theme === "light" ? "border-slate-200"                 : "border-white/[0.06]",
  };

  return (
    /* Backdrop */
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm ${
        theme === "light" ? "bg-slate-900/20" : "bg-black/60"
      }`}
      onClick={onClose}
    >
      {/* Card */}
      <div
        className={`relative max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-2xl border shadow-2xl animate-card-in ${t.card}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none ${t.closeBtn}`}
          aria-label="Close detail"
        >
          <X size={16} />
        </button>

        {/* ── Hero section ─────────────────────────── */}
        <div className="flex gap-4 p-5 pb-4">
          <ProductImage
            src={product.image_url}
            alt={product.name}
            sku={product.sku}
            classification={product.classification}
            size="xl"
            className={`!w-[100px] !h-[140px] rounded-xl border ${t.imageBorder}`}
          />

          <div className="flex flex-1 flex-col justify-center min-w-0 pr-6">
            <h2 className={`text-base font-semibold leading-snug ${t.nameText}`}>
              {product.name}
            </h2>

            {(product.brand || product.vintage) && (
              <div className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${t.metaText}`}>
                {product.brand && <span>{product.brand}</span>}
                {product.brand && product.vintage && (
                  <span className={t.dotSep}>·</span>
                )}
                {product.vintage && <span>{product.vintage}</span>}
              </div>
            )}

            {product.grape_variety && (
              <p className={`mt-1.5 flex items-center gap-1 text-xs ${t.metaText}`}>
                <Grape size={11} className={t.metaText} />
                {product.grape_variety}
              </p>
            )}

            <p className={`mt-2.5 text-lg font-bold ${t.nameText}`}>
              ฿{product.price?.toLocaleString() ?? "N/A"}
            </p>
          </div>
        </div>

        {/* ── Badges ───────────────────────────────── */}
        <div className={`flex flex-wrap gap-1.5 border-t ${t.divider} px-5 py-3`}>
          {product.classification && (
            <Badge label={product.classification} accent={accent} theme={theme} />
          )}
          {product.wine_color && <Badge label={product.wine_color} theme={theme} />}
          {product.country   && <Badge label={product.country}    theme={theme} />}
          {product.region    && <Badge label={product.region}     theme={theme} />}
          {product.subregion && <Badge label={product.subregion}  theme={theme} />}
        </div>

        {/* ── Description ──────────────────────────── */}
        {product.desc_en_short && (
          <div className={`border-t ${t.divider} px-5 py-3`}>
            <p className={`text-xs leading-relaxed ${t.descText}`}>
              {product.desc_en_short}
            </p>
          </div>
        )}

        {/* ── Wine Profile Radar ───────────────────── */}
        {radarData && radarData.filter((d) => d.value > 0).length >= 2 && isWine && (
          <div className={`border-t ${t.divider} px-5 py-4`}>
            <SectionHeading theme={theme}>Wine Profile</SectionHeading>
            <div className="mx-auto" style={{ width: 240, height: 190 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="68%">
                  <PolarGrid stroke={t.radarGrid} />
                  <PolarAngleAxis
                    dataKey="name"
                    tick={{ fill: t.radarLabel, fontSize: 12, fontWeight: 500 }}
                  />
                  {/* Fixed 0-3 domain so Body=Medium looks the same across wines —
                      otherwise recharts auto-scales each chart to its own max
                      and a Medium-bodied wine would look full-bodied. */}
                  <PolarRadiusAxis domain={[0, 3]} tick={false} axisLine={false} />
                  <Radar
                    dataKey="value"
                    stroke={accent}
                    fill={`rgba(${accentRgb},0.22)`}
                    fillOpacity={1}
                    strokeWidth={2}
                    dot={{ r: 3.5, fill: accent, strokeWidth: 0 }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className={`mt-2 flex justify-center gap-5 text-[11px] font-medium ${t.radarValText}`}>
              {product.wine_body    && <span>Body: <span className={t.nameText}>{product.wine_body}</span></span>}
              {product.wine_acidity && <span>Acidity: <span className={t.nameText}>{product.wine_acidity}</span></span>}
              {product.wine_tannin  && <span>Tannin: <span className={t.nameText}>{product.wine_tannin}</span></span>}
            </div>
          </div>
        )}

        {/* ── Flavor Notes ─────────────────────────── */}
        {flavorTags.length > 0 && (
          <div className={`border-t ${t.divider} px-5 py-3`}>
            <SectionHeading theme={theme}>Flavor Notes</SectionHeading>
            <div className="flex flex-wrap gap-1.5">
              {flavorTags.map((tag) =>
                theme === "light" ? (
                  <span
                    key={tag}
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
                  >
                    {tag}
                  </span>
                ) : (
                  <span
                    key={tag}
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{
                      background: `rgba(${accentRgb},0.15)`,
                      color: accent,
                      border: `1px solid rgba(${accentRgb},0.3)`,
                    }}
                  >
                    {tag}
                  </span>
                )
              )}
            </div>
          </div>
        )}

        {/* ── Food Pairing ─────────────────────────── */}
        {(foodTags.length > 0 || product.pairing_rationale) && (
          <div className={`border-t ${t.divider} px-5 py-3 pb-5`}>
            <SectionHeading theme={theme} icon={<UtensilsCrossed size={11} />}>
              Food Pairing
            </SectionHeading>

            {foodTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {foodTags.map((tag) => (
                  <span
                    key={tag}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${t.foodTagBg}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {product.pairing_rationale && (
              <p className={`mt-2.5 text-xs leading-relaxed italic ${t.pairingText}`}>
                {product.pairing_rationale}
              </p>
            )}
          </div>
        )}

        {/* ── v2 Taste Profile (feature-flagged) ───── */}
        <TasteProfileSection
          profile={(product.taste_profile as TasteProfile | null) ?? null}
          productId={product.id}
        />

        {/* ── Similar Products rail ─────────────────── */}
        <SimilarProductsRail productId={product.id} />
      </div>
    </div>
  );
}

/* ── Badge sub-component ─────────────────────────── */

function Badge({
  label,
  accent,
  theme,
}: {
  label: string;
  accent?: string;
  theme: "dark" | "light";
}) {
  if (theme === "light") {
    return (
      <span
        className="rounded-full px-2.5 py-0.5 text-[11px] font-medium border"
        style={
          accent
            ? {
                background: `${accent}18`,
                color: accent,
                borderColor: `${accent}35`,
              }
            : {
                background: "#f1f5f9",
                color: "#475569",
                borderColor: "#e2e8f0",
              }
        }
      >
        {label}
      </span>
    );
  }

  // dark
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-medium border"
      style={
        accent
          ? {
              background: `${accent}18`,
              color: accent,
              borderColor: `${accent}35`,
            }
          : {
              background: "rgba(255,255,255,0.07)",
              color: "rgba(226,232,240,0.85)",
              borderColor: "rgba(255,255,255,0.12)",
            }
      }
    >
      {label}
    </span>
  );
}
