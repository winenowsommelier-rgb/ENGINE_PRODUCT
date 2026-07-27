import { describe, it, expect } from 'vitest';
import {
  collectionToShopParams,
  getCollections,
  getCollectionsByGroup,
  getGroupsWithCollections,
  type CollectionDef,
} from '../collections';

describe('collectionToShopParams', () => {
  it('passes through allowlisted keys as ShopParams (class, not category)', () => {
    const def: CollectionDef = { slug: 'x', name: 'X', description: '', group: 'Wine', sortOrder: 1,
      filter: { country: 'Italy', region: 'Piedmont', class: 'Red Wine' } };
    expect(collectionToShopParams(def)).toEqual(
      { country: 'Italy', region: 'Piedmont', class: 'Red Wine' });
  });

  it('drops non-allowlisted keys: grape (spec §7) AND category (wrong key)', () => {
    const def = { slug: 'x', name: 'X', description: '', group: 'Wine', sortOrder: 1,
      filter: { region: 'Tuscany', grape: 'sangiovese', category: 'Red Wine', evil: '1' } } as unknown as CollectionDef;
    const params = collectionToShopParams(def);
    expect(params).toEqual({ region: 'Tuscany' });
    expect('grape' in params).toBe(false);
    expect('category' in params).toBe(false);
  });
});

describe('grouping helpers (read the real collections_export.json)', () => {
  it('getGroupsWithCollections returns only non-empty groups, no dupes, in order', () => {
    const groups = getGroupsWithCollections();
    expect(groups.length).toBeGreaterThanOrEqual(4);
    const names = groups.map((g) => g.group);
    expect(names).toEqual(Array.from(new Set(names))); // no duplicate group boxes
    expect(names).toContain('Wine');
    expect(names).toContain('Whisky');
    for (const g of groups) expect(g.collections.length).toBeGreaterThan(0);
  });

  it('getCollectionsByGroup filters to a single group', () => {
    const whisky = getCollectionsByGroup('Whisky');
    expect(whisky.length).toBeGreaterThan(0);
    expect(whisky.every((c) => c.group === 'Whisky')).toBe(true);
  });

  it('every real collection carries a non-empty group', () => {
    for (const c of getCollections()) expect(c.group).not.toBe('');
  });
});
