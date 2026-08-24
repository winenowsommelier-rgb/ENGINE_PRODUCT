/**
 * Open-redirect guard (CWE-601) for post-login `?next=` navigation.
 *
 * `next` is a user-controlled query param on /login (e.g. `/login?next=...`)
 * that `loginAction` passes straight into next/navigation's `redirect()`
 * after a successful sign-in. redirect() will send the browser to whatever
 * string it's given, with no origin check of its own -- so an attacker can
 * craft a link like `/login?next=https://evil.com` (or a protocol-relative
 * `//evil.com`, or a backslash variant like `/\evil.com` that browsers
 * normalize to `//evil.com` in a Location/URL context) to send a freshly
 * authenticated user to an attacker-controlled page for phishing or
 * credential harvesting, right after they just proved their identity is
 * real. Resolving against a fixed dummy origin and checking the origin
 * survived is the general fix -- it closes the whole bypass class (bare
 * `//`, backslash variants, mixed encodings) rather than pattern-matching
 * one string shape at a time.
 */
export function safeNextPath(rawNext: string): string {
  try {
    const resolved = new URL(rawNext, 'http://localhost');
    return resolved.origin === 'http://localhost'
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : '/';
  } catch {
    return '/';
  }
}
