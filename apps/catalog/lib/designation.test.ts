import { describe, it, expect } from 'vitest';
import { designationForProduct, DESIGNATIONS } from './designation';

const p = (name: string, extra: Record<string, unknown> = {}) =>
  ({ sku: 'X', name, ...extra }) as any;

describe('designationForProduct', () => {
  it('picks most-specific: DOCG not DOC', () => {
    expect(designationForProduct(p('Chianti Classico DOCG 2019'))).toBe('DOCG');
  });
  it('picks most-specific: Extra Brut not Brut', () => {
    expect(designationForProduct(p('Champagne Extra Brut'))).toBe('Extra Brut');
  });
  it('picks most-specific: Gran Reserva not Reserva', () => {
    expect(designationForProduct(p('Rioja Gran Reserva 2015'))).toBe('Gran Reserva');
  });
  it('picks most-specific: VSOP not VS', () => {
    expect(designationForProduct(p('Cognac VSOP'))).toBe('VSOP');
  });
  it('matches Grand Cru', () => {
    expect(designationForProduct(p('Chablis Grand Cru Les Clos'))).toBe('Grand Cru');
  });
  it('matches IGT', () => {
    expect(designationForProduct(p('Masseto Toscana IGT 2021'))).toBe('IGT');
  });
  it('matches Cru Classé even with a trailing accented é (boundary parity with Python)', () => {
    expect(designationForProduct(p('Chateau Margaux 4Ème Cru Classé'))).toBe('Cru Classé');
  });
  it('returns undefined when no designation token', () => {
    expect(designationForProduct(p('Yellow Tail Shiraz'))).toBeUndefined();
  });
  it('does NOT match DOC inside an ordinary word (boundary)', () => {
    expect(designationForProduct(p('Doctorow Estate Red'))).toBeUndefined();
  });
  it('prefers a persisted designation field over name parsing', () => {
    expect(designationForProduct(p('Some Wine DOCG', { designation: 'Grand Cru' }))).toBe('Grand Cru');
  });
  it('DESIGNATIONS is ordered most-specific first (Extra Brut before Brut)', () => {
    expect(DESIGNATIONS.indexOf('Extra Brut')).toBeLessThan(DESIGNATIONS.indexOf('Brut'));
    expect(DESIGNATIONS.indexOf('DOCG')).toBeLessThan(DESIGNATIONS.indexOf('DOC'));
  });
  it('spirit grade XO beats soft modifiers (Limited/Reserve)', () => {
    expect(designationForProduct(p('Hennessy XO Limited Edition 2024'))).toBe('XO');
    expect(designationForProduct(p('Pyrat Rum XO Reserve'))).toBe('XO');
  });
  it('handles empty / missing name without throwing', () => {
    expect(designationForProduct(p(''))).toBeUndefined();
    expect(designationForProduct({ sku: 'X' } as any)).toBeUndefined();
  });
});
