'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Map as MapGL,
  Source,
  Layer,
  Popup,
  NavigationControl,
  type MapRef,
} from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount, countryShopHref } from '@/lib/explore/map-data';
import { flagEmoji } from '@/lib/explore/flags';
import { type CountryPin } from '@/lib/explore/country-pins';
import {
  countriesToGeoJSON,
  regionsToGeoJSON,
  pointsBounds,
  WORLD_BOUNDS,
} from '@/lib/explore/geojson';

/**
 * MapLibreAtlas — the explore map, standing on MapLibre GL (react-map-gl v8).
 *
 * The engine owns everything the old hand-rolled SVG atlas kept getting wrong:
 * clustering (`cluster: true` on the country source), label collision, pinch/pan
 * gestures, and camera framing (`fitBounds`/`easeTo`). This component only maps
 * catalog data → GeoJSON sources and clicks → the parent's selection callbacks.
 *
 * Click behavior:
 *   cluster        → expand (easeTo the cluster's expansion zoom)
 *   country w/ regions → onSelectCountry (parent focuses; camera fits regions)
 *   country w/o regions → mini popup card with a "View bottles →" /shop CTA
 *                        (handled INTERNALLY; parent never navigates on pin click)
 *   region         → onSelectRegion (parent opens the sheet)
 */

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/**
 * Grayscale basemap palette — black/white dominant with the burgundy pins as
 * the SINGLE accent color, so the data (pins/labels) pops off a neutral map.
 * Land is near-white, sea a step darker for figure-ground; basemap place
 * labels stay muted gray so OUR ink-black pin labels always win the eye.
 */
const TINT = {
  // In positron the `background` layer is the LAND BASE; water fills draw the
  // sea on top of it. Every non-water fill (landcover/landuse/park) gets the
  // same land tone so the land reads as ONE flat surface, not blotchy patches.
  land: '#fbfbfa',
  water: '#e4e4e3',
  boundary: '#d0d0d0',
  label: '#8a8a8a',
  halo: '#ffffff',
};
/** Ink for our own pin labels — near-black on near-white land (AAA contrast). */
const INK = '#1a1a1a';
const BURGUNDY = '#7d2340';
const BURGUNDY_DEEP = '#5c142c';

/**
 * Re-paint the Positron style to the grayscale palette. Pure best-effort: any
 * failure (fetch, unexpected schema) returns null and the caller falls back to
 * the stock style URL — tinting must never break the map.
 */
