# Explore Map v3 — MapLibre Foundation Redesign

**Date:** 2026-07-17
**Status:** Approved by user (foundation + layout chosen via structured question)
**Replaces:** hand-rolled SVG `RegionAtlas` (557 lines, 10+ fix commits for pin drift/overlap/framing)

## Problem

`/explore-map` browsing is broken in practice:

1. **Scattered pins.** The custom greedy clustering + "spread" de-overlap pushes pins
   into the ocean and stacks unreadable count badges over Europe and the Americas.
2. **Mobile is unusable.** The 2.5:1 letterbox strip renders the whole world ~150px
   tall on a 390px phone; pins are ~8px, far below touch-target minimums.
3. **No gestures.** No pan/pinch; the only navigation is tapping tiny pins.
4. Every clustering/framing/zoom behavior is hand-rolled and keeps regressing.

User decision: stop patching; stand on a proven map engine (project Rule 11).

## Decisions (approved)

- **Engine:** MapLibre GL JS via `react-map-gl` v8 (`react-map-gl/maplibre` entry).
  Basemap style from **OpenFreeMap** (`https://tiles.openfreemap.org/styles/positron`)
  — free, no API key, no usage cap, self-hostable escape hatch if ever needed.
- **Layout:** tall immersive map (~68vh, min 420px) on all viewports. Region details
  open **over** the map: bottom sheet on mobile, right-side panel on desktop, so map
  context is never lost. Chips/lens stay above the map as a compact band.

## Architecture

```
app/explore-map/page.tsx            (unchanged SSG shell; data via loadExploreMapData)
app/explore-map/ExploreRegionClient.tsx   (state owner: lens, focusCountry, selected)
  ├─ CategoryLens                    (kept as-is)
  ├─ CountryChips                    (kept; drives same callbacks as map)
  ├─ MapLibreAtlas  ← NEW           (client-only, next/dynamic ssr:false + skeleton)
  ├─ RegionSheet    ← NEW           (RegionDrawer content, overlay layout)
  └─ RegionList / EscapeHatch        (kept — SEO + keyboard/screen-reader path)
lib/explore/geojson.ts  ← NEW       (pure data→GeoJSON builders, unit-tested)
```

### MapLibreAtlas

- Controlled component; same conceptual interface as old RegionAtlas:
  `{ countries, focusCountry, lens, selectedSlug, onSelectCountry, onSelectRegion }`.
- **World view:** one GeoJSON source of country points (count under active lens),
  `cluster: true` — the ENGINE does all clustering. Circle layer (brand burgundy,
  white stroke) + symbol layer for counts. Click cluster →
  `getClusterExpansionZoom` → `easeTo`. Click country point → `onSelectCountry`.
- **Country view:** `fitBounds` to the country's region points (padded); regions
  render from a second source (no clustering needed at country zoom — engine
  collision handles label overlap). Click region → `onSelectRegion`.
- **Region-less countries** (Spain-type, no curated regions): click opens a mini
  popup card (flag, name, count, "View bottles →" to `/shop?country=X`) instead of
  today's surprise instant navigation.
- Hover: name + bottle-count chip (desktop pointer only).
- Breadcrumb pill overlay (World › Country › Region) + reset; kept from current UI.
- `cooperativeGestures: true` so page scroll never gets trapped by the map.
- `prefers-reduced-motion` → `jumpTo` instead of `flyTo`/`easeTo`.
- Brand tint: `brandifyStyle()` fetches the Positron style JSON and re-paints
  background/land/water to the parchment palette; ANY failure falls back to the
  stock style URL (map must never fail closed because of tinting).
- Deep link `/explore-map/[region]` → initial camera on that region + sheet open.

### RegionSheet

- Same content blocks as current RegionDrawer (header, description, peek bottles,
  subregions, "View all N →" CTA).
- Mobile (<md): fixed bottom sheet, `max-h-[70vh]`, internal scroll, rounded top,
  close affordance + backdrop tap.
- Desktop (≥md): absolute panel pinned to the map's right edge (`max-w-md`,
  inset-y padding), internal scroll.

### Removed

- `components/explore/RegionAtlas.tsx`, `lib/explore/world-path.ts`,
  `region-atlas-framing.test.ts`, `region-atlas-world-fill.test.ts` — the
  projection/cluster/spread/framing machinery is now the engine's job.
- `countryLensCount`/pin partition helpers move to `lib/explore/` (still used by
  CountryChips) with their tests.

## Data flow (unchanged)

`gen-explore-map-data.mjs` → `explore-map-data.json` → `loadExploreMapData()` →
props. Client builds GeoJSON via pure functions in `lib/explore/geojson.ts`.
No DB/export changes; no paid APIs.

## Error handling

- Tile/style fetch failure: map shows basemap-less state but chips + RegionList
  (outside the map) remain the fully functional browse path; no crash.
- Component error boundary around the dynamic map → fallback message + chips/list.

## Testing & verification

- Unit: geojson builders, lens counting, region-less-country routing (vitest, co-located).
- `tsc --noEmit`, `npm run build` (project gate: build, not just tests).
- **Rule 7 browser verification** with system Chrome driven by puppeteer-core:
  world → click cluster → click country → region pins → click region → sheet →
  shop CTA; at 1440px and 390px. Screenshots archived in the PR.

## Risks

- External tile CDN (OpenFreeMap) — free/unlimited; mitigation: style/tiles are
  swappable via one constant; graceful degradation path exists.
- +~250KB gz JS on this route only (dynamic import; rest of site unaffected).
