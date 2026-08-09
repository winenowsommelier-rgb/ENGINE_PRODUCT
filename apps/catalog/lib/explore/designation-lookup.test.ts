import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./designation-descriptions.server', () => ({
  loadDesignationDescriptions: vi.fn(),
}));

import { loadDesignationDescriptions } from './designation-descriptions.server';
import { findDesignationDescription } from './designation-lookup.server';

const mockLoad = vi.mocked(loadDesignationDescriptions);

beforeEach(() => {
  mockLoad.mockReset();
  mockLoad.mockReturnValue({
    DOCG: { short: 'short copy', full: 'full copy', citation: 'Wine Bible 2e' },
  });
});

describe('findDesignationDescription', () => {
  it('returns the entry when a designation param, copy, and a positive count all exist', () => {
    const result = findDesignationDescription({ designation: 'DOCG', productCount: 356 });
    expect(result).toEqual({ designation: 'DOCG', description: 'full copy', citation: 'Wine Bible 2e' });
  });

  it('returns null when productCount is 0, even though copy exists (the VS case)', () => {
    const result = findDesignationDescription({ designation: 'DOCG', productCount: 0 });
    expect(result).toBeNull();
  });

  it('returns null when no designation param is given', () => {
    expect(findDesignationDescription({ designation: null, productCount: 356 })).toBeNull();
    expect(findDesignationDescription({ designation: undefined, productCount: 356 })).toBeNull();
    expect(findDesignationDescription({ designation: '', productCount: 356 })).toBeNull();
  });

  it('returns null when no copy entry exists for the given designation', () => {
    const result = findDesignationDescription({ designation: 'Nonexistent Label', productCount: 5 });
    expect(result).toBeNull();
  });

  it('propagates a thrown error from the loader (missing file) rather than swallowing it into null', () => {
    mockLoad.mockImplementation(() => {
      throw new Error('designation_descriptions.json not found');
    });
    expect(() => findDesignationDescription({ designation: 'DOCG', productCount: 356 })).toThrow(
      'designation_descriptions.json not found',
    );
  });
});
