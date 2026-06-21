import fs from 'node:fs';
import path from 'node:path';
import type { ExploreMapData } from './types';

/**
 * SERVER-ONLY loader for the build-time explore-map data. Kept SEPARATE from
 * ./map-data.ts because it imports node:fs/node:path — webpack rejects `node:`
 * schemes in the client bundle, and ./map-data.ts is imported by a 'use client'
 * component (for LENS_GROUPS). Mirrors the catalog's *.server.ts convention.
 *
 * Read ONCE on first call (build-time SSG) and cached for the process lifetime.
 */

function dataPath(): string {
  const candidates = [
    path.join(process.cwd(), 'apps', 'catalog', 'data', 'explore-map-data.json'),
    path.join(process.cwd(), 'data', 'explore-map-data.json'),
    process.env.EXPLORE_MAP_DATA_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('explore-map-data.json not found — run the prebuild generator');
  return found;
}

let _cache: ExploreMapData | null = null;
export function loadExploreMapData(): ExploreMapData {
  if (_cache) return _cache;
  _cache = JSON.parse(fs.readFileSync(dataPath(), 'utf8')) as ExploreMapData;
  return _cache;
}
