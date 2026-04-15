"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import LocationInfo from "@/components/explore/LocationInfo";

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

  // Track previous slug to detect navigation changes
  const prevSlugRef = useRef(slug.join("/"));

  // Local UI state (not in URL)
  const [selectedRegion, setSelectedRegion] = useState<TaxRegion | null>(null);
  const [regionCardPosition, setRegionCardPosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const [showProducts, setShowProducts] = useState(false);
  const [showLocationInfo, setShowLocationInfo] = useState(true);

  // ── Reset UI state when URL changes (breadcrumb click, back/forward) ──
  useEffect(() => {
    const currentSlug = slug.join("/");
    if (prevSlugRef.current !== currentSlug) {
      prevSlugRef.current = currentSlug;
      setSelectedRegion(null);
      setShowLocationInfo(true);
      // Only keep showProducts if we're at subregion+ level (auto-show)
      if (parsed.drillLevel !== "subregion" && parsed.drillLevel !== "appellation") {
        setShowProducts(false);
      }
    }
  }, [slug, parsed.drillLevel]);

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
    (c: TaxCountry, position?: { x: number; y: number }) => {
      setSelectedRegion({
        ...c,
        parentId: 0,
        parentSlug: '',
        description: undefined,
        keyGrapes: undefined,
        keyStyles: undefined,
      } as TaxRegion);
      setRegionCardPosition(position);
      setShowProducts(false);
      router.push(buildUrl(parsed.category, c.slug));
    },
    [parsed.category, router, buildUrl]
  );

  const handleSelectRegion = useCallback(
    (r: TaxRegion, position?: { x: number; y: number }) => {
      setSelectedRegion(r);
      setRegionCardPosition(position);
      setShowProducts(false);
    },
    []
  );

  const handleExploreRegion = useCallback(() => {
    if (!selectedRegion) return;
    const isCountryLevel = selectedRegion.parentId === 0;
    setShowProducts(true);
    setSelectedRegion(null);
    if (isCountryLevel) {
      // Country card — products for this country, URL already set
    } else if (parsed.country) {
      router.push(buildUrl(parsed.category, parsed.country.slug, selectedRegion.slug));
    }
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

  // ── Navigate back one level ──────────────────
  const handleBack = useCallback(() => {
    setSelectedRegion(null);
    setShowProducts(false);
    if (parsed.subregion && parsed.region && parsed.country) {
      router.push(buildUrl(parsed.category, parsed.country.slug, parsed.region.slug));
    } else if (parsed.region && parsed.country) {
      router.push(buildUrl(parsed.category, parsed.country.slug));
    } else if (parsed.country) {
      router.push(buildUrl(parsed.category));
    }
  }, [parsed, router, buildUrl]);

  // ── Keyboard shortcuts ───────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedRegion) { setSelectedRegion(null); return; }
        if (showProducts) { setShowProducts(false); return; }
        handleBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRegion, showProducts, handleBack]);

  // ── Zoom controls ────────────────────────────

  const handleZoomIn = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
  }, []);

  const handleZoomOut = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-" }));
  }, []);

  // ── Determine product sidebar context ─────────

  const productLocation = useMemo(() => {
    if (parsed.subregion) {
      return {
        name: parsed.subregion.name,
        slug: parsed.subregion.slug,
        country: parsed.country?.name,
        region: parsed.region?.name,
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

  // Show products: explicitly requested OR at subregion+ depth (auto-show)
  const shouldShowProducts =
    showProducts || parsed.drillLevel === "subregion" || parsed.drillLevel === "appellation";

  // ── Location info panel context ──────────────────
  const locationInfoData = useMemo(() => {
    if (parsed.subregion && parsed.region && parsed.country) {
      return {
        name: parsed.subregion.name,
        type: "subregion" as const,
        parentName: parsed.country.name,
        counts: parsed.subregion.counts,
        priceRange: parsed.subregion.priceRange,
        entityId: parsed.subregion.id,
        countrySlug: parsed.country.slug,
        regionSlug: parsed.region.slug,
        subregionSlug: parsed.subregion.slug,
      };
    }
    if (parsed.region && parsed.country) {
      return {
        name: parsed.region.name,
        type: "region" as const,
        parentName: parsed.country.name,
        counts: parsed.region.counts,
        priceRange: parsed.region.priceRange,
        entityId: parsed.region.id,
        countrySlug: parsed.country.slug,
        regionSlug: parsed.region.slug,
      };
    }
    if (parsed.country) {
      return {
        name: parsed.country.name,
        type: "country" as const,
        parentName: undefined,
        counts: parsed.country.counts,
        priceRange: parsed.country.priceRange,
        entityId: parsed.country.id,
        countrySlug: parsed.country.slug,
      };
    }
    return null;
  }, [parsed]);

  const shouldShowLocationInfo =
    showLocationInfo &&
    locationInfoData !== null &&
    parsed.drillLevel !== "world";

  const handleCloseLocationInfo = useCallback(() => {
    setShowLocationInfo(false);
  }, []);

  const handleExploreFromInfo = useCallback(() => {
    setShowProducts(true);
    setShowLocationInfo(false);
  }, []);

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

      {/* Top bar — offset right when LocationInfo is showing on desktop */}
      <div className={`absolute right-0 top-0 z-20 flex items-center justify-between px-4 py-3 backdrop-blur-md transition-all ${
          shouldShowLocationInfo ? "left-0 lg:left-[380px]" : "left-0"
        } ${shouldShowProducts ? "lg:right-[380px]" : ""}`}
        style={{ background: "rgba(10,10,26,0.6)" }}
      >
        <CategoryLens active={parsed.category} onSelect={handleCategoryChange} />
        <SearchOverlay category={parsed.category} onSelect={handleSearchSelect} />
      </div>

      {/* Location info panel (desktop, left side) */}
      {shouldShowLocationInfo && locationInfoData && (
        <LocationInfo
          name={locationInfoData.name}
          type={locationInfoData.type}
          parentName={locationInfoData.parentName}
          category={parsed.category}
          counts={locationInfoData.counts}
          priceRange={locationInfoData.priceRange}
          onExploreProducts={handleExploreFromInfo}
          onClose={handleCloseLocationInfo}
          entityId={locationInfoData.entityId}
          countrySlug={locationInfoData.countrySlug}
          regionSlug={"regionSlug" in locationInfoData ? locationInfoData.regionSlug : undefined}
          subregionSlug={"subregionSlug" in locationInfoData ? locationInfoData.subregionSlug : undefined}
        />
      )}

      {/* Region card (floating, desktop/tablet) */}
      {selectedRegion && !shouldShowProducts && (
        <RegionCard
          region={selectedRegion}
          category={parsed.category}
          position={regionCardPosition}
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

      {/* Bottom bar — offset to avoid overlapping LocationInfo and sidebar */}
      <div className={`absolute bottom-0 right-0 z-20 flex items-center justify-between px-4 py-3 backdrop-blur-md transition-all ${
          shouldShowLocationInfo ? "left-0 lg:left-[380px]" : "left-0"
        } ${shouldShowProducts ? "lg:right-[380px]" : ""}`}
        style={{ background: "rgba(10,10,26,0.6)" }}
      >
        <div className="flex items-center gap-2">
          {parsed.drillLevel !== "world" && (
            <button
              onClick={handleBack}
              className="flex h-8 items-center gap-1 rounded-lg bg-white/[0.06] px-2.5 text-xs text-white/60 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Go back one level"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              Back
            </button>
          )}
          <Breadcrumb items={breadcrumbs} />
        </div>
        <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
      </div>
    </div>
  );
}
