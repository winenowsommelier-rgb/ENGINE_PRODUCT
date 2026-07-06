'use client';

import { useEffect } from 'react';
import { trackViewItemList, type GA4Item } from '@/lib/analytics';

interface ViewItemListTrackerProps {
  listName: string;
  items: GA4Item[];
}

/**
 * Fires GA4 view_item_list once on mount (or when listName changes — e.g. when
 * the user switches category tab on the shop page). Rendered client-side so
 * window.gtag is accessible; returns no visible DOM.
 */
export function ViewItemListTracker({ listName, items }: ViewItemListTrackerProps) {
  useEffect(() => {
    if (items.length === 0) return;
    trackViewItemList({ item_list_name: listName, items });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listName]);

  return null;
}
