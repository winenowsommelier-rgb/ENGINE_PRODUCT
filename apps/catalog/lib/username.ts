/**
 * Client-side mirror of the DB trigger's derivation (handle_new_user in the
 * user-accounts-and-lists migration). Used only for instant UI preview
 * before signup completes -- the trigger is the actual source of truth and
 * independently handles collision suffixing, which this function does not.
 */
export function deriveUsernameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const stripped = localPart.toLowerCase().replace(/[^a-z0-9]/g, '');
  return stripped || 'user';
}

/** Matches the DB's `username unique not null` constraint's expected shape. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9-]{3,30}$/.test(username);
}
