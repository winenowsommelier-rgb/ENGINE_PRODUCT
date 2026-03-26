// lib/validation/rules.ts
// Loads all JSON rules files once and caches them.

import * as path from 'path';
import * as fs from 'fs';
import type { RuleSet } from './types';

const RULES_DIR = path.resolve(process.cwd(), 'rules');

function load<T>(filename: string): T {
  const filepath = path.join(RULES_DIR, filename);
  return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as T;
}

let _cached: RuleSet | null = null;

export function getRules(): RuleSet {
  if (_cached) return _cached;
  _cached = {
    skuPrefixes:         load('sku-prefixes.json'),
    grapeVarieties:      load('grape-varieties.json'),
    brands:              load('brands.json'),
    regions:             load('regions.json'),
    appellations:        load('appellations.json'),
    classificationTiers: load('classification-tiers.json'),
    bodyKeywords:        load('body-keywords.json'),
    flavorKeywords:      load('flavor-keywords.json'),
    foodKeywords:        load('food-keywords.json'),
  };
  return _cached;
}

// Call this in tests or if rules files change between runs
export function clearRulesCache(): void {
  _cached = null;
}
