import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('vitest setup', () => {
  it('resolves @/ alias and runs', () => {
    expect(cn('a', 'b')).toBe('a b');
  });
});
