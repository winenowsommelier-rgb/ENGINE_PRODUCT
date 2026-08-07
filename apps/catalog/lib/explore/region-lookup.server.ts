import { loadExploreMapData } from './map-data.server';
import { normGeoName } from '@/lib/geo-resolve';
import type { RegionKnowledge } from './types';

export interface RegionDescriptionEntry {
  name: string;
  country: string;
  description: string;
  knowledge?: RegionKnowledge;
}

/**
 * Looks up authored sommelier copy for the shop page's region-description
 * card, by reusing the SAME static explore-map-data.json the map drawer
 * reads (data/taxonomy.db -> export -> gen-explore-map-data.mjs). No new
 * data source, no live DB/API call.
 *
 * Prefers the subregion's own {name, description} entry (e.g. Margaux) over
 * its parent region's (e.g. Bordeaux) when both are supplied. Returns null
 * when there's no coverage — most regions have none today (67/many), and the
 * shop page must render nothing in that case, not a placeholder.
 */
export function findRegionDescription(params: {
  region?: string | null;
  subregion?: string | null;
}): RegionDescriptionEntry | null {
  const region = (params.region ?? '').trim();
  const subregion = (params.subregion ?? '').trim();
  if (!region) return null;

  const data = loadExploreMapData();
  const regionKey = normGeoName(region);
  const match = data.regions.find((r) => normGeoName(r.name) === regionKey);
  if (!match) return null;

  if (subregion) {
    const subKey = normGeoName(subregion);
    const sub = match.subregions?.find((s) => normGeoName(s.name) === subKey);
    if (sub?.description) {
      return { name: sub.name, country: match.name, description: sub.description };
    }
    // Subregion has no authored copy of its own — fall through to the
    // parent region's description rather than showing nothing.
  }

  if (!match.description) return null;
  return {
    name: match.name,
    country: match.country,
    description: match.description,
    knowledge: match.knowledge,
  };
}
