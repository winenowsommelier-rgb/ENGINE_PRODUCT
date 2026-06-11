import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assessProduct,
  computeReviewPriority,
  isBeverage,
  toMagentoRow,
} from '../scripts/lib/magento-catalog-quality.mjs';

const currentDate = new Date('2026-06-10T00:00:00Z');

function product(overrides = {}) {
  return {
    sku: 'WRW0001AA',
    name: 'Example Estate Cabernet Sauvignon',
    classification: 'Red Wine',
    country: 'France',
    region: 'Bordeaux',
    subregion: 'Pauillac',
    desc_en_short: 'A polished Cabernet with cassis, cedar, graphite, and a fresh finish.',
    full_description: 'A polished Cabernet Sauvignon with cassis, cedar, graphite, fine tannins, and a fresh mineral finish that works well with grilled meats.',
    updated_at: '2026-06-02T14:04:44Z',
    ...overrides,
  };
}

test('matches the shared beverage selection fixture', () => {
  const fixtureUrl = new URL('./fixtures/geography/beverage-selection.json', import.meta.url);
  const products = JSON.parse(readFileSync(fixtureUrl, 'utf8'));

  for (const { expected, ...fixtureProduct } of products) {
    assert.equal(isBeverage(fixtureProduct), expected, fixtureProduct.sku);
  }
});

test('marks a recently enriched beverage with complete geography ready', () => {
  const result = assessProduct(product(), currentDate);
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.blockers, []);
});

test('keeps a beverage with a missing subregion ready but warns clearly', () => {
  const result = assessProduct(product({ subregion: '' }), currentDate);
  assert.equal(result.status, 'READY_WITH_WARNING');
  assert.ok(result.warnings.includes('missing_subregion'));
});

test('holds name-only descriptions out of the Magento batch', () => {
  const name = 'Example Estate Cabernet Sauvignon';
  const result = assessProduct(product({
    name,
    desc_en_short: '',
    full_description: name,
  }), currentDate);
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('description_missing_or_too_short'));
});

test('holds beverages with missing region', () => {
  const result = assessProduct(product({ region: '', subregion: '' }), currentDate);
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('beverage_region_missing'));
});

test('sends duplicate region and subregion values to review', () => {
  const result = assessProduct(product({ region: 'Cognac', subregion: 'Cognac' }), currentDate);
  assert.equal(result.status, 'REVIEW');
  assert.ok(result.warnings.includes('region_equals_subregion'));
});

test('sends stale records to review', () => {
  const result = assessProduct(product({ updated_at: '2026-03-24T00:00:00Z' }), currentDate);
  assert.equal(result.status, 'REVIEW');
  assert.ok(result.warnings.includes('stale_update_over_45_days'));
});

test('maps taxonomy geography to independent Magento columns', () => {
  const row = toMagentoRow(product({
    sku: 'LBD0006CN',
    name: 'St-Rémy  X.O (700 ml)',
    classification: 'Brandy',
    country: 'France',
    region: 'Cognac',
    subregion: 'Grande Champagne',
  }), currentDate);
  assert.equal(row.sku, 'LBD0006CN');
  assert.equal(row.country, 'France');
  assert.equal(row.region, 'Cognac');
  assert.equal(row.subregion, 'Grande Champagne');
  assert.equal('region_wine' in row, false);
  assert.equal(row.short_description, product().desc_en_short);
  assert.equal(row.description, product().full_description);
  assert.equal(row.magento_readiness, 'READY');
});

test('prioritizes review items with recent revenue before stocked and inactive items', () => {
  assert.equal(computeReviewPriority({ popularity_revenue_90d: 1000, wn_stock: 0 }), 'HIGH');
  assert.equal(computeReviewPriority({ popularity_revenue_90d: 0, wn_stock: 5 }), 'MEDIUM');
  assert.equal(computeReviewPriority({ popularity_revenue_90d: 0, wn_stock: 0 }), 'LOW');
});

test('holds products with visible UTF-8 mojibake', () => {
  const result = assessProduct(product({ name: 'PaÃ§o Dos Infantes Tinto' }), currentDate);
  assert.equal(result.status, 'HOLD');
  assert.ok(result.blockers.includes('encoding_mojibake_detected'));
});
