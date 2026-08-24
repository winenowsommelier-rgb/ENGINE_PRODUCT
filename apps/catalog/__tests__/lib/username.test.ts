import { describe, it, expect } from 'vitest';
import { deriveUsernameFromEmail, isValidUsername } from '@/lib/username';

describe('deriveUsernameFromEmail', () => {
  it('lowercases and strips non-alphanumerics from the local part', () => {
    expect(deriveUsernameFromEmail('John.Doe+wine@example.com')).toBe('johndoewine');
  });

  it('falls back to "user" when local part has no alphanumerics', () => {
    expect(deriveUsernameFromEmail('...@example.com')).toBe('user');
  });
});

describe('isValidUsername', () => {
  it('accepts lowercase alphanumerics and hyphens, 3-30 chars', () => {
    expect(isValidUsername('john-doe-2')).toBe(true);
  });

  it('rejects usernames shorter than 3 chars', () => {
    expect(isValidUsername('ab')).toBe(false);
  });

  it('rejects usernames with spaces or uppercase', () => {
    expect(isValidUsername('John Doe')).toBe(false);
  });
});
