import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolve, groupFor, typeFor } from '../sku-taxonomy';

describe('sku-taxonomy', () => {
  it('resolves red wine', () => {
    expect(resolve({ sku: 'WRW0001', name: '' })).toEqual({ group: 'Wine', type: 'Red Wine' });
  });
  it('WEV beats W (longest-prefix-first)', () => {
    expect(groupFor('WEV0001')).toBe('Events');
  });
  it('Liqueur is its own group', () => {
    expect(groupFor('LLQ0001')).toBe('Liqueur');
  });
  it('WDW fortified by name', () => {
    expect(resolve({ sku: 'WDW1', name: 'Pellegrino Marsala' }).type).toBe('Fortified');
  });
  it('LBD cognac by name', () => {
    expect(resolve({ sku: 'LBD1', name: 'Courvoisier Cognac' }).type).toBe('Cognac');
  });
  it('unknown N prefix is Unknown, not Non-Alcoholic', () => {
    expect(groupFor('NXX0001')).toBe('Unknown');
  });
  it('non-string-safe / blank sku is Unknown', () => {
    expect(groupFor('')).toBe('Unknown');
  });

  // PARITY: every shared fixture case must match exactly (guards TS/Python drift)
  it('matches the shared Python fixture for all 48 cases', () => {
    const fx = JSON.parse(readFileSync(
      join(__dirname, '../../../../tests/fixtures/sku_taxonomy_cases.json'), 'utf8'));
    expect(fx.cases.length).toBe(48);
    for (const c of fx.cases) {
      expect(resolve({ sku: c.sku, name: c.name })).toEqual(c.expected);
    }
  });
});