async function fetchBrandStyle(): Promise<StyleSpecification | null> {
  try {
    const res = await fetch(STYLE_URL);
    if (!res.ok) return null;
    const style = (await res.json()) as StyleSpecification;
    for (const layer of style.layers ?? []) {
      const anyLayer = layer as {
        id: string;
        type: string;
        paint?: Record<string, unknown>;
        layout?: Record<string, unknown>;
      };
      const paint = (anyLayer.paint ??= {});
      const id = anyLayer.id;
      if (anyLayer.type === 'background') paint['background-color'] = TINT.land;
      else if (anyLayer.type === 'fill') {
        paint['fill-color'] = /water/i.test(id) ? TINT.water : TINT.land;
        delete paint['fill-pattern'];
      } else if (anyLayer.type === 'line') {
        if (/water|river/i.test(id)) paint['line-color'] = TINT.water;
        else if (/boundary|admin/i.test(id)) paint['line-color'] = TINT.boundary;
      } else if (anyLayer.type === 'symbol') {
        paint['text-color'] = TINT.label;
        paint['text-halo-color'] = TINT.halo;
        // English-only place labels: positron stacks `name:latin`/`name:nonlatin`
        // (→ "Russia / Россия", Thai-script cities). OpenMapTiles carries
        // English names, so any name-driven label is rewritten to prefer them.
        const layout = (anyLayer.layout ??= {});
        if (JSON.stringify(layout['text-field'] ?? '').includes('name')) {
          layout['text-field'] = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
        }
      }
    }
    return style;
  } catch {
    return null;
  }
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

interface HoverInfo { lng: number; lat: number; name: string; count: number }
interface CountryCard { pin: CountryPin; count: number }

export function MapLibreAtlas({
  countries,
  focusCountry,
  lens,
  selectedRegion,
  onSelectCountry,
  onSelectRegion,
}: {
  countries: CountryPin[];
  focusCountry: CountryPin | null;
  lens: LensKey;
  selectedRegion: MapRegion | null;
  onSelectCountry: (c: CountryPin) => void;
  onSelectRegion: (r: MapRegion) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [brandStyle, setBrandStyle] = useState<StyleSpecification | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [card, setCard] = useState<CountryCard | null>(null);
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  // Touch devices get compatibility mouse events on tap, which would leave a
  // hover chip stuck over the map (and it can swallow the NEXT tap). Hover
  // affordances are pointer-only.
  const canHover = useMedia('(hover: hover) and (pointer: fine)');

  useEffect(() => {
    let alive = true;
    fetchBrandStyle().then((s) => { if (alive && s) setBrandStyle(s); });
    return () => { alive = false; };
  }, []);

  // Close the region-less-country card whenever the surrounding state changes.
  useEffect(() => { setCard(null); }, [focusCountry, lens]);

  const worldGeo = useMemo(() => countriesToGeoJSON(countries, lens), [countries, lens]);
  const regionGeo = useMemo(
    () => (focusCountry ? regionsToGeoJSON(focusCountry.regions, lens) : null),
    [focusCountry, lens],
  );

  /**
   * Camera sync — the ONLY place the camera is driven. World bounds, country
   * bounds (regions with stock under the lens), or the selected region with
   * asymmetric padding so the sheet/panel doesn't cover the pin.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const duration = reducedMotion ? 0 : 900;
    if (selectedRegion) {
      const isDesktop = window.matchMedia('(min-width: 768px)').matches;
      const h = map.getContainer().clientHeight;
      map.easeTo({
        center: [selectedRegion.lng, selectedRegion.lat],
        zoom: Math.max(map.getZoom(), 5.2),
        padding: isDesktop
          ? { top: 40, bottom: 40, left: 40, right: 440 }
          : { top: 30, left: 20, right: 20, bottom: Math.min(260, Math.round(h * 0.45)) },
        duration,
      });
      return;
    }
    if (focusCountry) {
      const withStock = focusCountry.regions.filter((r) => lensCount(r, lens) > 0);
      const b = pointsBounds(withStock.length > 0 ? withStock : focusCountry.regions);
      if (b) {
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
          padding: { top: 80, bottom: 60, left: 60, right: 60 },
          duration,
          maxZoom: 7,
        });
      }
      return;
    }
    map.fitBounds(
      [[WORLD_BOUNDS[0], WORLD_BOUNDS[1]], [WORLD_BOUNDS[2], WORLD_BOUNDS[3]]],
      { padding: 24, duration },
    );
  }, [ready, focusCountry, selectedRegion, lens, reducedMotion]);

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) { setCard(null); return; }
    const props = f.properties as Record<string, unknown>;
    if (f.layer.id === 'country-clusters') {
      const clusterId = props.cluster_id as number;
      const src = mapRef.current?.getSource('atlas-countries') as GeoJSONSource | undefined;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      src?.getClusterExpansionZoom(clusterId).then((zoom) => {
        mapRef.current?.easeTo({ center: [lng, lat], zoom, duration: reducedMotion ? 0 : 600 });
      });
      return;
    }
    if (f.layer.id === 'country-dots') {
      const pin = countries.find((c) => c.slug === props.slug);
      if (!pin) return;
      if (pin.regions.length > 0) onSelectCountry(pin);
      else setCard({ pin, count: Number(props.count) || 0 });
      return;
    }
    if (f.layer.id === 'region-dots') {
      const region = focusCountry?.regions.find((r) => r.slug === props.slug);
      if (region) onSelectRegion(region);
    }
  }, [countries, focusCountry, onSelectCountry, onSelectRegion, reducedMotion]);

  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) { setHover(null); return; }
    if (!canHover || f.layer.id === 'country-clusters') {
      if (canHover) setHover(null);
      return;
    }
    const props = f.properties as Record<string, unknown>;
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    setHover({ lng, lat, name: String(props.name), count: Number(props.count) || 0 });
  }, [canHover]);

  const selectedSlug = selectedRegion?.slug ?? '';

  return (
    <MapGL
      ref={mapRef}
      reuseMaps
      mapStyle={brandStyle ?? STYLE_URL}
      initialViewState={{
        bounds: [[WORLD_BOUNDS[0], WORLD_BOUNDS[1]], [WORLD_BOUNDS[2], WORLD_BOUNDS[3]]],
        fitBoundsOptions: { padding: 24 },
      }}
      // Negative min zoom lets fitBounds fit the FULL populated world even on a
      // 390px phone (pins/labels are constant px size, so they stay tappable —
      // clusters simply merge more aggressively at low zoom). With minZoom 1 the
      // initial mobile view silently cropped Asia + Oceania off-screen.
      minZoom={-0.5}
      maxZoom={7.5}
      cooperativeGestures
      attributionControl={{ compact: true }}
      interactiveLayerIds={['country-clusters', 'country-dots', 'region-dots']}
      cursor={hover ? 'pointer' : 'grab'}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHover(null)}
      onLoad={() => {
        setReady(true);
        // Dev-only handle for e2e click-through verification (never in prod).
        if (process.env.NODE_ENV !== 'production') {
          (window as unknown as { __atlasMap?: unknown }).__atlasMap = mapRef.current?.getMap();
        }
      }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Bottom-left: clear of the breadcrumb (top-left), the desktop region
          panel (right) and the attribution (bottom-right). */}
      <NavigationControl position="bottom-left" showCompass={false} />

      {/* WORLD VIEW — country pins, clustered by the engine. */}
      {!focusCountry && (
        <Source
          id="atlas-countries"
          type="geojson"
          data={worldGeo}
          cluster
          clusterRadius={46}
          clusterMaxZoom={5}
          clusterProperties={{ bottles: ['+', ['get', 'count']] }}
        >
          <Layer
            id="country-clusters"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': BURGUNDY,
              'circle-radius': ['step', ['get', 'point_count'], 17, 5, 21, 10, 25],
              'circle-stroke-width': 2.5,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.92,
            }}
          />
          <Layer
            id="country-cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{
              'text-field': ['get', 'point_count_abbreviated'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 13,
            }}
            paint={{ 'text-color': '#ffffff' }}
          />
          <Layer
            id="country-dots"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-color': BURGUNDY,
              'circle-radius': ['step', ['get', 'count'], 6, 100, 8, 500, 10, 1500, 12],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            }}
          />
          <Layer
            id="country-labels"
            type="symbol"
            filter={['!', ['has', 'point_count']]}
            layout={{
              'text-field': ['format',
                ['get', 'name'], {},
                '  ', {},
                ['get', 'countLabel'], { 'text-font': ['literal', ['Noto Sans Regular']] },
              ],
              'text-font': ['Noto Sans Bold'],
              'text-size': 11.5,
              'text-anchor': 'top',
              'text-offset': [0, 1.1],
              'text-optional': true,
            }}
            paint={{
              'text-color': INK,
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.4,
            }}
          />
        </Source>
      )}

      {/* COUNTRY VIEW — this country's region pins (engine handles label collision). */}
      {focusCountry && regionGeo && (
        <Source id="atlas-regions" type="geojson" data={regionGeo}>
          <Layer
            id="region-dots"
            type="circle"
            paint={{
              'circle-color': ['case', ['==', ['get', 'slug'], selectedSlug], BURGUNDY_DEEP, BURGUNDY],
              'circle-radius': ['case', ['==', ['get', 'slug'], selectedSlug], 11, 8],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            }}
          />
          <Layer
            id="region-labels"
            type="symbol"
            layout={{
              'text-field': ['format',
                ['get', 'name'], {},
                '  ', {},
                ['get', 'countLabel'], { 'text-font': ['literal', ['Noto Sans Regular']] },
              ],
              'text-font': ['Noto Sans Bold'],
              'text-size': 12,
              'text-anchor': 'top',
              'text-offset': [0, 1.15],
              'text-optional': true,
            }}
            paint={{
              'text-color': INK,
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.4,
            }}
          />
        </Source>
      )}

      {/* Hover chip (pointer devices only — see canHover). */}
      {canHover && hover && !card && (
        <Popup
          longitude={hover.lng}
          latitude={hover.lat}
          offset={16}
          closeButton={false}
          closeOnClick={false}
          className="atlas-hover-popup"
        >
          <span className="text-sm font-medium text-neutral-900">
            {hover.name}
            <span className="ml-1.5 tabular-nums text-neutral-500">{hover.count.toLocaleString()}</span>
          </span>
        </Popup>
      )}

      {/* Region-less country → mini card with a /shop hand-off (no surprise nav). */}
      {card && (
        <Popup
          longitude={card.pin.lng}
          latitude={card.pin.lat}
          offset={16}
          closeButton={false}
          closeOnClick
          onClose={() => setCard(null)}
          className="atlas-card-popup"
          maxWidth="260px"
        >
          <div className="flex flex-col gap-1.5 p-1">
            <p className="text-base font-semibold text-neutral-900">
              {flagEmoji(card.pin.name) && <span aria-hidden="true" className="mr-1.5">{flagEmoji(card.pin.name)}</span>}
              {card.pin.name}
            </p>
            <p className="text-sm text-neutral-500">
              {card.count.toLocaleString()} {card.count === 1 ? 'bottle' : 'bottles'}
            </p>
            <Link
              href={countryShopHref(card.pin.name, lens)}
              className="mt-1 inline-flex min-h-9 items-center justify-center rounded-full bg-[#7d2340] px-4 text-sm font-medium text-white hover:opacity-90"
            >
              View bottles →
            </Link>
          </div>
        </Popup>
      )}
    </MapGL>
  );
}
