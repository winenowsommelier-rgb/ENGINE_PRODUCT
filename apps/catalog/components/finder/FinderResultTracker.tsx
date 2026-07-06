'use client';

import { useEffect } from 'react';
import { trackFinderResult } from '@/lib/analytics';

interface FinderResultTrackerProps {
  archetype: string;
  category?: string;
  resultCount: number;
}

export function FinderResultTracker({ archetype, category, resultCount }: FinderResultTrackerProps) {
  useEffect(() => {
    trackFinderResult({ archetype, category, result_count: resultCount });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
