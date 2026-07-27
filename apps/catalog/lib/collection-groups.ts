/**
 * collection-groups — pure slug helpers for the collections category-split
 * landing. NO fs/node deps: both the collections index (app/collections/page.tsx)
 * and the per-group page (app/collections/category/[group]/page.tsx) import these,
 * and the latter is a plain server component that must stay light.
 *
 * `groupToSlug` is the canonical URL form of a group name; `slugToGroup` is its
 * inverse, resolved against the LIVE set of groups that actually have collections
 * (getGroupsWithCollections), so an unknown or empty group slug returns undefined
 * and the page can notFound().
 */
import { getGroupsWithCollections } from './collections';

/**
 * Canonical URL slug for a group name: lowercase, any run of non-alphanumeric
 * chars collapsed to a single '-', leading/trailing '-' trimmed.
 * e.g. "Sake & Asian" → "sake-asian", "Wine" → "wine".
 */
export function groupToSlug(group: string): string {
  return group
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Inverse of groupToSlug against the live groups-with-collections set. Returns
 * the canonical group NAME whose slug matches, or undefined when no live group
 * matches (unknown slug, or a group with zero collections).
 */
export function slugToGroup(slug: string): string | undefined {
  return getGroupsWithCollections()
    .map((g) => g.group)
    .find((group) => groupToSlug(group) === slug);
}
