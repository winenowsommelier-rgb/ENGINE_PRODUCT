import { describe, it, expect, vi } from 'vitest';

// Force every candidate path to "not exist" so exportPath() must throw.
// Scoped to this test file's module registry; does not affect other suites.
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>();
  return {
    ...actual,
    existsSync: () => false,
    default: { ...actual, existsSync: () => false },
  };
});

import { exportPath } from '@/lib/catalog-data';

describe('exportPath', () => {
  it('throws when no candidate file exists', () => {
    expect(() => exportPath()).toThrow(/not found/);
  });
});
