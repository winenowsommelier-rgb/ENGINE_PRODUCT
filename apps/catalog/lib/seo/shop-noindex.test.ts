// apps/catalog/lib/seo/shop-noindex.test.ts
import { describe, it, expect } from 'vitest';

function shouldNoindex(total: number): boolean {
  return total < 5;
}

describe('shop noindex guard', () => {
  it('noindexes thin results', () => {
    expect(shouldNoindex(0)).toBe(true);
    expect(shouldNoindex(4)).toBe(true);
  });
  it('does not noindex adequate results', () => {
    expect(shouldNoindex(5)).toBe(false);
    expect(shouldNoindex(100)).toBe(false);
  });
});
