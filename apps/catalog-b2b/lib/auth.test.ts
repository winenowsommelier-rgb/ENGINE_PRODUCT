import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from './auth';

describe('auth', () => {
  it('verifyToken accepts a freshly signed token', () => {
    expect(verifyToken(signToken())).toBe(true);
  });
  it('rejects undefined', () => {
    expect(verifyToken(undefined)).toBe(false);
  });
  it('rejects empty string', () => {
    expect(verifyToken('')).toBe(false);
  });
  it('rejects tampered payload', () => {
    const token = signToken();
    const tampered = 'ZmFrZQ.' + token.split('.')[1];
    expect(verifyToken(tampered)).toBe(false);
  });
  it('rejects tampered signature', () => {
    const token = signToken();
    const tampered = token.split('.')[0] + '.0000000000000000000000000000000000000000000000000000000000000000';
    expect(verifyToken(tampered)).toBe(false);
  });
  it('rejects wrong format (no dot)', () => {
    expect(verifyToken('nodot')).toBe(false);
  });
});
