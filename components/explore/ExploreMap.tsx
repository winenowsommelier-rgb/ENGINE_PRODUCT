"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Source, type MapRef, type ViewStateChangeEvent } from "react-map-gl/maplibre";

import type { CategoryScope, DrillLevel, TaxCountry, TaxRegion, TaxSubregion } from "@/lib/explore/types";
import {
  MAP_STYLES,
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
  theme: "dark" | "light";
  country?: TaxCountry;
  region?: TaxRegion;
  subregion?: TaxSubregion;
  onSelectCountry: (c: TaxCountry, position?: { x: number; y: number }) => void;
  onSelectRegion: (r: TaxRegion, position: { x: number; y: number }) => void;
  onSelectSubregion: (s: TaxSubregion) => void;
}

type MarkerPoint = {
  id: number;
  latitude: number;
  longitude: number;
};

type SpreadMarkerPoint<T extends MarkerPoint> = T & {
  displayLatitude: number;
  displayLongitude: number;
  displaced: boolean;
};

function spreadOverlappingPoints<T extends MarkerPoint>(items: T[], offsetDegrees = 0.045): Array<SpreadMarkerPoint<T>> {
  const groups = new globalThis.Map<string, T[]>();

  for (const item of items) {
    const key = `${item.latitude.toFixed(4)}:${item.longitude.toFixed(4)}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const result: Array<SpreadMarkerPoint<T>> = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      const item = group[0];
      result.push({ ...item, displayLatitude: item.latitude, displayLongitude: item.longitude, displaced: false });
      continue;
    }

    group
      .slice()
      .sort((a: T, b: T) => a.id - b.id)
      .forEach((item: T, index: number) => {
        const angle = (Math.PI * 2 * index) / group.length - Math.PI / 2;
        const radius = group.length === 2 ? offsetDegrees * 0.7 : offsetDegrees;
        result.push({
          ...item,
          displayLatitude: item.latitude + Math.sin(angle) * radius,
          displayLongitude: item.longitude + Math.cos(angle) * radius,
          displaced: true,
        });
      });
  }

  return result;
}

export default function ExploreMap({
  category,
  drillLevel,
  theme,
  country,
  region,
  subregion,
  onSelectCountry,
  onSelectRegion,
  onSelectSubregion,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [viewState, setViewState] = useState(() => {
    if (typeof window === "undefined") return INITIAL_VIEW;

    try {
      const stored = window.sessionStorage.getItem("explore-map-view-state");
      if (!stored) return INITIAL_VIEW;
      const parsed = JSON.parse(stored);
      if (
        typeof parsed?.latitude === "number" &&
        typeof parsed?.longitude === "number" &&
        typeof parsed?.zoom === "number"
      ) {
        return parsed;
      }
    } catch {
      // Ignore corrupted session state and fall back to defaults.
    }

    return INITIAL_VIEW;
  });
  const [countryGeoJson, setCountryGeoJson] = useState<GeoJSON | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{
    x: number;
    y: number;
    name: string;
    count: number;
    type: "country" | "region" | "subregion";
  } | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const getMapPadding = useCallback(() => {
    if (typeof window === "undefined") {
      return { top: 92, bottom: 92, left: 92, right: 92 };
    }

    const desktop = window.innerWidth >= 1024;
    return desktop
      ? { top: 108, bottom: 104, left: 440, right: 96 }
      : { top: 96, bottom: 128, left: 32, right: 32 };
  }, []);

  // Detect touch device once on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const touch =
      "ontouchstart" in window ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
      window.matchMedia("(hover: none)").matches;
    setIsTouchDevice(touch);
  }, []);

  // Load country boundaries
  useEffect(() => {
    fetch(COUNTRY_BOUNDARIES_URL)
      .then((r) => r.json())
      .then(setCountryGeoJson)
      .catch(console.error);
  }, []);

  const findCountryFeature = useCallback(
    (targetCountry: TaxCountry) => {
      if (!countryGeoJson || !("features" in countryGeoJson)) return null;

      const aliases = new Set([
        targetCountry.name,
        targetCountry.name === "USA" ? "United States of America" : "",
        targetCountry.name === "United States" ? "United States of America" : "",
      ]);

      return ((countryGeoJson.features as any[]) ?? []).find((feature) => {
        const props = feature?.properties ?? {};
        return aliases.has(props.ADMIN) || aliases.has(props.NAME) || aliases.has(props.FORMAL_EN);
      }) ?? null;
    },
    [countryGeoJson]
  );

  const fitMapToBounds = useCallback(
    (bounds: [[number, number], [number, number]], padding?: number | { top: number; bottom: number; left: number; right: number }) => {
      const map = mapRef.current;
      if (!map) return;

      map.fitBounds(bounds, {
        padding: padding ?? getMapPadding(),
        duration: reducedMotion ? 0 : FLY_DURATION,
        essential: true,
      });
    },
    [getMapPadding, reducedMotion]
  );

  const fitCountryBounds = useCallback(
    (targetCountry: TaxCountry) => {
      const feature = findCountryFeature(targetCountry);
      if (!feature) return false;

      const bbox = (() => {
        const featureBbox = feature.bbox as [number, number, number, number] | undefined;
        const geometry = feature.geometry as
          | { type: "Polygon"; coordinates: number[][][] }
          | { type: "MultiPolygon"; coordinates: number[][][][] }
          | undefined;

        if (!geometry) return featureBbox;

        const polygons =
          geometry.type === "Polygon"
            ? [geometry.coordinates]
            : geometry.coordinates;

        const polygonBboxes = polygons.map((polygon) => {
          let minLng = Infinity;
          let maxLng = -Infinity;
          let minLat = Infinity;
          let maxLat = -Infinity;

          const walk = (coords: any) => {
            if (typeof coords?.[0] === "number") {
              const [lng, lat] = coords as [number, number];
              minLng = Math.min(minLng, lng);
              maxLng = Math.max(maxLng, lng);
              minLat = Math.min(minLat, lat);
              maxLat = Math.max(maxLat, lat);
              return;
            }
            coords?.forEach(walk);
          };

          walk(polygon);

          const centerLng = (minLng + maxLng) / 2;
          const centerLat = (minLat + maxLat) / 2;
          const containsTarget =
            targetCountry.longitude >= minLng &&
            targetCountry.longitude <= maxLng &&
            targetCountry.latitude >= minLat &&
            targetCountry.latitude <= maxLat;
          const distanceToTarget = Math.hypot(centerLng - targetCountry.longitude, centerLat - targetCountry.latitude);

          return {
            minLng,
            minLat,
            maxLng,
            maxLat,
            containsTarget,
            distanceToTarget,
          };
        });

        if (!polygonBboxes.length) return featureBbox;

        const primary =
          polygonBboxes.find((item) => item.containsTarget) ??
          polygonBboxes.sort((a, b) => a.distanceToTarget - b.distanceToTarget)[0];

        const nearby = polygonBboxes.filter(
          (item) =>
            item === primary ||
            Math.abs(((item.minLng + item.maxLng) / 2) - ((primary.minLng + primary.maxLng) / 2)) < 3 &&
            Math.abs(((item.minLat + item.maxLat) / 2) - ((primary.minLat + primary.maxLat) / 2)) < 3
        );

        return nearby.reduce<[number, number, number, number]>(
          (acc, item) => [
            Math.min(acc[0], item.minLng),
            Math.min(acc[1], item.minLat),
            Math.max(acc[2], item.maxLng),
            Math.max(acc[3], item.maxLat),
          ],
          [primary.minLng, primary.minLat, primary.maxLng, primary.maxLat]
        );
      })();

      if (!bbox) return false;

      fitMapToBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        getMapPadding()
      );
      return true;
    },
    [findCountryFeature, fitMapToBounds, getMapPadding]
  );

  const fitMarkersBounds = useCallback(
    (points: Array<{ longitude: number; latitude: number }>, fallback: { longitude: number; latitude: number; zoom: number }) => {
      const map = mapRef.current;
      if (!map) return;

      const valid = points.filter(
        (point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude)
      );

      if (valid.length >= 2) {
        let minLng = valid[0].longitude;
        let maxLng = valid[0].longitude;
        let minLat = valid[0].latitude;
        let maxLat = valid[0].latitude;

        for (const point of valid) {
          minLng = Math.min(minLng, point.longitude);
          maxLng = Math.max(maxLng, point.longitude);
          minLat = Math.min(minLat, point.latitude);
          maxLat = Math.max(maxLat, point.latitude);
        }

        fitMapToBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          getMapPadding()
        );
        return;
      }

      map.easeTo({
        center: [fallback.longitude, fallback.latitude],
        zoom: fallback.zoom,
        duration: reducedMotion ? 0 : FLY_DURATION,
        essential: true,
      });
    },
    [fitMapToBounds, getMapPadding, reducedMotion]
  );

  // Fly-to on drill level changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (drillLevel === "world") {
      map.easeTo({
        center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
        zoom: INITIAL_VIEW.zoom,
        duration: reducedMotion ? 0 : FLY_BACK_DURATION,
        essential: true,
      });
    } else if (drillLevel === "country" && country) {
      if (!fitCountryBounds(country)) {
        map.easeTo({
          center: [country.longitude, country.latitude],
          zoom: ZOOM_LEVELS.country,
          duration: reducedMotion ? 0 : FLY_DURATION,
          essential: true,
        });
      }
    } else if (drillLevel === "region" && region) {
      fitMarkersBounds(
        getSubregionsForRegion(region.id, category).map((item) => ({
          longitude: item.longitude,
          latitude: item.latitude,
        })),
        {
          longitude: region.longitude,
          latitude: region.latitude,
          zoom: ZOOM_LEVELS.region,
        }
      );
    } else if (drillLevel === "subregion" && subregion) {
      map.easeTo({
        center: [subregion.longitude, subregion.latitude],
        zoom: ZOOM_LEVELS.subregion,
        duration: reducedMotion ? 0 : FLY_DURATION,
        essential: true,
      });
    }
  }, [drillLevel, country, region, subregion, category, fitCountryBounds, fitMarkersBounds, reducedMotion]);

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

  // Region-level markers (country view)
  const regionMarkers = useMemo(() => {
    if (!country) return { type: "FeatureCollection" as const, features: [] };
    const regions = spreadOverlappingPoints(getRegionsForCountry(country.id, category));
    return {
      type: "FeatureCollection" as const,
      features: regions.map((r) => ({
        type: "Feature" as const,
        id: r.id,
        geometry: { type: "Point" as const, coordinates: [r.displayLongitude, r.displayLatitude] },
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

  const regionLeaderLines = useMemo(() => {
    if (!country) return { type: "FeatureCollection" as const, features: [] };
    const regions = spreadOverlappingPoints(getRegionsForCountry(country.id, category));
    return {
      type: "FeatureCollection" as const,
      features: regions
        .filter((r) => r.displaced)
        .map((r) => ({
          type: "Feature" as const,
          id: `region-line-${r.id}`,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [r.longitude, r.latitude],
              [r.displayLongitude, r.displayLatitude],
            ],
          },
          properties: {
            id: r.id,
          },
        })),
    };
  }, [country, category]);

  // Subregion-level markers (region/subregion view)
  const subregionMarkers = useMemo(() => {
    if (!region) return { type: "FeatureCollection" as const, features: [] };
    const subs = getSubregionsForRegion(region.id, category);
    const visibleSubs =
      drillLevel === "subregion" && subregion
        ? subs.filter((item) => item.id === subregion.id)
        : subs;
    const spreadSubs = spreadOverlappingPoints(visibleSubs);
    return {
      type: "FeatureCollection" as const,
      features: spreadSubs.map((s) => ({
        type: "Feature" as const,
        id: s.id,
        geometry: { type: "Point" as const, coordinates: [s.displayLongitude, s.displayLatitude] },
        properties: {
          id: s.id,
          name: s.name,
          slug: s.slug,
          total: getCount(s.counts, category),
          color: getAccent(category ?? "wine"),
        },
      })),
    };
  }, [region, category, drillLevel, subregion]);

  const subregionLeaderLines = useMemo(() => {
    if (!region) return { type: "FeatureCollection" as const, features: [] };
    const subs = getSubregionsForRegion(region.id, category);
    const visibleSubs =
      drillLevel === "subregion" && subregion
        ? subs.filter((item) => item.id === subregion.id)
        : subs;
    const spreadSubs = spreadOverlappingPoints(visibleSubs);
    return {
      type: "FeatureCollection" as const,
      features: spreadSubs
        .filter((s) => s.displaced)
        .map((s) => ({
          type: "Feature" as const,
          id: `subregion-line-${s.id}`,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [s.longitude, s.latitude],
              [s.displayLongitude, s.displayLatitude],
            ],
          },
          properties: {
            id: s.id,
          },
        })),
    };
  }, [region, category, drillLevel, subregion]);

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
        if (c) onSelectCountry(c, { x: e.point.x, y: e.point.y });
      } else if (layerId === "region-markers") {
        if (!country) return;
        const regions = getRegionsForCountry(country.id, category);
        const r = regions.find((x) => x.id === props.id);
        if (r) onSelectRegion(r, { x: e.point.x, y: e.point.y });
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
    setHoverTooltip(null);
  }, []);

  const handleMouseMove = useCallback(
    (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (isTouchDevice) return;
      const map = mapRef.current;
      const f = e.features?.[0];
      if (!f || !f.properties) {
        if (map) map.getCanvas().style.cursor = "";
        setHoverTooltip(null);
        return;
      }
      if (map) map.getCanvas().style.cursor = "pointer";

      const layerId = f.layer?.id;
      let type: "country" | "region" | "subregion" = "country";
      if (layerId === "region-markers") type = "region";
      else if (layerId === "subregion-markers") type = "subregion";

      setHoverTooltip({
        x: e.point.x,
        y: e.point.y,
        name: String(f.properties.name ?? ""),
        count: Number(f.properties.total ?? 0),
        type,
      });
    },
    [isTouchDevice]
  );

  // ── Determine which marker layers to show ─────

  const showCountryMarkers = drillLevel === "world";
  const showRegionMarkers = drillLevel === "country";
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
    <div role="application" aria-label="Interactive world map showing wine and spirits regions" style={{ position: "relative", width: "100%", height: "100%" }}>
    <Map
      ref={mapRef}
      {...viewState}
      onMove={(e: ViewStateChangeEvent) => {
        setViewState(e.viewState);
        try {
          window.sessionStorage.setItem("explore-map-view-state", JSON.stringify(e.viewState));
        } catch {
          // Ignore storage failures.
        }
      }}
      mapStyle={MAP_STYLES[theme]}
      style={{ width: "100%", height: "100%" }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
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
              "fill-opacity": drillLevel === "world" ? 0.15 : 0.03,
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
          {country && drillLevel !== "world" && (
            <Layer
              id="active-country-fill"
              type="fill"
              filter={["==", ["get", "ADMIN"], country.name]}
              paint={{
                "fill-color": getAccent(category),
                "fill-opacity": 0.25,
              }}
            />
          )}
          {country && drillLevel !== "world" && (
            <Layer
              id="active-country-border"
              type="line"
              filter={["==", ["get", "ADMIN"], country.name]}
              paint={{
                "line-color": "rgba(255,255,255,0.4)",
                "line-width": 1.5,
              }}
            />
          )}
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

      {/* Region markers (country level only) */}
      {showRegionMarkers && (
        <>
        <Source id="region-leader-lines-src" type="geojson" data={regionLeaderLines}>
          <Layer
            id="region-leader-lines"
            type="line"
            paint={{
              "line-color": theme === "light" ? "rgba(15,23,42,0.28)" : "rgba(255,255,255,0.28)",
              "line-width": 1.25,
              "line-opacity": 0.95,
            }}
          />
        </Source>
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
            id="region-counts"
            type="symbol"
            layout={{
              "text-field": ["to-string", ["get", "total"]],
              "text-size": 11,
              "text-font": ["Open Sans Semibold"],
              "text-anchor": "center",
              "text-allow-overlap": true,
            }}
            paint={{
              "text-color": "rgba(255,255,255,0.96)",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1.4,
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
        </>
      )}

      {/* Subregion markers (region + subregion level only) */}
      {showSubregionMarkers && (
        <>
        <Source id="subregion-leader-lines-src" type="geojson" data={subregionLeaderLines}>
          <Layer
            id="subregion-leader-lines"
            type="line"
            paint={{
              "line-color": theme === "light" ? "rgba(15,23,42,0.3)" : "rgba(255,255,255,0.32)",
              "line-width": 1.35,
              "line-opacity": 0.95,
            }}
          />
        </Source>
        <Source id="subregion-markers-src" type="geojson" data={subregionMarkers}>
          <Layer
            id="subregion-markers"
            type="circle"
            paint={{
              "circle-radius": circleRadius,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.88,
              "circle-stroke-width":
                drillLevel === "subregion"
                  ? 3
                  : 2,
              "circle-stroke-color":
                drillLevel === "subregion"
                  ? "rgba(255,255,255,0.88)"
                  : "rgba(255,255,255,0.4)",
            }}
          />
          <Layer
            id="subregion-counts"
            type="symbol"
            layout={{
              "text-field": ["to-string", ["get", "total"]],
              "text-size": 11,
              "text-font": ["Open Sans Semibold"],
              "text-anchor": "center",
              "text-allow-overlap": true,
            }}
            paint={{
              "text-color": "rgba(255,255,255,0.96)",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1.4,
            }}
          />
          <Layer
            id="subregion-labels"
            type="symbol"
            layout={{
              "text-field": ["get", "name"],
              "text-size": 11,
              "text-offset": [0, 1.8],
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
        </>
      )}
    </Map>
    {hoverTooltip && !isTouchDevice && (
      <div
        className={`pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-sm ${
          theme === "light" ? "bg-white/92 text-slate-900" : "bg-[#0a0a1a] text-white"
        }`}
        style={{
          left: hoverTooltip.x,
          top: hoverTooltip.y,
          borderColor: theme === "light" ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.12)",
        }}
      >
        <p className="font-semibold">{hoverTooltip.name}</p>
        <p className={theme === "light" ? "text-slate-500" : "text-white/50"}>
          {hoverTooltip.count.toLocaleString()} products
        </p>
      </div>
    )}
    </div>
  );
}
