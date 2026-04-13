"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import type { CategoryScope, TaxCountry, TaxRegion, TaxSubregion } from "@/lib/explore/types";
import { parseSlug, buildBreadcrumbs, getCountryById, getRegionById } from "@/lib/explore/taxonomy-utils";
import type { SearchResult } from "@/lib/explore/taxonomy-utils";

import CategoryLens from "@/components/explore/CategoryLens";
import Breadcrumb from "@/components/explore/Breadcrumb";
import RegionCard from "@/components/explore/RegionCard";
import ZoomControls from "@/components/explore/ZoomControls";
import SearchOverlay from "@/components/explore/SearchOverlay";
import ProductSidebar from "@/components/explore/ProductSidebar";
import BottomPanel from "@/components/explore/BottomPanel";
import OnboardingHint from "@/components/explore/OnboardingHint";

// Dynamic import for the map to avoid SSR issues with WebGL
const ExploreMap = dynamic(() => import("@/components/explore/ExploreMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a1a]">
      <div className="text-sm text-white/30">Loading map...</div>
    </div>
  ),
});

interface Props {
  slug: string[];
}

export default function ExploreClient({ slug }: Props) {
  const router = useRouter();
  const mapRef = useRef<{ zoomIn: () => void; zoomOut: () => void } | null>(null);

  // Parse URL slug into state
  const parsed = useMemo(() => parseSlug(slug), [slug]);
  const breadcrumbs = useMemo(() => buildBreadcrumbs(parsed), [parsed]);

  // Local UI state (not in URL)
  const [selectedRegion, setSelectedRegion] = useState<TaxRegion | null>(null);
  const [showProducts, setShowProducts] = useState(false);

  // ── Navigation helpers ────────────────────────

  const buildUrl = useCallback(
    (cat: CategoryScope | null, ...segments: string[]) => {
      const parts = ["/explore"];
      if (cat) parts.push(cat);
      parts.push(...segments);
      return parts.join("/");
    },
    []
  );

  const handleCategoryChange = useCallback(
    (cat: CategoryScope | null) => {
      setSelectedRegion(null);
      setShowProducts(false);
      // Preserve current drill level, just change category
      if (parsed.country) {
        const segs = [parsed.country.slug];
        if (parsed.region) segs.push(parsed.region.slug);
        if (parsed.subregion) segs.push(parsed.subregion.slug);
        router.push(buildUrl(cat, ...segs));
      } else {
        router.push(buildUrl(cat));
      }
    },
    [parsed, router, buildUrl]
  );

  const handleSelectCountry = useCallback(
    (c: TaxCountry) => {
      setSelectedRegion(null);
      setShowProducts(false);
      router.push(buildUrl(parsed.category, c.slug));
    },
    [parsed.category, router, buildUrl]
  );

  const handleSelectRegion = useCallback(
    (r: TaxRegion) => {
      setSelectedRegion(r);
      setShowProducts(false);
    },
    []
  );

  const handleExploreRegion = useCallback(() => {
    if (!selectedRegion || !parsed.country) return;
    setShowProducts(true);
    setSelectedRegion(null);
    router.push(buildUrl(parsed.category, parsed.country.slug, selectedRegion.slug));
  }, [selectedRegion, parsed.category, parsed.country, router, buildUrl]);

  const handleSelectSubregion = useCallback(
    (s: TaxSubregion) => {
      if (!parsed.country || !parsed.region) return;
      setSelectedRegion(null);
      setShowProducts(true);
      router.push(buildUrl(parsed.category, parsed.country.slug, parsed.region.slug, s.slug));
    },
    [parsed, router, buildUrl]
  );

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      setSelectedRegion(null);
      setShowProducts(false);
      router.push(result.href);
    },
    [router]
  );

  const handleCloseCard = useCallback(() => {
    setSelectedRegion(null);
  }, []);

  const handleCloseProducts = useCallback(() => {
    setShowProducts(false);
  }, []);

  // ── Zoom controls ────────────────────────────

  const handleZoomIn = useCallback(() => {
    // Use native map zoom via a global ref — set by ExploreMap
    const mapEl = document.querySelector(".maplibregl-map") as HTMLElement & { _map?: maplibregl.Map };
    // Fallback: dispatch keyboard event
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
  }, []);

  const handleZoomOut = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-" }));
  }, []);

  // ── Determine product sidebar context ─────────

  const productLocation = useMemo(() => {
    if (parsed.subregion) {
      const region = parsed.region;
      return {
        name: parsed.subregion.name,
        slug: parsed.subregion.slug,
        country: parsed.country?.name,
        region: region?.name,
        subregion: parsed.subregion.name,
      };
    }
    if (parsed.region) {
      return {
        name: parsed.region.name,
        slug: parsed.region.slug,
        country: parsed.country?.name,
        region: parsed.region.name,
      };
    }
    if (parsed.country) {
      return {
        name: parsed.country.name,
        slug: parsed.country.slug,
        country: parsed.country.name,
      };
    }
    return null;
  }, [parsed]);

  // Show products when drilled to region level or deeper (after explore click)
  const shouldShowProducts =
    showProducts || parsed.drillLevel === "subregion" || parsed.drillLevel === "appellation";

  return (
    <div className="relative h-full w-full">
      {/* Accessible live region for drill-down announcements */}
      <div className="sr-only" role="status" aria-live="polite">
        {parsed.drillLevel === 'world' && 'World map view'}
        {parsed.country && `Viewing ${parsed.country.name}`}
        {parsed.region && `, ${parsed.region.name}`}
        {parsed.subregion && `, ${parsed.subregion.name}`}
      </div>

      {/* Map */}
      <ExploreMap
        category={parsed.category}
        drillLevel={parsed.drillLevel}
        country={parsed.country}
        region={parsed.region}
        subregion={parsed.subregion}
        onSelectCountry={handleSelectCountry}
        onSelectRegion={handleSelectRegion}
        onSelectSubregion={handleSelectSubregion}
      />

      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-4 py-3 backdrop-blur-md"
        style={{ background: "rgba(10,10,26,0.6)" }}
      >
        <CategoryLens active={parsed.category} onSelect={handleCategoryChange} />
        <SearchOverlay category={parsed.category} onSelect={handleSearchSelect} />
      </div>

      {/* Region card (floating, desktop/tablet) */}
      {selectedRegion && !shouldShowProducts && (
        <RegionCard
          region={selectedRegion}
          category={parsed.category}
          onExplore={handleExploreRegion}
          onClose={handleCloseCard}
        />
      )}

      {/* Product sidebar (desktop) */}
      {shouldShowProducts && productLocation && (
        <ProductSidebar
          locationName={productLocation.name}
          locationSlug={productLocation.slug}
          country={productLocation.country}
          region={productLocation.region}
          subregion={productLocation.subregion}
          category={parsed.category}
          onClose={handleCloseProducts}
        />
      )}

      {/* Bottom panel (tablet/mobile) */}
      {shouldShowProducts && productLocation && (
        <BottomPanel
          locationName={productLocation.name}
          country={productLocation.country}
          region={productLocation.region}
          subregion={productLocation.subregion}
          category={parsed.category}
          onClose={handleCloseProducts}
        />
      )}

      {/* Onboarding hint (world view only) */}
      {parsed.drillLevel === "world" && <OnboardingHint />}

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 backdrop-blur-md max-lg:bottom-0"
        style={{ background: "rgba(10,10,26,0.6)" }}
      >
        <Breadcrumb items={breadcrumbs} />
        <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
      </div>
    </div>
  );
}
