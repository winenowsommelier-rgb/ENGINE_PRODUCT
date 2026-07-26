import { describe, it, expect } from 'vitest';
import { collectionToShopParams, type CollectionDef } from '../collections';

describe('collectionToShopParams', () => {
  it('passes through allowlisted keys as ShopParams (class, not category)', () => {
    const def: CollectionDef = { slug: 'x', name: 'X', description: '',
      filter: { country: 'Italy', region: 'Piedmont', class: 'Red Wine' } };
    expect(collectionToShopParams(def)).toEqual(
      { country: 'Italy', region: 'Piedmont', class: 'Red Wine' });
  });

  it('drops non-allowlisted keys: grape (spec §7) AND category (wrong key)', () => {
    const def = { slug: 'x', name: 'X', description: '',
      filter: { region: 'Tuscany', grape: 'sangiovese', category: 'Red Wine', evil: '1' } } as unknown as CollectionDef;
    const params = collectionToShopParams(def);
    expect(params).toEqual({ region: 'Tuscany' });
    expect('grape' in params).toBe(false);
    expect('category' in params).toBe(false);
  });
});
