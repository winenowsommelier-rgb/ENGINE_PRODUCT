import { describe, it, expect } from 'vitest';
import { buildQuery } from '@/lib/build-query';

describe('buildQuery', () => {
  it('sets a new key on an empty start', () => {
    expect(buildQuery({}, { group: 'Wine' })).toBe('group=Wine');
  });

  it('overwrites an existing key', () => {
    const out = buildQuery({ group: 'Wine' }, { group: 'Whisky' });
    expect(out).toBe('group=Whisky');
  });

  it('preserves keys not mentioned in the patch', () => {
    const params = new URLSearchParams('group=Wine&country=France');
    const out = new URLSearchParams(buildQuery(params, { price: 'under-1000' }));
    expect(out.get('group')).toBe('Wine');
    expect(out.get('country')).toBe('France');
    expect(out.get('price')).toBe('under-1000');
  });

  it('clears a key when patched with null', () => {
    const out = new URLSearchParams(
      buildQuery({ group: 'Wine', price: 'under-1000' }, { price: null }),
    );
    expect(out.get('price')).toBeNull();
    expect(out.get('group')).toBe('Wine');
  });

  it('treats empty-string value as a clear', () => {
    const out = buildQuery({ group: 'Wine' }, { group: '' });
    expect(out).toBe('');
  });

  it('accepts a URLSearchParams as current and returns no leading ?', () => {
    const params = new URLSearchParams('sort=name');
    const out = buildQuery(params, { inStock: '1' });
    expect(out.startsWith('?')).toBe(false);
    const parsed = new URLSearchParams(out);
    expect(parsed.get('sort')).toBe('name');
    expect(parsed.get('inStock')).toBe('1');
  });

  it('returns empty string when all keys are cleared', () => {
    expect(buildQuery({ group: 'Wine' }, { group: null })).toBe('');
  });
});
