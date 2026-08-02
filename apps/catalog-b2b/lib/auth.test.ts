import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from './auth';

describe('auth', () => {
  it('verifyToken accepts a freshly signed token', async () => {
    expect(await verifyToken(await signToken())).toBe(true);
  });
  it('rejects undefined', async () => {
    expect(await verifyToken(undefined)).toBe(false);
  });
  it('rejects empty string', async () => {
    expect(await verifyToken('')).toBe(false);
  });
  it('rejects tampered payload', async () => {
    const token = await signToken();
    const tampered = 'ZmFrZQ.' + token.split('.')[1];
    expect(await verifyToken(tampered)).toBe(false);
  });
  it('rejects tampered signature', async () => {
    const token = await signToken();
    const tampered = token.split('.')[0] + '.0000000000000000000000000000000000000000000000000000000000000000';
    expect(await verifyToken(tampered)).toBe(false);
  });
  it('rejects wrong format (no dot)', async () => {
    expect(await verifyToken('nodot')).toBe(false);
  });
});
