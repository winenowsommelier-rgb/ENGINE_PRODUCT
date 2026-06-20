/**
 * Category constants — the 10-group shopper-facing model, as a PURE module with
 * NO Node dependencies (no fs/path).
 *
 * WHY THIS FILE EXISTS (build-safety): the canonical taxonomy is loaded from JSON
 * by sku-taxonomy.ts, which imports `fs` and reads the map at module-eval time.
 * Client components ('use client' — Filters, Footer-consumers, the home nav) import
 * CATEGORY_GROUPS for rendering. If that const lived in sku-taxonomy.ts, importing it
 * into a client bundle would transitively pull in `fs` and fail the webpack build
 * ("Module not found: Can't resolve 'fs'"). Keeping the const + type here — free of
 * Node deps — lets both the server resolver and client components share ONE source of
 * truth for the group list without dragging `fs` into the browser bundle.
 *
 * sku-taxonomy.ts RE-EXPORTS these so it stays the canonical taxonomy entrypoint;
 * category-groups.ts re-exports them onward for the rest of the app.
 */

export const CATEGORY_GROUPS = [
  'Wine', 'Whisky', 'Spirits', 'Sake & Asian', 'Liqueur',
  'Beer & RTD', 'Non-Alcoholic', 'Cigars', 'Events', 'Accessories',
] as const;

export type CategoryGroup = (typeof CATEGORY_GROUPS)[number] | 'Unknown';
