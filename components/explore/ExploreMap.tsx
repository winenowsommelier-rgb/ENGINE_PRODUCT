"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Source, type MapRef, type ViewStateChangeEvent } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import type { CategoryScope, DrillLevel, TaxCountry, TaxRegion, TaxSubregion } from "@/lib/explore/types";
import {
  MAP_STYLE,
  INITIAL_VIEW,
  COUNTRY_BOUNDARIES_URL,
  ZOOM_LEVELS,
  FLY_DURATION,
  FLY_BACK_DURATION,
  MARKER_SIZE,
} from "@/lib/explore/map-config";
import { getAccent, getDominantCategory } from "@/lib/explore/category-config";
import {
  getCountries,
  getRegionsForCountry,
  getSubregionsForRegion,
  getCount,
  getCountryById,
} from "@/lib/explore/taxonomy-utils";

import type { GeoJSON } from "geojson";

/* ────────────────────────────────────────────────── */

interface Props {
  category: CategoryScope | null;
  drillLevel: DrillLevel;
  country?: TaxCountry;
  region?: TaxRegion;
  subregion?: TaxSubregion;
  onSelectCountry: (c: TaxCountry) => void;
  onSelectRegion: (r: TaxRegion) => void;
  onSelectSubregion: (s: TaxSubregion) => void;
}

