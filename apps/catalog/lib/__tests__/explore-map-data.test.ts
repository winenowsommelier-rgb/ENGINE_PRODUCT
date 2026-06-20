import { describe, it, expect } from 'vitest';
import { REGION_CENTROIDS, centroidFor } from '@/lib/explore/region-centroids';

describe('region-centroids', () => {
  it('covers the high-depth no-coord regions (sake + Napa + Languedoc)', () => {
    for (const name of ['Niigata', 'Nagano', 'Hyogo', 'Napa Valley', 'Languedoc-Roussillon']) {
      const c = centroidFor(name);
      expect(c, `${name} must have a centroid`).toBeTruthy();
      expect(typeof c!.lat).toBe('number');
      expect(typeof c!.lng).toBe('number');
    }
  });

  it('lookup is case-insensitive and trims', () => {
    expect(centroidFor('  niigata ')).toEqual(centroidFor('Niigata'));
  });

  it('returns null for an unknown region', () => {
    expect(centroidFor('Nowhere-land')).toBeNull();
  });
});
