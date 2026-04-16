"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import type { CategoryScope, Counts, PriceRange } from "@/lib/explore/types";
import { getAccent, getAccentRgb } from "@/lib/explore/category-config";
import {
  getCount,
  getCountries,
  getRegionsForCountry,
  getSubregionsForRegion,
  getAppellationsForSubregion,
} from "@/lib/explore/taxonomy-utils";

/* ── Flag emoji lookup (duplicated from RegionCard) ──── */

function countryFlag(name: string): string {
  const FLAGS: Record<string, string> = {
    'France': '\u{1F1EB}\u{1F1F7}',
    'Italy': '\u{1F1EE}\u{1F1F9}',
    'Spain': '\u{1F1EA}\u{1F1F8}',
    'USA': '\u{1F1FA}\u{1F1F8}',
    'United States': '\u{1F1FA}\u{1F1F8}',
    'Australia': '\u{1F1E6}\u{1F1FA}',
    'Chile': '\u{1F1E8}\u{1F1F1}',
    'Argentina': '\u{1F1E6}\u{1F1F7}',
    'Germany': '\u{1F1E9}\u{1F1EA}',
    'Portugal': '\u{1F1F5}\u{1F1F9}',
    'New Zealand': '\u{1F1F3}\u{1F1FF}',
    'South Africa': '\u{1F1FF}\u{1F1E6}',
    'Austria': '\u{1F1E6}\u{1F1F9}',
    'Scotland': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
    'Ireland': '\u{1F1EE}\u{1F1EA}',
    'Japan': '\u{1F1EF}\u{1F1F5}',
    'Mexico': '\u{1F1F2}\u{1F1FD}',
    'England': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    'Greece': '\u{1F1EC}\u{1F1F7}',
    'Hungary': '\u{1F1ED}\u{1F1FA}',
    'Thailand': '\u{1F1F9}\u{1F1ED}',
    'Brazil': '\u{1F1E7}\u{1F1F7}',
    'Canada': '\u{1F1E8}\u{1F1E6}',
    'China': '\u{1F1E8}\u{1F1F3}',
    'Israel': '\u{1F1EE}\u{1F1F1}',
    'Lebanon': '\u{1F1F1}\u{1F1E7}',
    'Croatia': '\u{1F1ED}\u{1F1F7}',
    'Georgia': '\u{1F1EC}\u{1F1EA}',
    'Romania': '\u{1F1F7}\u{1F1F4}',
    'Switzerland': '\u{1F1E8}\u{1F1ED}',
    'Uruguay': '\u{1F1FA}\u{1F1FE}',
  };
  return FLAGS[name] || '\u{1F30D}';
}

/* ── Context data type ───────────────────────────────── */

interface LocationContext {
  description_short: string | null;
  description_full: string | null;
  key_grapes: string[];
  key_styles: string[];
  climate: string | null;
  source: string;
}

/* ── Props ───────────────────────────────────────────── */

interface LocationInfoProps {
  name: string;
  type: "world" | "country" | "region" | "subregion";
  parentName?: string;
  category: CategoryScope | null;
  counts: Counts;
  priceRange: PriceRange;
  onExploreProducts: () => void;
  onClose: () => void;
  /** Entity id — used to look up children (regions of a country, subregions of a region, etc.) */
  entityId?: number;
  /** Slugs of ancestors, for building child links */
  countrySlug?: string;
  regionSlug?: string;
  subregionSlug?: string;
}

/* ── Component ───────────────────────────────────────── */