export default function ExploreMap({
  category,
  drillLevel,
  country,
  region,
  subregion,
  onSelectCountry,
  onSelectRegion,
  onSelectSubregion,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [countryGeoJson, setCountryGeoJson] = useState<GeoJSON | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // Load country boundaries
  useEffect(() => {
    fetch(COUNTRY_BOUNDARIES_URL)
      .then((r) => r.json())
      .then(setCountryGeoJson)
      .catch(console.error);
  }, []);

  // Fly-to on drill level changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = prefersReducedMotion ? 0 : FLY_DURATION;

    if (drillLevel === "world") {
      map.flyTo({ center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude], zoom: INITIAL_VIEW.zoom, duration: prefersReducedMotion ? 0 : FLY_BACK_DURATION });
    } else if (drillLevel === "country" && country) {
      map.flyTo({ center: [country.longitude, country.latitude], zoom: ZOOM_LEVELS.country, duration });
    } else if (drillLevel === "region" && region) {
      map.flyTo({ center: [region.longitude, region.latitude], zoom: ZOOM_LEVELS.region, duration });
    } else if (drillLevel === "subregion" && subregion) {
      map.flyTo({ center: [subregion.longitude, subregion.latitude], zoom: ZOOM_LEVELS.subregion, duration });
    }
  }, [drillLevel, country, region, subregion]);

  // ── Marker GeoJSON sources ────────────────────

  // Country-level markers (world view + low zoom)
  const countryMarkers = useMemo(() => {
    const countries = getCountries(category);
    return {
      type: "FeatureCollection" as const,
      features: countries.map((c) => ({
        type: "Feature" as const,
        id: c.id,
        geometry: { type: "Point" as const, coordinates: [c.longitude, c.latitude] },
        properties: {
          id: c.id,
          name: c.name,
          slug: c.slug,
          total: getCount(c.counts, category),
          color: getAccent(category ?? getDominantCategory(c.counts)),
        },
      })),
    };
  }, [category]);

  // Region-level markers (when drilled into a country)
  const regionMarkers = useMemo(() => {
    if (!country) return { type: "FeatureCollection" as const, features: [] };
    const regions = getRegionsForCountry(country.id, category);
    return {
      type: "FeatureCollection" as const,
      features: regions.map((r) => ({
        type: "Feature" as const,
        id: r.id,
        geometry: { type: "Point" as const, coordinates: [r.longitude, r.latitude] },
        properties: {
          id: r.id,
          name: r.name,
          slug: r.slug,
          total: getCount(r.counts, category),
          color: getAccent(category ?? getDominantCategory(r.counts)),
        },
      })),
    };
  }, [country, category]);

  // Subregion-level markers
  const subregionMarkers = useMemo(() => {
    if (!region) return { type: "FeatureCollection" as const, features: [] };
    const subs = getSubregionsForRegion(region.id, category);
    return {
      type: "FeatureCollection" as const,
      features: subs.map((s) => ({
        type: "Feature" as const,
        id: s.id,
        geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] },
        properties: {
          id: s.id,
          name: s.name,
          slug: s.slug,
          total: getCount(s.counts, category),
          color: getAccent(category ?? "wine"),
        },
      })),
    };
  }, [region, category]);

  // ── Country fill colors ───────────────────────

  // Map ISO_A2 → active/inactive for country polygon fill
  const activeCountrySlugs = useMemo(() => {
    const countries = getCountries(category);
    return new Set(countries.map((c) => c.name));
  }, [category]);

  // ── Interaction handlers ──────────────────────

  const handleClick = useCallback(
    (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return;
      const f = e.features[0];
      const props = f.properties;
      if (!props) return;

      const layerId = f.layer?.id;
      if (layerId === "country-markers") {
        const countries = getCountries(category);
        const c = countries.find((x) => x.id === props.id);
        if (c) onSelectCountry(c);
      } else if (layerId === "region-markers") {
        if (!country) return;
        const regions = getRegionsForCountry(country.id, category);
        const r = regions.find((x) => x.id === props.id);
        if (r) onSelectRegion(r);
      } else if (layerId === "subregion-markers") {
        if (!region) return;
        const subs = getSubregionsForRegion(region.id, category);
        const s = subs.find((x) => x.id === props.id);
        if (s) onSelectSubregion(s);
      }
    },
    [category, country, region, onSelectCountry, onSelectRegion, onSelectSubregion]
  );

  const handleMouseEnter = useCallback(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "pointer";
  }, []);

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "";
    setHoveredId(null);
  }, []);

  // ── Determine which marker layers to show ─────

  const showCountryMarkers = drillLevel === "world";
  const showRegionMarkers = drillLevel === "country" || drillLevel === "region";
  const showSubregionMarkers = drillLevel === "region" || drillLevel === "subregion";

  // Max product count for sizing (within current marker set)
  const maxCount = useMemo(() => {
    let max = 1;
    if (showCountryMarkers) {
      for (const f of countryMarkers.features) max = Math.max(max, f.properties.total);
    }
    if (showRegionMarkers) {
      for (const f of regionMarkers.features) max = Math.max(max, f.properties.total);
    }
    if (showSubregionMarkers) {
      for (const f of subregionMarkers.features) max = Math.max(max, f.properties.total);
    }
    return max;
  }, [showCountryMarkers, showRegionMarkers, showSubregionMarkers, countryMarkers, regionMarkers, subregionMarkers]);

  // Circle radius expression — scaled by product count
  const circleRadius = useMemo(
    () =>
      [
        "interpolate",
        ["linear"],
        ["get", "total"],
        0,
        MARKER_SIZE.min,
        maxCount,
        MARKER_SIZE.max,
      ] as maplibregl.ExpressionSpecification,
    [maxCount]
  );

  const interactiveLayerIds = useMemo(() => {
    const ids: string[] = [];
    if (showCountryMarkers) ids.push("country-markers");
    if (showRegionMarkers) ids.push("region-markers");
    if (showSubregionMarkers) ids.push("subregion-markers");
    return ids;
  }, [showCountryMarkers, showRegionMarkers, showSubregionMarkers]);

  return (
    <Map
      ref={mapRef}
      {...viewState}
      onMove={(e: ViewStateChangeEvent) => setViewState(e.viewState)}
      mapStyle={MAP_STYLE}
      style={{ width: "100%", height: "100%" }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      interactiveLayerIds={interactiveLayerIds}
      attributionControl={false}
    >
      {/* Country polygon fill */}
      {countryGeoJson && (
        <Source id="country-boundaries" type="geojson" data={countryGeoJson}>
          <Layer
            id="country-fill"
            type="fill"
            paint={{
              "fill-color": getAccent(category),
              "fill-opacity": drillLevel === "world" ? 0.15 : 0.05,
            }}
          />
          <Layer
            id="country-borders"
            type="line"
            paint={{
              "line-color": "rgba(255,255,255,0.12)",
              "line-width": 0.8,
            }}
          />
        </Source>
      )}

      {/* Country markers (world view) */}
      {showCountryMarkers && (
        <Source id="country-markers-src" type="geojson" data={countryMarkers}>
          <Layer
            id="country-markers"
            type="circle"
            paint={{
              "circle-radius": circleRadius,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.7,
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.3)",
            }}
          />
          <Layer
            id="country-labels"
            type="symbol"
            layout={{
              "text-field": ["get", "name"],
              "text-size": 11,
              "text-offset": [0, 1.8],
              "text-anchor": "top",
              "text-allow-overlap": false,
            }}
            paint={{
              "text-color": "rgba(255,255,255,0.7)",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1,
            }}
          />
        </Source>
      )}

      {/* Region markers (country view) */}
      {showRegionMarkers && (
        <Source id="region-markers-src" type="geojson" data={regionMarkers}>
          <Layer
            id="region-markers"
            type="circle"
            paint={{
              "circle-radius": circleRadius,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.75,
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.35)",
            }}
          />
          <Layer
            id="region-labels"
            type="symbol"
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-offset": [0, 1.8],
              "text-anchor": "top",
              "text-allow-overlap": false,
            }}
            paint={{
              "text-color": "rgba(255,255,255,0.8)",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1,
            }}
          />
        </Source>
      )}

      {/* Subregion markers (region view) */}
      {showSubregionMarkers && (
        <Source id="subregion-markers-src" type="geojson" data={subregionMarkers}>
          <Layer
            id="subregion-markers"
            type="circle"
            paint={{
              "circle-radius": circleRadius,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.8,
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.4)",
            }}
          />
          <Layer
            id="subregion-labels"
            type="symbol"
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-offset": [0, 1.6],
              "text-anchor": "top",
              "text-allow-overlap": false,
            }}
            paint={{
              "text-color": "rgba(255,255,255,0.85)",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1,
            }}
          />
        </Source>
      )}
    </Map>
  );
}
