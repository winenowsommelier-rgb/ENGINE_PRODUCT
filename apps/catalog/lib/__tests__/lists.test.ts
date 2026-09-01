import { describe, it, expect } from 'vitest';
import { isValidPinsCursor } from '../lists';

describe('isValidPinsCursor', () => {
  it('accepts a well-formed cursor', () => {
    expect(isValidPinsCursor({ addedAt: '2026-09-01T12:00:00.000Z', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })).toBe(true);
  });

  it('rejects a non-ISO addedAt', () => {
    expect(isValidPinsCursor({ addedAt: 'not-a-date', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })).toBe(false);
  });

  it('rejects a non-UUID id', () => {
    expect(isValidPinsCursor({ addedAt: '2026-09-01T12:00:00.000Z', id: 'not-a-uuid' })).toBe(false);
  });

  it('rejects an id crafted to break out of the PostgREST filter string', () => {
    expect(isValidPinsCursor({ addedAt: '2026-09-01T12:00:00.000Z', id: '1,or(is_public.eq.true' })).toBe(false);
  });

  it('rejects an addedAt crafted to break out of the PostgREST filter string', () => {
    expect(isValidPinsCursor({ addedAt: '2026-01-01,or(id.gt.0', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })).toBe(false);
  });
});