export default function LocationInfo({
  name,
  type,
  parentName,
  category,
  counts,
  priceRange,
  onExploreProducts,
  onClose,
  entityId,
  countrySlug,
  regionSlug,
  subregionSlug,
}: LocationInfoProps) {
  const [context, setContext] = useState<LocationContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFull, setShowFull] = useState(false);

  const accent = getAccent(category);
  const accentRgb = getAccentRgb(category);
  const count = getCount(counts, category);
  const pr = priceRange;
  const priceStr =
    pr.min != null && pr.max != null
      ? `\u0E3F${pr.min.toLocaleString()}\u2013\u0E3F${pr.max.toLocaleString()}`
      : null;

  const flag =
    type === "country"
      ? countryFlag(name)
      : parentName
        ? countryFlag(parentName)
        : "\u{1F30D}";

  const typeLabel =
    type === "country"
      ? "Country"
      : type === "region"
        ? "Region"
        : "Subregion";

  // Compute clickable children (regions for a country, subregions for a region, etc.)
  const catPrefix = category ? `/${category}` : "";
  const children = useMemo(() => {
    if (type === "world") {
      const countries = getCountries(category);
      return {
        label: "Countries",
        items: countries
          .map((c) => ({
            slug: c.slug,
            name: `${countryFlag(c.name)} ${c.name}`,
            count: category ? c.counts[category] : c.counts.total,
            href: `/explore${catPrefix}/${c.slug}`,
          }))
          .filter((i) => i.count > 0)
          .sort((a, b) => b.count - a.count),
      };
    }

    if (!entityId) { const empty: { slug: string; name: string; count: number; href: string }[] = []; return { items: empty, label: "" }; }

    if (type === "country") {
      const regions = getRegionsForCountry(entityId, category);
      return {
        label: "Regions",
        items: regions
          .map((r) => ({
            slug: r.slug,
            name: r.name,
            count: category ? r.counts[category] : r.counts.total,
            href: `/explore${catPrefix}/${countrySlug}/${r.slug}`,
          }))
          .filter((i) => i.count > 0)
          .sort((a, b) => b.count - a.count),
      };
    }
    if (type === "region") {
      const subs = getSubregionsForRegion(entityId, category);
      return {
        label: "Subregions",
        items: subs
          .map((s) => ({
            slug: s.slug,
            name: s.name,
            count: category ? s.counts[category] : s.counts.total,
            href: `/explore${catPrefix}/${countrySlug}/${regionSlug}/${s.slug}`,
          }))
          .filter((i) => i.count > 0)
          .sort((a, b) => b.count - a.count),
      };
    }
    if (type === "subregion") {
      const apps = getAppellationsForSubregion(entityId);
      return {
        label: "Appellations",
        items: apps.map((a) => ({
          slug: a.slug,
          name: a.name,
          count: 0,
          href: `/explore${catPrefix}/${countrySlug}/${regionSlug}/${subregionSlug}/${a.slug}`,
        })),
      };
    }
    return { items: [], label: "" };
  }, [entityId, type, category, catPrefix, countrySlug, regionSlug, subregionSlug]);

  // Fetch context on mount / when name changes (skip for world)
  useEffect(() => {
    if (type === "world") { setLoading(false); setContext(null); return; }

    let cancelled = false;
    setLoading(true);
    setShowFull(false);

    const params = new URLSearchParams({ name, type });
    if (category) params.set("scope", category);

    fetch(`/api/explore/context?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setContext({
            description_short: data.description_short,
            description_full: data.description_full,
            key_grapes: data.key_grapes ?? [],
            key_styles: data.key_styles ?? [],
            climate: data.climate ?? null,
            source: data.source,
          });
        } else {
          setContext(null);
        }
      })
      .catch(() => {
        if (!cancelled) setContext(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [name, type, category]);

  const hasDescription = context?.description_short || context?.description_full;
  const hasGrapes = context?.key_grapes && context.key_grapes.length > 0;
  const hasStyles = context?.key_styles && context.key_styles.length > 0;

  return (
    <aside
      aria-label={`${name} information`}
      className="fixed left-0 top-0 z-30 hidden h-full w-[380px] animate-slide-in-left border-r border-white/[0.08] bg-[#12121f] shadow-[8px_0_32px_rgba(0,0,0,0.4)] lg:block"
    >
      {/* Scrollable content */}
      <div className="flex h-full flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
              {type !== "world" && (
                <span className="text-2xl leading-none" aria-hidden="true">
                  {flag}
                </span>
              )}
              {type === "world" && (
                <span className="text-2xl leading-none" aria-hidden="true">🌍</span>
              )}
              <span className="truncate">{type === "world" ? "Explore" : name}</span>
            </h2>
            {type === "world" ? (
              <p className="mt-1 text-sm text-white/50">
                Discover wines, spirits, beer &amp; sake by region
              </p>
            ) : (
            <p className="mt-1 text-sm text-white/50">
              {parentName && <span>{parentName} &middot; </span>}
              <span
                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  background: `rgba(${accentRgb},0.15)`,
                  color: accent,
                }}
              >
                {category ? `${category} ${typeLabel}` : typeLabel}
              </span>
            </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-2 shrink-0 rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close location info"
          >
            <X size={18} />
          </button>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3 px-5 py-4">
            <div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-white/[0.06]" />
            <div className="mt-4 flex gap-2">
              <div className="h-6 w-20 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="h-6 w-16 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="h-6 w-24 animate-pulse rounded-full bg-white/[0.06]" />
            </div>
          </div>
        )}

        {/* Description */}
        {!loading && hasDescription && (
          <div className="border-t border-white/[0.06] px-5 py-4">
            <p className="text-sm leading-relaxed text-white/65">
              {showFull && context?.description_full
                ? context.description_full
                : context?.description_short}
            </p>
            {context?.description_full &&
              context.description_full !== context.description_short && (
                <button
                  onClick={() => setShowFull(!showFull)}
                  className="mt-2 flex items-center gap-1 text-xs font-medium transition-colors hover:text-white"
                  style={{ color: accent }}
                >
                  {showFull ? (
                    <>
                      Show Less <ChevronUp size={12} />
                    </>
                  ) : (
                    <>
                      Show Full Description <ChevronDown size={12} />
                    </>
                  )}
                </button>
              )}
          </div>
        )}

        {/* Key Grapes */}
        {!loading && hasGrapes && (
          <div className="border-t border-white/[0.06] px-5 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
              Key Grapes
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {context!.key_grapes.map((g) => (
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

        {/* Key Styles */}
        {!loading && hasStyles && (
          <div className="border-t border-white/[0.06] px-5 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
              Key Styles
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {context!.key_styles.map((s) => (
                <span
                  key={s}
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{
                    background: `rgba(${accentRgb},0.12)`,
                    color: accent,
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Climate */}
        {!loading && context?.climate && (
          <div className="border-t border-white/[0.06] px-5 py-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/40">
              Climate
            </h3>
            <p className="text-sm text-white/65">{context.climate}</p>
          </div>
        )}

        {/* Stats (hide at world level) */}
        {type !== "world" && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="text-sm text-white/70">
            <span className="font-semibold text-white">{count}</span>{" "}
            product{count !== 1 ? "s" : ""}
            {priceStr && (
              <span className="ml-2 text-white/40">{priceStr}</span>
            )}
          </p>
        </div>
        )}

        {/* Clickable children (regions / subregions / appellations) */}
        {children.items.length > 0 && (
          <div className="border-t border-white/[0.06] px-5 py-4">
            <h3 className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-white/40">
              <span>{children.label}</span>
              <span className="text-white/30">{children.items.length}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {children.items.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={c.href}
                    className="group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none"
                  >
                    <span className="truncate text-white/85 group-hover:text-white">{c.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-white/40 group-hover:text-white/60">
                      {c.count > 0 && <span>{c.count}</span>}
                      <ChevronRight size={12} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTA (hide at world level) */}
        {type !== "world" && count > 0 && (
          <div className="border-t border-white/[0.06] px-5 py-4">
            <button
              onClick={onExploreProducts}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110"
              style={{ background: accent }}
            >
              Explore Products
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        )}

        {/* Spacer to ensure content isn't hidden by bottom bar */}
        <div className="h-16 shrink-0" />
      </div>
    </aside>
  );
}
