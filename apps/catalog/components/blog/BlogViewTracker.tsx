'use client';

import { useEffect } from 'react';
import { trackBlogView } from '@/lib/analytics';

interface BlogViewTrackerProps {
  slug: string;
  title?: string;
}

export function BlogViewTracker({ slug, title }: BlogViewTrackerProps) {
  useEffect(() => {
    trackBlogView({ post_slug: slug, post_title: title });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return null;
}
