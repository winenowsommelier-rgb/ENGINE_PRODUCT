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

// Regression guard for the explore-map "Sake" button (LSJ0024DG/Chum Churum bug
// report, 2026-09-01): class="Sake / Shochu" must isolate real sake (LSK prefix)
// from Shochu (LSJ, e.g. Hakutake) and Soju (LSJ, e.g. Chum Churum) — all three
// share the "Sake & Asian" category_group, only category_type distinguishes them.
const sakeAsianProd = (sku: string, name: string) => ({ sku, name, country: 'Japan' }) as any;
describe('matchesFilters class= isolates real sake within Sake & Asian', () => {
  it('a real sake SKU (LSK prefix) matches class=Sake / Shochu', () => {
    expect(matchesFilters(sakeAsianProd('LSK0348AD', 'Tamanohikari Junmai Ginjo'), { class: 'Sake / Shochu' })).toBe(true);
  });
  it('a Shochu SKU does NOT match class=Sake / Shochu', () => {
    expect(matchesFilters(sakeAsianProd('LSJ0083FS', 'Hakutake Kumamon'), { class: 'Sake / Shochu' })).toBe(false);
  });
  it('a Soju SKU does NOT match class=Sake / Shochu', () => {
    expect(matchesFilters(sakeAsianProd('LSJ0087GM', 'Chum Churum Soju Original'), { class: 'Sake / Shochu' })).toBe(false);
  });
  it('with no class filter, all three still match (group-only /shop behavior unchanged)', () => {
    expect(matchesFilters(sakeAsianProd('LSK0348AD', 'Tamanohikari Junmai Ginjo'), { group: 'Sake & Asian' })).toBe(true);
    expect(matchesFilters(sakeAsianProd('LSJ0083FS', 'Hakutake Kumamon'), { group: 'Sake & Asian' })).toBe(true);
    expect(matchesFilters(sakeAsianProd('LSJ0087GM', 'Chum Churum Soju Original'), { group: 'Sake & Asian' })).toBe(true);
  });
});
