import fs from 'node:fs';
import path from 'node:path';
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
  it('matches DOC/DOCG/IGT/AOC regardless of case (masterfile writes "Doc"/"Docg" too)', () => {
    expect(designationForProduct(p('Pieropan Soave Classico La Rocca Doc'))).toBe('DOC');
    expect(designationForProduct(p('Montelvini Asolo Prosecco Superiore Docg Extra Dry'))).toBe('DOCG');
    expect(designationForProduct(p('Masseto Toscana Igt 2021'))).toBe('IGT');
    expect(designationForProduct(p('Ronan by Clinet Bordeaux Aoc Red'))).toBe('AOC');
  });
  it('matches new designation terms: Crianza, Classico, Superiore', () => {
    expect(designationForProduct(p('El Coto Rioja Crianza'))).toBe('Crianza');
    expect(designationForProduct(p('Carpineto Chianti Classico'))).toBe('Classico');
    expect(designationForProduct(p('Roccolo Grassi Valpolicella Superiore'))).toBe('Superiore');
  });
});

describe('designation description data completeness', () => {
  it('every DESIGNATIONS label has a matching entry in designation_descriptions.json', () => {
    const dataPath = path.join(process.cwd(), '..', '..', 'data', 'designation_descriptions.json');
    const raw = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    for (const label of DESIGNATIONS) {
      expect(data).toHaveProperty(label);
    }
  });
});
