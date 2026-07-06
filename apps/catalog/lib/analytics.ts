/**
 * Thin, typed wrapper around window.gtag for GA4 event firing.
 *
 * All calls are no-ops when gtag is absent (server render, GA blocked, env
 * var not set) — no try/catch ceremony needed at call sites.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

// ── GA4 standard ecommerce item shape ────────────────────────────────────────

export interface GA4Item {
  item_id: string;      // SKU
  item_name: string;    // product name
  item_category?: string; // category_group e.g. "Wine"
  item_category2?: string; // category_type e.g. "Red Wine"
  price?: number;
  currency?: string;
  quantity?: number;
  index?: number;       // position in list (0-based)
  item_list_name?: string;
}

// ── event payload types ───────────────────────────────────────────────────────

type ViewItemPayload = {
  currency: 'THB';
  value?: number;
  items: GA4Item[];
};

type ViewItemListPayload = {
  item_list_name: string;
  items: GA4Item[];
};

type GenerateLeadPayload = {
  currency: 'THB';
  value: number;
  lead_source: 'LINE' | 'WhatsApp' | 'Messenger';
  item_id?: string;   // SKU if click originates from a product page
  item_name?: string;
};

type FinderStepPayload = {
  step_number: number;
  step_name: string;
  category?: string;
};

type FinderResultPayload = {
  archetype: string;
  category?: string;
  result_count?: number;
};

type BlogViewPayload = {
  post_slug: string;
  post_title?: string;
};

type ExploreRegionPayload = {
  region_name: string;
};

type SearchPayload = {
  search_term: string;
  result_count?: number;
};

// ── event dispatcher ──────────────────────────────────────────────────────────

function gtag(event: string, payload: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', event, payload);
}

// ── typed helpers (one per event) ────────────────────────────────────────────

export function trackViewItem(payload: ViewItemPayload): void {
  gtag('view_item', payload as unknown as Record<string, unknown>);
}

export function trackViewItemList(payload: ViewItemListPayload): void {
  gtag('view_item_list', payload as unknown as Record<string, unknown>);
}

export function trackGenerateLead(payload: GenerateLeadPayload): void {
  gtag('generate_lead', payload as unknown as Record<string, unknown>);
}

export function trackFinderStep(payload: FinderStepPayload): void {
  gtag('finder_step', payload as unknown as Record<string, unknown>);
}

export function trackFinderResult(payload: FinderResultPayload): void {
  gtag('finder_result', payload as unknown as Record<string, unknown>);
}

export function trackBlogView(payload: BlogViewPayload): void {
  gtag('blog_view', payload as unknown as Record<string, unknown>);
}

export function trackExploreRegion(payload: ExploreRegionPayload): void {
  gtag('explore_region', payload as unknown as Record<string, unknown>);
}

export function trackSearch(payload: SearchPayload): void {
  gtag('search', payload as unknown as Record<string, unknown>);
}
