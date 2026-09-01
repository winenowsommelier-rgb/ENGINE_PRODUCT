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

  it('rejects a Date.parse-parseable addedAt that smuggles filter syntax (regression: Date.parse is more permissive than ISO-8601)', () => {
    // Date.parse('Wed,or(x.eq.1) 01 Sep 2026') resolves to a valid timestamp,
    // so a naive `!Number.isNaN(Date.parse(...))` check would let this through
    // and interpolate the embedded `,or(...)` straight into the PostgREST
    // filter string. isValidPinsCursor must reject anything that isn't a
    // strictly-formatted ISO-8601 timestamp, regardless of what Date.parse accepts.
    expect(isValidPinsCursor({ addedAt: 'Wed,or(x.eq.1) 01 Sep 2026', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })).toBe(false);
  });
});
