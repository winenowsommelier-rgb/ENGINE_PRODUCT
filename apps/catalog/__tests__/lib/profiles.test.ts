import { describe, it, expect, vi } from 'vitest';
import { isUsernameAvailable, isUsernameSubmissionValid } from '@/lib/profiles';

describe('isUsernameAvailable', () => {
  it('returns false when a row with that username already exists', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'other-user' }, error: null }),
          }),
        }),
      }),
    };
    const result = await isUsernameAvailable(mockClient as any, 'taken-name', 'current-user-id');
    expect(result).toBe(false);
  });

  it('returns true when the only match is the current user themselves', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'current-user-id' }, error: null }),
          }),
        }),
      }),
    };
    const result = await isUsernameAvailable(mockClient as any, 'my-name', 'current-user-id');
    expect(result).toBe(true);
  });

  it('returns true when no row matches', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
    const result = await isUsernameAvailable(mockClient as any, 'free-name', 'current-user-id');
    expect(result).toBe(true);
  });
});

describe('isUsernameSubmissionValid', () => {
  // Regression guard: the DB's handle_new_user trigger derives usernames
  // from email local-parts with NO length cap, and profiles.username has
  // no CHECK constraint enforcing one either. A user whose email local-part
  // is long (e.g. 40 chars) can have an already-stored username longer than
  // isValidUsername's 30-char UX cap for NEW usernames. Without this
  // unchanged-value carve-out, that real user's own settings page would
  // reject their own unmodified username as "invalid" -- see Task 5 review.
  it('accepts a >30-char username when it matches the currently stored value unchanged', () => {
    const longStored = 'a'.repeat(40);
    expect(isUsernameSubmissionValid(longStored, longStored)).toBe(true);
  });

  it('rejects a >30-char username when it differs from the currently stored value', () => {
    const longStored = 'a'.repeat(40);
    const longNew = 'b'.repeat(40);
    expect(isUsernameSubmissionValid(longNew, longStored)).toBe(false);
  });

  it('accepts a valid new username that differs from the stored value', () => {
    expect(isUsernameSubmissionValid('new-name', 'old-name')).toBe(true);
  });

  it('accepts an unchanged stored value even if it would fail isValidUsername for another reason (e.g. too short)', () => {
    // The unchanged-value carve-out is unconditional by design: ANY stored
    // username the DB already accepted (trigger has no length/shape
    // constraints beyond NOT NULL UNIQUE) must remain re-submittable as-is.
    // A hypothetical short legacy value is the same class of problem as the
    // long-value case this fix targets -- the settings page must never
    // reject a user's own untouched username.
    expect(isUsernameSubmissionValid('ab', 'ab')).toBe(true);
  });

  it('rejects an invalid new username (uppercase/spaces) even when "current" is null (no prior username)', () => {
    expect(isUsernameSubmissionValid('Not Valid', null)).toBe(false);
  });
});
