import { loadDesignationDescriptions } from './designation-descriptions.server';

export interface DesignationDescriptionEntry {
  designation: string;
  description: string;
  citation?: string;
}

/**
 * Looks up authored copy for the shop page's designation-description card.
 * Returns null when there's no designation param, no authored copy for it,
 * or (the non-empty guarantee, same rule PR #106 established for tier
 * links) when productCount is 0 — never link/show a card for a filter that
 * would return no results.
 */
export function findDesignationDescription(params: {
  designation?: string | null;
  productCount: number;
}): DesignationDescriptionEntry | null {
  const designation = (params.designation ?? '').trim();
  if (!designation) return null;
  if (params.productCount <= 0) return null;

  const all = loadDesignationDescriptions();
  const entry = all[designation];
  if (!entry) return null;

  return { designation, description: entry.full, citation: entry.citation };
}
