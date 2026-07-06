'use client';

import { useEffect } from 'react';
import { trackViewItem, type GA4Item } from '@/lib/analytics';

interface ViewItemTrackerProps {
  item: GA4Item;
  value?: number;
}

/**
 * Fires GA4 view_item once on mount for a product detail page.
 * Rendered as a client component so window.gtag is accessible.
 */
export function ViewItemTracker({ item, value }: ViewItemTrackerProps) {
  useEffect(() => {
    trackViewItem({
      currency: 'THB',
      value,
      items: [{ ...item, quantity: 1 }],
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.item_id]);

  return null;
}
