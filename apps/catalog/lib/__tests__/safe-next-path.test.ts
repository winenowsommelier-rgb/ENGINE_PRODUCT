import { describe, it, expect } from 'vitest';
import { safeNextPath } from '@/lib/safe-next-path';

describe('safeNextPath', () => {
  it('passes through the root path', () => {
    expect(safeNextPath('/')).toBe('/');
  });

  it('passes through an ordinary same-origin path', () => {
    expect(safeNextPath('/account/settings')).toBe('/account/settings');
  });

  it('preserves query string and hash on a same-origin path', () => {
    expect(safeNextPath('/lists?sort=recent#top')).toBe('/lists?sort=recent#top');
  });

  it('rejects a protocol-relative URL (bare //)', () => {
    expect(safeNextPath('//evil.com')).toBe('/');
  });

  it('rejects an absolute external URL', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
  });

  it('rejects a backslash-prefixed path that browsers normalize to //', () => {
    expect(safeNextPath('/\\evil.com')).toBe('/');
  });

  it('rejects a javascript: URL', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
  });

  it('falls back to / on an empty string', () => {
    expect(safeNextPath('')).toBe('/');
  });
});
