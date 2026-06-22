import { describe, it, expect } from 'vitest';
import { matchesFilters } from './shop-query';
const prod = (name: string) => ({ sku: 'X', name, country: 'France' }) as any;
describe('matchesFilters designation', () => {
  it('designation param filters by derived designation', () => {
    expect(matchesFilters(prod('Chablis Grand Cru'), { designation: 'Grand Cru' })).toBe(true);
    expect(matchesFilters(prod('Chablis Grand Cru'), { designation: 'DOCG' })).toBe(false);
    expect(matchesFilters(prod('Yellow Tail Shiraz'), { designation: 'Grand Cru' })).toBe(false);
    expect(matchesFilters(prod('Yellow Tail Shiraz'), {})).toBe(true);
  });
});
