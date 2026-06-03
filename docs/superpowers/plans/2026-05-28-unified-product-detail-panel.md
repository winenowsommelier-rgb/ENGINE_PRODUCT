# Unified ProductDetailPanel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the rich product detail view from `ProductsPage` into a shared `ProductDetailPanel` component so that clicking any product anywhere in the app — catalog list, map sidebar, or mobile bottom panel — shows the same 14-card detail view.

**Architecture:** A new `ProductDetailPanel` component holds all 14 detail cards. `ProductsPage` replaces its inline card JSX with `<ProductDetailPanel>`. `ProductDetailCard` (the modal shell for the explore/map view) strips its card JSX and renders only `<ProductDetailPanel>`. A new `toExploreProduct()` adapter in `lib/explore/adapters.ts` safely casts the `Record<string, unknown>` rows from ProductsPage into `ExploreProduct`. Shared types (`CharDimension`, `RelatedProduct`, `AffinityItem`, `ProductAffinities`) move from ProductsPage-local to `lib/explore/types.ts`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Recharts, Lucide icons. Build verification: `npm run build`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/explore/types.ts` | Modify | Add optional ExploreProduct fields; export 4 shared types |
| `lib/explore/adapters.ts` | **Create** | `toExploreProduct()` adapter; numeric-safe narrowing |
| `components/product/ProductDetailPanel.tsx` | **Create** | 14-card shared detail panel |
| `components/explore/ProductDetailCard.tsx` | Modify | Strip card JSX → thin modal shell forwarding to panel |
| `components/pages/ProductsPage.tsx` | Modify | Remove local type defs; swap inline cards for `<ProductDetailPanel>` |

**Unchanged:** `ProductSidebar`, `BottomPanel`, `TasteProfileSection`, `SimilarProductsRail`, all visualization components.

---

## Task 1: Extend `lib/explore/types.ts`

**Files:**
- Modify: `lib/explore/types.ts`

Add optional fields to `ExploreProduct` and export the four shared types currently buried in ProductsPage.

- [ ] **Step 1: Read the current file**

  Open `lib/explore/types.ts` and verify the current `ExploreProduct` interface ends at line ~133.

- [ ] **Step 2: Add optional fields to ExploreProduct**

  After the `pairing_rationale` line (currently last), append:

  ```ts
  // Extended enrichment fields
  grape_blend_type?: string;
  wine_production_style?: string;
  score_max?: number;
  score_summary?: string;
  full_description?: string;
  // Catalog/internal fields (present from /api/products context)
  wine_classification?: string;
  bottle_size?: string | number;
  alcohol?: string | number;
  validation_status?: string;
  overall_confidence?: number;
  appellation?: string;
  desc_en_full?: string;
  description_en_html?: string;
  short_description_th_wn?: string;
  description_th_wn_text?: string;
  description_th_wn_html?: string;
  queue_priority?: number | string;
  priority_band?: string;
  bi_priority_band?: string;
  product_tier?: string | number;
  enrichment_priority?: string | number;
  product_tier_definition?: string;
  enrichment_note?: string;
  is_primary_variant?: boolean;
  sku_base?: string;
  cost_price?: number;
  ```

- [ ] **Step 3: Export the four shared types at the bottom of the file**

  Append after `ExploreProduct`:

  ```ts
  // Shared types extracted from ProductsPage — used by ProductDetailPanel too.
  export type CharDimension = {
    dimension_key: string;
    label: string;
    description: string;
  };

  export type RelatedProduct = {
    id: string;
    sku: string;
    name: string;
    brand?: string | null;
    classification?: string | null;
    country?: string | null;
    region?: string | null;
    price?: number | string | null;
    currency?: string | null;
    matchReasons?: string[];
    matchScore?: number;
  };

  export type AffinityItem = {
    rank: number;
    base_product_code: string;
    product_name: string;
    rate: number;
    id?: string;
    sku?: string;
    price?: number | string | null;
    currency?: string | null;
  };

  export type ProductAffinities = {
    base_product_code: string;
    co_order_affinities: AffinityItem[];
    co_customer_affinities: AffinityItem[];
  };
  ```

- [ ] **Step 4: Verify build compiles**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run build 2>&1 | tail -5
  ```
  Expected: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
  git add lib/explore/types.ts
  git commit -m "feat(types): extend ExploreProduct; export CharDimension/RelatedProduct/AffinityItem/ProductAffinities"
  ```

---

## Task 2: Create `lib/explore/adapters.ts`

**Files:**
- Create: `lib/explore/adapters.ts`

Safe cast from `Record<string, unknown>` (ProductsPage rows) to `ExploreProduct`. Numeric fields are narrowed with `Number()` + `isFinite()` guard — never passed as raw strings.

- [ ] **Step 1: Create the file**

  ```ts
  // lib/explore/adapters.ts
  /**
   * toExploreProduct — safely cast a raw product Record (as used in ProductsPage)
   * to ExploreProduct so it can be passed to ProductDetailPanel.
   *
   * Rules:
   * - String fields: String() coercion, undefined when falsy.
   * - Numeric fields: Number() + isFinite() guard; undefined when non-finite.
   * - JSON fields (flavor_tags, taste_profile): pass through as-is (already
   *   decoded by the API or by ProductsPage's fetch).
   * - No field is invented — only maps what is present in the raw object.
   */
  import type { ExploreProduct } from "./types";

  function str(v: unknown): string | undefined {
    if (v === null || v === undefined || v === "") return undefined;
    return String(v);
  }

  function num(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  export function toExploreProduct(raw: Record<string, unknown>): ExploreProduct {
    return {
      // Required fields — fall back to empty string to satisfy the type
      id:             String(raw.id ?? ""),
      sku:            String(raw.sku ?? ""),
      name:           String(raw.name ?? ""),
      brand:          String(raw.brand ?? ""),
      classification: String(raw.classification ?? ""),
      country:        String(raw.country ?? ""),
      region:         String(raw.region ?? ""),
      price:          num(raw.price) ?? 0,
      currency:       String(raw.currency ?? "THB"),

      // Optional string fields
      grape_variety:         str(raw.grape_variety),
      vintage:               str(raw.vintage),
      wine_color:            str(raw.wine_color),
      image_url:             str(raw.image_url),
      subregion:             str(raw.subregion),
      appellation:           str(raw.appellation),
      desc_en_short:         str(raw.desc_en_short),
      wine_body:             str(raw.wine_body),
      wine_acidity:          str(raw.wine_acidity),
      wine_tannin:           str(raw.wine_tannin),
      food_matching:         raw.food_matching as string | undefined,
      pairing_rationale:     raw.pairing_rationale as string | null | undefined,
      grape_blend_type:      str(raw.grape_blend_type),
      wine_production_style: str(raw.wine_production_style),
      score_summary:         str(raw.score_summary),
      full_description:      str(raw.full_description),
      wine_classification:   str(raw.wine_classification),
      validation_status:     str(raw.validation_status),
      desc_en_full:          str(raw.desc_en_full),
      description_en_html:   str(raw.description_en_html),
      short_description_th_wn:  str(raw.short_description_th_wn),
      description_th_wn_text:   str(raw.description_th_wn_text),
      description_th_wn_html:   str(raw.description_th_wn_html),
      priority_band:         str(raw.priority_band),
      bi_priority_band:      str(raw.bi_priority_band),
      product_tier_definition: str(raw.product_tier_definition),
      enrichment_note:       str(raw.enrichment_note),
      sku_base:              str(raw.sku_base),

      // Mixed string|number fields — pass through
      bottle_size:          raw.bottle_size as string | number | undefined,
      alcohol:              raw.alcohol as string | number | undefined,
      product_tier:         raw.product_tier as string | number | undefined,
      enrichment_priority:  raw.enrichment_priority as string | number | undefined,
      queue_priority:       raw.queue_priority as number | string | undefined,

      // Numeric fields — guarded
      overall_confidence:   num(raw.overall_confidence),
      score_max:            num(raw.score_max),
      cost_price:           num(raw.cost_price),

      // Boolean
      is_primary_variant: raw.is_primary_variant === true,

      // JSON/unknown pass-through
      flavor_tags:    raw.flavor_tags as string | string[] | undefined,
      taste_profile:  raw.taste_profile,
    };
  }
  ```

- [ ] **Step 2: Verify build compiles**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run build 2>&1 | tail -5
  ```
  Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
  git add lib/explore/adapters.ts
  git commit -m "feat(adapters): add toExploreProduct() adapter with numeric-safe narrowing"
  ```

---

## Task 3: Create `components/product/ProductDetailPanel.tsx`

**Files:**
- Create: `components/product/ProductDetailPanel.tsx`

This is the main new file — all 14 cards, fully themed. It is a direct extraction and generalization of the inline JSX from `ProductsPage`, adapted for the `ExploreProduct` type.

**Key implementation notes before you start:**
- All helper functions needed (`parseTags`, `fmt`, `fmtPrice`, `fmtPct`, `confValue`, `confBadge`, `ConfBar`, `STATUS_COLORS`, `CLASSIFICATION_COLORS`, `classificationBadge`, `TIER_LABELS`, `tierValue`, `tierLabel`, `tierDefinition`, `LangDesc`, `DescView`) live in `ProductsPage.tsx` today. Copy them into this file — do not import from ProductsPage.
- Visualization components (`CharacterRadarChart`, `FlavorWheel`, `BodySweetnessMatrix`, `FoodPairingGrid`, `DataQualityGauge`, `VintageTimeline`) accept `product: Record<string, unknown>`. Cast with `product as Record<string, unknown>` at each call site.
- `taxContextMap` is optional — always guard: `(taxContextMap?.size ?? 0) > 0` and `taxContextMap ? Array.from(taxContextMap.entries()) : []`.
- Origin breadcrumb renders plain text (no `setCountry`/`setRegion` buttons — those callbacks don't exist in explore context).
- `category` prop feeds `getAccent(category)` / `getAccentRgb(category)`. When `category` is undefined/null, these fall back to violet defaults already in the functions.
- Theme token map `t` (same pattern as `ProductDetailCard`) — define once at the top of the component body.
- Card container class: `"bg-white/[0.03] border border-white/[0.06] rounded-xl p-5"` (dark; for light use `"bg-slate-50 border border-slate-200 rounded-xl p-5"`).
- Section heading pattern: `<h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">` for dark, `text-slate-500` for light.
- Panel wrapper: `<div className="flex flex-col space-y-5 px-6 py-5">` — no `max-w`, no fixed height.
- `TasteProfileSection` import from `@/components/product/TasteProfileSection`.
- `SimilarProductsRail` import from `@/components/product/SimilarProductsRail`.
- `ProductImage` import from `@/components/ProductImage`.
- Cards 12 (BI Affinities) and 13 (Comparable Products) are **always rendered** — they show their empty states when `productAffinities` / `relatedProducts` are not passed.
- Card 13 Comparable Products items are **not clickable** in panel context (no `openProduct` callback) — render as `<div>` instead of `<button>`.
- Card 8 (Vintage Timeline) is hidden when `!product.vintage`.
- `TasteProfileSection` is feature-flagged — it already handles this internally; just pass `profile` and `productId`.

- [ ] **Step 1: Create the file with the full implementation**

  ```tsx
  // components/product/ProductDetailPanel.tsx
  "use client";

  import { useState } from "react";
  import {
    MapPin, BarChart3, Layers, Tag, Utensils, FileText,
    Star, Target, PackagePlus, CheckCircle2, Code2, Eye,
  } from "lucide-react";
  import {
    CharacterRadarChart, FlavorWheel, BodySweetnessMatrix,
    FoodPairingGrid, DataQualityGauge, VintageTimeline,
  } from "@/components/product-visualizations";
  import { ProductImage } from "@/components/ProductImage";
  import { TasteProfileSection, type TasteProfile } from "@/components/product/TasteProfileSection";
  import { SimilarProductsRail } from "@/components/product/SimilarProductsRail";
  import { getAccent, getAccentRgb } from "@/lib/explore/category-config";
  import type {
    ExploreProduct,
    CategoryScope,
    CharDimension,
    RelatedProduct,
    AffinityItem,
    ProductAffinities,
  } from "@/lib/explore/types";

  // ── Props ─────────────────────────────────────────────────────────────────────

  export interface ProductDetailPanelProps {
    product: ExploreProduct;
    theme?: "dark" | "light";
    category?: CategoryScope | null;
    charDimensions?: CharDimension[];
    taxContextMap?: Map<string, string>;
    relatedProducts?: RelatedProduct[];
    productAffinities?: ProductAffinities | null;
  }

  // ── Helpers (self-contained copies — do not import from ProductsPage) ─────────

  function parseTags(raw: string | string[] | null | undefined): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return (raw as string[]).filter(Boolean);
    try {
      const p = JSON.parse(raw as string);
      return Array.isArray(p) ? p.filter(Boolean) : [];
    } catch {
      return (raw as string).split(",").map((t) => t.trim()).filter(Boolean);
    }
  }

  function fmt(v: unknown) {
    return v === null || v === undefined || v === "" ? "--" : String(v);
  }

  function fmtPrice(v: unknown, currency = "THB") {
    if (!v && v !== 0) return "--";
    const n = parseFloat(String(v));
    if (isNaN(n)) return "--";
    const cur = (currency || "THB").toUpperCase();
    try {
      return n.toLocaleString("th-TH", { style: "currency", currency: cur, maximumFractionDigits: 0 });
    } catch {
      return `${cur} ${n.toLocaleString()}`;
    }
  }

  function fmtPct(value: unknown) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return `${(n * 100).toFixed(1)}%`;
  }

  function confValue(p: ExploreProduct): number {
    const v = p.overall_confidence;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return 0;
  }

  function confBadge(v: number) {
    if (v >= 0.85) return <span className="text-xs font-medium text-emerald-300">{(v * 100).toFixed(0)}%</span>;
    if (v >= 0.6) return <span className="text-xs font-medium text-amber-300">{(v * 100).toFixed(0)}%</span>;
    if (v > 0) return <span className="text-xs font-medium text-rose-300">{(v * 100).toFixed(0)}%</span>;
    return <span className="text-xs text-slate-500">--</span>;
  }

  function ConfBar({ value }: { value: number }) {
    const pct = Math.round(value * 100);
    const color = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
    return (
      <div className="h-1 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-1 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    );
  }

  const STATUS_COLORS: Record<string, string> = {
    validated:       "bg-emerald-500/20 text-emerald-300",
    needs_review:    "bg-amber-500/20 text-amber-300",
    needs_attention: "bg-rose-500/20 text-rose-300",
    raw:             "bg-slate-500/20 text-slate-400",
  };

  const CLASSIFICATION_COLORS: Record<string, string> = {
    "Red Wine":       "bg-red-500/20 text-red-300 border-red-500/30",
    "White Wine":     "bg-yellow-500/20 text-yellow-200 border-yellow-500/30",
    "Sparkling Wine": "bg-amber-400/20 text-amber-200 border-amber-400/30",
    "Champagne":      "bg-amber-400/20 text-amber-200 border-amber-400/30",
    "Rose":           "bg-pink-400/20 text-pink-300 border-pink-400/30",
    "Whisky":         "bg-orange-500/20 text-orange-300 border-orange-500/30",
    "Gin":            "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    "Rum":            "bg-amber-600/20 text-amber-300 border-amber-600/30",
    "Vodka":          "bg-sky-500/20 text-sky-300 border-sky-500/30",
    "Tequila":        "bg-lime-500/20 text-lime-300 border-lime-500/30",
    "Sake":           "bg-indigo-400/20 text-indigo-300 border-indigo-400/30",
  };

  function classificationBadge(cls: string | null | undefined) {
    const c = cls ? String(cls) : "";
    const colors = CLASSIFICATION_COLORS[c] ?? "bg-slate-500/20 text-slate-300 border-slate-500/30";
    return (
      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${colors}`}>
        {c || "Uncategorized"}
      </span>
    );
  }

  const TIER_LABELS: Record<string, string> = {
    "1": "T1 - Focus now",
    "2": "T2 - High value",
    "3": "T3 - Standard",
    "4": "T4 - Monitor",
    "5": "T5 - Low signal",
  };

  function tierValue(p: ExploreProduct): string {
    const raw = p.product_tier ?? p.enrichment_priority;
    if (raw === null || raw === undefined || raw === "") return "";
    return String(raw).replace(/^T/i, "");
  }

  function tierLabel(p: ExploreProduct): string {
    const tier = tierValue(p);
    return tier ? (TIER_LABELS[tier] ?? `T${tier}`) : "Not tiered";
  }

  function tierDefinition(p: ExploreProduct): string {
    const note = p.product_tier_definition ?? p.enrichment_note;
    if (note) return String(note).replace(/\s*\|\s*/g, " · ");
    const tier = tierValue(p);
    if (tier === "1") return "Highest BI priority: focus first for content, taxonomy, and merchandising work.";
    if (tier === "2") return "Strong BI signal: important product or cluster, but behind T1 urgent focus.";
    if (tier === "3") return "Normal catalog priority with useful signals but lower immediate focus.";
    if (tier === "5") return "Low current demand signal or no recent sales signal.";
    return "No BI priority explanation is attached yet.";
  }

  type DescView = "text" | "preview" | "source";

  function LangDesc({
    shortText,
    fullText,
    fullHtml,
  }: {
    shortText?: string | null;
    fullText?: string | null;
    fullHtml?: string | null;
  }) {
    const [view, setView] = useState<DescView>("text");
    const hasShort = !!shortText;
    const hasFull = !!(fullText || fullHtml);
    if (!hasShort && !hasFull) return null;

    return (
      <div>
        {hasFull && (
          <div className="flex gap-1 mb-2">
            {(["text", "preview", "source"] as DescView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
                  view === v
                    ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                    : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                {v === "text" && <Eye size={9} />}
                {v === "preview" && <Eye size={9} />}
                {v === "source" && <Code2 size={9} />}
                {v}
              </button>
            ))}
          </div>
        )}
        {view === "source" && fullHtml ? (
          <pre className="text-[11px] text-slate-400 whitespace-pre-wrap font-mono bg-black/30 rounded p-3 overflow-x-auto leading-relaxed">
            {fullHtml}
          </pre>
        ) : view === "preview" && fullHtml ? (
          <div
            className="prose prose-invert prose-sm max-w-none text-slate-300"
            dangerouslySetInnerHTML={{ __html: fullHtml }}
          />
        ) : (
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
            {(view === "text" && (fullText || shortText)) || shortText || ""}
          </p>
        )}
      </div>
    );
  }

  // ── Card wrapper ──────────────────────────────────────────────────────────────

  function Card({ children, theme }: { children: React.ReactNode; theme: "dark" | "light" }) {
    return (
      <div
        className={
          theme === "light"
            ? "bg-slate-50 border border-slate-200 rounded-xl p-5"
            : "bg-white/[0.03] border border-white/[0.06] rounded-xl p-5"
        }
      >
        {children}
      </div>
    );
  }

  function CardHeading({
    icon,
    title,
    badge,
    theme,
  }: {
    icon: React.ReactNode;
    title: string;
    badge?: React.ReactNode;
    theme: "dark" | "light";
  }) {
    return (
      <div className="flex items-center gap-2 mb-3">
        <span className={theme === "light" ? "text-violet-600" : "text-violet-400"}>{icon}</span>
        <h3
          className={`text-xs font-semibold uppercase tracking-wide ${
            theme === "light" ? "text-slate-500" : "text-slate-300"
          }`}
        >
          {title}
        </h3>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
    );
  }

  function EmptyState({ text, theme }: { text: string; theme: "dark" | "light" }) {
    return (
      <div
        className={`border border-dashed rounded-lg px-4 py-4 ${
          theme === "light" ? "border-slate-200" : "border-white/10"
        }`}
      >
        <p className={`text-xs italic ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
          {text}
        </p>
      </div>
    );
  }

  // ── Main component ────────────────────────────────────────────────────────────

  export function ProductDetailPanel({
    product,
    theme = "dark",
    category,
    charDimensions = [],
    taxContextMap,
    relatedProducts = [],
    productAffinities = null,
  }: ProductDetailPanelProps) {
    const accent = getAccent(category ?? null);

    const flavorTags = parseTags(product.flavor_tags);
    const foodTags = parseTags(product.food_matching);

    return (
      <div className="flex flex-col space-y-5 px-6 py-5">

        {/* ── Card 1: Hero / Identity ── */}
        <Card theme={theme}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-4 min-w-0">
              <ProductImage
                src={product.image_url}
                alt={product.name}
                sku={product.sku}
                classification={product.classification}
                size="xl"
                showLabelZoom
                className="rounded-xl shrink-0"
              />
              <div className="min-w-0">
                <h2
                  className={`text-xl font-semibold leading-tight ${
                    theme === "light" ? "text-slate-900" : "text-white"
                  }`}
                >
                  {product.name}
                </h2>
                {!!product.brand && (
                  <p className={`text-sm mt-1 ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
                    {product.brand}
                  </p>
                )}
                {!!product.vintage && (
                  <span className={`mt-1 block text-2xl font-light ${theme === "light" ? "text-slate-400" : "text-slate-400"}`}>
                    {product.vintage}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Badges row */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span
              className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                theme === "light" ? "bg-slate-100 text-slate-500" : "bg-white/5 text-slate-500"
              }`}
            >
              {product.sku}
            </span>
            {classificationBadge(product.classification)}
            {!!product.wine_classification && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25">
                {product.wine_classification}
              </span>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {(
              [
                { label: "Price", value: fmtPrice(product.price, product.currency) },
                { label: "Bottle", value: fmt(product.bottle_size) },
              ] as { label: string; value: string }[]
            ).map(({ label, value }) => (
              <div
                key={label}
                className={`rounded-lg p-3 text-center ${
                  theme === "light" ? "bg-slate-100" : "bg-white/5"
                }`}
              >
                <p className={`text-[10px] mb-0.5 ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
                  {label}
                </p>
                <p className={`text-sm font-semibold ${theme === "light" ? "text-slate-800" : "text-white"}`}>
                  {value}
                </p>
              </div>
            ))}
            <div
              className={`rounded-lg p-3 text-center ${theme === "light" ? "bg-slate-100" : "bg-white/5"}`}
            >
              <p className={`text-[10px] mb-0.5 ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
                Status
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  STATUS_COLORS[String(product.validation_status ?? "")] ?? "bg-slate-500/20 text-slate-300"
                }`}
              >
                {String(product.validation_status ?? "raw")}
              </span>
            </div>
            <div
              className={`rounded-lg p-3 text-center ${theme === "light" ? "bg-slate-100" : "bg-white/5"}`}
            >
              <p className={`text-[10px] mb-0.5 ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
                Confidence
              </p>
              <div className="mt-1">{confBadge(confValue(product))}</div>
            </div>
          </div>
          <div className="mt-3">
            <ConfBar value={confValue(product)} />
          </div>
        </Card>

        {/* ── Card 2: Origin ── */}
        <Card theme={theme}>
          <CardHeading icon={<MapPin size={14} />} title="Origin" theme={theme} />
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              product.country,
              product.region,
              product.subregion,
              product.appellation,
            ]
              .filter(Boolean)
              .map((val, i, arr) => (
                <span key={i} className="flex items-center gap-1.5">
                  <span className={`text-sm ${theme === "light" ? "text-slate-700" : "text-white"}`}>
                    {String(val)}
                  </span>
                  {i < arr.length - 1 && (
                    <span className={theme === "light" ? "text-slate-300 text-xs" : "text-slate-400 text-xs"}>
                      /
                    </span>
                  )}
                </span>
              ))}
            {!product.country && (
              <span className={`text-sm italic ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
                Origin unknown
              </span>
            )}
          </div>
          {(taxContextMap?.size ?? 0) > 0 && (
            <div className="mt-3 space-y-1">
              {(taxContextMap ? Array.from(taxContextMap.entries()) : []).map(([term, desc]) => (
                <p
                  key={term}
                  className={`text-xs leading-relaxed ${theme === "light" ? "text-slate-500" : "text-slate-500"}`}
                >
                  <span className={`font-medium ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
                    {term}:
                  </span>{" "}
                  {desc}
                </p>
              ))}
            </div>
          )}
        </Card>

        {/* ── Card 3: Character Profile (Radar) ── */}
        <Card theme={theme}>
          <CardHeading
            icon={<BarChart3 size={14} />}
            title="Character Profile"
            theme={theme}
            badge={
              charDimensions.length > 0 ? (
                <span className={`text-[10px] ${theme === "light" ? "text-slate-400" : "text-slate-400"}`}>
                  {charDimensions.length} dimensions
                </span>
              ) : undefined
            }
          />
          <CharacterRadarChart
            product={product as Record<string, unknown>}
            charDimensions={charDimensions}
          />
        </Card>

        {/* ── Card 4: Style Position Matrix ── */}
        <Card theme={theme}>
          <CardHeading icon={<Layers size={14} />} title="Style Position" theme={theme} />
          <BodySweetnessMatrix product={product as Record<string, unknown>} />
        </Card>

        {/* ── Card 5: Flavor Wheel ── */}
        <Card theme={theme}>
          <CardHeading icon={<Tag size={14} />} title="Flavor Profile" theme={theme} />
          <FlavorWheel product={product as Record<string, unknown>} />
          {flavorTags.length === 0 && <EmptyState text="No flavor data yet" theme={theme} />}
        </Card>

        {/* ── Card 6: Food Pairing ── */}
        <Card theme={theme}>
          <CardHeading icon={<Utensils size={14} />} title="Food Pairing" theme={theme} />
          <FoodPairingGrid product={product as Record<string, unknown>} />
          {foodTags.length === 0 && !product.pairing_rationale && (
            <EmptyState text="No pairing data yet" theme={theme} />
          )}
          {product.pairing_rationale && (
            <p className={`mt-2.5 text-xs leading-relaxed italic ${theme === "light" ? "text-slate-600" : "text-slate-300"}`}>
              {product.pairing_rationale}
            </p>
          )}
        </Card>

        {/* ── Card 7: Descriptions ── */}
        <Card theme={theme}>
          <CardHeading icon={<FileText size={14} />} title="Description" theme={theme} />
          {(() => {
            const shortEn = product.desc_en_short;
            const fullEn = product.full_description ?? product.desc_en_full;
            const fullHtml = product.description_en_html;
            const hasEn = !!(shortEn || fullEn);

            const shortTh = product.short_description_th_wn;
            const fullTh = product.description_th_wn_text;
            const fullThHtml = product.description_th_wn_html;
            const hasTh = !!(shortTh || fullTh);

            if (!hasEn && !hasTh) return <EmptyState text="Pending enrichment" theme={theme} />;

            return (
              <div className="space-y-4">
                {hasEn && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold">EN</span>
                    </div>
                    <LangDesc shortText={shortEn} fullText={fullEn} fullHtml={fullHtml} />
                  </div>
                )}
                {hasTh && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">TH</span>
                    </div>
                    <LangDesc shortText={shortTh} fullText={fullTh} fullHtml={fullThHtml} />
                  </div>
                )}
              </div>
            );
          })()}
        </Card>

        {/* ── Card 8: Vintage Timeline (hidden when no vintage) ── */}
        {!!product.vintage && (
          <Card theme={theme}>
            <CardHeading icon={<Star size={14} />} title="Vintage" theme={theme} />
            <VintageTimeline product={product as Record<string, unknown>} />
          </Card>
        )}

        {/* ── Card 9: BI Priority ── */}
        <Card theme={theme}>
          <CardHeading
            icon={<Target size={14} />}
            title="BI Priority"
            theme={theme}
            badge={
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">
                {tierLabel(product)}
              </span>
            }
          />
          <p className={`text-xs leading-relaxed ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
            {tierDefinition(product)}
          </p>
          {(!!product.queue_priority || !!product.priority_band || !!product.bi_priority_band) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {!!product.queue_priority && (
                <span className={`px-2 py-1 rounded text-[11px] ${theme === "light" ? "bg-slate-100 text-slate-600" : "bg-white/5 text-slate-300"}`}>
                  Score {String(product.queue_priority)}
                </span>
              )}
              {!!(product.priority_band || product.bi_priority_band) && (
                <span className={`px-2 py-1 rounded text-[11px] ${theme === "light" ? "bg-slate-100 text-slate-600" : "bg-white/5 text-slate-300"}`}>
                  {String(product.priority_band ?? product.bi_priority_band)}
                </span>
              )}
            </div>
          )}
        </Card>

        {/* ── Card 10: Taste Profile v2 (feature-flagged) ── */}
        <TasteProfileSection
          profile={(product.taste_profile as TasteProfile | null) ?? null}
          productId={product.id}
        />

        {/* ── Card 11: Similar Products Rail ── */}
        <SimilarProductsRail productId={product.id} />

        {/* ── Card 12: BI Affinities ── */}
        <Card theme={theme}>
          <CardHeading
            icon={<PackagePlus size={14} />}
            title="Product Affinities"
            theme={theme}
            badge={
              productAffinities?.base_product_code ? (
                <span className={`text-[10px] font-mono ${theme === "light" ? "text-slate-400" : "text-slate-400"}`}>
                  {productAffinities.base_product_code}
                </span>
              ) : undefined
            }
          />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {(
              [
                {
                  title: "Same Order (Basket Affinity)",
                  caption: "Products most often bought in the same order as this one.",
                  rateLabel: "Co-order",
                  rows: productAffinities?.co_order_affinities ?? [],
                },
                {
                  title: "Same Customers Also Buy (Customer Affinity)",
                  caption: "Products bought by the highest share of this product's customers.",
                  rateLabel: "Overlap",
                  rows: productAffinities?.co_customer_affinities ?? [],
                },
              ] as const
            ).map((section) => (
              <div
                key={section.title}
                className={`rounded-lg border overflow-hidden ${
                  theme === "light"
                    ? "border-slate-200 bg-slate-50"
                    : "border-white/8 bg-white/[0.025]"
                }`}
              >
                <div className={`px-3 py-3 border-b ${theme === "light" ? "border-slate-200" : "border-white/8"}`}>
                  <h4 className={`text-sm font-semibold ${theme === "light" ? "text-slate-700" : "text-slate-200"}`}>
                    {section.title}
                  </h4>
                  <p className={`mt-1 text-[11px] leading-relaxed ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
                    {section.caption}
                  </p>
                </div>
                {section.rows.length > 0 ? (
                  <div className={`divide-y ${theme === "light" ? "divide-slate-100" : "divide-white/6"}`}>
                    {section.rows.slice(0, 10).map((item: AffinityItem) => (
                      <div
                        key={`${section.title}-${item.base_product_code}`}
                        className="flex items-center gap-2 px-3 py-2"
                        title={item.product_name}
                      >
                        <span className={`w-6 shrink-0 text-right text-[11px] ${theme === "light" ? "text-slate-400" : "text-slate-400"}`}>
                          {item.rank}
                        </span>
                        <span className={`w-20 shrink-0 font-mono text-[11px] ${theme === "light" ? "text-slate-400" : "text-slate-400"}`}>
                          {item.base_product_code}
                        </span>
                        <span className={`min-w-0 flex-1 truncate text-xs ${theme === "light" ? "text-slate-700" : "text-slate-200"}`}>
                          {item.product_name || "--"}
                        </span>
                        <span className="w-16 shrink-0 text-right text-xs font-semibold text-cyan-300">
                          {fmtPct(item.rate)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-5">
                    <p className={`text-xs italic ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
                      No BI affinity data available
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className={`mt-3 text-[11px] ${theme === "light" ? "text-slate-400" : "text-slate-400"}`}>
            From BI closed-order history. Rates are calculated by base product code.
          </p>
        </Card>

        {/* ── Card 13: Comparable Products ── */}
        <Card theme={theme}>
          <CardHeading icon={<PackagePlus size={14} />} title="Comparable Products" theme={theme} />
          <p className={`mb-3 text-[11px] ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
            Suggested reference SKUs in the same price range, using brand, category, country, region, and SKU family similarity.
          </p>
          {relatedProducts.length > 0 ? (
            <div className="space-y-2">
              {relatedProducts.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border px-3 py-2 ${
                    theme === "light"
                      ? "border-slate-200 bg-slate-50"
                      : "border-white/8 bg-white/[0.025]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${theme === "light" ? "text-slate-800" : "text-white"}`}>
                        {item.name}
                      </p>
                      <p className={`text-[11px] font-mono ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
                        {item.sku}
                      </p>
                    </div>
                    <span className={`text-[11px] shrink-0 ${theme === "light" ? "text-slate-400" : "text-slate-400"}`}>
                      {fmtPrice(item.price, item.currency ?? "THB")}
                    </span>
                  </div>
                  {!!item.matchReasons?.length && (
                    <p className={`mt-1 text-[11px] truncate ${theme === "light" ? "text-slate-400" : "text-slate-500"}`}>
                      {item.matchReasons.join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No comparable SKU cluster found yet" theme={theme} />
          )}
        </Card>

        {/* ── Card 14: Data Quality ── */}
        <Card theme={theme}>
          <CardHeading
            icon={<CheckCircle2 size={14} />}
            title="Data Quality"
            theme={theme}
            badge={
              product.validation_status ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    STATUS_COLORS[String(product.validation_status)] ?? "bg-slate-500/20 text-slate-300"
                  }`}
                >
                  {String(product.validation_status)}
                </span>
              ) : undefined
            }
          />
          <DataQualityGauge product={product as Record<string, unknown>} />
        </Card>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify build compiles**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run build 2>&1 | grep -E "error|✓ Compiled|Failed" | tail -10
  ```
  Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
  git add components/product/ProductDetailPanel.tsx
  git commit -m "feat(ProductDetailPanel): new shared 14-card detail panel"
  ```

---

## Task 4: Slim `ProductDetailCard` to a modal shell

**Files:**
- Modify: `components/explore/ProductDetailCard.tsx`

Remove all product-data JSX. Keep: backdrop, modal card frame, close button, Escape handler. Render `<ProductDetailPanel>`.

- [ ] **Step 1: Replace the file content**

  The new file keeps only the shell. The `SectionHeading` and `Badge` sub-components are removed (they move to the panel). The `scaleTier` / `hasWineDimensions` / `parseTags` helpers are removed. The radar JSX, flavor tags, food pairing, badges section — all gone.

  ```tsx
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
  ```

- [ ] **Step 2: Verify build compiles**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run build 2>&1 | grep -E "error|✓ Compiled|Failed" | tail -10
  ```
  Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
  git add components/explore/ProductDetailCard.tsx
  git commit -m "refactor(ProductDetailCard): slim to modal shell, delegate to ProductDetailPanel"
  ```

---

## Task 5: Update `ProductsPage` to use `ProductDetailPanel`

**Files:**
- Modify: `components/pages/ProductsPage.tsx`

This task has two parts: (a) remove the four local type definitions now that they're exported from `lib/explore/types.ts`; (b) swap the inline card JSX (lines 682–1037) for `<ProductDetailPanel>`.

- [ ] **Step 1: Add imports to ProductsPage**

  At the top of `components/pages/ProductsPage.tsx`, add:

  ```ts
  import { ProductDetailPanel } from '@/components/product/ProductDetailPanel';
  import { toExploreProduct } from '@/lib/explore/adapters';
  import type { CharDimension, RelatedProduct, AffinityItem, ProductAffinities } from '@/lib/explore/types';
  ```

- [ ] **Step 2: Remove the four local type definitions**

  Delete these lines (approximately lines 93–122):
  ```ts
  type CharDimension = { dimension_key: string; label: string; description: string };
  type TaxContext = { term: string; description_short: string };
  type RelatedProduct = { ... };
  type AffinityItem = { ... };
  type ProductAffinities = { ... };
  ```
  Keep `TaxContext` as a local type (it's not used by the panel). Keep `type Product`, `Facet`, `Facets` — those are ProductsPage-local.

- [ ] **Step 3: Replace the inline cards with `<ProductDetailPanel>`**

  Find the scrollable dashboard section. It currently starts with:
  ```tsx
  <div className="px-6 py-5 space-y-5 max-w-4xl">
    {/* ── Card 1: Identity ── */}
    <div className="bg-white/[0.03] ...">
  ```
  And ends before the edit panel block:
  ```tsx
    {/* ── Inline Edit Panel ── */}
    {editMode && (
  ```

  Replace the entire `<div className="px-6 py-5 space-y-5 max-w-4xl">` block (cards 1–14 inclusive, but NOT the edit panel) with:

  ```tsx
  <div className="max-w-4xl">
    <ProductDetailPanel
      product={toExploreProduct(selected as Record<string, unknown>)}
      theme="dark"
      charDimensions={charDimensions}
      taxContextMap={taxContextMap}
      relatedProducts={relatedProducts}
      productAffinities={productAffinities}
    />

    {/* ── Inline Edit Panel (catalog-only) ── */}
    {editMode && (
      <div className="mx-6 mb-5 bg-white/[0.03] border border-violet-500/20 rounded-xl p-5">
        {/* ... edit panel JSX stays exactly as-is ... */}
      </div>
    )}
  </div>
  ```

  The edit panel JSX is unchanged — it just moves inside this wrapper and gets `mx-6 mb-5` padding to match the panel's `px-6` spacing.

- [ ] **Step 4: Verify build compiles with no TypeScript errors**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run build 2>&1 | grep -E "error TS|✓ Compiled|Failed" | tail -15
  ```
  Expected: `✓ Compiled successfully` with no `error TS` lines.

- [ ] **Step 5: Commit**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
  git add components/pages/ProductsPage.tsx
  git commit -m "refactor(ProductsPage): replace inline cards with ProductDetailPanel"
  ```

---

## Task 6: End-to-end verification (Rule 7 — UI must be verified in browser)

Per CLAUDE.md Rule 7: TypeScript compiling is necessary but not sufficient. The UI must be verified by opening the app in a browser and clicking through the user journey.

- [ ] **Step 1: Start the dev server**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run dev
  ```

- [ ] **Step 2: Verify ProductsPage detail panel**

  - Open `http://localhost:3000/products` (or wherever the Products page lives)
  - Click any product in the list
  - Confirm: all 14 cards render (Hero, Origin, Character Profile, Style Position, Flavor Wheel, Food Pairing, Description, Vintage, BI Priority, Taste Profile, Similar Products, BI Affinities, Comparable Products, Data Quality)
  - Confirm: edit button still shows the Edit panel below the cards
  - Confirm: breadcrumb navigation still works from the header

- [ ] **Step 3: Verify explore/map modal**

  - Open `http://localhost:3000/explore`
  - Click any product pin on the map (or in the sidebar)
  - Confirm: the modal opens and shows the same 14 cards
  - Confirm: Escape key closes the modal
  - Confirm: clicking the backdrop closes the modal
  - Confirm: the close (X) button works

- [ ] **Step 4: Verify mobile bottom panel**

  - Open `http://localhost:3000/explore` on mobile viewport (or resize browser)
  - Click a product
  - Confirm: bottom panel opens with full detail, scrolls correctly, can be closed

- [ ] **Step 5: Final commit**

  ```bash
  cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
  git add -A
  git commit -m "chore: verify unified ProductDetailPanel — browser-confirmed working"
  ```

---

## Success Criteria Checklist

- [ ] Clicking a product in map opens same rich detail as Products catalog
- [ ] All enrichment fields render correctly in modal (`taste_profile`, `pairing_rationale`, `full_description`)
- [ ] ProductsPage renders identically to before
- [ ] Dark and light themes work; accent colors from `category` prop display correctly
- [ ] No TypeScript errors; `npm run build` passes
- [ ] `TasteProfileSection` only renders when `NEXT_PUBLIC_TASTE_PROFILE_ENABLED=true`
- [ ] `ProductSidebar` and `BottomPanel` unchanged (only `ProductDetailCard` modified)
- [ ] `toExploreProduct` does not corrupt numeric fields
- [ ] Mobile scroll and close behavior unchanged
- [ ] Panel has no `max-w` of its own — width is 100% of host container
