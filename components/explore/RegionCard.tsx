"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CategoryScope, TaxRegion } from "@/lib/explore/types";
import { getAccent, getAccentRgb } from "@/lib/explore/category-config";
import { getCount, getCountryById } from "@/lib/explore/taxonomy-utils";

/* ── Flag emoji lookup ────────────────────────────── */

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

/* ── Position clamping ────────────────────────────── */

function clampPosition(
  pos: { x: number; y: number },
  cardWidth: number,
  cardHeight: number,
): { left: number; top: number } {
  const OFFSET_X = 16;
  const OFFSET_Y = -40;
  const MARGIN = 12;

  let left = pos.x + OFFSET_X;
  let top = pos.y + OFFSET_Y;

  // Clamp right edge
  if (left + cardWidth + MARGIN > window.innerWidth) {
    left = pos.x - cardWidth - OFFSET_X;
  }
  // Clamp left edge
  if (left < MARGIN) {
    left = MARGIN;
  }
  // Clamp bottom edge
  if (top + cardHeight + MARGIN > window.innerHeight) {
    top = window.innerHeight - cardHeight - MARGIN;
  }
  // Clamp top edge
  if (top < MARGIN) {
    top = MARGIN;
  }

  return { left, top };
}

/* ── Component ────────────────────────────────────── */

interface Props {
  region: TaxRegion;
  category: CategoryScope | null;
  position?: { x: number; y: number };
  onExplore: () => void;
  onClose: () => void;
}

export default function RegionCard({ region, category, position, onExplore, onClose }: Props) {
  const country = getCountryById(region.parentId);
  const count = getCount(region.counts, category);
  const accent = getAccent(category);
  const accentRgb = getAccentRgb(category);
  const pr = region.priceRange;
  const priceStr = pr.min && pr.max
    ? `\u0E3F${pr.min.toLocaleString()}\u2013\u0E3F${pr.max.toLocaleString()}`
    : null;

  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const flag = country ? countryFlag(country.name) : '\u{1F30D}';

  // Compute positioned style once after first render (need card dimensions)
  useEffect(() => {
    if (!position || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const clamped = clampPosition(position, rect.width, rect.height);
    setStyle({ left: clamped.left, top: clamped.top });
  }, [position]);

  const positionClasses = position
    ? "" // positioned dynamically via style
    : "left-8 top-24"; // fallback fixed position

  return (
    <div
      ref={cardRef}
      className={`absolute z-30 w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-white/[0.08] animate-card-in ${positionClasses}`}
      style={{
        background: "rgba(10,10,26,0.88)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
        ...style,
      }}
    >
      {/* Mobile: solid bg override via media query in globals.css */}
      <style jsx>{`
        @media (max-width: 767px) {
          div { background: #12121f !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between p-4 pb-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <span className="text-xl leading-none" aria-hidden="true">{flag}</span>
            <span className="truncate">{region.name}</span>
          </h3>
          <p className="mt-0.5 text-sm text-white/50">
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
          className="ml-2 shrink-0 rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none"
          aria-label="Close region card"
        >
          <X size={16} />
        </button>
      </div>

      {/* Description */}
      {region.description && (
        <p className="border-t border-white/[0.08] px-4 py-3 text-sm leading-relaxed text-white/60">
          {region.description}
        </p>
      )}

      {/* Key grapes */}
      {region.keyGrapes && region.keyGrapes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/[0.08] px-4 py-3">
          {region.keyGrapes.map((g) => (
            <span
              key={g}
              className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-white/70"
            >
              {g}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="border-t border-white/[0.08] px-4 py-3">
        <p className="text-sm text-white/70">
          <span className="font-semibold text-white">{count}</span>{" "}
          product{count !== 1 ? "s" : ""}
          {priceStr && (
            <span className="ml-2 text-white/40">{priceStr}</span>
          )}
        </p>
      </div>

      {/* CTA */}
      {count > 0 && (
        <div className="border-t border-white/[0.08] p-4 pt-3">
          <button
            onClick={onExplore}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none"
            style={{ background: accent }}
          >
            Explore Products
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      )}
    </div>
  );
}
