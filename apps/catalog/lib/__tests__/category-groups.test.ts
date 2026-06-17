import { describe, it, expect } from 'vitest';
import {
  groupForClassification,
  classificationsInGroup,
  CATEGORY_GROUPS,
} from '@/lib/category-groups';

describe('category grouping', () => {
  it('maps Red Wine -> Wine', () => expect(groupForClassification('Red Wine')).toBe('Wine'));
  it('maps Whiskey and Whisky -> Whisky', () => {
    expect(groupForClassification('Whisky')).toBe('Whisky');
    expect(groupForClassification('Whiskey')).toBe('Whisky');
  });
  it('maps Gin/Vodka/Rum -> Spirits', () => {
    expect(groupForClassification('Gin')).toBe('Spirits');
    expect(groupForClassification('Vodka')).toBe('Spirits');
    expect(groupForClassification('Rum')).toBe('Spirits');
  });
  it('maps Sake/Shochu -> Sake & Asian', () => expect(groupForClassification('Sake/Shochu')).toBe('Sake & Asian'));
  it('maps Beer -> Beer & RTD', () => expect(groupForClassification('Beer')).toBe('Beer & RTD'));
  it('maps Glassware -> Accessories', () => expect(groupForClassification('Glassware')).toBe('Accessories'));
  it('splits pipe-delimited (Red Wine|Fruit Wine) -> Wine', () =>
    expect(groupForClassification('Red Wine|Fruit Wine')).toBe('Wine'));
  it('unknown -> Accessories (catch-all)', () =>
    expect(groupForClassification('Mystery Thing')).toBe('Accessories'));
  it('handles null/empty -> Accessories', () => {
    expect(groupForClassification(null as any)).toBe('Accessories');
    expect(groupForClassification('')).toBe('Accessories');
  });
  it('exposes <= 7 ordered groups, Wine first', () => {
    expect(CATEGORY_GROUPS.length).toBeLessThanOrEqual(7);
    expect(CATEGORY_GROUPS[0]).toBe('Wine');
  });

  // Helper: classificationsInGroup returns raw classifications mapping to a group
  it('classificationsInGroup(Whisky) returns Whisky + Whiskey', () => {
    const inGroup = classificationsInGroup('Whisky');
    expect(inGroup).toContain('Whisky');
    expect(inGroup).toContain('Whiskey');
  });
  it('every classification returned by classificationsInGroup maps back to that group', () => {
    for (const group of CATEGORY_GROUPS) {
      for (const raw of classificationsInGroup(group)) {
        expect(groupForClassification(raw)).toBe(group);
      }
    }
  });
});
